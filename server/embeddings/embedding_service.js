/**
 * Embedding Service - Handles Ollama embedding API calls with batching and caching
 */

const http = require('http');
const crypto = require('crypto');

class EmbeddingService {
  constructor(options = {}) {
    this.port = options.port || 11434;
    this.model = options.model || 'nomic-embed-text';
    this.timeoutMs = options.timeoutMs || 30000; // 30s default
    this.batchSize = options.batchSize || 10; // Process in batches of 10
    this.keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });

    // In-memory cache for this session (optional, primary cache is in vector store)
    this.sessionCache = new Map();
  }

  /**
   * Normalize embedding type to match VectorStore contract
   * @param {string} type - Raw embedding type
   * @returns {string} Normalized embedding type
   */
  normalizeEmbeddingType(type) {
    // Map 'text' (generic row content) to 'row' (entire Excel row representation)
    if (type === 'text') return 'row';
    return type;
  }

  /**
   * Generate hash for text caching
   */
  generateHash(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  /**
   * Call Ollama embeddings API for single text
   */
  async callOllamaEmbedding(text) {
    return new Promise((resolve, reject) => {
      try {
        const payload = { model: this.model, prompt: text };
        const data = JSON.stringify(payload);

        const options = {
          hostname: '127.0.0.1',
          port: this.port,
          path: '/api/embeddings',
          method: 'POST',
          agent: this.keepAliveAgent,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            'Connection': 'keep-alive'
          }
        };

        const req = http.request(options, (res) => {
          let raw = '';
          res.on('data', (chunk) => raw += chunk);
          res.on('end', () => {
            if (!raw) return reject(new Error(`Empty response from Ollama embeddings (status ${res.statusCode})`));
            try {
              const json = JSON.parse(raw);
              if (res.statusCode >= 200 && res.statusCode < 300 && json.embedding) {
                resolve(json.embedding);
              } else {
                reject(new Error(`Ollama embeddings failed: ${JSON.stringify(json)}`));
              }
            } catch (err) {
              reject(new Error('Failed to parse Ollama embeddings response: ' + err.message));
            }
          });
        });

        if (this.timeoutMs !== false && this.timeoutMs !== 0) {
          req.setTimeout(this.timeoutMs, () => {
            req.destroy(new Error(`Embedding timeout after ${this.timeoutMs} ms`));
          });
        }

        req.on('error', (err) => {
          reject(new Error('Failed to connect to Ollama for embeddings: ' + err.message));
        });

        req.write(data);
        req.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Batch embed multiple texts with caching
   * @param {string[]} texts - Array of texts to embed
   * @param {Object} vectorStore - Vector store instance for caching
   * @param {Object} options - Additional options
   * @param {boolean} options.returnIds - Whether to return embedding IDs along with embeddings
   * @param {string} options.source - Source identifier for embeddings (default: 'embedding_service')
   * @returns {Map|Object} Map of text -> embedding, or {embeddings: Map, ids: Map} if returnIds is true
   */
  async batchEmbed(texts, vectorStore = null, options = {}) {
    const { returnIds = false, source = 'embedding_service' } = options;
    const results = new Map();
    const ids = new Map();
    const toProcess = [];

    // Check caches first
    for (const text of texts) {
      if (!text || typeof text !== 'string' || text.trim() === '') {
        results.set(text, null);
        if (returnIds) ids.set(text, null);
        continue;
      }

      const hash = this.generateHash(text);

      // Check session cache first
      if (this.sessionCache.has(hash)) {
        results.set(text, this.sessionCache.get(hash));
        if (returnIds) ids.set(text, null); // Session cache doesn't have IDs
        continue;
      }

      // Check vector store cache if available
      if (vectorStore) {
        try {
          const cached = await vectorStore.getEmbedding(hash);
          if (cached) {
            this.sessionCache.set(hash, cached.embedding); // Update session cache
            results.set(text, cached.embedding);
            if (returnIds) ids.set(text, cached.id);
            continue;
          }
        } catch (err) {
          console.warn('Vector store cache check failed:', err.message);
        }
      }

      // Not cached, needs processing
      toProcess.push({ text, hash });
    }

    // Process uncached texts in batches
    if (toProcess.length > 0) {
      console.log(`[EmbeddingService] Processing ${toProcess.length} uncached texts in batches of ${this.batchSize}`);

      for (let i = 0; i < toProcess.length; i += this.batchSize) {
        const batch = toProcess.slice(i, i + this.batchSize);
        console.log(`[EmbeddingService] Processing batch ${Math.floor(i/this.batchSize) + 1}/${Math.ceil(toProcess.length/this.batchSize)} (${batch.length} texts)`);

        // Process batch concurrently
        const batchPromises = batch.map(async ({ text, hash }) => {
          try {
            const embedding = await this.callOllamaEmbedding(text);
            results.set(text, embedding);

            // Cache in session
            this.sessionCache.set(hash, embedding);

            // Store in vector store if available
            let storeResult = null;
            if (vectorStore) {
              try {
                const safeType = this.normalizeEmbeddingType('text'); // 'text' -> 'row'
                storeResult = await vectorStore.storeEmbedding(text, embedding, safeType, source);
                if (returnIds) ids.set(text, storeResult.id);
              } catch (storeErr) {
                console.warn('Failed to store embedding in vector store:', storeErr.message);
              }
            }

            return { text, success: true };
          } catch (err) {
            console.error(`Failed to embed text: "${text.substring(0, 50)}..."`, err.message);
            results.set(text, null);
            if (returnIds) ids.set(text, null);
            return { text, success: false, error: err.message };
          }
        });

        await Promise.all(batchPromises);
      }
    }

    console.log(`[EmbeddingService] Completed embedding ${texts.length} texts (${results.size} results)`);

    if (returnIds) {
      return { embeddings: results, ids };
    }
    return results;
  }

  /**
   * Embed single text with caching
   */
  async embedText(text, vectorStore = null) {
    if (!text || typeof text !== 'string' || text.trim() === '') {
      return null;
    }

    const results = await this.batchEmbed([text], vectorStore);
    return results.get(text);
  }

  /**
   * Clear session cache (useful for memory management)
   */
  clearSessionCache() {
    this.sessionCache.clear();
    console.log('[EmbeddingService] Session cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      sessionCacheSize: this.sessionCache.size,
      model: this.model,
      port: this.port,
      batchSize: this.batchSize
    };
  }
}

module.exports = EmbeddingService;

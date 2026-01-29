/**
 * Ollama Client - Handles all HTTP communication with Ollama server
 * This is the lowest-level service that only makes HTTP calls
 */

const http = require('http');

class OllamaClient {
  constructor(options = {}) {
    this.port = options.port || 11434;
    this.keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
  }

  /**
   * Generate response using Ollama
   * @param {string} prompt - The prompt to send to Ollama
   * @param {string} model - Model to use (default: qwen3:4b-instruct)
   * @param {Object} options - Additional options
   * @returns {string} Generated response
   */
  async callOllama(prompt, model = 'qwen3:4b-instruct', options = {}) {
    try {
      const port = options.port || this.port;
      const timeoutMs = options.timeoutMs !== undefined ? options.timeoutMs : false; // Infinite timeout by default
      const useStream = options.stream === true;

      console.log(`[OllamaClient] Generating response with model: ${model}, port: ${port}, stream: ${useStream}`);

      const payload = {
        model,
        prompt,
        stream: useStream
      };

      const data = JSON.stringify(payload);

      const response = await this.makeHttpRequest(data, port, timeoutMs, useStream);

      return response;

    } catch (error) {
      console.error('[OllamaClient callOllama Error]:', error);
      throw new Error(`Generation failed: ${error.message}`);
    }
  }

  /**
   * Cached version of callOllama
   */
  async callOllamaCached(prompt, model = 'qwen3:4b-instruct', opts = {}) {
    const key = `${model}|${typeof prompt === 'string' ? prompt : JSON.stringify(prompt)}`;
    if (this.aiCache.has(key)) {
      console.log('[OllamaClient callOllamaCached] cache hit for key length=%d', key.length);
      return this.aiCache.get(key);
    }
    const res = await this.callOllama(prompt, model, opts);
    this.aiCache.set(key, res);
    return res;
  }

  /**
   * Generate embeddings using Ollama
   * @param {string} text - Text to embed
   * @param {string} model - Embedding model (default: nomic-embed-text)
   * @param {Object} options - Additional options
   * @returns {Array} Embedding vector
   */
  async callOllamaEmbeddings(text, model = 'nomic-embed-text', options = {}) {
    const port = options.port || this.port;
    const timeoutMs = options.timeoutMs !== undefined ? options.timeoutMs : 30 * 1000; // 30s for embeddings

    return new Promise((resolve, reject) => {
      try {
        const payload = { model, prompt: text };
        const data = JSON.stringify(payload);

        console.log('[OllamaClient callOllamaEmbeddings] port=%d model=%s textLen=%d', port, model, text.length);

        const options_req = {
          hostname: '127.0.0.1',
          port,
          path: '/api/embeddings',
          method: 'POST',
          agent: this.keepAliveAgent,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            'Connection': 'keep-alive'
          }
        };

        const req = http.request(options_req, (res) => {
          res.setEncoding('utf8');

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

        if (timeoutMs !== false && timeoutMs !== 0) {
          req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`Embedding timeout after ${timeoutMs} ms`));
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
   * Make HTTP request to Ollama
   * @param {string} data - JSON payload
   * @param {number} port - Ollama port
   * @param {number} timeoutMs - Timeout in milliseconds
   * @param {boolean} useStream - Whether to use streaming
   * @returns {string} Response from Ollama
   */
  makeHttpRequest(data, port, timeoutMs, useStream) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
        port,
        path: '/api/generate',
        method: 'POST',
        agent: this.keepAliveAgent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'Connection': 'keep-alive'
        }
      };

      const req = http.request(options, (res) => {
        res.setEncoding('utf8');

        if (!useStream) {
          // Non-streaming response
          let raw = '';
          res.on('data', (chunk) => raw += chunk);
          res.on('end', () => {
            if (!raw) return reject(new Error(`Empty response from Ollama (status ${res.statusCode})`));
            try {
              const json = JSON.parse(raw);
              if (res.statusCode >= 200 && res.statusCode < 300 && json.response) {
                resolve(json.response);
              } else {
                reject(new Error(`Ollama generation failed: ${JSON.stringify(json)}`));
              }
            } catch (err) {
              reject(new Error('Failed to parse Ollama response: ' + err.message));
            }
          });
        } else {
          // Streaming response - safer handling for partial chunks
          let body = '';
          res.on('data', (chunk) => {
            body += chunk.toString();
          });

          res.on('end', () => {
            try {
              // Try to parse as JSON first
              const parsed = JSON.parse(body);
              resolve(parsed.response || parsed.message || parsed.output || body);
            } catch {
              // If JSON parsing fails, return the raw body
              resolve(body);
            }
          });
        }
      });

      if (timeoutMs !== false && timeoutMs !== 0) {
        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error(`Client timeout after ${timeoutMs} ms`));
        });
      }

      req.on('error', (err) => {
        reject(new Error('Failed to connect to Ollama: ' + (err && err.message)));
      });

      req.write(data);
      req.end();
    });
  }

  /**
   * Test Ollama connection
   * @param {number} port - Port to test
   * @returns {boolean} True if connected
   */
  async testConnection(port = this.port) {
    try {
      const response = await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/api/tags`, (res) => {
          resolve(res.statusCode === 200);
        });

        req.on('error', () => resolve(false));
        req.setTimeout(5000, () => {
          req.destroy();
          resolve(false);
        });
      });

      return response;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get available models from Ollama
   * @param {number} port - Ollama port
   * @returns {Array} List of available models
   */
  async getAvailableModels(port = this.port) {
    try {
      const response = await new Promise((resolve, reject) => {
        const options = {
          hostname: '127.0.0.1',
          port,
          path: '/api/tags',
          method: 'GET',
          agent: this.keepAliveAgent,
          headers: {
            'Connection': 'keep-alive'
          }
        };

        const req = http.request(options, (res) => {
          let raw = '';
          res.setEncoding('utf8');

          res.on('data', (chunk) => raw += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(raw);
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve(json);
              } else {
                reject(new Error(`Ollama tags failed: ${JSON.stringify(json)}`));
              }
            } catch (err) {
              reject(new Error('Failed to parse Ollama tags response'));
            }
          });
        });

        req.on('error', (err) => {
          reject(new Error('Failed to connect to Ollama for models'));
        });

        req.setTimeout(10000, () => {
          req.destroy(new Error('Timeout getting models'));
        });

        req.end();
      });

      return response.models ? response.models.map(m => m.name) : [];
    } catch (error) {
      console.error('[OllamaClient getAvailableModels Error]:', error);
      return [];
    }
  }

  /**
   * Cleanup HTTP agent to prevent memory leaks
   */
  cleanup() {
    if (this.keepAliveAgent) {
      this.keepAliveAgent.destroy();
      console.log('[OllamaClient] HTTP agent destroyed');
    }
  }
}

// Create a singleton instance
const ollamaClient = new OllamaClient();

// Cache for identical prompts (moved to class instance)
ollamaClient.aiCache = new Map();

module.exports = ollamaClient;
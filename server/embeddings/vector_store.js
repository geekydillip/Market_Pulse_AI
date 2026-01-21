/**
 * Vector Store - SQLite-based storage for embeddings with metadata
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { SIMILARITY_THRESHOLDS, EMBEDDING_TYPES, validateThreshold } = require('./similarity_config');

class VectorStore {
  constructor(dbPath = null) {
    this.dbPath = dbPath || path.join(__dirname, '..', 'embeddings.db');
    this.db = null;
    this.initialized = false;
  }

  /**
   * Initialize the database and create tables
   */
  async init() {
    return new Promise((resolve, reject) => {
      // Ensure directory exists
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('Failed to open SQLite database:', err.message);
          reject(err);
          return;
        }

        console.log('[VectorStore] Connected to SQLite database at:', this.dbPath);

        // Create embeddings table
        const createTableSQL = `
          CREATE TABLE IF NOT EXISTS embeddings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hash TEXT UNIQUE NOT NULL,
            text TEXT NOT NULL,
            embedding TEXT NOT NULL, -- JSON string of embedding vector
            type TEXT NOT NULL, -- 'row', 'module', 'sub_module', 'issue_type', 'sub_issue_type'
            source TEXT NOT NULL, -- processor name or 'embedding_service'
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            metadata TEXT -- JSON string for additional metadata
          );

          CREATE INDEX IF NOT EXISTS idx_hash ON embeddings(hash);
          CREATE INDEX IF NOT EXISTS idx_type ON embeddings(type);
          CREATE INDEX IF NOT EXISTS idx_source ON embeddings(source);
          CREATE INDEX IF NOT EXISTS idx_timestamp ON embeddings(timestamp);
        `;

        this.db.exec(createTableSQL, (err) => {
          if (err) {
            console.error('Failed to create embeddings table:', err.message);
            reject(err);
            return;
          }

          this.initialized = true;
          console.log('[VectorStore] Database initialized successfully');
          resolve();
        });
      });
    });
  }

  /**
   * Generate hash for text (consistent with EmbeddingService)
   */
  generateHash(text) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  /**
   * Store an embedding with enforced type validation and discovery mode metadata
   */
  async storeEmbedding(text, embedding, type = 'text', source = 'unknown', metadata = null) {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized. Call init() first.');
    }

    // Fix 2: Enforce embedding type validation
    const ALLOWED_TYPES = ['row', 'module', 'sub_module', 'issue_type', 'sub_issue_type'];
    if (!ALLOWED_TYPES.includes(type)) {
      throw new Error(`Invalid embedding type: ${type}. Allowed: ${ALLOWED_TYPES.join(', ')}`);
    }

    return new Promise((resolve, reject) => {
      const hash = this.generateHash(text);
      const embeddingJson = JSON.stringify(embedding);

      // Fix 1: Add explicit discovery mode metadata
      const enhancedMetadata = {
        mode: 'discovery', // Explicit discovery mode flag
        processor: source,
        prompt_version: 'v1',
        ...metadata // Preserve any additional metadata
      };
      const metadataJson = JSON.stringify(enhancedMetadata);

      const sql = `
        INSERT OR REPLACE INTO embeddings (hash, text, embedding, type, source, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `;

      this.db.run(sql, [hash, text, embeddingJson, type, source, metadataJson], function(err) {
        if (err) {
          console.error('Failed to store embedding:', err.message);
          reject(err);
          return;
        }

        console.log(`[VectorStore] Stored embedding: ${type} from ${source} (${text.substring(0, 50)}...)`);
        resolve({ id: this.lastID, hash });
      });
    });
  }

  /**
   * Get an embedding by hash
   */
  async getEmbedding(hash) {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized. Call init() first.');
    }

    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM embeddings WHERE hash = ?';

      this.db.get(sql, [hash], (err, row) => {
        if (err) {
          reject(err);
          return;
        }

        if (!row) {
          resolve(null);
          return;
        }

        // Parse embedding JSON
        let embedding;
        try {
          embedding = JSON.parse(row.embedding);
        } catch (parseErr) {
          console.warn('Failed to parse embedding JSON:', parseErr.message);
          embedding = null;
        }

        resolve({
          id: row.id,
          hash: row.hash,
          text: row.text,
          embedding: embedding,
          type: row.type,
          source: row.source,
          timestamp: row.timestamp,
          metadata: row.metadata ? JSON.parse(row.metadata) : null
        });
      });
    });
  }

  /**
   * Get multiple embeddings by hashes
   */
  async getMultipleEmbeddings(hashes) {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized. Call init() first.');
    }

    if (!Array.isArray(hashes) || hashes.length === 0) {
      return new Map();
    }

    return new Promise((resolve, reject) => {
      const placeholders = hashes.map(() => '?').join(',');
      const sql = `SELECT * FROM embeddings WHERE hash IN (${placeholders})`;

      this.db.all(sql, hashes, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        const results = new Map();

        for (const row of rows) {
          let embedding;
          try {
            embedding = JSON.parse(row.embedding);
          } catch (parseErr) {
            console.warn('Failed to parse embedding JSON:', parseErr.message);
            embedding = null;
          }

          results.set(row.hash, {
            id: row.id,
            hash: row.hash,
            text: row.text,
            embedding: embedding,
            type: row.type,
            source: row.source,
            timestamp: row.timestamp,
            metadata: row.metadata ? JSON.parse(row.metadata) : null
          });
        }

        resolve(results);
      });
    });
  }

  /**
   * Search embeddings by type
   */
  async getEmbeddingsByType(type, limit = 100, offset = 0) {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized. Call init() first.');
    }

    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM embeddings WHERE type = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?';

      this.db.all(sql, [type, limit, offset], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        const results = rows.map(row => {
          let embedding;
          try {
            embedding = JSON.parse(row.embedding);
          } catch (parseErr) {
            console.warn('Failed to parse embedding JSON:', parseErr.message);
            embedding = null;
          }

          return {
            id: row.id,
            hash: row.hash,
            text: row.text,
            embedding: embedding,
            type: row.type,
            source: row.source,
            timestamp: row.timestamp,
            metadata: row.metadata ? JSON.parse(row.metadata) : null
          };
        });

        resolve(results);
      });
    });
  }

  /**
   * Search embeddings by source
   */
  async getEmbeddingsBySource(source, limit = 100, offset = 0) {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized. Call init() first.');
    }

    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM embeddings WHERE source = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?';

      this.db.all(sql, [source, limit, offset], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        const results = rows.map(row => {
          let embedding;
          try {
            embedding = JSON.parse(row.embedding);
          } catch (parseErr) {
            console.warn('Failed to parse embedding JSON:', parseErr.message);
            embedding = null;
          }

          return {
            id: row.id,
            hash: row.hash,
            text: row.text,
            embedding: embedding,
            type: row.type,
            source: row.source,
            timestamp: row.timestamp,
            metadata: row.metadata ? JSON.parse(row.metadata) : null
          };
        });

        resolve(results);
      });
    });
  }

  /**
   * Get statistics about stored embeddings
   */
  async getStats() {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized. Call init() first.');
    }

    return new Promise((resolve, reject) => {
      const sql = `
        SELECT
          COUNT(*) as total_embeddings,
          COUNT(DISTINCT type) as unique_types,
          COUNT(DISTINCT source) as unique_sources,
          MIN(timestamp) as oldest_timestamp,
          MAX(timestamp) as newest_timestamp
        FROM embeddings
      `;

      this.db.get(sql, [], (err, stats) => {
        if (err) {
          reject(err);
          return;
        }

        // Get type breakdown
        const typeSQL = 'SELECT type, COUNT(*) as count FROM embeddings GROUP BY type';
        this.db.all(typeSQL, [], (err, typeStats) => {
          if (err) {
            reject(err);
            return;
          }

          // Get source breakdown
          const sourceSQL = 'SELECT source, COUNT(*) as count FROM embeddings GROUP BY source';
          this.db.all(sourceSQL, [], (err, sourceStats) => {
            if (err) {
              reject(err);
              return;
            }

            resolve({
              total_embeddings: stats.total_embeddings || 0,
              unique_types: stats.unique_types || 0,
              unique_sources: stats.unique_sources || 0,
              oldest_timestamp: stats.oldest_timestamp,
              newest_timestamp: stats.newest_timestamp,
              type_breakdown: typeStats || [],
              source_breakdown: sourceStats || []
            });
          });
        });
      });
    });
  }

  /**
   * Clean up old embeddings (optional maintenance)
   */
  async cleanupOldEmbeddings(daysOld = 30) {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized. Call init() first.');
    }

    return new Promise((resolve, reject) => {
      const sql = "DELETE FROM embeddings WHERE timestamp < datetime('now', '-? days')";

      this.db.run(sql, [daysOld], function(err) {
        if (err) {
          reject(err);
          return;
        }

        console.log(`[VectorStore] Cleaned up ${this.changes} old embeddings (${daysOld} days old)`);
        resolve({ deleted: this.changes });
      });
    });
  }

  /**
   * Fix 3: Find similar embeddings using cosine similarity
   * @param {Array<number>} targetEmbedding - The embedding to find similar items for
   * @param {string} typeFilter - Optional type filter ('row', 'module', etc.)
   * @param {number} topK - Number of similar items to return
   * @param {number} minSimilarity - Minimum similarity threshold (0-1)
   * @returns {Array} Similar embeddings with similarity scores
   */
  async findSimilarEmbeddings(targetEmbedding, typeFilter = null, topK = 5, minSimilarity = 0.0) {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized. Call init() first.');
    }

    if (!Array.isArray(targetEmbedding) || targetEmbedding.length === 0) {
      throw new Error('Target embedding must be a non-empty array');
    }

    return new Promise((resolve, reject) => {
      // Build query with optional type filter
      let sql = 'SELECT * FROM embeddings';
      const params = [];

      if (typeFilter) {
        sql += ' WHERE type = ?';
        params.push(typeFilter);
      }

      sql += ' ORDER BY timestamp DESC'; // Most recent first

      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        // Calculate cosine similarity for each embedding
        const similarities = [];

        for (const row of rows) {
          try {
            const embedding = JSON.parse(row.embedding);
            if (!Array.isArray(embedding) || embedding.length !== targetEmbedding.length) {
              continue; // Skip invalid embeddings
            }

            const similarity = this.cosineSimilarity(targetEmbedding, embedding);
            if (similarity >= minSimilarity) {
              similarities.push({
                id: row.id,
                hash: row.hash,
                text: row.text,
                embedding: embedding,
                type: row.type,
                source: row.source,
                timestamp: row.timestamp,
                metadata: row.metadata ? JSON.parse(row.metadata) : null,
                similarity: similarity
              });
            }
          } catch (parseErr) {
            console.warn('Failed to parse embedding for similarity:', parseErr.message);
            continue;
          }
        }

        // Sort by similarity (descending) and return top K
        similarities.sort((a, b) => b.similarity - a.similarity);
        const results = similarities.slice(0, topK);

        console.log(`[VectorStore] Found ${results.length} similar embeddings (top ${topK}, min similarity: ${minSimilarity})`);
        resolve(results);
      });
    });
  }

  /**
   * Calculate cosine similarity between two vectors
   * @param {Array<number>} vecA
   * @param {Array<number>} vecB
   * @returns {number} Similarity score between 0 and 1
   */
  cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) {
      return 0; // Handle zero vectors
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Find duplicate embeddings based on similarity threshold
   * @param {number} similarityThreshold - Threshold above which embeddings are considered duplicates
   * @returns {Array} Groups of duplicate embeddings
   */
  async findDuplicateEmbeddings(similarityThreshold = 0.95) {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized. Call init() first.');
    }

    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM embeddings ORDER BY timestamp ASC';

      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        const duplicates = [];
        const processed = new Set();

        for (let i = 0; i < rows.length; i++) {
          if (processed.has(rows[i].id)) continue;

          const group = [rows[i]];
          processed.add(rows[i].id);

          try {
            const embeddingA = JSON.parse(rows[i].embedding);

            // Compare with all subsequent rows
            for (let j = i + 1; j < rows.length; j++) {
              if (processed.has(rows[j].id)) continue;

              try {
                const embeddingB = JSON.parse(rows[j].embedding);
                const similarity = this.cosineSimilarity(embeddingA, embeddingB);

                if (similarity >= similarityThreshold) {
                  group.push(rows[j]);
                  processed.add(rows[j].id);
                }
              } catch (parseErr) {
                continue;
              }
            }

            if (group.length > 1) {
              duplicates.push(group);
            }
          } catch (parseErr) {
            continue;
          }
        }

        console.log(`[VectorStore] Found ${duplicates.length} duplicate groups (threshold: ${similarityThreshold})`);
        resolve(duplicates);
      });
    });
  }

  /**
   * Get embeddings by discovery mode (Fix 1 validation)
   * @param {string} mode - 'discovery' or 'restricted'
   * @returns {Array} Embeddings filtered by mode
   */
  async getEmbeddingsByMode(mode = 'discovery', limit = 100) {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized. Call init() first.');
    }

    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM embeddings ORDER BY timestamp DESC LIMIT ?';

      this.db.all(sql, [limit], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        // Filter by mode in metadata
        const filteredRows = rows.filter(row => {
          try {
            const metadata = row.metadata ? JSON.parse(row.metadata) : {};
            return metadata.mode === mode;
          } catch (parseErr) {
            return false;
          }
        });

        const results = filteredRows.map(row => {
          let embedding;
          try {
            embedding = JSON.parse(row.embedding);
          } catch (parseErr) {
            console.warn('Failed to parse embedding JSON:', parseErr.message);
            embedding = null;
          }

          return {
            id: row.id,
            hash: row.hash,
            text: row.text,
            embedding: embedding,
            type: row.type,
            source: row.source,
            timestamp: row.timestamp,
            metadata: row.metadata ? JSON.parse(row.metadata) : null
          };
        });

        console.log(`[VectorStore] Found ${results.length} embeddings in ${mode} mode`);
        resolve(results);
      });
    });
  }

  /**
   * Close the database connection
   */
  close() {
    if (this.db) {
      this.db.close((err) => {
        if (err) {
          console.error('Error closing database:', err.message);
        } else {
          console.log('[VectorStore] Database connection closed');
        }
      });
    }
  }
}

module.exports = VectorStore;

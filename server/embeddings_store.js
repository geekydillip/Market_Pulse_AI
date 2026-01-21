const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

class EmbeddingsStore {
  constructor(dbPath = null) {
    this.dbPath = dbPath || path.join(__dirname, 'embeddings.db');
    this.db = null;
    this.initPromise = null;
  }

  async init() {
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('Failed to open embeddings database:', err);
          reject(err);
          return;
        }

        // Create tables with full schema
        const createTables = async () => {
          try {
            // Create table with full schema matching vector_store
            const createSql = `
              CREATE TABLE IF NOT EXISTS embeddings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hash TEXT UNIQUE NOT NULL,
                text TEXT NOT NULL,
                embedding TEXT NOT NULL,
                type TEXT NOT NULL,
                source TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                metadata TEXT
              );
            `;
            await this.runSql(createSql);

            // Create indexes
            const indexSql = `
              CREATE INDEX IF NOT EXISTS idx_hash ON embeddings(hash);
              CREATE INDEX IF NOT EXISTS idx_type ON embeddings(type);
              CREATE INDEX IF NOT EXISTS idx_source ON embeddings(source);
              CREATE INDEX IF NOT EXISTS idx_timestamp ON embeddings(timestamp);
            `;
            await this.runSql(indexSql);

            console.log('✅ Embeddings database initialized');
            resolve();
          } catch (err) {
            console.error('Failed to initialize embeddings database:', err);
            reject(err);
          }
        };

        createTables();
      });
    });

    return this.initPromise;
  }

  // Helper method to run SQL with promises
  runSql(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  async close() {
    if (this.db) {
      return new Promise((resolve) => {
        this.db.close((err) => {
          if (err) console.warn('Error closing embeddings DB:', err);
          resolve();
        });
      });
    }
  }

  generateHash(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  async storeEmbedding(text, embedding, model = 'nomic-embed-text') {
    await this.init();

    return new Promise((resolve, reject) => {
      const textHash = this.generateHash(text);
      const embeddingJson = JSON.stringify(embedding);
      const metadataJson = JSON.stringify({ model }); // Store model in metadata

      const sql = `
        INSERT OR REPLACE INTO embeddings (hash, text, embedding, type, source, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `;

      this.db.run(sql, [textHash, text, embeddingJson, 'text', 'embeddings_store', metadataJson], function(err) {
        if (err) {
          console.error('Failed to store embedding:', err);
          reject(err);
        } else {
          console.log(`✅ Stored embedding for hash: ${textHash.substring(0, 8)}...`);
          resolve({ id: this.lastID, hash: textHash });
        }
      });
    });
  }

  async getEmbedding(text, model = 'nomic-embed-text') {
    await this.init();

    return new Promise((resolve, reject) => {
      const textHash = this.generateHash(text);

      const sql = `
        SELECT embedding, text FROM embeddings
        WHERE hash = ?
      `;

      this.db.get(sql, [textHash], (err, row) => {
        if (err) {
          console.error('Failed to get embedding:', err);
          reject(err);
        } else if (row) {
          try {
            const embedding = JSON.parse(row.embedding);
            console.log(`📋 Cache hit for embedding: ${textHash.substring(0, 8)}...`);
            resolve({ embedding, text: row.text });
          } catch (parseErr) {
            console.warn('Failed to parse cached embedding:', parseErr);
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
    });
  }

  async getMultipleEmbeddings(texts, model = 'nomic-embed-text') {
    await this.init();

    const hashes = texts.map(text => this.generateHash(text));
    const placeholders = hashes.map(() => '?').join(',');

    return new Promise((resolve, reject) => {
      const sql = `
        SELECT hash, embedding, text FROM embeddings
        WHERE hash IN (${placeholders})
      `;

      this.db.all(sql, hashes, (err, rows) => {
        if (err) {
          console.error('Failed to get multiple embeddings:', err);
          reject(err);
        } else {
          const result = new Map();
          rows.forEach(row => {
            try {
              result.set(row.hash, {
                embedding: JSON.parse(row.embedding),
                text: row.text
              });
            } catch (parseErr) {
              console.warn('Failed to parse cached embedding for hash:', row.hash);
            }
          });
          resolve(result);
        }
      });
    });
  }

  async getStats() {
    await this.init();

    return new Promise((resolve, reject) => {
      const sql = `
        SELECT
          COUNT(*) as total_embeddings,
          COUNT(DISTINCT type) as unique_types,
          type,
          COUNT(*) as count_per_type
        FROM embeddings
        GROUP BY type
      `;

      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const stats = {
            total_embeddings: 0,
            types: {}
          };

          rows.forEach(row => {
            stats.total_embeddings += row.total_embeddings;
            stats.types[row.type] = row.count_per_type;
          });

          resolve(stats);
        }
      });
    });
  }
}

// Export singleton instance
const embeddingsStore = new EmbeddingsStore();

module.exports = embeddingsStore;

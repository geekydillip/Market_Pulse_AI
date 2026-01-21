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

        // Create tables
        const sql = `
          CREATE TABLE IF NOT EXISTS embeddings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text_hash TEXT UNIQUE NOT NULL,
            text_content TEXT NOT NULL,
            embedding TEXT NOT NULL,
            model TEXT NOT NULL DEFAULT 'nomic-embed-text',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );

          CREATE INDEX IF NOT EXISTS idx_text_hash ON embeddings(text_hash);
          CREATE INDEX IF NOT EXISTS idx_model ON embeddings(model);
        `;

        this.db.exec(sql, (err) => {
          if (err) {
            console.error('Failed to create embeddings table:', err);
            reject(err);
          } else {
            console.log('✅ Embeddings database initialized');
            resolve();
          }
        });
      });
    });

    return this.initPromise;
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

      const sql = `
        INSERT OR REPLACE INTO embeddings (text_hash, text_content, embedding, model)
        VALUES (?, ?, ?, ?)
      `;

      this.db.run(sql, [textHash, text, embeddingJson, model], function(err) {
        if (err) {
          console.error('Failed to store embedding:', err);
          reject(err);
        } else {
          console.log(`✅ Stored embedding for text hash: ${textHash.substring(0, 8)}...`);
          resolve({ id: this.lastID, textHash });
        }
      });
    });
  }

  async getEmbedding(text, model = 'nomic-embed-text') {
    await this.init();

    return new Promise((resolve, reject) => {
      const textHash = this.generateHash(text);

      const sql = `
        SELECT embedding, text_content FROM embeddings
        WHERE text_hash = ? AND model = ?
      `;

      this.db.get(sql, [textHash, model], (err, row) => {
        if (err) {
          console.error('Failed to get embedding:', err);
          reject(err);
        } else if (row) {
          try {
            const embedding = JSON.parse(row.embedding);
            console.log(`📋 Cache hit for embedding: ${textHash.substring(0, 8)}...`);
            resolve({ embedding, text: row.text_content });
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
    const params = [...hashes, model];

    return new Promise((resolve, reject) => {
      const sql = `
        SELECT text_hash, embedding, text_content FROM embeddings
        WHERE text_hash IN (${placeholders}) AND model = ?
      `;

      this.db.all(sql, params, (err, rows) => {
        if (err) {
          console.error('Failed to get multiple embeddings:', err);
          reject(err);
        } else {
          const result = new Map();
          rows.forEach(row => {
            try {
              result.set(row.text_hash, {
                embedding: JSON.parse(row.embedding),
                text: row.text_content
              });
            } catch (parseErr) {
              console.warn('Failed to parse cached embedding for hash:', row.text_hash);
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
          COUNT(DISTINCT model) as unique_models,
          model,
          COUNT(*) as count_per_model
        FROM embeddings
        GROUP BY model
      `;

      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const stats = {
            total_embeddings: 0,
            models: {}
          };

          rows.forEach(row => {
            stats.total_embeddings += row.total_embeddings;
            stats.models[row.model] = row.count_per_model;
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

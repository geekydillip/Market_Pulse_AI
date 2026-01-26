const axios = require('axios');
const path = require('path');

/**
 * RAG Client for Node.js applications
 * Provides a clean interface to interact with the Python RAG service
 */
class RAGClient {
  constructor(baseUrl = 'http://localhost:8000') {
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000, // 30 second timeout
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Check if the RAG service is available
   */
  async isAvailable() {
    try {
      const response = await this.client.get('/health');
      return response.data.status === 'healthy';
    } catch (error) {
      console.warn('[RAG] Service not available:', error.message);
      return false;
    }
  }

  /**
   * Initialize the RAG service with embeddings
   */
  async initialize() {
    try {
      const response = await this.client.post('/initialize');
      return response.data;
    } catch (error) {
      throw new Error(`RAG initialization failed: ${error.message}`);
    }
  }

  /**
   * Query the RAG service for relevant context
   */
  async query(text, top_k = 5) {
    try {
      const response = await this.client.post('/query', {
        text,
        top_k
      });
      return response.data;
    } catch (error) {
      throw new Error(`RAG query failed: ${error.message}`);
    }
  }

  /**
   * Add new documents to the RAG index
   */
  async addDocuments(documents) {
    try {
      const response = await this.client.post('/add_documents', {
        documents
      });
      return response.data;
    } catch (error) {
      throw new Error(`RAG add documents failed: ${error.message}`);
    }
  }

  /**
   * Get RAG context for a specific processor and row
   */
  async getContext(processor, rowData) {
    try {
      const response = await this.client.post('/get_context', {
        processor,
        rowData
      });
      return response.data;
    } catch (error) {
      throw new Error(`RAG get context failed: ${error.message}`);
    }
  }
}

module.exports = RAGClient;
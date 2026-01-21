/**
 * Retriever - Vector retrieval logic for RAG
 */

const VectorStore = require('../embeddings/vector_store');
const EmbeddingService = require('../embeddings/embedding_service');

class Retriever {
  constructor(vectorStore = null, embeddingService = null) {
    this.vectorStore = vectorStore;
    this.embeddingService = embeddingService;
  }

  /**
   * Initialize the retriever with required services
   */
  async init(vectorStore, embeddingService) {
    this.vectorStore = vectorStore;
    this.embeddingService = embeddingService;
  }

  /**
   * Retrieve relevant documents for a query with efficient top-K filtering
   * @param {string} query - The search query
   * @param {number} limit - Maximum number of documents to retrieve (topK)
   * @param {number} minSimilarity - Minimum similarity threshold
   * @returns {Array} Array of relevant documents with metadata
   */
  async retrieve(query, limit = 8, minSimilarity = 0.55) {
    try {
      if (!this.vectorStore || !this.embeddingService) {
        throw new Error('Retriever not initialized. Call init() first.');
      }

      console.log(`[Retriever] Processing query: "${query.substring(0, 50)}..." with topK=${limit}, minSimilarity=${minSimilarity}`);

      // Expand query for better embedding quality (lightweight context addition)
      const expandedQuery = `User reported issue: ${query}

Find similar historical issues and technical problems in the database.`;
      console.log(`[Retriever] Expanded query for better embedding: "${expandedQuery.substring(0, 80)}..."`);

      // Generate embedding for the expanded query
      const queryEmbeddings = await this.embeddingService.batchEmbed([expandedQuery], this.vectorStore);
      const queryEmbedding = queryEmbeddings.get(expandedQuery);

      if (!queryEmbedding) {
        console.warn('[Retriever] Failed to generate embedding for query');
        return [];
      }

      // Use VectorStore's efficient findSimilarEmbeddings method with topK filtering
      // Filter to only 'discovery' type embeddings to prevent noise from other types
      const similarEmbeddings = await this.vectorStore.findSimilarEmbeddings(
        queryEmbedding,
        'discovery', // Only search discovery type embeddings
        limit,
        minSimilarity
      );

      // Format results for RAG context
      const results = similarEmbeddings.map(embedding => ({
        id: embedding.id,
        text: embedding.text,
        type: embedding.type,
        source: embedding.source,
        similarity: embedding.similarity,
        metadata: embedding.metadata,
        timestamp: embedding.timestamp
      }));

      console.log(`[Retriever] Found ${results.length} relevant documents (filtered to top ${limit})`);
      return results;

    } catch (error) {
      console.error('[Retriever Error]:', error);
      throw new Error(`Retrieval failed: ${error.message}`);
    }
  }

  /**
   * Retrieve documents by type filter
   * @param {string} query - The search query
   * @param {string} type - Type filter ('row', 'module', 'issue_type', etc.)
   * @param {number} limit - Maximum number of documents to retrieve
   * @returns {Array} Filtered relevant documents
   */
  async retrieveByType(query, type, limit = 5) {
    try {
      if (!this.vectorStore || !this.embeddingService) {
        throw new Error('Retriever not initialized. Call init() first.');
      }

      const queryEmbeddings = await this.embeddingService.batchEmbed([query], this.vectorStore);
      const queryEmbedding = queryEmbeddings.get(query);

      if (!queryEmbedding) {
        return [];
      }

      const similarEmbeddings = await this.vectorStore.findSimilarEmbeddings(
        queryEmbedding,
        type,
        limit,
        0.7 // Default similarity threshold
      );

      return similarEmbeddings.map(embedding => ({
        id: embedding.id,
        text: embedding.text,
        type: embedding.type,
        source: embedding.source,
        similarity: embedding.similarity,
        metadata: embedding.metadata,
        timestamp: embedding.timestamp
      }));

    } catch (error) {
      console.error('[Retriever retrieveByType Error]:', error);
      throw error;
    }
  }

  /**
   * Get retriever statistics
   */
  async getStats() {
    if (!this.vectorStore) {
      return { error: 'VectorStore not initialized' };
    }

    return await this.vectorStore.getStats();
  }
}

module.exports = Retriever;

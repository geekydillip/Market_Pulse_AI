/**
 * Retriever - Vector retrieval logic for RAG
 */

const VectorStore = require('../embeddings/vector_store');
const EmbeddingService = require('../embeddings/embedding_service');

class Retriever {
  constructor(vectorStore = null, embeddingService = null) {
    this.vectorStore = vectorStore;
    this.embeddingService = embeddingService;
    
    // Phase 2A: Type-based filtering and source affinity
    this.typeBias = {
      code: 0.02,
      doc: 0.01,
      excel_row: 0.01
    };
    
    this.sourceAffinity = 0.03;
    this.hardTypeFilter = null; // Optional: 'code' | 'excel_row' | 'doc'
    
    // Phase 2B: Profile-based re-ranking
    this.RE_RANKING_PROFILES = {
      default: {
        similarity: 0.70,    // Enforced minimum
        typeBias: 0.10,
        sourceAffinity: 0.10,
        recency: 0.10
      },
      code_focused: {
        similarity: 0.65,    // Slightly lower for code precision
        typeBias: 0.15,      // Higher code bias
        sourceAffinity: 0.15, // Higher same-file affinity
        recency: 0.05        // Lower recency for stable code
      },
      analytics_focused: {
        similarity: 0.70,
        typeBias: 0.05,      // Lower type bias for mixed content
        sourceAffinity: 0.10,
        recency: 0.15        // Higher recency for fresh analytics
      }
    };
    
    this.reRankingProfile = 'default';
    this.recencyEnabled = false;
    this.sameFileBoost = 0.04;
    this.recencyHalfLife = 30; // Days
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
   * @param {number} minSimilarity - Minimum similarity threshold (default 0.75 for quality)
   * @returns {Array} Array of relevant documents with metadata
   */
  async retrieve(query, limit = 8, minSimilarity = 0.75) {
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

      // Apply Phase 2A: Soft type bias (Refinement 1: Similarity floor already applied)
      const typeBiasedResults = similarEmbeddings.map(embedding => {
        let biasedSimilarity = embedding.similarity;

        // Apply soft type bias (never exceed 0.05 absolute boost)
        if (this.typeBias[embedding.type]) {
          biasedSimilarity += this.typeBias[embedding.type];
        }

        // Apply hard type filtering if enabled
        if (this.hardTypeFilter && embedding.type !== this.hardTypeFilter) {
          return null; // Filter out non-matching types
        }

        // Ensure similarity stays within bounds
        biasedSimilarity = Math.min(Math.max(biasedSimilarity, 0), 1);

        return {
          id: embedding.id,
          text: embedding.text,
          type: embedding.type,
          source: embedding.source,
          similarity: embedding.similarity,
          biasedSimilarity: biasedSimilarity,
          metadata: embedding.metadata,
          timestamp: embedding.timestamp
        };
      }).filter(result => result !== null); // Remove filtered results

      // Apply source affinity (post-top-K as per Refinement 2)
      const topKResults = typeBiasedResults
        .sort((a, b) => b.biasedSimilarity - a.biasedSimilarity)
        .slice(0, limit);

      // Apply Phase 2B re-ranking with all safety constraints
      const phase2BResults = this.applyPhase2BReRanking(topKResults);

      const results = phase2BResults.map(embedding => ({
          id: embedding.id,
          text: embedding.text,
          type: embedding.type,
          source: embedding.source,
          similarity: embedding.finalScore, // Use final re-ranked score
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

  /**
   * Detect source hints from query (Phase 2A: Query hint detection)
   * @param {string} query - The search query
   * @returns {Object} Detected hints and suggested configuration
   */
  detectQueryHints(query) {
    const hints = {
      suggestedType: null,
      suggestedSource: null,
      confidence: 0
    };

    if (!query || typeof query !== 'string') {
      return hints;
    }

    const queryLower = query.toLowerCase();

    // Safe keyword patterns for type detection
    const typePatterns = {
      code: ['function', 'method', 'class', 'variable', 'error', 'exception', 'bug', 'crash'],
      doc: ['documentation', 'spec', 'requirement', 'specification', 'guide'],
      excel_row: ['excel', 'spreadsheet', 'row', 'column', 'cell', 'data', 'analytics']
    };

    // File extension patterns
    const fileExtensions = ['.py', '.js', '.java', '.c', '.cpp', '.cs', '.php', '.rb', '.go', '.rust'];

    // Check for file extensions
    for (const ext of fileExtensions) {
      if (queryLower.includes(ext)) {
        hints.suggestedType = 'code';
        hints.confidence = Math.max(hints.confidence, 0.8);
        break;
      }
    }

    // Check for type patterns
    for (const [type, patterns] of Object.entries(typePatterns)) {
      const matches = patterns.filter(pattern => queryLower.includes(pattern));
      if (matches.length > 0) {
        const confidence = Math.min(0.6, matches.length * 0.1);
        if (confidence > hints.confidence) {
          hints.suggestedType = type;
          hints.confidence = confidence;
        }
      }
    }

    // Check for explicit source mentions
    const sourcePatterns = ['analytics', 'logs', 'voc', 'plm', 'beta'];
    for (const source of sourcePatterns) {
      if (queryLower.includes(source)) {
        hints.suggestedSource = source;
        hints.confidence = Math.max(hints.confidence, 0.7);
      }
    }

    return hints;
  }

  /**
   * Set hard type filter for this retriever instance
   * @param {string|null} type - Type to filter by, or null to disable
   */
  setHardTypeFilter(type) {
    this.hardTypeFilter = type;
    console.log(`[Retriever] Hard type filter set to: ${type || 'disabled'}`);
  }

  /**
   * Set re-ranking profile for Phase 2B
   * @param {string} profile - Profile name: 'default' | 'code_focused' | 'analytics_focused'
   */
  setReRankingProfile(profile) {
    if (this.RE_RANKING_PROFILES[profile]) {
      this.reRankingProfile = profile;
      console.log(`[Retriever] Re-ranking profile set to: ${profile}`);
    } else {
      console.warn(`[Retriever] Invalid profile: ${profile}. Using default.`);
    }
  }

  /**
   * Enable/disable recency scoring (domain-limited)
   * @param {boolean} enabled - Whether to enable recency scoring
   */
  setRecencyEnabled(enabled) {
    this.recencyEnabled = enabled;
    console.log(`[Retriever] Recency scoring ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Calculate multi-factor score using selected profile
   * @param {Object} embedding - The embedding with all bias factors applied
   * @returns {number} Final re-ranked score
   */
  calculateProfileScore(embedding) {
    const profile = this.RE_RANKING_PROFILES[this.reRankingProfile];
    const factors = {
      similarity: embedding.similarity,
      typeBias: this.typeBias[embedding.type] || 0,
      sourceAffinity: this.sourceAffinity,
      recency: this.calculateRecencyScore(embedding.timestamp)
    };

    // Apply multi-factor scoring with frozen weights
    let finalScore = 0;
    for (const [factor, weight] of Object.entries(profile)) {
      finalScore += factors[factor] * weight;
    }

    // Final micro-guard: clamp score to prevent accidental stacking
    return Math.min(Math.max(finalScore, 0.0), 0.99);
  }

  /**
   * Calculate recency score based on timestamp decay
   * @param {string} timestamp - ISO timestamp string
   * @returns {number} Recency score (0.0 to 1.0)
   */
  calculateRecencyScore(timestamp) {
    if (!this.recencyEnabled || !timestamp) {
      return 0.0;
    }

    try {
      const now = new Date();
      const embedTime = new Date(timestamp);
      const daysDiff = (now - embedTime) / (1000 * 60 * 60 * 24);
      
      // Exponential decay: score = e^(-days/halfLife)
      const decay = Math.exp(-daysDiff / this.recencyHalfLife);
      return Math.max(0, Math.min(1, decay));
    } catch (error) {
      return 0.0;
    }
  }

  /**
   * Calculate same-file affinity boost (single additive application)
   * @param {Array} embeddings - All embeddings in current top-K
   * @param {Object} targetEmbedding - The embedding to boost
   * @returns {number} Same-file boost (0.0 or sameFileBoost)
   */
  calculateSameFileBoost(embeddings, targetEmbedding) {
    // Group embeddings by file/function
    const fileGroups = new Map();
    embeddings.forEach(embedding => {
      const fileKey = this.extractFileKey(embedding);
      if (fileKey) {
        fileGroups.set(fileKey, (fileGroups.get(fileKey) || 0) + 1);
      }
    });

    const targetFileKey = this.extractFileKey(targetEmbedding);
    const sameFileCount = fileGroups.get(targetFileKey) || 0;
    
    // Apply single additive boost if multiple embeddings from same file
    return sameFileCount > 1 ? this.sameFileBoost : 0.0;
  }

  /**
   * Extract file/function key for grouping
   * @param {Object} embedding - The embedding object
   * @returns {string|null} File key for grouping
   */
  extractFileKey(embedding) {
    if (!embedding.metadata) return null;
    
    // Try different metadata fields for file identification
    const fileFields = ['file', 'filename', 'filePath', 'function', 'module'];
    for (const field of fileFields) {
      if (embedding.metadata[field]) {
        return `${field}:${embedding.metadata[field]}`;
      }
    }
    return null;
  }

  /**
   * Apply Phase 2B re-ranking with all safety constraints
   * @param {Array} embeddings - Top-K embeddings from Phase 2A
   * @returns {Array} Re-ranked embeddings with final scores
   */
  applyPhase2BReRanking(embeddings) {
    // Calculate profile scores for all embeddings
    const scoredEmbeddings = embeddings.map((embedding, index) => {
      const profileScore = this.calculateProfileScore(embedding);
      const sameFileBoost = this.calculateSameFileBoost(embeddings, embedding);
      
      // Apply single additive boost (never cumulative)
      let finalScore = profileScore + sameFileBoost;
      
      // Final micro-guard: clamp score
      finalScore = Math.min(Math.max(finalScore, 0.0), 0.99);
      
      return {
        ...embedding,
        finalScore,
        originalSimilarity: embedding.similarity,
        originalRank: index
      };
    });

    // Stable sort with tie preservation (Correction 2)
    return scoredEmbeddings.sort((a, b) => {
      if (b.finalScore !== a.finalScore) {
        return b.finalScore - a.finalScore;
      }
      // Preserve original similarity order for ties
      return b.originalSimilarity - a.originalSimilarity;
    });
  }
}

module.exports = Retriever;

/**
 * RAG routes - handles RAG (Retrieval-Augmented Generation) endpoints
 * Routes are read-only consumers of pre-initialized RAG services
 */

const express = require('express');
const router = express.Router();
const { getRAG, isRAGInitialized } = require('../rag/init');

// POST /api/rag/query - Main RAG query endpoint
router.post('/query', async (req, res) => {
  const rag = getRAG();

  if (!rag) {
    return res.status(503).json({
      success: false,
      error: 'RAG services not initialized'
    });
  }

  const { retriever, promptBuilder, generator } = rag;
  const { query, context, limit = 5, model = 'qwen3:4b-instruct' } = req.body;

  // Input validation
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Query must be a non-empty string'
    });
  }

  if (typeof limit !== 'number' || limit < 1 || limit > 20) {
    return res.status(400).json({
      success: false,
      error: 'Limit must be a number between 1 and 20'
    });
  }

  try {
    console.log(`[RAG Query] Processing query: "${query.substring(0, 50)}..."`);

    // Step 1: Retrieve relevant context
    const relevantDocs = await retriever.retrieve(query.trim(), limit);

    // Step 2: Handle empty retrieval results
    if (!relevantDocs || relevantDocs.length === 0) {
      return res.json({
        success: true,
        query: query.trim(),
        response: 'I do not have enough information to answer this.',
        context: [],
        sources: [],
        metadata: {
          retrieved_docs: 0,
          processing_time: Date.now()
        }
      });
    }

    // Step 3: Build prompt with context
    const prompt = await promptBuilder.buildPrompt(query.trim(), relevantDocs, context);

    // Step 4: Generate response
    const response = await generator.generate(prompt, model);

    // Add citations to response for auditability
    const sources = relevantDocs.map((doc, index) => ({
      ref: index + 1,
      source: doc.source || 'unknown',
      similarity: doc.similarity ? Number(doc.similarity.toFixed(3)) : 0.000,
      type: doc.type || 'unknown'
    }));

    res.json({
      success: true,
      query: query.trim(),
      response,
      context: relevantDocs,
      sources,
      metadata: {
        retrieved_docs: relevantDocs.length,
        processing_time: Date.now()
      }
    });

  } catch (error) {
    console.error('[RAG Query Error]:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'RAG query failed'
    });
  }
});

// GET /api/rag/health - Check RAG service health
router.get('/health', (req, res) => {
  const rag = getRAG();
  res.json({
    initialized: Boolean(rag),
    services: rag ? {
      retriever: 'initialized',
      promptBuilder: 'initialized',
      generator: 'initialized'
    } : null
  });
});

module.exports = router;

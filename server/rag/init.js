/**
 * Centralized RAG Initialization
 * Ensures exactly one RAG instance with proper lifecycle management
 */

let ragServices = null;

async function initRAG(vectorStore, embeddingService) {
  if (!vectorStore || !embeddingService) {
    throw new Error('VectorStore and EmbeddingService are required to initialize RAG');
  }

  if (ragServices) {
    console.log('ℹ️ RAG services already initialized');
    return ragServices;
  }

  const Retriever = require('./retriever');
  const PromptBuilder = require('./prompt_builder');
  const Generator = require('./generator');

  const retriever = new Retriever(vectorStore, embeddingService);

  const promptBuilder = new PromptBuilder();
  const generator = new Generator();

  ragServices = {
    retriever,
    promptBuilder,
    generator
  };

  console.log('✅ RAG services initialized successfully');
  return ragServices;
}

function getRAG() {
  return ragServices;
}

function isRAGInitialized() {
  return Boolean(ragServices);
}

module.exports = {
  initRAG,
  getRAG,
  isRAGInitialized
};

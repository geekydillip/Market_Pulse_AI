const axios = require('axios');

// RAG service configuration
const RAG_SERVICE_URL = 'http://localhost:5000';
const RAG_TIMEOUT = 10000; // 10 seconds

/**
 * Check if RAG service is available
 */
async function isRagServiceAvailable() {
  try {
    const response = await axios.get(`${RAG_SERVICE_URL}/health`, {
      timeout: 5000
    });
    return response.data.status === 'healthy';
  } catch (error) {
    console.warn('[RAG] Service not available:', error.message);
    return false;
  }
}

/**
 * Retrieve context from RAG service
 */
async function retrieveContext(query, k = 3) {
  try {
    const response = await axios.post(`${RAG_SERVICE_URL}/retrieve`, {
      query,
      k
    }, {
      timeout: RAG_TIMEOUT
    });
    
    return response.data.results || [];
  } catch (error) {
    console.warn('[RAG] Failed to retrieve context:', error.message);
    return [];
  }
}

/**
 * Format context for prompt injection
 */
function formatContextForPrompt(contextResults) {
  if (!contextResults || contextResults.length === 0) {
    return '';
  }
  
  const contextParts = [];
  contextResults.forEach((result, index) => {
    if (result.content) {
      contextParts.push(`[Context ${index + 1}]: ${result.content}`);
    }
  });
  
  return contextParts.join('\n');
}

/**
 * CRITICAL: Single source of governance rules
 * This is the ONLY place governance rules are defined
 */
const GOVERNANCE_RULES = `
CRITICAL RULES:
- NEVER invent or infer missing values
- INPUT DATA always has highest priority
- RAG context may be used ONLY for Module/Sub-Module classification
- If RAG context conflicts with INPUT DATA, ALWAYS follow INPUT DATA
- If RAG context is absent or irrelevant, DO NOT GUESS
- If a value cannot be determined from INPUT DATA or RAG CONTEXT, return "" (empty string)
- Model prior knowledge must NOT be used to fill gaps
`;

/**
 * Apply prompt governance rules
 */
function applyGovernance(context) {
  return `
${GOVERNANCE_RULES}

${context
  ? `RETRIEVED CONTEXT (OPTIONAL, SECONDARY):\n${context}`
  : `NO RETRIEVED CONTEXT AVAILABLE`}
`;
}

/**
 * Build RAG-enhanced prompt
 */
async function buildRagPrompt({ basePrompt, rowData, processor }) {
  // Check if RAG service is available
  const isAvailable = await isRagServiceAvailable();
  
  let context = '';
  
  if (isAvailable) {
    // Build query for context retrieval
    const query = `
Processor: ${processor}
Title: ${rowData.Title || ''}
Problem: ${rowData.Problem || ''}
Module: ${rowData.Module || ''}
`;
    
    // Retrieve context
    const contextResults = await retrieveContext(query, 3);
    context = formatContextForPrompt(contextResults);
  }
  
  // Apply governance rules (ALWAYS applied, regardless of RAG availability)
  const governance = applyGovernance(context);
  
  // Build final prompt
  const finalPrompt = `
${governance}

### TASK
${typeof basePrompt === 'function' ? basePrompt(rowData) : basePrompt}

### INPUT DATA
${JSON.stringify(rowData, null, 2)}
`;
  
  return finalPrompt;
}

module.exports = { buildRagPrompt };

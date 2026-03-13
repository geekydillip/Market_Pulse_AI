// ragClient.js
// Batch HTTP client for the persistent FastAPI RAG server (rag_api.py, port 8000).
// Replaces the old child_process / exec approach so the model is loaded ONCE in RAM.

const RAG_API_URL = "http://127.0.0.1:8000/retrieve";

/**
 * Send an array of query strings to the RAG API in one request.
 * Returns an array of match-arrays, one per query.
 *
 * @param {string[]} queriesArray
 * @returns {Promise<Array<Array<Object>>>}
 */
async function getRAGContextBatch(queriesArray) {
  if (!queriesArray || queriesArray.length === 0) {
    return [];
  }

  try {
    const response = await fetch(RAG_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries: queriesArray }),
    });

    if (!response.ok) {
      throw new Error(`RAG API error: HTTP ${response.status}`);
    }

    const data = await response.json();
    // data.results is an array-of-arrays matching the input queriesArray
    return data.results;

  } catch (error) {
    console.error("[RAG] Batch request failed:", error.message);
    // Fail gracefully — return empty arrays so the AI processor doesn't crash
    return queriesArray.map(() => []);
  }
}

/**
 * Compatibility wrapper: single-query version.
 * Internally calls getRAGContextBatch so the model stays in RAM.
 *
 * @param {string} queryText
 * @returns {Promise<Array<Object>>}
 */
async function getRAGContext(queryText) {
  const results = await getRAGContextBatch([queryText]);
  return results[0] ?? [];
}

module.exports = { getRAGContextBatch, getRAGContext };
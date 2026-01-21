/**
 * Cosine similarity utility functions
 */

/**
 * Calculate cosine similarity between two vectors
 * @param {Array<number>} vecA
 * @param {Array<number>} vecB
 * @returns {number} Similarity score between 0 and 1
 */
function cosineSimilarity(vecA, vecB) {
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

module.exports = {
  cosineSimilarity
};

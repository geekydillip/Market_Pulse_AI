/**
 * Estimate token count for a given text
 * Rough approximation: 1 token ≈ 4 characters for English text
 * This is a conservative estimate for batching decisions
 */
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimate total tokens for a batch of rows
 * @param {Array} rows - Array of row objects
 * @param {string} processingType - Type of processing (affects which fields to include)
 * @returns {number} Estimated token count
 */
function estimateBatchTokens(rows, processingType = 'beta_user_issues') {
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  let totalTokens = 0;

  // Estimate tokens for prompt template overhead
  totalTokens += estimateTokens(`You are an assistant for cleaning and structuring "Voice of Customer" issue reports.

Process the following numbered rows:
1. Title → Clean the Title field...
[full prompt template]`); // Conservative estimate

  // Estimate tokens for each row
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Row number and JSON structure overhead
    totalTokens += estimateTokens(`"${i + 1}": `);

    let rowData = {};

    if (processingType === 'beta_user_issues') {
      rowData = {
        Title: row.Title || '',
        Problem: row.Problem || ''
      };
    } else if (processingType === 'plm_issues') {
      rowData = {
        Title: row.Title || '',
        Problem: row.Problem || '',
        'Dev. Mdl. Name/Item Name': row['Model No.'] || '',
        Priority: row.Priority || '',
        'Occurr. Freq.': row['Occurr. Freq.'] || ''
      };
    } else if (processingType === 'samsung_members_voc') {
      rowData = {
        content: row.content || '',
        'Application Name': row['Application Name'] || '',
        Category: row.Category || ''
      };
    } else if (processingType === 'samsung_members_plm') {
      rowData = {
        Title: row.Title || '',
        Problem: row.Problem || '',
        'Dev. Mdl. Name/Item Name': row['Model No.'] || '',
        'S/W Ver.': row['S/W Ver.'] || ''
      };
    }

    totalTokens += estimateTokens(JSON.stringify(rowData));
  }

  // JSON structure overhead
  totalTokens += estimateTokens('{}');

  return totalTokens;
}

/**
 * Create optimal batches of rows (5-20 rows) based on token limits
 * @param {Array} rows - All rows to batch
 * @param {string} processingType - Type of processing
 * @param {number} maxTokens - Maximum tokens per batch (default: 6000 for safety margin)
 * @returns {Array} Array of batches, each batch is an array of rows
 */
function createOptimalBatches(rows, processingType = 'beta_user_issues', maxTokens = 6000) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const batches = [];
  let currentBatch = [];
  let currentTokens = 0;

  for (const row of rows) {
    // Estimate tokens if we add this row
    const testBatch = [...currentBatch, row];
    const testTokens = estimateBatchTokens(testBatch, processingType);

    // If adding this row would exceed token limit, or we've reached 20 rows, start new batch
    if ((testTokens > maxTokens && currentBatch.length >= 5) || currentBatch.length >= 20) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [row];
        currentTokens = estimateBatchTokens([row], processingType);
      } else {
        // Edge case: single row exceeds token limit (shouldn't happen with reasonable data)
        batches.push([row]);
        currentBatch = [];
        currentTokens = 0;
      }
    } else {
      currentBatch.push(row);
      currentTokens = testTokens;
    }
  }

  // Add remaining batch if any
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  // Ensure minimum batch size of 5 (except for last partial batch)
  if (batches.length > 1) {
    const lastBatch = batches[batches.length - 1];
    if (lastBatch.length < 5 && batches.length > 1) {
      // Merge small last batch with previous batch
      const prevBatch = batches[batches.length - 2];
      prevBatch.push(...lastBatch);
      batches.pop();
    }
  }

  return batches;
}

/**
 * Clean Excel styling and formatting artifacts
 * @param {any} value - Value to clean
 * @returns {any} Cleaned value
 */
function cleanExcelStyling(value) {
  if (typeof value !== 'string') return value;

  // Remove Excel-specific formatting artifacts
  return value
    .replace(/\r\n/g, '\n')  // Normalize line endings
    .replace(/\r/g, '\n')
    .replace(/\n+/g, ' ')    // Replace multiple newlines with space
    .trim();
}

/**
 * Normalize text for embedding to prevent context length overflow
 * @param {string} text - Raw text to normalize
 * @param {number} maxChars - Maximum characters to keep (default: 3000)
 * @returns {string} Normalized text safe for embedding
 */
function normalizeForEmbedding(text, maxChars = 3000) {
  if (typeof text !== 'string') return '';

  return text
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    // Remove BIGDATA and technical log markers that don't add semantic value
    .replace(/\[BIGDATA.*?\]/gi, '')
    .replace(/\[APP\]\s*\[.*?\]/gi, '')
    .replace(/\[COM\]\s*\[.*?\]/gi, '')
    .replace(/\[TOP\]\s*\[.*?\]/gi, '')
    .replace(/\[NET\]\s*\[.*?\]/gi, '')
    .replace(/\[SET\]\s*\[.*?\]/gi, '')
    // Remove technical error patterns
    .replace(/CAM_ERR.*?/gi, '')
    .replace(/CAM-UTIL.*?/gi, '')
    .replace(/hw_bigdata_i2c_from_eeprom.*?/gi, '')
    .replace(/camxcslhw\.cpp.*?/gi, '')
    .replace(/CSLAcquireDeviceHW.*?/gi, '')
    // Clean up excessive whitespace again
    .replace(/\s+/g, ' ')
    // Truncate to max length
    .slice(0, maxChars)
    .trim();
}

module.exports = {
  estimateTokens,
  estimateBatchTokens,
  createOptimalBatches,
  cleanExcelStyling,
  normalizeForEmbedding
};

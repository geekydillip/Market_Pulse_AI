const xlsx = require('xlsx');
const { buildRagPrompt } = require('../rag/prompts/ragPromptWrapper');

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

/**
 * Shared header normalization utility - eliminates code duplication
 */
function normalizeHeaders(rows) {
  // Map header name variants to canonical names
  const headerMap = {
    // Model variants
    'model no.': 'Model No.',
    'Dev. Mdl. Name/Item Name': 'Model No.',
    'dev. mdl. name/item name': 'Model No.',
    // Case Code
    'case code': 'Case Code',
    // S/W Ver variants
    's/w ver.': 'S/W Ver.',
    // Title, Problem, Module, Sub-Module
    'title': 'Title',
    'progr.stat.': 'Progr.Stat.',
    'progress status': 'Progr.Stat.',
    'problem': 'Problem',
    'resolve option(medium)': 'Resolve Option(Medium)',
    'module': 'Module',
    'sub-module': 'Sub-Module',
    'issue type': 'Issue Type',
    'sub-issue type': 'Sub-Issue Type'
  };

  // canonical columns you expect in the downstream processing
  const canonicalCols = ['Case Code','Model No.','Progr.Stat.','S/W Ver.','Title','Problem','Resolve Option(Medium)'];

  const normalizedRows = rows.map(orig => {
    const out = {};
    // Build a reverse map of original header -> canonical (if possible)
    const keyMap = {}; // rawKey -> canonical
    Object.keys(orig).forEach(rawKey => {
      const norm = String(rawKey || '').trim().toLowerCase();
      const mapped = headerMap[norm] || headerMap[norm.replace(/\s+|\./g, '')] || null;
      if (mapped) keyMap[rawKey] = mapped;
      else {
        // try exact match to canonical
        for (const c of canonicalCols) {
          if (norm === String(c).toLowerCase() || norm === String(c).toLowerCase().replace(/\s+|\./g, '')) {
            keyMap[rawKey] = c;
            break;
          }
        }
      }
    });
    // Fill canonical fields
    for (const tgt of canonicalCols) {
      // find a source raw key that maps to this tgt
      let found = null;
      for (const rawKey of Object.keys(orig)) {
        if (keyMap[rawKey] === tgt) {
          found = orig[rawKey];
          break;
        }
      }
      // also if tgt exists exactly as a raw header name, use it
      if (found === null && Object.prototype.hasOwnProperty.call(orig, tgt)) found = orig[tgt];
      out[tgt] = (found !== undefined && found !== null) ? found : '';
    }
    return out;
  });

  return normalizedRows;
}

/**
 * Read and normalize Excel file - shared function for all processors
 * @param {string} uploadedPath - Path to uploaded Excel file
 * @returns {Array} Normalized rows
 */
function readAndNormalizeExcel(uploadedPath) {
  console.log('[DEBUG] Reading Excel file:', uploadedPath);
  const workbook = xlsx.readFile(uploadedPath, { cellDates: true, raw: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  console.log('[DEBUG] Sheet name:', sheetName);

  // Read sheet as 2D array so we can find header row robustly
  const sheetRows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  console.log('[DEBUG] Total rows in sheet:', sheetRows.length);
  console.log('[DEBUG] First 3 rows:', sheetRows.slice(0, 3));

  // Find a header row: first row that contains at least one expected key or at least one non-empty cell
  let headerRowIndex = 0;
  const expectedHeaderKeywords = ['Case Code','Dev. Mdl. Name/Item Name','Model No.','Progr.Stat.','S/W Ver.','Title','Problem','Resolve Option(Medium)','Issue Type','Sub-Issue Type']; // lowercase checks
  console.log('[DEBUG] Looking for header row...');
  for (let r = 0; r < sheetRows.length; r++) {
    const row = sheetRows[r];
    if (!Array.isArray(row)) continue;
    const rowText = row.map(c => String(c || '').toLowerCase()).join(' | ');
    console.log(`[DEBUG] Row ${r}: ${rowText}`);
    // if the row contains any expected header keyword, choose it as header
    if (expectedHeaderKeywords.some(k => rowText.includes(k))) {
      headerRowIndex = r;
      console.log(`[DEBUG] Found header row at index ${r} (contains expected keywords)`);
      break;
    }
    // fallback: first non-empty row becomes header
    if (row.some(cell => String(cell).trim() !== '')) {
      headerRowIndex = r;
      console.log(`[DEBUG] Using row ${r} as header (first non-empty row)`);
      break;
    }
  }

  console.log(`[DEBUG] Selected header row index: ${headerRowIndex}`);

  // Build raw headers and trim
  const rawHeaders = (sheetRows[headerRowIndex] || []).map(h => String(h || '').trim());
  console.log('[DEBUG] Raw headers:', rawHeaders);

  // Build data rows starting after headerRowIndex
  const dataRows = sheetRows.slice(headerRowIndex + 1);
  console.log(`[DEBUG] Data rows count: ${dataRows.length}`);
  console.log('[DEBUG] First data row:', dataRows[0]);

  // Convert dataRows to array of objects keyed by rawHeaders
  let rows = dataRows.map((r, idx) => {
    const obj = {};
    for (let ci = 0; ci < rawHeaders.length; ci++) {
      const key = rawHeaders[ci] || `col_${ci}`;
      obj[key] = r[ci] !== undefined && r[ci] !== null ? r[ci] : '';
    }
    if (idx < 3) { // Log first 3 rows with processor-aware content fields
      const contentFields = ['Title', 'Problem', 'content', 'Application Name'];
      const contentData = {};
      contentFields.forEach(field => {
        if (obj[field] !== undefined) {
          contentData[field] = obj[field];
        }
      });
      console.log(`[DEBUG] Processed row ${idx}:`, contentData);
    }
    return obj;
  });
  console.log(`[DEBUG] Total processed rows: ${rows.length}`);

  // Use shared normalization function
  const normalizedRows = normalizeHeaders(rows);
  return normalizedRows;
}

module.exports = {
  estimateTokens,
  estimateBatchTokens,
  createOptimalBatches,
  cleanExcelStyling,
  normalizeForEmbedding,
  buildRagPrompt,
  normalizeHeaders,
  readAndNormalizeExcel
};

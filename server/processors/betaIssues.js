const xlsx = require('xlsx');
const promptTemplate = require('../prompts/betaIssuesPrompt');
const discoveryPromptTemplate = require('../prompts/betaIssuesPrompt_discovery');
const embeddingsStore = require('../embeddings/embedding_service');
const ollamaClient = require('../ollamaClient');
const { cleanExcelStyling } = require('./_helpers');

/**
 * Deep clean objects to remove Excel styling artifacts recursively
 * @param {any} obj - Object to clean
 * @returns {any} Cleaned object
 */
function cleanObjectRecursively(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return cleanExcelStyling(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => cleanObjectRecursively(item));
  }

  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    // Skip Excel styling keys and metadata keys
    if (key === 's' || key === 'w' || key.startsWith('!') || key === 't' || key === 'r') {
      continue;
    }
    cleaned[key] = cleanObjectRecursively(value);
  }
  return cleaned;
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
    if (idx < 3) { // Log first 3 rows
      console.log(`[DEBUG] Processed row ${idx}:`, { Title: obj.Title, Problem: obj.Problem });
    }
    return obj;
  });
  console.log(`[DEBUG] Total processed rows: ${rows.length}`);

  // Use shared normalization function
  const normalizedRows = normalizeHeaders(rows);
  console.log('[DEBUG] After normalization, first 3 rows:');
  normalizedRows.slice(0, 3).forEach((row, idx) => {
    console.log(`[DEBUG] Normalized row ${idx}:`, { Title: row.Title, Problem: row.Problem });
  });
  return normalizedRows;
}

/**
 * Derive model name from S/W Ver. for OS Beta entries
 * Example: "S911BXXU8ZYHB" -> "SM-S911B"
 */
function deriveModelNameFromSwVer(swVer) {
  if (!swVer || typeof swVer !== 'string' || swVer.length < 5) {
    return '';
  }
  return 'SM-' + swVer.substring(0, 5);
}

// normalizeRows - now just calls the shared function
function normalizeRows(rows) {
  return normalizeHeaders(rows);
}

/**
 * Beta Issues Processor
 * Main processing function that handles both regular and discovery modes
 * @param {Array} rows - Input data rows
 * @param {Object} context - Processing context with mode and other options
 * @returns {Promise<Array>} Processed rows with AI insights
 */
async function betaIssuesProcessor(rows, context = {}) {
  const { mode = 'regular', prompt: customPrompt } = context;

  // Use appropriate prompt based on mode
  const prompt = customPrompt || (mode === 'discovery' ? discoveryPromptTemplate : promptTemplate);

  // Apply normalization using the local normalizeHeaders function
  let transformedRows = normalizeHeaders(rows);

  // Build prompt for AI processing
  const numberedInput = {};
  transformedRows.forEach((row, index) => {
    numberedInput[(index + 1).toString()] = {
      Title: row.Title || '',
      Problem: row.Problem || ''
    };
  });
  const aiPrompt = prompt.replace('{INPUTDATA_JSON}', JSON.stringify(numberedInput, null, 2));

  // For now, return the transformed rows with placeholder AI fields
  // In a real implementation, this would call the AI service
  return transformedRows.map((row, index) => ({
    ...row,
    'No': (context.startIndex || 0) + index + 1, // Fix: Global renumbering
    'Module': '',
    'Sub-Module': '',
    'Issue Type': '',
    'Sub-Issue Type': '',
    'Summarized Problem': '',
    'Severity': '',
    'Severity Reason': ''
  }));
}

// Add expected headers for the processor
betaIssuesProcessor.expectedHeaders = ['Case Code','Model No.','Progr.Stat.','S/W Ver.','Title','Problem','Resolve Option(Medium)'];
betaIssuesProcessor.readAndNormalizeExcel = readAndNormalizeExcel;

module.exports = betaIssuesProcessor;

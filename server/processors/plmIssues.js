const xlsx = require('xlsx');
const promptTemplate = require('../prompts/plmIssuesPrompt');
const discoveryPromptTemplate = require('../prompts/plmIssuesPrompt_discovery');
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
    'module': 'Module',
    'sub-module': 'Sub-Module',
    'priority': 'Priority',
    'occurr. freq.': 'Occurr. Freq.',
  };

  // canonical columns you expect in the downstream processing
  const canonicalCols = ['Case Code','Model No.','Progr.Stat.','Title','Priority','Occurr. Freq.','S/W Ver.','Problem'];

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
  const workbook = xlsx.readFile(uploadedPath, { cellDates: true, raw: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Read sheet as 2D array so we can find header row robustly
  const sheetRows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  // Find a header row: first row that contains at least one expected key or at least one non-empty cell
  let headerRowIndex = 0;
  const expectedHeaderKeywords = ['Case Code','Dev. Mdl. Name/Item Name','Progr.Stat.','Title','Priority','Occurr. Freq.','S/W Ver.','Problem']; // lowercase checks
  for (let r = 0; r < sheetRows.length; r++) {
    const row = sheetRows[r];
    if (!Array.isArray(row)) continue;
    const rowText = row.map(c => String(c || '').toLowerCase()).join(' | ');
    // if the row contains any expected header keyword, choose it as header
    if (expectedHeaderKeywords.some(k => rowText.includes(k))) {
      headerRowIndex = r;
      break;
    }
    // fallback: first non-empty row becomes header
    if (row.some(cell => String(cell).trim() !== '')) {
      headerRowIndex = r;
      break;
    }
  }

  // Build raw headers and trim
  const rawHeaders = (sheetRows[headerRowIndex] || []).map(h => String(h || '').trim());

  // Build data rows starting after headerRowIndex
  const dataRows = sheetRows.slice(headerRowIndex + 1);

  // Convert dataRows to array of objects keyed by rawHeaders
  let rows = dataRows.map(r => {
    const obj = {};
    for (let ci = 0; ci < rawHeaders.length; ci++) {
      const key = rawHeaders[ci] || `col_${ci}`;
      obj[key] = r[ci] !== undefined && r[ci] !== null ? r[ci] : '';
    }
    return obj;
  });

  // Use shared normalization function
  return normalizeHeaders(rows);
}

// normalizeRows - now just calls the shared function
function normalizeRows(rows) {
  return normalizeHeaders(rows);
}

/**
 * PLM Issues Processor
 * Main processing function that handles both regular and discovery modes
 * @param {Array} rows - Input data rows
 * @param {Object} context - Processing context with mode and other options
 * @returns {Promise<Array>} Processed rows with AI insights
 */
async function plmIssuesProcessor(rows, context = {}) {
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
      Problem: (row.Problem || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
      'Dev. Mdl. Name/Item Name': row['Model No.'] || '',
      Priority: row.Priority || '',
      'Occurr. Freq.': row['Occurr. Freq.'] || ''
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
plmIssuesProcessor.expectedHeaders = ['Case Code','Model No.','Progr.Stat.','Title','Priority','Occurr. Freq.','S/W Ver.','Problem'];
plmIssuesProcessor.readAndNormalizeExcel = readAndNormalizeExcel;

module.exports = plmIssuesProcessor;

const xlsx = require('xlsx');
const promptTemplate = require('../prompts/plmIssuesPrompt');

/**
 * Shared header normalization utility - eliminates code duplication
 */
function normalizeHeaders(rows) {
  // Map header name variants to canonical names
  const headerMap = {
    // Model variants
    'Model No.':'Model No.',
    // Case Code
    'Case Code': 'Case Code',
    // S/W Ver variants
    'S/W Ver.': 'S/W Ver.',
    // Title, Problem, Module, Sub-Module
    'Title': 'Title',
    'Progr.Stat.': 'Progr.Stat.',
    'Problem': 'Problem',
    'Module': 'Module',
    'Sub-Module': 'Sub-Module',
    'Dev. Mdl. Name/Item Name': 'Model No.'
  };

  // canonical columns you expect in the downstream processing
  const canonicalCols = ['Case Code','Dev. Mdl. Name/Item Name','Progr.Stat.','S/W Ver.','Title','Problem'];

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
  const expectedHeaderKeywords = ['Case Code','Dev. Mdl. Name/Item Name','Progr.Stat.','S/W Ver.','Title','Problem']; // lowercase checks
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

module.exports = {
  id: 'plmIssuesPrompt',
  expectedHeaders: ['Case Code', 'Model No.', 'Progr.Stat.','S/W Ver.', 'Title', 'Problem',  'Module', 'Sub-Module', 'Issue Type', 'Sub-Issue Type', 'Summarized Problem', 'Severity', 'Severity Reason'],

  validateHeaders(rawHeaders) {
    // Check if required fields are present
    const required = ['Title', 'Problem'];
    return required.some(header =>
      rawHeaders.includes(header) ||
      rawHeaders.some(h => h.toLowerCase().trim() === header.toLowerCase().trim())
    );
  },

  transform(rows) {
    // Apply normalization using the local normalizeHeaders function
    return normalizeHeaders(rows);
  },

  buildPrompt(rows) {
    return promptTemplate.replace('{INPUTDATA_JSON}', JSON.stringify(rows, null, 2));
  },

  formatResponse(aiResult) {
    const text = aiResult.trim();
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      const jsonStr = text.substring(firstBracket, lastBracket + 1);
      return JSON.parse(jsonStr);
    }
    throw new Error('No valid JSON array found in response');
  },

  // Returns column width configurations for Excel export
  getColumnWidths(finalHeaders) {
    return finalHeaders.map((h, idx) => {
      if (['Title','Problem','Summarized Problem','Severity Reason'].includes(h)) return { wch: 41 };
      if (h === 'Model No.') return { wch: 20 };
      if (h === 'S/W Ver.') return { wch: 15 };
      if (h === 'Module' || h === 'Sub-Module' || h === 'Issue Type' || h === 'Sub-Issue Type') return { wch: 15 };
      if (h === 'error') return { wch: 15 };
      return { wch: 20 };
    });
  },

  // Excel reading function used by server.js
  readAndNormalizeExcel: readAndNormalizeExcel
};

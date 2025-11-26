const xlsx = require('xlsx');
const promptTemplate = require('../prompts/plmIssuesPrompt');

/**
 * Shared header normalization utility - eliminates code duplication
 */
function normalizeHeaders(rows) {
  // Map header name variants to canonical names for PLM Issue processing
  const headerMap = {
    // Title and Problem variants
    'title': 'Title',
    'problem': 'Problem',
    // Priority variants
    'priority': 'Priority',
    'pri': 'Priority',
    // Occurrence Frequency variants
    'occurr. freq.': 'Occurr. Freq.',
    'occurr freq': 'Occurr. Freq.',
    'occur. freq.': 'Occurr. Freq.',
    'occur freq': 'Occurr. Freq.',
    'occurrence frequency': 'Occurr. Freq.',
    'occurrence freq.': 'Occurr. Freq.',
    'freq.': 'Occurr. Freq.',
    'frequency': 'Occurr. Freq.',
    // Occurrence Frequency Details variants
    'occur. freq.(details)': 'Occur. Freq.(Details)',
    'occur freq details': 'Occur. Freq.(Details)',
    'occurrence freq. details': 'Occur. Freq.(Details)',
    'freq details': 'Occur. Freq.(Details)',
    'occurr. freq.(detail)': 'Occur. Freq.(Details)',
    'occurr. freq.(details)': 'Occur. Freq.(Details)',
    // Cause and Counter Measure variants
    'cause': 'Cause',
    'counter measure': 'Counter Measure',
    'countermeasure': 'Counter Measure',
    'counter measures': 'Counter Measure',
    'counter-measures': 'Counter Measure',
    'solution': 'Counter Measure',
    // Program Status variants
    'progr.stat.': 'Progr.Stat.',
    'progr stat': 'Progr.Stat.',
    'program status': 'Progr.Stat.',
    'status': 'Progr.Stat.',
    'prog.status': 'Progr.Stat.',
  };

  // canonical columns you expect in the downstream processing for PLM
  const canonicalCols = ['Title','Progr.Stat.', 'Priority', 'Occurr. Freq.', 'Occur. Freq.(Details)', 'Problem', 'Cause', 'Counter Measure'];

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
  const expectedHeaderKeywords = ['Title','Progr.Stat.', 'Priority', 'Occurr. Freq.', 'Occur. Freq.(Details)', 'Problem', 'Cause', 'Counter Measure']; // lowercase checks for PLM
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
  id: 'plmIssues',
  expectedHeaders: ['Module', 'Total', 'Open', 'Resolved', 'Closed'],

  validateHeaders(rawHeaders) {
    // Check if required fields are present for PLM: Title and Priority are key indicators
    const required = ['Title', 'Priority', 'Occurr. Freq.', 'Occur. Freq.(Details)', 'Problem',];
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
    try {
      // First attempt: parse the entire trimmed text as JSON
      return JSON.parse(text);
    } catch (err) {
      // Second attempt: extract and parse the JSON array substring
      const firstBracket = text.indexOf('[');
      const lastBracket = text.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket > firstBracket) {
        const jsonStr = text.substring(firstBracket, lastBracket + 1);
        try {
          return JSON.parse(jsonStr);
        } catch (parseErr) {
          throw new Error('No valid JSON array found in response: ' + parseErr.message);
        }
      }
      throw new Error('No valid JSON array found in response');
    }
  },

  // Returns column width configurations for Excel export
  getColumnWidths(finalHeaders) {
    return finalHeaders.map((h, idx) => {
      if (h === 'Severity') return { wch: 15 };
      if (h === 'Module' || h === 'Sub-Module') return { wch: 20 };
      if (['Total', 'Open', 'Resolved', 'Closed'].includes(h)) return { wch: 10 };
      if (h === 'error') return { wch: 15 };
      return { wch: 20 };
    });
  },

  // Excel reading function used by server.js
  readAndNormalizeExcel: readAndNormalizeExcel
};

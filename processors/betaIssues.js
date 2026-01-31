const xlsx = require('xlsx');
const promptTemplate = require('../prompts/betaIssuesPrompt');

/**
 * Shared header normalization utility - eliminates code duplication
 */
function normalizeHeaders(rows) {
  // Map header name variants to canonical names
  // Map header variants to canonical names for internal processing
const HEADER_MAP = {
  'case code': 'Case Code',
  'plm code': 'Case Code',
  'issue id': 'Case Code',
  'model no.': 'Model No.',
  'target model': 'Model No.',
  'dev. mdl. name/item name': 'Model No.',
  's/w ver.': 'S/W Ver.',
  'version occurred': 'S/W Ver.',
  'title': 'Title',
  'problem': 'Problem',
  'progr.stat.': 'Progr.Stat.',
  'plm status': 'Progr.Stat.',
  'resolve option(medium)': 'Resolve',
  'plm resolve option1': 'Resolve'
};

  // canonical columns you expect in the downstream processing
  const CANONICAL_COLS = ['Case Code', 'Model No.', 'Progr.Stat.', 'S/W Ver.', 'Title', 'Problem', 'Resolve'];

  const normalizedRows = rows.map(orig => {
    const out = {};
  // Build a reverse map of original header -> canonical (if possible)
  const keyMap = {}; // rawKey -> canonical
  Object.keys(orig).forEach(rawKey => {
    const norm = String(rawKey || '').trim().toLowerCase();
    const mapped = HEADER_MAP[norm] || HEADER_MAP[norm.replace(/\s+|\./g, '')] || null;
    if (mapped) keyMap[rawKey] = mapped;
    else {
      // try exact match to canonical
      for (const c of CANONICAL_COLS) {
        if (norm === String(c).toLowerCase() || norm === String(c).toLowerCase().replace(/\s+|\./g, '')) {
          keyMap[rawKey] = c;
          break;
        }
      }
    }
  });
    // Fill canonical fields
    for (const tgt of CANONICAL_COLS) {
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
  const expectedHeaderKeywords = ['Case Code','Dev. Mdl. Name/Item Name','Model No.','Progr.Stat.','S/W Ver.','Title','Problem','Resolve','Issue ID','PLM code','PLM Status','PLM importance']; // lowercase checks
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

module.exports = {
  id: 'betaIssues',
  expectedHeaders: ['Case Code', 'Model No.', 'Progr.Stat.', 'S/W Ver.', 'Title', 'Problem','Resolve', 'Module', 'Sub-Module','Issue Type','Ai Summary','Severity','Sub-Issue Type','Severity Reason'],

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
    // Send only content fields to AI for analysis
    const aiInputRows = rows.map(row => ({
      Title: row.Title || '',
      Problem: row.Problem || ''
    }));
    return promptTemplate.replace('{INPUTDATA_JSON}', JSON.stringify(aiInputRows, null, 2));
  },

  formatResponse(aiResult, originalRows) {
    let aiRows;

    // Handle different response formats: object, JSON string, or raw text
    if (typeof aiResult === 'object' && aiResult !== null) {
      aiRows = aiResult;
    } else if (typeof aiResult === 'string') {
      const text = aiResult.trim();

      // First try to parse as complete JSON
      try {
        aiRows = JSON.parse(text);
      } catch (e) {
        // If that fails, try to extract JSON array from text
        const firstBracket = text.indexOf('[');
        const lastBracket = text.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket > firstBracket) {
          const jsonStr = text.substring(firstBracket, lastBracket + 1);
          try {
            aiRows = JSON.parse(jsonStr);
          } catch (e2) {
            // If JSON parsing fails, return array with error info
            return [{ error: `Failed to parse AI response: ${text.substring(0, 200)}...` }];
          }
        } else {
          // Last resort: return array with error info
          return [{ error: `Invalid AI response format: ${text.substring(0, 200)}...` }];
        }
      }
    } else {
      // Fallback for unexpected types - return array
      return [{ error: `Unexpected AI response type: ${typeof aiResult}` }];
    }

    // Ensure aiRows is an array
    if (!Array.isArray(aiRows)) {
      return [{ error: `AI response is not an array: ${typeof aiRows}` }];
    }

    // Merge AI results with original core identifiers
    const mergedRows = aiRows.map((aiRow, index) => {
      const original = originalRows[index] || {};
      return {
        'Case Code': original['Case Code'] || '',
        'Model No.': (original['Model No.'] && original['Model No.'].startsWith('[OS Beta]'))
          ? deriveModelNameFromSwVer(original['S/W Ver.'])
          : (original['Model No.'] || ''),
        'Progr.Stat.': original['Progr.Stat.'] || '',
        'S/W Ver.': original['S/W Ver.'] || '',
        'Title': aiRow['Title'] || original.Title,
        'Problem': aiRow['Problem'] || original.Problem,
        'Resolve': original['Resolve'] || '',
        'Module': aiRow['Module'] || '',
        'Sub-Module': aiRow['Sub-Module'] || '',
        'Ai Summary': aiRow['Ai Summary'] || '',
        'Severity': aiRow['Severity'] || '',
        'Severity Reason': aiRow['Severity Reason'] || '',
        'Issue Type': aiRow['Issue Type'] || '',
        'Sub-Issue Type': aiRow['Sub-Issue Type'] || ''
      };
    });

    return mergedRows;
  },

  // Returns column width configurations for Excel export
  getColumnWidths(finalHeaders) {
    return finalHeaders.map((h, idx) => {
      if (['Title','Problem','Ai Summary','Severity Reason'].includes(h)) return { wch: 41 };
      if (h === 'Model No.' || h === 'Resolve') return { wch: 20 };
      if (h === 'S/W Ver.' || h === 'Progr.Stat.' || h === 'Issue Type' || h === 'Sub-Issue Type') return { wch: 15 };
      if (h === 'Module' || h === 'Sub-Module') return { wch: 15 };
      if (h === 'error') return { wch: 15 };
      return { wch: 20 };
    });
  },

  // Excel reading function used by server.js
  readAndNormalizeExcel: readAndNormalizeExcel
};

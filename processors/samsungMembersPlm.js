const xlsx = require('xlsx');
const promptTemplate = require('../prompts/samsungMembersPlmPrompt');

/**
 * Shared header normalization utility - eliminates code duplication
 */
function normalizeHeaders(rows) {
  // Map header name variants to canonical names
  const headerMap = {
    // Model variants
    'model no.': 'Model No.',
    // Case Code
    'case code': 'Case Code',
    // S/W Ver variants
    's/w ver.': 'S/W Ver.',
    // Title, Problem, Module, Sub-Module
    'title': 'Title',
    'problem': 'Problem',
    'module': 'Module',
    'sub-module': 'Sub-Module',
  };

  // canonical columns you expect in the downstream processing
  const canonicalCols = ['Case Code','Model No.','S/W Ver.','Title','Feature','Problem','Resolve Option(Small)','Cause','Counter Measure'];

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
  const expectedHeaderKeywords = ['Case Code','Model No.','S/W Ver.','Title','Feature','Problem','Resolve Option(Small)','Cause','Counter Measure']; // lowercase checks
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
 * Clean technical logs from text fields
 * Removes timestamped log entries and technical patterns while preserving explanatory text
 */
function cleanTechnicalLogs(text) {
  if (!text || typeof text !== 'string') return text;

  // Split into lines
  const lines = text.split('\n');

  // Filter out technical log lines
  const cleanedLines = lines.filter(line => {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) return false;

    // Skip lines starting with timestamps (YYYY-MM-DD HH:MM:SS format)
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(trimmed)) return false;

    // Skip lines containing technical log markers
    const logPatterns = [
      /\[PKG\]/, /\[COM\]/, /\[TOP\]/, /\[NET\]/, /\[SET\]/,
      /CAM_ERR/, /CAM-UTIL/, /hw_bigdata_i2c_from_eeprom/,
      /camxcslhw\.cpp/, /CSLAcquireDeviceHW/, /CAM_ERR/
    ];
    if (logPatterns.some(pattern => pattern.test(trimmed))) return false;

    // Skip lines that look like technical data (containing many numbers/symbols)
    // But keep lines that are explanatory text
    const technicalChars = /[=<>[\]{}()|:-]/.test(trimmed);
    const wordCount = trimmed.split(/\s+/).length;
    const hasManyNumbers = (trimmed.match(/\d+/g) || []).length > 3;

    // If line has many technical characters and numbers, likely a log
    if (technicalChars && hasManyNumbers && wordCount < 10) return false;

    // Keep lines that look like natural language or bullet points
    return true;
  });

  // Join cleaned lines back
  return cleanedLines.join('\n').trim();
}

/**
 * Clean title by removing leading bracketed metadata blocks and ensuring proper formatting
 */
function cleanTitle(title) {
  if (!title || typeof title !== 'string') return title;

  let t = title;

  // Remove leading bracketed metadata blocks
  t = t.replace(/^(\[[^\]]*\]\s*)+/g, '');

  // Trim whitespace
  t = t.trim();

  // Ensure sentence ends with a period (only if not already)
  if (t && !/[.!?]$/.test(t)) {
    t += '.';
  }

  return t;
}

/**
 * Clean problem by removing internal notice blocks and limiting length
 */
function cleanProblem(problem) {
  if (!problem || typeof problem !== 'string') return problem;

  let t = problem;

  // Remove Samsung Members internal notice block
  t = t.replace(/\[Samsung Members Notice\][\s\S]*$/i, '');

  // Trim whitespace
  t = t.trim();

  // Limit to 500 characters
  if (t.length > 500) {
    t = t.slice(0, 500);
  }

  return t;
}

/**
 * Clean cause or countermeasure fields with unified rules
 */
function cleanCauseOrCounterMeasure(text) {
  if (!text || typeof text !== 'string') return '';

  let t = text.toLowerCase();

  // RULE A: CP silent log request detection
  const cpLogPatterns = [
    'cp silent log',
    'silent logs',
    'logs are not available',
    'debug level',
    're-register',
    '*#9900#'
  ];

  if (cpLogPatterns.some(p => t.includes(p))) {
    return 'Please provide CP silent logs for the issue.';
  }

  // Remove technical logs using existing logic
  let cleaned = cleanTechnicalLogs(text);

  // Remove file names, attachments, separators
  cleaned = cleaned
    .replace(/-{3,}/g, '')
    .replace(/={3,}/g, '')
    .replace(/\b\d+_\d+\.(jpg|png|mp4)\b/gi, '')
    .trim();

  // RULE C: If no meaningful English content remains → blank
  const englishWordCount = (cleaned.match(/[a-zA-Z]{3,}/g) || []).length;
  if (englishWordCount < 10) {
    return '';
  }

  // RULE B & D: Limit to 500 characters
  if (cleaned.length > 500) {
    cleaned = cleaned.slice(0, 500);
  }

  return cleaned;
}

// normalizeRows - now just calls the shared function
function normalizeRows(rows) {
  return normalizeHeaders(rows);
}

module.exports = {
  id: 'samsungMembersPlm',
  expectedHeaders: ['Case Code', 'Model No.', 'S/W Ver.', 'Title', 'Problem',  'Module', 'Sub-Module', 'Summarized Problem', 'Severity', 'Severity Reason','Resolve Type','R&D Comment'],

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
    let normalizedRows = normalizeHeaders(rows);

    // Clean technical logs from Cause and Countermeasure fields
    normalizedRows = normalizedRows.map(row => {
      const cleanedRow = { ...row };

      // Clean Title field (remove metadata only)
      if (cleanedRow.Title) {
        cleanedRow.Title = cleanTitle(cleanedRow.Title);
      }

      // Clean Problem field (remove internal notice, limit length)
      if (cleanedRow.Problem) {
        cleanedRow.Problem = cleanProblem(cleanedRow.Problem);
      }

      // Clean Cause field
      if (cleanedRow.Cause) {
        cleanedRow.Cause = cleanCauseOrCounterMeasure(cleanedRow.Cause);
      }

      // Clean Counter Measure field
      if (cleanedRow['Counter Measure']) {
        cleanedRow['Counter Measure'] =
          cleanCauseOrCounterMeasure(cleanedRow['Counter Measure']);
      }

      return cleanedRow;
    });

    return normalizedRows;
  },

  buildPrompt(rows) {
    // Send only content fields to AI for analysis
    const aiInputRows = rows.map(row => ({
      Title: row.Title || '',
      Problem: row.Problem || '',
      Feature: row.Feature || '',
      'Resolve Option(Small)': row['Resolve Option(Small)'] || '',
      Cause: row.Cause || '',
      'Counter Measure': row['Counter Measure'] || ''
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
        'Model No.': original['Model No.'] || '',
        'S/W Ver.': original['S/W Ver.'] || '',
        'Title': aiRow['Title'] || '',  // From AI (cleaned)
        'Problem': aiRow['Problem'] || '',  // From AI (cleaned)
        'Resolve Type': original['Resolve Option(Small)'] || '',
        'Module': aiRow['Module'] || '',
        'Sub-Module': aiRow['Sub-Module'] || '',
        'Summarized Problem': aiRow['Summarized Problem'] || '',
        'Severity': aiRow['Severity'] || '',
        'Severity Reason': aiRow['Severity Reason'] || '',
        'R&D Comment': aiRow['R&D Comment'] || ''
      };
    });

    return mergedRows;
  },

  // Returns column width configurations for Excel export
  getColumnWidths(finalHeaders) {
    return finalHeaders.map((h, idx) => {
      if (['Title','Problem','Summarized Problem','Severity Reason'].includes(h)) return { wch: 41 };
      if (h === 'R&D Comment') return { wch: 50 };
      if (h === 'Model No.' || h === 'Resolve Type') return { wch: 20 };
      if (h === 'S/W Ver.') return { wch: 15 };
      if (h === 'Module' || h === 'Sub-Module') return { wch: 15 };
      if (h === 'error') return { wch: 15 };
      return { wch: 20 };
    });
  },

  // Excel reading function used by server.js
  readAndNormalizeExcel: readAndNormalizeExcel,

  // Export the cleaning functions for testing
  cleanTechnicalLogs: cleanTechnicalLogs,
  cleanTitle: cleanTitle,
  cleanProblem: cleanProblem,
  cleanCauseOrCounterMeasure: cleanCauseOrCounterMeasure
};

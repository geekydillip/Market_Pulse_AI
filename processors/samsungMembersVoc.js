const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const promptTemplate = require('../prompts/samsungMembers_voc');
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

// Fix Path Resolution (MANDATORY) - relative to file location, not process.cwd()
const DISCOVERY_DIR = path.join(__dirname, '..', 'Embed_data', 'samsung_members_voc');
const DISCOVERY_FILE = path.join(DISCOVERY_DIR, 'discovery_data.json');

// Step 2: Ensure Folder Exists (MANDATORY)
if (!fs.existsSync(DISCOVERY_DIR)) {
  fs.mkdirSync(DISCOVERY_DIR, { recursive: true });
  console.log(`[DISCOVERY DIR] Created directory: ${DISCOVERY_DIR}`);
}

// Step 3: FORCE Persistence in Discovery Mode (CRITICAL)
function saveDiscoveryRecord(record) {
  let existing = [];

  if (fs.existsSync(DISCOVERY_FILE)) {
    existing = JSON.parse(fs.readFileSync(DISCOVERY_FILE, 'utf-8'));
  }

  existing.push(record);

  fs.writeFileSync(
    DISCOVERY_FILE,
    JSON.stringify(existing, null, 2),
    'utf-8'
  );

  console.log(`[DISCOVERY SAVE] Saved record to: ${DISCOVERY_FILE}, total records: ${existing.length}`);
}

/**
 * Shared header normalization utility - eliminates code duplication
 */
function normalizeHeaders(rows) {
  // Map header name variants to canonical names
  const headerMap = {
    // No
    'no': 'No',
    // Model variants
    'model no.': 'Model No.',
    'model_no': 'Model No.',
    // OS
    'os': 'OS',
    // CSC
    'csc': 'CSC',
    // Category
    'category': 'Category',
    // Application Name
    'application name': 'Application Name',
    'application_name': 'Application Name',
    'app name': 'Application Name',
    // Application Type
    'application type': 'Application Type',
    'application_type': 'Application Type',
    'app type': 'Application Type',
    // content
    'content': 'content',
    // Main Type
    'main type': 'Main Type',
    'main_type': 'Main Type',
    // Sub Type
    'sub type': 'Sub Type',
    'sub_type': 'Sub Type',
    // Module
    'module/apps': 'Module',
    'module': 'Module',
    // Sub-Module
    'sub-module': 'Sub-Module',
    'sub module': 'Sub-Module',
    // AI Insight
    'AI Insight': 'AI Insight'
  };

  // canonical columns you expect in the downstream processing
  const canonicalCols = ['No','Model No.','OS','CSC','Category','Application Name','Application Type','content','Main Type','Sub Type','Module','Sub-Module','AI Insight'];

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
  const expectedHeaderKeywords = ['model_no','os','csc','category','application_name','content','main_type','sub_type','3rd party/native','model no.','application name','main type','sub type']; // input headers (lowercase checks)
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
  id: 'samsungMembersVoc',
  expectedHeaders: ['No', 'Model No.', 'OS', 'CSC', 'Category', 'Application Name', 'Application Type', 'content', 'Main Type', 'Sub Type', 'Module', 'Sub-Module', 'Issue Type', 'Sub-Issue Type', 'AI Insight'],

  validateHeaders(rawHeaders) {
    // Check if required fields are present
    const required = ['content'];
    return required.some(header =>
      rawHeaders.includes(header) ||
      rawHeaders.some(h => h.toLowerCase().trim() === header.toLowerCase().trim())
    );
  },

  transform(rows) {
    // Apply normalization using the local normalizeHeaders function
    let transformedRows = normalizeHeaders(rows);

    // Clean content field of Excel artifacts
    transformedRows = transformedRows.map(row => {
      const cleanedRow = { ...row };
      if (cleanedRow.content) {
        cleanedRow.content = cleanedRow.content
          .replace(/_x000d_/g, '') // Remove Excel line break artifacts
          .replace(/\n+/g, ' ') // Replace multiple newlines with space
          .trim();
      }
      return cleanedRow;
    });

    return transformedRows;
  },

  buildPrompt(rows) {
    // Send only content field to AI for analysis using numbered JSON format
    const numberedInput = {};
    rows.forEach((row, index) => {
      numberedInput[(index + 1).toString()] = {
        content: row.content || ''
      };
    });
    return promptTemplate.replace('{INPUTDATA_JSON}', JSON.stringify(numberedInput, null, 2));
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

    // Handle different response formats: unwrap objects containing arrays
    if (!Array.isArray(aiRows) && typeof aiRows === 'object') {
      // Check for common wrapper keys that contain the actual array
      const possibleKeys = ['data', 'result', 'response', 'output', 'items', 'records'];
      for (const key of possibleKeys) {
        if (aiRows[key] && Array.isArray(aiRows[key])) {
          aiRows = aiRows[key];
          break;
        }
      }

      // If still not an array, check if it's a single result object and wrap it
      if (!Array.isArray(aiRows)) {
        // Check if this object has the expected fields for a single result
        const expectedFields = ['Module', 'Sub-Module', 'Issue Type', 'Sub-Issue Type', 'AI Insight'];
        const hasExpectedFields = expectedFields.some(field => aiRows.hasOwnProperty(field));

        if (hasExpectedFields) {
          // Wrap single object in array
          aiRows = [aiRows];
        } else {
          return [{ error: `AI response is not an array and doesn't contain expected fields: ${typeof aiRows} - ${Object.keys(aiRows).slice(0, 5).join(', ')}...` }];
        }
      }
    }

    // Ensure aiRows is an array
    if (!Array.isArray(aiRows)) {
      return [{ error: `AI response is not an array: ${typeof aiRows}` }];
    }

    // Validate that AI response contains expected fields per new prompt format
    const expectedFields = ['Module', 'Sub-Module', 'Issue Type', 'Sub-Issue Type', 'AI Insight'];

    // Merge AI results with original core identifiers (preserving original Excel fields + AI fields)
    const mergedRows = aiRows.map((aiRow, index) => {
      const original = originalRows[index] || {};

      // Validate AI row has expected fields
      const isValidAiRow = expectedFields.every(field => aiRow.hasOwnProperty(field));
      if (!isValidAiRow) {
        console.warn(`AI row ${index} missing expected fields. Available:`, Object.keys(aiRow));
      }

      return {
        'No': original['No'] || original['S/N'] || '',  // Preserve original No column data
        'Model No.': original['Model No.'] || '',
        'OS': original['OS'] || '',
        'CSC': original['CSC'] || '',
        'Category': original['Category'] || '',
        'Application Name': original['Application Name'] || '',
        'Application Type': original['Application Type'] || '',
        'content': original['content'] || '',  // Reuse from input (already cleaned)
        'Main Type': original['Main Type'] || '',
        'Sub Type': original['Sub Type'] || '',
        'Module': aiRow['Module'] || '',
        'Sub-Module': aiRow['Sub-Module'] || '',
        'Issue Type': aiRow['Issue Type'] || '',
        'Sub-Issue Type': aiRow['Sub-Issue Type'] || '',
        'AI Insight': aiRow['AI Insight'] || ''
      };
    });

    return mergedRows;
  },

  // Discovery mode response formatter
  formatDiscoveryResponse(aiResult, originalRows, sourceFile = '', context = {}) {
    let aiRows;

    // Handle different response formats: object, JSON string, or raw text
    if (typeof aiResult === 'object' && aiResult !== null) {
      aiRows = aiResult;
    } else if (typeof aiResult === 'string') {
      const text = aiResult.trim();
      try {
        aiRows = JSON.parse(text);
      } catch (e) {
        return [{ error: `Failed to parse AI response: ${text.substring(0, 200)}...` }];
      }
    } else {
      return [{ error: `Unexpected AI response type: ${typeof aiResult}` }];
    }

    if (!Array.isArray(aiRows)) {
      return [{ error: `AI response is not an array: ${typeof aiRows}` }];
    }

    // Clean AI response to remove Excel styling artifacts
    const cleanedAiRows = aiRows.map(row => cleanObjectRecursively(row));
    console.log(`[Discovery] Cleaned ${cleanedAiRows.length} AI rows of styling artifacts`);

    // Generate unique run_id for this discovery run
    const runId = context.runId || new Date().toISOString().replace(/[:.]/g, '').substring(0, 15);
    const chunkId = context.chunkId || 0;

    // Build discovery results and save each record
    const discoveryResults = cleanedAiRows.map((aiRow, index) => {
      const original = originalRows[index] || {};

      // Use composite identity: run_id + chunk_id + row_index
      const globalRowId = `${runId}_${chunkId}_${index}`;

      const discoveryRecord = {
        run_id: runId,
        row_id: globalRowId,
        raw_discovery: {
          module: aiRow.module || aiRow.Module || '',
          sub_module: aiRow.sub_module || aiRow['Sub-Module'] || '',
          issue_type: aiRow.issue_type || aiRow['Issue Type'] || '',
          sub_issue_type: aiRow.sub_issue_type || aiRow['Sub-Issue Type'] || ''
        },
        raw_text: original.content || '',
        source_file: sourceFile,
        timestamp: new Date().toISOString(),
        embedding_ids: context.embeddingIds || {}, // Link to stored embeddings
        mode: 'discovery'
      };

      // FORCE Persistence - call unconditionally in discovery mode
      saveDiscoveryRecord(discoveryRecord);

      // Return only essential discovery fields (exclude Excel styling metadata)
      // Explicitly create clean object to prevent any metadata contamination
      const cleanResult = {
        row_id: globalRowId,
        raw_discovery: discoveryRecord.raw_discovery,
        mode: 'discovery'
      };

      return cleanResult;
    });

    return discoveryResults;
  },

  // Returns column width configurations for Excel export
  getColumnWidths(finalHeaders) {
    return finalHeaders.map((h, idx) => {
      if (['content', 'AI Insight'].includes(h)) return { wch: 41 };
      if (h === 'Application Name') return { wch: 25 };
      if (['No', 'Model No.', 'OS', 'CSC'].includes(h)) return { wch: 15 };
      if (['Category', 'Application Type', 'Main Type', 'Sub Type', 'Module', 'Sub-Module', 'Issue Type', 'Sub-Issue Type'].includes(h)) return { wch: 15 };
      if (h === 'error') return { wch: 15 };
      return { wch: 20 };
    });
  },

  // Excel reading function used by server.js
  readAndNormalizeExcel: readAndNormalizeExcel,

  // Export for testing
  saveDiscoveryRecord: saveDiscoveryRecord
};

const xlsx = require('xlsx');
const promptTemplate = require('../prompts/samsungMembersPlmPrompt');
const discoveryPromptTemplate = require('../prompts/samsungMembersPlmPrompt_discovery');
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
  const canonicalCols = ['Case Code','Model No.','Progr.Stat.','S/W Ver.','Title','Feature','Problem','Resolve Option(Medium)','Resolve Option(Small)','Cause','Counter Measure'];

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
  const expectedHeaderKeywords = ['Case Code','Model No.','Progr.Stat.','S/W Ver.','Title','Feature','Problem','Resolve Option(Medium)','Resolve Option(Small)','Cause','Counter Measure','Issue Type','Sub-Issue Type']; // lowercase checks
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

/**
 * Parse AI response and extract structured data
 * @param {string} response - AI response text
 * @param {number} rowCount - Number of rows to expect
 * @returns {Array} Parsed results for each row
 */
function parseAIResponse(response, rowCount) {
  try {
    // Try to parse as JSON first
    const parsed = JSON.parse(response);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (e) {
    // If not JSON, try to parse as structured text
    const lines = response.split('\n').filter(line => line.trim());
    const results = [];
    let currentRow = null;
    let currentResult = {};

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Check if line starts with a row number
      const rowMatch = trimmed.match(/^(\d+):\s*(.*)/);
      if (rowMatch) {
        if (currentRow !== null && currentResult) {
          results.push(currentResult);
        }
        currentRow = parseInt(rowMatch[1]);
        currentResult = {};
      }
      
      // Extract Module
      const moduleMatch = trimmed.match(/Module:\s*(.+)/i);
      if (moduleMatch) {
        currentResult.Module = moduleMatch[1].trim();
      }
      
      // Extract Sub-Module
      const subModuleMatch = trimmed.match(/Sub-Module:\s*(.+)/i);
      if (subModuleMatch) {
        currentResult['Sub-Module'] = subModuleMatch[1].trim();
      }
      
      // Extract Issue Type
      const issueTypeMatch = trimmed.match(/Issue Type:\s*(.+)/i);
      if (issueTypeMatch) {
        currentResult['Issue Type'] = issueTypeMatch[1].trim();
      }
      
      // Extract Sub-Issue Type
      const subIssueTypeMatch = trimmed.match(/Sub-Issue Type:\s*(.+)/i);
      if (subIssueTypeMatch) {
        currentResult['Sub-Issue Type'] = subIssueTypeMatch[1].trim();
      }
      
      // Extract Summarized Problem
      const summarizedProblemMatch = trimmed.match(/Summarized Problem:\s*(.+)/i);
      if (summarizedProblemMatch) {
        currentResult['Summarized Problem'] = summarizedProblemMatch[1].trim();
      }
      
      // Extract Severity
      const severityMatch = trimmed.match(/Severity:\s*(.+)/i);
      if (severityMatch) {
        currentResult.Severity = severityMatch[1].trim();
      }
      
      // Extract Severity Reason
      const severityReasonMatch = trimmed.match(/Severity Reason:\s*(.+)/i);
      if (severityReasonMatch) {
        currentResult['Severity Reason'] = severityReasonMatch[1].trim();
      }
      
      // Extract R&D Comment
      const rdCommentMatch = trimmed.match(/R&D Comment:\s*(.+)/i);
      if (rdCommentMatch) {
        currentResult['R&D Comment'] = rdCommentMatch[1].trim();
      }
    }
    
    if (currentResult && Object.keys(currentResult).length > 0) {
      results.push(currentResult);
    }
    
    return results;
  }
  
  return [];
}

/**
 * Samsung Members PLM Processor
 * Main processing function that handles both regular and discovery modes
 * @param {Array} rows - Input data rows
 * @param {Object} context - Processing context with mode and other options
 * @returns {Promise<Array>} Processed rows with AI insights
 */
async function samsungMembersPlmProcessor(rows, context = {}) {
  const { mode = 'regular', prompt: customPrompt, model = 'qwen3:4b-instruct' } = context;

  // Use appropriate prompt based on mode
  const prompt = customPrompt || (mode === 'discovery' ? discoveryPromptTemplate : promptTemplate);

  // Apply normalization using the local normalizeHeaders function
  let transformedRows = normalizeHeaders(rows);

  // Clean technical logs from Cause and Countermeasure fields
  transformedRows = transformedRows.map(row => {
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

  // Build prompt for AI processing
  const numberedInput = {};
  transformedRows.forEach((row, index) => {
    numberedInput[(index + 1).toString()] = {
      Title: row.Title || '',
      Problem: row.Problem || '',
      Feature: row.Feature || '',
      'Resolve Option(Medium)': row['Resolve Option(Medium)'] || '',
      'Resolve Option(Small)': row['Resolve Option(Small)'] || '',
      Cause: row.Cause || '',
      'Counter Measure': row['Counter Measure'] || ''
    };
  });
  const aiPrompt = prompt.replace('{INPUTDATA_JSON}', JSON.stringify(numberedInput, null, 2));

  try {
    // Call Ollama AI service
    console.log(`[SamsungMembersPlm] Processing ${transformedRows.length} rows with AI...`);
    const aiResponse = await ollamaClient.callOllama(aiPrompt, model);
    
    // Parse the AI response
    const parsedResults = parseAIResponse(aiResponse, transformedRows.length);
    
    // Merge AI results with original data
    const finalRows = transformedRows.map((row, index) => {
      const aiResult = parsedResults[index] || {};
      // Check if the AI returned a valid object for this row
      const isAiFail = !parsedResults[index] || Object.keys(aiResult).length === 0;

      return {
        ...row,
        'Module': isAiFail ? 'AI Analysis Failed' : (aiResult.Module || ''),
        'Sub-Module': aiResult['Sub-Module'] || '',
        'Issue Type': aiResult['Issue Type'] || '',
        'Sub-Issue Type': aiResult['Sub-Issue Type'] || '',
        'Summarized Problem': isAiFail ? 'Error: Model failed to provide insight' : (aiResult['Summarized Problem'] || ''),
        'Severity': aiResult.Severity || '',
        'Severity Reason': aiResult['Severity Reason'] || '',
        'R&D Comment': aiResult['R&D Comment'] || ''
      };
    });

    return finalRows;
  } catch (error) {
    console.error('[SamsungMembersPlm] AI processing failed:', error);
    
    // Return rows with error information if AI fails
    return transformedRows.map(row => ({
      ...row,
      'Module': 'ERROR: AI processing failed',
      'Sub-Module': '',
      'Issue Type': '',
      'Sub-Issue Type': '',
      'Summarized Problem': `Error: ${error.message}`,
      'Severity': '',
      'Severity Reason': '',
      'R&D Comment': ''
    }));
  }
}

// Add expected headers for the processor
samsungMembersPlmProcessor.expectedHeaders = ['Case Code','Model No.','Progr.Stat.','S/W Ver.','Title','Feature','Problem','Resolve Option(Medium)','Resolve Option(Small)','Cause','Counter Measure'];
samsungMembersPlmProcessor.readAndNormalizeExcel = readAndNormalizeExcel;

module.exports = samsungMembersPlmProcessor;

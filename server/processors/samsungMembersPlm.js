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
 * Enhanced with fuzzy matching and edge case handling
 */
function normalizeHeaders(rows) {
  // Map header name variants to canonical names with enhanced matching
  const headerMap = {
    // Model variants - enhanced with fuzzy matching
    'model no.': 'Model No.',
    'model_no': 'Model No.',
    'modelno': 'Model No.',
    'model number': 'Model No.',
    'modelnumber': 'Model No.',
    'model': 'Model No.',
    'dev. mdl. name/item name': 'Model No.',
    'dev_mdl_name_item_name': 'Model No.',
    'dev mdl name/item name': 'Model No.',
    
    // Case Code variants
    'case code': 'Case Code',
    'case_code': 'Case Code',
    'casecode': 'Case Code',
    'case id': 'Case Code',
    'caseid': 'Case Code',
    'case number': 'Case Code',
    'casenumber': 'Case Code',
    
    // S/W Ver variants
    's/w ver.': 'S/W Ver.',
    'sw ver': 'S/W Ver.',
    'swver': 'S/W Ver.',
    'software version': 'S/W Ver.',
    'software_version': 'S/W Ver.',
    'version': 'S/W Ver.',
    
    // Title variants
    'title': 'Title',
    'subject': 'Title',
    'issue title': 'Title',
    'issue_title': 'Title',
    'summary': 'Title',
    
    // Problem variants
    'problem': 'Problem',
    'description': 'Problem',
    'issue description': 'Problem',
    'issue_description': 'Problem',
    'details': 'Problem',
    'problem description': 'Problem',
    'problem_description': 'Problem',
    
    // Progr.Stat variants
    'progr.stat.': 'Progr.Stat.',
    'progstat': 'Progr.Stat.',
    'progress status': 'Progr.Stat.',
    'progress_status': 'Progr.Stat.',
    'progress': 'Progr.Stat.',
    'status': 'Progr.Stat.',
    
    // Resolve Option variants
    'resolve option(medium)': 'Resolve Option(Medium)',
    'resolve_option(medium)': 'Resolve Option(Medium)',
    'medium resolve': 'Resolve Option(Medium)',
    'medium_resolve': 'Resolve Option(Medium)',
    'resolve option(small)': 'Resolve Option(Small)',
    'resolve_option(small)': 'Resolve Option(Small)',
    'small resolve': 'Resolve Option(Small)',
    'small_resolve': 'Resolve Option(Small)',
    
    // Feature variants
    'feature': 'Feature',
    'module': 'Feature',
    'component': 'Feature',
    'product': 'Feature',
    
    // Cause variants
    'cause': 'Cause',
    'root cause': 'Cause',
    'rootcause': 'Cause',
    'reason': 'Cause',
    
    // Counter Measure variants
    'counter measure': 'Counter Measure',
    'counter_measure': 'Counter Measure',
    'solution': 'Counter Measure',
    'fix': 'Counter Measure',
    'workaround': 'Counter Measure'
  };

  // canonical columns you expect in the downstream processing
  const canonicalCols = ['Case Code','Model No.','Progr.Stat.','S/W Ver.','Title','Feature','Problem','Resolve Option(Medium)','Resolve Option(Small)','Cause','Counter Measure'];

  const normalizedRows = rows.map(orig => {
    const out = {};
    // Build a reverse map of original header -> canonical (if possible)
    const keyMap = {}; // rawKey -> canonical
    Object.keys(orig).forEach(rawKey => {
      const norm = String(rawKey || '').trim().toLowerCase();
      const normNoSpaces = norm.replace(/\s+|\./g, '');
      
      // Try exact match first
      let mapped = headerMap[norm] || headerMap[normNoSpaces];
      
      // If no exact match, try fuzzy matching
      if (!mapped) {
        // Check for partial matches (e.g., "Problem Description" -> "Problem")
        for (const [key, value] of Object.entries(headerMap)) {
          if (norm.includes(key) || normNoSpaces.includes(key.replace(/\s+|\./g, ''))) {
            mapped = value;
            break;
          }
        }
      }
      
      if (mapped) {
        keyMap[rawKey] = mapped;
      } else {
        // try exact match to canonical
        for (const c of canonicalCols) {
          if (norm === String(c).toLowerCase() || normNoSpaces === String(c).toLowerCase().replace(/\s+|\./g, '')) {
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
      if (found === null && Object.prototype.hasOwnProperty.call(orig, tgt)) {
        found = orig[tgt];
      }
    // Final fallback: check for partial matches in raw keys with enhanced fuzzy matching
      if (found === null) {
        const tgtNorm = tgt.toLowerCase().replace(/\s+|\./g, '');
        for (const rawKey of Object.keys(orig)) {
          const rawKeyNorm = String(rawKey || '').toLowerCase().replace(/\s+|\./g, '');
          
          // Enhanced fuzzy matching for common variations
          if (rawKeyNorm.includes(tgtNorm) || tgtNorm.includes(rawKeyNorm)) {
            found = orig[rawKey];
            break;
          }
          
          // Special case: "Problem Description" -> "Problem"
          if (tgtNorm === 'problem' && rawKeyNorm.includes('problem') && rawKeyNorm.includes('description')) {
            found = orig[rawKey];
            break;
          }
          
          // Special case: "Model Number" -> "Model No."
          if (tgtNorm === 'modelno' && rawKeyNorm.includes('model') && rawKeyNorm.includes('number')) {
            found = orig[rawKey];
            break;
          }
          
          // Special case: "Progress Status" -> "Progr.Stat."
          if (tgtNorm === 'progstat' && rawKeyNorm.includes('progress') && rawKeyNorm.includes('status')) {
            found = orig[rawKey];
            break;
          }
        }
      }
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
 * Clean markdown bullets and list prefixes from lines
 * @param {string} line - Line to clean
 * @returns {string} Cleaned line
 */
function cleanLine(line) {
  return line.replace(/^[\s*\-+\d.]+\s*/, '').trim();
}

/**
 * Map multiple label variations to canonical keys
 */
const labelMap = {
  'Module': [/Module/i, /Feature/i, /Component/i, /Product/i],
  'Sub-Module': [/Sub-Module/i, /Sub-Feature/i, /Component/i],
  'Issue Type': [/Issue Type/i, /Issue Category/i, /Type/i],
  'Sub-Issue Type': [/Sub-Issue Type/i, /Sub-Type/i, /Subcategory/i],
  'Summarized Problem': [/Summarized Problem/i, /Problem Summary/i, /Summary/i],
  'Severity': [/Severity/i, /Impact/i, /Priority/i, /Urgency/i],
  'Severity Reason': [/Severity Reason/i, /Impact Reason/i, /Priority Reason/i, /Why/i],
  'R&D Comment': [/R&D Comment/i, /R&D Remarks/i, /Comment/i, /Notes/i]
};

/**
 * Enhanced regex patterns with flexible separators
 */
const labelPatterns = {
  'Module': /Module\s*[:\-=]\s*(.+)/i,
  'Sub-Module': /Sub-Module\s*[:\-=]\s*(.+)/i,
  'Issue Type': /Issue Type\s*[:\-=]\s*(.+)/i,
  'Sub-Issue Type': /Sub-Issue Type\s*[:\-=]\s*(.+)/i,
  'Summarized Problem': /Summarized Problem\s*[:\-=]\s*(.+)/i,
  'Severity': /Severity\s*[:\-=]\s*(.+)/i,
  'Severity Reason': /Severity Reason\s*[:\-=]\s*(.+)/i,
  'R&D Comment': /R&D Comment\s*[:\-=]\s*(.+)/i
};

/**
 * Check if a line matches any known label pattern
 * @param {string} line - Line to check
 * @returns {Object|null} Match result with key and value
 */
function checkLabelMatch(line) {
  for (const [key, pattern] of Object.entries(labelPatterns)) {
    const match = line.match(pattern);
    if (match) {
      return {
        key: key,
        value: match[1].trim()
      };
    }
  }
  return null;
}

/**
 * Parse AI response and extract structured data with robust fallback strategies
 * @param {string} response - AI response text
 * @param {number} rowCount - Number of rows to expect
 * @returns {Array} Parsed results for each row
 */
function parseAIResponse(response, rowCount) {
  console.log(`[parseAIResponse] Starting parsing for ${rowCount} rows`);
  console.log(`[parseAIResponse] Response length: ${response.length} characters`);
  
  // Stage 1: Enhanced JSON Parsing with bracket slicing
  try {
    let jsonCandidate = response.trim();
    const firstBracket = jsonCandidate.indexOf('[');
    const lastBracket = jsonCandidate.lastIndexOf(']');
    
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      jsonCandidate = jsonCandidate.substring(firstBracket, lastBracket + 1);
      console.log(`[parseAIResponse] Extracted JSON candidate: ${jsonCandidate.substring(0, 100)}...`);
      
      try {
        const parsed = JSON.parse(jsonCandidate);
        if (Array.isArray(parsed)) {
          console.log(`[parseAIResponse] JSON parsing successful, extracted ${parsed.length} items`);
          return parsed;
        }
      } catch (jsonError) {
        console.log(`[parseAIResponse] JSON parsing failed: ${jsonError.message}`);
      }
    }
  } catch (e) {
    console.log(`[parseAIResponse] Stage 1 JSON parsing failed: ${e.message}`);
  }
  
  // Stage 2: Flexible text parsing with state-based multi-line support
  console.log(`[parseAIResponse] Falling back to text parsing...`);
  
  const lines = response.split('\n').filter(line => line.trim());
  const results = [];
  let currentRow = null;
  let currentResult = {};
  let currentKey = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Skip empty lines
    if (!trimmed) continue;
    
    // Check if line starts with a row number
    const rowMatch = trimmed.match(/^(\d+):\s*(.*)/);
    if (rowMatch) {
      if (currentRow !== null && currentResult && Object.keys(currentResult).length > 0) {
        results.push(currentResult);
        console.log(`[parseAIResponse] Completed row ${currentRow}:`, Object.keys(currentResult));
      }
      currentRow = parseInt(rowMatch[1]);
      currentResult = {};
      currentKey = null;
      
      // Process the rest of the line after the row number
      const restOfLine = rowMatch[2].trim();
      if (restOfLine) {
        const match = checkLabelMatch(restOfLine);
        if (match) {
          currentResult[match.key] = match.value;
          currentKey = match.key;
        }
      }
      continue;
    }
    
    // Clean markdown bullets and list prefixes
    const cleanedLine = cleanLine(trimmed);
    if (!cleanedLine) continue;
    
    // Check for new label
    const match = checkLabelMatch(cleanedLine);
    if (match) {
      currentKey = match.key;
      currentResult[match.key] = match.value;
      continue;
    }
    
    // Stage 3: Multi-line value capture - if no new key found but we have a current key, append to it
    if (currentKey && currentResult[currentKey]) {
      // Only append if this looks like continuation text (not a new section header)
      if (!/^(Module|Sub-Module|Issue Type|Sub-Issue Type|Summarized Problem|Severity|Severity Reason|R&D Comment)\s*[:\-=]/i.test(cleanedLine)) {
        currentResult[currentKey] += ' ' + cleanedLine;
      }
    }
  }
  
  // Add the last result if it exists
  if (currentResult && Object.keys(currentResult).length > 0) {
    results.push(currentResult);
    console.log(`[parseAIResponse] Completed final row ${currentRow}:`, Object.keys(currentResult));
  }
  
  console.log(`[parseAIResponse] Text parsing completed, extracted ${results.length} items`);
  
  // Stage 4: Validation and cleanup
  if (results.length === 0) {
    console.log(`[parseAIResponse] No results extracted, returning empty array`);
    return [];
  }
  
  // Ensure all results have the expected structure
  const expectedKeys = Object.keys(labelPatterns);
  const validatedResults = results.map(result => {
    const validated = {};
    expectedKeys.forEach(key => {
      validated[key] = result[key] || '';
    });
    return validated;
  });
  
  console.log(`[parseAIResponse] Parsing completed successfully with ${validatedResults.length} validated results`);
  return validatedResults;
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

/**
 * Flexible header validation function for samsungMembersPlm processor
 * Handles header variations and provides clear error messages
 * @param {Array} headers - Array of header names from the uploaded file
 * @returns {boolean} True if headers are valid, false otherwise
 */
function validate(headers) {
  console.log('[SamsungMembersPlm] Validating headers:', headers);
  
  // Define required headers with their acceptable variations
  const requiredHeaders = {
    'Case Code': ['case code', 'case_code', 'case id', 'plm code'],
    'Model No.': ['model no', 'model_no', 'model', 'dev. mdl. name/item name'],
    'Title': ['title', 'subject', 'issue title'],
    'Problem': ['problem', 'description', 'issue description', 'details']
  };

  // Track which required headers we found
  const foundHeaders = {};
  const missingHeaders = [];
  
  // Normalize input headers for comparison
  const normalizedHeaders = headers.map(h => String(h || '').toLowerCase().trim());

  // Check each required header
  for (const [canonicalName, variations] of Object.entries(requiredHeaders)) {
    let headerFound = false;
    
    // Check exact match first
    if (normalizedHeaders.includes(canonicalName.toLowerCase())) {
      headerFound = true;
      foundHeaders[canonicalName] = canonicalName;
    } else {
      // Check variations
      for (const variation of variations) {
        if (normalizedHeaders.includes(variation)) {
          headerFound = true;
          foundHeaders[canonicalName] = variation;
          break;
        }
      }
    }
    
    if (!headerFound) {
      missingHeaders.push(canonicalName);
    }
  }

  // Log validation results
  console.log('[SamsungMembersPlm] Header validation results:');
  console.log('  Found headers:', foundHeaders);
  console.log('  Missing headers:', missingHeaders);

  // Define core headers that MUST be present for the AI to work
  const coreHeaders = ['Case Code', 'Model No.', 'Title', 'Problem'];
  const coreMissing = coreHeaders.filter(header => missingHeaders.includes(header));
  
  if (coreMissing.length > 0) {
    console.error(`[SamsungMembersPlm] Missing core headers: ${coreMissing.join(', ')}`);
    return false;
  }

  console.log('[SamsungMembersPlm] Header validation passed');
  return true;
}

// Add expected headers for the processor
samsungMembersPlmProcessor.expectedHeaders = ['Case Code','Model No.','Progr.Stat.','S/W Ver.','Title','Feature','Problem','Resolve Option(Medium)','Resolve Option(Small)','Cause','Counter Measure'];
samsungMembersPlmProcessor.readAndNormalizeExcel = readAndNormalizeExcel;
samsungMembersPlmProcessor.validate = validate;

module.exports = samsungMembersPlmProcessor;

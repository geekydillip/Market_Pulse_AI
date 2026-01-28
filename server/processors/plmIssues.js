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
 * Parse AI response and extract structured data with robust error handling
 * @param {string} response - AI response text
 * @param {number} rowCount - Number of rows to expect
 * @returns {Array} Parsed results for each row
 */
function parseAIResponse(response, rowCount) {
  console.log(`[PlmIssues] Starting AI response parsing for ${rowCount} rows...`);
  console.log(`[PlmIssues] Response length: ${response.length} characters`);
  
  try {
    // Enhanced JSON parsing with bracket slicing to handle markdown blocks
    let jsonCandidate = response.trim();
    const firstBracket = jsonCandidate.indexOf('[');
    const lastBracket = jsonCandidate.lastIndexOf(']');
    
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      jsonCandidate = jsonCandidate.substring(firstBracket, lastBracket + 1);
      console.log(`[PlmIssues] Extracted JSON candidate: ${jsonCandidate.substring(0, 100)}...`);
      
      try {
        const parsed = JSON.parse(jsonCandidate);
        if (Array.isArray(parsed)) {
          console.log(`[PlmIssues] Successfully parsed ${parsed.length} items from JSON`);
          return parsed;
        }
      } catch (jsonError) {
        console.log(`[PlmIssues] JSON parsing failed: ${jsonError.message}`);
      }
    }
    
    // Fallback to text parsing with flexible patterns
    console.log(`[PlmIssues] Falling back to text parsing...`);
    const lines = response.split('\n').filter(line => line.trim());
    const results = [];
    let currentRow = null;
    let currentResult = {};
    let currentField = null;
    let fieldBuffer = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Skip empty lines
      if (!trimmed) continue;
      
      // Clean bullet points and list markers
      const cleanedLine = trimmed.replace(/^[\s*\-+\d.]+\s*/, '').trim();
      
      // Check if line starts with a row number
      const rowMatch = cleanedLine.match(/^(\d+):\s*(.*)/);
      if (rowMatch) {
        if (currentRow !== null && currentResult) {
          results.push(currentResult);
        }
        currentRow = parseInt(rowMatch[1]);
        currentResult = {};
        currentField = null;
        fieldBuffer = '';
        
        // Process the rest of the line after the row number
        const restOfLine = rowMatch[2].trim();
        if (restOfLine) {
          // Try to extract field from the same line
          const fieldMatch = restOfLine.match(/^(Module|Sub-Module|Issue Type|Sub-Issue Type|Summarized Problem|Severity|Severity Reason)\s*[:\-=]\s*(.+)/i);
          if (fieldMatch) {
            currentField = fieldMatch[1].trim();
            fieldBuffer = fieldMatch[2].trim();
          }
        }
        continue;
      }
      
      // Flexible field extraction with multiple separator support
      const fieldMatch = cleanedLine.match(/^(Module|Sub-Module|Issue Type|Sub-Issue Type|Summarized Problem|Severity|Severity Reason)\s*[:\-=]\s*(.+)/i);
      if (fieldMatch) {
        // Save previous field if exists
        if (currentField && fieldBuffer) {
          currentResult[currentField] = fieldBuffer.trim();
        }
        
        // Start new field
        currentField = fieldMatch[1].trim();
        fieldBuffer = fieldMatch[2].trim();
        continue;
      }
      
      // Handle continuation lines (multi-line field values)
      if (currentField && cleanedLine.length > 0) {
        // Check if this line looks like a new field (starts with a field name)
        const potentialNewField = cleanedLine.match(/^(Module|Sub-Module|Issue Type|Sub-Issue Type|Summarized Problem|Severity|Severity Reason)\s*[:\-=]/i);
        
        if (!potentialNewField) {
          // This is a continuation of the current field
          fieldBuffer += ' ' + cleanedLine;
        } else {
          // This is a new field, save the current one
          if (currentField && fieldBuffer) {
            currentResult[currentField] = fieldBuffer.trim();
          }
          currentField = potentialNewField[1].trim();
          fieldBuffer = cleanedLine.replace(potentialNewField[0], '').trim();
        }
      }
    }
    
    // Save the last field and result
    if (currentField && fieldBuffer) {
      currentResult[currentField] = fieldBuffer.trim();
    }
    
    if (currentResult && Object.keys(currentResult).length > 0) {
      results.push(currentResult);
    }
    
    console.log(`[PlmIssues] Text parsing completed, extracted ${results.length} results`);
    
    // Validation and cleanup
    const validatedResults = results.map(result => {
      const cleaned = {};
      for (const [key, value] of Object.entries(result)) {
        if (value && typeof value === 'string' && value.trim()) {
          cleaned[key] = value.trim();
        }
      }
      return cleaned;
    });
    
    console.log(`[PlmIssues] Final validation: ${validatedResults.length} valid results`);
    return validatedResults;
    
  } catch (error) {
    console.error(`[PlmIssues] Critical parsing error: ${error.message}`);
    console.error(`[PlmIssues] Response preview: ${response.substring(0, 200)}...`);
    return [];
  }
}

/**
 * PLM Issues Processor
 * Main processing function that handles both regular and discovery modes
 * @param {Array} rows - Input data rows
 * @param {Object} context - Processing context with mode and other options
 * @returns {Promise<Array>} Processed rows with AI insights
 */
async function plmIssuesProcessor(rows, context = {}) {
  const { mode = 'regular', prompt: customPrompt, model = 'qwen3:4b-instruct' } = context;

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

  try {
    // Call Ollama AI service
    console.log(`[PlmIssues] Processing ${transformedRows.length} rows with AI...`);
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
        'Severity Reason': aiResult['Severity Reason'] || ''
      };
    });

    return finalRows;
  } catch (error) {
    console.error('[PlmIssues] AI processing failed:', error);
    
    // Return rows with error information if AI fails
    return transformedRows.map(row => ({
      ...row,
      'Module': 'ERROR: AI processing failed',
      'Sub-Module': '',
      'Issue Type': '',
      'Sub-Issue Type': '',
      'Summarized Problem': `Error: ${error.message}`,
      'Severity': '',
      'Severity Reason': ''
    }));
  }
}

/**
 * Flexible header validation function for plmIssues processor
 * Handles header variations and provides clear error messages
 * @param {Array} headers - Array of header names from the uploaded file
 * @returns {boolean} True if headers are valid, false otherwise
 */
function validate(headers) {
  console.log('[PlmIssues] Validating headers:', headers);
  
  // Define required headers with their acceptable variations
  const requiredHeaders = {
    'Case Code': ['case code', 'case_code', 'casecode', 'case id', 'caseid'],
    'Model No.': ['model no', 'model_no', 'modelno', 'model number', 'modelnumber', 'model'],
    'Progr.Stat.': ['progr.stat', 'progstat', 'progress status', 'progress_status', 'progress', 'status'],
    'Title': ['title', 'subject', 'issue title', 'issue_title'],
    'Priority': ['priority', 'severity', 'urgency', 'importance'],
    'Occurr. Freq.': ['occurr. freq', 'occur freq', 'occurrence frequency', 'occurrence_frequency', 'frequency'],
    'S/W Ver.': ['s/w ver', 'sw ver', 'swver', 'software version', 'software_version', 'version'],
    'Problem': ['problem', 'description', 'issue description', 'issue_description', 'details']
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
  console.log('[PlmIssues] Header validation results:');
  console.log('  Found headers:', foundHeaders);
  console.log('  Missing headers:', missingHeaders);

  // If we have at least the core required headers, consider it valid
  const coreHeaders = ['Case Code', 'Model No.', 'Title', 'Problem'];
  const coreMissing = coreHeaders.filter(header => missingHeaders.includes(header));
  
  if (coreMissing.length > 0) {
    console.error(`[PlmIssues] Missing core headers: ${coreMissing.join(', ')}`);
    return false;
  }

  // For non-core headers, log warnings but don't fail validation
  const nonCoreMissing = missingHeaders.filter(header => !coreHeaders.includes(header));
  if (nonCoreMissing.length > 0) {
    console.warn(`[PlmIssues] Missing non-core headers (will use defaults): ${nonCoreMissing.join(', ')}`);
  }

  console.log('[PlmIssues] Header validation passed');
  return true;
}

// Add expected headers for the processor
plmIssuesProcessor.expectedHeaders = ['Case Code','Model No.','Progr.Stat.','Title','Priority','Occurr. Freq.','S/W Ver.','Problem'];
plmIssuesProcessor.readAndNormalizeExcel = readAndNormalizeExcel;
plmIssuesProcessor.validate = validate;

module.exports = plmIssuesProcessor;

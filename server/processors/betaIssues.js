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
 * Parse AI response and extract structured data with robust error handling
 * @param {string} response - AI response text
 * @param {number} rowCount - Number of rows to expect
 * @returns {Array} Parsed results for each row
 */
function parseAIResponse(response, rowCount) {
  console.log(`[BetaIssues] Starting AI response parsing for ${rowCount} rows...`);
  console.log(`[BetaIssues] Response length: ${response.length} characters`);
  
  try {
    // Enhanced JSON parsing with bracket slicing to handle markdown blocks
    let jsonCandidate = response.trim();
    const firstBracket = jsonCandidate.indexOf('[');
    const lastBracket = jsonCandidate.lastIndexOf(']');
    
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      jsonCandidate = jsonCandidate.substring(firstBracket, lastBracket + 1);
      console.log(`[BetaIssues] Extracted JSON candidate: ${jsonCandidate.substring(0, 100)}...`);
      
      try {
        const parsed = JSON.parse(jsonCandidate);
        if (Array.isArray(parsed)) {
          console.log(`[BetaIssues] Successfully parsed ${parsed.length} items from JSON`);
          return parsed;
        }
      } catch (jsonError) {
        console.log(`[BetaIssues] JSON parsing failed: ${jsonError.message}`);
      }
    }
    
    // Fallback to text parsing with flexible patterns
    console.log(`[BetaIssues] Falling back to text parsing...`);
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
    
    console.log(`[BetaIssues] Text parsing completed, extracted ${results.length} results`);
    
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
    
    console.log(`[BetaIssues] Final validation: ${validatedResults.length} valid results`);
    return validatedResults;
    
  } catch (error) {
    console.error(`[BetaIssues] Critical parsing error: ${error.message}`);
    console.error(`[BetaIssues] Response preview: ${response.substring(0, 200)}...`);
    return [];
  }
}

/**
 * Beta Issues Processor
 * Main processing function that handles both regular and discovery modes
 * @param {Array} rows - Input data rows
 * @param {Object} context - Processing context with mode and other options
 * @returns {Promise<Array>} Processed rows with AI insights
 */
async function betaIssuesProcessor(rows, context = {}) {
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
      Problem: row.Problem || ''
    };
  });
  const aiPrompt = prompt.replace('{INPUTDATA_JSON}', JSON.stringify(numberedInput, null, 2));

  try {
    // Call Ollama AI service
    console.log(`[BetaIssues] Processing ${transformedRows.length} rows with AI...`);
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
    console.error('[BetaIssues] AI processing failed:', error);
    
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
 * Flexible header validation function for betaIssues processor
 * Handles header variations and provides clear error messages
 * @param {Array} headers - Array of header names from the uploaded file
 * @returns {boolean} True if headers are valid, false otherwise
 */
function validate(headers) {
  console.log('[BetaIssues] Validating headers:', headers);
  
  // Define required headers with their acceptable variations
  const requiredHeaders = {
    'Case Code': ['case code', 'case_code', 'case id', 'id'],
    'Model No.': ['model no', 'model_no', 'model'],
    'Title': ['title', 'subject'],
    'Problem': ['problem', 'description']
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
  console.log('[BetaIssues] Header validation results:');
  console.log('  Found headers:', foundHeaders);
  console.log('  Missing headers:', missingHeaders);

  // Define core headers that MUST be present for the AI to work
  const coreHeaders = ['Case Code', 'Model No.', 'Title', 'Problem'];
  const coreMissing = coreHeaders.filter(header => missingHeaders.includes(header));
  
  if (coreMissing.length > 0) {
    console.error(`[BetaIssues] Missing core headers: ${coreMissing.join(', ')}`);
    return false;
  }

  console.log('[BetaIssues] Header validation passed');
  return true;
}

// Add expected headers for the processor
betaIssuesProcessor.expectedHeaders = ['Case Code','Model No.','Progr.Stat.','S/W Ver.','Title','Problem','Resolve Option(Medium)'];
betaIssuesProcessor.readAndNormalizeExcel = readAndNormalizeExcel;
betaIssuesProcessor.validate = validate;

module.exports = betaIssuesProcessor;

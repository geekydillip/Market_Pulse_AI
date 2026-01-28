const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const promptTemplate = require('../prompts/samsungMembers_voc');
const { cleanExcelStyling } = require('./_helpers');
const ollamaClient = require('../ollamaClient');

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
  const canonicalCols = ['No','Model No.','OS','CSC','Category','Application Name','Application Type','content','Main Type','Sub Type','Module','Sub-Module','Issue Type','Sub-Issue Type','AI Insight'];

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

/**
 * Parse AI response and extract structured data with robust error handling
 * @param {string} response - AI response text
 * @param {number} rowCount - Number of rows to expect
 * @returns {Array} Parsed results for each row
 */
function parseAIResponse(response, rowCount) {
  console.log(`[SamsungMembersVoc] Starting AI response parsing for ${rowCount} rows...`);
  console.log(`[SamsungMembersVoc] Response length: ${response.length} characters`);
  
  try {
    // Enhanced JSON parsing with bracket slicing to handle markdown blocks
    let jsonCandidate = response.trim();
    const firstBracket = jsonCandidate.indexOf('[');
    const lastBracket = jsonCandidate.lastIndexOf(']');
    
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      jsonCandidate = jsonCandidate.substring(firstBracket, lastBracket + 1);
      console.log(`[SamsungMembersVoc] Extracted JSON candidate: ${jsonCandidate.substring(0, 100)}...`);
      
      try {
        const parsed = JSON.parse(jsonCandidate);
        if (Array.isArray(parsed)) {
          console.log(`[SamsungMembersVoc] Successfully parsed ${parsed.length} items from JSON`);
          return parsed;
        }
      } catch (jsonError) {
        console.log(`[SamsungMembersVoc] JSON parsing failed: ${jsonError.message}`);
      }
    }
    
    // Fallback to text parsing with flexible patterns
    console.log(`[SamsungMembersVoc] Falling back to text parsing...`);
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
          const fieldMatch = restOfLine.match(/^(Module|Sub-Module|Issue Type|Sub-Issue Type|AI Insight)\s*[:\-=]\s*(.+)/i);
          if (fieldMatch) {
            currentField = fieldMatch[1].trim();
            fieldBuffer = fieldMatch[2].trim();
          }
        }
        continue;
      }
      
      // Flexible field extraction with multiple separator support
      const fieldMatch = cleanedLine.match(/^(Module|Sub-Module|Issue Type|Sub-Issue Type|AI Insight)\s*[:\-=]\s*(.+)/i);
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
        const potentialNewField = cleanedLine.match(/^(Module|Sub-Module|Issue Type|Sub-Issue Type|AI Insight)\s*[:\-=]/i);
        
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
    
    console.log(`[SamsungMembersVoc] Text parsing completed, extracted ${results.length} results`);
    
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
    
    console.log(`[SamsungMembersVoc] Final validation: ${validatedResults.length} valid results`);
    return validatedResults;
    
  } catch (error) {
    console.error(`[SamsungMembersVoc] Critical parsing error: ${error.message}`);
    console.error(`[SamsungMembersVoc] Response preview: ${response.substring(0, 200)}...`);
    return [];
  }
}

/**
 * Samsung Members VOC Processor
 * Main processing function that handles both regular and discovery modes
 * @param {Array} rows - Input data rows
 * @param {Object} context - Processing context with mode and other options
 * @returns {Promise<Array>} Processed rows with AI insights
 */
async function samsungMembersVocProcessor(rows, context = {}) {
  const { mode = 'regular', prompt: customPrompt, model = 'qwen3:4b-instruct' } = context;

  // Use appropriate prompt based on mode
  const prompt = customPrompt || promptTemplate;

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

  // Build prompt for AI processing
  const numberedInput = {};
  transformedRows.forEach((row, index) => {
    numberedInput[(index + 1).toString()] = {
      content: row.content || ''
    };
  });
  const aiPrompt = prompt.replace('{INPUTDATA_JSON}', JSON.stringify(numberedInput, null, 2));

  try {
    // Call Ollama AI service
    console.log(`[SamsungMembersVoc] Processing ${transformedRows.length} rows with AI...`);
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
        'No': (context.startIndex || 0) + index + 1, // Fix: Global renumbering
        'Module': isAiFail ? 'AI Analysis Failed' : (aiResult.Module || ''),
        'Sub-Module': aiResult['Sub-Module'] || '',
        'Issue Type': aiResult['Issue Type'] || '',
        'Sub-Issue Type': aiResult['Sub-Issue Type'] || '',
        'AI Insight': isAiFail ? 'Error: Model failed to provide insight' : (aiResult['AI Insight'] || '')
      };
    });

    // Save discovery data if in discovery mode
    if (mode === 'discovery') {
      saveDiscoveryRecord({
        input: numberedInput,
        prompt: aiPrompt,
        response: aiResponse,
        results: parsedResults,
        timestamp: new Date().toISOString()
      });
    }

    return finalRows;
  } catch (error) {
    console.error('[SamsungMembersVoc] AI processing failed:', error);
    
    // Return rows with error information if AI fails
    return transformedRows.map(row => ({
      ...row,
      'Module': 'ERROR: AI processing failed',
      'Sub-Module': '',
      'Issue Type': '',
      'Sub-Issue Type': '',
      'AI Insight': `Error: ${error.message}`
    }));
  }
}

/**
 * Flexible header validation function for samsungMembersVoc processor
 * Handles header variations and provides clear error messages
 * @param {Array} headers - Array of header names from the uploaded file
 * @returns {boolean} True if headers are valid, false otherwise
 */
function validate(headers) {
  console.log('[SamsungMembersVoc] Validating headers:', headers);
  
  // Define required headers with their acceptable variations
  const requiredHeaders = {
    'No': ['no', 'number', 'id', 'index'],
    'Model No.': ['model no', 'model_no', 'modelno', 'model number', 'modelnumber', 'model'],
    'OS': ['os', 'operating system', 'operating_system'],
    'CSC': ['csc', 'country sales code', 'country_sales_code', 'region'],
    'Category': ['category', 'type', 'classification'],
    'Application Name': ['application name', 'application_name', 'app name', 'app_name', 'app'],
    'Application Type': ['application type', 'application_type', 'app type', 'app_type'],
    'content': ['content', 'feedback', 'comment', 'description', 'text']
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
  console.log('[SamsungMembersVoc] Header validation results:');
  console.log('  Found headers:', foundHeaders);
  console.log('  Missing headers:', missingHeaders);

  // If we have at least the core required headers, consider it valid
  const coreHeaders = ['No', 'Model No.', 'content'];
  const coreMissing = coreHeaders.filter(header => missingHeaders.includes(header));
  
  if (coreMissing.length > 0) {
    console.error(`[SamsungMembersVoc] Missing core headers: ${coreMissing.join(', ')}`);
    return false;
  }

  // For non-core headers, log warnings but don't fail validation
  const nonCoreMissing = missingHeaders.filter(header => !coreHeaders.includes(header));
  if (nonCoreMissing.length > 0) {
    console.warn(`[SamsungMembersVoc] Missing non-core headers (will use defaults): ${nonCoreMissing.join(', ')}`);
  }

  console.log('[SamsungMembersVoc] Header validation passed');
  return true;
}

// Add expected headers for the processor
samsungMembersVocProcessor.expectedHeaders = ['No','Model No.','OS','CSC','Category','Application Name','Application Type','content','Main Type','Sub Type','Module','Sub-Module','Issue Type','Sub-Issue Type','AI Insight'];
samsungMembersVocProcessor.readAndNormalizeExcel = readAndNormalizeExcel;
samsungMembersVocProcessor.validate = validate;

module.exports = samsungMembersVocProcessor;

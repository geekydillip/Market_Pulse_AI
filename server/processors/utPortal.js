const xlsx = require('xlsx');
const promptTemplate = require('../prompts/utPortalPrompt');
const discoveryPromptTemplate = require('../prompts/utPortalPrompt_discovery');
const ollamaClient = require('../ollamaClient');
const { cleanExcelStyling } = require('./_helpers');

// Required headers for UT Portal processing
const REQUIRED_HEADERS = [
  'Issue ID',
  'Title', 
  'Feature/App',
  'TG',
  'Problem' // Note: Your CSV snippet shows "Problem " (with a space) or "Problem"
];

/**
 * Flexible validation to handle newlines and trailing spaces in Excel headers
 */
function validate(headers) {
  const normalizedHeaders = headers.map(h => h.trim().replace(/\n/g, ' '));
  
  // Check if every required header exists in the file
  const missing = REQUIRED_HEADERS.filter(req => 
    !normalizedHeaders.some(h => h.toLowerCase().includes(req.toLowerCase()))
  );

  if (missing.length > 0) {
    console.error('[UTPortal] Missing headers:', missing);
    return false;
  }
  return true;
}

/**
 * Flexible header validation function for utPortal processor
 * Handles header variations and provides clear error messages
 * @param {Array} headers - Array of header names from the uploaded file
 * @returns {boolean} True if headers are valid, false otherwise
 */
function validateEnhanced(headers) {
  console.log('[UtPortal] Validating headers:', headers);
  
  // Define required headers with their acceptable variations
  const requiredHeaders = {
    'No': ['no', 'number', 'id', 'index'],
    'Feature/App': ['feature/app', 'feature_app', 'feature', 'app', 'application'],
    '3rd Party App': ['3rd party app', '3rd_party_app', 'third party app', 'third_party_app', 'external app', 'external_app'],
    'TG': ['tg', 'target group', 'target_group', 'user group', 'user_group'],
    'Issue Type': ['issue type', 'issue_type', 'type', 'category'],
    'content': ['content', 'feedback', 'comment', 'description', 'text', 'details']
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
  console.log('[UtPortal] Header validation results:');
  console.log('  Found headers:', foundHeaders);
  console.log('  Missing headers:', missingHeaders);

  // If we have at least the core required headers, consider it valid
  const coreHeaders = ['No', 'Feature/App', 'content'];
  const coreMissing = coreHeaders.filter(header => missingHeaders.includes(header));
  
  if (coreMissing.length > 0) {
    console.error(`[UtPortal] Missing core headers: ${coreMissing.join(', ')}`);
    return false;
  }

  // For non-core headers, log warnings but don't fail validation
  const nonCoreMissing = missingHeaders.filter(header => !coreHeaders.includes(header));
  if (nonCoreMissing.length > 0) {
    console.warn(`[UtPortal] Missing non-core headers (will use defaults): ${nonCoreMissing.join(', ')}`);
  }

  console.log('[UtPortal] Header validation passed');
  return true;
}

/**
 * Normalizes row data so the AI can read it regardless of exact header spelling
 */
function transform(rows) {
  return rows.map(row => {
    const keys = Object.keys(row);
    const findValue = (possibleNames) => {
      const key = keys.find(k => possibleNames.includes(k.trim().replace(/\n/g, ' ')));
      return key ? row[key] : '';
    };

    return {
      'Issue ID': findValue(['Issue ID']),
      'Title': findValue(['Title']),
      'Feature/App': findValue(['Feature/App']),
      '3rd Party App': findValue(['3rd Party App']),
      'TG': findValue(['TG']),
      'Issue Type': findValue(['Issue Type']),
      'Problem': findValue(['Problem', 'Problem ']),
      'Steps to reproduce': findValue(['Steps to reproduce'])
    };
  });
}

/**
 * Robust Excel Reader for UT Portal
 * This function is required by excelUtils.js for proper header detection and normalization
 */
function readAndNormalizeExcel(uploadedPath) {
  const workbook = xlsx.readFile(uploadedPath, { cellDates: true, raw: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Read sheet as 2D array to find header row robustly
  const sheetRows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  // Find header row index by searching for keywords
  let headerRowIndex = 0;
  const expectedHeaderKeywords = ['issue id', 'plm code', 'title', 'problem']; 
  for (let r = 0; r < sheetRows.length; r++) {
    const row = sheetRows[r];
    if (!Array.isArray(row)) continue;
    const rowText = row.map(c => String(c || '').toLowerCase()).join(' | ');
    if (expectedHeaderKeywords.some(k => rowText.includes(k))) {
      headerRowIndex = r;
      break;
    }
  }

  // Extract raw headers and data rows
  const rawHeaders = (sheetRows[headerRowIndex] || []).map(h => String(h || '').trim());
  const dataRows = sheetRows.slice(headerRowIndex + 1);

  // Convert to array of objects
  let rows = dataRows.map(r => {
    const obj = {};
    for (let ci = 0; ci < rawHeaders.length; ci++) {
      const key = rawHeaders[ci] || `col_${ci}`;
      obj[key] = r[ci] !== undefined && r[ci] !== null ? r[ci] : '';
    }
    return obj;
  });

  return normalizeHeaders(rows);
}

/**
 * Normalizes UT-specific headers to canonical names for processing
 */
function normalizeHeaders(rows) {
  const headerMap = {
    'issue id': 'Issue ID',
    'plm code': 'PLM code',
    'target model': 'Target model',
    'version occurred': 'Version occurred',
    'title': 'Title',
    'problem ': 'Problem', // Handling the trailing space in your CSV
    'steps to reproduce': 'Steps to reproduce',
    'frequency': 'Frequency',
    'plm status': 'PLM Status'
  };

  const canonicalCols = ['Issue ID', 'PLM code', 'Target model', 'Version occurred', 'Title', 'Problem', 'Steps to reproduce', 'Frequency', 'PLM Status'];

  return rows.map(orig => {
    const out = {};
    const keys = Object.keys(orig);
    
    canonicalCols.forEach(tgt => {
      let found = '';
      for (const key of keys) {
        const normKey = key.trim().toLowerCase();
        if (normKey === tgt.toLowerCase() || headerMap[normKey] === tgt) {
          found = orig[key];
          break;
        }
      }
      out[tgt] = found || '';
    });
    
    // Keep all original data to ensure no loss during reconstruction
    return { ...orig, ...out };
  });
}

/**
 * Clean text by removing unwanted content based on field type
 * @param {string} text - Text to clean
 * @param {string} fieldType - Type of field (title, problem, steps)
 * @returns {string} Cleaned text
 */
function cleanText(text, fieldType) {
  if (!text || typeof text !== 'string') return '';
  
  let cleaned = text.trim();
  
  // Remove content inside square brackets [ ... ]
  cleaned = cleaned.replace(/\[.*?\]/g, '').trim();
  
  // Remove common patterns based on field type
  if (fieldType === 'title' || fieldType === 'problem') {
    // Remove IDs, tags, usernames, timestamps
    cleaned = cleaned.replace(/#[a-zA-Z0-9_]+/g, '').trim(); // Remove hashtags
    cleaned = cleaned.replace(/@[a-zA-Z0-9_]+/g, '').trim(); // Remove usernames
    cleaned = cleaned.replace(/\bID:\s*\w+\b/gi, '').trim(); // Remove ID patterns
    cleaned = cleaned.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '').trim(); // Remove dates
    cleaned = cleaned.replace(/\b\d{2}:\d{2}:\d{2}\b/g, '').trim(); // Remove times
    cleaned = cleaned.replace(/\b\d{10,}\b/g, '').trim(); // Remove long numbers (likely IDs)
  }
  
  if (fieldType === 'steps') {
    // Remove bullet points that start with ●
    cleaned = cleaned.replace(/●\s*/g, '').trim();
    // Remove other bullet point patterns
    cleaned = cleaned.replace(/^[-*•]\s*/gm, '').trim();
  }
  
  // Remove non-English characters (keep English letters, numbers, basic punctuation)
  cleaned = cleaned.replace(/[^\u0000-\u007F]/g, '').trim();
  
  // Remove excessive whitespace and normalize spacing
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Remove duplicates (repeated phrases or sentences)
  const sentences = cleaned.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
  const uniqueSentences = [];
  const seen = new Set();
  
  for (const sentence of sentences) {
    const normalized = sentence.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      uniqueSentences.push(sentence);
    }
  }
  
  cleaned = uniqueSentences.join('. ').trim();
  
  // Add period if missing and text is not empty
  if (cleaned && !cleaned.endsWith('.') && !cleaned.endsWith('!') && !cleaned.endsWith('?')) {
    cleaned += '.';
  }
  
  return cleaned;
}

/**
 * Parse AI response and extract structured data with robust error handling
 * @param {string} response - AI response text
 * @param {number} rowCount - Number of rows to expect
 * @returns {Array} Parsed results for each row
 */
function parseAIResponse(response, rowCount) {
  console.log(`[UTPortal] Starting AI response parsing for ${rowCount} rows...`);
  console.log(`[UTPortal] Response length: ${response.length} characters`);
  
  try {
    // Enhanced JSON parsing with bracket slicing to handle markdown blocks
    let jsonCandidate = response.trim();
    const firstBracket = jsonCandidate.indexOf('[');
    const lastBracket = jsonCandidate.lastIndexOf(']');
    
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      jsonCandidate = jsonCandidate.substring(firstBracket, lastBracket + 1);
      console.log(`[UTPortal] Extracted JSON candidate: ${jsonCandidate.substring(0, 100)}...`);
      
      try {
        const parsed = JSON.parse(jsonCandidate);
        if (Array.isArray(parsed)) {
          console.log(`[UTPortal] Successfully parsed ${parsed.length} items from JSON`);
          return parsed;
        }
      } catch (jsonError) {
        console.log(`[UTPortal] JSON parsing failed: ${jsonError.message}`);
      }
    }
    
    // Fallback to text parsing with flexible patterns
    console.log(`[UTPortal] Falling back to text parsing...`);
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
          const fieldMatch = restOfLine.match(/^(Feature\/App|3rd Party App|TG|Issue Type)\s*[:\-=]\s*(.+)/i);
          if (fieldMatch) {
            currentField = fieldMatch[1].trim();
            fieldBuffer = fieldMatch[2].trim();
          }
        }
        continue;
      }
      
      // Flexible field extraction with multiple separator support
      const fieldMatch = cleanedLine.match(/^(Feature\/App|3rd Party App|TG|Issue Type)\s*[:\-=]\s*(.+)/i);
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
        const potentialNewField = cleanedLine.match(/^(Feature\/App|3rd Party App|TG|Issue Type)\s*[:\-=]/i);
        
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
    
    console.log(`[UTPortal] Text parsing completed, extracted ${results.length} results`);
    
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
    
    console.log(`[UTPortal] Final validation: ${validatedResults.length} valid results`);
    return validatedResults;
    
  } catch (error) {
    console.error(`[UTPortal] Critical parsing error: ${error.message}`);
    console.error(`[UTPortal] Response preview: ${response.substring(0, 200)}...`);
    return [];
  }
}

/**
 * UTPortal Processor
 * Main processing function that handles both regular and discovery modes
 * @param {Array} rows - Input data rows
 * @param {Object} context - Processing context with mode and other options
 * @returns {Promise<Array>} Processed rows with AI insights
 */
async function utPortalProcessor(rows, context = {}) {
  const { mode = 'regular', model = 'qwen3:4b-instruct' } = context;
  const prompt = mode === 'discovery' ? discoveryPromptTemplate : promptTemplate;

  let transformedRows = normalizeHeaders(rows);

  const numberedInput = {};
  transformedRows.forEach((row, index) => {
    numberedInput[(index + 1).toString()] = {
      Title: cleanText(row.Title, 'title'),
      Problem: cleanText((row.Problem || '').substring(0, 1000), 'problem'), // Truncate for prompt efficiency, then clean
      'Steps to reproduce': cleanText(row['Steps to reproduce'] || '', 'steps')
    };
  });

  const aiPrompt = prompt.replace('{INPUTDATA_JSON}', JSON.stringify(numberedInput, null, 2));

  try {
    console.log(`[UTProcessor] Processing ${transformedRows.length} rows with ${model}...`);
    const aiResponse = await ollamaClient.callOllama(aiPrompt, model);
    const parsedResults = parseAIResponse(aiResponse, transformedRows.length);
    
    return transformedRows.map((row, index) => {
      const ai = parsedResults[index] || {};
      
      // Reconstruct the row with inserted columns as seen in your Processed file
      const { Title, ...rest } = row;
      return {
        'Issue ID': row['Issue ID'],
        'PLM code': row['PLM code'],
        'Target model': row['Target model'],
        'Version occurred': row['Version occurred'],
        'Title': row['Title'],
        // Inserted AI Columns
        'Feature/App': ai['Feature/App'] || '',
        '3rd Party App': ai['3rd Party App'] || '',
        'TG': ai['TG'] || '',
        'Issue Type': ai['Issue Type'] || 'Other',
        'Test Coverage Availability (Yes/No)': 'No',
        'TC Addition **For Test coverage No (Count of TC Add)': '',
        'TC Modification **For Test coverage No (Count of TC Modify)': '',
        'Remarks (Test item Name/New process implementation)': '',
        // Continue with original columns
        ...rest
      };
    });
  } catch (error) {
    console.error('[UTProcessor] AI Failed:', error);
    return transformedRows.map(row => ({
      ...row,
      'Feature/App': 'ERROR: AI processing failed',
      '3rd Party App': '',
      'TG': '',
      'Issue Type': 'Other',
      'Test Coverage Availability (Yes/No)': 'No',
      'TC Addition **For Test coverage No (Count of TC Add)': '',
      'TC Modification **For Test coverage No (Count of TC Modify)': '',
      'Remarks (Test item Name/New process implementation)': ''
    }));
  }
}

// Add expected headers for the processor
utPortalProcessor.expectedHeaders = ['Issue ID', 'PLM code', 'Target model', 'Version occurred', 'Title', 'Problem', 'Steps to reproduce', 'Frequency', 'PLM Status'];

// Add column widths configuration for Excel formatting
utPortalProcessor.getColumnWidths = function(headers) {
  const widths = [];
  headers.forEach(header => {
    switch (header) {
      case 'Issue ID':
        widths.push({ width: 15 });
        break;
      case 'PLM code':
        widths.push({ width: 15 });
        break;
      case 'Target model':
        widths.push({ width: 15 });
        break;
      case 'Version occurred':
        widths.push({ width: 15 });
        break;
      case 'Title':
        widths.push({ width: 40 });
        break;
      case 'Problem':
        widths.push({ width: 40 });
        break;
      case 'Frequency':
        widths.push({ width: 12 });
        break;
      case 'PLM Status':
        widths.push({ width: 15 });
        break;
      case 'Feature/App':
        widths.push({ width: 25 });
        break;
      case '3rd Party App':
        widths.push({ width: 25 });
        break;
      case 'TG':
        widths.push({ width: 15 });
        break;
      case 'Issue Type':
        widths.push({ width: 20 });
        break;
      case 'Test Coverage Availability (Yes/No)':
        widths.push({ width: 25 });
        break;
      case 'TC Addition **For Test coverage No (Count of TC Add)':
        widths.push({ width: 25 });
        break;
      case 'TC Modification **For Test coverage No (Count of TC Modify)':
        widths.push({ width: 25 });
        break;
      case 'Remarks (Test item Name/New process implementation)':
        widths.push({ width: 40 });
        break;
      default:
        widths.push({ width: 20 });
    }
  });
  return widths;
};

utPortalProcessor.normalizeHeaders = normalizeHeaders;
utPortalProcessor.readAndNormalizeExcel = readAndNormalizeExcel; // Export the function for excelUtils.js
utPortalProcessor.validate = validateEnhanced; // Use enhanced validation

module.exports = utPortalProcessor;

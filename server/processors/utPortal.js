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
      
      // Extract Feature/App
      const featureAppMatch = trimmed.match(/Feature\/App:\s*(.+)/i);
      if (featureAppMatch) {
        currentResult['Feature/App'] = featureAppMatch[1].trim();
      }
      
      // Extract 3rd Party App
      const thirdPartyAppMatch = trimmed.match(/3rd Party App:\s*(.+)/i);
      if (thirdPartyAppMatch) {
        currentResult['3rd Party App'] = thirdPartyAppMatch[1].trim();
      }
      
      // Extract TG
      const tgMatch = trimmed.match(/TG:\s*(.+)/i);
      if (tgMatch) {
        currentResult.TG = tgMatch[1].trim();
      }
      
      // Extract Issue Type
      const issueTypeMatch = trimmed.match(/Issue Type:\s*(.+)/i);
      if (issueTypeMatch) {
        currentResult['Issue Type'] = issueTypeMatch[1].trim();
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

module.exports = utPortalProcessor;

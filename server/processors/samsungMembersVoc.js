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
      
      // Extract AI Insight
      const aiInsightMatch = trimmed.match(/AI Insight:\s*(.+)/i);
      if (aiInsightMatch) {
        currentResult['AI Insight'] = aiInsightMatch[1].trim();
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

// Add expected headers for the processor
samsungMembersVocProcessor.expectedHeaders = ['No','Model No.','OS','CSC','Category','Application Name','Application Type','content','Main Type','Sub Type','Module','Sub-Module','Issue Type','Sub-Issue Type','AI Insight'];
samsungMembersVocProcessor.readAndNormalizeExcel = readAndNormalizeExcel;

module.exports = samsungMembersVocProcessor;

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const xlsx = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3001; // Allow environment port
const DEFAULT_OLLAMA_PORT = 11434;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/downloads', express.static('downloads'));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

/**
 * callOllama - robust HTTP call to local Ollama server
 * prompt: string or object
 * model: string (e.g. "gemma3:4b")
 * opts: { port:number, timeoutMs:number }
 */
async function callOllama(prompt, model = 'gemma3:4b', opts = {}) {
  const port = opts.port || DEFAULT_OLLAMA_PORT;
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 5 * 60 * 1000; // default 5min

  const payload = typeof prompt === 'string' ? { model, prompt, stream: false } : { model, ...prompt, stream: false };
  const data = JSON.stringify(payload);
  const byteLen = Buffer.byteLength(data);

  console.log('[callOllama] port=%d model=%s byteLen=%d', port, model, byteLen);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port,
      path: '/api/generate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': byteLen,
        'Connection': 'close'
      }
    };

    const req = require('http').request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');

      res.on('data', (chunk) => raw += chunk);
      res.on('end', () => {
        if (!raw) return reject(new Error(`Empty response from Ollama (status ${res.statusCode})`));
        try {
          const json = JSON.parse(raw);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('[callOllama] success status=%d len=%d', res.statusCode, raw.length);
            return resolve(json.response ?? json);
          } else {
            return reject(new Error(`Ollama ${res.statusCode}: ${JSON.stringify(json)}`));
          }
        } catch (err) {
          return reject(new Error('Failed to parse Ollama response: ' + err.message + ' raw:' + raw.slice(0,2000)));
        }
      });
    });

    // Client-side timeout
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Client timeout after ${timeoutMs} ms`));
    });

    req.on('error', (err) => {
      // captures "socket hang up", ECONNRESET, ENOTFOUND, etc.
      console.error('[callOllama] request error:', err && err.message);
      reject(new Error('Failed to connect to Ollama: ' + (err && err.message)));
    });

    // write + end
    req.write(data);
    req.end();
  });
}

// Route removed - only processing structured files (Excel/JSON)

// Route: Upload and process file (Excel or JSON only)
app.post('/api/process', upload.single('file'), async (req, res) => {
  try {
    const processingType = req.body.processingType || 'voc'; // Default to VOC processing
    const customPrompt = req.body.customPrompt || '';
    const model = req.body.model || 'gemma3:4b';

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();

    if (ext === '.xlsx' || ext === '.xls') {
      // Excel files - process with chunking
      return processExcel(req, res);
    } else if (ext === '.json') {
      // JSON files - parse and process like Excel rows
      return processJSON(req, res);
    } else {
      return res.status(400).json({ error: 'Only Excel (.xlsx, .xls) and JSON (.json) files are supported' });
    }

  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).json({
      error: error.message || 'Failed to process file'
    });
  }
});

// Generic cleaning function
function applyGenericCleaning(value) {
  if (typeof value === 'string') {
    // Trim whitespace
    const trimmed = value.trim();
    // If trimmed is empty, keep as empty (don't convert to null)
    if (trimmed === '') return '';
    // Try to detect date and normalize to ISO YYYY-MM-DD
    const dateMatch = trimmed.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
    if (dateMatch) {
      const year = parseInt(dateMatch[1]);
      const month = String(parseInt(dateMatch[2])).padStart(2, '0');
      const day = String(parseInt(dateMatch[3])).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    // Convert numeric-looking strings to numbers
    const num = parseFloat(trimmed);
    if (!isNaN(num) && trimmed === num.toString()) {
      return num;
    }
    // Otherwise keep as string trimmed
    return trimmed;
  }
  // Keep other types as is (numbers, booleans, null)
  return value;
}

// Process a single chunk
async function processChunk(chunk, processingType, customPrompt, model, chunkId) {
  const startTime = Date.now();
  try {
    let processedRows;

    if (processingType === 'clean') {
      // Apply generic cleaning
      processedRows = chunk.rows.map(row => {
        const cleanedRow = {};
        for (const [key, value] of Object.entries(row)) {
          cleanedRow[key] = applyGenericCleaning(value);
        }
        return cleanedRow;
      });
    } else if (processingType === 'voc') {
      // VOC processing using AI with specific data-cleaning prompt
      const vocPrompt = `You are a data-cleaning assistant for Voice of Problem analysis reported by customers.
Your goal is to process each row of customer feedback data, extract meaningful insights, and generate structured outputs for Excel.


For each row in the input data:

Merge & Clean
Combine and clean the Title and Problem fields into one single clear English sentence that accurately describes the real user issue.

Module Identification
Identify the correct product module or functional area the issue belongs to (e.g., Lock Screen, Camera, Battery, Network, Settings, Display, App Permissions, etc.). from Title column.

Severity Classification
Determine severity based on user impact, using the rules below.

Severity Reason
Provide 1 concise sentence explaining why the chosen severity applies
(e.g., “Major feature not working”, “Cosmetic issue only”, “Device freeze causing usability problems”, etc.).

Output JSON Object
For each row, produce one JSON object containing EXACTLY these keys in this order:

Case Code,
Model No.,
Title,
Problem,
Module,
Sub-Module,
Summarized Problem,
Severity,
Severity Reason

📌 Rules
Text Cleaning Rules

Remove IDs, usernames, timestamps, tags or anything inside [ ... ].
Example: [Samsung Members][AppName: Samsung Members] → ignored

Avoid text other than English language.
Avoid duplication when merging Title + Problem.
Avoid internal diagnostic notes (e.g., “log 부족”, “H/W check needed”).
Output one complete sentence for Summarized Problem.

📌 Severity Guidelines

Choose the severity that best reflects real customer impact:

Severity	When to Use
Critical	Device unusable, boot failure, data loss, crashes, freezing.
High	Major feature not working (e.g., Camera fails, Wi-Fi not connecting).
Medium	Partial malfunction, occasional failure, degraded experience.
Low	Minor UI issue, cosmetic problem, suggestion or enhancement request.

📌 Output Format Requirements

Return a single JSON array.
No explanations outside the JSON.
The JSON must be valid and strictly parseable.
Each output object must preserve the input order.
Output must match this structural sequence and no other columns should present:

Case Code,
Model No.,
Title,
Problem,
Module,
Sub-Module,
Summarized Problem,
Severity,
Severity Reason

📌 Example Input
[
  {
    "Case Code": "C-001",
    "Model No.": "Galaxy S24U",
    "Title": "[Samsung Members][64338785][AppName: Samsung Members][Lock Screen] Sports from Google option is not available in S24 ultra",
    "Problem": "Sports from Google option is not available in S24 ultra: [Samsung Members Notice] Log가 부족하거나 H/W 점검이 필요하다고 판단된 경우 분석 결과와 함께 필요한 정보를 기재하여 Resolve 바랍니다."
  }
]

📌 Example Output
[
  {
    "Case Code": "C-001",
    "Model No.": "Galaxy S24U",
    "Title": "Sports from Google option is not available in S24 ultra",
    "Problem": "Sports from Google option is not available in S24 ultra: Log가 부족하거나 H/W 점검이 필요하다고 판단된 경우 분석 결과와 함께 필요한 정보를 기재하여 Resolve 바랍니다.",
    "Module": "Lock Screen",
    "Sub-Module": "Google"
    "Summarized Problem": "The Google Sports option is missing from the Lock Screen on the Galaxy S24 Ultra.",
    "Severity": "Medium",
    "Severity Reason": "A Lock Screen feature is missing, causing partial functionality loss but not affecting core device operation."
  }
]


Input Data:
${JSON.stringify(chunk.rows, null, 2)}

Return only the JSON array.`;

      // Send to AI for processing
      const result = await callOllama(vocPrompt, model);
      const text = result.trim();
      const firstBracket = text.indexOf('[');
      const lastBracket = text.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket > firstBracket) {
        const jsonStr = text.substring(firstBracket, lastBracket + 1);
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed) && parsed.length === chunk.rows.length) {
          processedRows = parsed.map((row, idx) => {
            // Ensure all required keys are present, fill with defaults if missing
            const requiredKeys = ['Case Code', 'Model No.', 'Title', 'Problem', 'Module', 'Summarized Problem', 'Severity', 'Severity Reason'];
            const processedRow = {};
            requiredKeys.forEach(key => {
              processedRow[key] = row[key] !== undefined ? row[key] : chunk.rows[idx][key] || ''; // fallback to original
            });
            return processedRow;
          });
        } else {
          throw new Error(`Invalid response: expected array of ${chunk.rows.length} objects, got ${JSON.stringify(parsed).slice(0, 200)}`);
        }
      } else {
        throw new Error('No valid JSON array found in response: ' + text.slice(0, 500));
      }
    } else {
      // Custom processing: send to AI for processing
      const prompt = `${customPrompt}\n\nProcess this chunk of data and return the transformed rows in the following format. The output should be a JSON object with exactly this structure:
{
  "processed_rows": [
    { /* cleaned/transformed row 1 */ },
    { /* cleaned/transformed row 2 or null */ }
  ],
  "status": "ok"
}

Chunk Data:
${JSON.stringify(chunk, null, 2)}

Return only the JSON object.`;

      let attempt = 0;
      let lastError = null;

      while (attempt < 2) { // Up to 1 retry
        try {
          const result = await callOllama(prompt, model);
          const text = result.trim();
          const firstBrace = text.indexOf('{');
          const lastBrace = text.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace > firstBrace) {
            const jsonStr = text.substring(firstBrace, lastBrace + 1);
            const parsed = JSON.parse(jsonStr);
            if (parsed.processed_rows && Array.isArray(parsed.processed_rows) && parsed.status === 'ok') {
              if (parsed.processed_rows.length === chunk.rows.length) {
                processedRows = parsed.processed_rows;
                break;
              } else {
                throw new Error(`Invalid number of processed rows: expected ${chunk.rows.length}, got ${parsed.processed_rows.length}`);
              }
            } else {
              throw new Error('Invalid response structure');
            }
          } else {
            throw new Error('No valid JSON object found in response');
          }
        } catch (error) {
          lastError = error;
          attempt++;
        }
      }

      if (lastError && !processedRows) {
        // If failed after retry, mark with error
        processedRows = chunk.rows.map((row, i) => ({ ...row, error: lastError.message || 'Processing failed' }));
      }
    }

    return {
      chunkId,
      processedRows,
      status: processedRows ? 'ok' : 'failed',
      processingTime: Date.now() - startTime,
      error: processedRows ? null : lastError?.message
    };
  } catch (error) {
    return {
      chunkId,
      processedRows: chunk.rows.map((row, i) => ({ ...row, error: error.message || 'Processing failed' })),
      status: 'failed',
      processingTime: Date.now() - startTime,
      error: error.message
    };
  }
}

// JSON processing - parse and process like Excel rows
async function processJSON(req, res) {
  try {
    const uploadedPath = req.file.path;
    const originalName = req.file.originalname;
    const fileNameBase = originalName.replace(/\.[^/.]+$/, ''); // Remove extension
    const processedJSONFilename = `${fileNameBase}_processed.json`;
    const logFilename = `${fileNameBase}_log.json`;

    // Read and parse JSON file
    const fileContent = fs.readFileSync(uploadedPath, 'utf-8');
    let rows;
    try {
      rows = JSON.parse(fileContent);
      if (!Array.isArray(rows)) {
        return res.status(400).json({ error: 'JSON file must contain an array of objects' });
      }
      if (rows.length === 0 || typeof rows[0] !== 'object') {
        return res.status(400).json({ error: 'JSON file must contain an array of non-empty objects' });
      }
    } catch (parseError) {
      return res.status(400).json({ error: 'Invalid JSON format: ' + parseError.message });
    }

    const headers = Object.keys(rows[0] || {});

    // Use VOC processing type for JSON (since only structured data should be in JSON)
    const processingType = req.body.processingType || 'voc';
    const customPrompt = req.body.customPrompt || '';
    const model = req.body.model || 'gemma3:4b';

    // Unified chunked processing (works for all types: clean, voc, custom)
    const numberOfInputRows = rows.length;
    const chunkSize = processingType === 'voc' ? 1 : 2; // Use 1 row per chunk for VOC, 2 for others
    const numberOfChunks = Math.ceil(rows.length / chunkSize);
    const chunkResults = [];
    const allProcessedRows = [];
    const addedColumns = new Set();

    const startProcessing = Date.now();

    // Process chunks
    for (let i = 0; i < numberOfChunks; i++) {
      const startIdx = i * chunkSize;
      const endIdx = Math.min(startIdx + chunkSize, rows.length);
      const chunkRows = rows.slice(startIdx, endIdx);

      const chunk = {
        file_name: originalName,
        chunk_id: i,
        row_indices: chunkRows.length === 1 ? [startIdx] : [startIdx, startIdx + 1],
        headers: headers,
        rows: chunkRows
      };

      const result = await processChunk(chunk, processingType, customPrompt, model, i);
      chunkResults.push(result);

      if (result.status === 'ok') {
        result.processedRows.forEach((row, idx) => {
          const originalIdx = result.chunkId * chunkSize + idx;
          allProcessedRows[originalIdx] = row;
          Object.keys(row).forEach(col => {
            if (!headers.includes(col)) addedColumns.add(col);
          });
        });
      } else {
        // For failed chunks, still include rows with error
        result.processedRows.forEach((row, idx) => {
          const originalIdx = result.chunkId * chunkSize + idx;
          allProcessedRows[originalIdx] = row;
          if (row.error) {
            addedColumns.add('error');
          }
        });
      }
    }

    // Filter out null entries if any (though shouldn't have)
    const finalRows = allProcessedRows.filter(row => row != null);

    // Generate log
    const failedRows = [];
    chunkResults.forEach(cr => {
      cr.processedRows.forEach((row, idx) => {
        if (row.error) {
          const originalIdx = cr.chunkId * chunkSize + idx;
          failedRows.push({
            row_index: originalIdx,
            chunk_id: cr.chunkId,
            error_reason: row.error
          });
        }
      });
    });

    const log = {
      number_of_input_rows: numberOfInputRows,
      number_of_chunks: numberOfChunks,
      number_of_output_rows: finalRows.length,
      failed_row_details: failedRows,
      added_columns: Array.from(addedColumns),
      chunks_processing_time: chunkResults.map(cr => ({ chunk_id: cr.chunkId, time_ms: cr.processingTime })),
      total_processing_time_ms: Date.now() - startProcessing
    };

    if (processingType === 'clean') {
      log.assumptions = [
        "Applied generic cleaning: trimmed whitespace, normalized dates to ISO YYYY-MM-DD, converted numeric-looking strings to numbers, kept empty cells as empty strings."
      ];
    }

    // Save files
    const processedPath = path.join('downloads', processedJSONFilename);
    const logPath = path.join('downloads', logFilename);

    fs.writeFileSync(processedPath, JSON.stringify(finalRows, null, 2));
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

    fs.unlinkSync(uploadedPath);

    res.json({
      success: true,
      downloads: [{ url: `/downloads/${processedJSONFilename}`, filename: processedJSONFilename },
                  { url: `/downloads/${logFilename}`, filename: logFilename }]
    });
  } catch (error) {
    console.error('JSON processing error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Processing failed'
    });
  }
}

// Excel processing with chunking
async function processExcel(req, res) {
  try {
    console.log('Starting Excel processing...');
    const uploadedPath = req.file.path;
    const originalName = req.file.originalname;
    const fileNameBase = originalName.replace(/\.[^/.]+$/, ''); // Remove extension
    const processedExcelFilename = `${fileNameBase}_processed.xlsx`;
    const logFilename = `${fileNameBase}_log.json`;

    // Read Excel file and convert to JSON
    const workbook = xlsx.readFile(uploadedPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(worksheet, { defval: '' }); // defval: '' to keep empty as empty string
    const headers = Object.keys(rows[0] || {});

    // Use the requested processing type for Excel
    const processingType = req.body.processingType || 'clean';
    const customPrompt = req.body.customPrompt || '';
    const model = req.body.model || 'gemma3:4b';

    // Unified chunked processing (works for all types: clean, voc, custom)
    const numberOfInputRows = rows.length;
    const chunkSize = processingType === 'voc' ? 1 : 2; // Use 1 row per chunk for VOC, 2 for others
    const numberOfChunks = Math.ceil(rows.length / chunkSize);
    const chunkResults = [];
    const allProcessedRows = [];
    const addedColumns = new Set();

    const startProcessing = Date.now();

    // Process chunks
    for (let i = 0; i < numberOfChunks; i++) {
      const startIdx = i * chunkSize;
      const endIdx = Math.min(startIdx + chunkSize, rows.length);
      const chunkRows = rows.slice(startIdx, endIdx);

      const chunk = {
        file_name: originalName,
        chunk_id: i,
        row_indices: chunkRows.length === 1 ? [startIdx] : [startIdx, startIdx + 1],
        headers: headers,
        rows: chunkRows
      };

      const result = await processChunk(chunk, processingType, customPrompt, model, i);
      chunkResults.push(result);

      if (result.status === 'ok') {
        result.processedRows.forEach((row, idx) => {
          const originalIdx = result.chunkId * chunkSize + idx;
          allProcessedRows[originalIdx] = row;
          Object.keys(row).forEach(col => {
            if (!headers.includes(col)) addedColumns.add(col);
          });
        });
      } else {
        // For failed chunks, still include rows with error
        result.processedRows.forEach((row, idx) => {
          const originalIdx = result.chunkId * chunkSize + idx;
          allProcessedRows[originalIdx] = row;
          if (row.error) {
            addedColumns.add('error');
          }
        });
      }
    }

    // Filter out null entries if any (though shouldn't have)
    const finalRows = allProcessedRows.filter(row => row != null);

    // Create final headers: original + any added columns
    const finalHeaders = [...headers];
    addedColumns.forEach(col => {
      if (!finalHeaders.includes(col)) finalHeaders.push(col);
    });

    // Ensure all rows have same columns, fill missing with null
    const schemaMergedRows = finalRows.map(row => {
      const mergedRow = {};
      finalHeaders.forEach(header => {
        mergedRow[header] = row[header] === undefined ? null : row[header];
      });
      return mergedRow;
    });

    // Convert back to Excel
    const newWb = xlsx.utils.book_new();
    const newSheet = xlsx.utils.json_to_sheet(schemaMergedRows);
    xlsx.utils.book_append_sheet(newWb, newSheet, 'Data');

    // Add error column if there were failures
    const hasErrors = chunkResults.some(cr => cr.status === 'failed' || chunkResults.some(cr => cr.processedRows.some(r => r.error)));
    if (hasErrors && !finalHeaders.includes('error')) {
      finalHeaders.push('error');
    }

    const buf = xlsx.write(newWb, { bookType: 'xlsx', type: 'buffer' });

    // Generate log
    const failedRows = [];
    chunkResults.forEach(cr => {
      cr.processedRows.forEach((row, idx) => {
        if (row.error) {
          const originalIdx = cr.chunkId * chunkSize + idx;
          failedRows.push({
            row_index: originalIdx,
            chunk_id: cr.chunkId,
            error_reason: row.error
          });
        }
      });
    });

    const log = {
      number_of_input_rows: numberOfInputRows,
      number_of_chunks: numberOfChunks,
      number_of_output_rows: schemaMergedRows.length,
      failed_row_details: failedRows,
      added_columns: Array.from(addedColumns),
      chunks_processing_time: chunkResults.map(cr => ({ chunk_id: cr.chunkId, time_ms: cr.processingTime })),
      total_processing_time_ms: Date.now() - startProcessing
    };

    if (processingType === 'clean') {
      log.assumptions = [
        "Applied generic cleaning: trimmed whitespace, normalized dates to ISO YYYY-MM-DD, converted numeric-looking strings to numbers, kept empty cells as empty strings."
      ];
    }

    // Save files
    const processedPath = path.join('downloads', processedExcelFilename);
    const logPath = path.join('downloads', logFilename);

    fs.writeFileSync(processedPath, buf);
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

    fs.unlinkSync(uploadedPath);

    res.json({
      success: true,
      downloads: [{ url: `/downloads/${processedExcelFilename}`, filename: processedExcelFilename },
                  { url: `/downloads/${logFilename}`, filename: logFilename }]
    });
  } catch (error) {
    console.error('Excel processing error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Processing failed'
    });
  }
}



// Models endpoint
app.get('/api/models', async (req, res) => {
  try {
    const response = await new Promise((resolve, reject) => {
      const req = http.get('http://localhost:11434/api/tags', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const json = JSON.parse(data);
              const models = json.models ? json.models.map(m => m.name) : [];
              resolve(models);
            } catch (e) {
              reject(e);
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    });

    res.json({ success: true, models: response });
  } catch (error) {
    console.error('Error fetching models:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch models' });
  }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    // Check if Ollama is running
    const response = await new Promise((resolve, reject) => {
      const req = http.get('http://localhost:11434/', (res) => {
        resolve(res.statusCode === 200);
      });

      req.on('error', () => resolve(false));
      req.setTimeout(5000, () => {
        req.destroy();
        resolve(false);
      });
    });

    if (response) {
      res.json({ status: 'ok', ollama: 'connected' });
    } else {
      res.json({ status: 'ok', ollama: 'disconnected' });
    }
  } catch (error) {
    res.json({ status: 'ok', ollama: 'disconnected' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Ollama Web Processor is running!`);
  console.log(`📍 Open your browser and go to: http://localhost:${PORT}`);
  console.log(`🤖 Make sure Ollama is running with gemma3:4b model\n`);
});

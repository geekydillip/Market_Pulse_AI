
/*
  Minimal Express init. Ensure this block appears BEFORE any app.get/app.post calls.
*/
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx-js-style');
const multer = require('multer');
const http = require('http');

const app = express();              // <-- IMPORTANT: app must be created BEFORE routes
const PORT = process.env.PORT || 3001;
const DEFAULT_OLLAMA_PORT = 11434;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Create keep-alive agent for HTTP connections
const keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });

// serve frontend static files (adjust folder if your frontend is in 'public')
app.use(express.static(path.join(__dirname, 'public')));
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

// simple health route (optional)
app.get('/health', (req, res) => res.json({ status: 'ok' }));

//// ---------------------- BEGIN: Robust Excel read + header detection ----------------------

function readAndNormalizeExcel(uploadedPath) {
  const workbook = xlsx.readFile(uploadedPath, { cellDates: true, raw: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Read sheet as 2D array so we can find header row robustly
  const sheetRows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  // Find a header row: first row that contains at least one expected key or at least one non-empty cell
  let headerRowIndex = 0;
  const expectedHeaderKeywords = ['Case Code', 'Occurr. Stg.','Title','Problem','Model No.','S/W Ver.']; // lowercase checks
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

  // Map header name variants to canonical names
  // Add any other variants you see in your files here
  const headerMap = {
    // Model variants
    'model no': 'Model No.',
    'model no.': 'Model No.',
    'modelno': 'Model No.',
    'model number': 'Model No.',
    // Case Code
    'case code': 'Case Code',
    'caseno': 'Case Code',
    'case no': 'Case Code',
    // S/W Ver variants
    's/w ver.': 'S/W Ver.',
    's/w ver': 'S/W Ver.',
    'sw ver': 'S/W Ver.',
    'swversion': 'S/W Ver.',
    // Occurrence stage
    'occurr. stg.': 'Occurr. Stg.',
    'occurr stg': 'Occurr. Stg.',
    'occurrence stage': 'Occurr. Stg.',
    // Title, Problem, Module, Sub-Module
    'title': 'Title',
    'problem': 'Problem',
    'module': 'Module',
    'sub-module': 'Sub-Module',
    'sub module': 'Sub-Module',
  };

  // canonical columns you expect in the downstream processing
  const canonicalCols = ['Case Code','Occurr. Stg.','Title','Problem','Model No.','S/W Ver.','Module','Sub-Module','Summarized Problem','Severity','Severity Reason'];

  // For each row, build an object with canonical keys, trying to find matches from raw headers via headerMap
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

// Cache for identical prompts
const aiCache = new Map();

// Monitoring variables
let aiRequestCount = 0;
let aiRequestTimes = [];

/**
 * Simple concurrency limiter to run tasks with a limit
 */
async function runTasksWithLimit(tasks, limit = 4) {
  const results = [];
  const executing = new Set();

  for (const task of tasks) {
    const p = Promise.resolve().then(() => task());
    results.push(p);
    executing.add(p);
    p.finally(() => executing.delete(p));
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

/**
 * Cached version of callOllama
 */
async function callOllamaCached(prompt, model = 'gemma3:4b', opts = {}) {
  const key = `${model}|${typeof prompt === 'string' ? prompt : JSON.stringify(prompt)}`;
  if (aiCache.has(key)) {
    console.log('[callOllamaCached] cache hit for key length=%d', key.length);
    return aiCache.get(key);
  }
  const res = await callOllama(prompt, model, opts);
  aiCache.set(key, res);
  return res;
}

/**
 * callOllama - robust HTTP call to local Ollama server
 * prompt: string or object
 * model: string (e.g. "gemma3:4b")
 * opts: { port:number, timeoutMs:number }
 */
async function callOllama(prompt, model = 'gemma3:4b', opts = {}) {
  const port = opts.port || DEFAULT_OLLAMA_PORT;
  const timeoutMs = opts.timeoutMs !== undefined ? opts.timeoutMs : 5 * 60 * 1000; // default 5min, or false to disable

  const callStart = Date.now();

  try {
    const payload = typeof prompt === 'string' ? { model, prompt, stream: false } : { model, ...prompt, stream: false };
    const data = JSON.stringify(payload);

    console.log('[callOllama] port=%d model=%s byteLen=%d', port, model, Buffer.byteLength(data));

    const response = await new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
        port,
        path: '/api/generate',
        method: 'POST',
        agent: keepAliveAgent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'Connection': 'keep-alive'
        }
      };

      const req = http.request(options, (res) => {
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
      if (timeoutMs !== false && timeoutMs !== 0) {
        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error(`Client timeout after ${timeoutMs} ms`));
        });
      }

      req.on('error', (err) => {
        console.error('[callOllama] request error:', err && err.message);
        reject(new Error('Failed to connect to Ollama: ' + (err && err.message)));
      });

      req.write(data);
      req.end();
    });

    aiRequestTimes.push(Date.now() - callStart);
    aiRequestCount++;
    return response;
  } catch (error) {
    throw error;
  }
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

// Store SSE clients for progress updates
const progressClients = new Map();

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
      const vocPrompt = `You are an assistant for cleaning and structuring "Voice of Customer" issue reports.

For each row:
1. Merge & Clean → Combine Title + Problem into one clear English sentence. Remove IDs, tags, usernames, timestamps, anything in [ ... ], non-English text, duplicates, and internal notes.
2. Module → Identify product module from Title (e.g., Lock Screen, Camera, Battery, Network, Display, Settings, etc.).
3. Sub-Module → The functional element affected (e.g., Now bar not working on Lock Screen → Module: Now bar, Sub-Module: Lock Screen).
4. Summarized Problem → One clean sentence describing the actual issue.
5. Severity:
   - Critical: device unusable / crashes / freezing / data loss.
   - High: major function not working.
   - Medium: partial malfunction or intermittent failure.
   - Low: minor UI issue or cosmetic/suggestion.
6. Severity Reason → One sentence explaining the chosen severity.

Rules:
- Ignore all content inside brackets [ ... ].
- Output must be only English.
- Avoid duplicated wording when merging.
- No internal diagnostic notes.
- Preserve input row order.

Output:
Return a **single valid JSON array**.
Each object must contain EXACTLY these keys in this order:

Case Code,
Model No.,
Title,
Problem,
Module,
Sub-Module,
Summarized Problem,
Severity,
Severity Reason

Input Data:
${JSON.stringify(chunk.rows, null, 2)}

Return only the JSON array.`;

      // Send to AI for processing
      const result = await callOllamaCached(vocPrompt, model, { timeoutMs: false });
      const text = result.trim();
      const firstBracket = text.indexOf('[');
      const lastBracket = text.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket > firstBracket) {
        const jsonStr = text.substring(firstBracket, lastBracket + 1);
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed) && parsed.length === chunk.rows.length) {
          processedRows = parsed.map((row, idx) => {
            // Ensure all required keys are present, fill with defaults if missing
            // Include both VOC-specific keys and original data columns we want to preserve
            const requiredKeys = ['Case Code', 'Model No.', 'S/W Ver.', 'Occurr. Stg.', 'Title', 'Problem', 'Module', 'Sub-Module', 'Summarized Problem', 'Severity', 'Severity Reason'];
            const processedRow = {};
            requiredKeys.forEach(key => {
              processedRow[key] = row[key] !== undefined ? row[key] : chunk.rows[idx][key] || ''; // fallback to original
            });
            return processedRow;
          });
        } else if (Array.isArray(parsed) && parsed.length === 0) {
          // AI returned empty array, likely unable to process the row
          // Create processedRows with original data, leaving new columns empty
          processedRows = chunk.rows.map((row, idx) => {
            const processedRow = {};
            const requiredKeys = ['Case Code', 'Model No.', 'S/W Ver.', 'Occurr. Stg.', 'Title', 'Problem', 'Module', 'Sub-Module', 'Summarized Problem', 'Severity', 'Severity Reason'];
            requiredKeys.forEach(key => {
              processedRow[key] = row[key] || ''; // Use original value directly
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
          const result = await callOllamaCached(prompt, model, { timeoutMs: false });
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

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const dateTime = `${year}${month}${day}_${hours}${minutes}${seconds}`;
    const sanitizedModel = req.body.model.replace(/[^a-zA-Z0-9]/g, '_');
    const processedJSONFilename = `${fileNameBase}_${sanitizedModel}_${dateTime}_Processed.json`;
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

    // Remove top 2 rows before pre-processing
    rows = rows.slice(2);

    const tStart = Date.now();
    const headers = Object.keys(rows[0] || {});

    // Use VOC processing type for JSON (since only structured data should be in JSON)
    const processingType = req.body.processingType || 'voc';
    const customPrompt = req.body.customPrompt || '';
    const model = req.body.model || 'gemma3:4b';
    const sessionId = req.body.sessionId || 'default';

    // Unified chunked processing (works for all types: clean, voc, custom)
    const numberOfInputRows = rows.length;
    // Adaptive chunk size (replace existing fixed chunkSize)
    const ROWSCOUNT = rows.length || 0;

    // If VOC strict per-row analysis required, use 1 row per chunk, but batch when file > threshold
    let chunkSize;
    if (processingType === 'voc') {
      chunkSize = ROWSCOUNT <= 50 ? 1
                : ROWSCOUNT <= 200 ? 2
                : 4;
    } else {
      chunkSize = ROWSCOUNT <= 200 ? 5
                : ROWSCOUNT <= 1000 ? 10
                : 20;
    }
    const numberOfChunks = Math.max(1, Math.ceil(ROWSCOUNT / chunkSize));

    // Send initial progress for JSON
    sendProgress(sessionId, {
      type: 'progress',
      percent: 0,
      message: 'Starting JSON processing...',
      chunksCompleted: 0,
      totalChunks: numberOfChunks
    });

    // Build chunk tasks
    const tasks = [];
    for (let i = 0; i < numberOfChunks; i++) {
      const startIdx = i * chunkSize;
      const endIdx = Math.min(startIdx + chunkSize, rows.length);
      const chunkRows = rows.slice(startIdx, endIdx);
      const chunk = { file_name: originalName, chunk_id: i, row_indices: [startIdx, endIdx-1], headers, rows: chunkRows };
      tasks.push(async () => {
        const result = await processChunk(chunk, processingType, customPrompt, model, i);
        // send per-chunk progress update
        sendProgress(sessionId, { type: 'progress', percent: Math.round((i+1)/numberOfChunks*100), message: `Processed chunk ${i+1}/${numberOfChunks}`, chunkId: i });
        return result;
      });
    }

    // Run with concurrency limit (4)
    const chunkResults = await runTasksWithLimit(tasks, 4);

    // Process results
    const allProcessedRows = [];
    const addedColumns = new Set();

    chunkResults.forEach(result => {
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
    });

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
      total_processing_time_ms: Date.now() - tStart,
      total_processing_time_seconds: ((Date.now() - tStart) / 1000).toFixed(3),
      number_of_input_rows: numberOfInputRows,
      number_of_chunks: numberOfChunks,
      number_of_output_rows: finalRows.length,
      failed_row_details: failedRows,
      added_columns: Array.from(addedColumns),
      chunks_processing_time: chunkResults.map(cr => ({ chunk_id: cr.chunkId, time_ms: cr.processingTime }))
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
      total_processing_time_ms: Date.now(),
      processedRows: finalRows,
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

// Progress SSE endpoint
app.get('/api/progress/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Store this client
  progressClients.set(sessionId, res);

  // Heartbeat every 30 seconds
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 30000);

  // Clean up on client disconnect
  req.on('close', () => {
    progressClients.delete(sessionId);
    clearInterval(keepAlive);
  });
});

// Function to send progress updates to a specific session
function sendProgress(sessionId, data) {
  const client = progressClients.get(sessionId);
  if (client) {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

// Excel processing with chunking
async function processExcel(req, res) {
  try {
    console.log('Starting Excel processing...');
    const tStart = Date.now();
    const uploadedPath = req.file.path;
    const originalName = req.file.originalname;
    const fileNameBase = originalName.replace(/\.[^/.]+$/, ''); // Remove extension

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const dateTime = `${year}${month}${day}_${hours}${minutes}${seconds}`;
    const sanitizedModel = req.body.model.replace(/[^a-zA-Z0-9]/g, '_');
    const processedExcelFilename = `${fileNameBase}_${sanitizedModel}_${dateTime}_Processed.xlsx`;
    const logFilename = `${fileNameBase}_log.json`;

    // Use the robust Excel reading function
    let rows = readAndNormalizeExcel(uploadedPath);

    // Sanity check: verify we have meaningful rows with Title/Problem data
    const meaningful = rows.filter(r => String(r['Title']||'').trim() !== '' || String(r['Problem']||'').trim() !== '');
    console.log(`Read ${rows.length} rows; ${meaningful.length} rows with Title/Problem data.`);
    if (meaningful.length === 0) {
      console.warn('No meaningful rows found - check header detection logic or the uploaded file.');
    }

    // Set headers to the canonical columns from the function
    const headers = ['Case Code','Occurr. Stg.','Title','Problem','Model No.','S/W Ver.'];

    // Use the requested processing type for Excel
    const processingType = req.body.processingType || 'clean';
    const customPrompt = req.body.customPrompt || '';
    const model = req.body.model || 'qwen3:4b-instruct';
    const sessionId = req.body.sessionId || 'default';

    // Unified chunked processing (works for all types: clean, voc, custom)
    const numberOfInputRows = rows.length;
    // Adaptive chunk size (replace existing fixed chunkSize)
    const ROWSCOUNT = rows.length || 0;

    // If VOC strict per-row analysis required, use 1 row per chunk, but batch when file > threshold
    let chunkSize;
    if (processingType === 'voc') {
      chunkSize = ROWSCOUNT <= 50 ? 1
                : ROWSCOUNT <= 200 ? 2
                : 4;
    } else {
      chunkSize = ROWSCOUNT <= 200 ? 5
                : ROWSCOUNT <= 1000 ? 10
                : 20;
    }
    const numberOfChunks = Math.max(1, Math.ceil(ROWSCOUNT / chunkSize));

    // Send initial progress (0%)
    sendProgress(sessionId, {
      type: 'progress',
      percent: 0,
      message: 'Starting Excel processing...',
      chunksCompleted: 0,
      totalChunks: numberOfChunks
    });

    // Build chunk tasks
    const tasks = [];
    for (let i = 0; i < numberOfChunks; i++) {
      const startIdx = i * chunkSize;
      const endIdx = Math.min(startIdx + chunkSize, rows.length);
      const chunkRows = rows.slice(startIdx, endIdx);
      const chunk = { file_name: originalName, chunk_id: i, row_indices: [startIdx, endIdx-1], headers, rows: chunkRows };
      tasks.push(async () => {
        const result = await processChunk(chunk, processingType, customPrompt, model, i);
        // send per-chunk progress update
        sendProgress(sessionId, { type: 'progress', percent: Math.round((i+1)/numberOfChunks*100), message: `Processed chunk ${i+1}/${numberOfChunks}`, chunkId: i });
        return result;
      });
    }

    // Run with concurrency limit (4)
    const chunkResults = await runTasksWithLimit(tasks, 4);

    // Process results
    const allProcessedRows = [];
    const addedColumns = new Set();

    chunkResults.forEach(result => {
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
    });

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
      for (const header of finalHeaders) {
        mergedRow[header] = row[header] === undefined ? null : row[header];
      }
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

    // === Apply Column Widths ===
    newSheet['!cols'] = [
        { wch: 15 },  // Case Code
        { wch: 15 },  // Occurr. Stg.
        { wch: 41 },  // Title
        { wch: 41 },  // Problem
        { wch: 20 },  // Model No.
        { wch: 15 },  // S/W Ver.
        { wch: 15 },  // Module
        { wch: 15 },  // Sub-Module (added column)
        { wch: 41 },  // Summarized Problem
        { wch: 15 },  // Severity
        { wch: 41 },  // Severity Reason
        { wch: 15 }   // error (if added)
    ];

    // === Apply Cell Alignment and Text Wrap ===
    Object.keys(newSheet).forEach((cellKey) => {
        if (cellKey[0] === '!') return;
        newSheet[cellKey].s = {
            alignment: { horizontal: "center", vertical: "center", wrapText: true }
        };
    });

    // === Apply Header Styling ===
    finalHeaders.forEach((header, index) => {
        const cellAddress = xlsx.utils.encode_cell({ r: 0, c: index });
        if (!newSheet[cellAddress]) return;
        newSheet[cellAddress].s = {
            fill: { patternType: "solid", fgColor: { rgb: "1E90FF" } },
            font: { bold: true, color: { rgb: "FFFFFF" }, sz: 12 },
            alignment: { horizontal: "center", vertical: "center", wrapText: true }
        };
    });

    const buf = xlsx.write(newWb, { bookType: 'xlsx', type: 'buffer' });

    // Calculate elapsed time
    const tEnd = Date.now();
    const elapsedMs = tEnd - tStart;
    const elapsedSec = elapsedMs / 1000;

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
      total_processing_time_ms: elapsedMs,
      total_processing_time_seconds: elapsedSec.toFixed(3),
      number_of_input_rows: numberOfInputRows,
      number_of_chunks: numberOfChunks,
      number_of_output_rows: schemaMergedRows.length,
      failed_row_details: failedRows,
      added_columns: Array.from(addedColumns),
      chunks_processing_time: chunkResults.map(cr => ({ chunk_id: cr.chunkId, time_ms: cr.processingTime }))
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
      total_processing_time_ms: Date.now(),
      processedRows: schemaMergedRows,
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

/**
 * Read all .xlsx/.xls files from candidate directories and aggregate summary
 * Returns an array of { model, swver, grade, critical_module, critical_voc, count }
 */
app.get('/api/visualize', async (req, res) => {
  try {
    const result = await getVisualizationData();
    res.json({ success: true, summary: result.summary, filesScanned: result.filesScanned, chosenDir: result.chosenDir, tried: result.tried });
  } catch (error) {
    console.error('Visualize error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get visualization data (shared function)
 */
async function getVisualizationData() {
  const candidateDirs = [
    path.join(__dirname, 'downloads'),
    path.join(__dirname, 'Downloads'),
    path.join(process.cwd(), 'downloads'),
    path.join(process.cwd(), 'Downloads'),
    path.join(__dirname, 'public', 'downloads'),
    '/mnt/data',                       // common place where uploaded files live in some environments
    path.join(process.env.HOME || '', 'Downloads'), // user's Downloads on *nix
    path.join(process.env.USERPROFILE || '', 'Downloads') // user's Downloads on Windows
  ];

  const tried = [];
  let chosenDir = null;
  let files = [];

  for (const d of candidateDirs) {
    if (!d) { tried.push({ dir: d, exists: false }); continue; }
    try {
      const exists = fs.existsSync(d);
      tried.push({ dir: d, exists });
      if (!exists) continue;
      const list = fs.readdirSync(d).filter(f => /\.(xlsx|xls)$/i.test(f));
      tried[tried.length - 1].excelCount = list.length;
      if (list.length > 0) {
        chosenDir = d;
        files = list;
        break;
      }
    } catch (e) {
      tried[tried.length - 1].error = String(e && e.message || e);
    }
  }

  if (!chosenDir) {
    return { summary: [], filesScanned: 0, chosenDir: null, tried }; // No files found
  }

  const aggregation = new Map();

  function pickField(row, candidates) {
    for (const c of candidates) {
      if (row.hasOwnProperty(c) && row[c] !== undefined && row[c] !== null && String(row[c]).toString().trim() !== '') {
        return String(row[c]).trim();
      }
    }
    return '';
  }

  function pickSubModule(row, candidates) {
    // Try to get sub-module first, then fall back to module if no sub-module
    for (const c of candidates) {
      if (row.hasOwnProperty(c) && row[c] !== undefined && row[c] !== null && String(row[c]).toString().trim() !== '') {
        return String(row[c]).trim();
      }
    }
    // If no sub-module found, try to get just module
    const module = pickField(row, ['Module', 'Critical Module', 'critical module', 'Module Name']);
    return module; // Return module if no sub-module, can be used for grouping
  }

  for (const file of files) {
    try {
      const filePath = path.join(chosenDir, file);
      const wb = xlsx.readFile(filePath);
      const sheetName = wb.SheetNames[0];
      if (!sheetName) continue;
      const ws = wb.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });

      for (const r of rows) {
        // Try common header names
        const model = pickField(r, ['Model No.', 'Model No', 'Model', 'ModelNo', 'Model No']);
        const swver = pickField(r, ['S/W Ver.', 'SW Ver', 'Software Version', 'S/W Version', 'S/W Ver']);
        const grade = pickField(r, ['Grade', 'Garde', 'grade']);
        const critical_module = pickField(r, ['Critical Module', 'Cirital Module', 'Module', 'critical module', 'Module Name']);
        const critical_voc = pickField(r, ['Critical VOC', 'Critical VOCs', 'Critical_VOC', 'Critical', 'VOC']);

        // Build key
        const key = `${model}||${swver}||${grade}||${critical_module}||${critical_voc}`;
        aggregation.set(key, (aggregation.get(key) || 0) + 1);
      }
    } catch (err) {
      console.warn('Failed to read', file, err && err.message);
      continue;
    }
  }

  // Convert aggregation map to array
  const summary = Array.from(aggregation.entries()).map(([k, count]) => {
    const [model, swver, grade, critical_module, critical_voc] = k.split('||');
    return {
      model: model || '',
      swver: swver || '',
      grade: grade || '',
      critical_module: critical_module || '',
      critical_voc: critical_voc || '',
      count
    };
  });

  // Sort by count descending
  summary.sort((a,b) => b.count - a.count);

  return { summary, filesScanned: files.length, chosenDir, tried };
}

// CSV export endpoint
app.get('/api/visualize/export', async (req, res) => {
  try {
    const resp = await getVisualizationData();
    // Build CSV header
    const csvHeader = ['model','swver','grade','critical_module','critical_voc','count'];
    const lines = [csvHeader.join(',')];
    resp.summary.forEach(r => {
      lines.push([r.model,r.swver,r.grade,r.critical_module,r.critical_voc,r.count].map(v => `\"${String(v||'').replace(/\"/g,'\"\"')}\"`).join(','));
    });
    const csv = lines.join('\n');
    res.setHeader('Content-disposition', 'attachment; filename=visualize_summary.csv');
    res.setHeader('Content-Type', 'text/csv');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ success:false, error: e.message });
  }
});

/**
 * Get detailed rows for a specific combination of fields
 */
app.get('/api/module-details', async (req, res) => {
  try {
    const {model, swver, grade, module: critical_module, voc: critical_voc} = req.query;

    const candidateDirs = [
      path.join(process.cwd(), 'downloads'),
      path.join(process.cwd(), 'Downloads'),
      path.join(__dirname, 'downloads'),
      path.join(__dirname, 'Downloads'),
      path.join(__dirname, 'public', 'downloads'),
      '/mnt/data',
      path.join(process.env.HOME || '', 'Downloads'),
      path.join(process.env.USERPROFILE || '', 'Downloads')
    ];

    let chosenDir = null;
    let files = [];

    for (const d of candidateDirs) {
      if (!d) continue;
      try {
        const exists = fs.existsSync(d);
        if (!exists) continue;
        const list = fs.readdirSync(d).filter(f => /\.(xlsx|xls)$/i.test(f));
        if (list.length > 0) {
          chosenDir = d;
          files = list;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!chosenDir) {
      return res.json({ success: true, details: [] });
    }

    const details = [];
    function pickField(row, candidates) {
      for (const c of candidates) {
        if (row.hasOwnProperty(c) && row[c] !== undefined && row[c] !== null && String(row[c]).toString().trim() !== '') {
          return String(row[c]).trim();
        }
      }
      return '';
    }

    for (const file of files) {
      try {
        const filePath = path.join(chosenDir, file);
        const wb = xlsx.readFile(filePath);
        const sheetName = wb.SheetNames[0];
        if (!sheetName) continue;
        const ws = wb.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });

        for (const r of rows) {
          const rmodel = pickField(r, ['Model No.', 'Model No', 'Model', 'ModelNo', 'Model No']);
          const rswver = pickField(r, ['S/W Ver.', 'SW Ver', 'Software Version', 'S/W Version', 'S/W Ver']);
          const rgrade = pickField(r, ['Grade', 'Garde', 'grade']);
          const critMod = pickField(r, ['Critical Module', 'Cirital Module', 'Module', 'critical module', 'Module Name']);
          const critVoc = pickField(r, ['Critical VOC', 'Critical VOCs', 'Critical_VOC', 'Critical', 'VOC']);

      // Exact match for all combination fields (case-insensitive and trimmed)
      if (String(rmodel).toLowerCase().trim() !== String(model).toLowerCase().trim() ||
          String(rswver).toLowerCase().trim() !== String(swver).toLowerCase().trim() ||
          String(rgrade).toLowerCase().trim() !== String(grade).toLowerCase().trim() ||
          String(critMod).toLowerCase().trim() !== String(critical_module).toLowerCase().trim() ||
          String(critVoc).toLowerCase().trim() !== String(critical_voc).toLowerCase().trim()) continue;

          // Collect the detailed fields for display
          details.push({
            caseCode: pickField(r, ['Case Code', 'CaseCode', 'Case']),
            model: pickField(r, ['Model No.', 'Model No', 'Model']),
            swver: pickField(r, ['S/W Ver.', 'SW Ver', 'Software Version']),
            grade: pickField(r, ['Grade', 'Garde']),
            critical_voc: pickField(r, ['Critical VOC', 'Critical VOCs']),
            title: pickField(r, ['Title']),
            problem: pickField(r, ['Problem']),
            summarized_problem: pickField(r, ['Summarized Problem']),
            severity: pickField(r, ['Severity']),
            severity_reason: pickField(r, ['Severity Reason'])
          });
        }
      } catch (err) {
        continue;
      }
    }

    res.json({ success: true, details });
  } catch (error) {
    console.error('Module details error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Ollama Web Processor is running!`);
  console.log(`📍 Open your browser and go to: http://localhost:${PORT}`);
  console.log(`🤖 Make sure Ollama is running (gemma3:4b or qwen3:4b-instruct preferred)\n`);
});

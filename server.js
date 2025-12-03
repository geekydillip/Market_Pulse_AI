
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
const DEFAULT_AI_MODEL = 'qwen3:4b-instruct';

// Security constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_FILE_TYPES = ['.xlsx', '.xls', '.json'];
const ALLOWED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/json',
  'text/json'
];

// Input validation middleware
function validateFileUpload(req, res, next) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  // Check file size
  if (req.file.size > MAX_FILE_SIZE) {
    // Clean up the uploaded file
    if (req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(400).json({ error: 'File too large. Maximum size is 10MB' });
  }

  // Check file extension
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!ALLOWED_FILE_TYPES.includes(ext)) {
    if (req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(400).json({ error: 'Invalid file type. Only .xlsx, .xls, and .json files are allowed' });
  }

  // Check MIME type (basic validation)
  if (req.file.mimetype && !ALLOWED_MIME_TYPES.includes(req.file.mimetype)) {
    if (req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(400).json({ error: 'Invalid file format' });
  }

  // Sanitize filename to prevent path traversal
  req.file.safeFilename = req.file.filename.replace(/[^a-zA-Z0-9._-]/g, '');

  next();
}

// Input sanitization function
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  // Remove any potential script tags and dangerous characters
  return input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
              .replace(/javascript:/gi, '')
              .replace(/on\w+\s*=/gi, '')
              .trim();
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Create keep-alive agent for HTTP connections
const keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });

// serve frontend static files (adjust folder if your frontend is in 'public')
app.use(express.static(path.join(__dirname, 'public')));
app.use('/downloads', express.static('downloads'));

// Configure multer for file uploads with security
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Ensure uploads directory exists
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    // Generate safe filename
    const safeName = sanitizeInput(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '');
    const uniqueName = Date.now() + '-' + safeName;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    // Additional MIME type validation
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('Invalid file type'), false);
    }
    cb(null, true);
  }
});

// simple health route (optional)
app.get('/health', (req, res) => res.json({ status: 'ok' }));



// Mapping of frontend processingType to processor filenames
const processorMap = {
  'beta_user_issues': 'betaIssues',
  'samsung_members_plm': 'samsungMembersPlm',
  'plm_issues': 'plmIssues'
};

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
async function callOllamaCached(prompt, model = DEFAULT_AI_MODEL, opts = {}) {
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
 * model: string (e.g. "qwen3:4b-instruct")
 * opts: { port:number, timeoutMs:number }
 */
async function callOllama(prompt, model = DEFAULT_AI_MODEL, opts = {}) {
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
app.post('/api/process', upload.single('file'), validateFileUpload, async (req, res) => {
  try {
    // Sanitize input parameters to prevent injection
    const processingType = sanitizeInput(req.body.processingType || 'beta_user_issues');
    const model = sanitizeInput(req.body.model || DEFAULT_AI_MODEL);

    // Validate processing type
    const validProcessingTypes = ['beta_user_issues', 'clean', 'samsung_members_plm', 'samsung_members_voc', 'plm_issues']; // Supported processing types
    if (!validProcessingTypes.includes(processingType)) {
      return res.status(400).json({ error: 'Invalid processing type.' });
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
async function processChunk(chunk, processingType, model, chunkId) {
  const startTime = Date.now();
  let processedRows = null;

  try {
    // Handle clean processing separately
    if (processingType === 'clean') {
      processedRows = chunk.rows.map(row => {
        const cleanedRow = {};
        for (const [key, value] of Object.entries(row)) {
          cleanedRow[key] = applyGenericCleaning(value);
        }
        return cleanedRow;
      });

      return {
        chunkId,
        processedRows,
        status: 'ok',
        processingTime: Date.now() - startTime
      };
    }

    // Dynamic processor loading for AI-based processing
    const processorName = processorMap[processingType];
    if (!processorName) {
      return {
        chunkId,
        processedRows: chunk.rows.map((row) => ({ ...row, error: `Unknown processing type: ${processingType}` })),
        status: 'failed',
        processingTime: Date.now() - startTime,
        error: `Unknown processing type: ${processingType}`
      };
    }

    let processor;
    try {
      processor = require(`./processors/${processorName}`);
    } catch (err) {
      return {
        chunkId,
        processedRows: chunk.rows.map((row) => ({ ...row, error: `Failed to load processor: ${err.message}` })),
        status: 'failed',
        processingTime: Date.now() - startTime,
        error: err.message
      };
    }

    // Validate headers if processor supports it
    if (processor.validateHeaders && !processor.validateHeaders(chunk.headers)) {
      return {
        chunkId,
        processedRows: chunk.rows.map((row) => ({ ...row, error: 'Invalid data format for processing' })),
        status: 'failed',
        processingTime: Date.now() - startTime,
        error: 'Invalid data format for processing'
      };
    }

    // Transform data if needed
    const transformedRows = processor.transform ? processor.transform(chunk.rows) : chunk.rows;

    // Build prompt
    const prompt = processor.buildPrompt ? processor.buildPrompt(transformedRows) : JSON.stringify(transformedRows).slice(0, 1000);

    // Call AI (cached)
    const result = await callOllamaCached(prompt, model, { timeoutMs: false });

    // Format response
    try {
      processedRows = processor.formatResponse ? processor.formatResponse(result) : (typeof result === 'string' ? JSON.parse(result) : result);
    } catch (err) {
      // If formatting/parsing failed, return error per row
      return {
        chunkId,
        processedRows: chunk.rows.map((row) => ({ ...row, error: `Failed to parse processor result: ${err.message}` })),
        status: 'failed',
        processingTime: Date.now() - startTime,
        error: err.message
      };
    }

    // Special handling for summary container response
    let _plmFormat = false;
    try {
      const { isSummaryContainer } = require('./processors/_helpers');
      if (isSummaryContainer(processedRows)) {
        _plmFormat = true;
        processedRows = processedRows.data || [];
      }
    } catch (e) {
      // ignore if helpers not present
    }

    return {
      chunkId,
      processedRows,
      status: processedRows ? 'ok' : 'failed',
      processingTime: Date.now() - startTime,
      _plmFormat
    };
  } catch (error) {
    return {
      chunkId,
      processedRows: chunk.rows.map((row) => ({ ...row, error: error.message || 'Processing failed' })),
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

    const modelRaw = (req.body.model || '').toString();
    const sanitizedModel = modelRaw.replace(/[^a-zA-Z0-9]/g, '_');
    const processedJSONFilename = `${fileNameBase}_${sanitizedModel}_${dateTime}_Processed.json`;
    const logFilename = `${fileNameBase}_log.json`;

    // Read and parse JSON file
    const fileContent = fs.readFileSync(uploadedPath, 'utf-8');
    let rows;
    try {
      rows = JSON.parse(fileContent);
      if (!Array.isArray(rows)) {
        // clean up uploaded file
        if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
        return res.status(400).json({ error: 'JSON file must contain an array of objects' });
      }
      if (rows.length === 0 || typeof rows[0] !== 'object') {
        if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
        return res.status(400).json({ error: 'JSON file must contain an array of non-empty objects' });
      }
    } catch (parseError) {
      if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
      return res.status(400).json({ error: 'Invalid JSON format: ' + parseError.message });
    }

    const tStart = Date.now();
    const headers = Object.keys(rows[0] || {});

    // Use Beta user issues processing type for JSON (since only structured data should be in JSON)
    const processingType = req.body.processingType || 'beta_user_issues';
    const model = req.body.model || 'qwen3:4b-instruct';
    const sessionId = req.body.sessionId || 'default';

    // Unified chunked processing (works for all types: clean, voc, custom)
    const numberOfInputRows = rows.length;
    const ROWSCOUNT = rows.length || 0;

    let chunkSize;
    if (processingType === 'beta_user_issues' || processingType === 'samsung_members_plm' || processingType === 'plm_issues') {
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
      const chunk = { file_name: originalName, chunk_id: i, row_indices: [startIdx, endIdx - 1], headers, rows: chunkRows };
      tasks.push(async () => {
        const result = await processChunk(chunk, processingType, model, i);
        // send per-chunk progress update
        sendProgress(sessionId, {
          type: 'progress',
          percent: Math.round((i + 1) / numberOfChunks * 100),
          message: `Processed chunk ${i + 1}/${numberOfChunks}`,
          chunkId: i
        });
        return result;
      });
    }

    // Run with concurrency limit (4)
    const chunkResults = await runTasksWithLimit(tasks, 4);

    // Process results
    const allProcessedRows = [];
    const addedColumns = new Set();

    chunkResults.forEach(result => {
      if (!result) return;
      if (result.status === 'ok' && Array.isArray(result.processedRows)) {
        result.processedRows.forEach((row, idx) => {
          const originalIdx = (result.chunkId * chunkSize) + idx;
          allProcessedRows[originalIdx] = row;
          Object.keys(row || {}).forEach(col => {
            if (!headers.includes(col)) addedColumns.add(col);
          });
        });
      } else if (Array.isArray(result.processedRows)) {
        // include failed chunk rows (they may contain error fields)
        result.processedRows.forEach((row, idx) => {
          const originalIdx = (result.chunkId * chunkSize) + idx;
          allProcessedRows[originalIdx] = row;
          if (row && row.error) addedColumns.add('error');
        });
      }
    });

    // Filter out null entries if any (though shouldn't have)
    const finalRows = allProcessedRows.filter(row => row != null);

    // Generate log (defensive)
    const failedRows = [];
    (chunkResults || []).forEach(cr => {
      (cr.processedRows || []).forEach((row, idx) => {
        if (row && row.error) {
          const originalIdx = (cr.chunkId * chunkSize) + idx;
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
      chunks_processing_time: (chunkResults || []).map(cr => ({ chunk_id: cr.chunkId, time_ms: cr.processingTime }))
    };

    if (processingType === 'clean') {
      log.assumptions = [
        "Applied generic cleaning: trimmed whitespace, normalized dates to ISO YYYY-MM-DD, converted numeric-looking strings to numbers, kept empty cells as empty strings."
      ];
    }

    // Save files
    const dlDir = path.join(__dirname, 'downloads', processingType);
    if (!fs.existsSync(dlDir)) fs.mkdirSync(dlDir, { recursive: true });

    const processedPath = path.join(dlDir, processedJSONFilename);
    const logPath = path.join(dlDir, logFilename);

    fs.writeFileSync(processedPath, JSON.stringify(finalRows, null, 2));
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

    // Clean up uploaded file
    try { if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath); } catch (e) {}

    res.json({
      success: true,
      total_processing_time_ms: Date.now() - tStart,
      processedRows: finalRows,
      downloads: [
        { url: `/downloads/${processingType}/${processedJSONFilename}`, filename: processedJSONFilename },
        { url: `/downloads/${processingType}/${logFilename}`, filename: logFilename }
      ]
    });
  } catch (error) {
    console.error('JSON processing error:', error);
    // Attempt to remove uploaded file on unexpected error
    try { if (req && req.file && req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch (e) {}
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

    const modelRaw = (req.body.model || '').toString();
    const sanitizedModel = modelRaw.replace(/[^a-zA-Z0-9]/g, '_');
    const processedExcelFilename = `${fileNameBase}_${sanitizedModel}_${dateTime}_Processed.xlsx`;
    const logFilename = `${fileNameBase}_log.json`;

    // Use the requested processing type for Excel
    const processingType = req.body.processingType || 'clean';
    const model = req.body.model || 'qwen3:4b-instruct';
    const sessionId = req.body.sessionId || 'default';

    // Load the dynamic processor for reading and processing
    const processorName = processorMap[processingType];
    const processor = require('./processors/' + processorName);

    // Use processor's readAndNormalizeExcel if available, else fallback to betaIssues
    const readAndNormalizeExcel = processor.readAndNormalizeExcel || require('./processors/betaIssues').readAndNormalizeExcel;
    let rows = readAndNormalizeExcel(uploadedPath) || [];

    // Sanity check: verify we have meaningful rows with Title/Problem data
    const meaningful = rows.filter(r => String(r['Title']||'').trim() !== '' || String(r['Problem']||'').trim() !== '');
    console.log(`Read ${rows.length} rows; ${meaningful.length} rows with Title/Problem data.`);
    if (meaningful.length === 0) {
      console.warn('No meaningful rows found - check header detection logic or the uploaded file.');
    }

    // Set headers to the canonical columns (using processor's expectedHeaders if available)
    const headers = processor.expectedHeaders || ['Case Code','Model No.','S/W Ver.','Title','Problem'];

    // Unified chunked processing (works for all types: clean, voc, custom)
    const numberOfInputRows = rows.length;
    const ROWSCOUNT = rows.length || 0;

    // If AI processing types require smaller chunks, use 1 row per chunk, but batch when file > threshold
    let chunkSize;
    if (processingType === 'beta_user_issues' || processingType === 'samsung_members_plm' || processingType === 'plm_issues') {
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
        const result = await processChunk(chunk, processingType, model, i);
        // send per-chunk progress update
        sendProgress(sessionId, { type: 'progress', percent: Math.round((i+1)/numberOfChunks*100), message: `Processed chunk ${i+1}/${numberOfChunks}`, chunkId: i });
        return result;
      });
    }

    // Run with concurrency limit (4)
    const chunkResults = await runTasksWithLimit(tasks, 4) || [];

    // Process results
    const allProcessedRows = [];
    const addedColumns = new Set();

    (chunkResults || []).forEach(result => {
      if (!result) return;
      if (result.status === 'ok' && Array.isArray(result.processedRows)) {
        result.processedRows.forEach((row, idx) => {
          const originalIdx = result.chunkId * chunkSize + idx;
          allProcessedRows[originalIdx] = row;
          Object.keys(row || {}).forEach(col => {
            if (!headers.includes(col)) addedColumns.add(col);
          });
        });
      } else if (Array.isArray(result.processedRows)) {
        // For failed chunks, still include rows with error
        result.processedRows.forEach((row, idx) => {
          const originalIdx = result.chunkId * chunkSize + idx;
          allProcessedRows[originalIdx] = row;
          if (row && row.error) addedColumns.add('error');
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
        mergedRow[header] = row && Object.prototype.hasOwnProperty.call(row, header) ? row[header] : null;
      }
      return mergedRow;
    });

    // Convert back to Excel
    const newWb = xlsx.utils.book_new();
    const newSheet = xlsx.utils.json_to_sheet(schemaMergedRows);
    xlsx.utils.book_append_sheet(newWb, newSheet, 'Data');

    // Add error column if there were failures
    const hasErrors = (chunkResults || []).some(cr => cr && (cr.status === 'failed' || (Array.isArray(cr.processedRows) && cr.processedRows.some(r => r && r.error))));
    if (hasErrors && !finalHeaders.includes('error')) {
      finalHeaders.push('error');
    }

    // === Apply Column Widths (moved to processor for better organization) ===
    newSheet['!cols'] = processor.getColumnWidths(finalHeaders);

    // === Apply Cell Styles (fonts, alignment, borders) ===
    const dataRows = schemaMergedRows.length;
    const totalColumns = finalHeaders.length;

    // Define column alignments based on webpage table
    const centerAlignColumns = [0, 1, 2, 6, 7, 8, 9, 10, 11, 13]; // Case Code, Title, Problem, Module (0-based)
    // Case Code (0), Model (1), Grade (2), S/W Ver. (3), Severity (7) are centered

    Object.keys(newSheet).forEach((cellKey) => {
      if (cellKey[0] === '!') return;

      // decode single cell like "A1"
      const cellRef = xlsx.utils.decode_cell(cellKey);
      const col = cellRef.c; // zero-based column index
      const row = cellRef.r; // zero-based row index

      let cellStyle = {
        alignment: { vertical: "center", wrapText: true },
        font: {
          name: "Arial",
          sz: 10,
          color: { rgb: row === 0 ? "FFFFFF" : "000000" } // header row white, data black
        }
      };

      if (row === 0) {
        // Header row - always center
        cellStyle.alignment.horizontal = "center";
      } else {
        // Data rows - center specific columns, left for others
        if (centerAlignColumns.includes(col)) {
          cellStyle.alignment.horizontal = "center";
        } else {
          cellStyle.alignment.horizontal = "left";
        }
      }

      if (row > 0 && row <= dataRows) {
        cellStyle.border = {
          top: { style: "thin", color: { rgb: "ADD8E6" } },
          bottom: { style: "thin", color: { rgb: "ADD8E6" } },
          left: { style: "thin", color: { rgb: "ADD8E6" } },
          right: { style: "thin", color: { rgb: "ADD8E6" } }
        };
      }

      // Assign style back
      if (newSheet[cellKey]) newSheet[cellKey].s = cellStyle;
    });

    // === Apply Header Styling ===
    const specialHeaders = ['Module', 'Sub-Module', 'Issue Type', 'Sub-Issue Type', 'Summarized Problem', 'Severity', 'Severity Reason'];
    finalHeaders.forEach((header, index) => {
      const cellAddress = xlsx.utils.encode_cell({ r: 0, c: index });
      if (!newSheet[cellAddress]) return;
      const isSpecialHeader = specialHeaders.includes(header);
      newSheet[cellAddress].s = {
        fill: { patternType: "solid", fgColor: { rgb: isSpecialHeader ? "1E90FF" : "000080" } },
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
    (chunkResults || []).forEach(cr => {
      (cr && cr.processedRows || []).forEach((row, idx) => {
        if (row && row.error) {
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
      chunks_processing_time: (chunkResults || []).map(cr => ({ chunk_id: cr && cr.chunkId, time_ms: cr && cr.processingTime }))
    };

    if (processingType === 'clean') {
      log.assumptions = [
        "Applied generic cleaning: trimmed whitespace, normalized dates to ISO YYYY-MM-DD, converted numeric-looking strings to numbers, kept empty cells as empty strings."
      ];
    }

    // Save files
    const dlDir = path.join(__dirname, 'downloads', processingType);
    if (!fs.existsSync(dlDir)) fs.mkdirSync(dlDir, { recursive: true });

    const processedPath = path.join(dlDir, processedExcelFilename);
    const logPath = path.join(dlDir, logFilename);

    fs.writeFileSync(processedPath, buf);
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

    try { if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath); } catch (e) {}

    res.json({
      success: true,
      total_processing_time_ms: Date.now() - tStart,
      processedRows: schemaMergedRows,
      downloads: [{ url: `/downloads/${processingType}/${processedExcelFilename}`, filename: processedExcelFilename },
                  { url: `/downloads/${processingType}/${logFilename}`, filename: logFilename }]
    });
  } catch (error) {
    console.error('Excel processing error:', error);
    try { if (req && req.file && req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch(e) {}
    res.status(500).json({
      success: false,
      error: error.message || 'Processing failed'
    });
  }
}

// ---------- Dashboard endpoints: read model from sheet cell and aggregate ----------
// (XLSX is already required above as 'xlsx')

// Helper: find a cell that contains \"Model No\" (case-insensitive) and return the value of the cell below it
function getModelFromSheet(ws) {
  if (!ws || !ws['!ref']) return '';
  const range = xlsx.utils.decode_range(ws['!ref']);
  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const addr = xlsx.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr];
      if (!cell || !cell.v) continue;
      const txt = String(cell.v).trim();
      if (/model\s*no/i.test(txt) || /^model\s*no\.?$/i.test(txt) || /^model$/i.test(txt)) {
        // take the cell below if present
        const belowAddr = xlsx.utils.encode_cell({ r: R + 1, c: C });
        const belowCell = ws[belowAddr];
        if (belowCell && typeof belowCell.v !== 'undefined') return String(belowCell.v).trim();
        // fallback: try to read from column E row 1 (E1) if above not found
        try {
          const fallback = ws['E1'] && ws['E1'].v ? String(ws['E1'].v).trim() : '';
          if (fallback) return fallback;
        } catch (e) {}
      }
    }
  }
  // fallback heuristics: if there is a header row with \"Model\" column, try sheet_to_json
  try {
    const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
    if (rows.length) {
      const first = rows[0];
      if (first['Model'] && String(first['Model']).trim()) return String(first['Model']).trim();
      if (first['Model No.'] && String(first['Model No.']).trim()) return String(first['Model No.']).trim();
      if (first['Model No'] && String(first['Model No']).trim()) return String(first['Model No']).trim();
    }
  } catch (e) {}
  return '';
}

// Helper: read each Excel file in downloads/ and subdirectories, return an array of objects {file, modelFromFile, rows: [...]}
// Each row is the sheet_to_json row (defval '')
// Helper: read each Excel file in downloads/<category>/ if category provided, else downloads/ and subdirectories
function readAllFilesWithModel(category = null) {
  let dlDir = path.join(__dirname, 'downloads');
  if (category) {
    dlDir = path.join(dlDir, category);
  }
  if (!fs.existsSync(dlDir)) return [];

  function readDirectoryRecursively(dir) {
    const allFiles = [];
    if (!fs.existsSync(dir)) return allFiles;
    const items = fs.readdirSync(dir);
    items.forEach(item => {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        // Recurse into subdirectory (if category not specified)
        if (!category) {
          allFiles.push(...readDirectoryRecursively(fullPath));
        }
      } else if (/\.(xlsx|xls)$/i.test(item)) {
        // Process Excel file
        try {
          const wb = xlsx.readFile(fullPath);
          const sheetName = wb.SheetNames[0];
          const ws = wb.Sheets[sheetName];
          const modelFromFile = getModelFromSheet(ws) || '';
          const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
          allFiles.push({ file: fullPath, modelFromFile, rows });
        } catch (err) {
          console.warn('[readAllFilesWithModel] skip', fullPath, err.message);
        }
      }
    });
    return allFiles;
  }

  return readDirectoryRecursively(dlDir);
}

// GET /api/models?category=<category> -> returns unique model list (modelFromFile values) scoped to category folder
app.get('/api/models', (req, res) => {
  try {
    const category = req.query.category;
    const files = readAllFilesWithModel(category);
    const models = new Set();
    files.forEach(f => {
      const m = (f.modelFromFile || '').toString().trim();
      if (m) models.add(m);
    });
    const arr = Array.from(models).sort();
    res.json({ success: true, models: arr });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/dashboard?model=<modelName>&severity=<severity>&category=<category>  (all parameters optional)
// Reads from downloads/<category>/ if category provided, otherwise whole downloads/
// returns: { success:true, model:..., totals:{ totalCases, critical, high, medium, low }, severityDistribution: [{severity,count}], moduleDistribution: [{module,count}], rows: [...] }

/**
 * Helper function to get filtered rows for pagination
 */
function getFilteredRows(modelQuery, severityQuery, category) {
  const files = readAllFilesWithModel(category);

  // Build unified rows with an attached modelFromFile field for each row
  let allRows = [];
  files.forEach(f => {
    const mFromFile = f.modelFromFile || '';
    f.rows.forEach(r => {
      // attach modelFromFile to each row so we can easily filter by model
      const row = Object.assign({}, r);
      row._modelFromFile = mFromFile;
      allRows.push(row);
    });
  });

  // Filter rows by model if specified
  let filteredRows = modelQuery ? allRows.filter(r => String(r._modelFromFile || '').trim() === modelQuery) : allRows;

  // Filter rows by severity if specified
  if (severityQuery) {
    filteredRows = filteredRows.filter(r => {
      const sev = (r.Severity || r['Severity'] || r['Severity Level'] || '').toString().trim() || 'Unknown';
      return String(sev).toLowerCase() === severityQuery.toLowerCase() || sev === severityQuery;
    });
  }

  return filteredRows;
}

// GET /api/dashboard?model=<modelName>&severity=<severity>&category=<category>  (all parameters optional)
// Reads from downloads/<category>/ if category provided, otherwise whole downloads/
// returns: { success:true, model:..., totals:{ totalCases, critical, high, medium, low }, severityDistribution: [{severity,count}], moduleDistribution: [{module,count}], rows: [...] }
app.get('/api/dashboard', (req, res) => {
  try {
    const modelQueryRaw = (req.query.model || '').toString().trim();
    const modelQuery = (modelQueryRaw === '' || /^(all|__all__|aggregate)$/i.test(modelQueryRaw)) ? null : modelQueryRaw;
    const severityQueryRaw = (req.query.severity || '').toString().trim();
    const severityQuery = severityQueryRaw === '' ? null : severityQueryRaw;
    const categoryQueryRaw = (req.query.category || '').toString().trim();
    const category = categoryQueryRaw === '' ? null : categoryQueryRaw;

    const filteredRows = getFilteredRows(modelQuery, severityQuery, category);

    // Aggregations
    const totals = { totalCases: filteredRows.length, high: 0, medium: 0, low: 0 };
    const severityCounts = {};
    const moduleCounts = {};

    filteredRows.forEach(r => {
      // Severity detection: look for common severity words in any of the severity columns
      const sev = (r.Severity || r['Severity'] || r['Severity Level'] || '').toString().trim() || 'Unknown';
      const sevKey = sev || 'Unknown';
      severityCounts[sevKey] = (severityCounts[sevKey] || 0) + 1;
      // Only High (no Critical)
      if (/high/i.test(sevKey)) totals.high++;
      if (/med/i.test(sevKey)) totals.medium++;
      if (/low/i.test(sevKey)) totals.low++;

      // Module detection: check common column names and fallback to empty
      const mod = (r.Module || r['Module'] || r['Module Name'] || r['Modules'] || '').toString().trim() || 'Unknown';
      moduleCounts[mod] = (moduleCounts[mod] || 0) + 1;
    });

    const severityDistribution = Object.keys(severityCounts).map(k => ({ severity: k, count: severityCounts[k] })).sort((a, b) => b.count - a.count);
    const moduleDistribution = Object.keys(moduleCounts).map(k => ({ module: k, count: moduleCounts[k] })).sort((a, b) => b.count - a.count);

    // Prepare table rows to return (limit to avoid huge payload)
    const tableRows = filteredRows.slice(0, 500).map(r => {
      const mappedRow = {
        caseId: r['Case Code'] || r['CaseId'] || r['ID'] || '',
        title: r['Title'] || r['Summary'] || r['Problem Title'] || '',
        problem: r['Problem'] || r['Issue'] || '',
        modelFromFile: r._modelFromFile || '',
        module: r['Module'] || r['Module Name'] || '',
        severity: r['Severity'] || '',
        sWVer: r['S/W Ver.'] || r['S/W Version'] || r['Software Version'] || '',
        subModule: r['Sub-Module'] || r['Sub Module'] || r['SubModule'] || '',
        summarizedProblem: r['Summarized Problem'] || r['Summarized_Problem'] || r['Summary'] || '',
        severityReason: r['Severity Reason'] || r['Severity_Reason'] || ''
      };

      return mappedRow;
    });

    res.json({
      success: true,
      model: modelQuery || 'All',
      totals,
      severityDistribution,
      moduleDistribution,
      rows: tableRows
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = parseInt(req.query.pageSize || '25', 10);

    // load or compute the full summary array (reuse existing implementation)
    const result = await getVisualizationData();

    const allRows = result.summary;
    const total = allRows.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const pageRows = allRows.slice(start, start + pageSize);

    res.json({
      success: true,
      filesScanned: result.filesScanned,
      total,
      page,
      pageSize,
      pages,
      summary: pageRows
    });
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
    // If no sub-module found, leave empty (don't fall back to module for grouping)
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
        // Try common header names
        const model = pickField(r, ['Model', 'model', 'Model No.', 'Model No', 'ModelNo', 'Model No']);
        const swver = pickField(r, ['S/W Ver.', 'SW Ver', 'Software Version', 'S/W Version', 'S/W Ver']);
        const grade = pickField(r, ['Grade', 'Garde', 'grade']);
        const critical_module = pickField(r, ['Critical Module', 'Cirital Module', 'Module', 'critical module', 'Module Name']);
        const title = pickField(r, ['Title', 'title']);

        // Build key for aggregation (group by model+grade+module to avoid duplicates)
        const key = `${model}||${grade}||${critical_module}`;
        if (!aggregation.has(key)) {
          aggregation.set(key, { count: 0, titleMap: new Map(), voc: critical_voc });
        }
        const entry = aggregation.get(key);
        entry.count += 1;
        entry.titleMap.set(title || 'N/A', (entry.titleMap.get(title || 'N/A') || 0) + 1);
      }
    } catch (err) {
      console.warn('Failed to read', file, err && err.message);
      continue;
    }
  }

  // Convert aggregation map to array
  const summary = Array.from(aggregation.entries()).map(([k, entry]) => {
    const [model, grade, critical_module] = k.split('||');
    const topTitles = Array.from(entry.titleMap.entries()).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([title,count])=>title).join(', ');
    return {
      model: model || '',
      grade: grade || '',
      critical_module: critical_module || '',
      critical_voc: topTitles || '',
      count: entry.count || 0
    };
  });

  // Sort by count descending
  summary.sort((a,b) => b.count - a.count);

  return { summary, filesScanned: files.length, chosenDir, tried };
}

/**
 * Get detailed rows for visualization drill-down (Raw_Details sheet)
 */
app.get('/api/visualize-raw-details', async (req, res) => {
  try {
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

    const allDetails = [];

    for (const file of files) {
      try {
        const filePath = path.join(chosenDir, file);
        const wb = xlsx.readFile(filePath);
        const sheetName = wb.SheetNames[0];
        if (!sheetName) continue;
        const ws = wb.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });

        for (const r of rows) {
          // Extract all available fields for raw details
          allDetails.push({
            caseCode: pickField(r, ['Case Code', 'CaseCode', 'Case']),
            model: pickField(r, ['Model No.', 'Model No', 'Model', 'ModelNo', 'Model No']),
            grade: pickField(r, ['Grade', 'Garde']),
            swver: pickField(r, ['S/W Ver.', 'SW Ver', 'Software Version', 'S/W Version', 'S/W Ver']),
            title: pickField(r, ['Title']),
            problem: pickField(r, ['Problem']),
            sub_module: pickField(r, ['Sub-Module', 'Sub Module', 'SubModule', 'sub-module', 'sub module', 'submodule']),
            severity: pickField(r, ['Severity']),
            severity_reason: pickField(r, ['Severity Reason', 'Severity_Reason']),
            count: 1 // Each row represents one case
          });
        }
      } catch (err) {
        console.warn('Failed to read file for raw details:', file, err && err.message);
        continue;
      }
    }

    res.json({ success: true, details: allDetails });
  } catch (error) {
    console.error('Raw details fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// CSV export endpoint
app.get('/api/visualize/export', async (req, res) => {
  try {
    const resp = await getVisualizationData();
    // Build CSV header
    const csvHeader = ['model','grade','critical_module','critical_issue','count'];
    const lines = [csvHeader.join(',')];
    resp.summary.forEach(r => {
      lines.push([r.model,r.grade,r.critical_module,r.critical_voc,r.count].map(v => `\"${String(v||'').replace(/\"/g,'\"\"')}\"`).join(','));
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
 * Fetch available Ollama models
 */
async function fetchOllamaModels(opts = {}) {
  const port = opts.port || DEFAULT_OLLAMA_PORT;
  const timeoutMs = opts.timeoutMs !== undefined ? opts.timeoutMs : 10000; // 10s default

  const response = await new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port,
      path: '/api/tags',
      method: 'GET',
      agent: keepAliveAgent,
      headers: {
        'Connection': 'keep-alive'
      }
    };

    const req = http.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');

      res.on('data', (chunk) => raw += chunk);
      res.on('end', () => {
        if (!raw) return reject(new Error('Empty response from Ollama tags'));
        try {
          const json = JSON.parse(raw);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('[fetchOllamaModels] success, models:', json.models?.length || 0);
            return resolve(json);
          } else {
            return reject(new Error(`Ollama tags ${res.statusCode}: ${JSON.stringify(json)}`));
          }
        } catch (err) {
          return reject(new Error('Failed to parse Ollama tags response: ' + err.message));
        }
      });
    });

    if (timeoutMs !== false && timeoutMs !== 0) {
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Timeout after ${timeoutMs} ms`));
      });
    }

    req.on('error', (err) => {
      console.error('[fetchOllamaModels] request error:', err);
      reject(new Error('Failed to connect to Ollama: ' + err.message));
    });

    req.end();
  });

  return response.models ? response.models.map(m => m.name) : [];
}

// GET /api/ollama-models -> returns available Ollama AI models
app.get('/api/ollama-models', async (req, res) => {
  try {
    const models = await fetchOllamaModels();
    res.json({ success: true, models });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
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

      // Match model, grade, and module (ignore swver and voc since we aggregated by model+grade+module)
      if (String(rmodel).toLowerCase().trim() !== String(model).toLowerCase().trim() ||
          String(rgrade).toLowerCase().trim() !== String(grade).toLowerCase().trim() ||
          String(critMod).toLowerCase().trim() !== String(critical_module).toLowerCase().trim()) continue;

          // Collect the detailed fields for display
          details.push({
            caseCode: pickField(r, ['Case Code', 'CaseCode', 'Case']),
            model: pickField(r, ['Model No.', 'Model No', 'Model']),
            swver: pickField(r, ['S/W Ver.', 'SW Ver', 'Software Version']),
            grade: pickField(r, ['Grade', 'Garde']),
            critical_voc: pickField(r, ['Critical VOC', 'Critical VOCs']),
            title: pickField(r, ['Title']),
            problem: pickField(r, ['Problem']),
            sub_module: pickField(r, ['Sub-Module', 'Sub Module', 'SubModule', 'sub-module', 'sub module', 'submodule']),
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
  console.log('\n🚀 Ollama Web Processor is running!');
  console.log(`📍 Open your browser and go to: http://localhost:${PORT}`);
  console.log('🤖 Make sure Ollama is running (qwen3:4b-instruct)\n');
});

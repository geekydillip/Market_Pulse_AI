/**
 * Process Excel routes - handles file processing endpoints
 */

const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx-js-style');
const multer = require('multer');
const http = require('http');

// Import required services
const EmbeddingService = require('../embeddings/embedding_service');
const VectorStore = require('../embeddings/vector_store');
const { SIMILARITY_THRESHOLDS, PROCESSING_MODES, EMBEDDING_TYPES, PROCESSING_MODE, isDiscoveryMode, validateThreshold, getThreshold } = require('../embeddings/similarity');
const cacheManager = require('../../cache_manager');
const { createOptimalBatches } = require('../processors/_helpers');
const ollamaClient = require('../ollamaClient');

// Global variables (will be initialized by main server)
let embeddingService = null;
let vectorStore = null;
let keepAliveAgent = null;

// Constants
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const ALLOWED_FILE_TYPES = ['.xlsx', '.xls', '.json', '.csv'];
const ALLOWED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/json',
  'text/json',
  'text/csv',
  'application/csv',
  'text/plain'
];

// Processing modes - will be set by main server
let PROCESSING_MODE_CANONICAL = 'discovery';

// Export the variable so it can be set from server.js
module.exports.PROCESSING_MODE_CANONICAL = PROCESSING_MODE_CANONICAL;

// Ollama settings
const DEFAULT_OLLAMA_PORT = 11434;
const DEFAULT_AI_MODEL = 'qwen3:4b-instruct';

// Processor mapping
const processorMap = {
  'beta_user_issues': 'betaIssues',
  'samsung_members_plm': 'samsungMembersPlm',
  'plm_issues': 'plmIssues',
  'samsung_members_voc': 'samsungMembersVoc'
};

// Cache for identical prompts
const aiCache = new Map();
const activeSessions = new Map(); // sessionId -> { cancelled, startTime, abortController, activeRequests }
const progressClients = new Map();

// Input validation middleware
function validateFileUpload(req, res, next) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  // Check file size
  if (req.file.size > MAX_FILE_SIZE) {
    if (req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(400).json({ error: 'File too large. Maximum size is 200MB' });
  }

  // Check file extension
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!ALLOWED_FILE_TYPES.includes(ext)) {
    if (req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(400).json({ error: 'Invalid file type. Only .xlsx, .xls, .json, and .csv files are allowed' });
  }

  // Sanitize filename
  req.file.safeFilename = req.file.filename.replace(/[^a-zA-Z0-9._-]/g, '');

  next();
}

// Input sanitization function
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
              .replace(/javascript:/gi, '')
              .replace(/on\w+\s*=/gi, '')
              .trim();
}

// Initialize services function (called from main server)
function initProcessingServices(es, vs, agent) {
  embeddingService = es;
  vectorStore = vs;
  keepAliveAgent = agent;
}

// Import required functions from main server
// These functions are now available from ollamaClient

// Progress SSE endpoint
function setupProgressRoute(app) {
  app.get('/api/progress/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    progressClients.set(sessionId, res);

    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 30000);

    req.on('close', () => {
      progressClients.delete(sessionId);
      clearInterval(keepAlive);
    });
  });
}

// Function to send progress updates
function sendProgress(sessionId, data) {
  const client = progressClients.get(sessionId);
  if (client) {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

// Session management routes
function setupSessionRoutes(app) {
  app.post('/api/cancel/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    const session = activeSessions.get(sessionId);

    if (session) {
      session.cancelled = true;
      if (session.abortController) {
        session.abortController.abort();
      }
      let abortedCount = 0;
      session.activeRequests.forEach(controller => {
        try {
          controller.abort();
          abortedCount++;
        } catch (e) {
          console.warn(`Failed to abort request for session ${sessionId}:`, e.message);
        }
      });
      cacheManager.failSession(session.processingType, sessionId, 'User cancelled');
      console.log(`Session ${sessionId} cancelled, aborted ${abortedCount} active requests`);
      res.json({ success: true, message: `Processing cancelled, aborted ${abortedCount} active requests` });
    } else {
      res.status(404).json({ success: false, error: 'Session not found' });
    }
  });

  app.post('/api/pause/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    const session = activeSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    if (session.cancelled) {
      return res.status(400).json({ success: false, error: 'Session is already cancelled' });
    }

    cacheManager.pauseSession(session.processingType, sessionId);
    console.log(`Session ${sessionId} paused`);
    res.json({ success: true, message: 'Processing paused successfully' });
  });

  app.post('/api/resume/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    const session = activeSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    if (session.cancelled) {
      return res.status(400).json({ success: false, error: 'Session is cancelled and cannot be resumed' });
    }

    cacheManager.resumeSession(session.processingType, sessionId);
    console.log(`Session ${sessionId} resumed`);
    res.json({ success: true, message: 'Processing resumed successfully' });
  });

  app.get('/api/session/:sessionId/status', (req, res) => {
    const sessionId = req.params.sessionId;
    const session = activeSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    const cacheState = cacheManager.loadSessionState(session.processingType, sessionId);
    res.json({
      success: true,
      sessionId,
      processingType: session.processingType,
      status: cacheState ? cacheState.status : 'unknown',
      isCancelled: session.cancelled,
      progress: cacheState ? cacheState : null
    });
  });
}

// Main processing route
function setupProcessRoute(app, upload) {
  app.post('/api/process', upload.single('file'), validateFileUpload, async (req, res) => {
    try {
      console.log('[API PROCESS] Processing request received');
      const processingType = sanitizeInput(req.body.processingType || 'beta_user_issues');
      const requestedMode = req.body.mode || req.query.mode;
      const effectiveMode =
        requestedMode === 'discovery'
          ? 'discovery'
          : requestedMode === 'regular'
            ? 'regular'
            : PROCESSING_MODE_CANONICAL;

      console.log(`[MODE NORMALIZED] Requested: ${requestedMode ?? 'none'} → Effective: ${effectiveMode}`);

      const model = sanitizeInput(req.body.model || DEFAULT_AI_MODEL);
      console.log(`[API PROCESS] Processing type: ${processingType}, mode: ${effectiveMode}, model: ${model}`);

      const validProcessingTypes = ['beta_user_issues', 'clean', 'samsung_members_plm', 'samsung_members_voc', 'plm_issues'];
      if (!validProcessingTypes.includes(processingType)) {
        return res.status(400).json({ error: 'Invalid processing type.' });
      }

      const validProcessingModes = ['regular', 'discovery'];
      if (!validProcessingModes.includes(effectiveMode)) {
        return res.status(400).json({ error: 'Invalid processing mode. Must be "regular" or "discovery".' });
      }

      const ext = path.extname(req.file.originalname).toLowerCase();

      if (ext === '.xlsx' || ext === '.xls') {
        return processExcel(req, res, effectiveMode);
      } else if (ext === '.json') {
        return processJSON(req, res, effectiveMode);
      } else if (ext === '.csv') {
        return processCSV(req, res, effectiveMode);
      } else {
        return res.status(400).json({ error: 'Only Excel (.xlsx, .xls), JSON (.json), and CSV (.csv) files are supported' });
      }

    } catch (error) {
      console.error('Error processing file:', error);
      res.status(500).json({
        error: error.message || 'Failed to process file'
      });
    }
  });
}

// Include all the processing functions (processExcel, processJSON, processCSV, etc.)
// These are the actual implementations extracted from the original server.js

// Import utility functions
const { readAndNormalizeExcel, generateExcelFile } = require('../utils/excelUtils');
const { createChunkedProcessingTasks, runTasksWithLimit, processChunkResults, generateProcessingLog } = require('../utils/chunking');
const { getProcessor, hasProcessor } = require('../processors');

// Define processChunk function - the missing piece that handles individual chunk processing
async function processChunk({
  chunk,
  processor,
  prompt,
  context,
  analytics
}) {
  // Validate that processor is actually a function
  if (typeof processor !== 'function') {
    throw new TypeError(
      `processor must be a function, got ${typeof processor}`
    );
  }

  // Call the processor with the chunk
  const result = await processor(chunk, {
    prompt,
    context
  });

  // Update analytics if returned
  if (analytics && Array.isArray(result)) {
    analytics.processedRows += result.length;
  }

  return result;
}

// Mapping of processing types to human-readable source labels for embeddings
const PROCESSOR_SOURCES = {
  'beta_user_issues': 'Beta Issues',
  'plm_issues': 'PLM Issues',
  'samsung_members_plm': 'Samsung Members PLM',
  'samsung_members_voc': 'Samsung Members VOC'
};

// Excel processing with chunking
async function processExcel(req, res, processingMode = 'regular') {
  try {
    console.log('🚀 Starting Excel processing...');
    console.log(`📋 Processing mode: ${processingMode}`);
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

    // Initialize session tracking for cancellation
    activeSessions.set(sessionId, {
      cancelled: false,
      startTime: Date.now(),
      abortController: new AbortController(),
      activeRequests: new Set(),
      processingType: processingType
    });

    // Load the dynamic processor for reading and processing
    const processor = getProcessor(processingType);
    if (!processor) {
      const availableProcessors = getAvailableProcessorTypes().join(', ');
      throw new Error(
        `Processor '${processingType}' is not registered. ` +
        `Available processors: ${availableProcessors}`
      );
    }

    // Validate that processor is a function
    if (typeof processor !== 'function') {
      throw new TypeError(
        `Processor '${processingType}' is invalid. Expected function, got ${typeof processor}`
      );
    }

    // Use processor's readAndNormalizeExcel if available, else fallback to betaIssues
    const excelUtils = require('../utils/excelUtils');
    let rows = excelUtils.readAndNormalizeExcel(uploadedPath, processingType);

    // STRICT VALIDATION: If rows is null, the type didn't match or processor failed
    if (!rows || rows.length === 0) {
      console.error(`[FAIL] File upload rejected: Structure does not match ${processingType}`);
      
      // Clean up the uploaded file immediately
      try { if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath); } catch (e) {}
      
      return res.status(400).json({ 
        success: false, 
        error: 'Excel file type doesn\'t match with the processor.' 
      });
    }

    // Sanity check: verify we have meaningful rows with relevant data based on processor type
    let meaningful;
    if (processingType === 'samsung_members_voc') {
      meaningful = rows.filter(r => String(r['content']||'').trim() !== '');
      console.log(`Read ${rows.length} rows; ${meaningful.length} rows with content data.`);
    } else {
      // Default check for Title/Problem (beta_user_issues, etc.)
      meaningful = rows.filter(r => String(r['Title']||'').trim() !== '' || String(r['Problem']||'').trim() !== '');
      console.log(`Read ${rows.length} rows; ${meaningful.length} rows with Title/Problem data.`);
    }
    if (meaningful.length === 0) {
      console.warn('No meaningful rows found - check header detection logic or the uploaded file.');
    }

    // Set headers to the canonical columns (using processor's expectedHeaders if available)
    const headers = (processor && processor.expectedHeaders) || ['Case Code','Model No.','S/W Ver.','Title','Problem'];

    // Unified chunked processing (works for all types: clean, voc, custom)
    const numberOfInputRows = rows.length;

    // Create optimal batches using token-bounded chunking (5-20 rows per batch)
    const tasks = createChunkedProcessingTasks(rows, processingType, model, sessionId, processingMode, processChunk);

    console.log(`[BATCHING] Created ${tasks.length} optimal batches from ${numberOfInputRows} rows`);

    // Initialize monotonically increasing completion counter
    let completedChunks = 0;

    // Send initial progress (0%)
    sendProgress(sessionId, {
      type: 'progress',
      percent: 0,
      message: 'Preparing data...',
      chunksCompleted: 0,
      totalChunks: tasks.length
    });

    // Run with concurrency limit (4)
    const chunkResults = await runTasksWithLimit(tasks, 4) || [];

    // Process results
    const { finalRows, addedColumns, failedRows } = processChunkResults(chunkResults, headers, processingMode);

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

    // Global S/N numbering for processors that expect it (like samsung_members_voc)
    if (processor.expectedHeaders && processor.expectedHeaders[0] === 'S/N') {
      schemaMergedRows.forEach((row, index) => {
        row['S/N'] = index + 1;
      });
    }

    // Generate Excel file
    const dlDir = path.join(__dirname, '..', 'downloads', processingType);
    if (!fs.existsSync(dlDir)) fs.mkdirSync(dlDir, { recursive: true });

    const processedPath = path.join(dlDir, processedExcelFilename);
    generateExcelFile(schemaMergedRows, finalHeaders, processedPath);

    // Generate log
    const log = generateProcessingLog(tStart, numberOfInputRows, tasks.length, chunkResults, processingType);
    log.number_of_output_rows = schemaMergedRows.length;

    const logPath = path.join(dlDir, logFilename);
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

    // Clean up uploaded file
    try { if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath); } catch (e) {}

    res.json({
      success: true,
      total_processing_time_ms: Date.now() - tStart,
      processedRows: schemaMergedRows,
      downloads: [
        { url: `/downloads/${processingType}/${processedExcelFilename}`, filename: processedExcelFilename },
        { url: `/downloads/${processingType}/${logFilename}`, filename: logFilename }
      ]
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

    // Initialize session tracking for cancellation
    activeSessions.set(sessionId, {
      cancelled: false,
      startTime: Date.now(),
      abortController: new AbortController(),
      activeRequests: new Set(),
      processingType: processingType
    });

    // Unified chunked processing (works for all types: clean, voc, custom)
    const numberOfInputRows = rows.length;

    // Create optimal batches using token-bounded chunking (5-20 rows per batch)
    const batches = createOptimalBatches(rows, processingType);
    const numberOfChunks = batches.length;

    console.log(`[BATCHING] Created ${numberOfChunks} optimal batches from ${numberOfInputRows} rows`);

    // Initialize monotonically increasing completion counter
    let completedChunks = 0;

    // Send initial progress for JSON
    sendProgress(sessionId, {
      type: 'progress',
      percent: 0,
      message: 'Preparing data...',
      chunksCompleted: 0,
      totalChunks: numberOfChunks
    });

    // Build batch tasks
    const tasks = [];
    let currentOffset = 0; // Track offset for original indices
    batches.forEach((batchRows, batchIndex) => {
      const batchStartIdx = currentOffset;
      const batchEndIdx = currentOffset + batchRows.length - 1;
      const chunk = { file_name: originalName, chunk_id: batchIndex, row_indices: [batchStartIdx, batchEndIdx], headers, rows: batchRows };
      currentOffset += batchRows.length; // Update offset for next batch

      tasks.push(async () => {
        // Check for cancellation before processing
        const session = activeSessions.get(sessionId);
        if (session && session.cancelled) {
          console.log(`Session ${sessionId} cancelled, skipping batch ${batchIndex}`);
          return { chunkId: batchIndex, status: 'cancelled', processedRows: [] };
        }

        const result = await processChunk(chunk, processingType, model, batchIndex, sessionId, processingMode);

        // Check for cancellation after processing
        if (session && session.cancelled) {
          console.log(`Session ${sessionId} cancelled after processing batch ${batchIndex}`);
          return result; // Still return the result but mark as potentially cancelled
        }

        // Increment counter and send monotonically increasing progress
        completedChunks++;
        const percent = Math.round((completedChunks / numberOfChunks) * 100);
        const message = percent < 90
          ? `Processing Data… ${percent}% complete`
          : `Finalizing output… ${percent}% complete`;
        sendProgress(sessionId, {
          type: 'progress',
          percent,
          message,
          chunksCompleted: completedChunks,
          totalChunks: numberOfChunks
        });
        return result;
      });
    });

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
    const dlDir = path.join(__dirname, '..', 'downloads', processingType);
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

async function processCSV(req, res) {
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
    const processedCSVFilename = `${fileNameBase}_${sanitizedModel}_${dateTime}_Processed.csv`;
    const logFilename = `${fileNameBase}_log.json`;

    // Read and parse CSV file
    const fileContent = fs.readFileSync(uploadedPath, 'utf-8');
    let rows;
    try {
      // Simple CSV parser - split by lines and commas
      const lines = fileContent.trim().split('\n');
      if (lines.length < 2) {
        if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
        return res.status(400).json({ error: 'CSV file must contain at least a header row and one data row' });
      }

      // Parse header row
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));

      // Parse data rows
      rows = lines.slice(1).map((line, index) => {
        const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        if (values.length !== headers.length) {
          console.warn(`Row ${index + 2}: Expected ${headers.length} columns, got ${values.length}`);
        }
        const row = {};
        headers.forEach((header, i) => {
          row[header] = values[i] || '';
        });
        return row;
      });

      if (rows.length === 0) {
        if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
        return res.status(400).json({ error: 'CSV file must contain at least one data row' });
      }
    } catch (parseError) {
      if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
      return res.status(400).json({ error: 'Invalid CSV format: ' + parseError.message });
    }

    const tStart = Date.now();
    const headers = Object.keys(rows[0] || {});

    // Use Beta user issues processing type for CSV (since only structured data should be in CSV)
    const processingType = req.body.processingType || 'beta_user_issues';
    const model = req.body.model || 'qwen3:4b-instruct';
    const sessionId = req.body.sessionId || 'default';

    // Initialize session tracking for cancellation
    activeSessions.set(sessionId, {
      cancelled: false,
      startTime: Date.now(),
      abortController: new AbortController(),
      activeRequests: new Set(),
      processingType: processingType
    });

    // Initialize processing cache
    const cacheInitialized = cacheManager.initializeSession(processingType, sessionId, {
      totalChunks: numberOfChunks,
      fileName: originalName,
      model,
      processingMode
    });

    if (!cacheInitialized) {
      console.warn('Failed to initialize processing cache, continuing without cache');
    }

    // Unified chunked processing (works for all types: clean, voc, custom)
    const numberOfInputRows = rows.length;
    const ROWSCOUNT = rows.length || 0;

    // 50 row chunking for balanced performance and accuracy
    const chunkSize = 20;
    const numberOfChunks = Math.max(1, Math.ceil(ROWSCOUNT / chunkSize));

    // Check for existing cache to resume processing
    const existingCache = cacheManager.getResumeData(processingType, sessionId);
    let resumeFromChunk = 0;
    let completedChunks = 0;

    if (existingCache && existingCache.sessionState.status === 'paused') {
      // Resume from paused state
      resumeFromChunk = existingCache.nextChunkId;
      completedChunks = resumeFromChunk;
      console.log(`[CACHE RESUME] Resuming from chunk ${resumeFromChunk}, ${existingCache.completedChunks.length} chunks already completed`);

      // Send resume progress update
      sendProgress(sessionId, {
        type: 'progress',
        percent: Math.round((completedChunks / numberOfChunks) * 100),
        message: `Resuming processing from chunk ${resumeFromChunk}...`,
        chunksCompleted: completedChunks,
        totalChunks: numberOfChunks,
        resumed: true
      });
    } else if (existingCache && existingCache.sessionState.status === 'active') {
      // Check if this is a fresh start or continuation
      resumeFromChunk = existingCache.nextChunkId;
      completedChunks = resumeFromChunk;
      console.log(`[CACHE RESUME] Continuing active session from chunk ${resumeFromChunk}`);
    } else {
      // Fresh processing session
      console.log(`[CACHE RESUME] Starting fresh processing session`);
    }

    // Send initial progress for CSV
    sendProgress(sessionId, {
      type: 'progress',
      percent: 0,
      message: 'Preparing data...',
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
        // Check for cancellation before processing
        const session = activeSessions.get(sessionId);
        if (session && session.cancelled) {
          console.log(`Session ${sessionId} cancelled, skipping chunk ${i}`);
          return { chunkId: i, status: 'cancelled', processedRows: [] };
        }

        const result = await processChunk(chunk, processingType, model, i, sessionId, processingMode);

        // Check for cancellation after processing
        if (session && session.cancelled) {
          console.log(`Session ${sessionId} cancelled after processing chunk ${i}`);
          return result; // Still return the result but mark as potentially cancelled
        }

        // Increment counter and send monotonically increasing progress
        completedChunks++;
        const percent = Math.round((completedChunks / numberOfChunks) * 100);
        const message = percent < 90
          ? `Processing Data… ${percent}% completed`
          : `Finalizing output… ${percent}% completed`;
        sendProgress(sessionId, {
          type: 'progress',
          percent,
          message,
          chunksCompleted: completedChunks,
          totalChunks: numberOfChunks
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
        // For failed chunks, still include rows with error
        result.processedRows.forEach((row, idx) => {
          // Calculate original index using batch start index from row_indices
          const batchStartIdx = result.chunk ? result.chunk.row_indices[0] : 0;
          const originalIdx = batchStartIdx + idx;
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

    // Add classification_mode column for discovery mode (governance fix)
    if (processingMode === 'discovery' && !finalHeaders.includes('classification_mode')) {
      finalHeaders.push('classification_mode');
    }

    // Convert back to CSV format
    const csvLines = [];
    // Add header row
    csvLines.push(finalHeaders.map(h => `"${h}"`).join(','));
    // Add data rows
    finalRows.forEach(row => {
      const csvRow = finalHeaders.map(header => {
        const value = row[header] || '';
        // Escape quotes and wrap in quotes if contains comma, quote, or newline
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      });
      csvLines.push(csvRow.join(','));
    });
    const csvContent = csvLines.join('\n');

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
    const dlDir = path.join(__dirname, '..', 'downloads', processingType);
    if (!fs.existsSync(dlDir)) fs.mkdirSync(dlDir, { recursive: true });

    const processedPath = path.join(dlDir, processedCSVFilename);
    const logPath = path.join(dlDir, logFilename);

    fs.writeFileSync(processedPath, csvContent);
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

    // Clean up uploaded file
    try { if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath); } catch (e) {}

    res.json({
      success: true,
      total_processing_time_ms: Date.now() - tStart,
      processedRows: finalRows,
      downloads: [
        { url: `/downloads/${processingType}/${processedCSVFilename}`, filename: processedCSVFilename },
        { url: `/downloads/${processingType}/${logFilename}`, filename: logFilename }
      ]
    });
  } catch (error) {
    console.error('CSV processing error:', error);
    // Attempt to remove uploaded file on unexpected error
    try { if (req && req.file && req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch (e) {}
    res.status(500).json({
      success: false,
      error: error.message || 'Processing failed'
    });
  }
}

module.exports = {
  initProcessingServices,
  setupProgressRoute,
  setupSessionRoutes,
  setupProcessRoute,
  sendProgress
};

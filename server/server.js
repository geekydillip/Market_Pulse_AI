
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

// Initialize embedding services
const EmbeddingService = require('./embeddings/embedding_service');
const VectorStore = require('./embeddings/vector_store');

let embeddingService = null;
let vectorStore = null;

async function initEmbeddingServices() {
  try {
    if (!embeddingService) {
      embeddingService = new EmbeddingService();
    }
    if (!vectorStore) {
      vectorStore = new VectorStore();
      await vectorStore.init();
    }
    console.log('✅ Embedding services initialized');
  } catch (err) {
    console.error('❌ Failed to initialize embedding services:', err);
  }
}

// Initialize embedding services on startup
initEmbeddingServices().catch(err => console.error('Embedding services init failed:', err));

const app = express();              // <-- IMPORTANT: app must be created BEFORE routes

const PORT = process.env.PORT || 3001;
const DEFAULT_OLLAMA_PORT = 11434;
const DEFAULT_AI_MODEL = 'qwen3:4b-instruct';

// Load centralized configuration
const {
  SIMILARITY_THRESHOLDS,
  PROCESSING_MODES,
  EMBEDDING_TYPES,
  PROCESSING_MODE,
  isDiscoveryMode,
  validateThreshold,
  getThreshold
} = require('./embeddings/similarity');

// Initialize cache manager
const cacheManager = require('../cache_manager');

// Import batching utilities
const { createOptimalBatches } = require('./processors/_helpers');

// Import route modules
const { initProcessingServices, setupProgressRoute, setupSessionRoutes, setupProcessRoute } = require('./routes/processExcel');
const ragRouter = require('./routes/rag');
const { initRAG } = require('./rag/init');
const ollamaClient = require('./ollamaClient');

// Step 1: Define Global / Server-Level Mode
const SERVER_PROCESSING_MODE = process.env.PROCESSING_MODE || 'discovery';

console.log('🔧 Server Processing Mode:', SERVER_PROCESSING_MODE);

// Validate server processing mode
if (!['discovery', 'regular'].includes(SERVER_PROCESSING_MODE)) {
  console.error(`❌ Invalid SERVER_PROCESSING_MODE: ${SERVER_PROCESSING_MODE}`);
  console.error(`Valid modes: discovery, regular`);
  process.exit(1);
}

// Security constants
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

  // TEMPORARILY DISABLE MIME TYPE CHECK FOR TESTING
  // Check MIME type (basic validation)
  // if (req.file.mimetype && !ALLOWED_MIME_TYPES.includes(req.file.mimetype)) {
  //   if (req.file.path && fs.existsSync(req.file.path)) {
  //     fs.unlinkSync(req.file.path);
  //   }
  //   return res.status(400).json({ error: 'Invalid file format' });
  // }

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
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// Create keep-alive agent for HTTP connections
const keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });

// Serve the main dashboard at root (must come before static middleware)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'main.html'));
});

// Serve main.html explicitly
app.get('/main.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'main.html'));
});

// serve frontend static files (adjust folder if your frontend is in 'public')
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));

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
  fileFilter: function (req, file, cb) {
    // Accept all files for testing
    cb(null, true);
  }
});

// Initialize all services after embedding services are ready
async function initializeServices() {
  try {
    // Initialize RAG services (depends on vectorStore and embeddingService)
    await initRAG(vectorStore, embeddingService);

    console.log('✅ All services initialized successfully');
  } catch (error) {
    console.error('❌ Service initialization failed:', error);
    process.exit(1);
  }
}

// Set up route modules
initProcessingServices(embeddingService, vectorStore, keepAliveAgent);
setupProgressRoute(app);
setupSessionRoutes(app);
setupProcessRoute(app, upload);

// Set the processing mode in the routes module
const processExcelRoutes = require('./routes/processExcel');
processExcelRoutes.PROCESSING_MODE_CANONICAL = SERVER_PROCESSING_MODE;

// Also update the module's internal variable
processExcelRoutes.PROCESSING_MODE_CANONICAL = SERVER_PROCESSING_MODE;

// Mount RAG router (will check for initialization internally)
app.use('/api/rag', ragRouter);

// simple health route (optional)
app.get('/health', (req, res) => res.json({ status: 'ok' }));



// Mapping of frontend processingType to processor filenames
const processorMap = {
  'beta_user_issues': 'betaIssues',
  'samsung_members_plm': 'samsungMembersPlm',
  'plm_issues': 'plmIssues',
  'samsung_members_voc': 'samsungMembersVoc',
  'ut_portal': 'utPortal'
};

// Mapping of processing types to human-readable source labels for embeddings
const PROCESSOR_SOURCES = {
  'beta_user_issues': 'Beta Issues',
  'plm_issues': 'PLM Issues',
  'samsung_members_plm': 'Samsung Members PLM',
  'samsung_members_voc': 'Samsung Members VOC',
  'ut_portal': 'User Trial Portal Issues'
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

// Store active processing sessions for cancellation
const activeSessions = new Map(); // sessionId -> { cancelled, startTime, abortController, activeRequests }

// Fix 4: Smart chunking with similarity short-circuiting (High ROI)
async function applySimilarityShortCircuiting(rows, processingType) {
  if (!vectorStore || !rows || rows.length === 0) {
    return rows; // Return unchanged if no vector store or rows
  }

  const shortCircuitedRows = [];
  const reuseThreshold = getThreshold('REUSE_ROW');

  console.log(`[SimilarityShortCircuit] Checking ${rows.length} rows for similar existing results...`);

  // Collect all texts that need embedding first
  const textsToEmbed = [];
  const rowIndexMap = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Skip rows that already have embeddings (they went through duplicate filtering)
    if (row._rowEmbedding) {
      shortCircuitedRows.push(row);
      continue;
    }

    // Generate text for similarity check
    const rowText = processingType === 'samsung_members_voc'
      ? `${row.content || ''} ${row['Application Name'] || ''} ${row.Category || ''}`.trim()
      : processingType === 'beta_user_issues'
      ? `${row.Title || ''} ${row.Problem || ''}`.trim()
      : Object.values(row).join(' ').trim();

    // Apply text normalization before embedding
    const { normalizeForEmbedding } = require('./processors/_helpers');
    const normalizedText = normalizeForEmbedding(rowText);

    textsToEmbed.push(normalizedText);
    rowIndexMap.push(i);
  }

  // Batch embed all texts at once (much more efficient)
  if (textsToEmbed.length > 0) {
    console.log(`[SimilarityShortCircuit] Batch embedding ${textsToEmbed.length} texts...`);

    const embeddingsMap = await embeddingService.batchEmbed(textsToEmbed, vectorStore);

    // Process similarity checks for each text
    for (let i = 0; i < textsToEmbed.length; i++) {
      const text = textsToEmbed[i];
      const originalRowIndex = rowIndexMap[i];
      const row = rows[originalRowIndex];

      const currentEmbedding = embeddingsMap.get(text);

      if (!currentEmbedding) {
        // If embedding fails, process normally
        shortCircuitedRows.push(row);
        continue;
      }

      // Find similar existing row embeddings
      const similarResults = await vectorStore.findSimilarEmbeddings(
        currentEmbedding,
        'row',
        1, // Just need the most similar
        reuseThreshold
      );

      if (similarResults.length > 0) {
        const mostSimilar = similarResults[0];

        // Try to find the corresponding processed result
        const existingResult = await findExistingProcessedResult(mostSimilar, processingType);

        if (existingResult) {
          console.log(`[SimilarityShortCircuit] Reusing existing result for "${text.substring(0, 50)}..." (similarity: ${mostSimilar.similarity.toFixed(3)})`);

          // Create a copy of the row with reused result
          const reusedRow = {
            ...row,
            _reused_from: mostSimilar.hash,
            _similarity_score: mostSimilar.similarity,
            // Copy the AI-discovered fields from the existing result
            Module: existingResult.Module,
            'Sub-Module': existingResult['Sub-Module'],
            'Issue Type': existingResult['Issue Type'],
            'Sub-Issue Type': existingResult['Sub-Issue Type'],
            // Add any other AI-generated fields
            ...(existingResult.AI_Insight && { 'AI Insight': existingResult.AI_Insight }),
            ...(existingResult.Severity && { Severity: existingResult.Severity }),
            ...(existingResult['Severity Reason'] && { 'Severity Reason': existingResult['Severity Reason'] }),
            ...(existingResult['Summarized Problem'] && { 'Summarized Problem': existingResult['Summarized Problem'] })
          };

          shortCircuitedRows.push(reusedRow);
          continue;
        }
      }

      // No similar result found, process normally
      shortCircuitedRows.push(row);
    }
  }

  const reusedCount = rows.length - shortCircuitedRows.filter(r => !r._reused_from).length;
  if (reusedCount > 0) {
    console.log(`[SimilarityShortCircuit] Successfully reused results for ${reusedCount} rows`);
  }

  return shortCircuitedRows;
}

// Helper function to find existing processed result for a similar embedding
async function findExistingProcessedResult(similarEmbedding, processingType) {
  try {
    // Look in recent processed files for the similar result
    const downloadDir = path.join(__dirname, 'downloads', processingType);

    if (!fs.existsSync(downloadDir)) {
      return null;
    }

    // Get the most recent processed Excel file
    const excelFiles = fs.readdirSync(downloadDir)
      .filter(f => f.endsWith('.xlsx'))
      .map(f => ({
        name: f,
        path: path.join(downloadDir, f),
        stats: fs.statSync(path.join(downloadDir, f))
      }))
      .sort((a, b) => b.stats.mtime - a.stats.mtime);

    if (excelFiles.length === 0) {
      return null;
    }

    // Read the most recent file and find a similar row
    const xlsx = require('xlsx');
    const workbook = xlsx.readFile(excelFiles[0].path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });

    // Simple heuristic: return the first row with AI-generated content
    // In a more sophisticated implementation, this could match by embedding similarity
    for (const row of rows.slice(0, 10)) { // Check first 10 rows
      if (row.Module && row['Issue Type']) {
        return row;
      }
    }

    return null;
  } catch (error) {
    console.warn('[SimilarityShortCircuit] Error finding existing result:', error.message);
    return null;
  }
}

// Fix 4: Smart chunking with duplicate detection (using centralized config)
async function filterDuplicateRows(rows, processingType) {
  if (!vectorStore || !embeddingService) {
    console.log('[SmartChunking] Vector store not available, skipping duplicate detection');
    return rows;
  }

  try {
    const filteredRows = [];
    const rowTexts = [];
    const reuseThreshold = getThreshold('REUSE_ROW'); // Use centralized config

    // Generate row texts for embedding comparison
    for (const row of rows) {
      let rowText = '';
      if (processingType === 'samsung_members_voc') {
        rowText = `${row.content || ''} ${row['Application Name'] || ''} ${row.Category || ''}`.trim();
      } else if (processingType === 'beta_user_issues') {
        rowText = `${row.Title || ''} ${row.Problem || ''}`.trim();
      } else {
        // Generic fallback
        rowText = Object.values(row).join(' ').trim();
      }
      rowTexts.push(rowText);
    }

    // Get existing row embeddings for comparison
    const existingRowEmbeddings = await vectorStore.getEmbeddingsByType('row', 1000);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowText = rowTexts[i];

      // Generate embedding for current row
      const currentEmbeddings = await embeddingService.batchEmbed([rowText], vectorStore);
      const currentEmbedding = currentEmbeddings.get(rowText);

      if (!currentEmbedding) {
        // If embedding fails, include the row
        filteredRows.push(row);
        continue;
      }

      // Check similarity with existing rows
      let isDuplicate = false;
      for (const existing of existingRowEmbeddings) {
        if (!existing.embedding) continue;

        try {
          const similarity = vectorStore.cosineSimilarity(currentEmbedding, existing.embedding);
          if (similarity >= reuseThreshold) {
            console.log(`[SmartChunking] Skipping duplicate row (similarity: ${similarity.toFixed(3)} ≥ ${reuseThreshold}): "${rowText.substring(0, 50)}..."`);
            isDuplicate = true;
            break;
          }
        } catch (simErr) {
          continue; // Skip similarity calculation errors
        }
      }

      if (!isDuplicate) {
        filteredRows.push(row);
      }
    }

    const skipped = rows.length - filteredRows.length;
    if (skipped > 0) {
      console.log(`[SmartChunking] Filtered ${skipped} duplicate rows, processing ${filteredRows.length} unique rows`);
    }

    return filteredRows;
  } catch (error) {
    console.warn('[SmartChunking] Duplicate detection failed:', error.message);
    return rows; // Return original rows if filtering fails
  }
}

// Process a single chunk
async function processChunk(chunk, processingType, model, chunkId, sessionId, processingMode = 'regular') {
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
    let processedRows = processor.transform ? processor.transform(chunk.rows) : chunk.rows;

    // Generate unique run_id for this discovery run (globally unique across chunks)
    const runId = new Date().toISOString().replace(/[:.]/g, '').substring(0, 15);

    // Fix 4: Smart chunking with embedding-aware short-circuiting (High ROI)
    if (processingMode === 'discovery') {
      // First, embed all rows to enable similarity checking
      if (processor.preProcessRows) {
        processedRows = await processor.preProcessRows(processedRows);
      }

      // Filter duplicate rows using embeddings
      processedRows = await filterDuplicateRows(processedRows, processingType);

      // Check for similar existing results to reuse (short-circuiting)
      processedRows = await applySimilarityShortCircuiting(processedRows, processingType);
    }

    // Capture embedding IDs for discovery data governance
    let embeddingIds = {};
    if (processingMode === 'discovery' && vectorStore) {
      try {
        // Generate text representations for embedding
        const textsToEmbed = processedRows.map(row => {
          if (processingType === 'samsung_members_voc') {
            return `${row.content || ''} ${row['Application Name'] || ''} ${row.Category || ''}`.trim();
          } else if (processingType === 'beta_user_issues') {
            return `${row.Title || ''} ${row.Problem || ''}`.trim();
          }
          return Object.values(row).join(' ').trim();
        });

    // Get embeddings with IDs for discovery traceability
        const embedResult = await embeddingService.batchEmbed(textsToEmbed, vectorStore, {
          returnIds: true,
          source: PROCESSOR_SOURCES[processingType] || processingType
        });
        const embeddings = embedResult.embeddings;
        const ids = embedResult.ids;

        // Map back to discovery record types
        processedRows.forEach((row, index) => {
          const textKey = textsToEmbed[index];
          const embeddingId = ids.get(textKey);

          if (embeddingId) {
            embeddingIds[`row_${runId}_${chunkId}_${index}`] = embeddingId;
          }
        });

        console.log(`[Discovery Embeddings] Captured ${Object.keys(embeddingIds).length} embedding IDs for traceability`);
      } catch (embedErr) {
        console.warn('[Discovery Embeddings] Failed to capture embedding IDs:', embedErr.message);
      }
    }

    // Build prompt only for rows that need LLM processing
    const prompt = processor.buildPrompt ? processor.buildPrompt(processedRows, processingMode) : JSON.stringify(processedRows).slice(0, 1000);

    // Call AI (cached) - default to stream: false
    const result = await callOllamaCached(prompt, model, { timeoutMs: false, stream: false, sessionId });

    // Format response based on processing mode
    try {
      if (processingMode === 'discovery') {
        // For discovery mode, use the special discovery response formatter with context
        const context = {
          runId,
          chunkId,
          embeddingIds // Pass captured embedding IDs for governance
        };
        processedRows = processor.formatDiscoveryResponse ? await processor.formatDiscoveryResponse(result, chunk.rows, chunk.file_name, context) : [];
      } else {
        // For regular processing, use the standard formatter
        processedRows = processor.formatResponse ? processor.formatResponse(result, chunk.rows) : (typeof result === 'string' ? JSON.parse(result) : result);
      }
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

    // Save chunk data to cache (even if processing was incomplete or failed)
    // This ensures cache data exists even when processing is paused early
    cacheManager.saveChunkData(processingType, sessionId, chunkId, {
      processedRows: processedRows || [],
      processingTime: Date.now() - startTime,
      status: processedRows && processedRows.length > 0 ? 'completed' : 'incomplete',
      timestamp: Date.now()
    });

    // Update session progress (always update progress, regardless of completion)
    cacheManager.updateProgress(processingType, sessionId, {
      completedChunks: processedRows && processedRows.length > 0 ? chunkId + 1 : chunkId,
      currentChunk: chunkId,
      lastProcessedChunk: chunkId
    });

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

// CSV processing - parse and process like JSON rows
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
    const chunkResults = await runTasksWithLimit(tasks, 1);

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
    const dlDir = path.join(__dirname, 'downloads', processingType);
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

// Precompute analytics after Excel processing
async function precomputeAnalytics(module, processedPath) {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const pythonProcess = spawn('python', ['server/analytics/pandas_aggregator.py', module, '--save-json']);

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Analytics precomputed for ${module}`);

        // Trigger central cache update after analytics are ready
        generateCentralCache().catch(err =>
          console.warn('⚠️ Central cache generation failed:', err.message)
        );

        resolve();
      } else {
        console.warn(`⚠️ Analytics precomputation failed for ${module}:`, stderr);
        resolve(); // Don't fail the whole process
      }
    });
  });
}

// Generate centralized dashboard cache
async function generateCentralCache() {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const pythonProcess = spawn('python', ['server/analytics/generate_central_cache.py']);

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Central dashboard cache updated');
        resolve();
      } else {
        console.warn('⚠️ Central cache generation failed:', stderr);
        resolve(); // Don't fail the whole process
      }
    });
  });
}

// POST /api/cancel/:sessionId -> marks a session as cancelled and aborts active requests
app.post('/api/cancel/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const session = activeSessions.get(sessionId);

  if (session) {
    session.cancelled = true;

    // Abort master controller (for future requests)
    if (session.abortController) {
      session.abortController.abort();
    }

    // Abort all active requests immediately
    let abortedCount = 0;
    session.activeRequests.forEach(controller => {
      try {
        controller.abort();
        abortedCount++;
      } catch (e) {
        console.warn(`Failed to abort request for session ${sessionId}:`, e.message);
      }
    });

    // Mark session as cancelled in cache
    cacheManager.failSession(session.processingType, sessionId, 'User cancelled');

    console.log(`Session ${sessionId} cancelled, aborted ${abortedCount} active requests`);
    res.json({ success: true, message: `Processing cancelled, aborted ${abortedCount} active requests` });
  } else {
    res.status(404).json({ success: false, error: 'Session not found' });
  }
});

// POST /api/pause/:sessionId -> pauses a processing session
app.post('/api/pause/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const session = activeSessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  if (session.cancelled) {
    return res.status(400).json({ success: false, error: 'Session is already cancelled' });
  }

  // Set paused flag
  isPaused = true;

  // Mark session as paused in cache
  cacheManager.pauseSession(session.processingType, sessionId);

  console.log(`Session ${sessionId} paused`);
  res.json({ success: true, message: 'Processing paused successfully' });
});

// POST /api/resume/:sessionId -> resumes a paused processing session
app.post('/api/resume/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const session = activeSessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  if (session.cancelled) {
    return res.status(400).json({ success: false, error: 'Session is cancelled and cannot be resumed' });
  }

  // Clear paused flag
  isPaused = false;

  // Mark session as resumed in cache
  cacheManager.resumeSession(session.processingType, sessionId);

  console.log(`Session ${sessionId} resumed`);
  res.json({ success: true, message: 'Processing resumed successfully' });
});

// GET /api/session/:sessionId/status -> gets the current status of a session
app.get('/api/session/:sessionId/status', (req, res) => {
  const sessionId = req.params.sessionId;
  const session = activeSessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  // Get status from cache
  const cacheState = cacheManager.loadSessionState(session.processingType, sessionId);

  res.json({
    success: true,
    sessionId,
    processingType: session.processingType,
    status: cacheState ? cacheState.status : 'unknown',
    isPaused,
    isCancelled: session.cancelled,
    progress: cacheState ? cacheState : null
  });
});

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
    const processorName = processorMap[processingType];
    const processor = require('./processors/' + processorName);

    // Use processor's readAndNormalizeExcel if available, else fallback to betaIssues
    const readAndNormalizeExcel = processor.readAndNormalizeExcel || require('./processors/betaIssues').readAndNormalizeExcel;
    let rows = readAndNormalizeExcel(uploadedPath) || [];

    // Sanity check: verify we have meaningful rows with relevant data based on processor type
    let meaningful;
    if (processingType === 'samsung_members_voc') {
      meaningful = rows.filter(r => String(r['content']||'').trim() !== '');
      console.log(`Read ${rows.length} rows; ${meaningful.length} rows with content data.`);

      // Additional validation for Samsung Members VOC
      if (meaningful.length === 0) {
        console.error('[VALIDATION] No rows with content data found. Header detection may have failed.');
        console.error('[VALIDATION] First few processed rows:', rows.slice(0, 3));
      } else {
        console.log('[VALIDATION] Content validation passed - proceeding with processing');
      }
    } else {
      // Default check for Title/Problem (beta_user_issues, etc.)
      meaningful = rows.filter(r => String(r['Title']||'').trim() !== '' || String(r['Problem']||'').trim() !== '');
      console.log(`Read ${rows.length} rows; ${meaningful.length} rows with Title/Problem data.`);
    }
    if (meaningful.length === 0) {
      console.warn('No meaningful rows found - check header detection logic or the uploaded file.');
    }

    // Set headers to the canonical columns (using processor's expectedHeaders if available)
    const headers = processor.expectedHeaders || ['Case Code','Model No.','S/W Ver.','Title','Problem'];

    // Unified chunked processing (works for all types: clean, voc, custom)
    const numberOfInputRows = rows.length;

    // Create optimal batches using token-bounded chunking (5-20 rows per batch)
    const batches = createOptimalBatches(rows, processingType);
    const numberOfChunks = batches.length;

    console.log(`[BATCHING] Created ${numberOfChunks} optimal batches from ${numberOfInputRows} rows`);

    // Initialize monotonically increasing completion counter
    let completedChunks = 0;

    // Send initial progress (0%)
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
    const chunkResults = await runTasksWithLimit(tasks, 4) || [];

    // Process results
    const allProcessedRows = [];
    const discoveryData = [];
    const addedColumns = new Set();

    (chunkResults || []).forEach(result => {
      if (!result) return;
      if (result.status === 'ok' && Array.isArray(result.processedRows)) {
        result.processedRows.forEach((row, idx) => {
          // Calculate original index using batch start index from row_indices
          const batchStartIdx = result.chunk ? result.chunk.row_indices[0] : 0;
          const originalIdx = batchStartIdx + idx;
          allProcessedRows[originalIdx] = row;

          // For discovery mode, collect discovery data with proper guards
          if (processingMode === 'discovery') {
            // Guard: ensure we have a valid result structure
            if (!result || !Array.isArray(result.processedRows)) {
              console.warn(`[DISCOVERY COLLECTION] Invalid result structure for batch ${result?.chunkId || 'unknown'}`);
            } else {
              console.log(`[DISCOVERY COLLECTION] Processing row ${idx} from batch ${result.chunkId}:`, {
                hasRawDiscovery: !!row.raw_discovery,
                rowKeys: Object.keys(row),
                mode: row.mode
              });

              // In discovery mode, all rows should be discovery results with raw_discovery
              if (row.raw_discovery || row.mode === 'discovery') {
                discoveryData.push(row);
                console.log(`[DISCOVERY COLLECTION] Added discovery data for row ${idx}, total discovery data: ${discoveryData.length}`);
              } else {
                console.log(`[DISCOVERY COLLECTION] Row ${idx} missing raw_discovery, keys:`, Object.keys(row));
              }
            }
          }

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

          // For discovery mode, include failed rows in discovery data
          if (processingMode === 'discovery') {
            console.log(`[DISCOVERY COLLECTION] Failed batch row ${idx}:`, row);
            discoveryData.push(row);
          }

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

    // Global S/N numbering for processors that expect it (like samsung_members_voc)
    if (processor.expectedHeaders && processor.expectedHeaders[0] === 'S/N') {
      schemaMergedRows.forEach((row, index) => {
        row['S/N'] = index + 1;
      });
    }

    // Set classification_mode for discovery mode (governance fix)
    if (processingMode === 'discovery') {
      schemaMergedRows.forEach(row => {
        row['classification_mode'] = 'discovery';
      });
    }

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

      // Apply Test Coverage column data cell styling (green background)
      if (row > 0) { // Data rows only
        const header = finalHeaders[col];
        if (testCoverageHeaders.includes(header)) {
          if (header === 'Test Coverage Availability (Yes/No)') {
            // Main Test Coverage column - Light green background
            cellStyle.fill = { patternType: "solid", fgColor: { rgb: "F0FFF0" } }; // Honeydew
            cellStyle.font = { ...cellStyle.font, color: { rgb: "006400" } }; // Dark green text
          } else {
            // TC Addition/Modification columns - Light green background
            cellStyle.fill = { patternType: "solid", fgColor: { rgb: "E8F5E8" } }; // Light green
            cellStyle.font = { ...cellStyle.font, color: { rgb: "006400" } }; // Dark green text
            // Right-align numeric counts
            cellStyle.alignment.horizontal = "right";
          }
        }
        // All other columns (including AI columns) use default formatting:
        // - White background (no fill specified)
        // - Black/dark text (default font color)
        // - Appropriate alignment (center for specific columns, left for others)
      }

      // Assign style back
      if (newSheet[cellKey]) newSheet[cellKey].s = cellStyle;
    });

    // === Apply Header Styling ===
    const specialHeaders = ['Module', 'Sub-Module', 'Issue Type', 'Sub-Issue Type', 'Summarized Problem', 'Severity', 'Severity Reason','Resolve Type','R&D Comment', '3rd Party/Native', 'Module/Apps', 'AI Insight', 'Members'];
    const testCoverageHeaders = [
      'Test Coverage Availability (Yes/No)',
      'TC Addition **For Test coverage No (Count of TC Add)',
      'TC Modification **For Test coverage No (Count of TC Modify)'
    ];
    
    finalHeaders.forEach((header, index) => {
      const cellAddress = xlsx.utils.encode_cell({ r: 0, c: index });
      if (!newSheet[cellAddress]) return;
      
      let headerStyle = {
        font: { bold: true, color: { rgb: "FFFFFF" }, sz: 12 },
        alignment: { horizontal: "center", vertical: "center", wrapText: true }
      };
      
      // Test Coverage columns - High contrast green styling
      if (testCoverageHeaders.includes(header)) {
        if (header === 'Test Coverage Availability (Yes/No)') {
          // Main Test Coverage column - Sea Green
          headerStyle.fill = { patternType: "solid", fgColor: { rgb: "2E8B57" } }; // Sea Green
        } else {
          // TC Addition/Modification columns - Lime Green
          headerStyle.fill = { patternType: "solid", fgColor: { rgb: "32CD32" } }; // Lime Green
        }
      } else if (specialHeaders.includes(header)) {
        // Other special headers - Blue
        headerStyle.fill = { patternType: "solid", fgColor: { rgb: "1E90FF" } };
      } else {
        // Regular headers - Dark Blue
        headerStyle.fill = { patternType: "solid", fgColor: { rgb: "000080" } };
      }
      
      newSheet[cellAddress].s = headerStyle;
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
          // Calculate original index using batch start index from row_indices
          const batchStartIdx = cr.chunk ? cr.chunk.row_indices[0] : 0;
          const originalIdx = batchStartIdx + idx;
          failedRows.push({
            row_index: originalIdx,
            batch_id: cr.chunkId,
            error_reason: row.error
          });
        }
      });
    });

    const log = {
      total_processing_time_ms: elapsedMs,
      total_processing_time_seconds: elapsedSec.toFixed(3),
      number_of_input_rows: numberOfInputRows,
      number_of_batches: numberOfChunks, // Updated terminology
      number_of_output_rows: schemaMergedRows.length,
      failed_row_details: failedRows,
      added_columns: Array.from(addedColumns),
      batch_processing_time: (chunkResults || []).map(cr => ({ batch_id: cr && cr.chunkId, time_ms: cr && cr.processingTime })) // Updated terminology
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

    // For discovery mode, save discovery data with accumulation
    console.log('🔍 DISCOVERY SAVE: Starting discovery save logic...');
    console.log(`🔍 DISCOVERY SAVE: Processing mode: ${processingMode}`);
    console.log(`🔍 DISCOVERY SAVE: Discovery data length: ${discoveryData.length}`);
    console.log(`🔍 DISCOVERY SAVE: Discovery data sample:`, discoveryData.slice(0, 1));

    if (processingMode === 'discovery') {
      console.log(`✅ DISCOVERY SAVE: Processing mode matches 'discovery', proceeding with save...`);

      if (discoveryData.length > 0) {
        const embedDataDir = path.join(__dirname, 'Embed_data', processingType);
        console.log('[EMBED PATH]', path.resolve(embedDataDir));

        try {
          if (!fs.existsSync(embedDataDir)) {
            console.log(`[EMBED CREATE] Creating directory: ${embedDataDir}`);
            fs.mkdirSync(embedDataDir, { recursive: true });
            console.log(`[EMBED CREATE] Directory created successfully`);
          } else {
            console.log(`[EMBED CREATE] Directory already exists: ${embedDataDir}`);
          }

          const discoveryPath = path.join(embedDataDir, 'discovery_data.json');

          // Create backup of existing file before processing (Phase 2: Backup System)
          if (fs.existsSync(discoveryPath)) {
            try {
              const now = new Date();
              const timestamp = now.getFullYear().toString() +
                              String(now.getMonth() + 1).padStart(2, '0') +
                              String(now.getDate()).padStart(2, '0') +
                              '_' +
                              String(now.getHours()).padStart(2, '0') +
                              String(now.getMinutes()).padStart(2, '0') +
                              String(now.getSeconds()).padStart(2, '0');

              const backupFilename = `Backup_discovery_data_${timestamp}.json`;
              const backupPath = path.join(embedDataDir, backupFilename);

              // Copy existing file to backup
              fs.copyFileSync(discoveryPath, backupPath);
              console.log(`[BACKUP CREATED] Backed up existing discovery data to: ${backupFilename}`);
            } catch (backupError) {
              console.warn(`[BACKUP FAILED] Could not create backup: ${backupError.message}`);
              // Continue with processing even if backup fails
            }
          }

          // Read existing discovery data for accumulation
          let existingData = [];
          let existingSourceFiles = [];
          let totalExistingRows = 0;

          if (fs.existsSync(discoveryPath)) {
            try {
              console.log(`[EMBED ACCUMULATE] Reading existing discovery data from: ${discoveryPath}`);
              const existingContent = JSON.parse(fs.readFileSync(discoveryPath, 'utf-8'));
              existingData = existingContent.data || [];
              existingSourceFiles = Array.isArray(existingContent.source_files)
                ? existingContent.source_files
                : [existingContent.source_file].filter(Boolean);
              totalExistingRows = existingContent.total_rows || 0;
              console.log(`[EMBED ACCUMULATE] Successfully loaded ${totalExistingRows} existing rows`);
            } catch (readError) {
              console.warn(`[EMBED ACCUMULATE] Failed to read existing discovery data (malformed JSON?): ${readError.message}`);
              console.warn(`[EMBED ACCUMULATE] Starting fresh accumulation`);
              // Keep defaults: existingData = [], existingSourceFiles = [], totalExistingRows = 0
            }
          } else {
            console.log(`[EMBED ACCUMULATE] No existing discovery data found, starting fresh`);
          }

          // Strip embeddings from JSON after persistence - compact discovery data
          const compactDiscoveryData = discoveryData.map(row => ({
            row_id: row.row_id,
            raw_discovery: row.raw_discovery,
            embedding_refs: row.embedding_refs,
            mode: row.mode
          }));

          // Accumulate data: combine existing + new (using compact format)
          const accumulatedData = [...existingData, ...compactDiscoveryData];
          const accumulatedSourceFiles = [...new Set([...existingSourceFiles, originalName])]; // Remove duplicates

          // Save accumulated discovery data with updated metadata
          const discoveryOutput = {
            processing_type: processingType,
            source_files: accumulatedSourceFiles, // Array of all processed files
            source_file: originalName, // Keep for backward compatibility
            timestamp: new Date().toISOString(),
            total_rows: accumulatedData.length,
            data: accumulatedData
          };

          console.log(`[EMBED SAVE] Accumulating discovery data to: ${discoveryPath}`);
          console.log(`[EMBED SAVE] Previous rows: ${totalExistingRows}, New rows: ${discoveryData.length}, Total: ${accumulatedData.length}`);
          fs.writeFileSync(discoveryPath, JSON.stringify(discoveryOutput, null, 2));
          console.log(`✅ Discovery data accumulated successfully to ${discoveryPath}`);

          // Verify the file was created/updated
          if (fs.existsSync(discoveryPath)) {
            const stats = fs.statSync(discoveryPath);
            console.log(`✅ File verification: exists, size: ${stats.size} bytes, accumulated rows: ${accumulatedData.length}`);
          } else {
            console.error(`❌ File verification failed: ${discoveryPath} does not exist after save`);
          }

        } catch (error) {
          console.error(`❌ Error accumulating discovery data:`, error.message);
          console.error(`❌ Stack trace:`, error.stack);
        }
      } else {
        console.warn(`⚠️ Discovery mode but no discovery data to save (length: ${discoveryData.length})`);
      }
    } else {
      console.log(`[DISCOVERY SAVE] Not in discovery mode (mode: ${processingMode})`);
    }

    // Precompute analytics after successful processing (only for regular mode)
    if (processingMode !== 'discovery') {
      precomputeAnalytics(processingType, processedPath).catch(err =>
        console.warn('Analytics precomputation failed:', err.message)
      );
    }

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

// Helper: find all unique models in the sheet by scanning all rows
function getModelFromSheet(ws) {
  if (!ws || !ws['!ref']) return '';
  const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });

  // Collect all unique models using improved extraction logic
  const models = new Set();

  for (const row of rows) {
    const modelValue = extractModelFromRow(row);
    if (modelValue && modelValue !== 'Unknown') {
      models.add(modelValue);
    }
  }

  // Return all unique models as a comma-separated string, or first model if only one
  const modelArray = Array.from(models);
  return modelArray.length > 0 ? modelArray.join(',') : '';
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

// Helper: extract model from a single row (canonical extraction)
function extractModelFromRow(row) {
  const candidates = [
    'Model No.', 'Model', 'modelFromFile', 'ModelNo', 'Model_No', 'model', 'model_no', 'Model Name',
    'Device Model', 'Phone Model', 'Product Model', 'Model Number', 'Device', 'Phone'
  ];
  for (const candidate of candidates) {
    if (row.hasOwnProperty(candidate) && row[candidate] !== null && row[candidate] !== undefined) {
      const val = String(row[candidate]).trim();
      if (val && isValidModelString(val)) {
        return val;
      }
    }
  }
  return '';
}

// Helper function to validate if a string looks like a model name (not a case code)
function isValidModelString(str) {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim();
  // Check if it looks like a Samsung model (starts with SM-, contains numbers, etc.)
  if (s.match(/^SM[-_]?[A-Z0-9]+/i)) return true;
  // Check for other common model patterns
  if (s.match(/^[A-Z]+[-_]?[0-9]+/i)) return true;
  // Avoid case codes that look like P123456-78901
  if (s.match(/^P\d{6}-\d{5}$/)) return false;
  // Allow if it contains typical model keywords
  if (s.toLowerCase().includes('galaxy') || s.toLowerCase().includes('s24') || s.toLowerCase().includes('s23')) return true;
  return true; // Allow by default if it passes basic checks
}

// Helper: normalize model string
function normalizeModelString(s) {
  if (s === null || s === undefined) return '';
  let v = String(s);

  // Trim and collapse whitespace, remove NBSP
  v = v.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();

  // Remove invisible control characters
  v = v.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');

  // If everything is uppercase/lowercase inconsistent, preserve original but trim.
  // Optionally, standardize common separator variety:
  v = v.replace(/[_]+/g, '_').replace(/[-]{2,}/g, '-');

  return v;
}

// GET /api/models?category=<category> -> returns unique model list (modelFromFile values) scoped to category folder
app.get('/api/models', (req, res) => {
  try {
    const category = req.query.category;
    const files = readAllFilesWithModel(category);
    const models = new Set();
    files.forEach(f => {
      const m = (f.modelFromFile || '').toString().trim();
      if (m) {
        // Split comma-separated model strings and add each individual model
        const modelList = m.split(',').map(model => model.trim()).filter(model => model);
        modelList.forEach(model => models.add(model));
      }
    });
    const arr = Array.from(models).sort();
    res.json({ success: true, models: arr });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/dashboard?model=<modelName>&severity=<severity>&category=<category>  (all parameters optional)
// Reads from downloads/<category>/ if category provided, otherwise whole downloads/
// returns: { success:true, model:..., totals:{ totalCases, high, medium, low }, severityDistribution: [{severity,count}], moduleDistribution: [{module,count}], rows: [...] }

/**
 * Helper function to get filtered rows for pagination
 */
function getFilteredRows(modelQuery, severityQuery, category) {
  const files = readAllFilesWithModel(category);

  // Build unified rows with an attached modelFromFile field for each row
  let allRows = [];
  files.forEach(f => {
    f.rows.forEach(r => {
      // Extract the actual model for this specific row
      const rowModel = extractModelFromRow(r) || '';
      // attach modelFromFile to each row based on the row's actual model
      const row = Object.assign({}, r);
      row._modelFromFile = rowModel;
      allRows.push(row);
    });
  });

  // Filter rows by model if specified
  let filteredRows = modelQuery ? allRows.filter(r => {
    const rowModel = String(r._modelFromFile || '').trim();
    // Check exact match first
    if (rowModel === modelQuery) return true;
    // Check if modelQuery is contained in comma-separated models
    if (rowModel.includes(',')) {
      const models = rowModel.split(',').map(m => normalizeModelString(m.trim()));
      return models.includes(normalizeModelString(modelQuery));
    }
    return false;
  }) : allRows;

  // Filter rows by severity if specified
  if (severityQuery) {
    filteredRows = filteredRows.filter(r => {
      const sev = (r.Severity || r['Severity'] || r['Severity Level'] || '').toString().trim() || 'Unknown';
      return String(sev).toLowerCase() === severityQuery.toLowerCase() || sev === severityQuery;
    });
  }

  return filteredRows;
}

// GET /api/dashboard?category=<module> -> Pandas-first dashboard API
app.get('/api/dashboard', async (req, res) => {
  try {
    const module = req.query.category || 'default';

    const analyticsRes = await fetch(
      `http://localhost:${PORT}/api/analytics/${module}`
    );

    if (!analyticsRes.ok) {
      throw new Error('Analytics service failed');
    }

    const analytics = await analyticsRes.json();

    res.json({
      success: true,
      model: req.query.model || 'All',
      totals: {
        totalCases: analytics.kpis.total_rows,
        high: analytics.kpis.severity_distribution?.High || 0,
        medium: analytics.kpis.severity_distribution?.Medium || 0,
        low: analytics.kpis.severity_distribution?.Low || 0,
        critical: analytics.kpis.severity_distribution?.Critical || 0
      },
      severityDistribution: analytics.kpis.severity_distribution || {},
      moduleDistribution: analytics.categories || [],
      rows: analytics.rows || []
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});


// GET /api/samsung-members-plm -> dynamically generates Excel-like summary table from actual data
app.get('/api/samsung-members-plm', (req, res) => {
  try {
    // Read Excel files from downloads/samsung_members_plm directory
    const categoryDir = path.join(__dirname, 'downloads', 'samsung_members_plm');

    if (!fs.existsSync(categoryDir)) {
      return res.json({
        success: true,
        data: [
          // Return empty table structure if no data
          Array(12).fill(""),
          Array(12).fill(""),
          ["", "", "", "", "", "", "", "", "Module wise Count", "Module wise Count", "Module wise Count"],
          ["PLM Status", "PLM Status", "", "Series wise Count", "Series wise Count", "Model wise Count", "Model wise Count", "", "Module", "Grand Total", "Active (Resolved+Open)"]
        ],
        totalRows: 4,
        totalColumns: 12
      });
    }

    // Read all Excel files in the directory
    const files = fs.readdirSync(categoryDir)
      .filter(f => /\.(xlsx|xls)$/i.test(f))
      .map(f => path.join(categoryDir, f));

    let allRows = [];
    for (const filePath of files) {
      try {
        const wb = xlsx.readFile(filePath);
        const sheetName = wb.SheetNames[0];
        if (!sheetName) continue;
        const ws = wb.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
        allRows.push(...rows);
      } catch (err) {
        console.warn('Failed to read Excel file:', filePath, err.message);
        continue;
      }
    }

    if (allRows.length === 0) {
      return res.json({
        success: true,
        data: [
          Array(12).fill(""),
          Array(12).fill(""),
          ["", "", "", "", "", "", "", "", "Module wise Count", "Module wise Count", "Module wise Count"],
          ["PLM Status", "PLM Status", "", "Series wise Count", "Series wise Count", "Model wise Count", "Model wise Count", "", "Module", "Grand Total", "Active (Resolved+Open)"]
        ],
        totalRows: 4,
        totalColumns: 12
      });
    }

    // Generate summary statistics dynamically
    const stats = {
      totalCases: allRows.length,
      plmStatus: { Total: 0, Close: 0, Open: 0, Resolved: 0 },
      seriesCounts: {
        'A Series': 0,
        'M Series': 0,
        'F Series': 0,
        'Fold & Flip Series': 0,
        'S Series': 0,
        'Tablet': 0,
        'Ring': 0,
        'Watch': 0,
        'Unknown': 0
      },
      modelCounts: {},
      moduleCounts: {}
    };

    // Helper to extract field values
    function getField(row, candidates) {
      for (const c of candidates) {
        if (row.hasOwnProperty(c) && row[c] !== null && row[c] !== undefined) {
          const val = String(row[c]).trim();
          if (val !== '') return val;
        }
      }
      return '';
    }

    // Process each row to build statistics
    allRows.forEach(row => {
      // PLM Status
      const progrStat = getField(row, ['Progr.Stat.', 'Progress Status', 'Status']);
      if (progrStat) {
        if (progrStat.toLowerCase().includes('close')) stats.plmStatus.Close++;
        else if (progrStat.toLowerCase().includes('open')) stats.plmStatus.Open++;
        else if (progrStat.toLowerCase().includes('resolve')) stats.plmStatus.Resolved++;
      }
      stats.plmStatus.Total++;

      // Series (derived from model)
      const model = getField(row, ['Model No.', 'Model', 'modelFromFile']);
      let series = 'Unknown';
      if (model.includes('SM-A')) series = 'A Series';
      else if (model.includes('SM-M')) series = 'M Series';
      else if (model.includes('SM-E')) series = 'F Series';
      else if (model.includes('SM-F9') || model.includes('SM-F7')) series = 'Fold & Flip Series';
      else if (model.includes('SM-S') || model.includes('SM-G')) series = 'S Series';
      else if (model.includes('SM-X') || model.includes('SM-T')) series = 'Tablet';
      else if (model.includes('SM-Q')) series = 'Ring';
      else if (model.includes('SM-L') || model.includes('SM-R')) series = 'Watch';

      stats.seriesCounts[series] = (stats.seriesCounts[series] || 0) + 1;

      // Model counts
      stats.modelCounts[model] = (stats.modelCounts[model] || 0) + 1;

      // Module counts
      const module = getField(row, ['Module', 'Module Name']);
      stats.moduleCounts[module] = (stats.moduleCounts[module] || 0) + 1;
    });

    // Build the Excel-like table structure
    const excelData = [
      // Row 1: Header row with merged cells
      Array(12).fill("Samsung Members PLM Dashboard"),
      // Row 2: Section headers
      ["", "", "", "", "", "", "", "", "Module wise Count", "Module wise Count", "Module wise Count"],
      // Row 3: Column headers
      ["PLM Status", "PLM Status", "", "Series wise Count", "Series wise Count", "Model wise Count", "Model wise Count", "", "Module", "Grand Total", "Active (Resolved+Open)"]
    ];

    // Add PLM Status rows
    Object.entries(stats.plmStatus).forEach(([status, count]) => {
      excelData.push([status, count.toString(), "", "", "", "", "", "", "", "", ""]);
    });

    // Add Series rows
    Object.entries(stats.seriesCounts).forEach(([series, count]) => {
      excelData.push(["", "", "", series, count.toString(), "", "", "", "", "", ""]);
    });

    // Add Model rows
    Object.entries(stats.modelCounts).forEach(([model, count]) => {
      excelData.push(["", "", "", "", "", model, count.toString(), "", "", "", ""]);
    });

    // Add Module rows with totals and active counts
    Object.entries(stats.moduleCounts).forEach(([module, total]) => {
      // For demo purposes, assume active = total (in real scenario, calculate from severity/open status)
      const active = total; // This should be calculated based on business logic
      excelData.push(["", "", "", "", "", "", "", "", module, total.toString(), active.toString()]);
    });

    res.json({
      success: true,
      data: excelData,
      totalRows: excelData.length,
      totalColumns: 12
    });
  } catch (error) {
    console.error('Samsung Members PLM API error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});



// ---------- Centralized Dashboard API Endpoints ----------
// GET /api/central/kpis -> Returns totals by processor type
app.get('/api/central/kpis', async (req, res) => {
  try {
    const cachePath = path.join(__dirname, 'downloads', '__dashboard_cache__', 'central_dashboard.json');

    // Check if cache exists and is fresh
    if (fs.existsSync(cachePath)) {
      const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      res.json(cacheData.kpis);
    } else {
      // Fallback: generate cache on-demand
      console.log('⚠️ Cache not found, generating on-demand...');
      const { spawn } = require('child_process');
      const pythonProcess = spawn('python', ['server/analytics/generate_central_cache.py']);

      pythonProcess.on('close', (code) => {
        if (code === 0 && fs.existsSync(cachePath)) {
          const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
          res.json(cacheData.kpis);
        } else {
          res.status(500).json({ error: 'Failed to generate dashboard cache' });
        }
      });
    }
  } catch (error) {
    console.error('Central KPIs error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/central/top-modules -> Returns top 10 modules with labels and values
app.get('/api/central/top-modules', async (req, res) => {
  try {
    const cachePath = path.join(__dirname, 'downloads', '__dashboard_cache__', 'central_dashboard.json');

    if (fs.existsSync(cachePath)) {
      const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      res.json(cacheData.top_modules);
    } else {
      res.status(500).json({ error: 'Dashboard cache not found' });
    }
  } catch (error) {
    console.error('Central top modules error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/central/series-distribution -> Returns series distribution (Beta/PLM/VOC)
app.get('/api/central/series-distribution', async (req, res) => {
  try {
    const cachePath = path.join(__dirname, 'downloads', '__dashboard_cache__', 'central_dashboard.json');

    if (fs.existsSync(cachePath)) {
      const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      res.json(cacheData.series_distribution);
    } else {
      res.status(500).json({ error: 'Dashboard cache not found' });
    }
  } catch (error) {
    console.error('Central series distribution error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/central/top-models -> Returns top 10 models with labels and values
app.get('/api/central/top-models', async (req, res) => {
  try {
    const cachePath = path.join(__dirname, 'downloads', '__dashboard_cache__', 'central_dashboard.json');

    if (fs.existsSync(cachePath)) {
      const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      res.json(cacheData.top_models);
    } else {
      res.status(500).json({ error: 'Dashboard cache not found' });
    }
  } catch (error) {
    console.error('Central top models error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/central/high-issues -> Returns top 10 high issues
app.get('/api/central/high-issues', async (req, res) => {
  try {
    const cachePath = path.join(__dirname, 'downloads', '__dashboard_cache__', 'central_dashboard.json');

    if (fs.existsSync(cachePath)) {
      const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      res.json(cacheData.high_issues);
    } else {
      res.status(500).json({ error: 'Dashboard cache not found' });
    }
  } catch (error) {
    console.error('Central high issues error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/central/top-models/:source -> Returns top 10 models for specific data source (beta, plm, voc)
app.get('/api/central/top-models/:source', async (req, res) => {
  try {
    const source = req.params.source;
    const validSources = ['beta', 'plm', 'voc'];
    if (!validSources.includes(source)) {
      return res.status(400).json({ error: 'Invalid source. Must be beta, plm, or voc' });
    }

    const cachePath = path.join(__dirname, 'downloads', '__dashboard_cache__', 'central_dashboard.json');

    if (fs.existsSync(cachePath)) {
      const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      res.json(cacheData.filtered_top_models[source]);
    } else {
      res.status(500).json({ error: 'Dashboard cache not found' });
    }
  } catch (error) {
    console.error(`Central top models ${req.params.source} error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/central/model-module-matrix -> Returns matrix of Top 10 Models × Top 10 Modules
app.get('/api/central/model-module-matrix', async (req, res) => {
  try {
    const cachePath = path.join(__dirname, 'downloads', '__dashboard_cache__', 'central_dashboard.json');

    if (fs.existsSync(cachePath)) {
      const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      res.json(cacheData.model_module_matrix);
    } else {
      res.status(500).json({ error: 'Dashboard cache not found' });
    }
  } catch (error) {
    console.error('Central model-module matrix error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/central/source-model-summary -> Returns detailed summary by source and model
app.get('/api/central/source-model-summary', async (req, res) => {
  try {
    const cachePath = path.join(__dirname, 'downloads', '__dashboard_cache__', 'central_dashboard.json');

    if (fs.existsSync(cachePath)) {
      const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      res.json(cacheData.source_model_summary);
    } else {
      res.status(500).json({ error: 'Dashboard cache not found' });
    }
  } catch (error) {
    console.error('Central source-model summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/:module -> returns pre-aggregated analytics for dashboards
app.get('/api/analytics/:module', async (req, res) => {
  const module = req.params.module;
  const analyticsPath = path.join(__dirname, 'downloads', module, 'analytics.json');

  // Check if analytics.json exists and is newer than latest Excel
  if (fs.existsSync(analyticsPath)) {
    try {
      const analyticsStat = fs.statSync(analyticsPath);
      const latestExcel = getLatestExcelFile(module);

      if (latestExcel && analyticsStat.mtime >= fs.statSync(latestExcel).mtime) {
        // Cache is fresh, return it directly
        console.log(`📋 Serving cached analytics for ${module}`);
        const cachedData = JSON.parse(fs.readFileSync(analyticsPath, 'utf8'));
        return res.json(cachedData);
      }
    } catch (err) {
      console.warn('Cache read failed, falling back to computation:', err.message);
    }
  }

  // Fallback to on-demand computation
  console.log(`🔄 Computing analytics for ${module}`);
  const { spawn } = require('child_process');

  const pythonProcess = spawn('python', ['server/analytics/pandas_aggregator.py', module]);

  let stdout = '';
  let stderr = '';

  pythonProcess.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  pythonProcess.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  pythonProcess.on('close', (code) => {
    if (code !== 0) {
      console.error('Python analytics error:', stderr);
      return res.status(500).json({ error: 'Analytics computation failed' });
    }

    try {
      const result = JSON.parse(stdout);
      if (result.error) {
        if (result.error.includes('No Excel files')) {
          return res.status(404).json({ error: 'No processed Excel files found' });
        } else {
          return res.status(500).json({ error: result.error });
        }
      }
      res.json(result);
    } catch (e) {
      console.error('JSON parse error from analytics:', e);
      res.status(500).json({ error: 'Invalid response from analytics' });
    }
  });
});

// Helper function to get latest Excel file for cache validation
function getLatestExcelFile(module) {
  const moduleDir = path.join(__dirname, 'downloads', module);
  if (!fs.existsSync(moduleDir)) return null;

  try {
    const files = fs.readdirSync(moduleDir)
      .filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'))
      .map(f => path.join(moduleDir, f))
      .filter(f => fs.existsSync(f));

    if (files.length === 0) return null;

    // Return the most recently modified file
    return files.reduce((latest, current) => {
      const latestStat = fs.statSync(latest);
      const currentStat = fs.statSync(current);
      return currentStat.mtime > latestStat.mtime ? current : latest;
    });
  } catch (err) {
    return null;
  }
}

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

// POST /api/download-excel -> Generate Excel file using Python script
app.post('/api/download-excel', async (req, res) => {
  try {
    const { data, exportType, filename } = req.body;

    // Validate input
    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: 'Data must be provided as an array' });
    }

    const validTypes = ['modules', 'total', 'high', 'video'];
    if (!validTypes.includes(exportType)) {
      return res.status(400).json({ error: 'Invalid export type. Must be one of: ' + validTypes.join(', ') });
    }

    // Create temporary JSON file for Python script
    const tempJsonPath = path.join(__dirname, 'temp_data_' + Date.now() + '.json');
    fs.writeFileSync(tempJsonPath, JSON.stringify(data, null, 2));

    // Call Python script
    const { spawn } = require('child_process');
    const pythonProcess = spawn('python', [
      'excel_download_handler.py',
      tempJsonPath,
      exportType,
      filename ? '--output' : '',
      filename || ''
    ].filter(arg => arg !== ''));

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      // Clean up temporary file
      try {
        if (fs.existsSync(tempJsonPath)) {
          fs.unlinkSync(tempJsonPath);
        }
      } catch (e) {
        console.warn('Failed to clean up temp file:', e.message);
      }

      if (code !== 0) {
        console.error('Python script error:', stderr);
        return res.status(500).json({ error: 'Failed to generate Excel file: ' + stderr });
      }

      // Parse the output to get the filename
      const outputLines = stdout.trim().split('\n');
      const excelFileLine = outputLines.find(line => line.startsWith('Excel file created:'));
      if (!excelFileLine) {
        return res.status(500).json({ error: 'Failed to get Excel file path from Python script' });
      }

      const excelPath = excelFileLine.replace('Excel file created:', '').trim();

      // Check if file exists
      if (!fs.existsSync(excelPath)) {
        return res.status(500).json({ error: 'Excel file was not created' });
      }

      // Send file for download
      const fileName = path.basename(excelPath);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

      const fileStream = fs.createReadStream(excelPath);
      fileStream.pipe(res);

      // Clean up file after sending (optional - could be kept for caching)
      fileStream.on('end', () => {
        try {
          if (fs.existsSync(excelPath)) {
            fs.unlinkSync(excelPath);
          }
        } catch (e) {
          console.warn('Failed to clean up Excel file:', e.message);
        }
      });
    });

    pythonProcess.on('error', (error) => {
      // Clean up temporary file
      try {
        if (fs.existsSync(tempJsonPath)) {
          fs.unlinkSync(tempJsonPath);
        }
      } catch (e) {}

      console.error('Failed to start Python process:', error);
      res.status(500).json({ error: 'Failed to start Excel generation process' });
    });

  } catch (error) {
    console.error('Excel download error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate Excel file' });
  }
});

/**
 * Read all .xlsx/.xls files from candidate directories and aggregate summary
 * Returns an array of { model, swver, grade, module, voc, count }
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
        const module = pickField(r, ['Module', 'Module Name']);
        const title = pickField(r, ['Title', 'title']);

        // Build key for aggregation (group by model+grade+module to avoid duplicates)
        const key = `${model}||${grade}||${module}`;
        if (!aggregation.has(key)) {
          aggregation.set(key, { count: 0, titleMap: new Map(), voc: '' });
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
    const [model, grade, module] = k.split('||');
    const topTitles = Array.from(entry.titleMap.entries()).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([title,count])=>title).join(', ');
    return {
      model: model || '',
      grade: grade || '',
      module: module || '',
      voc: topTitles || '',
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
    function pickField(row, candidates) {
      for (const c of candidates) {
        if (row.hasOwnProperty(c) && row[c] !== undefined && row[c] !== null &&
            String(row[c]).toString().trim() !== '') {
          return String(row[c]).trim();
        }
      }
      return '';
    }

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
            caseCode: pickField(r, ['Case Code']),
            model: pickField(r, ['Model No.']),
            grade: pickField(r, ['Grade']),
            swver: pickField(r, ['S/W Ver.']),
            title: pickField(r, ['Title']),
            problem: pickField(r, ['Problem']),
            sub_module: pickField(r, ['Sub-Module']),
            severity: pickField(r, ['Severity']),
            severity_reason: pickField(r, ['Severity Reason']),
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
    const csvHeader = ['model','grade','module','voc','count'];
    const lines = [csvHeader.join(',')];
    resp.summary.forEach(r => {
      lines.push([r.model,r.grade,r.module,r.voc,r.count].map(v => `\"${String(v||'').replace(/\"/g,'\"\"')}\"`).join(','));
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
    const {model, swver, grade, module, voc} = req.query;

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
          const mod = pickField(r, ['Module', 'Module Name']);

      // Match model, grade, and module (ignore swver and voc since we aggregated by model+grade+module)
      if (String(rmodel).toLowerCase().trim() !== String(model).toLowerCase().trim() ||
          String(rgrade).toLowerCase().trim() !== String(grade).toLowerCase().trim() ||
          String(mod).toLowerCase().trim() !== String(module).toLowerCase().trim()) continue;

          // Collect the detailed fields for display
          details.push({
            caseCode: pickField(r, ['Case Code', 'CaseCode', 'Case']),
            model: pickField(r, ['Model No.', 'Model No', 'Model']),
            swver: pickField(r, ['S/W Ver.', 'SW Ver', 'Software Version']),
            grade: pickField(r, ['Grade', 'Garde']),
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

// Export functions for testing

// Start server only if this file is run directly (not imported)
if (require.main === module) {
  // Initialize services before starting server
  initializeServices().then(() => {
    app.listen(PORT, () => {
      console.log('\n🚀 Centralized Dashboard is running!');
      console.log(`📍 Open your browser and go to: http://localhost:${PORT}`);
      console.log('🤖 Make sure Ollama is running (qwen3:4b-instruct)\n');
    });
  }).catch(err => {
    console.error('❌ Failed to initialize services:', err);
    process.exit(1);
  });
}

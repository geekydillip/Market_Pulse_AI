/**
 * Chunking Utility Functions
 * Contains logic for creating optimal batches and managing chunked processing
 */

const { createOptimalBatches } = require('../processors/_helpers');

/**
 * Create chunked processing tasks
 * @param {Array} rows - Array of rows to process
 * @param {string} processingType - Type of processing
 * @param {string} model - AI model to use
 * @param {string} sessionId - Processing session ID
 * @param {string} processingMode - Processing mode (regular/discovery)
 * @param {Function} processChunkFunction - Function to process individual chunks
 * @param {number} chunkSize - Size of each chunk
 * @returns {Array} Array of processing tasks
 */
function createChunkedProcessingTasks(rows, processingType, model, sessionId, processingMode, processChunkFunction, chunkSize = 20) {
  // Create optimal batches using token-bounded chunking
  const batches = createOptimalBatches(rows, processingType);
  const numberOfChunks = batches.length;

  const tasks = [];
  let currentOffset = 0; // Track offset for original indices

  batches.forEach((batchRows, batchIndex) => {
    const batchStartIdx = currentOffset;
    const batchEndIdx = currentOffset + batchRows.length - 1;
    const chunk = {
      file_name: 'processed_file',
      chunk_id: batchIndex,
      row_indices: [batchStartIdx, batchEndIdx],
      headers: Object.keys(rows[0] || {}),
      rows: batchRows
    };
    currentOffset += batchRows.length; // Update offset for next batch

    tasks.push(async () => {
      const result = await processChunkFunction({
        chunk,
        processor: processingType, // This is the bug - passing string instead of function
        prompt: null, // Will be resolved in processChunk
        context: { model, sessionId, processingMode },
        analytics: null
      });
      return result;
    });
  });

  return tasks;
}

/**
 * Process chunked tasks with concurrency limit
 * @param {Array} tasks - Array of processing tasks
 * @param {number} limit - Concurrency limit
 * @returns {Array} Array of chunk results
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
 * Process results from chunked processing
 * @param {Array} chunkResults - Array of chunk results
 * @param {Array} headers - Original headers
 * @param {string} processingMode - Processing mode
 * @returns {Object} Processed results including rows, added columns, and failed rows
 */
function processChunkResults(chunkResults, headers, processingMode) {
  const allProcessedRows = [];
  const addedColumns = new Set();
  const failedRows = [];

  chunkResults.forEach(result => {
    if (!result) return;

    if (result.status === 'ok' && Array.isArray(result.processedRows)) {
      result.processedRows.forEach((row, idx) => {
        const originalIdx = (result.chunkId * 20) + idx; // Using fixed chunk size for simplicity
        allProcessedRows[originalIdx] = row;
        Object.keys(row || {}).forEach(col => {
          if (!headers.includes(col)) addedColumns.add(col);
        });
      });
    } else if (Array.isArray(result.processedRows)) {
      // For failed chunks, still include rows with error
      result.processedRows.forEach((row, idx) => {
        const originalIdx = (result.chunkId * 20) + idx;
        allProcessedRows[originalIdx] = row;
        if (row && row.error) {
          failedRows.push({
            row_index: originalIdx,
            chunk_id: result.chunkId,
            error_reason: row.error
          });
          addedColumns.add('error');
        }
      });
    }
  });

  // Filter out null entries if any
  const finalRows = allProcessedRows.filter(row => row != null);

  // Add classification_mode column for discovery mode
  if (processingMode === 'discovery' && !headers.includes('classification_mode')) {
    headers.push('classification_mode');
    finalRows.forEach(row => {
      row['classification_mode'] = 'discovery';
    });
  }

  return {
    finalRows,
    addedColumns: Array.from(addedColumns),
    failedRows
  };
}

/**
 * Generate processing log
 * @param {number} startTime - Processing start time
 * @param {number} numberOfInputRows - Number of input rows
 * @param {number} numberOfChunks - Number of chunks processed
 * @param {Array} chunkResults - Array of chunk results
 * @param {string} processingType - Processing type
 * @returns {Object} Processing log object
 */
function generateProcessingLog(startTime, numberOfInputRows, numberOfChunks, chunkResults, processingType) {
  const elapsedMs = Date.now() - startTime;
  const elapsedSec = elapsedMs / 1000;

  const failedRows = [];
  (chunkResults || []).forEach(cr => {
    (cr && cr.processedRows || []).forEach((row, idx) => {
      if (row && row.error) {
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
    number_of_batches: numberOfChunks,
    number_of_output_rows: numberOfInputRows, // Will be updated with actual count
    failed_row_details: failedRows,
    batch_processing_time: (chunkResults || []).map(cr => ({ batch_id: cr && cr.chunkId, time_ms: cr && cr.processingTime }))
  };

  if (processingType === 'clean') {
    log.assumptions = [
      "Applied generic cleaning: trimmed whitespace, normalized dates to ISO YYYY-MM-DD, converted numeric-looking strings to numbers, kept empty cells as empty strings."
    ];
  }

  return log;
}

module.exports = {
  createChunkedProcessingTasks,
  runTasksWithLimit,
  processChunkResults,
  generateProcessingLog
};
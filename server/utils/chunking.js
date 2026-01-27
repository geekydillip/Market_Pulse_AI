/**
 * Chunking Utility Functions
 * Contains logic for creating optimal batches and managing chunked processing
 */

const { createOptimalBatches } = require('../processors/_helpers');
const { getProcessor } = require('../processors'); // Import the registry to resolve functions

/**
 * Create chunked processing tasks
 */
function createChunkedProcessingTasks(rows, processingType, model, sessionId, processingMode, processChunkFunction, chunkSize = 20) {
  // Create optimal batches using token-bounded chunking
  const batches = createOptimalBatches(rows, processingType);
  const processorFunc = getProcessor(processingType); // Resolve the string to a function
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
      try {
        // Pass the actual processor function, not the type string
        const processedRows = await processChunkFunction({
          chunk,
          processor: processorFunc, 
          prompt: null, 
          context: { 
            model, 
            sessionId, 
            processingMode, 
            startIndex: batchStartIdx // Pass this to the processor
          },
          analytics: null
        });

        // Return the wrapper object that processChunkResults expects
        return {
          chunkId: batchIndex,
          status: 'ok',
          processedRows,
          chunk
        };
      } catch (error) {
        return {
          chunkId: batchIndex,
          status: 'error',
          processedRows: chunk.rows.map(row => ({ ...row, error: error.message })),
          chunk
        };
      }
    });
  });

  return tasks;
}

/**
 * Process chunked tasks with concurrency limit
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
 */
function processChunkResults(chunkResults, headers, processingMode) {
  const allProcessedRows = [];
  const addedColumns = new Set();
  const failedRows = [];

  chunkResults.forEach(result => {
    if (!result) return;

    // Successfully map results using the wrapper object
    if (result.status === 'ok' && Array.isArray(result.processedRows)) {
      result.processedRows.forEach((row, idx) => {
        // Use actual indices from metadata instead of hardcoded 20
        const batchStartIdx = result.chunk ? result.chunk.row_indices[0] : (result.chunkId * 20);
        const originalIdx = batchStartIdx + idx;
        
        allProcessedRows[originalIdx] = row;
        Object.keys(row || {}).forEach(col => {
          if (!headers.includes(col)) addedColumns.add(col);
        });
      });
    } else if (Array.isArray(result.processedRows)) {
      // For failed chunks, still include rows with error
      result.processedRows.forEach((row, idx) => {
        const batchStartIdx = result.chunk ? result.chunk.row_indices[0] : (result.chunkId * 20);
        const originalIdx = batchStartIdx + idx;
        
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

  // Filter out null entries
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
    number_of_output_rows: numberOfInputRows,
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
// processors/_helpers.js
const SUMMARY_FLAG = '__plmSummary';

function makeSummaryContainer(dataArray, opts = {}) {
  return {
    [SUMMARY_FLAG]: true,
    data: dataArray,
    originalChunkSize: opts.originalChunkSize ?? null,
    chunkId: opts.chunkId ?? null,
    meta: opts.meta ?? {}
  };
}

function isSummaryContainer(obj) {
  return obj && typeof obj === 'object' && obj[SUMMARY_FLAG] === true && Array.isArray(obj.data);
}

/**
 * Recursively removes Excel styling artifacts ("s" fields) from objects
 * This prevents Excel cell formatting data from contaminating JSON structures
 */
function cleanExcelStyling(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(cleanExcelStyling);
  }

  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    // Skip Excel styling fields
    if (key === 's' && value && typeof value === 'object' &&
        (value.alignment || value.font || value.border)) {
      continue; // Skip this styling field
    }
    // Recursively clean nested objects
    cleaned[key] = cleanExcelStyling(value);
  }

  return cleaned;
}

module.exports = {
  makeSummaryContainer,
  isSummaryContainer,
  cleanExcelStyling
};

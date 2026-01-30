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

module.exports = {
  makeSummaryContainer,
  isSummaryContainer
};

const xlsx = require('xlsx');
const promptTemplate = require('../prompts/betaIssuesPrompt');
const { buildRagPrompt } = require('../rag/prompts/ragPromptWrapper');
const { callOllamaCached } = require('../server');

/**
 * Shared header normalization utility - eliminates code duplication
 */
function normalizeHeaders(rows) {
  // Map header name variants to canonical names
  const headerMap = {
    // Model variants
    'model no.': 'Model No.',
    'Dev. Mdl. Name/Item Name': 'Model No.',
    'dev. mdl. name/item name': 'Model No.',
    // Case Code
    'case code': 'Case Code',
    // S/W Ver variants
    's/w ver.': 'S/W Ver.',
    // Title, Problem, Module, Sub-Module
    'title': 'Title',
    'progr.stat.': 'Progr.Stat.',
    'progress status': 'Progr.Stat.',
    'problem': 'Problem',
    'resolve option(medium)': 'Resolve Option(Medium)',
    'module': 'Module',
    'sub-module': 'Sub-Module',
    'issue type': 'Issue Type',
    'sub-issue type': 'Sub-Issue Type'
  };

  // canonical columns you expect in the downstream processing
  const canonicalCols = ['Case Code','Model No.','Progr.Stat.','S/W Ver.','Title','Problem','Resolve Option(Medium)'];

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


/**
 * Derive model name from S/W Ver. for OS Beta entries
 * Example: "S911BXXU8ZYHB" -> "SM-S911B"
 */
function deriveModelNameFromSwVer(swVer) {
  if (!swVer || typeof swVer !== 'string' || swVer.length < 5) {
    return '';
  }
  return 'SM-' + swVer.substring(0, 5);
}

// normalizeRows - now just calls the shared function
function normalizeRows(rows) {
  return normalizeHeaders(rows);
}


// Create the processor object
const betaIssuesProcessor = {
  // Add expected headers for the processor
  expectedHeaders: ['Case Code','Model No.','Progr.Stat.','S/W Ver.','Title','Problem','Resolve Option(Medium)'],
  
  // Add readAndNormalizeExcel function (will be imported from _helpers in server.js)
  // This is just a placeholder to maintain the interface
  readAndNormalizeExcel: null,
  
  // Add normalizeRows function
  normalizeRows: normalizeRows,
  
  // Add deriveModelNameFromSwVer function
  deriveModelNameFromSwVer: deriveModelNameFromSwVer
};

module.exports = betaIssuesProcessor;

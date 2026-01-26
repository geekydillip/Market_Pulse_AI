const xlsx = require('xlsx');
const promptTemplate = require('../prompts/samsungMembersPlmPrompt');
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
  const canonicalCols = ['Case Code','Model No.','Progr.Stat.','S/W Ver.','Title','Feature','Problem','Resolve Option(Medium)','Resolve Option(Small)','Cause','Counter Measure'];

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

// normalizeRows - now just calls the shared function
function normalizeRows(rows) {
  return normalizeHeaders(rows);
}

/**
 * Clean technical logs from text fields
 * Removes timestamped log entries and technical patterns while preserving explanatory text
 */
function cleanTechnicalLogs(text) {
  if (!text || typeof text !== 'string') return text;

  // Split into lines
  const lines = text.split('\n');

  // Filter out technical log lines
  const cleanedLines = lines.filter(line => {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) return false;

    // Skip lines starting with timestamps (YYYY-MM-DD HH:MM:SS format)
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(trimmed)) return false;

    // Skip lines containing technical log markers
    const logPatterns = [
      /\[PKG\]/, /\[COM\]/, /\[TOP\]/, /\[NET\]/, /\[SET\]/,
      /CAM_ERR/, /CAM-UTIL/, /hw_bigdata_i2c_from_eeprom/,
      /camxcslhw\.cpp/, /CSLAcquireDeviceHW/, /CAM_ERR/
    ];
    if (logPatterns.some(pattern => pattern.test(trimmed))) return false;

    // Skip lines that look like technical data (containing many numbers/symbols)
    // But keep lines that are explanatory text
    const technicalChars = /[=<>[\]{}()|:-]/.test(trimmed);
    const wordCount = trimmed.split(/\s+/).length;
    const hasManyNumbers = (trimmed.match(/\d+/g) || []).length > 3;

    // If line has many technical characters and numbers, likely a log
    if (technicalChars && hasManyNumbers && wordCount < 10) return false;

    // Keep lines that look like natural language or bullet points
    return true;
  });

  // Join cleaned lines back
  return cleanedLines.join('\n').trim();
}

/**
 * Clean title by removing leading bracketed metadata blocks and ensuring proper formatting
 */
function cleanTitle(title) {
  if (!title || typeof title !== 'string') return title;

  let t = title;

  // Remove leading bracketed metadata blocks
  t = t.replace(/^(\[[^\]]*\]\s*)+/g, '');

  // Trim whitespace
  t = t.trim();

  // Ensure sentence ends with a period (only if not already)
  if (t && !/[.!?]$/.test(t)) {
    t += '.';
  }

  return t;
}

/**
 * Clean problem by removing internal notice blocks and limiting length
 */
function cleanProblem(problem) {
  if (!problem || typeof problem !== 'string') return problem;

  let t = problem;

  // Remove Samsung Members internal notice block
  t = t.replace(/\[Samsung Members Notice\][\s\S]*$/i, '');

  // Trim whitespace
  t = t.trim();

  // Limit to 500 characters
  if (t.length > 500) {
    t = t.slice(0, 500);
  }

  return t;
}

/**
 * Clean Cause and Counter Measure fields
 */
function cleanCauseOrCounterMeasure(text) {
  if (!text || typeof text !== 'string') return text;

  // Clean technical logs
  let cleaned = cleanTechnicalLogs(text);

  // Trim whitespace
  cleaned = cleaned.trim();

  // Limit to 300 characters
  if (cleaned.length > 300) {
    cleaned = cleaned.slice(0, 300);
  }

  return cleaned;
}

// Create the processor object
const samsungMembersPlmProcessor = {
  // Add expected headers for the processor
  expectedHeaders: ['Case Code','Model No.','Progr.Stat.','S/W Ver.','Title','Feature','Problem','Resolve Option(Medium)','Resolve Option(Small)','Cause','Counter Measure'],
  
  // Add normalizeRows function
  normalizeRows: normalizeRows
};

module.exports = samsungMembersPlmProcessor;

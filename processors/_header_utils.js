/**
 * Shared header normalization utilities for all processors
 * This ensures consistent header mapping across PLM and VOC processors
 */

/**
 * Normalize headers for PLM processor
 * Maps various header name variants to canonical names
 */
function normalizePLMHeaders(rows) {
  const headerMap = {
    // Model variants
    'model no.': 'Model No.',
    'Dev. Mdl. Name/Item Name': 'Model No.',
    'dev. mdl. name/item name': 'Model No.',
    'target model': 'Model No.',
    
    // Case Code variants
    'case code': 'Case Code',
    'plm code': 'Case Code',
    
    // S/W Ver variants
    's/w ver.': 'S/W Ver.',
    'version occurred': 'S/W Ver.',
    
    // Status variants
    'progr.stat.': 'Progr.Stat.',
    'progress status': 'Progr.Stat.',
    'plm status': 'Resolve',
    
    // Other fields
    'title': 'Title',
    'problem': 'Problem',
    'resolve': 'Resolve',
    'module': 'Module',
    'sub-module': 'Sub-Module',
    'issue type': 'Issue Type',
    'sub-issue type': 'Sub-Issue Type'
  };

  const canonicalCols = ['Case Code', 'Model No.', 'Progr.Stat.', 'S/W Ver.', 'Title', 'Problem', 'Resolve'];

  return normalizeHeaders(rows, headerMap, canonicalCols);
}

/**
 * Normalize headers for VOC processor
 * Maps various header name variants to canonical names
 */
function normalizeVOCHeaders(rows) {
  const headerMap = {
    // Basic fields
    'no': 'No',
    'model no.': 'Model No.',
    'model_no': 'Model No.',
    'os': 'OS',
    'csc': 'CSC',
    'category': 'Category',
    
    // Application fields
    'application name': 'Application Name',
    'application_name': 'Application Name',
    'app name': 'Application Name',
    'application type': 'Application Type',
    'application_type': 'Application Type',
    'app type': 'Application Type',
    
    // Content and types
    'content': 'content',
    'main type': 'Main Type',
    'main_type': 'Main Type',
    'sub type': 'Sub Type',
    'sub_type': 'Sub Type',
    
    // Module fields
    'module/apps': 'Module',
    'module': 'Module',
    'sub-module': 'Sub-Module',
    'sub module': 'Sub-Module',
    
    // AI fields
    'AI Insight': 'AI Insight'
  };

  const canonicalCols = ['No', 'Model No.', 'OS', 'CSC', 'Category', 'Application Name', 'Application Type', 'content', 'Main Type', 'Sub Type', 'Module', 'Sub-Module', 'AI Insight'];

  return normalizeHeaders(rows, headerMap, canonicalCols);
}

/**
 * Generic header normalization function
 * @param {Array} rows - Array of row objects with original headers
 * @param {Object} headerMap - Mapping of header variants to canonical names
 * @param {Array} canonicalCols - List of expected canonical column names
 * @returns {Array} - Array of row objects with normalized headers
 */
function normalizeHeaders(rows, headerMap, canonicalCols) {
  return rows.map(orig => {
    const out = {};
    
    // Build a reverse map of original header -> canonical
    const keyMap = {};
    Object.keys(orig).forEach(rawKey => {
      const norm = String(rawKey || '').trim().toLowerCase();
      const mapped = headerMap[norm] || headerMap[norm.replace(/\s+|\./g, '')] || null;
      if (mapped) keyMap[rawKey] = mapped;
      else {
        // Try exact match to canonical
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
      let found = null;
      for (const rawKey of Object.keys(orig)) {
        if (keyMap[rawKey] === tgt) {
          found = orig[rawKey];
          break;
        }
      }
      // Also check if target exists exactly as a raw header name
      if (found === null && Object.prototype.hasOwnProperty.call(orig, tgt)) {
        found = orig[tgt];
      }
      out[tgt] = (found !== undefined && found !== null) ? found : '';
    }
    return out;
  });
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

module.exports = {
  normalizePLMHeaders,
  normalizeVOCHeaders,
  normalizeHeaders,
  deriveModelNameFromSwVer
};
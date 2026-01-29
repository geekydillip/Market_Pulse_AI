const xlsx = require('xlsx');
const promptTemplate = require('../prompts/utPortalPrompt');

/**
 * Shared header normalization utility - eliminates code duplication
 */
function normalizeHeaders(rows) {
  // Map header name variants to canonical names
  const headerMap = {
    // Key fields for AI processing
    'title': 'Title',
    'problem': 'Problem',
    'steps to reproduce': 'Steps to reproduce',
    
    // Identifying columns to preserve
    'issue id': 'Issue ID',
    'plm code': 'PLM code',
    'target model': 'Target model',
    'version occurred': 'Version occurred',
    'plm status': 'PLM Status',
    'plm importance': 'PLM importance',
    'plm resolve option1': 'PLM resolve option1',
    'plm resolve option2': 'PLM resolve option2',
    'registered date': 'Registered date',
    'project name': 'Project name',
    'region': 'Region',
    'area': 'Area',
    'frequency': 'Frequency',
    'problem detector': 'Problem detector',
    'single id': 'Single ID',
    'duplicate processing classfication': 'Duplicate processing classfication',
    'ut issue id (main)': 'UT Issue ID (Main)',
    'duplicate count': 'Duplicate count',
    'ai process result': 'AI Process Result',
    'expected behavior': 'Expected behavior',
    'progress status': 'Progress status',
    'process result1': 'Process result1',
    'process result2': 'Process result2',
    'source': 'Source',
    'block': 'Block',
    'feature': 'Feature',
    'appearance classification1': 'Appearance Classification1',
    'appearance classification2': 'Appearance Classification2',
    'function classification': 'Function Classification',
    'plm project name(issue linkage)': 'PLM Project Name(Issue linkage)',
    'characteristics type': 'Characteristics Type',
    'points': 'Points',
    'additional points': 'Additional points',
    'manager comment': 'Manager comment',
    'reason for processing result': 'Reason for processing result',
    'internal memo1': 'Internal memo1',
    'internal memo2': 'Internal memo2',
    'user scenario(ai)': 'User scenario(AI)',
    'log download link': 'Log Download Link',
    'battery historian link': 'Battery Historian link',
    'log inbody link': 'Log Inbody link',
    'results registered date': 'Results registered date',
    'results registrant': 'Results registrant',
    'issue hash tag': 'ISSUE HASH TAG',
    'keyword': 'KEYWORD',
    'plm tg manager': 'PLM TG Manager',
    'plm tg manager knox id': 'PLM TG Manager Knox ID',
    'processing classification': 'Processing classification',
    'detection classification': 'Detection classification',
    'issue hub type': 'Issue Hub Type',
    'major classification': 'Major classification',
    'delete reason': 'Delete Reason',
    'cause': 'Cause',
    'countermeasure': 'Countermeasure'
  };

  // canonical columns you expect in the downstream processing
  const canonicalCols = [
    'Issue ID', 'PLM code', 'Target model', 'Version occurred', 'Title', 'PLM Status', 
    'PLM importance', 'PLM resolve option1', 'PLM resolve option2', 'Registered date',
    'Project name', 'Region', 'Area', 'Frequency', 'Problem detector', 'Single ID', 
    'Steps to reproduce', 'Problem', 'Duplicate processing classfication', 'UT Issue ID (Main)',
    'Duplicate count', 'AI Process Result', 'Expected behavior', 'Progress status', 
    'Process result1', 'Process result2', 'Source', 'Block', 'Feature', 
    'Appearance Classification1', 'Appearance Classification2', 'Function Classification',
    'PLM Project Name(Issue linkage)', 'Characteristics Type', 'Points', 'Additional points',
    'Manager comment', 'Reason for processing result', 'Internal memo1', 'Internal memo2',
    'User scenario(AI)', 'Log Download Link', 'Battery Historian link', 'Log Inbody link',
    'Results registered date', 'Results registrant', 'ISSUE HASH TAG', 'KEYWORD',
    'PLM TG Manager', 'PLM TG Manager Knox ID', 'Processing classification', 
    'Detection classification', 'Issue Hub Type', 'Major classification', 'Delete Reason',
    'Cause', 'Countermeasure'
  ];

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

function readAndNormalizeExcel(uploadedPath) {
  const workbook = xlsx.readFile(uploadedPath, { cellDates: true, raw: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Read sheet as 2D array so we can find header row robustly
  const sheetRows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  // Find a header row: first row that contains at least one expected key or at least one non-empty cell
  let headerRowIndex = 0;
  const expectedHeaderKeywords = ['Issue ID', 'Title', 'Problem', 'PLM code', 'Target model']; // lowercase checks
  for (let r = 0; r < sheetRows.length; r++) {
    const row = sheetRows[r];
    if (!Array.isArray(row)) continue;
    const rowText = row.map(c => String(c || '').toLowerCase()).join(' | ');
    // if the row contains any expected header keyword, choose it as header
    if (expectedHeaderKeywords.some(k => rowText.includes(k))) {
      headerRowIndex = r;
      break;
    }
    // fallback: first non-empty row becomes header
    if (row.some(cell => String(cell).trim() !== '')) {
      headerRowIndex = r;
      break;
    }
  }

  // Build raw headers and trim
  const rawHeaders = (sheetRows[headerRowIndex] || []).map(h => String(h || '').trim());

  // Build data rows starting after headerRowIndex
  const dataRows = sheetRows.slice(headerRowIndex + 1);

  // Convert dataRows to array of objects keyed by rawHeaders
  let rows = dataRows.map(r => {
    const obj = {};
    for (let ci = 0; ci < rawHeaders.length; ci++) {
      const key = rawHeaders[ci] || `col_${ci}`;
      obj[key] = r[ci] !== undefined && r[ci] !== null ? r[ci] : '';
    }
    return obj;
  });

  // Use shared normalization function
  return normalizeHeaders(rows);
}

// normalizeRows - now just calls the shared function
function normalizeRows(rows) {
  return normalizeHeaders(rows);
}

module.exports = {
  id: 'utPortal',
  expectedHeaders: ['Issue ID', 'PLM code', 'Target model', 'Version occurred', 'Title', 'Problem', 'Steps to reproduce', 'PLM Status', 'PLM importance', 'PLM resolve option1', 'PLM resolve option2', 'Registered date', 'Project name', 'Region', 'Area', 'Frequency', 'Problem detector', 'Single ID', 'Duplicate processing classfication', 'UT Issue ID (Main)', 'Duplicate count', 'AI Process Result', 'Expected behavior', 'Progress status', 'Process result1', 'Process result2', 'Source', 'Block', 'Feature', 'Appearance Classification1', 'Appearance Classification2', 'Function Classification', 'PLM Project Name(Issue linkage)', 'Characteristics Type', 'Points', 'Additional points', 'Manager comment', 'Reason for processing result', 'Internal memo1', 'Internal memo2', 'User scenario(AI)', 'Log Download Link', 'Battery Historian link', 'Log Inbody link', 'Results registered date', 'Results registrant', 'ISSUE HASH TAG', 'KEYWORD', 'PLM TG Manager', 'PLM TG Manager Knox ID', 'Processing classification', 'Detection classification', 'Issue Hub Type', 'Major classification', 'Delete Reason', 'Cause', 'Countermeasure'],

  validateHeaders(rawHeaders) {
    // Check if required fields are present
    const required = ['Title', 'Problem'];
    return required.some(header =>
      rawHeaders.includes(header) ||
      rawHeaders.some(h => h.toLowerCase().trim() === header.toLowerCase().trim())
    );
  },

  transform(rows) {
    // Apply normalization using the local normalizeHeaders function
    return normalizeHeaders(rows);
  },

  buildPrompt(rows) {
    // Send only content fields to AI for analysis
    const aiInputRows = rows.map(row => ({
      Title: row.Title || '',
      Problem: (row.Problem || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
      'Steps to reproduce': (row['Steps to reproduce'] || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    }));
    return promptTemplate.replace('{INPUTDATA_JSON}', JSON.stringify(aiInputRows, null, 2));
  },

  formatResponse(aiResult, originalRows) {
    let aiRows;

    // Handle different response formats: object, JSON string, or raw text
    if (typeof aiResult === 'object' && aiResult !== null) {
      aiRows = aiResult;
    } else if (typeof aiResult === 'string') {
      const text = aiResult.trim();

      // First try to parse as complete JSON
      try {
        aiRows = JSON.parse(text);
      } catch (e) {
        // If that fails, try to extract JSON array from text
        const firstBracket = text.indexOf('[');
        const lastBracket = text.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket > firstBracket) {
          const jsonStr = text.substring(firstBracket, lastBracket + 1);
          try {
            aiRows = JSON.parse(jsonStr);
          } catch (e2) {
            // If JSON parsing fails, return array with error info
            return [{ error: `Failed to parse AI response: ${text.substring(0, 200)}...` }];
          }
        } else {
          // Last resort: return array with error info
          return [{ error: `Invalid AI response format: ${text.substring(0, 200)}...` }];
        }
      }
    } else {
      // Fallback for unexpected types - return array
      return [{ error: `Unexpected AI response type: ${typeof aiResult}` }];
    }

    // Ensure aiRows is an array
    if (!Array.isArray(aiRows)) {
      return [{ error: `AI response is not an array: ${typeof aiRows}` }];
    }

    // Sanitize NaN values in AI response
    function sanitizeNaN(obj) {
      if (obj === null || typeof obj !== 'object') {
        if (typeof obj === 'number' && isNaN(obj)) {
          return '';
        }
        return obj;
      }
      if (Array.isArray(obj)) {
        return obj.map(sanitizeNaN);
      }
      const sanitized = {};
      for (const key in obj) {
        sanitized[key] = sanitizeNaN(obj[key]);
      }
      return sanitized;
    }

    aiRows = sanitizeNaN(aiRows);

    // Merge AI results with original core identifiers
    const mergedRows = aiRows.map((aiRow, index) => {
      const original = originalRows[index] || {};
      return {
        'Issue ID': original['Issue ID'] || '',
        'PLM code': original['PLM code'] || '',
        'Target model': original['Target model'] || '',
        'Version occurred': original['Version occurred'] || '',
        'Title': aiRow['Title'] || '',  // From AI (cleaned)
        'PLM Status': original['PLM Status'] || '',
        'PLM importance': original['PLM importance'] || '',
        'PLM resolve option1': original['PLM resolve option1'] || '',
        'PLM resolve option2': original['PLM resolve option2'] || '',
        'Registered date': original['Registered date'] || '',
        'Project name': original['Project name'] || '',
        'Region': original['Region'] || '',
        'Area': original['Area'] || '',
        'Frequency': original['Frequency'] || '',
        'Problem detector': original['Problem detector'] || '',
        'Single ID': original['Single ID'] || '',
        'Steps to reproduce': aiRow['Steps to reproduce'] || '',  // From AI (cleaned)
        'Problem': aiRow['Problem'] || '',  // From AI (cleaned)
        'Duplicate processing classfication': original['Duplicate processing classfication'] || '',
        'UT Issue ID (Main)': original['UT Issue ID (Main)'] || '',
        'Duplicate count': original['Duplicate count'] || '',
        'AI Process Result': original['AI Process Result'] || '',
        'Expected behavior': original['Expected behavior'] || '',
        'Progress status': original['Progress status'] || '',
        'Process result1': original['Process result1'] || '',
        'Process result2': original['Process result2'] || '',
        'Source': original['Source'] || '',
        'Block': original['Block'] || '',
        'Feature': original['Feature'] || '',
        'Appearance Classification1': original['Appearance Classification1'] || '',
        'Appearance Classification2': original['Appearance Classification2'] || '',
        'Function Classification': original['Function Classification'] || '',
        'PLM Project Name(Issue linkage)': original['PLM Project Name(Issue linkage)'] || '',
        'Characteristics Type': original['Characteristics Type'] || '',
        'Points': original['Points'] || '',
        'Additional points': original['Additional points'] || '',
        'Manager comment': original['Manager comment'] || '',
        'Reason for processing result': original['Reason for processing result'] || '',
        'Internal memo1': original['Internal memo1'] || '',
        'Internal memo2': original['Internal memo2'] || '',
        'User scenario(AI)': original['User scenario(AI)'] || '',
        'Log Download Link': original['Log Download Link'] || '',
        'Battery Historian link': original['Battery Historian link'] || '',
        'Log Inbody link': original['Log Inbody link'] || '',
        'Results registered date': original['Results registered date'] || '',
        'Results registrant': original['Results registrant'] || '',
        'ISSUE HASH TAG': original['ISSUE HASH TAG'] || '',
        'KEYWORD': original['KEYWORD'] || '',
        'PLM TG Manager': original['PLM TG Manager'] || '',
        'PLM TG Manager Knox ID': original['PLM TG Manager Knox ID'] || '',
        'Processing classification': original['Processing classification'] || '',
        'Detection classification': original['Detection classification'] || '',
        'Issue Hub Type': original['Issue Hub Type'] || '',
        'Major classification': original['Major classification'] || '',
        'Delete Reason': original['Delete Reason'] || '',
        'Cause': original['Cause'] || '',
        'Countermeasure': original['Countermeasure'] || '',
        
        // New AI-generated columns
        'Feature/App': aiRow['Feature/App'] || '',
        '3rd Party App': aiRow['3rd Party App'] || '',
        'TG': aiRow['TG'] || '',
        'Issue Type': aiRow['Issue Type'] || ''
      };
    });

    return mergedRows;
  },

  // Returns column width configurations for Excel export
  getColumnWidths(finalHeaders) {
    return finalHeaders.map((h, idx) => {
      if (['Title','Problem','Steps to reproduce','Expected behavior','User scenario(AI)','Manager comment','Reason for processing result','Internal memo1','Internal memo2'].includes(h)) return { wch: 41 };
      if (h === 'Issue ID' || h === 'PLM code' || h === 'Target model' || h === 'Single ID' || h === 'UT Issue ID (Main)') return { wch: 20 };
      if (h === 'Version occurred' || h === 'Registered date' || h === 'Results registered date' || h === 'Frequency' || h === 'Points' || h === 'Additional points') return { wch: 15 };
      if (h === 'Feature/App' || h === '3rd Party App' || h === 'TG' || h === 'Issue Type' || h === 'Source' || h === 'Block' || h === 'Feature' || h === 'Region' || h === 'Area' || h === 'Problem detector') return { wch: 15 };
      if (h === 'error') return { wch: 15 };
      return { wch: 20 };
    });
  },

  // Excel reading function used by server.js
  readAndNormalizeExcel: readAndNormalizeExcel
};
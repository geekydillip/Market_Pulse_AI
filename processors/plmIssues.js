const xlsx = require('xlsx');
const promptTemplate = require('../prompts/plmIssuesPrompt');
const discoveryPromptTemplate = require('../prompts/plmIssuesPrompt_discovery');
const embeddingsStore = require('../server/embeddings_store');
const { callOllamaEmbeddings } = require('../server');
const { cleanExcelStyling } = require('./_helpers');

/**
 * Shared header normalization utility - eliminates code duplication
 */
function normalizeHeaders(rows) {
  // Map header name variants to canonical names
  const headerMap = {
    // Model variants
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
    'module': 'Module',
    'sub-module': 'Sub-Module',
    'priority': 'Priority',
    'occurr. freq.': 'Occurr. Freq.',
  };

  // canonical columns you expect in the downstream processing
  const canonicalCols = ['Case Code','Model No.','Progr.Stat.','Title','Priority','Occurr. Freq.','S/W Ver.','Problem'];

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
  const expectedHeaderKeywords = ['Case Code','Dev. Mdl. Name/Item Name','Progr.Stat.','Title','Priority','Occurr. Freq.','S/W Ver.','Problem']; // lowercase checks
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
  id: 'plmIssuesPrompt',
  expectedHeaders: ['Case Code', 'Model No.', 'Progr.Stat.','S/W Ver.', 'Title', 'Problem', 'Priority', 'Occurr. Freq.', 'Module', 'Sub-Module', 'Issue Type', 'Sub-Issue Type', 'Summarized Problem', 'Severity', 'Severity Reason'],

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

  buildPrompt(rows, mode = 'regular') {
    // Send only content fields to AI for analysis
    const aiInputRows = rows.map(row => ({
      Title: row.Title || '',
      Problem: (row.Problem || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
      'Dev. Mdl. Name/Item Name': row['Model No.'] || '',
      Priority: row.Priority || '',
      'Occurr. Freq.': row['Occurr. Freq.'] || ''
    }));

    if (mode === 'discovery') {
      return discoveryPromptTemplate.replace('{INPUTDATA_JSON}', JSON.stringify(aiInputRows, null, 2));
    } else {
      return promptTemplate.replace('{INPUTDATA_JSON}', JSON.stringify(aiInputRows, null, 2));
    }
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
        'Case Code': original['Case Code'] || '',
        'Model No.': original['Model No.'] || '',
        'Progr.Stat.': original['Progr.Stat.'] || '',
        'S/W Ver.': original['S/W Ver.'] || '',
        'Title': aiRow['Title'] || '',  // From AI (cleaned)
        'Problem': (aiRow['Problem'] || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'),  // From AI (cleaned)
        'Priority': original['Priority'] || '',
        'Occurr. Freq.': original['Occurr. Freq.'] || '',
        'Module': aiRow['Module'] || '',
        'Sub-Module': aiRow['Sub-Module'] || '',
        'Issue Type': aiRow['Issue Type'] || '',
        'Sub-Issue Type': aiRow['Sub-Issue Type'] || '',
        'Summarized Problem': aiRow['Summarized Problem'] || '',
        'Severity': aiRow['Severity'] || '',
        'Severity Reason': aiRow['Severity Reason'] || ''
      };
    });

    return mergedRows;
  },

  // Discovery mode methods
  async formatDiscoveryResponse(aiResult, originalRows, sourceFile = '') {
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

    // Generate discovery data with embeddings
    const discoveryData = [];
    const embeddingTasks = [];

    for (let i = 0; i < aiRows.length; i++) {
      const aiRow = aiRows[i];
      const original = originalRows[i] || {};

      // Create row text for embedding (Title + Problem + Priority + Occurr. Freq.)
      const rowText = `${original.Title || ''} ${original.Problem || ''} ${original.Priority || ''} ${original['Occurr. Freq.'] || ''}`.trim();

      // Extract discovered labels
      const rawDiscovery = {
        module: aiRow.module || '',
        sub_module: aiRow.sub_module || '',
        issue_type: aiRow.issue_type || '',
        sub_issue_type: aiRow.sub_issue_type || ''
      };

      // Prepare embedding tasks
      const textsToEmbed = [rowText];
      if (rawDiscovery.module) textsToEmbed.push(rawDiscovery.module);
      if (rawDiscovery.sub_module) textsToEmbed.push(rawDiscovery.sub_module);
      if (rawDiscovery.issue_type) textsToEmbed.push(rawDiscovery.issue_type);
      if (rawDiscovery.sub_issue_type) textsToEmbed.push(rawDiscovery.sub_issue_type);

      embeddingTasks.push({
        index: i,
        texts: textsToEmbed,
        rowText,
        rawDiscovery,
        original
      });
    }

    // Generate embeddings for all texts
    const embeddingResults = [];
    for (const task of embeddingTasks) {
      const embeddings = {};
      const embeddingRefs = {};

      try {
        // Check cache first
        const cachedEmbeddings = await embeddingsStore.getMultipleEmbeddings(task.texts);

        // Generate missing embeddings
        for (const text of task.texts) {
          let embedding = null;
          const cached = cachedEmbeddings.get(embeddingsStore.generateHash(text));

          if (cached) {
            embedding = cached.embedding;
          } else {
            // Generate new embedding
            try {
              embedding = await callOllamaEmbeddings(text);
              // Store in cache
              await embeddingsStore.storeEmbedding(text, embedding);
            } catch (embedErr) {
              console.warn(`Failed to generate embedding for text: ${text.substring(0, 50)}...`, embedErr.message);
              embedding = null;
            }
          }

          // Store embedding by text type
          if (text === task.rowText) {
            embeddings.rowText = embedding;
          } else if (text === task.rawDiscovery.module) {
            embeddings.module = embedding;
          } else if (text === task.rawDiscovery.sub_module) {
            embeddings.sub_module = embedding;
          } else if (text === task.rawDiscovery.issue_type) {
            embeddings.issue_type = embedding;
          } else if (text === task.rawDiscovery.sub_issue_type) {
            embeddings.sub_issue_type = embedding;
          }
        }

        // Create embedding reference IDs
        const rowEmbeddingId = embeddings.rowText ? `vec_${Date.now()}_${task.index}_row` : null;
        const labelEmbeddingIds = [];
        if (embeddings.module) labelEmbeddingIds.push(`vec_${Date.now()}_${task.index}_module`);
        if (embeddings.sub_module) labelEmbeddingIds.push(`vec_${Date.now()}_${task.index}_sub_module`);
        if (embeddings.issue_type) labelEmbeddingIds.push(`vec_${Date.now()}_${task.index}_issue_type`);
        if (embeddings.sub_issue_type) labelEmbeddingIds.push(`vec_${Date.now()}_${task.index}_sub_issue_type`);

        embeddingResults.push({
          row_id: `row_${task.index}`,
          raw_discovery: task.rawDiscovery,
          embedding_refs: {
            row_embedding_id: rowEmbeddingId,
            label_embedding_ids: labelEmbeddingIds
          },
          embeddings, // Keep actual embeddings for storage
          mode: 'discovery'
        });

      } catch (err) {
        console.warn(`Failed to process embeddings for row ${task.index}:`, err.message);
        embeddingResults.push({
          row_id: `row_${task.index}`,
          raw_discovery: task.rawDiscovery,
          embedding_refs: {
            row_embedding_id: null,
            label_embedding_ids: []
          },
          embeddings: {},
          mode: 'discovery'
        });
      }
    }

    // Clean Excel styling artifacts from discovery data
    const cleanedResults = embeddingResults.map(result => cleanExcelStyling(result));

    return cleanedResults;
  },

  // Returns column width configurations for Excel export
  getColumnWidths(finalHeaders) {
    return finalHeaders.map((h, idx) => {
      if (['Title','Problem','Summarized Problem','Severity Reason'].includes(h)) return { wch: 41 };
      if (h === 'Model No.') return { wch: 20 };
      if (h === 'S/W Ver.' || h === 'Occurr. Freq.'|| h === 'Priority') return { wch: 15 };
      if (h === 'Module' || h === 'Sub-Module' || h === 'Issue Type' || h === 'Sub-Issue Type') return { wch: 15 };
      if (h === 'error') return { wch: 15 };
      return { wch: 20 };
    });
  },

  // Excel reading function used by server.js
  readAndNormalizeExcel: readAndNormalizeExcel
};

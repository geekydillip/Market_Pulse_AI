const xlsx = require('xlsx');
const promptTemplate = require('../prompts/betaIssuesPrompt');
const discoveryPromptTemplate = require('../prompts/betaIssuesPrompt_discovery');
const embeddingsStore = require('../server/embeddings_store');
const { callOllamaEmbeddings } = require('../server');
const { cleanExcelStyling } = require('./_helpers');

/**
 * Deep clean objects to remove Excel styling artifacts recursively
 * @param {any} obj - Object to clean
 * @returns {any} Cleaned object
 */
function cleanObjectRecursively(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return cleanExcelStyling(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => cleanObjectRecursively(item));
  }

  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    // Skip Excel styling keys and metadata keys
    if (key === 's' || key === 'w' || key.startsWith('!') || key === 't' || key === 'r') {
      continue;
    }
    cleaned[key] = cleanObjectRecursively(value);
  }
  return cleaned;
}

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

function readAndNormalizeExcel(uploadedPath) {
  console.log('[DEBUG] Reading Excel file:', uploadedPath);
  const workbook = xlsx.readFile(uploadedPath, { cellDates: true, raw: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  console.log('[DEBUG] Sheet name:', sheetName);

  // Read sheet as 2D array so we can find header row robustly
  const sheetRows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  console.log('[DEBUG] Total rows in sheet:', sheetRows.length);
  console.log('[DEBUG] First 3 rows:', sheetRows.slice(0, 3));

  // Find a header row: first row that contains at least one expected key or at least one non-empty cell
  let headerRowIndex = 0;
  const expectedHeaderKeywords = ['Case Code','Dev. Mdl. Name/Item Name','Model No.','Progr.Stat.','S/W Ver.','Title','Problem','Resolve Option(Medium)','Issue Type','Sub-Issue Type']; // lowercase checks
  console.log('[DEBUG] Looking for header row...');
  for (let r = 0; r < sheetRows.length; r++) {
    const row = sheetRows[r];
    if (!Array.isArray(row)) continue;
    const rowText = row.map(c => String(c || '').toLowerCase()).join(' | ');
    console.log(`[DEBUG] Row ${r}: ${rowText}`);
    // if the row contains any expected header keyword, choose it as header
    if (expectedHeaderKeywords.some(k => rowText.includes(k))) {
      headerRowIndex = r;
      console.log(`[DEBUG] Found header row at index ${r} (contains expected keywords)`);
      break;
    }
    // fallback: first non-empty row becomes header
    if (row.some(cell => String(cell).trim() !== '')) {
      headerRowIndex = r;
      console.log(`[DEBUG] Using row ${r} as header (first non-empty row)`);
      break;
    }
  }

  console.log(`[DEBUG] Selected header row index: ${headerRowIndex}`);

  // Build raw headers and trim
  const rawHeaders = (sheetRows[headerRowIndex] || []).map(h => String(h || '').trim());
  console.log('[DEBUG] Raw headers:', rawHeaders);

  // Build data rows starting after headerRowIndex
  const dataRows = sheetRows.slice(headerRowIndex + 1);
  console.log(`[DEBUG] Data rows count: ${dataRows.length}`);
  console.log('[DEBUG] First data row:', dataRows[0]);

  // Convert dataRows to array of objects keyed by rawHeaders
  let rows = dataRows.map((r, idx) => {
    const obj = {};
    for (let ci = 0; ci < rawHeaders.length; ci++) {
      const key = rawHeaders[ci] || `col_${ci}`;
      obj[key] = r[ci] !== undefined && r[ci] !== null ? r[ci] : '';
    }
    if (idx < 3) { // Log first 3 rows
      console.log(`[DEBUG] Processed row ${idx}:`, { Title: obj.Title, Problem: obj.Problem });
    }
    return obj;
  });
  console.log(`[DEBUG] Total processed rows: ${rows.length}`);

  // Use shared normalization function
  const normalizedRows = normalizeHeaders(rows);
  console.log('[DEBUG] After normalization, first 3 rows:');
  normalizedRows.slice(0, 3).forEach((row, idx) => {
    console.log(`[DEBUG] Normalized row ${idx}:`, { Title: row.Title, Problem: row.Problem });
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

module.exports = {
  id: 'betaIssues',
  expectedHeaders: ['Case Code', 'Model No.', 'Progr.Stat.', 'S/W Ver.', 'Title', 'Problem', 'Resolve Option(Medium)', 'Module', 'Sub-Module', 'Issue Type', 'Sub-Issue Type', 'Summarized Problem', 'Severity', 'Severity Reason'],

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
    // Send only content fields to AI for analysis using numbered JSON format
    const numberedInput = {};
    rows.forEach((row, index) => {
      numberedInput[(index + 1).toString()] = {
        Title: row.Title || '',
        Problem: row.Problem || ''
      };
    });

    if (mode === 'discovery') {
      return discoveryPromptTemplate.replace('{INPUTDATA_JSON}', JSON.stringify(numberedInput, null, 2));
    } else {
      return promptTemplate.replace('{INPUTDATA_JSON}', JSON.stringify(numberedInput, null, 2));
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

    // Merge AI results with original core identifiers
    const mergedRows = aiRows.map((aiRow, index) => {
      const original = originalRows[index] || {};
      return {
        'Case Code': original['Case Code'] || '',
        'Model No.': (original['Model No.'] && original['Model No.'].startsWith('[OS Beta]'))
          ? deriveModelNameFromSwVer(original['S/W Ver.'])
          : (original['Model No.'] || ''),
        'Progr.Stat.': original['Progr.Stat.'] || '',
        'S/W Ver.': original['S/W Ver.'] || '',
        'Title': aiRow['Title'] || '',  // From AI (cleaned)
        'Problem': aiRow['Problem'] || '',  // From AI (cleaned)
        'Resolve Option(Medium)': original['Resolve Option(Medium)'] || '',
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

  // Returns column width configurations for Excel export
  getColumnWidths(finalHeaders) {
    return finalHeaders.map((h, idx) => {
      if (['Title','Problem','Summarized Problem','Severity Reason'].includes(h)) return { wch: 41 };
      if (h === 'Model No.' || h === 'Resolve Option(Medium)') return { wch: 20 };
      if (h === 'S/W Ver.' || h === 'Progr.Stat.' || h === 'Issue Type' || h === 'Sub-Issue Type') return { wch: 15 };
      if (h === 'Module' || h === 'Sub-Module') return { wch: 15 };
      if (h === 'error') return { wch: 15 };
      return { wch: 20 };
    });
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

    // Clean AI response to remove Excel styling artifacts
    const cleanedAiRows = aiRows.map(row => cleanObjectRecursively(row));
    console.log(`[Discovery] Cleaned ${cleanedAiRows.length} AI rows of styling artifacts`);

    // Generate discovery data with embeddings
    const discoveryData = [];
    const embeddingTasks = [];

    for (let i = 0; i < cleanedAiRows.length; i++) {
      const aiRow = cleanedAiRows[i];
      const original = originalRows[i] || {};

      // Create row text for embedding (Title + Problem)
      const rowText = `${original.Title || ''} ${original.Problem || ''}`.trim();

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

    return embeddingResults;
  },

  // Excel reading function used by server.js
  readAndNormalizeExcel: readAndNormalizeExcel
};

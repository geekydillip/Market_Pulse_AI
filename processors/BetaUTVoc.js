const xlsx = require('xlsx');
const promptTemplate = require('../prompts/BetaUTVoc');

/**
 * Shared header normalization utility - eliminates code duplication
 */
function normalizeHeaders(rows) {
  // Map header name variants to canonical names
  const headerMap = {
    // No
    'no': 'No',
    // Model variants
    'model no.': 'Model No.',
    // OS
    'os': 'OS',
    // Source mapping
    'source': 'Source',
    'occurr. type': 'Source',
    // CSC
    'csc': 'CSC',
    // Category
    'category': 'Category',
    // Application Name
    'application name': 'Application Name',
    'application_name': 'Application Name',
    'app name': 'Application Name',
    // Application Type
    'application type': 'Application Type',
    'application_type': 'Application Type',
    'app type': 'Application Type',
    // content
    'content': 'content',
    // Main Type
    'main type': 'Main Type',
    'main_type': 'Main Type',
    // Sub Type
    'sub type': 'Sub Type',
    'sub_type': 'Sub Type',
    // Questioned Date
    'questioned_date': 'Date',
    'questioned date': 'Date',
    'date': 'Date',
    // Status
    'status': 'Status',
    // Platform
    'platform': 'S/W Ver.',
    's/w ver.': 'S/W Ver.',
    's/w_ver.': 'S/W Ver.',
  };

  // canonical columns you expect in the downstream processing
  const canonicalCols = ['No', 'Source', 'Date', 'Status', 'S/W Ver.', 'Model No.', 'OS', 'CSC', 'Category', 'Application Name', 'Application Type', 'content', 'Main Type', 'Sub Type', 'Module', 'Sub-Module', 'AI Insight'];

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

    // Transform Platform/S/W Ver. column
    if (out['S/W Ver.']) {
      // Platform column has data like TP1A.220624.014.E236BXXS5CWL1 or BP2A.250605.031.A3.S938BXXU5BYI3
      // Keep only the last 13 characters
      const val = String(out['S/W Ver.']).trim();
      out['S/W Ver.'] = val.slice(-13);
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
  const expectedHeaderKeywords = ['model_no', 'os', 'csc', 'category', 'application_name', 'content', 'main_type', 'sub_type', '3rd party/native', 'model no.', 'application name', 'main type', 'sub type']; // input headers (lowercase checks)
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
  id: 'BetaUTVoc',
  expectedHeaders: ['No', 'Source', 'Date', 'Status', 'S/W Ver.', 'Model No.', 'OS', 'CSC', 'Category', 'Application Name', 'Application Type', 'content', 'Main Type', 'Sub Type', 'Module', 'Sub-Module', 'Issue Type', 'Sub-Issue Type', 'AI Insight'],

  validateHeaders(rawHeaders) {
    // Check if required fields are present
    const required = ['content'];
    return required.some(header =>
      rawHeaders.includes(header) ||
      rawHeaders.some(h => h.toLowerCase().trim() === header.toLowerCase().trim())
    );
  },

  transform(rows) {
    // Apply normalization using the local normalizeHeaders function
    let transformedRows = normalizeHeaders(rows);

    // Clean content field of Excel artifacts
    transformedRows = transformedRows.map(row => {
      const cleanedRow = { ...row };
      if (cleanedRow.content) {
        cleanedRow.content = cleanedRow.content
          .replace(/_x000d_/g, '') // Remove Excel line break artifacts
          .replace(/\n+/g, ' ') // Replace multiple newlines with space
          .trim();
      }

      return cleanedRow;
    });

    return transformedRows;
  },

  // buildPrompt(rows) {
  //   // Send only content field to AI for analysis
  //   const aiInputRows = rows.map(row => ({
  //     content: row.content || ''
  //   }));
  //   return promptTemplate.replace('{INPUTDATA_JSON}', JSON.stringify(aiInputRows, null, 2));
  // },


  // added by vandana.ojha
  buildPrompt(rows, ragContexts = []) {

    // Build RAG context string — injected into {RAG_CONTEXT} placeholder in the prompt template.
    // Includes all fields that RAG provides: Module, Sub-Module, Issue Type, Sub-Issue Type.
    let ragSection = "";
    let hasAnyContext = false;

    rows.forEach((row, index) => {
      const matches = ragContexts[index] || [];
      if (matches.length > 0) {
        hasAnyContext = true;
        ragSection += `\n### Row ${index + 1} — Historical Similar Issues\n`;
        matches.forEach((m, i) => {
          ragSection += `Issue ${i + 1}:
  Content: ${m.Content || m.Title || ""}
  Problem: ${m.Problem || m.Content || m.Title || ""}
  Module: ${m.Module || ""}
  Sub-Module: ${m["Sub Module"] || ""}
  Issue Type: ${m["Issue Type"] || ""}
  Sub-Issue Type: ${m["Sub Issue Type"] || ""}
  Frequency: ${m.frequency || 1} similar issue(s) in history
`;
        });
      }
    });

    if (!ragSection) {
      ragSection = "No historical matches found. Use fallback definitions.";
    }

    // /no_think disables qwen3 chain-of-thought reasoning (~200-500 hidden tokens per call).
    // ON  when RAG context present — classification is guided, LLM only needs to format + write insight.
    // OFF when RAG absent          — LLM must reason everything from scratch, thinking helps quality.
    const thinkPrefix = hasAnyContext ? '/no_think\n' : '';

    // Build input rows — only send content field as that's what this processor classifies from
    const aiInputRows = rows.map(row => ({
      content: row.content || ''
    }));

    // Inject both placeholders into the prompt template
    return thinkPrefix + promptTemplate
      .replace('{RAG_CONTEXT}', ragSection)
      .replace('{INPUTDATA_JSON}', JSON.stringify(aiInputRows));
  },
  

  formatResponse(aiResult, originalRows) {
    let aiRows;

    if (typeof aiResult === 'object' && aiResult !== null) {
      aiRows = aiResult;
    } else if (typeof aiResult === 'string') {
      let text = aiResult.trim();

      // ── JSON repair: fix ["key":"val"] → [{"key":"val"}] ──────────────
      if (/^\[\s*"/.test(text)) {
        text = text.replace(/\[\s*"/g, '[{"').replace(/,\s*\n\s*"/g, ',\n{"').replace(/"\s*,\s*"/g, '","');
      }
      // ──────────────────────────────────────────────────────────────────

      try {
        aiRows = JSON.parse(text);
      } catch (e) {
        const firstBracket = text.indexOf('[');
        const lastBracket = text.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket > firstBracket) {
          try {
            aiRows = JSON.parse(text.substring(firstBracket, lastBracket + 1));
          } catch (e2) {
            return [{ error: `Failed to parse AI response: ${text.substring(0, 200)}...` }];
          }
        } else {
          return [{ error: `Invalid AI response format: ${text.substring(0, 200)}...` }];
        }
      }
    } else {
      return [{ error: `Unexpected AI response type: ${typeof aiResult}` }];
    }

    // Handle different response formats: unwrap objects containing arrays
    if (!Array.isArray(aiRows) && typeof aiRows === 'object') {
      const possibleKeys = ['data', 'result', 'response', 'output', 'items', 'records'];
      for (const key of possibleKeys) {
        if (aiRows[key] && Array.isArray(aiRows[key])) {
          aiRows = aiRows[key];
          break;
        }
      }
      if (!Array.isArray(aiRows)) {
        const expectedFields = ['Module', 'Sub-Module', 'Issue Type', 'Sub-Issue Type', 'AI Insight'];
        const hasExpectedFields = expectedFields.some(field => aiRows.hasOwnProperty(field));
        if (hasExpectedFields) {
          aiRows = [aiRows];
        } else {
          return [{ error: `AI response is not an array and doesn't contain expected fields: ${typeof aiRows} - ${Object.keys(aiRows).slice(0, 5).join(', ')}...` }];
        }
      }
    }

    if (!Array.isArray(aiRows)) {
      return [{ error: `AI response is not an array: ${typeof aiRows}` }];
    }

    // ── Row count mismatch guard ───────────────────────────────────────
    // BetaUTVoc uses content as its key field (not Title/Problem)
    const normalise = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 80);

    let resolvedAiRows;
    if (aiRows.length === originalRows.length) {
      resolvedAiRows = aiRows;
    } else {
      console.warn(`[BetaUTVoc formatResponse] Row count mismatch: AI=${aiRows.length} vs input=${originalRows.length}. Using fuzzy match.`);
      resolvedAiRows = originalRows.map((origRow) => {
        // BetaUTVoc does not send content back in AI output — match by index position
        // within the available AI rows (best effort when counts differ)
        const origIdx = originalRows.indexOf(origRow);
        return aiRows[origIdx] || {
          Module: '', 'Sub-Module': '', 'Issue Type': '', 'Sub-Issue Type': '', 'AI Insight': ''
        };
      });
    }
    // ──────────────────────────────────────────────────────────────────

    const expectedFields = ['Module', 'Sub-Module', 'Issue Type', 'Sub-Issue Type', 'AI Insight'];

    const mergedRows = resolvedAiRows.map((aiRow, index) => {
      if (!aiRow) aiRow = {};
      const original = originalRows[index] || {};
      const isValidAiRow = expectedFields.every(field => aiRow.hasOwnProperty(field));
      if (!isValidAiRow) {
        console.warn(`AI row ${index} missing expected fields. Available:`, Object.keys(aiRow));
      }
      return {
        'No': original['No'] || original['S/N'] || '',
        'Source': original['Source'] || '',
        'Date': original['Date'] || '',
        'Status': original['Status'] || '',
        'S/W Ver.': original['S/W Ver.'] || '',
        'Model No.': (original['Model No.'] && /\[OS Beta\]/i.test(String(original['Model No.'])))
          ? (original['S/W Ver.'] && typeof original['S/W Ver.'] === 'string' && original['S/W Ver.'].length >= 5 ? 'SM-' + original['S/W Ver.'].substring(0, 5) : '')
          : (original['Model No.'] || ''),
        'OS': original['OS'] || '',
        'CSC': original['CSC'] || '',
        'Category': original['Category'] || '',
        'Application Name': original['Application Name'] || '',
        'Application Type': original['Application Type'] || '',
        'content': original['content'] || '',
        'Main Type': original['Main Type'] || '',
        'Sub Type': original['Sub Type'] || '',
        'Module': aiRow['Module'] || '',
        'Sub-Module': aiRow['Sub-Module'] || aiRow['Sub Module'] || '',
        'Issue Type': aiRow['Issue Type'] || '',
        'Sub-Issue Type': aiRow['Sub-Issue Type'] || '',
        'AI Insight': aiRow['AI Insight'] || ''
      };
    });

    return mergedRows;
  },

  // Returns column width configurations for Excel export
  getColumnWidths(finalHeaders) {
    return finalHeaders.map((h, idx) => {
      if (['content', 'AI Insight'].includes(h)) return { wch: 41 };
      if (['Application Name', 'Source'].includes(h)) return { wch: 25 };
      if (['No', 'Model No.', 'OS', 'CSC', 'Date', 'Status', 'S/W Ver.'].includes(h)) return { wch: 15 };
      if (['Category', 'Application Type', 'Main Type', 'Sub Type', 'Module', 'Sub-Module', 'Issue Type', 'Sub-Issue Type'].includes(h)) return { wch: 15 };
      if (h === 'error') return { wch: 15 };
      return { wch: 20 };
    });
  },

  // Excel reading function used by server.js
  readAndNormalizeExcel: readAndNormalizeExcel
}
;
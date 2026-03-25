const xlsx = require('xlsx');
const promptTemplate = require('../prompts/globalvocplm');

/**
 * Shared header normalization utility - eliminates code duplication
 */
function normalizeHeaders(rows) {
  // Map header name variants to canonical names
  const headerMap = {

    // Model variants
    'model no.': 'Model No.',
    'dev. mdl. name/item name': 'Model No.',
    'dev mdl name': 'Model No.',
    'device model': 'Model No.',
    'case code': 'Case Code',
    'plm code': 'Case Code',
    'plm code': 'Case Code',

    // S/W Ver variants
    's/w ver.': 'S/W Ver.',
    'version occurred': 'S/W Ver.',

    // Title variants
    'title': 'Title',

    // Problem variants
    'problem': 'Problem',
    'issue': 'Problem',

    // Progr.Stat. variants
    'progr.stat.': 'Progr.Stat.',
    'progress status': 'Progr.Stat.',
    'status': 'Progr.Stat.',


    // Source (usually calculated, but if present)
    'source': 'Source',
    'occurr. type': 'Source',

    // Additional columns from your Excel file to preserve
    'reg. by id': 'Reg. by ID',
    'registered date': 'Registered Date',
    'problem type': 'Problem Type',
    'priority': 'Priority',
    'occurr. freq.': 'Occurr. Freq.',
    'feature': 'Feature',

    // Module variants
    'module': 'Module',
    'sub-module': 'Sub-Module',
    'issue type': 'Issue Type',
    'sub-issue type': 'Sub-Issue Type'
  };

  // canonical columns you expect in the downstream processing
  const canonicalCols = ['Case Code', 'Source', 'Model No.', 'Progr.Stat.', 'S/W Ver.', 'Title', 'Priority', 'Occurr. Freq.', 'Problem', 'Module', 'Sub-Module', 'Issue Type', 'Sub-Issue Type', 'Ai Summary', 'Severity', 'Severity Reason'];

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

    // Source is extracted cleanly in Python now, so just ensure it's picked up if available
    let source = out['Source'] || '';
    if (!source) {
      source = 'Unknown';
    }
    out['Source'] = source;

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
  const expectedHeaderKeywords = ['Case Code', 'Model No.', 'Progr.Stat.', 'S/W Ver.', 'Title', 'Problem']; // lowercase checks
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
  const dataRows = sheetRows.slice(headerRowIndex + 1).filter(r => {
    // Filter out completely empty rows
    if (!Array.isArray(r)) return false;
    return r.some(cell => cell !== undefined && cell !== null && String(cell).trim() !== '');
  });

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

function extractModelFromTitle(title) {
  if (!title || typeof title !== 'string') return null;
  const smMatch = title.match(/SM-[a-zA-Z0-9]+/i);
  if (smMatch) {
    return smMatch[0].toUpperCase();
  }
  const patternMatch = title.match(/[a-zA-Z]\d{3}[a-zA-Z]/i);
  if (patternMatch) {
    return 'SM-' + patternMatch[0].toUpperCase();
  }
  return null;
}

// normalizeRows - now just calls the shared function
function normalizeRows(rows) {
  return normalizeHeaders(rows);
}


module.exports = {
  id: 'UTportal',
  expectedHeaders: ['Case Code', 'Source', 'Model No.', 'Progr.Stat.', 'S/W Ver.', 'Title', 'Priority', 'Occurr. Freq.', 'Problem', 'Module', 'Sub-Module', 'Issue Type', 'Sub-Issue Type', 'Ai Summary', 'Severity', 'Severity Reason'],

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
    // Source extraction is now handled inside normalizeHeaders
    return normalizeHeaders(rows);
  },

  // buildPrompt(rows) {
  //   // Send only content fields to AI for analysis
  //   const aiInputRows = rows.map(row => ({
  //     Title: row.Title || '',
  //     Problem: row.Problem || ''
  //   }));
  //   return promptTemplate.replace('{INPUTDATA_JSON}', JSON.stringify(aiInputRows, null, 2));
  // },

  // added by vandana.ojha
  buildPrompt(rows, ragContexts = []) {

    // Build RAG context string — injected into {RAG_CONTEXT} placeholder in the prompt template.
    // Includes all fields that RAG provides: Module, Sub-Module, Issue Type, Sub-Issue Type, Severity.
    let ragSection = "";
    let hasAnyContext = false;

    rows.forEach((row, index) => {
      const matches = ragContexts[index] || [];
      
      if (matches.length > 0) {
        hasAnyContext = true;
        ragSection += `\n### Row ${index + 1} — Historical Similar Issues\n`;
        matches.forEach((m, i) => {
          ragSection += `Issue ${i + 1}:
  Title: ${m.Title || ""}
  Problem: ${m.Problem || m.Title || ""}
  Module: ${m.Module || ""}
  Sub-Module: ${m["Sub Module"] || ""}
  Issue Type: ${m["Issue Type"] || ""}
  Sub-Issue Type: ${m["Sub Issue Type"] || ""}
  Severity: ${m.Severity || ""}
  Frequency: ${m.frequency || 1} similar issue(s) in history
`;
        });
      }
    });

    if (!ragSection) {
      ragSection = "No historical matches found. Use fallback definitions.";
    }

    // /no_think disables qwen3 chain-of-thought reasoning (~200-500 hidden tokens per call).
    // ON  when RAG context present — classification is guided, LLM only needs to format + write summary.
    // OFF when RAG absent          — LLM must reason everything from scratch, thinking helps quality.
    const thinkPrefix = hasAnyContext ? '/no_think\n' : '';

    // Build input rows — only send fields the LLM needs to generate outputs for
    const aiInputRows = rows.map(row => ({
      Title: row.Title || '',
      Problem: row.Problem || ''
    }));

    // Inject both placeholders into the prompt template
    return thinkPrefix + promptTemplate
      .replace('{RAG_CONTEXT}', ragSection)
      .replace('{INPUTDATA_JSON}', JSON.stringify(aiInputRows, null, 2));
  },

  /**
   * Normalize frequency values to lowercase for consistent comparison
   */
  normalizeFrequency(freq) {
    if (!freq) return "";
    return freq.toString().trim().toLowerCase();
  },


  formatResponse(aiResult, originalRows) {
    let aiRows;

    // Field order must match the OUTPUT spec in prompts/globalvocplm.js exactly.
    const FIELD_ORDER = ['Title', 'Problem', 'Module', 'Sub-Module', 'Issue Type', 'Sub-Issue Type', 'Ai Summary', 'Severity', 'Severity Reason'];

    function repairPositionalJson(text) {
      const objects = text.match(/\{([^{}]+)\}/g);
      if (!objects) return null;
      if (/\"[^\"]+\"\s*:/.test(text)) return null;
      try {
        const result = objects.map(obj => {
          const values = [...obj.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]);
          const row = {};
          values.forEach((v, i) => { if (i < FIELD_ORDER.length) row[FIELD_ORDER[i]] = v; });
          return row;
        });
        return result.length > 0 ? result : null;
      } catch (e) { return null; }
    }

    if (typeof aiResult === 'object' && aiResult !== null) {
      aiRows = aiResult;
    } else if (typeof aiResult === 'string') {
      let text = aiResult.trim();

      // ── Repair 1: missing { brace — ["key":"val"] → [{"key":"val"}] ──
      if (/^\[\s*"/.test(text)) {
        text = text
          .replace(/\[\s*"/g, '[{"')
          .replace(/,\s*\n\s*"/g, ',\n{"')
          .replace(/"\s*,\s*"/g, '","');
      }

      // ── Repair 2: positional values — [{"val1","val2"}] → [{"Title":"val1",...}]
      const positional = repairPositionalJson(text);
      if (positional) { aiRows = positional; }
      else {
        try {
          aiRows = JSON.parse(text);
        } catch (e) {
          const firstBracket = text.indexOf('[');
          const lastBracket = text.lastIndexOf(']');
          if (firstBracket !== -1 && lastBracket > firstBracket) {
            const jsonStr = text.substring(firstBracket, lastBracket + 1);
            try {
              aiRows = JSON.parse(jsonStr);
            } catch (e2) {
              return [{ error: `Failed to parse AI response: ${text.substring(0, 200)}...` }];
            }
          } else {
            return [{ error: `Invalid AI response format: ${text.substring(0, 200)}...` }];
          }
        }
      }
    } else {
      return [{ error: `Unexpected AI response type: ${typeof aiResult}` }];
    }

    // Ensure aiRows is an array
    if (!Array.isArray(aiRows)) {
      return [{ error: `AI response is not an array: ${typeof aiRows}` }];
    }

    // ── Row count mismatch guard ───────────────────────────────────────────
    // The LLM occasionally skips rows it cannot classify, returning fewer
    // objects than it received. Mapping purely by array index then causes
    // every subsequent row to shift, producing blank or mismatched output.
    //
    // Strategy: if counts match, map by index (fast path).
    // If counts differ, attempt to match each AI row to its original row
    // by comparing normalised Title/Problem text. Rows with no match are
    // written out with empty AI fields rather than shifted incorrectly.
    // ──────────────────────────────────────────────────────────────────────
    const normalise = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 60);

    let resolvedAiRows;
    if (aiRows.length === originalRows.length) {
      // Fast path — counts match, trust index alignment
      resolvedAiRows = aiRows;
    } else {
      // Slow path — counts differ, match by title/problem similarity
      console.warn(`[formatResponse] Row count mismatch: AI returned ${aiRows.length} rows for ${originalRows.length} input rows. Attempting fuzzy match.`);
      resolvedAiRows = originalRows.map((origRow) => {
        const origTitle   = normalise(origRow.Title);
        const origProblem = normalise(origRow.Problem);

        // Find the AI row whose Title or Problem best matches this original row
        const match = aiRows.find(ai => {
          const aiTitle   = normalise(ai.Title);
          const aiProblem = normalise(ai.Problem);
          return (aiTitle && origTitle && aiTitle === origTitle) ||
                 (aiProblem && origProblem && aiProblem === origProblem) ||
                 (aiTitle && origTitle && origTitle.startsWith(aiTitle.substring(0, 30)));
        });

        // Return matched AI row, or a placeholder so the original row is preserved
        return match || {
          Title: origRow.Title || '',
          Problem: origRow.Problem || '',
          Module: '',
          'Sub-Module': '',
          'Issue Type': '',
          'Sub-Issue Type': '',
          'Ai Summary': '',
          Severity: '',
          'Severity Reason': ''
        };
      });
    }

    // Merge AI results with original core identifiers
    const mergedRows = resolvedAiRows.map((aiRow, index) => {
      const original = originalRows[index] || {};

      const titleText = original['Title'] || aiRow['Title'] || '';
      const extractedModel = extractModelFromTitle(titleText);

      // Create the base merged row
      return {
        'Case Code': original['Case Code'] || '',
        'Source': original['Source'] || '',
        'Model No.': extractedModel || ((original['Model No.'] && /\[OS Beta\]/i.test(String(original['Model No.'])))
          ? (original['S/W Ver.'] && typeof original['S/W Ver.'] === 'string' && original['S/W Ver.'].length >= 5 ? 'SM-' + original['S/W Ver.'].trim().substring(0, 5) : '')
          : (original['Model No.'] || '')),
        'Progr.Stat.': original['Progr.Stat.'] || '',
        'S/W Ver.': original['S/W Ver.'] || '',
        'Title': aiRow['Title'] || '',
        'Priority': original['Priority'] || '',
        'Occurr. Freq.': original['Occurr. Freq.'] || '',
        'Problem': aiRow['Problem'] || '',
        'Module': aiRow['Module'] || '',
        'Sub-Module': aiRow['Sub-Module'] || '',
        'Issue Type': aiRow['Issue Type'] || '',
        'Sub-Issue Type': aiRow['Sub-Issue Type'] || '',
        'Ai Summary': aiRow['Ai Summary'] || '',
        'Severity': aiRow['Severity'] || '',
        'Severity Reason': aiRow['Severity Reason'] || ''
      };
    });

    return mergedRows;
  },

  // Returns column width configurations for Excel export
  getColumnWidths(finalHeaders) {
    return finalHeaders.map((h, idx) => {
      if (['Title', 'Problem', 'Ai Summary', 'Severity Reason'].includes(h)) return { wch: 41 };
      if (['Source', 'Model No.'].includes(h)) return { wch: 20 };
      if (['S/W Ver.', 'Progr.Stat.', 'Issue Type', 'Sub-Issue Type', 'Case Code'].includes(h)) return { wch: 15 };
      if (h === 'Module' || h === 'Sub-Module') return { wch: 15 };
      if (h === 'error') return { wch: 15 };
      return { wch: 20 };
    });
  },

  // Excel reading function used by server.js
  readAndNormalizeExcel: readAndNormalizeExcel
}
;
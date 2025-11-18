const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx-js-style');

// Function to get "Model No." from sheet
function getModelFromSheet(ws) {
  if (!ws || !ws['!ref']) return '';
  const range = xlsx.utils.decode_range(ws['!ref']);
  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const addr = xlsx.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr];
      if (!cell || !cell.v) continue;
      const txt = String(cell.v).trim();
      if (/model\s*no/i.test(txt) || /^model\s*no\.?$/i.test(txt) || /^model$/i.test(txt)) {
        // take the cell below if present
        const belowAddr = xlsx.utils.encode_cell({ r: R + 1, c: C });
        const belowCell = ws[belowAddr];
        if (belowCell && typeof belowCell.v !== 'undefined') return String(belowCell.v).trim();
        // fallback: try to read from column E row 1 (E1) if above not found
        try {
          const fallback = ws['E1'] && ws['E1'].v ? String(ws['E1'].v).trim() : '';
          if (fallback) return fallback;
        } catch (e) {}
      }
    }
  }
  // fallback heuristics: if there is a header row with \"Model\" column, try sheet_to_json
  try {
    const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
    if (rows.length) {
      const first = rows[0];
      if (first['Model'] && String(first['Model']).trim()) return String(first['Model']).trim();
      if (first['Model No.'] && String(first['Model No.']).trim()) return String(first['Model No.']).trim();
      if (first['Model No'] && String(first['Model No']).trim()) return String(first['Model No']).trim();
    }
  } catch (e) {}
  return '';
}

// Main function
function extractModels() {
  const dlDir = path.join(__dirname, 'downloads');
  if (!fs.existsSync(dlDir)) {
    console.log('Downloads folder not found.');
    return;
  }
  const files = fs.readdirSync(dlDir).filter(f => /\.(xlsx|xls)$/i.test(f));
  console.log(`Found ${files.length} Excel files:`, files);

  files.forEach(file => {
    try {
      const wb = xlsx.readFile(path.join(dlDir, file));
      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const modelFromFile = getModelFromSheet(ws) || 'NOT FOUND';
      console.log(`File: ${file} -> Model No.: ${modelFromFile}`);
    } catch (err) {
      console.log(`File: ${file} -> Error: ${err.message}`);
    }
  });
}

extractModels();

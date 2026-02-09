// list_models.js
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

// Debug configuration
const DEBUG = false;

const downloads = path.join(__dirname, 'downloads','beta_user_issues'); // adjust if needed
if (!fs.existsSync(downloads)) { console.error('path not found:', downloads); process.exit(1); }

const files = fs.readdirSync(downloads).filter(f => /\.(xlsx|xls|csv)$/i.test(f));
const found = new Set();
files.forEach(fname => {
  try {
    const wb = xlsx.readFile(path.join(downloads, fname));
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    rows.forEach(r => {
      const candidates = ['Model No.','Model','modelFromFile','ModelNo','Model_No','model','model_no'];
      let raw = '';
      for (const c of candidates) { if (r[c] && String(r[c]).trim() !== '') { raw = r[c]; break; } }
      if (!raw) {
        for (const k of Object.keys(r)) { if (String(r[k]).trim() !== '') { raw = r[k]; break; } }
      }
      if (raw) found.add(String(raw).trim());
    });
  } catch (e) {
    console.warn('skip', fname, e.message);
  }
});
if (DEBUG) console.log('Files scanned:', files.length);
if (DEBUG) console.log('Unique raw model strings:\n', Array.from(found).sort().join('\n'));

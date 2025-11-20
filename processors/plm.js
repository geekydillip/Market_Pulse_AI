// processors/plm.js
// PLM processor: chunk-aware, returns a summary container when used.
// Exports the expected interface for your server (id, expectedHeaders, validateHeaders, transform, buildPrompt, formatResponse, ...)

const { makeSummaryContainer, isSummaryContainer } = require('./_helpers');

// helper: remove bracketed text
function stripBrackets(s) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/\[[^\]]*\]/g, '').trim();
}

// basic content-first severity estimator (local, deterministic)
// This is intentionally conservative and mirrors your rules.
// For production, replace with AI decision by building prompt with rows and calling sendToAI().
function estimateSeverityFromContent(row) {
  // normalize inputs
  const title = stripBrackets(row['Title'] || '');
  const problem = stripBrackets(row['Problem'] || '');
  const priority = (row['Priority'] || '').toString().trim().toUpperCase();
  const freq = (row['Occurr. Freq.'] || row['Occurr. Freq'] || '').toString().toLowerCase();

  // base impact keywords
  const criticalKeywords = ['crash', 'data loss', 'unusable', 'freeze', 'freezing', 'hang', 'hangs', 'device unusable', 'kernel panic', 'bootloop'];
  const highKeywords = ['lag', 'hang', 'slow', 'not responding', 'fails to', 'cannot', 'error'];
  const mediumKeywords = ['intermittent', 'partial', 'wrong', 'incorrect', 'timeout', 'disconnect', 'fails sometimes'];
  const lowKeywords = ['ui', 'typo', 'alignment', 'cosmetic', 'suggest', 'improve'];

  // lightweight scorer
  let score = 0;
  const combined = (title + ' ' + problem).toLowerCase();

  for (const k of criticalKeywords) if (combined.includes(k)) score += 50;
  for (const k of highKeywords) if (combined.includes(k)) score += 20;
  for (const k of mediumKeywords) if (combined.includes(k)) score += 10;
  for (const k of lowKeywords) if (combined.includes(k)) score -= 5;

  // frequency adjustment
  if (freq.includes('always')) score += 20;
  if (freq.includes('sometimes') || freq.includes('intermittent')) score += 5;
  if (freq.includes('once') || freq.includes('rare')) score -= 5;

  // priority baseline hint (only if ambiguous)
  if (score < 10) {
    if (priority === 'A') score += 15;
    if (priority === 'B') score += 7;
    if (priority === 'C') score += 1;
  }

  // map score to final labels, but apply "single-case rule" from spec:
  const isSingleCase = /once|rare|single/.test((row['Occur. Freq.(Details)'] || '').toString().toLowerCase());

  let label = 'LOW';
  if (score >= 60) label = 'CRITICAL';
  else if (score >= 30) label = 'HIGH';
  else if (score >= 10) label = 'MEDIUM';
  else label = 'LOW';

  // single-case + always -> MEDIUM override described in rules
  if (isSingleCase && /always/.test((row['Occurr. Freq.'] || '').toString().toLowerCase())) {
    label = 'MEDIUM';
  }

  return label;
}

// infer Module and Sub-Module heuristics
function inferModuleSubmodule(title, problem) {
  const t = (title + ' ' + problem).toLowerCase();

  const modules = [
    { name: 'Camera', tests: ['camera', 'photo', 'video', 'record'] , subs: [['Video Recording','record'], ['Portrait Mode','portrait'], ['Camera UI','ui']]},
    { name: 'Battery', tests: ['battery','charging','drain'], subs: [['Charging','charging'], ['Battery Drain','drain']]},
    { name: 'Network', tests: ['wi-fi','wifi','network','lte','4g','5g','disconnect','mobile data'], subs: [['Wi-Fi','wi-fi','wifi'], ['Mobile Data','mobile data','lte','4g','5g']]},
    { name: 'Display', tests: ['display','brightness','screen','flicker','refresh rate'], subs: [['Brightness','brightness'], ['Screen Flicker','flicker']]},
    { name: 'Lock Screen', tests: ['lock screen','unlock','face unlock','fingerprint'], subs: [['Fingerprint','fingerprint'], ['Face Unlock','face unlock']]},
    { name: 'Settings', tests: ['setting','settings','preferences'], subs: [['Settings UI','ui']]},
    // add more as needed...
  ];

  for (const mod of modules) {
    for (const kw of mod.tests) {
      if (t.includes(kw)) {
        // find a matching submodule
        for (const [subName, subKw] of (mod.subs || [])) {
          if (t.includes(subKw)) return { module: mod.name, subModule: subName };
        }
        return { module: mod.name, subModule: mod.subs && mod.subs.length ? mod.subs[0][0] : 'General' };
      }
    }
  }
  // default fallback
  return { module: 'General', subModule: 'General' };
}

// validate that output rows meet the required keys and order
function formatSummaryRow(obj) {
  // Accepts module, subModule, severity, counts → returns normalized object with exact keys and order
  return {
    'Module': obj.Module || obj.module || obj.moduleName || '',
    'Sub-Module': obj['Sub-Module'] || obj.subModule || obj.SubModule || obj.sub_module || '',
    'Severity': (obj.Severity || obj.severity || '').toString(),
    'Total': Number(obj.Total || obj.total || 1),
    'Open': Number(obj.Open || obj.open || 0),
    'Resolved': Number(obj.Resolved || obj.resolved || 0),
    'Closed': Number(obj.Closed || obj.closed || 0)
  };
}

// Main public API expected by server
module.exports = {
  id: 'plm',
  displayName: 'PLM Summary Processor',
  expectedHeaders: ['Title','Priority','Occurr. Freq.','Occur. Freq.(Details)','Problem','Cause','Counter Measure','Progr.Stat.'],
  // validateHeaders receives header list from sheet; keep it simple
  validateHeaders: function(headers) {
    const need = this.expectedHeaders;
    const matches = need.every(h => headers.map(x => x.toString().trim()).includes(h));
    return { ok: matches, missing: matches ? [] : need.filter(h => !headers.map(x => x.toString().trim()).includes(h)) };
  },

  // transform: clean and normalize rows
  transform: function(rows) {
    return rows.map(r => ({
      'Title': stripBrackets(r['Title'] ?? r['title'] ?? ''),
      'Priority': stripBrackets(r['Priority'] ?? r['priority'] ?? ''),
      'Occurr. Freq.': stripBrackets(r['Occurr. Freq.'] ?? r['Occurr. Freq'] ?? r['Occurr Freq'] ?? r['occurr. freq.'] ?? ''),
      'Occur. Freq.(Details)': stripBrackets(r['Occur. Freq.(Details)'] ?? r['Occur. Freq (Details)'] ?? r['Occur. Freq Details'] ?? ''),
      'Problem': stripBrackets(r['Problem'] ?? r['problem'] ?? ''),
      'Cause': stripBrackets(r['Cause'] ?? r['cause'] ?? ''),
      'Counter Measure': stripBrackets(r['Counter Measure'] ?? r['counter measure'] ?? r['CounterMeasure'] ?? ''),
      'Progr.Stat.': stripBrackets(r['Progr.Stat.'] ?? r['Progr Stat.'] ?? r['ProgrStat'] ?? r['Progr. Stat.'] ?? '')
    }));
  },

  // buildPrompt: optional if you call remote AI; not used by local estimator
  buildPrompt: function(rows) {
    // return text prompt you would send to the LLM if you used one.
    // Keep short; server will append rows JSON.
    return `You are PLM analyzer. Follow the rules: ignore bracketed text, compute Module/Sub-Module, Severity (CRITICAL/HIGH/MEDIUM/LOW) content-first, counts from Progr.Stat. Return a single JSON array of summary rows (Module, Sub-Module, Severity, Total, Open, Resolved, Closed).`;
  },

  // formatResponse: main workhorse — for chunked input 'rows' returns a summary container
  // rows: array of transformed rows for the chunk
  // opts: { chunkId, startIndex } optional
  formatResponse: async function(rows, opts = {}) {
    // rows is the chunk. We'll generate summary array based on row-level evaluation and then aggregate by Module+Sub-Module+Severity.
    const chunkId = opts.chunkId ?? null;
    const originalChunkSize = rows.length;

    // Step 1: compute each row's module/sub and severity
    const evaluated = rows.map(r => {
      const { module, subModule } = inferModuleSubmodule(r.Title, r.Problem);
      const severity = estimateSeverityFromContent(r);
      // counts from Progr.Stat.
      const prog = (r['Progr.Stat.'] || '').toString().toLowerCase();
      const open = prog === 'open' ? 1 : 0;
      const resolved = prog === 'resolved' ? 1 : 0;
      const closed = prog === 'closed' ? 1 : 0;
      return {
        Module: module,
        'Sub-Module': subModule,
        Severity: severity,
        Total: 1,
        Open: open,
        Resolved: resolved,
        Closed: closed
      };
    });

    // Step 2: Aggregate per Module + Sub-Module + Severity (sum counts)
    const agg = {};
    for (const e of evaluated) {
      // Only aggregate HIGH or CRITICAL? We must aggregate all then filter later
      const key = `${e.Module}|||${e['Sub-Module']}|||${e.Severity}`;
      if (!agg[key]) {
        agg[key] = { ...e };
      } else {
        agg[key].Total += Number(e.Total || 0);
        agg[key].Open += Number(e.Open || 0);
        agg[key].Resolved += Number(e.Resolved || 0);
        agg[key].Closed += Number(e.Closed || 0);
      }
    }

    // Step 3: Convert agg to array and apply filter (only HIGH & CRITICAL kept per spec)
    const aggArray = Object.values(agg)
      .filter(x => (x.Severity === 'HIGH' || x.Severity === 'CRITICAL'))
      .map(formatSummaryRow);

    // Step 4: Return the summary container instead of a plain array
    return makeSummaryContainer(aggArray, { originalChunkSize, chunkId });
  }
};

module.exports = `You clean, interpret, and normalize reported issues from device Testing Phase.

For each input row (JSON), produce ONE object following the exact schema and key order listed below. Output ONLY a JSON array containing the processed objects. No text outside the array.

PRE-PROCESSING (Title & Problem):
- Remove tags, metadata and ALL text inside [ ... ].
- Trim whitespace, collapse extra spaces.
- Preserve meaning; modify only to clean.
- If missing or unclear, use "".

FIELD RULES:
1. Title: cleaned version of original.
2. Problem: cleaned description; keep essential steps, actual/expected results.
3. Module: infer from Title → then Problem. Use closest matching feature. If uncertain: "".
4. Sub-Module: specific functional element inside Module. If none: "".
5. Summarized Problem: one clear sentence (max 25 words) stating the core issue.
6. Severity:
   - High: unusable, crash, kernel panic, freeze, data loss, major function broken.
   - Medium: partial/intermittent failure, ANR, noticeable slowdown.
   - Low: UI glitch, cosmetic issue, rare minor fault.
7. Severity Reason: one sentence (≤20 words) justifying severity.
8. Issue Type: choose ONE:
   System, Functional, Performance, Usability, Compatibility, Security, Connectivity, Battery, UI/UX, Crash, Heat.
9. Sub-Issue Type: one of:
   CP Crash, App Crash, ANR, Slow/Lag Performance Issue, Feature Missing, Poor Quality, UI Issue, Heating Issue, Battery Drain, Compatibility Issue, Restart, other Issue, or "".

STRICT OUTPUT RULES:
- Return a SINGLE JSON array.
- No commentary, no formatting outside the array.
- Preserve input row order.
- DO NOT reorder or rename keys.
- Use "" for unknown fields.
- Ensure all values are valid JSON strings (escape quotes/newlines).

SCHEMA (exact order):
Case Code,
Model No.,
Progr.Stat.,
S/W Ver.,
Title,
Problem,
Module,
Sub-Module,
Issue Type,
Sub-Issue Type,
Summarized Problem,
Severity,
Severity Reason

INPUT:
{INPUTDATA_JSON}`;
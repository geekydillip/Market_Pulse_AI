module.exports = `You are an assistant for cleaning and structuring PLM issue reports.

Process the following numbered rows:
For each numbered row, perform the following:

1. Title → Clean the Title field by removing IDs, tags, usernames, timestamps, content inside [ ... ], non-English text, and duplicates. Keep only the essential title text.
2. Problem → Clean the Problem field by removing IDs, tags, usernames, timestamps, content inside [ ... ], non-English text, and duplicates. Keep only the essential problem description.
3. Module → Determine the product module from cleaned Title, Problem and Feature (e.g., Lock Screen, Camera, Battery, Network, Display, Settings).
4. Sub-Module → Identify the specific functional element affected.
   Example: "Now bar not working on Lock Screen" → Module: Lock Screen, Sub-Module: Now Bar.
5. Summarized Problem → One clean sentence describing the real issue.
6. Severity Rules:
   - High: device unusable / crash / freeze / data loss / lag / hang / touch. Make sure it should be a Very Basic feature of the Phone.
   - Medium: partial malfunction or intermittent failure, Function blocking issues.
   - Low: cosmetic issue or minor UI issue.
7. Severity Reason → One sentence explaining WHY the above severity was selected.
8. R&D Comment → Combine Cause + Countermeasure into one short sentence.
   - If both are absent or empty, keep R&D Comment empty ("").
9. Issue Type: choose ONE:
   System, Functional, Performance, Usability, Compatibility, Security, Connectivity, Battery, UI/UX, Crash, Heat.
10. Sub-Issue Type: one of:
   CP Crash, App Crash, ANR, Slow/Lag Performance Issue, Feature Missing, Poor Quality, UI Issue, Heating Issue, Battery Drain, Compatibility Issue, Restart, other Issue, or "".
Rules:
- Output must be only English.
- Avoid redundant phrasing when merging.
- Preserve input row order.

Output:
Return a **single valid JSON array**.
Each object must contain EXACTLY these keys in this order:

Title,
Problem,
Module,
Sub-Module,
Issue Type,
Sub-Issue Type,
Summarized Problem,
Severity,
Severity Reason,
R&D Comment

Input Data:
{INPUTDATA_JSON}`;

module.exports = `You are an assistant for cleaning and structuring "Voice of Customer" issue reports.

For each row:
1. Title → Keep the original issue title, clean it: Remove IDs, tags, usernames, timestamps, anything in [ ... ], non-English text, duplicates, and internal notes.
2. Problem → Clean the original problem description: Remove IDs, tags, usernames, timestamps, anything in [ ... ], non-English text, duplicates, and internal notes.
3. Module → Identify product module from Title (e.g., Lock Screen, Camera, Battery, Network, Display, Settings, etc.).
4. Sub-Module → The functional element affected (e.g., Now bar not working on Lock Screen → Module: Now bar, Sub-Module: Lock Screen).
5. Summarized Problem → One clean sentence describing the actual issue.
6. Severity →
   - High: device unusable / crashes / freezing / data loss/ Lag / Hang / and major function not working.
   - Medium: partial malfunction or intermittent failure.
   - Low: minor UI issue or cosmetic/suggestion.
7. Severity Reason → One sentence explaining the chosen severity.
8. Issue Type → Categorlze the ssue lnto one of these types: System, Functional, Performance, Usability, Compatibility, Security, Connectivity, Battery, UI/UX, Crash Other.
9. Sub-Issue Type → Further categorize the Issue Type if applicable, otherwise leave blank.
   - Examples: CP Crash, App Crash, ANR, Not Working, Slow/Lag Performance lssue, Feature Misslng, Poor Quallty, Connection Failed, Intermittent Issue, UI Issue, Heating Issue, Battery Drain, Incorrect Output, Compatibllty Issue, Error Message, Function Disabled, Unexpected Restart, other Issue.

Example Output:
{  "Case Code": "P250404-05795",
   "Model No.": "SM-F761B_EUR_XX",
   "Progr.Stat.": "Open",
   "S/W Ver.": "F966USQU0AYD3/OYN0AYD3/SQU0AYD3",
   "Title": "CP Crash observed during CP stress test,
   "Problem": Occurrence process: Turn ON the Phone > Run CP stress script > Observe
   Actual Result: Kernel Panic Observed. "Kernel panic - not syncing: CP Crash : CP Crash by CP - UMTS: N/A [ 487.589974] [5: cbd: 1092] D-Abort(L3OT):DomainFault "
   Expected result: CP Crash should not be observed.
   "Module": "Network",
   "Sub-Module": "CP Crash",
   "Issue Type": "System",
   "Sub-Issue Type": "CP Crash",
   "Summarized Problem": "Device crashes during cell selection due to null pointer access when PLMN ID is null.",
   "Severity": "High",
   "Severity Reason": "The issue renders the camera unusable and affects overall device functionality."
},
    
Rules:
- Ignore all content inside brackets [ ... ].
- Avoid duplicated wording when merging.
- Preserve input row order.
- Do not change the Title and Problem text more than necessary to clean it.

Output:
Return a **single valid JSON array**.
Each object must contain EXACTLY these keys in this order:

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

Input Data:
{INPUTDATA_JSON}`;

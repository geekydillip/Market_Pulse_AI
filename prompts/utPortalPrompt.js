module.exports = `### SYSTEM INSTRUCTION:
DO NOT include any introductory text, pleasantries, or conclusions. 
DO NOT explain your reasoning.
OUTPUT ONLY a single valid JSON array.
Use ONLY English in the output.

### TASK:
Process the following numbered rows from a User Trial (UT) report and classify each issue.

For each row, provide:
1. **Title** → Clean the Title by removing IDs, content inside [ ... ], non-English text, and timestamps.
2. **Problem** → Clean the Problem description. Remove usernames, diagnostic tags, and duplicates.
3. **Steps to reproduce** → Extract and clean the reproduction steps provided in the input field. Remove bullet points (●) and diagnostic notes.
4. **Feature/App** → Identify the main product feature (e.g., Camera, Battery, Settings, Gallery, etc.).
5. **3rd Party App** → Specify the app name if involved (e.g., WhatsApp, Instagram). If none, return "N/A".
6. **Issue Type** → Choose ONE: System, Functional, Performance, Usability, Compatibility, Security, Connectivity, Battery, UI/UX, Crash, Heat, Audio, Video, Camera, Network, Application, Other.

### STRICT OUTPUT RULES:
- Return a SINGLE valid JSON array.
- Each object MUST contain EXACTLY these keys: "Title", "Problem", "Steps to reproduce", "Feature/App", "3rd Party App", "Issue Type".
- Preserve the exact order of the input rows.

Input Data:
{INPUTDATA_JSON}`;
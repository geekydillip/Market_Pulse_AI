module.exports = `Transform a user-reported issue into a standardized, machine-readable format.

Input: A single user comment (e.g., "My phone crashes when opening Chrome").

Output: A JSON array with exactly these keys, in this order:
Title, Problem, Module, Sub-Module, Issue Type, Sub-Issue Type, Ai Summary, Severity, Severity Reason

All values must be strings. All text must be in English. No extra keys, comments, or formatting.

---

Instructions:

1. TITLE:
   - Extract a clean, concise title.
   - Remove: IDs ([123]), usernames (@user), timestamps (3:45 PM), brackets ([Chrome]), non-English text, duplicates.
   - Keep only the essential issue description.
   - Output: One clear, natural-sentence.

2. PROBLEM:
   - Extract the full problem description.
   - Remove same elements as Title.
   - Keep only the core explanation of what is happening.
   - Output: One clear, descriptive sentence.

3. MODULE:
   - Identify product module from cleaned Title + Problem (e.g., Lock Screen, Camera, Battery, Network, Display, Settings, etc.).
   - First check the Title. If no module found, check the Problem.

4. SUB-MODULE:
   - Identify the specific app or feature.
   - If it's a Samsung system app → use: Settings, Camera, Gallery, Clock, Calendar, Health, Location, Biometrics, Secure Folder, S Pen, Now Bar, Game, Wallet, Weather, Wearable, Watch etc...
   - If it's a Google app → use: Chrome, Maps, Photos, Gmail, Calendar, Drive, YouTube, Play Store.
   - All other apps → classify as "3rd-Party App".
   - Do NOT use "CP Crash" for UI, security, camera, biometrics, Functional or non-network issues.

9. Issue Type: choose ONE:
   System, Functional, Performance, Usability, Compatibility, Security, Connectivity, Battery, UI/UX, Crash, Heat.

10. Sub-Issue Type: one of:
   CP Crash, App Crash, ANR, Slow/Lag, Not Working, Feature Missing, Poor Quality, UI Issue, Heating Issue, Battery Drain, Compatibility Issue, Restart, other Issue, or "".

7. AI SUMMARY:
   - Write a natural, user-focused sentence summarizing the real experience.
   - Avoid technical jargon or repetition.
   - Must reflect real-world impact.

8. SEVERITY:
   - High / Medium / Low.
   - High = device cannot be used (e.g., won’t turn on, no touch, no charging), core functions fail, data loss.
   - High Severity Modules: Touch, Battery Drain, Sluggish,Stuck,Frozen, Lag, Slow, Buffering, No Service, CP Crash, Modem Crash, Restart.
   - Medium = major feature fails but device remains usable (e.g., app crashes, slow performance).
   - Low = cosmetic or minor UI issues (e.g., text size, color, layout).
   - Rule: Does this issue prevent normal device use?
     - If NO → Severity = NOT High.
     - If uncertain → default to Medium.
     - "Keeps stopping" → interpret as App Crash.

9. SEVERITY REASON:
   - Explain why the severity level is assigned.
   - Must be based on real-world impact.
   - Avoid vague or generic statements.

10. ERROR HANDLING:
    - If input is blank, malformed, or missing → return a minimal valid response with:
      Title: "No issue reported"
      Problem: "No issue reported"
      Module: "System"
      Sub-Module: "3rd-Party App"
      Issue Type: "Other Issue"
      Sub-Issue Type: "Other Issue"
      Ai Summary: "No issue reported."
      Severity: "Low"
      Severity Reason: "No issue reported."

---

Example:
Input: [123] @user says: "My phone crashes when I open Chrome. [Chrome] - 3:45 PM - System crash"
Output:
[
  {
    "Title": "Phone crashes when opening Chrome",
    "Source": "Samsung Members",
    "Problem": "My phone crashes when I open Chrome and then restarts.",
    "Module": "System",
    "Sub-Module": "Chrome",
    "Issue Type": "Crash",
    "Sub-Issue Type": "App Crash",
    "Ai Summary": "The phone crashes when opening Chrome and then restarts.",
    "Severity": "Medium",
    "Severity Reason": "This issue prevents users from using Chrome for browsing and messaging."
  }
]

Now process this input:
{INPUTDATA_JSON}

Input Data:
{INPUTDATA_JSON}`;
import pandas as pd
import sys
import os
import re

def clean_title(title_val):
    if pd.isna(title_val):
        return "", ""
    
    title_str = str(title_val).strip()
    source = "Unknown"
    
    # Extract all bracketed tokens (supporting both [ and { as openers)
    all_brackets = re.findall(r'[\[{](.*?)[\]}]', title_str)
    
    # Priority rule: if any bracket contains "Market Issue", use that as Source
    market_issue_match = next(
        (b.strip() for b in all_brackets if re.search(r'market\s*issue', b, re.IGNORECASE)),
        None
    )
    if market_issue_match:
        # Normalize to "Market Issue" regardless of date suffixes like "Market Issue-26DO-23"
        source = re.sub(r'[-–]\s*\w+$', '', market_issue_match).strip()
        if not re.search(r'market\s*issue', source, re.IGNORECASE):
            source = "Market Issue"
        else:
            source = "Market Issue"
    elif all_brackets:
        # Fallback: use first bracket as source
        source = all_brackets[0].strip()
    
    # Remove all bracketed items e.g. [CS], [EWP], [SM-F415F_SWA], [Display]
    cleaned = re.sub(r'[\[{].*?[\]}]', '', title_str)
    
    # Remove model numbers like SM-A315F_SWA_INS, SM-F415F
    cleaned = re.sub(r'SM-[A-Z0-9_]+', '', cleaned)
    
    # Remove parenthesized numbers (IMEI, etc) like (355743862626997)
    cleaned = re.sub(r'\(\d+\)', '', cleaned)
    
    # Remove dangling bracket chars left from malformed titles like "SIEL-R&D]..."
    cleaned = re.sub(r'[\]}\[{]', '', cleaned)
    
    # Clean up double spaces or trailing spaces
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    
    return source, cleaned


def clean_problem(problem_val):
    if pd.isna(problem_val):
        return ""
    
    problem_str = str(problem_val)
    # ── Zero-width and special spaces ─────────────────────────
    problem_str = re.sub(r'[\xa0\u200b\u200c]+', ' ', problem_str)
    problem_str = problem_str.strip()
    
    # ── SIP and IMS Logs (usually rest of text) ───────────────
    problem_str = re.compile(
        r'(?:SAMSUNG\s*Device>>|Other\s*Handset\s*Vendors>>|REGISTER\s*sip:|Via:\s*SIP/|Call-ID:[^\n]+)[\s\S]*', re.IGNORECASE
    ).sub('', problem_str)

    # ── Rule 1: Samsung Members Notice ─────────────────────────
    problem_str = re.compile(
        r'\[Samsung Members Notice\].*?(?=\n\n|\n*$|\Z)', re.DOTALL | re.IGNORECASE
    ).sub('', problem_str)
    
    # ── Rule 2: Crash/modem log table ──────────────────────────
    problem_str = re.compile(
        r'Country[\s\S]*?Telecom[\s\S]*?CP\s*Version[\s\S]*', re.IGNORECASE
    ).sub('', problem_str)
    
    # ── Rule 3: App sluggish / Top N App table ─────────────────
    problem_str = re.compile(
        r'Top\s+\d+\s+Sluggish\s+App[\s\S]*', re.IGNORECASE
    ).sub('', problem_str)
    problem_str = re.compile(
        r'^(?:com|in|cn|cc|us|kr)\.[a-z0-9_.]+\s*$', re.MULTILINE | re.IGNORECASE
    ).sub('', problem_str)
    
    # ── Rule 4: Week + percentage blocks ───────────────────────
    problem_str = re.compile(
        r'W\d{2}[\s\S]*?(?=\n\n|\n*$|\Z)', re.IGNORECASE
    ).sub('', problem_str)
    problem_str = re.compile(r'^\s*\d+\.\d+%\s*$', re.MULTILINE).sub('', problem_str)
    
    # ── Rule 5: Camera table comparisons ───────────────────────
    problem_str = re.compile(
        r'(?:Rear|Front)\s+Camera\s*:[\s\S]*?(?=\n\n|\n*$|\Z)', re.IGNORECASE
    ).sub('', problem_str)
    
    # ── Rule 6: Model/IMEI/Serial table rows ───────────────────
    problem_str = re.compile(
        r'(?:Model\s+Serial\s+No\.[\s\S]*?|Model[\s\S]{0,30}?IMEI[\s\S]*?|Model\s+Item\s+Part\s+Code[\s\S]*?)(?=\n\n|\n*$|\Z)', re.IGNORECASE
    ).sub('', problem_str)
    if 'Model No' in problem_str:
        problem_str = problem_str.split('Model No')[0]
        
    # ── Rule 7: SW/HW version strings ──────────────────────────
    problem_str = re.compile(
        r'(?:SW|HW|SOFTWARE)\s*(?:ver\.?|version|Bin)?\s*[-:]?\s*[-\s]*[A-Z0-9/.\s]{5,200}?(?=\n\n|\n*$|\Z|\n[A-Z])', re.IGNORECASE
    ).sub('', problem_str)
    # A076BXXS2AZA4 / A076BXXS2AZA3 / A076BODM2AZA4
    problem_str = re.compile(
        r'\b[A-Z0-9]{13,15}\s*/\s*[A-Z0-9]{13,15}\s*/\s*[A-Z0-9]{13,15}\b', re.IGNORECASE
    ).sub('', problem_str)
    # BL : A066... AP : A066...
    problem_str = re.compile(
        r'^(?:BL|AP|CP|CSC|RF\s*Cal|HW\s*Rev|HW\s*Version)\s*:\s*.*$', re.MULTILINE | re.IGNORECASE
    ).sub('', problem_str)
    
    # ── Rule 8: Product description / DOP / receipt tables ─────
    problem_str = re.compile(
        r'(?:Model\s+Description\s+D\.O\.P[\s\S]*|'
        r'Model\s*:\s*SM-[A-Z0-9]+\s*\nIMEI\s*:[\s\S]{0,300}?(?=\n\n|\n*$|\Z))', re.IGNORECASE
    ).sub('', problem_str)
    # Inline labels
    problem_str = re.compile(
        r'^(?:IMEI\s*(?:NO|NO\.)?|S[/.]?[RN]\s*(?:NO\.?)?|DOP|D\.O\.P|'
        r'Production\s*Date|Claim\s*Numbe?r?|'
        r'Model\s*Numbe?r?|Serial\s*Numbe?r?|Service\s*Order|'
        r'Purchase\s*Date|Delar\s*Name|Date|Time|Logs)\s*[-:/]?\s*.*$',
        re.MULTILINE | re.IGNORECASE
    ).sub('', problem_str)
    # Same but inline (not full line)
    problem_str = re.compile(
        r'(?:IMEI\s*(?:NO|NO\.)?|S[/.]?[RN]\s*(?:NO\.?)?|DOP|D\.O\.P|'
        r'Production\s*Date|Claim\s*Numbe?r?|'
        r'Model\s*Numbe?r?|Serial\s*Numbe?r?|Service\s*Order|'
        r'Purchase\s*Date|Delar\s*Name|Date|Time|Logs)\s*[-:/]?\s*\S+',
        re.IGNORECASE
    ).sub('', problem_str)
    
    # ── Rule 9: "Handset Details" / "Q&A no for EWP" blocks ────
    problem_str = re.compile(
        r'(?:Handset\s+Details|Q&A\s*no\s*for\s*EWP)[\s\S]*?(?=\n\n|\n*$|\Z)', re.IGNORECASE
    ).sub('', problem_str)
    
    # ── Rule 10: Octa Replacement / BOE PBA / Service Center ──
    problem_str = re.compile(
        r'Octa\s*Replacement\s*Call\s*details[\s\S]*', re.IGNORECASE
    ).sub('', problem_str)
    problem_str = re.compile(
        r'(?:[A-Z_0-9]*PBA[A-Z_0-9]*[\n\s]*)?Receiving\s+Dt\.?Control\s*No[\s\S]*?(?=\n\n|\n*$|\Z)', re.IGNORECASE
    ).sub('', problem_str)
    problem_str = re.compile(
        r'Service\s*Center[\s\S]*?(?=\n\n|\n*$|\Z)', re.IGNORECASE
    ).sub('', problem_str)
    problem_str = re.compile(
        r'(?:Logs\s*(?:and|&)\s*Video|Additional\s*Details|Repairs\s*performed|Remarks|Reference\s*Log)\s*:?[\s\S]*', re.IGNORECASE
    ).sub('', problem_str)
    
    # ── Rule 11: Standalone SM-* or Serial lines ────────────────
    problem_str = re.compile(
        r'^SM-[A-Z0-9_]+[\s\t]+(?:[A-Z0-9]{10,20}|[\d]{10,}).*$', re.MULTILINE
    ).sub('', problem_str)
    problem_str = re.compile(
        r'^SM-[A-Z0-9_/]+\s*$', re.MULTILINE
    ).sub('', problem_str)
    problem_str = re.compile(
        r'^[A-Z0-9]{8,20}\s*$', re.MULTILINE
    ).sub('', problem_str)
    
    # ── Rule 12: Mobile / Phone number lines ────────────────────
    problem_str = re.compile(
        r'(?:Mobile|Phone|Mob|Ph)\.?\s*(?:No\.?|Number)?\s*[-:]?\s*\d{8,}', re.IGNORECASE
    ).sub('', problem_str)
    
    # ── Rule 13: Attachment / symptom file references ───────────
    problem_str = re.compile(
        r'Attachment[\s\S]*?(?=\n\n|\n*$|\Z)', re.IGNORECASE
    ).sub('', problem_str)
    problem_str = re.compile(
        r'^~\s*.+$', re.MULTILINE
    ).sub('', problem_str)
    
    # ── Rule 14: Work Order blocks ──────────────────────────────
    problem_str = re.compile(
        r'\d+\s*\)\s*WORK\s*ORDER[\s\S]*?(?=\n\n|\n*$|\Z|\d+\s*\)\s*WORK)', re.IGNORECASE
    ).sub('', problem_str)
    problem_str = re.compile(
        r'WORK\s*ORDER\s*[-:]\s*[\s\S]*?(?=\n\n|\n*$|\Z)', re.IGNORECASE
    ).sub('', problem_str)
    
    # ── Rule 15: Claim / Box label / MSC details blocks ─────────
    problem_str = re.compile(
        r'(?:Claim\s*Number|BOX\s*[Ll]abel\s*[Dd]etails|'
        r'Mobile\s*[Dd]etails|MSC\s*(?:Code|Name|Contact)|'
        r'QUP\s*Name)[\s\S]*?(?=\n\n|\n*$|\Z)', re.IGNORECASE
    ).sub('', problem_str)
    
    # ── Rule 16: Test Scenario / network status tables ──────────
    problem_str = re.compile(
        r'Test\s*Scenario[\s\S]*?(?=\n\n|\n*$|\Z)', re.IGNORECASE
    ).sub('', problem_str)
    problem_str = re.compile(
        r'^(?:Status|Working|Not\s*Working|Both\s*IMEI|1\s*&\s*2|1st\s*Airtel|2nd\s*Jio|Both\s*Airtel|Both\s*Jio|Airtel|Jio|Slot|IMEI\s*No)$',
        re.MULTILINE | re.IGNORECASE
    ).sub('', problem_str)
    
    # ── Rule 17: Mail Subject lines ─────────────────────────────
    problem_str = re.compile(
        r'^Mail\s*Subject\s*:.*$', re.MULTILINE | re.IGNORECASE
    ).sub('', problem_str)
    
    # ── Rule 18: App/temperature test tables ────────────────────
    problem_str = re.compile(
        r'(?:S\.?\s*No\.?\s*[\n\r]+\s*Application|S\.?\s*No\.?\s+Application)[\s\S]*?(?=\n\n|\n*$|\Z)',
        re.IGNORECASE
    ).sub('', problem_str)
    problem_str = re.compile(
        r'^(?:Application\s*(?:Name|Version)|Time\s*Duration|Max\s*allowed\s*Temp|'
        r'Ambient\s*Temp|Starting\s*Temp|Ending\s*Temp|Difference\s*in\s*temp).*$',
        re.MULTILINE | re.IGNORECASE
    ).sub('', problem_str)
    problem_str = re.compile(
        r'^(?:Game\s*[a-zA-Z0-9]+|[\d.]+[A-Za-z]+|[\d.]+\s*deg\.?[Cc]?)$',
        re.MULTILINE | re.IGNORECASE
    ).sub('', problem_str)
    
    # ── Rule 19: SO# / Service Order / URLs ────────────────────
    problem_str = re.compile(
        r'(?:SO#|Service\s*Order\s*#?|S/?O\s*(?:No\.?)?|PIN\s*Code|Job\s*No)[\s\t]*[-:]?[\s\t]*\d+', re.IGNORECASE
    ).sub('', problem_str)
    problem_str = re.compile(r'https?://\S+', re.IGNORECASE).sub('', problem_str)
    
    # ── Rule 20: Reporting City / ASC / QUP address blocks ─────
    problem_str = re.compile(
        r'(?:Reporting\s*City|City|ASC|QUP\s*Support|No\s*Of\s*Customer)\s*[:–-][\s\S]*?(?=\n\n|\n*$|\Z)',
        re.IGNORECASE
    ).sub('', problem_str)
    
    # ── Rule 21: Emojis and bullet characters ──────────────────
    # Remove all emoji and non-ASCII decoration characters
    problem_str = re.compile(
        r'[\U0001F300-\U0001FAFF'   # Misc symbols, emoticons, transport, etc.
        r'\U00002700-\U000027BF'    # Dingbats
        r'\U0001F900-\U0001F9FF'    # Supplemental symbols
        r'\u2600-\u26FF'            # Misc symbols (☀ ☆ etc)
        r'\u25A0-\u25FF'            # Geometric shapes (●■▶)
        r'\u2190-\u21FF]',          # Arrows
        re.UNICODE
    ).sub('', problem_str)
    # Variation selectors and skin-tone modifiers that linger after emoji removal
    problem_str = re.compile(r'[\uFE00-\uFE0F\U0001F3FB-\U0001F3FF\u200D]+').sub('', problem_str)

    # ── Rule 22: ===...=== separator lines ─────────────────────
    # e.g. "==============================" or "===S921EXXS1BZA1==="
    problem_str = re.compile(
        r'^=+[=\w]*=+\s*$', re.MULTILINE
    ).sub('', problem_str)
    
    # ── Rule 23: Verbose log dump lines ────────────────────────
    # "+55s983ms (2) 098 c41100a2 +job=5017:..." style
    problem_str = re.compile(
        r'^\+\d+s\d+ms\s+.*$', re.MULTILINE
    ).sub('', problem_str)
    # "10-01 10:44:10.174 1000 2582 3003 I reSIProcate: ..." style (Android log format)
    problem_str = re.compile(
        r'^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+.*$', re.MULTILINE
    ).sub('', problem_str)
    # "(HH:MM:SS):" prefixed inline log lines
    problem_str = re.compile(
        r'^\(\d{2}:\d{2}:\d{2}\):\s*.*$', re.MULTILINE
    ).sub('', problem_str)
    # Remove entire block starting with IMS/SIP/log dump keywords
    problem_str = re.compile(
        r'(?:reSIProcate|CallStateMachine|VoiceCallDisconnect|IMSCR|SCallUI)\s*:[\s\S]*',
        re.IGNORECASE
    ).sub('', problem_str)
    # Remove "Notes:-" lines that typically precede inline log analysis text
    problem_str = re.compile(
        r'^Notes\s*:-?[\s\S]*', re.IGNORECASE | re.MULTILINE
    ).sub('', problem_str)
    # Remove lines containing inline log timestamps (e.g. "At 10:44:10.174 ...")
    problem_str = re.compile(
        r'^.*\d{2}:\d{2}:\d{2}\.\d+.*(?:SIP|IMS|DISCONNECT|Q\.850|cause=|errorCode=).*$',
        re.MULTILINE | re.IGNORECASE
    ).sub('', problem_str)

    
    # ── Final cleanup ───────────────────────────────────────────
    problem_str = re.compile(
        r'^(?:MODEL\s*NO|IMEI\s*NO|IMEI\s*Number|S/R|S/N|SN|Serial\s*NO?)\s*[-:./]?\s*.+$',
        re.MULTILINE | re.IGNORECASE
    ).sub('', problem_str)
    problem_str = re.compile(
        r'^\s*(?:[A-Z0-9]{10,20}|(?:-\s*)?\d{15})\s*$', re.MULTILINE
    ).sub('', problem_str)
    problem_str = re.compile(
        r'^[\s]*(?:[A-Z]\d{2}[\s]+)+[A-Z]\d{2}[\s]*$', re.MULTILINE
    ).sub('', problem_str)
    problem_str = re.sub(r'^\s*[\d,.\-]+\s*$', '', problem_str, flags=re.MULTILINE)
    problem_str = re.sub(r'\n{3,}', '\n\n', problem_str)
    
    return problem_str.strip()

def clean_excel(file_path):
    print(f"[excel_cleaner] Processing file: {file_path}")
    
    try:
        # Load the whole file
        df = pd.read_excel(file_path, header=None)
        
        header_row_idx = -1
        
        # Search for header row
        is_content_based = False
        for idx, row in df.iterrows():
            row_vals = [str(val).lower().strip() for val in row.values if pd.notna(val)]
            row_str = ' | '.join(row_vals)
            if 'title' in row_str and 'problem' in row_str:
                header_row_idx = idx
                break
            elif 'content' in row_str:
                header_row_idx = idx
                is_content_based = True
                break
                
        if header_row_idx == -1:
            print("[excel_cleaner] ERROR: Could not locate header row containing Title and Problem (or Content).")
            sys.exit(1)
            
        print(f"[excel_cleaner] Header found at row {header_row_idx}")
        
        # Re-read with actual header, skipping rows above
        df = pd.read_excel(file_path, header=header_row_idx)
        
        # Clean current headers for flexible matching
        current_headers = [str(c).lower().strip() for c in df.columns]
        
        # Only Title and Problem are required for cleaning (or Content).
        # All other columns are treated as optional and passed through unchanged.
        if is_content_based:
            REQUIRED_HEADERS = ['content']
        else:
            REQUIRED_HEADERS = ['title', 'problem']

        missing_headers = [h for h in REQUIRED_HEADERS if h not in current_headers]

        if missing_headers:
            print(f"[excel_cleaner] ERROR: Missing required headers: {missing_headers}")
            sys.exit(1)
            
        print("[excel_cleaner] Headers validated successfully.")
        
        # Find exact column names (case-insensitive match)
        title_col = next((c for c in df.columns if str(c).lower().strip() == 'title'), None)
        problem_col = next((c for c in df.columns if str(c).lower().strip() == 'problem'), None)
        content_col = next((c for c in df.columns if str(c).lower().strip() == 'content'), None)
        
        # Apply cleaning
        if title_col:
            sources = []
            cleaned_titles = []
            for val in df[title_col]:
                src, cln = clean_title(val)
                sources.append(src)
                cleaned_titles.append(cln)
                
            df[title_col] = cleaned_titles
            
            # Map Source to column
            source_col = next((c for c in df.columns if str(c).lower().strip() == 'source'), None)
            if source_col:
                df[source_col] = sources
            else:
                # Insert Source column near Title
                title_idx = df.columns.get_loc(title_col)
                df.insert(title_idx, 'Source', sources)
                
        if problem_col:
            df[problem_col] = df[problem_col].apply(clean_problem)
            
            # Additional rule: no blank text in problem
            # Just fill missing with ''
            df[problem_col] = df[problem_col].fillna('')
            
        if content_col:
            df[content_col] = df[content_col].apply(clean_problem)
            df[content_col] = df[content_col].fillna('')
            
        # Overwrite file with cleaned data
        output_path = file_path.replace('.xlsx', '_cleaned.xlsx').replace('.xls', '_cleaned.xls')
        df.to_excel(output_path, index=False)
        
        print(f"[excel_cleaner] SUCCESS: Cleaned data saved to {output_path}")
        
    except Exception as e:
        print(f"[excel_cleaner] ERROR: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("[excel_cleaner] ERROR: Please provide an Excel file path as an argument.")
        print("  Usage: python excel_cleaner.py <path_to_excel_file>")
        sys.exit(1)
    
    file_path = sys.argv[1].strip().strip('"\'')
    clean_excel(file_path)

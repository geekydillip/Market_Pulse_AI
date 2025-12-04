#!/usr/bin/env python3
"""
json_to_excel_converter_simple.py

Simple, no-arguments script:
 - Looks for json files in a source folder (default: ./json_input)
 - Writes .xlsx files to a destination folder (default: ./excel_output)
 - Keeps the base filename, only changes extension .json -> .xlsx
"""

from pathlib import Path
import json
import pandas as pd
import traceback

# --------- CONFIGURATION (edit these if you want) ----------
BASE_DIR = Path(__file__).parent.resolve()   # folder where script is located
SOURCE_DIR = BASE_DIR / "Samsung_Memver_VOC"         # default source folder
DEST_DIR = BASE_DIR / "Samsung_Memver_VOC"         # default destination folder
OVERWRITE = False                            # set True to overwrite existing .xlsx files
# -----------------------------------------------------------

def convert_single_json(source_path: Path, dest_dir: Path, overwrite: bool=False) -> bool:
    """
    Convert one JSON file to an Excel file.
    Returns True on success, False otherwise.
    """
    try:
        with source_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"[ERROR] Failed to read/parse JSON '{source_path.name}': {e}")
        return False

    dest_dir.mkdir(parents=True, exist_ok=True)
    output_file = dest_dir / (source_path.stem + ".xlsx")

    if output_file.exists() and not overwrite:
        print(f"[SKIP] Output exists (overwrite=False): {output_file.name}")
        return False

    try:
        if isinstance(data, dict):
            with pd.ExcelWriter(output_file) as writer:
                for sheet_name, records in data.items():
                    safe_sheet = (str(sheet_name) or "Sheet1")[:31]
                    if records is None:
                        df = pd.DataFrame()
                    elif isinstance(records, list):
                        df = pd.DataFrame(records)
                    else:
                        df = pd.DataFrame([records])
                    df.to_excel(writer, sheet_name=safe_sheet, index=False)
        elif isinstance(data, list):
            df = pd.DataFrame(data)
            df.to_excel(output_file, sheet_name="Sheet1", index=False)
        else:
            df = pd.DataFrame([{"value": data}])
            df.to_excel(output_file, sheet_name="Sheet1", index=False)

        print(f"[OK] Wrote: {output_file.name}")
        return True

    except Exception as e:
        print(f"[ERROR] Failed to write Excel for '{source_path.name}': {e}")
        traceback.print_exc()
        try:
            if output_file.exists():
                output_file.unlink()
        except Exception:
            pass
        return False

def main():
    print("JSON → Excel converter (simple mode)")
    print(f"Source folder : {SOURCE_DIR}")
    print(f"Destination   : {DEST_DIR}")
    print(f"Overwrite     : {OVERWRITE}")
    print("-" * 40)

    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    DEST_DIR.mkdir(parents=True, exist_ok=True)

    json_files = sorted(SOURCE_DIR.glob("*.json"))
    if not json_files:
        print(f"[INFO] No .json files found in: {SOURCE_DIR}")
        print("Place your .json files in the folder above and run this script again.")
        return

    summary = {"total": len(json_files), "ok": 0, "skipped": 0, "failed": 0}
    for jf in json_files:
        print(f"Processing: {jf.name} ...", end=" ")
        ok = convert_single_json(jf, DEST_DIR, overwrite=OVERWRITE)
        if ok:
            summary["ok"] += 1
        else:
            out_file = DEST_DIR / (jf.stem + ".xlsx")
            if out_file.exists() and not OVERWRITE:
                summary["skipped"] += 1
            else:
                summary["failed"] += 1

    print("\n=== Summary ===")
    print(f"Total JSON files : {summary['total']}")
    print(f"Converted (OK)   : {summary['ok']}")
    print(f"Skipped (exists) : {summary['skipped']}")
    print(f"Failed           : {summary['failed']}")

if __name__ == "__main__":
    main()

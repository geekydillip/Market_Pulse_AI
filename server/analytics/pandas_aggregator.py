import pandas as pd
import os
import sys
import json
import math
from pathlib import Path
from datetime import date, datetime
import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.cluster import AgglomerativeClustering


# pandas_aggregator.py lives at:  <project_root>/server/analytics/pandas_aggregator.py
# extract_criticality.py lives at: <project_root>/server/analytics/extract_criticality.py
# modelName.json lives at:         <project_root>/modelName.json
#
# _THIS_DIR is added to sys.path so `from extract_criticality import ...`
# always works regardless of cwd when called by server.js via spawn().
_THIS_DIR     = Path(__file__).resolve().parent   # .../server/analytics/
_PROJECT_ROOT = _THIS_DIR.parent.parent           # project root

if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

# Single source of truth for all criticality/exclusion/tier logic
from extract_criticality import extract_criticality_data


def load_model_name_mappings():
    # Look for modelName.json at project root, then fallback to cwd
    for candidate in [_PROJECT_ROOT / 'modelName.json', Path('modelName.json')]:
        try:
            with open(candidate, 'r') as f:
                return json.load(f)
        except FileNotFoundError:
            continue
        except json.JSONDecodeError:
            sys.stderr.write(f"Warning: Invalid JSON in {candidate}, using empty mappings\n")
            return {}
    sys.stderr.write("Warning: modelName.json not found, using empty mappings\n")
    return {}

MODEL_NAME_MAPPINGS = load_model_name_mappings()


# ── Helpers ──────────────────────────────────────────────────────────────────
def sanitize_nan(obj):
    """Recursively replace NaN/dates for JSON serialization."""
    if isinstance(obj, float) and math.isnan(obj):
        return None
    elif isinstance(obj, (date, datetime)):
        return obj.isoformat()
    elif isinstance(obj, dict):
        return {k: sanitize_nan(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [sanitize_nan(item) for item in obj]
    return obj


def derive_model_name_from_sw_ver(sw_ver):
    """
    Derive model name from S/W Ver. for OS Beta entries
    Example: "S911BXXU8ZYHB" -> "SM-S911B"
    """
    if pd.isna(sw_ver) or not isinstance(sw_ver, str) or len(sw_ver) < 5:
        return sw_ver  # Return original if invalid
    return 'SM-' + sw_ver[:5]


def transform_model_names(df):
    if 'Model No.' in df.columns:
        if 'S/W Ver.' in df.columns:
            mask = df['Model No.'].astype(str).str.startswith('[OS Beta]')
            df.loc[mask, 'Model No.'] = (
                df.loc[mask, 'S/W Ver.'].apply(derive_model_name_from_sw_ver)
            )
        mask2 = df['Model No.'].astype(str).str.startswith('[Regular Folder]')
        if mask2.any():
            df.loc[mask2, 'Model No.'] = (
                df.loc[mask2, 'Model No.']
                  .str.replace(r'^\[Regular Folder\]', '', regex=True)
            )
    """
    Transform Model No. column for OS Beta and Global VOC entries using S/W Ver.
    Also remove [Regular Folder] prefix from model names.
    """
    if 'Model No.' in df.columns:
        # Apply transformation where Model No. starts with "[OS Beta]" or "[Global VOC]"
        if 'S/W Ver.' in df.columns:
            mask_os_beta = df['Model No.'].astype(str).str.startswith('[OS Beta]').fillna(False)
            mask_global_voc = df['Model No.'].astype(str).str.startswith('[Global VOC]').fillna(False)
            mask_to_transform = mask_os_beta | mask_global_voc
            df.loc[mask_to_transform, 'Model No.'] = df.loc[mask_to_transform, 'S/W Ver.'].apply(derive_model_name_from_sw_ver)
        
        # Remove [Regular Folder] prefix from model names
        mask_regular_folder = df['Model No.'].astype(str).str.startswith('[Regular Folder]').fillna(False)
        if mask_regular_folder.any():
            df.loc[mask_regular_folder, 'Model No.'] = df.loc[mask_regular_folder, 'Model No.'].str.replace(r'^\[Regular Folder\]', '', regex=True)
    return df


def load_all_excels(folder_path: str) -> pd.DataFrame:
    folder = Path(folder_path)
    if not folder.exists():
        raise FileNotFoundError(f"Folder {folder_path} does not exist")

    excels = list(folder.glob("*.xlsx")) + list(folder.glob("*.xls"))
    if not excels:
        raise FileNotFoundError(f"No Excel files in {folder_path}")

    dtype_spec = {
        'Model No.': 'string',
        'Module':    'string',
        'Severity':  'category',
        'Title':     'string',
        'Case Code': 'string',
        'S/W Ver.':  'string',
    }

    dfs = []
    for excel_file in excels:
        try:
            df = pd.read_excel(excel_file, dtype=dtype_spec, engine='openpyxl')
            dfs.append(df)
            import sys
            sys.stderr.write(f"Loaded {len(df)} rows from {excel_file.name}\n")
        except Exception as e:
            import sys
            sys.stderr.write(f"Warning: Failed to load {excel_file.name}: {e}\n")

    if not dfs:
        raise FileNotFoundError(f"Failed to load any Excel files from {folder_path}")

    combined_df = pd.concat(dfs, ignore_index=True, sort=False)
    import sys
    sys.stderr.write(f"Combined {len(dfs)} files, total {len(combined_df)} rows\n")

    if len(combined_df) > 10000:
        for col in combined_df.select_dtypes(include=['int64']):
            combined_df[col] = pd.to_numeric(combined_df[col], downcast='integer')
        for col in combined_df.select_dtypes(include=['float64']):
            combined_df[col] = pd.to_numeric(combined_df[col], downcast='float')

    return combined_df


def _build_severity_distribution(excel_paths: list) -> dict:
    """
    Delegate to extract_criticality.py for severity breakdown.
    Runs extract_criticality_data() on each Excel file and merges counts.

    Final shape:
    {
        "Severe":   { "total": N, "open": N, "resolve": N, "close": N },
        "Moderate": { "total": N, "open": N, "resolve": N, "close": N },
        "Deferred": { "total": N, "open": N, "resolve": N, "close": N },
    }
    """
    import sys
    merged = {}

    for path in excel_paths:
        try:
            result = extract_criticality_data(str(path))
        except Exception as e:
            sys.stderr.write(f"Warning: extract_criticality_data failed for {path}: {e}\n")
            continue

        for tier_name, stats in result['summary'].items():
            s = stats.get('status', {})
            bucket = {
                'total':   stats['count'],
                'open':    s.get('Open',    0),
                'resolve': s.get('Resolve', 0),
                'close':   s.get('Close',   0),
            }
            if tier_name not in merged:
                merged[tier_name] = bucket
            else:
                for key in ('total', 'open', 'resolve', 'close'):
                    merged[tier_name][key] += bucket[key]

    return merged


def compute_kpis(df: pd.DataFrame, excel_paths: list = None) -> dict:
    """
    Return high-level KPIs.

    excel_paths: list of Path/str for all Excel files in the folder.
                 Passed to extract_criticality.py for accurate severity bucketing.
                 Falls back to simple value_counts() when not provided.

    severity_distribution shape:
    {
        "Severe":   { "total": N, "open": N, "resolve": N, "close": N },
        "Moderate": { "total": N, "open": N, "resolve": N, "close": N },
        "Deferred": { "total": N, "open": N, "resolve": N, "close": N },
    }
    """
    total_rows    = len(df)
    unique_models = df['Model No.'].nunique()          if 'Model No.'    in df.columns else 0
    category_dist = df['Module'].value_counts().to_dict()       if 'Module'      in df.columns else {}
    status_dist   = df['Progr.Stat.'].value_counts().to_dict()  if 'Progr.Stat.' in df.columns else {}
    source_dist   = df['Source'].value_counts().to_dict()       if 'Source'      in df.columns else {}

    # ── Severity distribution: delegate to extract_criticality ──────────────
    if excel_paths:
        severity_dist = _build_severity_distribution(excel_paths)
    else:
        raw = df['Severity'].value_counts().to_dict() if 'Severity' in df.columns else {}
        severity_dist = {k: {'total': v, 'open': 0, 'resolve': 0, 'close': 0}
                         for k, v in raw.items()}


    # Legacy flat counts kept for backward compatibility with existing charts
    open_issues     = int(df['Progr.Stat.'].eq('Open').sum())               if 'Progr.Stat.' in df.columns else 0
    resolved_issues = int(df['Progr.Stat.'].str.startswith('Resolve').sum()) if 'Progr.Stat.' in df.columns else 0
    close_issues    = int(df['Progr.Stat.'].eq('Close').sum())              if 'Progr.Stat.' in df.columns else 0

    return {
        "total_rows":            total_rows,
        "unique_models":         unique_models,
        "category_distribution": category_dist,
        "severity_distribution": severity_dist,
        "status_distribution":   status_dist,
        "source_distribution":   source_dist,
        # Legacy flat counts
        "open_issues":     open_issues,
        "resolved_issues": resolved_issues,
        "close_issues":    close_issues,
    }


def group_by_column(df: pd.DataFrame, column: str) -> list:
    if column not in df.columns:
        return []
    try:
        col_data = df[column]
        if isinstance(col_data, pd.DataFrame):
            col_data = col_data.iloc[:, 0]
        counts = col_data.value_counts().sort_values(ascending=False)
        return [{"label": str(idx), "count": int(count)}
                for idx, count in counts.items()]
    except Exception:
        return []


def map_model_name(model_number):
    if not model_number or pd.isna(model_number):
        return model_number
    model_str = str(model_number).strip()
    if model_str in MODEL_NAME_MAPPINGS:
        v = MODEL_NAME_MAPPINGS[model_str]
        return v.get('name', model_str) if isinstance(v, dict) else v

    import re
    match = re.match(r'SM-([A-Z0-9]+)', model_str)
    if not match:
        return model_str
    core = match.group(1)

    exact_key = f"SM-{core}"
    if exact_key in MODEL_NAME_MAPPINGS:
        v = MODEL_NAME_MAPPINGS[exact_key]
        return v.get('name', exact_key) if isinstance(v, dict) else v

    for suffix in ["BE","B","FN","F","U","EUR","US","VZW","INS","DD",
                   "XX","SWA","KSA","THL","MYS","SGP","IND","PHL","HKG","TW"]:
        if core.endswith(suffix):
            bk = f"SM-{core[:-len(suffix)]}"
            if bk in MODEL_NAME_MAPPINGS:
                v = MODEL_NAME_MAPPINGS[bk]
                return v.get('name', bk) if isinstance(v, dict) else v

    for pattern in [core[:-1], core[:-2], core[:-3]]:
        if pattern:
            bk = f"SM-{pattern}"
            if bk in MODEL_NAME_MAPPINGS:
                v = MODEL_NAME_MAPPINGS[bk]
                return v.get('name', bk) if isinstance(v, dict) else v

    for suffix in ["B","F","FN","U"]:
        ak = f"SM-{core}{suffix}"
        if ak in MODEL_NAME_MAPPINGS:
            return MODEL_NAME_MAPPINGS[ak]

    prefix = f"SM-{core}"
    for key, value in MODEL_NAME_MAPPINGS.items():
        if key.startswith(prefix):
            return value.get('name', key) if isinstance(value, dict) else value

    for key, value in MODEL_NAME_MAPPINGS.items():
        if core in key:
            return value.get('name', key) if isinstance(value, dict) else value

    return model_str


def time_series(df: pd.DataFrame, date_column: str) -> list:
    if date_column not in df.columns:
        return []
    df_copy = df.copy()
    df_copy[date_column] = pd.to_datetime(df_copy[date_column], errors='coerce')
    df_copy = df_copy.dropna(subset=[date_column])
    return (
        df_copy.groupby(df_copy[date_column].dt.date)
               .size().sort_index()
               .reset_index(name='count')
               .rename(columns={date_column: 'date'})
               .to_dict('records')
    )


# Folders inside ./downloads/ to always skip
_SKIP_FOLDERS = {'__dashboard_cache__', '__pycache__'}
def cluster_insights(df: pd.DataFrame) -> pd.DataFrame:
    """
    Cluster similar 'AI Insight' statements and replace them with a single representative statement
    per cluster to avoid UI clutter. Only clusters within the same Module and Sub-Module.
    """
    if 'AI Insight' not in df.columns or df.empty:
        return df

    group_cols = []
    for col in ['Module', 'Sub-Module']:
        if col in df.columns:
            group_cols.append(col)

    if not group_cols:
        return df

    try:
        import sys
        sys.stderr.write("Loading SentenceTransformer model for clustering...\n")
        model = SentenceTransformer('all-MiniLM-L6-v2')
    except Exception as e:
        import sys
        sys.stderr.write(f"Warning: Failed to load sentence-transformers model: {e}\n")
        return df

    def process_group(group):
        insights = group['AI Insight'].dropna()
        if len(insights.unique()) < 2:
            return group

        unique_insights = insights.unique().tolist()
        embeddings = model.encode(unique_insights)
        
        # threshold=0.15 means ~85% cosine similarity
        clustering = AgglomerativeClustering(
            n_clusters=None,
            distance_threshold=0.15,
            metric='cosine',
            linkage='average'
        )
        labels = clustering.fit_predict(embeddings)
        
        insight_counts = insights.value_counts()
        label_to_insights = {}
        for i, label in enumerate(labels):
            if label not in label_to_insights:
                label_to_insights[label] = []
            label_to_insights[label].append(unique_insights[i])
            
        rep_map = {}
        for label, group_insights in label_to_insights.items():
            if len(group_insights) == 1:
                rep_map[label] = group_insights[0]
            else:
                best_insight = max(group_insights, key=lambda x: insight_counts.get(x, 0))
                rep_map[label] = best_insight
                
        insight_to_rep = {unique_insights[i]: rep_map[labels[i]] for i in range(len(unique_insights))}
        group['AI Insight'] = group['AI Insight'].map(lambda x: insight_to_rep.get(x, x) if pd.notna(x) else x)
        return group

    import sys
    sys.stderr.write("Starting AI Insight clustering...\n")
    df = df.groupby(group_cols, group_keys=False).apply(process_group)
    sys.stderr.write("AI Insight clustering complete.\n")
    return df

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Module name required"}))
        sys.exit(1)


def _process_folder(folder_path: str, save_to_file: bool = True) -> bool:
    """
    Process one source folder: load all Excel files, build analytics.

    save_to_file=True  (--save-json):  write analytics.json into the folder
                                        used by precomputeAnalytics() in server.js
    save_to_file=False (no flag):      print JSON to stdout
                                        used by /api/analytics/:module fallback in server.js
    Returns True on success, False on failure/skip.
    """
    folder      = Path(folder_path)
    folder_name = folder.name

    excel_paths = list(folder.glob("*.xlsx")) + list(folder.glob("*.xls"))
    if not excel_paths:
        sys.stderr.write(f"  [SKIP]  {folder_name}/ — no Excel files found\n")
        return False

    try:
        df = load_all_excels(folder_path)
        df = transform_model_names(df)

        kpis       = compute_kpis(df, excel_paths=excel_paths)
        # Apply semantic clustering on AI Insight
        df = cluster_insights(df)

        kpis = compute_kpis(df)

        top_models = group_by_column(df, 'Model No.')
        for m in top_models:
            m['friendly_name'] = map_model_name(m['label'])

        categories  = group_by_column(df, 'Module')
        time_data   = time_series(df, 'Date') if 'Date' in df.columns else []
        rows        = df.to_dict('records')
        high_issues = kpis["severity_distribution"].get("Severe", {}).get("total", 0)

        response = {
            "kpis": {
                "total_rows":            kpis["total_rows"],
                "unique_models":         kpis["unique_models"],
                "high_issues":           high_issues,
                "severity_distribution": kpis["severity_distribution"],
                "source_distribution":   kpis["source_distribution"],
                "open_issues":           kpis["open_issues"],
                "resolved_issues":       kpis["resolved_issues"],
                "close_issues":          kpis["close_issues"],
            },
            "top_models": top_models,
            "categories": categories,
            "rows":        rows,
        }
        if time_data:
            response["time_series"] = time_data

        response = sanitize_nan(response)

        if save_to_file:
            # Write analytics.json into the folder
            json_path = folder / "analytics.json"
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(response, f, indent=2)
            sys.stderr.write(
                f"  [OK]    {folder_name}/analytics.json  ({kpis['total_rows']} rows)\n"
            )
        else:
            # Print to stdout for server.js /api/analytics/:module fallback
            print(json.dumps(response))

        return True

    except Exception as e:
        if save_to_file:
            sys.stderr.write(f"  [ERROR] {folder_name}/ — {e}\n")
        import traceback
        error_msg = traceback.format_exc()
        if save_json:
            print(f"Error saving analytics:\n{error_msg}")
        else:
            print(json.dumps({"error": str(e)}))
        return False


# ── Entry point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    import shutil

    # ── How this script works ─────────────────────────────────────────────────
    #
    # Pass ONE Excel file path (anywhere on disk):
    #   python pandas_aggregator.py path/to/beta_ut.xlsx
    #   python pandas_aggregator.py path/to/GlobalVOC_2025.xlsx
    #
    # The script will:
    #   1. Derive the folder name from the file stem  →  beta_ut
    #   2. Create  downloads/beta_ut/  if it doesn't exist
    #   3. Copy the file into  downloads/beta_ut/beta_ut.xlsx
    #   4. Run full analytics and write  downloads/beta_ut/analytics.json
    #
    # No args → process all existing folders in ./downloads/ (batch mode)
    # ─────────────────────────────────────────────────────────────────────────

    downloads_root = Path("./downloads")
    downloads_root.mkdir(parents=True, exist_ok=True)

    # Strip flags (--save-json etc); keep only positional args
    args = [a for a in sys.argv[1:] if not a.startswith('--')]

    if args:
        # ── File-based mode ───────────────────────────────────────────────────
        # Input is a file path.  For each file:
        #   • derive folder name from file stem (lowercased)
        #   • create downloads/<stem>/ if needed
        #   • copy file in (skip copy if it's already inside the target folder)
        #   • run _process_folder on that folder

        target_folders = []

        for file_arg in args:
            file_path = Path(file_arg)

            # Accept bare stem names too (e.g. "beta_ut" → look for existing folder)
            if not file_path.suffix:
                # Treated as a folder name (legacy / run_server.py startup usage)
                folder = downloads_root / file_path.name
                if folder.is_dir():
                    target_folders.append(folder)
                else:
                    print(f"ERROR: '{file_arg}' is not a file and "
                          f"'{folder}' folder does not exist.", file=sys.stderr)
                    sys.exit(1)
                continue

            if not file_path.exists():
                print(f"ERROR: file not found — {file_path}", file=sys.stderr)
                sys.exit(1)

            # Derive folder name from file stem  (beta_ut.xlsx → beta_ut)
            folder_name = file_path.stem.lower().replace(' ', '_')
            folder      = downloads_root / folder_name
            folder.mkdir(parents=True, exist_ok=True)

            # Copy file into the folder (unless it's already there)
            dest = folder / file_path.name
            if dest.resolve() != file_path.resolve():
                shutil.copy2(file_path, dest)
                sys.stderr.write(f"  [COPY]  {file_path.name} → {folder}/\n")

            target_folders.append(folder)

    else:
        # ── Batch mode: no args → process all existing folders ────────────────
        target_folders = sorted([
            p for p in downloads_root.iterdir()
            if p.is_dir() and p.name not in _SKIP_FOLDERS
        ])
        if not target_folders:
            print("No subfolders found in ./downloads/", file=sys.stderr)
            sys.exit(1)

    sys.stderr.write(
        f"\nProcessing {len(target_folders)} folder(s) inside {downloads_root}/\n\n"
    )

    save_json = '--save-json' in sys.argv

    ok = failed = 0
    for folder in target_folders:
        success = _process_folder(str(folder), save_to_file=save_json)
        ok     += int(success)
        failed += int(not success)

    if save_json:
        sys.stderr.write(f"\nDone — {ok} succeeded, {failed} failed/skipped.\n\n")

    if failed and not ok:
        sys.exit(1)
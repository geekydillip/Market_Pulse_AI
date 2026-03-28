import pandas as pd
import os
import json
import math
import numpy as np
from pathlib import Path
from typing import Optional

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False

# ── Single source of truth for all criticality/scoring/tier logic ────────────
# All constants (TIER_THRESHOLDS, ISSUE_TYPE_RANK, SCHEMA1_*/SCHEMA2_* weights
# and rank maps, MAX_SIMILAR_BUGS, TITLE_SIMILARITY_THRESHOLD) and all helpers
# (_detect_schema, _rel, _assign_tier, _compute_similar_bug_counts, etc.) live
# exclusively in extract_criticality.py and are imported here.
from extract_criticality import extract_criticality_data


# Load model name mapping from modelName.json
_MODEL_NAME_MAPPING = None

def load_model_name_mapping():
    """
    Load model name mapping from modelName.json in the root directory.
    Returns a dictionary mapping model numbers to friendly names.
    """
    global _MODEL_NAME_MAPPING
    if _MODEL_NAME_MAPPING is not None:
        return _MODEL_NAME_MAPPING

    try:
        json_path = Path(__file__).parent.parent.parent / 'modelName.json'
        if json_path.exists():
            with open(json_path, 'r', encoding='utf-8') as f:
                _MODEL_NAME_MAPPING = json.load(f)
        else:
            _MODEL_NAME_MAPPING = {}
    except Exception:
        _MODEL_NAME_MAPPING = {}

    return _MODEL_NAME_MAPPING


def apply_model_name_mapping(model_number):
    """
    Convert model number to friendly name using modelName.json mapping.
    Extracts base model number (e.g., SM-S931 from SM-S931BE) for matching.
    """
    if not model_number or not isinstance(model_number, str):
        return model_number

    mapping = load_model_name_mapping()
    if not mapping:
        return model_number

    model_str = str(model_number).strip()

    # Try exact match first
    if model_str in mapping:
        mapping_value = mapping[model_str]
        if isinstance(mapping_value, dict):
            return mapping_value.get('name', model_str)
        return mapping_value

    # Extract base model number (e.g., SM-S931 from SM-S931BE_SWA_16_DD)
    import re
    match = re.match(r'(SM-[A-Z]\d{2,4})', model_str)
    if match:
        base_model = match.group(1)
        for map_key, mapping_value in mapping.items():
            if map_key.startswith(base_model):
                if isinstance(mapping_value, dict):
                    return mapping_value.get('name', base_model)
                return mapping_value

    # Fallback: prefix matching (longest key first)
    for model_key in sorted(mapping.keys(), key=len, reverse=True):
        if model_str.startswith(model_key):
            mapping_value = mapping[model_key]
            if isinstance(mapping_value, dict):
                return mapping_value.get('name', model_key)
            return mapping_value

    return model_number


def sanitize_nan(obj):
    """Recursively replace NaN values with None for JSON serialization."""
    if isinstance(obj, float) and math.isnan(obj):
        return None
    elif isinstance(obj, dict):
        return {k: sanitize_nan(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [sanitize_nan(item) for item in obj]
    return obj


def derive_model_name_from_sw_ver(sw_ver):
    """
    Derive model name from S/W Ver. for OS Beta entries.
    Example: "S911BXXU8ZYHB" -> "SM-S911B"
    """
    if not sw_ver or not isinstance(sw_ver, str):
        return sw_ver
    sw_ver = str(sw_ver).strip()
    if len(sw_ver) >= 6:
        return f"SM-{sw_ver[:6]}"
    return sw_ver


def transform_model_names(df: pd.DataFrame) -> pd.DataFrame:
    """
    Transform Model No. column for OS Beta entries using S/W Ver.
    Also remove [Regular Folder] prefix from model names.
    """
    if 'Model No.' in df.columns:
        if 'S/W Ver.' in df.columns:
            mask_os_beta = df['Model No.'].astype(str).str.startswith('[OS Beta]')
            df.loc[mask_os_beta, 'Model No.'] = (
                df.loc[mask_os_beta, 'S/W Ver.'].apply(derive_model_name_from_sw_ver)
            )
        mask_regular_folder = df['Model No.'].astype(str).str.startswith('[Regular Folder]')
        if mask_regular_folder.any():
            df.loc[mask_regular_folder, 'Model No.'] = (
                df.loc[mask_regular_folder, 'Model No.']
                  .str.replace(r'^\[Regular Folder\]', '', regex=True)
            )
    return df


# ===========================================================================
#  HIGH SEVERITY BREAKDOWN
#  Uses extract_criticality_data() from extract_criticality for fallback scoring.
#
#  SCALE-DOWN LOGIC:
#    Within High severity rows, scoring produces Severe / Moderate / Low tiers.
#    Only the Severe-tier count is kept as "High".
#    Moderate + Deferred (Low-tier + excluded) counts are reported separately
#    so compute_central_kpis() can add them to the Medium bucket.
# ===========================================================================

def get_high_severity_breakdown(filepath: str) -> dict:
    """
    Score all issues in the file and return High-severity tier breakdown.
    Used only as fallback when analytics.json is not available.

    Returns
    -------
    {
        "total":    <int>,  # total High rows
        "severe":   <int>,  # scored Severe  → stays High
        "moderate": <int>,  # scored Moderate → moved to Medium
        "deferred": <int>,  # scored Low/Excluded → moved to Medium
    }
    """
    try:
        result      = extract_criticality_data(str(filepath))
        sev_bd      = result.get('severity_breakdown', {})
        high_entry  = sev_bd.get('High', {})
        moved       = high_entry.get('moved_to_medium', {})
        return {
            "total":    high_entry.get('total', 0) + moved.get('moderate', 0) + moved.get('deferred', 0),
            "severe":   high_entry.get('total',    0),
            "moderate": moved.get('moderate',      0),
            "deferred": moved.get('deferred',      0),
        }
    except Exception:
        return {"total": 0, "severe": 0, "moderate": 0, "deferred": 0}


# ===========================================================================
#  DATA LOADING
# ===========================================================================

def load_all_excels(base_path: str) -> dict:
    """
    Load all Excel files from subfolders under base_path, grouped by folder.
    Apply model name transformation for OS Beta entries.
    Returns dict: {folder_name: [df1, df2, ...]}
    """
    base = Path(base_path)
    if not base.exists():
        raise FileNotFoundError(f"Base path {base_path} does not exist")

    data = {}
    for folder in base.iterdir():
        if folder.is_dir():
            excels = list(folder.glob("*.xlsx"))
            if excels:
                dfs = []
                for excel in excels:
                    if excel.name.startswith('~$'):
                        continue
                    try:
                        df = pd.read_excel(excel)
                        df = transform_model_names(df)
                        dfs.append(df)
                    except Exception as e:
                        import sys
                        sys.stderr.write(f"Warning: Failed to load {excel}: {e}\n")
                if dfs:
                    data[folder.name] = dfs
    return data


def combine_dataframes(dfs: list) -> pd.DataFrame:
    """Combine list of DataFrames, handling different columns."""
    if not dfs:
        return pd.DataFrame()
    return pd.concat(dfs, ignore_index=True, sort=False)


def filter_allowed_severity(df: pd.DataFrame) -> pd.DataFrame:
    """Filter to only High, Medium, Low severity (exclude Critical)."""
    allowed_severity = ['High', 'Medium', 'Low']
    if 'Severity' in df.columns:
        return df[df['Severity'].isin(allowed_severity)]
    return df


def normalize_status(df: pd.DataFrame, source_folder: str = None) -> pd.DataFrame:
    """
    Normalize 'Progr.Stat.' to standard Open / Resolve / Close values.
    Handles Employee UT where the 'Resolve' column overrides 'Progr.Stat.'.
    """
    df = df.copy()

    if source_folder == 'employee_ut' and "Resolve" in df.columns:
        resolve_mapping = {
            'Close':      'Close',
            'Resolve':    'Resolve',
            'Not Resolve':'Open',
            'Reviewed':   'Open',
        }
        if "Progr.Stat." not in df.columns:
            df["Progr.Stat."] = df["Resolve"].map(resolve_mapping)
        else:
            df["Progr.Stat."] = df["Resolve"].map(resolve_mapping).fillna(df["Progr.Stat."])

    if "Progr.Stat." in df.columns:
        df["Progr.Stat."] = df["Progr.Stat."].astype(str).apply(lambda x:
            "Resolve" if x.startswith("Resolve") else
            "Close"   if x.startswith("Close")   else
            "Open"    if x.startswith("Open")     else x
        )

    return df


def filter_open_resolve(df: pd.DataFrame) -> pd.DataFrame:
    """Keep only Open and Resolve rows (exclude Close and other statuses)."""
    if "Progr.Stat." not in df.columns:
        return df
    return df[df["Progr.Stat."].astype(str).apply(
        lambda x: x.startswith("Open") or x.startswith("Resolve")
    )]


# ===========================================================================
#  KPI COMPUTATION
# ===========================================================================

def _load_analytics_json(base_path: str, folder_name: str) -> dict:
    """
    Load analytics.json generated by pandas_aggregator for a given source folder.
    Returns the parsed dict, or {} if not found.
    """
    candidates = [
        Path(base_path) / folder_name / 'analytics.json',
        Path('./downloads') / folder_name / 'analytics.json',
    ]
    for path in candidates:
        if path.exists():
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
    return {}


def _severity_dist_from_updated_tier(rows: list) -> dict:
    """
    Build severity_distribution from updated_tier on each row.

    Mapping (same as pandas_aggregator):
        updated_tier = Severe              → High   bucket
        updated_tier = Moderate            → Medium bucket
        updated_tier = Low/Deferred/
                       Excluded/other      → Low    bucket

    open / resolve / close counted from Progr.Stat. on each row.

    Returns:
        {
            'High':   { total, open, resolve, close },
            'Medium': { total, open, resolve, close },
            'Low':    { total, open, resolve, close },
        }
    """
    dist = {
        'High':   {'total': 0, 'open': 0, 'resolve': 0, 'close': 0},
        'Medium': {'total': 0, 'open': 0, 'resolve': 0, 'close': 0},
        'Low':    {'total': 0, 'open': 0, 'resolve': 0, 'close': 0},
    }
    for rec in rows:
        ut = str(rec.get('updated_tier', '')).strip()
        st = str(rec.get('Progr.Stat.', '')).lower()

        if ut == 'Severe':
            bucket = 'High'
        elif ut == 'Moderate':
            bucket = 'Medium'
        else:                        # Low / Deferred / Excluded / anything else
            bucket = 'Low'

        dist[bucket]['total'] += 1
        if st.startswith('open'):
            dist[bucket]['open']    += 1
        elif st.startswith('resolve'):
            dist[bucket]['resolve'] += 1
        elif st.startswith('close'):
            dist[bucket]['close']   += 1

    return dist


def compute_central_kpis(data: dict) -> tuple:
    """
    Compute KPIs for each source using updated_tier from analytics.json rows.

    Source of truth: analytics.json generated by pandas_aggregator.
    Each row already has updated_tier computed after High scale-down:
        updated_tier=Severe   → High   bucket
        updated_tier=Moderate → Medium bucket
        updated_tier=Low/Deferred/Excluded → Low bucket

    Falls back to scoring from raw dataframes if analytics.json is not found.
    Returns (kpis_dict, total_status_counts_dict).
    """
    kpis = {}
    processor_map = {
        'employee_ut':    'EMPLOYEE UT',
        'global_voc_plm': 'Global VOC PLM',
        'beta_ut':        'Beta UT',
    }
    total_status_counts = {'Open': 0, 'Close': 0, 'Resolve': 0}
    base_path = './downloads'

    for folder, dfs in data.items():
        if folder not in processor_map:
            continue

        # ── Try reading analytics.json (has updated_tier on every row) ───
        analytics = _load_analytics_json(base_path, folder)
        rows      = analytics.get('rows', [])

        if rows and any('updated_tier' in r for r in rows[:10]):
            # ── PRIMARY: build from updated_tier on analytics.json rows ──
            sev_dist = _severity_dist_from_updated_tier(rows)

            # Status counts from ALL rows (open+resolve+close)
            status_counts = {'Open': 0, 'Close': 0, 'Resolve': 0}
            for rec in rows:
                st = str(rec.get('Progr.Stat.', '')).lower()
                if st.startswith('open'):
                    status_counts['Open']    += 1
                elif st.startswith('resolve'):
                    status_counts['Resolve'] += 1
                elif st.startswith('close'):
                    status_counts['Close']   += 1

            total = len(rows)

            # High entry for dashboard: full breakdown dict
            high_entry = {
                'total':    sev_dist['High']['total'],
                'severe':   sev_dist['High']['total'],   # all High = Severe-tier
                'moderate': 0,
                'deferred': 0,
            }

        else:
            # ── FALLBACK: score from raw dataframes (no analytics.json) ──
            import sys
            sys.stderr.write(
                f"  [WARN] {folder}: analytics.json missing or has no updated_tier - falling back to raw scoring\n"
            )
            combined = combine_dataframes(dfs)
            combined = filter_allowed_severity(combined)
            combined = normalize_status(combined, folder)
            combined_open_resolve = filter_open_resolve(combined)

            total = len(combined_open_resolve)

            severity_counts = {'High': 0, 'Medium': 0, 'Low': 0}
            if 'Severity' in combined_open_resolve.columns:
                severity_series = combined_open_resolve['Severity'].value_counts()
                for sev in severity_counts:
                    severity_counts[sev] = int(severity_series.get(sev, 0))

                if severity_counts['High'] > 0:
                    # Use first Excel file in folder for scoring fallback
                    folder_path = Path(base_path) / folder
                    excel_files = list(folder_path.glob('*.xlsx'))
                    if excel_files:
                        high_breakdown = get_high_severity_breakdown(str(excel_files[0]))
                    else:
                        high_breakdown = {"total": severity_counts['High'], "severe": 0,
                                          "moderate": 0, "deferred": severity_counts['High']}
                    moved_to_medium = (
                        high_breakdown.get('moderate', 0) +
                        high_breakdown.get('deferred', 0)
                    )
                    high_entry = high_breakdown
                    severity_counts['High']   = high_breakdown
                    severity_counts['Medium'] = severity_counts['Medium'] + moved_to_medium
                else:
                    high_entry = {'total': 0, 'severe': 0, 'moderate': 0, 'deferred': 0}

            sev_dist = {
                'High':   {'total': severity_counts['High'] if isinstance(severity_counts['High'], int) else high_entry.get('severe', 0),
                           'open': 0, 'resolve': 0, 'close': 0},
                'Medium': {'total': severity_counts['Medium'], 'open': 0, 'resolve': 0, 'close': 0},
                'Low':    {'total': severity_counts['Low'],    'open': 0, 'resolve': 0, 'close': 0},
            }

            status_counts = {'Open': 0, 'Close': 0, 'Resolve': 0}
            if "Progr.Stat." in combine_dataframes(dfs).columns:
                combined_all = normalize_status(combine_dataframes(dfs), folder)
                vc = combined_all["Progr.Stat."].value_counts()
                status_counts["Open"]    = int(vc.get("Open",    0))
                status_counts["Close"]   = int(vc.get("Close",   0))
                status_counts["Resolve"] = int(vc.get("Resolve", 0))

        kpis[processor_map[folder]] = {
            'total':                total,
            'High':                 high_entry,
            'Medium':               sev_dist['Medium']['total'],
            'Low':                  sev_dist['Low']['total'],
            'severity_distribution': sev_dist,      # full open/resolve/close breakdown
            'open':                 status_counts['Open'],
            'close':                status_counts['Close'],
            'resolved':             status_counts['Resolve'],
        }

        for key in ('Open', 'Close', 'Resolve'):
            total_status_counts[key] += status_counts[key]

    return kpis, total_status_counts


def compute_merged_severity(kpis: dict) -> dict:
    """
    Merge severity_distribution across all sources using updated_tier counts.
    Reads kpis[source]['severity_distribution'] which is built from updated_tier.
    """
    merged = {
        'High':   {'total': 0, 'open': 0, 'resolve': 0, 'close': 0},
        'Medium': {'total': 0, 'open': 0, 'resolve': 0, 'close': 0},
        'Low':    {'total': 0, 'open': 0, 'resolve': 0, 'close': 0},
    }
    for source_data in kpis.values():
        sd = source_data.get('severity_distribution', {})
        for bucket in ('High', 'Medium', 'Low'):
            entry = sd.get(bucket, {})
            if isinstance(entry, dict):
                for k in ('total', 'open', 'resolve', 'close'):
                    merged[bucket][k] += entry.get(k, 0)
    return merged


# ===========================================================================
#  TOP MODULES / MODELS
# ===========================================================================

_PLM_SOURCES = {'employee_ut', 'global_voc_plm', 'beta_ut'}


def compute_top_modules(data: dict) -> list:
    """Aggregate top 10 modules across all PLM sources (Open/Resolve only)."""
    all_modules = {}
    for folder, dfs in data.items():
        if folder not in _PLM_SOURCES:
            continue
        combined = combine_dataframes(dfs)
        combined = filter_allowed_severity(combined)
        combined = normalize_status(combined, folder)
        combined = filter_open_resolve(combined)
        if 'Module' in combined.columns:
            for module, count in combined['Module'].value_counts().items():
                if pd.notna(module) and str(module).strip():
                    key = str(module).strip()
                    all_modules[key] = all_modules.get(key, 0) + count

    sorted_modules = sorted(all_modules.items(), key=lambda x: x[1], reverse=True)
    return [{"label": mod, "value": int(cnt)} for mod, cnt in sorted_modules[:10]]


def compute_top_models(data: dict) -> list:
    """Top 10 models across all PLM sources (Open/Resolve only, friendly names)."""
    all_models = {}
    for folder, dfs in data.items():
        if folder not in _PLM_SOURCES:
            continue
        combined = combine_dataframes(dfs)
        combined = filter_allowed_severity(combined)
        combined = normalize_status(combined, folder)
        combined = filter_open_resolve(combined)
        if 'Model No.' in combined.columns:
            for model, count in combined['Model No.'].value_counts().items():
                if pd.notna(model) and str(model).strip():
                    friendly = apply_model_name_mapping(str(model).strip())
                    all_models[friendly] = all_models.get(friendly, 0) + count

    sorted_models = sorted(all_models.items(), key=lambda x: x[1], reverse=True)
    return [{"label": mod, "value": int(cnt)} for mod, cnt in sorted_models[:10]]


def compute_top_models_by_source(data: dict, source_folder: str) -> list:
    """Top 10 models for a specific data source (Open/Resolve only)."""
    new_models = {}
    if source_folder in data:
        combined = combine_dataframes(data[source_folder])
        combined = filter_allowed_severity(combined)
        combined = normalize_status(combined, source_folder)
        combined = filter_open_resolve(combined)
        if 'Model No.' in combined.columns:
            for model, count in combined['Model No.'].value_counts().items():
                if pd.notna(model) and str(model).strip():
                    friendly = apply_model_name_mapping(str(model).strip())
                    new_models[friendly] = new_models.get(friendly, 0) + count

    sorted_models = sorted(new_models.items(), key=lambda x: x[1], reverse=True)
    return [{"label": mod, "value": int(cnt)} for mod, cnt in sorted_models[:10]]


def compute_top_modules_by_source(data: dict, source_folder: str) -> list:
    """Top 10 modules for a specific data source (Open/Resolve only)."""
    new_modules = {}
    if source_folder in data:
        combined = combine_dataframes(data[source_folder])
        combined = filter_allowed_severity(combined)
        combined = normalize_status(combined, source_folder)
        combined = filter_open_resolve(combined)
        if 'Module' in combined.columns:
            for module, count in combined['Module'].value_counts().items():
                if pd.notna(module) and str(module).strip():
                    key = str(module).strip()
                    new_modules[key] = new_modules.get(key, 0) + count

    sorted_modules = sorted(new_modules.items(), key=lambda x: x[1], reverse=True)
    return [{"label": mod, "value": int(cnt)} for mod, cnt in sorted_modules[:10]]


# ===========================================================================
#  HIGH ISSUES LIST
# ===========================================================================

def compute_high_issues(data: dict) -> list:
    """
    Top 10 High-severity issues from the module with the most High bugs.
    Only Severe-tier High issues are included (scale-down applied).
    """
    processor_map = {
        'employee_ut':    'UT',
        'global_voc_plm': 'PLM',
        'beta_ut':        'Beta',
    }

    # Find the module with the most High-severity issues across all sources
    all_modules: dict = {}
    for folder, dfs in data.items():
        combined = combine_dataframes(dfs)
        combined = filter_allowed_severity(combined)
        if 'Module' in combined.columns and 'Severity' in combined.columns:
            high_issues = combined[combined['Severity'].str.lower() == 'high']
            for module, count in high_issues['Module'].value_counts().items():
                if pd.notna(module) and str(module).strip():
                    key = str(module).strip()
                    all_modules[key] = all_modules.get(key, 0) + count

    if not all_modules:
        return []

    max_module = max(all_modules, key=all_modules.__getitem__)

    # Collect High issues from that module
    module_high_issues = []
    for folder, dfs in data.items():
        if folder not in processor_map:
            continue
        combined = combine_dataframes(dfs)
        if 'Severity' not in combined.columns or 'Module' not in combined.columns:
            continue
        high_df = combined[
            (combined['Severity'].str.lower() == 'high') &
            (combined['Module'].str.strip() == max_module)
        ]
        for _, row in high_df.iterrows():
            module_high_issues.append({
                "Model Number": str(row.get('Model No.', '')),
                "Case Code":    str(row.get('Case Code', '')),
                "Module Name":  str(row.get('Module', '')),
                "Title":        str(row.get('Title', '')),
                "Processor":    processor_map[folder],
            })

    return module_high_issues[:10]


# ===========================================================================
#  MODEL × MODULE MATRIX
# ===========================================================================

def compute_model_module_matrix(data: dict) -> dict:
    """Matrix of Top 10 Models × Top 10 Modules with issue counts."""
    top_models  = compute_top_models(data)
    top_modules = compute_top_modules(data)
    model_names  = [item['label'] for item in top_models]
    module_names = [item['label'] for item in top_modules]

    matrix = []
    for model in model_names:
        row = []
        for module in module_names:
            count = 0
            for folder, dfs in data.items():
                if folder not in _PLM_SOURCES:
                    continue
                combined = combine_dataframes(dfs)
                combined = filter_allowed_severity(combined)
                combined = normalize_status(combined, folder)
                combined = filter_open_resolve(combined)
                if 'Model No.' in combined.columns and 'Module' in combined.columns:
                    count += len(combined[
                        (combined['Model No.'].astype(str).str.strip() == model.strip()) &
                        (combined['Module'].astype(str).str.strip()    == module.strip())
                    ])
            row.append(count)
        matrix.append(row)

    return {'models': model_names, 'modules': module_names, 'matrix': matrix}


# ===========================================================================
#  SOURCE MODEL SUMMARY
# ===========================================================================

def clean_excel_text(text: str) -> str:
    """Clean text from Excel that may contain unwanted control characters."""
    if not isinstance(text, str):
        return str(text) if text is not None else ""
    cleaned = text.replace("_x000D_", " ").replace("_x000A_", " ").replace("_x0009_", " ")
    return " ".join(cleaned.split()).strip()


def compute_source_model_summary(data: dict) -> list:
    """
    Summary table: Source × Model with top 5 modules, issue count, top 5 titles.
    """
    source_map = {
        'employee_ut':    'EMPLOYEE UT',
        'global_voc_plm': 'Global VOC PLM',
        'beta_ut':        'Beta UT',
    }
    summary = []

    for folder, dfs in data.items():
        if folder not in source_map:
            continue
        source_name = source_map[folder]
        combined = combine_dataframes(dfs)
        combined = filter_allowed_severity(combined)
        combined = normalize_status(combined, folder)
        combined = filter_open_resolve(combined)
        if 'Model No.' not in combined.columns:
            continue

        for model, total_count in combined['Model No.'].value_counts().head(5).items():
            if not (pd.notna(model) and str(model).strip()):
                continue
            model_str  = str(model).strip()
            model_data = combined[combined['Model No.'].astype(str).str.strip() == model_str]

            top_modules: list = []
            if 'Module' in model_data.columns:
                top_modules = [
                    str(m).strip() for m in model_data['Module'].value_counts().head(5).index
                    if pd.notna(m)
                ]

            top_titles: list = []
            if top_modules:
                for mod in top_modules:
                    mod_issues = model_data[model_data['Module'].astype(str).str.strip() == mod]
                    if not mod_issues.empty:
                        first = mod_issues.iloc[0]
                        case_code = str(first.get('Case Code', '')).strip()
                        title     = str(first.get('Title', '')).strip()
                        if source_name == 'VOC' and 'content' in first:
                            title = clean_excel_text(str(first.get('content', '')))
                        top_titles.append(
                            f"{case_code} : {title}" if (case_code and title)
                            else f"Unknown : {title or 'Unknown Title'}"
                        )
                    else:
                        top_titles.append(f"Unknown : No issues found for {mod}")
            else:
                if source_name == 'VOC' and 'content' in model_data.columns:
                    top_titles = [
                        clean_excel_text(str(c))
                        for c in model_data['content'].value_counts().head(5).index
                        if pd.notna(c)
                    ]
                elif 'Title' in model_data.columns:
                    top_titles = [
                        str(t).strip()
                        for t in model_data['Title'].value_counts().head(5).index
                        if pd.notna(t)
                    ]

            entry = {
                'source':      source_name,
                'model':       model_str,
                'issue_count': int(total_count),
                'top_titles':  top_titles,
            }
            if source_name != 'VOC':
                entry['top_modules'] = top_modules
            summary.append(entry)

    summary.sort(key=lambda x: (x['source'], -x['issue_count']))
    return summary


# ===========================================================================
#  ENTRY POINT
# ===========================================================================

if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        command = sys.argv[1]
        data = load_all_excels("./downloads")
        dispatch = {
            "top-models-beta": lambda: compute_top_models_by_source(data, 'beta_user_issues'),
            "top-models-plm":  lambda: compute_top_models_by_source(data, 'global_voc_plm'),
            "top-models-voc":  lambda: compute_top_models_by_source(data, 'samsung_members_voc'),
            "matrix":          lambda: compute_model_module_matrix(data),
            "summary":         lambda: compute_source_model_summary(data),
        }
        if command in dispatch:
            print(json.dumps(dispatch[command]()))
        else:
            print(json.dumps({"error": f"Unknown command: {command}"}))
        sys.exit(0)

    # Default: return full analytics payload
    base_path = "./downloads"
    try:
        data = load_all_excels(base_path)
        kpis, status_kpis       = compute_central_kpis(data)
        top_modules             = compute_top_modules(data)
        top_models              = compute_top_models(data)
        high_issues             = compute_high_issues(data)
        model_module_matrix     = compute_model_module_matrix(data)
        source_model_summary    = compute_source_model_summary(data)
        filtered_top_models     = {
            folder: compute_top_models_by_source(data, folder)
            for folder in ('employee_ut', 'global_voc_plm', 'beta_ut')
        }

        total_issues = sum(kpis[s]['total'] for s in kpis)

        # high_issues_count = updated_tier=Severe rows across all sources
        high_issues_count = sum(
            kpis[s].get('severity_distribution', {}).get('High', {}).get('total', 0)
            for s in kpis
        )

        response = {
            "kpis": kpis,
            "status_kpis": {
                "open":     status_kpis["Open"],
                "close":    status_kpis["Close"],
                "resolved": status_kpis["Resolve"],
            },
            "total_issues":       total_issues,
            "high_issues_count":  high_issues_count,
            "top_modules":        top_modules,
            "top_models":         top_models,
            "high_issues":        high_issues,
            "model_module_matrix":  model_module_matrix,
            "source_model_summary": source_model_summary,
            "filtered_top_models":  filtered_top_models,
        }

        print(json.dumps(sanitize_nan(response)))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
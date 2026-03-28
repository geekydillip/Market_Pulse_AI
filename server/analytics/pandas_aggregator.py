import pandas as pd
import os
import sys
import json
import math
from pathlib import Path
from datetime import date, datetime

# Prevent HuggingFace Hub from pinging the network for updates, avoiding timeouts
os.environ["HF_HUB_OFFLINE"] = "1"

_THIS_DIR     = Path(__file__).resolve().parent
_PROJECT_ROOT = _THIS_DIR.parent.parent

if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

from extract_criticality import extract_criticality_data
from excel_cleaner import clean_model_number


def load_model_name_mappings():
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


def sanitize_nan(obj):
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
    if not sw_ver or not isinstance(sw_ver, str) or len(sw_ver) < 5:
        return sw_ver
    return 'SM-' + sw_ver[:5]


def transform_model_names(df):
    """
    Transform Model No. column for OS Beta and Global VOC entries using S/W Ver.
    Also remove prefixes from model names using excel_cleaner.
    """
    if 'Model No.' in df.columns:
        # Apply transformation where Model No. starts with "[OS Beta]" or "[Global VOC]"
        if 'S/W Ver.' in df.columns:
            mask_os_beta = df['Model No.'].astype(str).str.startswith('[OS Beta]').fillna(False)
            mask_global_voc = df['Model No.'].astype(str).str.startswith('[Global VOC]').fillna(False)
            mask_to_transform = mask_os_beta | mask_global_voc
            df.loc[mask_to_transform, 'Model No.'] = df.loc[mask_to_transform, 'S/W Ver.'].apply(derive_model_name_from_sw_ver)
        
        # Strip prefixes using centralized logic
        df['Model No.'] = df['Model No.'].apply(clean_model_number)
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
            sys.stderr.write(f"Loaded {len(df)} rows from {excel_file.name}\n")
        except Exception as e:
            sys.stderr.write(f"Warning: Failed to load {excel_file.name}: {e}\n")

    if not dfs:
        raise FileNotFoundError(f"Failed to load any Excel files from {folder_path}")

    combined_df = pd.concat(dfs, ignore_index=True, sort=False)
    sys.stderr.write(f"Combined {len(dfs)} files, total {len(combined_df)} rows\n")

    if len(combined_df) > 10000:
        for col in combined_df.select_dtypes(include=['int64']):
            combined_df[col] = pd.to_numeric(combined_df[col], downcast='integer')
        for col in combined_df.select_dtypes(include=['float64']):
            combined_df[col] = pd.to_numeric(combined_df[col], downcast='float')

    return combined_df


# ── Schema detection ──────────────────────────────────────────────────────────
# VOC schema  : has 'Status' + 'Category' columns, no 'Progr.Stat.' / 'Severity'
# Issue schema: has 'Progr.Stat.' + 'Severity' columns
def _is_voc_schema(df: pd.DataFrame) -> bool:
    cols = set(df.columns)
    return 'Status' in cols and 'Category' in cols and 'Progr.Stat.' not in cols


# ── VOC status normalisation ──────────────────────────────────────────────────
# VOC uses:  OPENED / PROCESSING / RESOLVED / CLOSED
# Map to the same Open / Resolve / Close buckets used everywhere else
def _normalize_voc_status(val: str) -> str:
    v = str(val).upper()
    if v in ('OPENED', 'PROCESSING'):
        return 'Open'
    elif v == 'RESOLVED':
        return 'Resolve'
    elif v == 'CLOSED':
        return 'Close'
    return 'Other'


def _is_voc_file(path) -> bool:
    """
    Peek at column headers only (no full load) to decide if this is a VOC file.
    Avoids passing VOC files into extract_criticality_data() which cannot handle them.
    """
    try:
        headers = pd.read_excel(str(path), nrows=0).columns.tolist()
        col_set = set(headers)
        return 'Status' in col_set and 'Category' in col_set and 'Progr.Stat.' not in col_set
    except Exception:
        return False


def _build_severity_distribution(excel_paths: list) -> tuple:
    """
    Issue-schema files only — delegate scoring to extract_criticality.
    VOC files are silently skipped.

    Reads the new flat severity_breakdown from extract_criticality_data():
      severity_breakdown = {
          'High':   { total, open, resolve, close,
                      moved_to_medium: {moderate, deferred} },
          'Medium': { total, open, resolve, close },
          'Low':    { total, open, resolve, close },
      }

    Merges these directly into severity_dist (same shape, accumulated
    across all Excel files in the folder).

    Returns: (severity_dist_dict, scored_rows_list)
      severity_dist_dict : { 'High': {total,open,resolve,close},
                              'Medium': {...}, 'Low': {...} }
      scored_rows_list   : list of scored issue dicts (for tier merge on rows)
    """
    severity_dist   = {}
    all_scored_rows = []

    def _empty_bucket():
        return {'total': 0, 'open': 0, 'resolve': 0, 'close': 0}

    def _add(dest: dict, key: str, src: dict):
        if key not in dest:
            dest[key] = _empty_bucket()
        for k in ('total', 'open', 'resolve', 'close'):
            dest[key][k] += src.get(k, 0)

    for path in excel_paths:
        if _is_voc_file(path):
            sys.stderr.write(f"  [VOC]   Skipping VOC file: {Path(path).name}\n")
            continue
        try:
            result = extract_criticality_data(str(path))
        except Exception as e:
            sys.stderr.write(f"Warning: extract_criticality_data failed for {path}: {e}\n")
            continue

        all_scored_rows.extend(result.get('issues', []))

        # ── New flat severity_breakdown: keys are Title-case High/Medium/Low ──
        sev_breakdown = result.get('severity_breakdown', {})
        for sev_key in ('High', 'Medium', 'Low'):
            entry = sev_breakdown.get(sev_key)
            if not entry:
                continue
            # Entry is already flat: {total, open, resolve, close}
            _add(severity_dist, sev_key, {
                'total':   entry.get('total',   0),
                'open':    entry.get('open',    0),
                'resolve': entry.get('resolve', 0),
                'close':   entry.get('close',   0),
            })

    return severity_dist, all_scored_rows


def _build_voc_status_distribution(df: pd.DataFrame) -> dict:
    """
    VOC schema: count Open / Resolve / Close from the 'Status' column.
    Returns the same shape as the issue-schema status_distribution so the
    rest of the pipeline (open_issues / resolved_issues / close_issues) works
    identically for both schemas.
    """
    if 'Status' not in df.columns:
        return {}
    normalised = df['Status'].astype(str).apply(_normalize_voc_status)
    return normalised.value_counts().to_dict()


def compute_kpis(df: pd.DataFrame, excel_paths: list = None) -> dict:
    """
    Build KPIs for both schemas.

    Issue schema  → uses Progr.Stat., Severity, Source
    VOC schema    → uses Status, Category, CSC
    Both produce the same output keys so the rest of the pipeline is unchanged.

    SCALE-DOWN (issue schema only):
    ────────────────────────────────
    severity_distribution['High']   = scaled total (Severe-tier only)
    severity_distribution['Medium'] = original Medium + High's Moderate + High's Deferred
    severity_distribution['Low']    = unchanged

    The Severe/Moderate/Deferred tier keys are also kept for backward compat.
    """
    total_rows    = len(df)
    unique_models = df['Model No.'].nunique() if 'Model No.' in df.columns else 0

    voc = _is_voc_schema(df)

    # ── category distribution ─────────────────────────────────────────────────
    if voc:
        category_dist = df['Category'].value_counts().to_dict() if 'Category' in df.columns else {}
    else:
        category_dist = df['Module'].value_counts().to_dict() if 'Module' in df.columns else {}

    # ── source distribution ───────────────────────────────────────────────────
    if voc:
        source_dist = df['CSC'].value_counts().to_dict() if 'CSC' in df.columns else {}
    else:
        source_dist = df['Source'].value_counts().to_dict() if 'Source' in df.columns else {}

    # ── status distribution + open/resolved/close counts ─────────────────────
    if voc:
        status_dist     = _build_voc_status_distribution(df)
        open_issues     = status_dist.get('Open',    0)
        resolved_issues = status_dist.get('Resolve', 0)
        close_issues    = status_dist.get('Close',   0)
    else:
        status_dist = df['Progr.Stat.'].value_counts().to_dict() if 'Progr.Stat.' in df.columns else {}
        open_issues     = int(df['Progr.Stat.'].eq('Open').sum())                if 'Progr.Stat.' in df.columns else 0
        resolved_issues = int(df['Progr.Stat.'].str.startswith('Resolve').sum()) if 'Progr.Stat.' in df.columns else 0
        close_issues    = int(df['Progr.Stat.'].eq('Close').sum())               if 'Progr.Stat.' in df.columns else 0

    # ── severity distribution ─────────────────────────────────────────────────
    if voc:
        # VOC: group by Issue Type, map Status → open/resolve/close
        if 'Issue Type' in df.columns and 'Status' in df.columns:
            norm_status = df['Status'].astype(str).apply(_normalize_voc_status)
            severity_dist = {}
            for issue_type, grp in df.groupby(df['Issue Type'].fillna('Other')):
                grp_status = norm_status.loc[grp.index]
                severity_dist[str(issue_type)] = {
                    'total':   len(grp),
                    'open':    int((grp_status == 'Open').sum()),
                    'resolve': int((grp_status == 'Resolve').sum()),
                    'close':   int((grp_status == 'Close').sum()),
                }
        else:
            severity_dist = {}
        scored_rows = []
    else:
        if excel_paths:
            # _build_severity_distribution returns severity_dist with scale-down
            # already applied: High=Severe-tier-only, Medium=original+moved, Low=unchanged
            severity_dist, scored_rows = _build_severity_distribution(excel_paths)
        else:
            raw = df['Severity'].value_counts().to_dict() if 'Severity' in df.columns else {}
            severity_dist = {k: {'total': v, 'open': 0, 'resolve': 0, 'close': 0}
                             for k, v in raw.items()}
            scored_rows = []

    return {
        "total_rows":            total_rows,
        "unique_models":         unique_models,
        "category_distribution": category_dist,
        "severity_distribution": severity_dist,
        "status_distribution":   status_dist,
        "source_distribution":   source_dist,
        "open_issues":           open_issues,
        "resolved_issues":       resolved_issues,
        "close_issues":          close_issues,
        "schema":                "voc" if voc else "issue",
        "scored_rows":           scored_rows,
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
    Auto-detects VOC vs issue schema per file.

    save_to_file=True  (default): write analytics.json into the folder.
    save_to_file=False:           print JSON to stdout only (--stdout-only mode).

    SCALE-DOWN (issue schema):
    ──────────────────────────
    severity_distribution['High']   = Severe-tier count only
    severity_distribution['Medium'] = original Medium + High's Moderate + High's Deferred
    This is transparently handled by _build_severity_distribution() via
    extract_criticality's severity_breakdown output.

    high_issues KPI = severity_distribution['High']['total'] (scaled)
    """
    folder      = Path(folder_path)
    folder_name = folder.name

    excel_paths = list(folder.glob("*.xlsx")) + list(folder.glob("*.xls"))
    if not excel_paths:
        msg = f"No Excel files found in {folder_name}/"
        sys.stderr.write(f"  [SKIP]  {folder_name}/ — no Excel files found\n")
        if not save_to_file:
            print(json.dumps({"error": msg}))
        return False

    try:
        df = load_all_excels(folder_path)
        df = transform_model_names(df)

        voc = _is_voc_schema(df)
        sys.stderr.write(f"  Schema: {'VOC' if voc else 'Issue'}\n")

        # Pass excel_paths only for issue schema (extract_criticality needs them)
        kpis = compute_kpis(df, excel_paths=(None if voc else excel_paths))

        top_models = group_by_column(df, 'Model No.')
        for m in top_models:
            m['friendly_name'] = map_model_name(m['label'])

        # VOC uses Category as primary grouping; issue schema uses Module
        categories = group_by_column(df, 'Category' if voc else 'Module')

        time_data = time_series(df, 'Date') if 'Date' in df.columns else []

        # ── Merge tier scores back onto raw rows ───────────────────────────
        # extract_criticality scores each issue and assigns a 'tier'
        # (Severe / Moderate / Deferred) + 'criticality_score'.
        # The frontend tier-drill modal uses r.tier to filter which rows
        # belong to each tier bucket.  Without this merge, the modal falls
        # back to r.Severity which maps High→Severe, Medium→Moderate — WRONG
        # because a High-severity issue can score as Moderate or Deferred.
        #
        # NOTE: After scale-down, High issues that scored as Moderate or
        # Deferred still retain their original 'tier' value in the row data
        # (e.g. tier='Moderate') so the frontend drill-down correctly shows
        # them in the Moderate bucket — consistent with where they were moved.
        #
        # Join key: 'Case Code' (unique issue identifier, present in both
        # the raw df and the extract_criticality scored output).
        scored_rows = kpis.get("scored_rows", [])
        if scored_rows and not voc:
            # Build lookup: Case Code → {tier, criticality_score}
            tier_lookup = {
                str(r.get('Case Code', '')).strip(): {
                    'tier':              r.get('tier', ''),
                    'criticality_score': r.get('criticality_score', None),
                }
                for r in scored_rows
                if r.get('Case Code')
            }
            rows = []
            for rec in df.to_dict('records'):
                cc = str(rec.get('Case Code', '')).strip()
                scored = tier_lookup.get(cc, {})
                rec['tier']              = scored.get('tier', 'Deferred')
                rec['criticality_score'] = scored.get('criticality_score', None)
                # ── Compute updated_tier (scale-down applied) ──────────────
                # Same rules as export_moved_issues_updated_file:
                #   High  + Severe   → updated_tier = Severe   (kept)
                #   High  + Moderate → updated_tier = Moderate (moved)
                #   High  + Low      → updated_tier = Deferred (moved)
                #   High  + Excluded → updated_tier = Deferred (moved)
                #   Medium + Severe  → updated_tier = Moderate (scaled down)
                #   All others       → updated_tier = tier     (unchanged)
                sev  = str(rec.get('Severity', '')).strip()
                tier = str(rec.get('tier',     '')).strip()
                if sev == 'High':
                    if tier == 'Severe':
                        rec['updated_tier'] = 'Severe'
                    elif tier == 'Moderate':
                        rec['updated_tier'] = 'Moderate'
                    else:
                        rec['updated_tier'] = 'Deferred'
                elif sev == 'Medium' and tier == 'Severe':
                    rec['updated_tier'] = 'Moderate'
                else:
                    rec['updated_tier'] = tier
                rows.append(rec)
        else:
            rows = df.to_dict('records')
            # VOC rows: add schema-appropriate tier proxy using Issue Type
            if voc:
                for rec in rows:
                    rec['tier']         = rec.get('Issue Type', 'Other')
                    rec['updated_tier'] = rec.get('Issue Type', 'Other')

        # ── Recompute severity_distribution from updated_tier on rows ───────
        # updated_tier is the single source of truth after scale-down:
        #   Severe                      → High   bucket
        #   Moderate                    → Medium bucket
        #   Low / Deferred / Excluded   → Low    bucket
        # Progr.Stat. is used to split open / resolve / close per bucket.
        if not voc:
            _sev_dist = {
                'High':   {'total': 0, 'open': 0, 'resolve': 0, 'close': 0},
                'Medium': {'total': 0, 'open': 0, 'resolve': 0, 'close': 0},
                'Low':    {'total': 0, 'open': 0, 'resolve': 0, 'close': 0},
            }
            for rec in rows:
                ut  = str(rec.get('updated_tier', '')).strip()
                st  = str(rec.get('Progr.Stat.', '')).lower()
                if ut == 'Severe':
                    bucket = 'High'
                elif ut == 'Moderate':
                    bucket = 'Medium'
                else:                          # Low / Deferred / Excluded / anything else
                    bucket = 'Low'
                _sev_dist[bucket]['total'] += 1
                if st.startswith('open'):
                    _sev_dist[bucket]['open']    += 1
                elif st.startswith('resolve'):
                    _sev_dist[bucket]['resolve'] += 1
                elif st.startswith('close'):
                    _sev_dist[bucket]['close']   += 1
            severity_distribution = _sev_dist
            high_issues = severity_distribution['High']['total']
        else:
            severity_distribution = kpis["severity_distribution"]
            high_issues = kpis["open_issues"]

        response = {
            "kpis": {
                "total_rows":            kpis["total_rows"],
                "unique_models":         kpis["unique_models"],
                "high_issues":           high_issues,
                "severity_distribution": severity_distribution,
                "source_distribution":   kpis["source_distribution"],
                "open_issues":           kpis["open_issues"],
                "resolved_issues":       kpis["resolved_issues"],
                "close_issues":          kpis["close_issues"],
                "schema":                kpis["schema"],
            },
            "top_models": top_models,
            "categories": categories,
            "rows":        rows,
        }
        if time_data:
            response["time_series"] = time_data

        response = sanitize_nan(response)

        if save_to_file:
            json_path = folder / "analytics.json"
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(response, f, indent=2)
            sys.stderr.write(
                f"  [OK]    {folder_name}/analytics.json  "
                f"({kpis['total_rows']} rows, schema={'VOC' if voc else 'Issue'})\n"
            )
            # ── Export moved_issues_updated_file.xlsx for issue schema ────
            # Runs export_moved_issues_updated_file on each Excel file in the
            # folder so you can verify which High/Medium rows moved tiers.
            if not voc:
                for excel_path in excel_paths:
                    try:
                        out_path = str(excel_path).replace(
                            excel_path.suffix,
                            '_moved_issues_updated_file.xlsx'
                        )
                        export_moved_issues_updated_file(str(excel_path), out_path)
                    except Exception as _exp_err:
                        sys.stderr.write(
                            f"  [WARN]  Could not export moved issues for "
                            f"{excel_path.name}: {_exp_err}\n"
                        )
        else:
            print(json.dumps(response))

        return True

    except Exception as e:
        import traceback
        sys.stderr.write(f"  [ERROR] {folder_name}/ — {e}\n")
        sys.stderr.write(traceback.format_exc())
        if not save_to_file:
            print(json.dumps({"error": str(e)}))
        return False


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import shutil

    downloads_root = Path("./downloads")
    downloads_root.mkdir(parents=True, exist_ok=True)

    stdout_only = '--stdout-only' in sys.argv
    save_json   = not stdout_only

    args = [a for a in sys.argv[1:] if not a.startswith('--')]

    if args:
        target_folders = []

        for file_arg in args:
            file_path = Path(file_arg)

            if not file_path.suffix:
                folder = downloads_root / file_path.name
                if folder.is_dir():
                    target_folders.append(folder)
                else:
                    sys.stderr.write(
                        f"ERROR: '{file_arg}' is not a file and "
                        f"'{folder}' folder does not exist.\n"
                    )
                    sys.exit(1)
                continue

            if not file_path.exists():
                sys.stderr.write(f"ERROR: file not found — {file_path}\n")
                sys.exit(1)

            folder_name = file_path.stem.lower().replace(' ', '_')
            folder      = downloads_root / folder_name
            folder.mkdir(parents=True, exist_ok=True)

            dest = folder / file_path.name
            if dest.resolve() != file_path.resolve():
                shutil.copy2(file_path, dest)
                sys.stderr.write(f"  [COPY]  {file_path.name} -> {folder}/\n")

            target_folders.append(folder)

    else:
        target_folders = sorted([
            p for p in downloads_root.iterdir()
            if p.is_dir() and p.name not in _SKIP_FOLDERS
        ])
        if not target_folders:
            sys.stderr.write("No subfolders found in ./downloads/\n")
            sys.exit(1)

    sys.stderr.write(
        f"\nProcessing {len(target_folders)} folder(s) inside {downloads_root}/\n\n"
    )

    ok = failed = 0
    for folder in target_folders:
        success = _process_folder(str(folder), save_to_file=save_json)
        ok     += int(success)
        failed += int(not success)

    sys.stderr.write(f"\nDone — {ok} succeeded, {failed} failed/skipped.\n\n")

    if failed and not ok:
        sys.exit(1)
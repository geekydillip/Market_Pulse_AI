import pandas as pd
import os
import json
import math
from pathlib import Path

def sanitize_nan(obj):
    """
    Recursively replace NaN values with None for JSON serialization
    """
    if isinstance(obj, float) and math.isnan(obj):
        return None
    elif isinstance(obj, dict):
        return {k: sanitize_nan(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [sanitize_nan(item) for item in obj]
    else:
        return obj

def load_all_excels(base_path: str) -> dict:
    """
    Load all Excel files from subfolders under base_path, grouped by folder.
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
                    try:
                        df = pd.read_excel(excel)
                        dfs.append(df)
                    except Exception as e:
                        print(f"Warning: Failed to load {excel}: {e}")
                if dfs:
                    data[folder.name] = dfs
    return data

def combine_dataframes(dfs: list) -> pd.DataFrame:
    """
    Combine list of DataFrames, handling different columns.
    """
    if not dfs:
        return pd.DataFrame()
    return pd.concat(dfs, ignore_index=True, sort=False)

def compute_central_kpis(data: dict) -> dict:
    """
    Compute KPIs for each processor type.
    """
    kpis = {}
    processor_map = {
        'beta_user_issues': 'Beta User Issues',
        'samsung_members_plm': 'Samsung Members PLM',
        'samsung_members_voc': 'Samsung Members VOC'
    }
    for folder, dfs in data.items():
        if folder in processor_map:
            combined = combine_dataframes(dfs)
            total = len(combined)
            kpis[processor_map[folder]] = total
    return kpis

def compute_top_modules(data: dict) -> list:
    """
    Aggregate top 10 modules across all data.
    """
    all_modules = {}
    for folder, dfs in data.items():
        combined = combine_dataframes(dfs)
        if 'Module' in combined.columns:
            modules = combined['Module'].value_counts()
            for module, count in modules.items():
                if pd.notna(module) and str(module).strip():
                    module_str = str(module).strip()
                    all_modules[module_str] = all_modules.get(module_str, 0) + count
    sorted_modules = sorted(all_modules.items(), key=lambda x: x[1], reverse=True)
    return [{"label": mod, "value": int(cnt)} for mod, cnt in sorted_modules[:10]]

def compute_series_distribution(data: dict) -> list:
    """
    Distribution by processor type (Beta User, PLM, VOC).
    """
    series_map = {
        'beta_user_issues': 'Beta User',
        'samsung_members_plm': 'PLM',
        'samsung_members_voc': 'VOC'
    }
    distribution = {}
    for folder, dfs in data.items():
        if folder in series_map:
            combined = combine_dataframes(dfs)
            total = len(combined)
            distribution[series_map[folder]] = total
    return [{"label": ser, "value": cnt} for ser, cnt in distribution.items()]

def compute_top_models(data: dict) -> list:
    """
    Top 10 models by issue count across all data.
    """
    all_models = {}
    for folder, dfs in data.items():
        combined = combine_dataframes(dfs)
        if 'Model No.' in combined.columns:
            models = combined['Model No.'].value_counts()
            for model, count in models.items():
                if pd.notna(model) and str(model).strip():
                    model_str = str(model).strip()
                    all_models[model_str] = all_models.get(model_str, 0) + count
    sorted_models = sorted(all_models.items(), key=lambda x: x[1], reverse=True)
    return [{"label": mod, "value": int(cnt)} for mod, cnt in sorted_models[:10]]

def compute_high_issues(data: dict) -> list:
    """
    Top 10 high issues from the module with maximum issue count.
    Filter by Severity == 'High', include processor type, take first 10 from max-issue module.
    """
    processor_map = {
        'beta_user_issues': 'Beta',
        'samsung_members_plm': 'PLM',
        'samsung_members_voc': 'VOC'
    }

    # First, find the module with maximum issue count
    all_modules = {}
    for folder, dfs in data.items():
        combined = combine_dataframes(dfs)
        if 'Module' in combined.columns:
            modules = combined['Module'].value_counts()
            for module, count in modules.items():
                if pd.notna(module) and str(module).strip():
                    module_str = str(module).strip()
                    all_modules[module_str] = all_modules.get(module_str, 0) + count

    if not all_modules:
        return []

    # Get the module with maximum issues
    max_issue_module = max(all_modules.items(), key=lambda x: x[1])[0]

    # Now collect high issues only from this module
    module_high_issues = []
    for folder, dfs in data.items():
        if folder in processor_map:
            combined = combine_dataframes(dfs)
            if 'Severity' in combined.columns and 'Module' in combined.columns:
                # Filter for high severity AND the max issue module
                high_df = combined[
                    (combined['Severity'].str.lower() == 'high') &
                    (combined['Module'].str.strip() == max_issue_module)
                ]
                for _, row in high_df.iterrows():
                    issue = {
                        "Model Number": str(row.get('Model No.', '')) or '',
                        "Case Code": str(row.get('Case Code', '')) or '',
                        "Module Name": str(row.get('Module', '')) or '',
                        "Title": str(row.get('Title', '')) or '',
                        "Processor": processor_map[folder]
                    }
                    module_high_issues.append(issue)

    return module_high_issues[:10]

if __name__ == "__main__":
    base_path = "./downloads"
    try:
        data = load_all_excels(base_path)
        kpis = compute_central_kpis(data)
        top_modules = compute_top_modules(data)
        series_distribution = compute_series_distribution(data)
        top_models = compute_top_models(data)
        high_issues = compute_high_issues(data)

        response = {
            "kpis": kpis,
            "top_modules": top_modules,
            "series_distribution": series_distribution,
            "top_models": top_models,
            "high_issues": high_issues
        }

        # Sanitize NaN values
        response = sanitize_nan(response)

        print(json.dumps(response))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        import sys
        sys.exit(1)

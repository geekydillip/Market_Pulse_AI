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
    Aggregate top 10 modules from Beta User Issues, Samsung Members PLM, and Samsung Members VOC only.
    """
    # Only include data from these three sources
    included_folders = {'beta_user_issues', 'samsung_members_plm', 'samsung_members_voc'}

    all_modules = {}
    for folder, dfs in data.items():
        if folder in included_folders:  # Only process specified folders
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
    Distribution by series type.
    For samsung_members_voc and plm_issues: uses 'Model No.' with SM- prefixed logic.
    For beta_user_issues and samsung_members_plm: uses 'S/W Ver.' with new logic.
    """
    def categorize_series(model):
        """Categorize model into series based on Samsung SM- prefixed logic"""
        if not model or not isinstance(model, str):
            return 'Unknown'

        model_upper = model.upper()

        # A Series
        if model_upper.startswith('SM-A'):
            return 'A Series'
        # M Series
        elif model_upper.startswith('SM-M'):
            return 'M Series'
        # E Series (treated as F Series)
        elif model_upper.startswith('SM-E'):
            return 'F Series'
        # Fold & Flip Series (SM-F9, SM-F7)
        elif model_upper.startswith('SM-F9') or model_upper.startswith('SM-F7'):
            return 'Fold & Flip Series'
        # F Series (other SM-F models)
        elif model_upper.startswith('SM-F'):
            return 'F Series'
        # S Series
        elif model_upper.startswith('SM-S') or model_upper.startswith('SM-G'):
            return 'S Series'
        # Tablet
        elif model_upper.startswith('SM-X') or model_upper.startswith('SM-T'):
            return 'Tablet'
        # Ring
        elif model_upper.startswith('SM-Q'):
            return 'Ring'
        # Watch
        elif model_upper.startswith('SM-L') or model_upper.startswith('SM-R'):
            return 'Watch'
        # Everything else
        else:
            return 'Unknown'

    def categorize_series_new(model):
        """Categorize model into series based on new logic (no SM- prefix)"""
        if not model or not isinstance(model, str):
            return 'Unknown'

        model_upper = model.upper()

        # Special case: Moved S series models
        if model_upper.startswith('(MOVED) S'):
            return 'S Series'
        # S Series
        elif model_upper.startswith('S') or model_upper.startswith('G'):
            return 'S Series'
        # A Series
        elif model_upper.startswith('A'):
            return 'A Series'
        # M Series
        elif model_upper.startswith('M'):
            return 'M Series'
        # E Series (treated as F Series)
        elif model_upper.startswith('E'):
            return 'F Series'
        # Fold & Flip Series
        elif model_upper.startswith('F9') or model_upper.startswith('F7'):
            return 'Fold & Flip Series'
        # F Series (other F models)
        elif model_upper.startswith('F'):
            return 'F Series'
        # Tablet
        elif model_upper.startswith('X') or model_upper.startswith('T'):
            return 'Tablet'
        # Watch
        elif model_upper.startswith('L') or model_upper.startswith('R'):
            return 'Watch'
        # Ring
        elif model_upper.startswith('Q'):
            return 'Ring'
        # Everything else
        else:
            return 'Unknown'

    # Folders to use new logic with 'S/W Ver.' column
    new_logic_folders = {'beta_user_issues', 'samsung_members_plm'}

    # Count issues by series across all data
    series_counts = {}
    for folder, dfs in data.items():
        combined = combine_dataframes(dfs)

        if folder in new_logic_folders:
            # Use 'S/W Ver.' column with new categorization
            column = 'S/W Ver.'
            categorize_func = categorize_series_new
        else:
            # Use 'Model No.' column with original categorization
            column = 'Model No.'
            categorize_func = categorize_series

        if column in combined.columns:
            for _, row in combined.iterrows():
                model = str(row.get(column, '')).strip()
                if model:
                    series = categorize_func(model)
                    series_counts[series] = series_counts.get(series, 0) + 1

    # Sort by count descending and return top series
    sorted_series = sorted(series_counts.items(), key=lambda x: x[1], reverse=True)
    return [{"label": series, "value": int(cnt)} for series, cnt in sorted_series]

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

def compute_top_models_by_source(data: dict, source_folder: str) -> list:
    """
    Top 10 models by issue count for a specific data source.
    """
    all_models = {}
    if source_folder in data:
        combined = combine_dataframes(data[source_folder])
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
    import sys
    if len(sys.argv) > 1:
        # Handle specific requests
        command = sys.argv[1]
        if command == "top-models-beta":
            data = load_all_excels("./downloads")
            models = compute_top_models_by_source(data, 'beta_user_issues')
            print(json.dumps(models))
        elif command == "top-models-plm":
            data = load_all_excels("./downloads")
            models = compute_top_models_by_source(data, 'samsung_members_plm')
            print(json.dumps(models))
        elif command == "top-models-voc":
            data = load_all_excels("./downloads")
            models = compute_top_models_by_source(data, 'samsung_members_voc')
            print(json.dumps(models))
        else:
            print(json.dumps({"error": f"Unknown command: {command}"}))
        sys.exit(0)

    # Default behavior - return all data
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

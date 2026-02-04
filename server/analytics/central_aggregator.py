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

def derive_model_name_from_sw_ver(sw_ver):
    """
    Derive model name from S/W Ver. for OS Beta entries
    Example: "S911BXXU8ZYHB" -> "SM-S911B"
    """
    if not sw_ver or not isinstance(sw_ver, str):
        return sw_ver  # Return original if invalid

    sw_ver = str(sw_ver).strip()
    if len(sw_ver) < 6:
        return sw_ver  # Return original if too short for safe parsing

    # Ensure we have enough characters for a valid model code
    if len(sw_ver) >= 6:
        return f"SM-{sw_ver[:6]}"  # Take first 6 characters for more precision

    return sw_ver  # Fallback

def transform_model_names(df):
    """
    Transform Model No. column for OS Beta entries using S/W Ver.
    Also remove [Regular Folder] prefix from model names.
    """
    if 'Model No.' in df.columns:
        # Apply transformation where Model No. starts with "[OS Beta]"
        if 'S/W Ver.' in df.columns:
            mask_os_beta = df['Model No.'].astype(str).str.startswith('[OS Beta]')
            df.loc[mask_os_beta, 'Model No.'] = df.loc[mask_os_beta, 'S/W Ver.'].apply(derive_model_name_from_sw_ver)
        
        # Remove [Regular Folder] prefix from model names
        mask_regular_folder = df['Model No.'].astype(str).str.startswith('[Regular Folder]')
        if mask_regular_folder.any():
            df.loc[mask_regular_folder, 'Model No.'] = df.loc[mask_regular_folder, 'Model No.'].str.replace(r'^\[Regular Folder\]', '', regex=True)
    return df

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
                    # Skip temporary Excel files that start with ~$
                    if excel.name.startswith('~$'):
                        print(f"Warning: Skipping temporary Excel file: {excel}")
                        continue
                    try:
                        df = pd.read_excel(excel)
                        # Apply model name transformation for OS Beta entries
                        df = transform_model_names(df)
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

def filter_allowed_severity(df: pd.DataFrame) -> pd.DataFrame:
    """
    Filter DataFrame to only include allowed severity levels: High, Medium, Low.
    Excludes Critical severity as per requirements.
    """
    allowed_severity = ['High', 'Medium', 'Low']
    if 'Severity' in df.columns:
        return df[df['Severity'].isin(allowed_severity)]
    return df

def compute_central_kpis(data: dict) -> dict:
    """
    Compute KPIs for each processor type with severity breakdowns.
    Filter out Critical severity issues as per requirements.
    Also compute status KPIs across all sources.
    """
    kpis = {}
    processor_map = {
        'employee_ut': 'EMPLOYEE UT',
        'global_voc_plm': 'Global VOC PLM',
        'beta_ut': 'Beta UT'
    }
    total_status_counts = {'Open': 0, 'Close': 0, 'Resolve': 0}
    for folder, dfs in data.items():
        if folder in processor_map:
            combined = combine_dataframes(dfs)
            # Apply severity filter to exclude Critical
            combined = filter_allowed_severity(combined)

            # Normalize status names - handle variants
            if "Progr.Stat." in combined.columns:
                combined["Progr.Stat."] = combined["Progr.Stat."].astype(str).apply(lambda x:
                    "Resolve" if x.startswith("Resolve") else
                    "Close" if x.startswith("Close") else
                    "Open" if x.startswith("Open") else x
                )
            
            # For Employee UT data, also check the "Resolve" column for status information
            if folder == 'employee_ut' and "Resolve" in combined.columns:
                # Map Resolve column values to status categories
                resolve_mapping = {
                    'Close': 'Close',
                    'Resolve': 'Resolve', 
                    'Not Resolve': 'Open',
                    'Reviewed': 'Open'  # Treat Reviewed as Open since it's not resolved/closed
                }
                combined["Progr.Stat."] = combined["Resolve"].map(resolve_mapping).fillna(combined["Progr.Stat."])

            total = len(combined)

            # Compute severity counts
            severity_counts = {'High': 0, 'Medium': 0, 'Low': 0}
            if 'Severity' in combined.columns:
                severity_series = combined['Severity'].value_counts()
                for severity in severity_counts.keys():
                    severity_counts[severity] = int(severity_series.get(severity, 0))

            # Compute status counts for this source
            status_counts = {'Open': 0, 'Close': 0, 'Resolve': 0}
            if "Progr.Stat." in combined.columns:
                vc = combined["Progr.Stat."].value_counts()
                status_counts["Open"] = int(vc.get("Open", 0))
                status_counts["Close"] = int(vc.get("Close", 0))
                status_counts["Resolve"] = int(vc.get("Resolve", 0))

            kpis[processor_map[folder]] = {
                'total': total,
                'High': severity_counts['High'],
                'Medium': severity_counts['Medium'],
                'Low': severity_counts['Low'],
                'open': status_counts['Open'],
                'close': status_counts['Close'],
                'resolved': status_counts['Resolve']
            }

            # Accumulate total status counts
            total_status_counts["Open"] += status_counts["Open"]
            total_status_counts["Close"] += status_counts["Close"]
            total_status_counts["Resolve"] += status_counts["Resolve"]

    return kpis, total_status_counts

def compute_top_modules(data: dict) -> list:
    """
    Aggregate top 10 modules from Beta User Issues, Samsung Members PLM, and Samsung Members VOC only.
    Filter out Critical severity issues as per requirements.
    """
    # Only include data from these sources (excluding Samsung Members VOC)
    included_folders = {'employee_ut', 'global_voc_plm', 'beta_ut'}

    all_modules = {}
    for folder, dfs in data.items():
        if folder in included_folders:  # Only process specified folders
            combined = combine_dataframes(dfs)
            # Apply severity filter to exclude Critical
            combined = filter_allowed_severity(combined)
            if 'Module' in combined.columns:
                modules = combined['Module'].value_counts()
                for module, count in modules.items():
                    if pd.notna(module) and str(module).strip():
                        module_str = str(module).strip()
                        all_modules[module_str] = all_modules.get(module_str, 0) + count
    sorted_modules = sorted(all_modules.items(), key=lambda x: x[1], reverse=True)
    return [{"label": mod, "value": int(cnt)} for mod, cnt in sorted_modules[:10]]


def compute_top_models(data: dict) -> list:
    """
    Top 10 models by issue count across all data.
    Filter out Critical severity issues as per requirements.
    """
    all_models = {}
    for folder, dfs in data.items():
        combined = combine_dataframes(dfs)
        # Apply severity filter to exclude Critical
        combined = filter_allowed_severity(combined)
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
    Filter out Critical severity issues as per requirements.
    """
    all_models = {}
    if source_folder in data:
        combined = combine_dataframes(data[source_folder])
        # Apply severity filter to exclude Critical
        combined = filter_allowed_severity(combined)
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
    Apply severity filtering to exclude Critical issues as per requirements.
    """
    processor_map = {
        'ut_portal': 'UT',
        'global_voc_plm': 'PLM',
        'beta_ut': 'Beta'
    }

    # First, find the module with maximum High severity issue count
    all_modules = {}
    for folder, dfs in data.items():
        combined = combine_dataframes(dfs)
        # Apply severity filter to exclude Critical, only count High issues for module ranking
        combined = filter_allowed_severity(combined)
        if 'Module' in combined.columns and 'Severity' in combined.columns:
            # Only count High severity issues for module ranking
            high_issues = combined[combined['Severity'].str.lower() == 'high']
            if not high_issues.empty:
                modules = high_issues['Module'].value_counts()
                for module, count in modules.items():
                    if pd.notna(module) and str(module).strip():
                        module_str = str(module).strip()
                        all_modules[module_str] = all_modules.get(module_str, 0) + count

    if not all_modules:
        return []

    # Get the module with maximum High severity issues
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

def compute_model_module_matrix(data: dict) -> dict:
    """
    Create a matrix of Top 10 Models × Top 10 Modules with issue counts.
    Returns a dict with models, modules, and matrix data.
    Filter out Critical severity issues as per requirements.
    """
    # Get top 10 models and modules
    top_models = compute_top_models(data)
    top_modules = compute_top_modules(data)

    model_names = [item['label'] for item in top_models]
    module_names = [item['label'] for item in top_modules]

    # Create matrix: rows = models, columns = modules
    matrix = []
    for model in model_names:
        row = []
        for module in module_names:
            # Count issues for this model-module combination
            count = 0
            for folder, dfs in data.items():
                combined = combine_dataframes(dfs)
                # Apply severity filter to exclude Critical
                combined = filter_allowed_severity(combined)
                if 'Model No.' in combined.columns and 'Module' in combined.columns:
                    # Filter for this specific model and module
                    filtered = combined[
                        (combined['Model No.'].astype(str).str.strip() == model.strip()) &
                        (combined['Module'].astype(str).str.strip() == module.strip())
                    ]
                    count += len(filtered)
            row.append(count)
        matrix.append(row)

    return {
        'models': model_names,
        'modules': module_names,
        'matrix': matrix
    }

def clean_excel_text(text: str) -> str:
    """
    Clean text from Excel that may contain unwanted HTML entities and characters.
    """
    if not isinstance(text, str):
        return str(text) if text is not None else ""

    # Remove common Excel HTML entities
    cleaned = text.replace("_x000D_", " ")  # Carriage return to space
    cleaned = cleaned.replace("_x000A_", " ")  # Line feed to space
    cleaned = cleaned.replace("_x0009_", " ")  # Tab to space

    # Remove multiple spaces and trim
    cleaned = " ".join(cleaned.split())
    return cleaned.strip()

def compute_source_model_summary(data: dict) -> list:
    """
    Create a summary table with Source, Model, Top 5 Modules, Issue Count, Top 5 Issue Titles.
    Filter out Critical severity issues as per requirements.
    """
    source_map = {
        'ut_portal': 'UT Portal',
        'global_voc_plm': 'Global VOC PLM',
        'beta_ut': 'Beta UT'
    }

    summary = []

    for folder, dfs in data.items():
        if folder not in source_map:
            continue

        source_name = source_map[folder]
        combined = combine_dataframes(dfs)
        # Apply severity filter to exclude Critical
        combined = filter_allowed_severity(combined)

        if 'Model No.' not in combined.columns:
            continue

        # Get top 5 models for this source only
        models_in_source = combined['Model No.'].value_counts().head(5)

        for model, total_count in models_in_source.items():
            if pd.notna(model) and str(model).strip():
                model_str = str(model).strip()

                # Filter data for this specific model
                model_data = combined[combined['Model No.'].astype(str).str.strip() == model_str]

                # Top 5 modules for this model
                top_modules = []
                if 'Module' in model_data.columns:
                    modules = model_data['Module'].value_counts().head(5)
                    top_modules = [str(mod).strip() for mod in modules.index if pd.notna(mod)]

                # Get titles based on available modules
                top_titles = []
                if top_modules:
                    # If modules exist, get one "Case Code : Title" entry for each top module
                    for module in top_modules:
                        # Filter issues for this specific module
                        module_issues = model_data[model_data['Module'].astype(str).str.strip() == module]

                        if not module_issues.empty:
                            # Take the first issue for this module
                            first_issue = module_issues.iloc[0]

                            case_code = str(first_issue.get('Case Code', '')).strip()
                            title = str(first_issue.get('Title', '')).strip()

                            # For VOC, use 'content' column instead of 'Title'
                            if source_name == 'VOC' and 'content' in first_issue:
                                title = clean_excel_text(str(first_issue.get('content', '')))

                            if case_code and title:
                                top_titles.append(f"{case_code} : {title}")
                            else:
                                # Fallback if case code or title is missing
                                top_titles.append(f"Unknown : {title or 'Unknown Title'}")
                        else:
                            # No issues found for this module
                            top_titles.append(f"Unknown : No issues found for {module}")
                else:
                    # If no modules (like for VOC), fall back to top 5 titles/contents from all issues
                    if source_name == 'VOC':
                        # For VOC, use 'content' column instead of 'Title'
                        if 'content' in model_data.columns:
                            contents = model_data['content'].value_counts().head(5)
                            for content in contents.index:
                                if pd.notna(content):
                                    cleaned_content = clean_excel_text(str(content))
                                    top_titles.append(cleaned_content)
                    else:
                        # For Beta and PLM, use 'Title' column
                        if 'Title' in model_data.columns:
                            titles = model_data['Title'].value_counts().head(5)
                            for title in titles.index:
                                if pd.notna(title):
                                    top_titles.append(str(title).strip())

                # For VOC sources, only include issue_count and top_titles (no top_modules since they're irrelevant)
                if source_name == 'VOC':
                    summary.append({
                        'source': source_name,
                        'model': model_str,
                        'issue_count': int(total_count),
                        'top_titles': top_titles
                    })
                else:
                    summary.append({
                        'source': source_name,
                        'model': model_str,
                        'top_modules': top_modules,
                        'issue_count': int(total_count),
                        'top_titles': top_titles
                    })

    # Sort by source, then by issue count descending
    summary.sort(key=lambda x: (x['source'], -x['issue_count']))

    return summary

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
            models = compute_top_models_by_source(data, 'global_voc_plm')
            print(json.dumps(models))
        elif command == "top-models-voc":
            data = load_all_excels("./downloads")
            models = compute_top_models_by_source(data, 'samsung_members_voc')
            print(json.dumps(models))
        elif command == "matrix":
            data = load_all_excels("./downloads")
            matrix = compute_model_module_matrix(data)
            print(json.dumps(matrix))
        elif command == "summary":
            data = load_all_excels("./downloads")
            summary = compute_source_model_summary(data)
            print(json.dumps(summary))
        else:
            print(json.dumps({"error": f"Unknown command: {command}"}))
        sys.exit(0)

# Default behavior - return all data including matrix, summary, and filtered models
    base_path = "./downloads"
    try:
        data = load_all_excels(base_path)
        kpis, status_kpis = compute_central_kpis(data)
        top_modules = compute_top_modules(data)
        top_models = compute_top_models(data)
        high_issues = compute_high_issues(data)

        # Include additional data for cache generation efficiency
        model_module_matrix = compute_model_module_matrix(data)
        source_model_summary = compute_source_model_summary(data)

        # Get filtered top models for each source (excluding Samsung Members VOC)
        filtered_top_models = {}
        for folder_name in ['ut_portal', 'global_voc_plm', 'beta_ut']:
            filtered_top_models[folder_name] = compute_top_models_by_source(data, folder_name)

        # Compute total issues and high issues counts
        total_issues = sum(kpis[source]['total'] for source in kpis)
        high_issues_count = sum(kpis[source]['High'] for source in kpis)

        response = {
            "kpis": kpis,
            "status_kpis": {
                "open": status_kpis["Open"],
                "close": status_kpis["Close"],
                "resolved": status_kpis["Resolve"]
            },
            "total_issues": total_issues,
            "high_issues_count": high_issues_count,
            "top_modules": top_modules,
            "top_models": top_models,
            "high_issues": high_issues,
            "model_module_matrix": model_module_matrix,
            "source_model_summary": source_model_summary,
            "filtered_top_models": filtered_top_models
        }

        # Sanitize NaN values
        response = sanitize_nan(response)

        print(json.dumps(response))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        import sys
        sys.exit(1)

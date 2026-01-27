import pandas as pd
import os
import json
import math
import re
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
    if not sw_ver or not isinstance(sw_ver, str) or len(sw_ver) < 5:
        return sw_ver  # Return original if invalid
    return 'SM-' + sw_ver[:5]

def transform_model_names(df):
    """
    Transform Model No. column for OS Beta entries using S/W Ver.
    """
    if 'Model No.' in df.columns and 'S/W Ver.' in df.columns:
        # Apply transformation where Model No. starts with "[OS Beta]"
        mask = df['Model No.'].astype(str).str.startswith('[OS Beta]')
        df.loc[mask, 'Model No.'] = df.loc[mask, 'S/W Ver.'].apply(derive_model_name_from_sw_ver)
    return df

def load_model_name_mapping():
    """
    Load model name mapping from modelName.json
    """
    try:
        model_name_file = Path(__file__).parent.parent.parent / 'modelName.json'
        if model_name_file.exists():
            with open(model_name_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        else:
            print(f"Warning: modelName.json not found at {model_name_file}")
            return {}
    except Exception as e:
        print(f"Error loading model name mapping: {e}")
        return {}

def get_friendly_model_name(model_str, model_name_map):
    """
    Get friendly model name with smart matching for extended variants.
    Handles both exact matches and extended variants like SM-S911BE_SWA_15_DD
    """
    if not model_str or not isinstance(model_str, str):
        return model_str
    
    model_str = model_str.strip()
    
    # Try exact match first
    if model_str in model_name_map:
        return model_name_map[model_str]
    
    # If no exact match, try to extract base model from extended variant
    # Extended variants typically follow pattern: SM-XXXXX_XXX_XX_XX
    # We want to extract the base model: SM-XXXXX
    if model_str.startswith('SM-') and '_' in model_str:
        # Extract base model by taking characters up to the first underscore
        # Examples:
        # SM-S911BE_SWA_15_DD -> SM-S911BE
        # SM-S928BE_SWA_15_DD -> SM-S928BE
        # SM-A356E_SWA_15_INS -> SM-A356E
        base_model = model_str.split('_')[0]
        
        # Try to match the base model
        if base_model in model_name_map:
            return model_name_map[base_model]
        
        # If base model doesn't match, try to extract the core model number
        # SM-S911BE -> SM-S911B (remove last character)
        # SM-A356E -> SM-A356B (replace E with B)
        if len(base_model) >= 8:
            # Remove the last character to get the core model
            core_model = base_model[:-1]
            if core_model in model_name_map:
                return model_name_map[core_model]
            
            # If still no match and the model ends with 'E', try replacing with 'B'
            if base_model.endswith('E'):
                model_with_b = base_model[:-1] + 'B'
                if model_with_b in model_name_map:
                    return model_name_map[model_with_b]
    
    # Enhanced Samsung model variant mapping logic
    # Handle extended variants by mapping to friendly names directly
    if model_str.startswith('SM-'):
        # Extract the model series and number for pattern matching
        # Examples: S928, S938, A356, M55, etc.
        
        # Pattern to extract model series and number
        # SM-S928BE_SWA_15_DD -> S928
        # SM-A356E_SWA_15_INS -> A356
        # SM-M556B -> M55
        match = re.search(r'SM-([A-Z]*)(\d+)', model_str)
        if match:
            series = match.group(1)  # S, A, M, etc.
            number = match.group(2)  # 928, 938, 356, 55, etc.
            
            # Create potential friendly name patterns based on series
            if series == 'S':
                # Galaxy S series
                if len(number) >= 3:
                    # S928 -> S24 Ultra, S938 -> S25 Ultra, etc.
                    # Extract the last digit to determine generation
                    generation = number[1]  # 928 -> 2, 938 -> 3
                    if generation == '2':
                        return "S24 Ultra" if number == '928' else f"S24+"
                    elif generation == '3':
                        return "S25 Ultra" if number == '938' else f"S25+"
                    elif generation == '1':
                        return "S23 Ultra" if number == '918' else f"S23+"
                    elif generation == '0':
                        return "S22 Ultra" if number == '908' else f"S22+"
                    else:
                        return f"S{generation} Series"
            elif series == 'A':
                # Galaxy A series
                if len(number) >= 3:
                    return f"A{number}"
            elif series == 'M':
                # Galaxy M series
                if len(number) >= 3:
                    return f"M{number}"
            elif series == 'F':
                # Galaxy Fold/Flip series
                if len(number) >= 3:
                    if number.startswith('9'):
                        return f"Z Fold{number[1]}"
                    elif number.startswith('7'):
                        return f"Z Flip{number[1]}"
    
    # Return original if no mapping found
    return model_str

def load_all_excels(folder_path: str) -> pd.DataFrame:
    """
    Load all Excel files from a folder and combine them with dtype optimizations.
    """
    folder = Path(folder_path)
    if not folder.exists():
        raise FileNotFoundError(f"Folder {folder_path} does not exist")

    excels = list(folder.glob("*.xlsx")) + list(folder.glob("*.xls"))
    if not excels:
        raise FileNotFoundError(f"No Excel files in {folder_path}")

    # Define dtypes for better performance and memory usage
    dtype_spec = {
        'Model No.': 'string',
        'Module': 'string',
        'Severity': 'category',  # Use category for repeated values
        'Title': 'string',
        'Case Code': 'string',
        'S/W Ver.': 'string'
    }

    # Load all Excel files and combine them
    dfs = []
    for excel_file in excels:
        try:
            df = pd.read_excel(excel_file, dtype=dtype_spec, engine='openpyxl')
            dfs.append(df)
            print(f"Loaded {len(df)} rows from {excel_file.name}", file=sys.stderr)
        except Exception as e:
            print(f"Warning: Failed to load {excel_file.name}: {e}", file=sys.stderr)

    if not dfs:
        raise FileNotFoundError(f"Failed to load any Excel files from {folder_path}")

    # Combine all DataFrames
    combined_df = pd.concat(dfs, ignore_index=True, sort=False)
    print(f"Combined {len(dfs)} files with total {len(combined_df)} rows", file=sys.stderr)

    # Optimize memory for large datasets
    if len(combined_df) > 10000:
        # Downcast numeric types if they exist
        for col in combined_df.select_dtypes(include=['int64']):
            combined_df[col] = pd.to_numeric(combined_df[col], downcast='integer')
        for col in combined_df.select_dtypes(include=['float64']):
            combined_df[col] = pd.to_numeric(combined_df[col], downcast='float')

    return combined_df

def compute_kpis(df: pd.DataFrame) -> dict:
    """
    Return high-level KPIs:
    - total_rows
    - unique_models
    - category_distribution
    - severity_distribution
    - status_distribution
    - open_severity_distribution (High, Medium, Low issues with Prog.Stat. = Open only)
    """
    total_rows = len(df)
    unique_models = df.get('Model No.', pd.Series()).nunique() if 'Model No.' in df.columns else 0
    category_distribution = df.get('Module', pd.Series()).value_counts().to_dict() if 'Module' in df.columns else {}
    severity_distribution = df.get('Severity', pd.Series()).value_counts().to_dict() if 'Severity' in df.columns else {}
    # FIX: Find the correct status column
    status_col = next((c for c in ["Progr.Stat.", "Progress Status", "Status"] if c in df.columns), "Progr.Stat.")
    status_distribution = df.get(status_col, pd.Series()).value_counts().to_dict()

    # Compute open severity distribution - High, Medium, Low issues with Prog.Stat. = Open only
    open_severity_distribution = {'High': 0, 'Medium': 0, 'Low': 0}
    if 'Severity' in df.columns and 'Progr.Stat.' in df.columns:
        # Filter for Open status only
        open_df = df[df['Progr.Stat.'].astype(str).str.strip() == 'Open']
        if not open_df.empty:
            # Filter for allowed severity levels only (exclude Critical)
            allowed_severity = ['High', 'Medium', 'Low']
            open_severity_df = open_df[open_df['Severity'].isin(allowed_severity)]
            if not open_severity_df.empty:
                open_severity_series = open_severity_df['Severity'].value_counts()
                for severity in open_severity_distribution.keys():
                    open_severity_distribution[severity] = int(open_severity_series.get(severity, 0))

    return {
        "total_rows": total_rows,
        "unique_models": unique_models,
        "category_distribution": category_distribution,
        "severity_distribution": severity_distribution,
        "status_distribution": status_distribution,
        "open_severity_distribution": open_severity_distribution
    }

def group_by_column(df: pd.DataFrame, column: str, model_name_map: dict = None) -> list:
    """
    Return grouped counts sorted descending:
    [
        {"label": "S24 Ultra", "count": 128},
        ...
    ]
    """
    if column not in df.columns:
        return []
    # Handle duplicate columns by selecting the first occurrence
    try:
        col_data = df[column]
        if isinstance(col_data, pd.DataFrame):
            col_data = col_data.iloc[:, 0]
        
        # Apply model name mapping if this is the Model No. column and mapping is available
        if column == 'Model No.' and model_name_map:
            # Apply model name mapping to each model value
            mapped_data = col_data.apply(lambda x: get_friendly_model_name(str(x) if pd.notna(x) else '', model_name_map))
            counts = mapped_data.value_counts().sort_values(ascending=False)
        else:
            counts = col_data.value_counts().sort_values(ascending=False)
        
        return [{"label": str(idx), "count": int(count)} for idx, count in counts.items()]
    except Exception:
        # Fallback: return empty list if there's any issue
        return []

def time_series(df: pd.DataFrame, date_column: str) -> list:
    """
    Return daily counts sorted by date.
    Safe date parsing without mutating original DataFrame.
    """
    if date_column not in df.columns:
        return []

    # Create a copy to avoid mutating the original DataFrame
    df_copy = df.copy()

    # Convert to datetime, drop invalid dates
    df_copy[date_column] = pd.to_datetime(df_copy[date_column], errors='coerce')
    df_copy = df_copy.dropna(subset=[date_column])

    # Group by date and count
    return df_copy.groupby(df_copy[date_column].dt.date).size().sort_index().reset_index(name='count').rename(columns={date_column: 'date'}).to_dict('records')

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Module name required"}))
        sys.exit(1)

    module = sys.argv[1]
    save_json = '--save-json' in sys.argv

    # Get project root directory (works regardless of execution context)
    script_dir = Path(__file__).parent.parent  # server/analytics -> server
    folder_path = script_dir / 'downloads' / module

    try:
        # Load model name mapping
        model_name_map = load_model_name_mapping()
        print(f"Loaded {len(model_name_map)} model name mappings", file=sys.stderr)

        df = load_all_excels(str(folder_path))
        # Apply model name transformation for OS Beta entries
        df = transform_model_names(df)

        kpis = compute_kpis(df)
        top_models = group_by_column(df, 'Model No.', model_name_map)
        categories = group_by_column(df, 'Module')
        # Include time_series if 'Date' column exists
        time_data = time_series(df, 'Date') if 'Date' in df.columns else []

        rows = df.to_dict('records')

        response = {
            "kpis": {
                "total_rows": kpis["total_rows"],
                "unique_models": kpis["unique_models"],
                "high_issues": kpis["severity_distribution"].get("High", 0),
                "severity_distribution": kpis["severity_distribution"],
                "open_issues": kpis["status_distribution"].get("Open", 0),
                "resolved_issues": kpis["status_distribution"].get("Resolve", 0),
                "close_issues": kpis["status_distribution"].get("Close", 0),
                "open_severity_distribution": kpis["open_severity_distribution"]
            },
            "top_models": top_models,
            "categories": categories,
            "rows": rows,
        }

        if time_data:
            response["time_series"] = time_data

        # Sanitize NaN values for JSON serialization
        response = sanitize_nan(response)

        if save_json:
            # Save to downloads/<module>/analytics.json
            json_path = folder_path / 'analytics.json'
            with open(json_path, 'w') as f:
                json.dump(response, f, indent=2)
            print(f"Analytics saved to {json_path}")
        else:
            # Print to stdout for API consumption
            print(json.dumps(response))

    except Exception as e:
        error_msg = str(e)
        if save_json:
            print(f"Error saving analytics: {error_msg}")
        else:
            print(json.dumps({"error": error_msg}))
        sys.exit(1)

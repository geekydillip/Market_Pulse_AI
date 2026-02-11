import pandas as pd
import os
import json
import math
from pathlib import Path
from datetime import date, datetime

# Load model name mappings
def load_model_name_mappings():
    """Load model name mappings from modelName.json"""
    try:
        with open('modelName.json', 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        import sys
        sys.stderr.write("Warning: modelName.json not found, using empty mappings\n")
        return {}
    except json.JSONDecodeError:
        import sys
        sys.stderr.write("Warning: Invalid JSON in modelName.json, using empty mappings\n")
        return {}

MODEL_NAME_MAPPINGS = load_model_name_mappings()

def sanitize_nan(obj):
    """
    Recursively replace NaN values with None and convert dates to strings for JSON serialization
    """
    if isinstance(obj, float) and math.isnan(obj):
        return None
    elif isinstance(obj, (date, datetime)):
        return obj.isoformat()
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
            import sys
            sys.stderr.write(f"Loaded {len(df)} rows from {excel_file.name}\n")
        except Exception as e:
            import sys
            sys.stderr.write(f"Warning: Failed to load {excel_file.name}: {e}\n")

    if not dfs:
        raise FileNotFoundError(f"Failed to load any Excel files from {folder_path}")

    # Combine all DataFrames
    combined_df = pd.concat(dfs, ignore_index=True, sort=False)
    import sys
    sys.stderr.write(f"Combined {len(dfs)} files with total {len(combined_df)} rows\n")

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
    """
    total_rows = len(df)
    unique_models = df.get('Model No.', pd.Series()).nunique() if 'Model No.' in df.columns else 0
    category_distribution = df.get('Module', pd.Series()).value_counts().to_dict() if 'Module' in df.columns else {}
    severity_distribution = df.get('Severity', pd.Series()).value_counts().to_dict() if 'Severity' in df.columns else {}
    status_distribution = df.get('Progr.Stat.', pd.Series()).value_counts().to_dict() if 'Progr.Stat.' in df.columns else {}

    return {
        "total_rows": total_rows,
        "unique_models": unique_models,
        "category_distribution": category_distribution,
        "severity_distribution": severity_distribution,
        "status_distribution": status_distribution
    }

def group_by_column(df: pd.DataFrame, column: str) -> list:
    """
    Return grouped counts sorted descending:
    [
        {"label": "SM-F761B", "count": 128},
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
        counts = col_data.value_counts().sort_values(ascending=False)
        return [{"label": str(idx), "count": int(count)} for idx, count in counts.items()]
    except Exception:
        # Fallback: return empty list if there's any issue
        return []

def map_model_name(model_number):
    """
    Map model number to friendly name using the loaded mappings.
    Implements the same logic as the frontend getModelName function.
    """
    if not model_number or pd.isna(model_number):
        return model_number

    model_str = str(model_number).strip()
    
    # If it's already a clean model number, try direct lookup first
    if model_str in MODEL_NAME_MAPPINGS:
        return MODEL_NAME_MAPPINGS[model_str]

    # Extract core identifier using improved regex that handles underscores and complex patterns
    # This pattern captures: SM-A176BE_SWA_16_INS -> A176BE
    import re
    match = re.match(r'SM-([A-Z0-9]+)', model_str)
    if not match:
        return model_str

    core_identifier = match.group(1)
    
    # Strategy 1: Try the exact extracted identifier first
    exact_key = f"SM-{core_identifier}"
    if exact_key in MODEL_NAME_MAPPINGS:
        return MODEL_NAME_MAPPINGS[exact_key]

    # Strategy 2: Try to extract base model by removing suffixes
    # Common suffixes to try in order of preference
    suffixes = [
        "BE", "B", "FN", "F", "U", "EUR", "US", "VZW", "INS", "DD", "XX", "SWA", "KSA", "THL", "MYS", "SGP", "IND", "PHL", "HKG", "TW"
    ]

    # Try removing suffixes from the core identifier
    for suffix in suffixes:
        if core_identifier.endswith(suffix):
            base_key = f"SM-{core_identifier[:-len(suffix)]}"
            if base_key in MODEL_NAME_MAPPINGS:
                return MODEL_NAME_MAPPINGS[base_key]

    # Strategy 3: Try common base patterns
    # For example, if we have "A176BE", try "A176", "A17", etc.
    base_patterns = [
        core_identifier[:-1],  # Remove last character
        core_identifier[:-2],  # Remove last two characters
        core_identifier[:-3],  # Remove last three characters
    ]

    for pattern in base_patterns:
        if len(pattern) > 0:
            base_key = f"SM-{pattern}"
            if base_key in MODEL_NAME_MAPPINGS:
                return MODEL_NAME_MAPPINGS[base_key]

    # Strategy 4: Try alternative suffix combinations
    # If we have "A176", try common suffixes
    for suffix in ["B", "F", "FN", "U"]:
        alt_key = f"SM-{core_identifier}{suffix}"
        if alt_key in MODEL_NAME_MAPPINGS:
            return MODEL_NAME_MAPPINGS[alt_key]

    # Strategy 5: Enhanced fallback for complex patterns
    # Try to find any model that starts with the core identifier
    core_prefix = f"SM-{core_identifier}"
    for key, value in MODEL_NAME_MAPPINGS.items():
        if key.startswith(core_prefix):
            return value

    # Strategy 6: Try to find any model that contains the core identifier
    for key, value in MODEL_NAME_MAPPINGS.items():
        if core_identifier in key:
            return value

    # Fallback to original model number if no match found
    return model_str

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
    folder_path = f"./downloads/{module}"

    try:
        df = load_all_excels(folder_path)
        # Apply model name transformation for OS Beta entries
        df = transform_model_names(df)

        kpis = compute_kpis(df)
        top_models = group_by_column(df, 'Model No.')
        
        # Apply server-side model name mapping to top_models
        for model_entry in top_models:
            model_entry['friendly_name'] = map_model_name(model_entry['label'])
        
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
                "close_issues": kpis["status_distribution"].get("Close", 0)
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
            # Save to ./downloads/<module>/analytics.json
            json_path = f"{folder_path}/analytics.json"
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

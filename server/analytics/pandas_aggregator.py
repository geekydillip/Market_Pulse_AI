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

def load_latest_excel(folder_path: str) -> pd.DataFrame:
    """
    Load the most recent Excel file from a folder with dtype optimizations.
    """
    folder = Path(folder_path)
    if not folder.exists():
        raise FileNotFoundError(f"Folder {folder_path} does not exist")

    excels = list(folder.glob("*.xlsx"))
    if not excels:
        raise FileNotFoundError(f"No Excel files in {folder_path}")

    latest = max(excels, key=lambda p: p.stat().st_mtime)

    # Define dtypes for better performance and memory usage
    dtype_spec = {
        'Model No.': 'string',
        'Module': 'string',
        'Severity': 'category',  # Use category for repeated values
        'Title': 'string',
        'Case Code': 'string',
        'S/W Ver.': 'string'
    }

    # Load with optimizations
    df = pd.read_excel(latest, dtype=dtype_spec, engine='openpyxl')

    # Optimize memory for large datasets
    if len(df) > 10000:
        # Downcast numeric types if they exist
        for col in df.select_dtypes(include=['int64']):
            df[col] = pd.to_numeric(df[col], downcast='integer')
        for col in df.select_dtypes(include=['float64']):
            df[col] = pd.to_numeric(df[col], downcast='float')

    return df

def compute_kpis(df: pd.DataFrame) -> dict:
    """
    Return high-level KPIs:
    - total_rows
    - unique_models
    - category_distribution
    - severity_distribution
    """
    total_rows = len(df)
    unique_models = df.get('Model No.', pd.Series()).nunique() if 'Model No.' in df.columns else 0
    category_distribution = df.get('Module', pd.Series()).value_counts().to_dict() if 'Module' in df.columns else {}
    severity_distribution = df.get('Severity', pd.Series()).value_counts().to_dict() if 'Severity' in df.columns else {}

    return {
        "total_rows": total_rows,
        "unique_models": unique_models,
        "category_distribution": category_distribution,
        "severity_distribution": severity_distribution
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
        df = load_latest_excel(folder_path)
        # Apply model name transformation for OS Beta entries
        df = transform_model_names(df)

        kpis = compute_kpis(df)
        top_models = group_by_column(df, 'Model No.')
        categories = group_by_column(df, 'Module')
        # Include time_series if 'Date' column exists
        time_data = time_series(df, 'Date') if 'Date' in df.columns else []

        rows = df.to_dict('records')

        response = {
            "kpis": {
                "total_rows": kpis["total_rows"],
                "unique_models": kpis["unique_models"],
                "high_issues": kpis["severity_distribution"].get("High", 0),
                "severity_distribution": kpis["severity_distribution"]
            },
            "top_models": top_models,
            "categories": categories,
            "rows": rows
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

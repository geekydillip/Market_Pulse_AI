#!/usr/bin/env python3
"""
Central Dashboard Cache Generator

Generates a centralized cache file containing pre-aggregated data for all dashboard APIs.
This eliminates N× JSON reads, runtime aggregation, and directory traversal per request.

Cache file: ./downloads/__dashboard_cache__/central_dashboard.json

Trigger conditions:
- New Excel file processed (after processExcel)
- analytics.json files changed
"""

import os
import json
import subprocess
import sys
import hashlib
from datetime import datetime
from pathlib import Path
from collections import defaultdict

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
            print(f"Warning: modelName.json not found at {model_name_file}", file=sys.stderr)
            return {}
    except Exception as e:
        print(f"Error loading model name mapping: {e}", file=sys.stderr)
        return {}

def aggregate_analytics_data():
    """
    Read all analytics.json files and aggregate unique models and modules.
    Returns tuple: (total_unique_models, total_unique_modules)
    Apply model name mapping to display friendly names.
    """
    # Load model name mapping
    model_name_map = load_model_name_mapping()
    print(f"Loaded {len(model_name_map)} model name mappings for analytics aggregation", file=sys.stderr)
    
    # Get project root directory (works regardless of execution context)
    script_dir = Path(__file__).parent.parent  # server/analytics -> server
    downloads_dir = script_dir / 'downloads'

    analytics_files = [
        downloads_dir / 'beta_user_issues' / 'analytics.json',
        downloads_dir / 'plm_issues' / 'analytics.json',
        downloads_dir / 'samsung_members_plm' / 'analytics.json',
        downloads_dir / 'samsung_members_voc' / 'analytics.json'
    ]

    unique_models = set()
    unique_modules = set()

    for file_path in analytics_files:
        try:
            if file_path.exists():
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)

                # Aggregate models from top_models
                if 'top_models' in data and data['top_models']:
                    for model in data['top_models']:
                        if 'label' in model:
                            model_label = model['label']
                            # Apply model name mapping
                            friendly_name = model_name_map.get(model_label, model_label)
                            unique_models.add(friendly_name)

                # Aggregate modules from categories
                if 'categories' in data and data['categories']:
                    for module in data['categories']:
                        if 'label' in module:
                            unique_modules.add(module['label'])

                print(f"[OK] Processed {file_path}: {len(data.get('top_models', []))} models, {len(data.get('categories', []))} modules", file=sys.stderr)
            else:
                print(f"[WARNING] Analytics file not found: {file_path}", file=sys.stderr)

        except Exception as e:
            print(f"[ERROR] Error reading {file_path}: {e}", file=sys.stderr)

    print(f"Aggregated totals: {len(unique_models)} unique models, {len(unique_modules)} unique modules", file=sys.stderr)
    return len(unique_models), len(unique_modules)

def get_per_source_data():
    """
    Read all analytics.json files and extract per-source data for top_models, top_modules, and top_titles_CaseCode.
    top_titles_CaseCode contains one "CaseCode : Title" entry per top_module.
    Returns dict with per-source data.
    """
    # Get project root directory (works regardless of execution context)
    script_dir = Path(__file__).parent.parent  # server/analytics -> server
    downloads_dir = script_dir / 'downloads'

    analytics_files = [
        (downloads_dir / 'beta_user_issues' / 'analytics.json', 'beta_user_issues'),
        (downloads_dir / 'plm_issues' / 'analytics.json', 'plm_issues'),
        (downloads_dir / 'samsung_members_plm' / 'analytics.json', 'samsung_members_plm'),
        (downloads_dir / 'samsung_members_voc' / 'analytics.json', 'samsung_members_voc')
    ]

    per_source_data = {}

    for file_path, source_name in analytics_files:
        try:
            if file_path.exists():
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)

                # Extract top_models
                top_models = data.get('top_models', [])

                # Extract categories as top_modules
                top_modules = data.get('categories', [])

                # Group issues by module
                module_issues = {}
                rows = data.get('rows', [])
                for row in rows:
                    module = row.get('Module', '')
                    title = row.get('Title', '')
                    case_code = row.get('Case Code', '')

                    if module and title and case_code:
                        if module not in module_issues:
                            module_issues[module] = []
                        module_issues[module].append((case_code, title))

                # Create top_titles_CaseCode - one entry per top_module
                top_titles_CaseCode = []
                for module_item in top_modules:
                    module_name = module_item.get('label', '')
                    if module_name in module_issues and module_issues[module_name]:
                        # Take the first issue for this module
                        case_code, title = module_issues[module_name][0]
                        formatted_entry = f"{case_code} : {title}"
                        top_titles_CaseCode.append(formatted_entry)

                per_source_data[f"{source_name}_top_models"] = top_models
                per_source_data[f"{source_name}_top_modules"] = top_modules
                per_source_data[f"{source_name}_top_titles_CaseCode"] = top_titles_CaseCode

                print(f"[OK] Extracted data for {source_name}: {len(top_models)} models, {len(top_modules)} modules, {len(top_titles_CaseCode)} top titles with case codes", file=sys.stderr)
            else:
                print(f"[WARNING] Analytics file not found: {file_path}", file=sys.stderr)

        except Exception as e:
            print(f"[ERROR] Error reading {file_path}: {e}", file=sys.stderr)

    return per_source_data

def run_aggregator_directly():
    """
    Run central_aggregator.py functions directly to avoid subprocess issues.
    """
    try:
        # Import and run the aggregator functions directly
        import central_aggregator as ca

        base_path = "../downloads"
        data = ca.load_all_excels(base_path)
        kpis, status_kpis = ca.compute_central_kpis(data)
        top_modules = ca.compute_top_modules(data)
        series_distribution = ca.compute_series_distribution(data)
        top_models = ca.compute_top_models(data)
        high_issues = ca.compute_high_issues(data)

        # Include additional data for cache generation efficiency
        model_module_matrix = ca.compute_model_module_matrix(data)
        source_model_summary = ca.compute_source_model_summary(data)

        # Get filtered top models for each source
        filtered_top_models = {}
        for folder_name in ['beta_user_issues', 'samsung_members_plm', 'samsung_members_voc']:
            filtered_top_models[folder_name] = ca.compute_top_models_by_source(data, folder_name)
        
        # Get raw model counts for legacy compatibility (for samsung_members_plm_top_models section)
        raw_top_models = {}
        for folder_name in ['beta_user_issues', 'plm_issues', 'samsung_members_plm', 'samsung_members_voc']:
            if folder_name in data:
                raw_top_models[folder_name] = ca.compute_top_models_by_source_raw(data, folder_name)

        # Compute total issues and high issues counts
        total_issues = sum(kpis[source]['total'] for source in kpis)
        high_issues_count = sum(kpis[source]['High_open'] for source in kpis)

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
            "series_distribution": series_distribution,
            "top_models": top_models,
            "high_issues": high_issues,
            "model_module_matrix": model_module_matrix,
            "source_model_summary": source_model_summary,
            "filtered_top_models": filtered_top_models,
            "raw_top_models": raw_top_models
        }

        # Sanitize NaN values
        response = ca.sanitize_nan(response)

        return response
    except Exception as e:
        print(f"Exception running aggregator directly: {e}", file=sys.stderr)
        return None

def compute_data_hash(data):
    """
    Compute a hash of the data content for cache validation.
    """
    # Create a normalized JSON string for consistent hashing
    normalized_json = json.dumps(data, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(normalized_json.encode('utf-8')).hexdigest()

def generate_central_cache():
    """
    Generate the centralized dashboard cache by aggregating all dashboard data.
    Uses single aggregator call for efficiency.
    """
    print("Generating centralized dashboard cache...", file=sys.stderr)

    # Get all aggregation data directly (avoid subprocess issues)
    base_data = run_aggregator_directly()
    if not base_data:
        print("Failed to get base aggregation data", file=sys.stderr)
        return False

    # Extract data from the single response
    kpis = base_data.get("kpis", {})
    status_kpis = base_data.get("status_kpis", {})
    total_issues = base_data.get("total_issues", 0)
    high_issues_count = base_data.get("high_issues_count", 0)
    top_modules = base_data.get("top_modules", [])
    series_distribution = base_data.get("series_distribution", [])
    top_models = base_data.get("top_models", [])
    high_issues = base_data.get("high_issues", [])
    model_module_matrix = base_data.get("model_module_matrix", {"models": [], "modules": [], "matrix": []})
    source_model_summary = base_data.get("source_model_summary", [])
    filtered_top_models = base_data.get("filtered_top_models", {})

    # Aggregate unique models and modules from all analytics.json files
    total_unique_models, total_unique_modules = aggregate_analytics_data()

    # Get per-source data
    per_source_data = get_per_source_data()

    # Create core data for hash computation (exclude metadata)
    core_data = {
        "kpis": kpis,
        "status_kpis": status_kpis,
        "total_issues": total_issues,
        "high_issues_count": high_issues_count,
        "top_modules": top_modules,
        "series_distribution": series_distribution,
        "top_models": top_models,
        "high_issues": high_issues,
        "model_module_matrix": model_module_matrix,
        "source_model_summary": source_model_summary,
        "filtered_top_models": filtered_top_models,
        "total_unique_models": total_unique_models,
        "total_unique_modules": total_unique_modules,
        **per_source_data  # Include per-source data
    }

    # Compute hash of the core data
    data_hash = compute_data_hash(core_data)

    # Combine all data into cache structure
    cache_data = {
        "last_updated": datetime.now().isoformat(),
        "version": "1.0",
        "data_hash": data_hash,
        **core_data  # Include all core data
    }

    # Ensure cache directory exists - use absolute path within server directory
    script_dir = Path(__file__).parent.parent  # server/analytics -> server
    cache_dir = script_dir / 'downloads' / '__dashboard_cache__'
    cache_dir.mkdir(parents=True, exist_ok=True)

    # Write cache file
    cache_file = cache_dir / "central_dashboard.json"
    try:
        with open(cache_file, 'w', encoding='utf-8') as f:
            json.dump(cache_data, f, indent=2, ensure_ascii=False)
        print(f"Cache generated successfully: {cache_file}", file=sys.stderr)
        print(f"Cache size: {os.path.getsize(cache_file)} bytes", file=sys.stderr)
        print(f"Data hash: {data_hash[:16]}...", file=sys.stderr)
        return True
    except Exception as e:
        print(f"Failed to write cache file: {e}", file=sys.stderr)
        return False

def validate_cache_freshness():
    """
    Check if cache is still fresh by comparing data hashes.
    Uses hash-based validation for robust cache invalidation.
    Returns True if cache is fresh, False if it needs regeneration.
    """
    # Use absolute path within server directory
    script_dir = Path(__file__).parent.parent  # server/analytics -> server
    cache_file = script_dir / 'downloads' / '__dashboard_cache__' / 'central_dashboard.json'
    if not cache_file.exists():
        print("Cache file missing", file=sys.stderr)
        return False

    try:
        # Get current data
        current_data = run_aggregator_directly()
        if not current_data:
            print("Cache is stale - cannot get current data", file=sys.stderr)
            return False

        # Extract current core data for hash computation
        current_core_data = {
            "kpis": current_data.get("kpis", {}),
            "status_kpis": current_data.get("status_kpis", {}),
            "total_issues": current_data.get("total_issues", 0),
            "high_issues_count": current_data.get("high_issues_count", 0),
            "top_modules": current_data.get("top_modules", []),
            "series_distribution": current_data.get("series_distribution", []),
            "top_models": current_data.get("top_models", []),
            "high_issues": current_data.get("high_issues", []),
            "model_module_matrix": current_data.get("model_module_matrix", {"models": [], "modules": [], "matrix": []}),
            "source_model_summary": current_data.get("source_model_summary", []),
            "filtered_top_models": current_data.get("filtered_top_models", {}),
        }

        # Aggregate current totals
        current_totals = aggregate_analytics_data()
        current_core_data["total_unique_models"] = current_totals[0]
        current_core_data["total_unique_modules"] = current_totals[1]

        # Get current per-source data
        current_per_source_data = get_per_source_data()
        current_core_data.update(current_per_source_data)

        # Compute current data hash
        current_hash = compute_data_hash(current_core_data)

        # Load cached data
        with open(cache_file, 'r', encoding='utf-8') as f:
            cached_data = json.load(f)

        # Get cached hash
        cached_hash = cached_data.get("data_hash")
        if not cached_hash:
            print("Cache is stale - no hash found in cached data", file=sys.stderr)
            return False

        # Compare hashes
        if current_hash != cached_hash:
            print("Cache is stale - data hash changed", file=sys.stderr)
            print(f"Current hash: {current_hash[:16]}...", file=sys.stderr)
            print(f"Cached hash:  {cached_hash[:16]}...", file=sys.stderr)
            return False

        print("Cache is fresh - data hash matches", file=sys.stderr)
        return True

    except Exception as e:
        print(f"Error validating cache freshness: {e}", file=sys.stderr)
        return False

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--validate":
        # Just validate cache freshness
        is_fresh = validate_cache_freshness()
        print("Cache is fresh" if is_fresh else "Cache is stale")
        sys.exit(0 if is_fresh else 1)
    else:
        # Generate cache
        success = generate_central_cache()
        sys.exit(0 if success else 1)

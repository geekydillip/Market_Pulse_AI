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
from datetime import datetime
from pathlib import Path

def run_aggregator_command(command_args=None):
    """
    Run central_aggregator.py with specified arguments and return parsed JSON result.
    """
    # Use absolute path to ensure correct execution
    script_dir = Path(__file__).parent
    aggregator_path = script_dir / 'central_aggregator.py'

    cmd = [sys.executable, str(aggregator_path)]
    if command_args:
        cmd.extend(command_args)

    try:
        # Run from the project root directory
        print(f"Running command: {' '.join(cmd)} from {script_dir.parent.parent}")
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=script_dir.parent.parent)
        print(f"Return code: {result.returncode}")
        if result.stdout:
            print(f"STDOUT: {result.stdout[:500]}...")
        if result.stderr:
            print(f"STDERR: {result.stderr[:500]}...")
        if result.returncode != 0:
            print(f"Error running aggregator with args {command_args}: {result.stderr}")
            return None

        return json.loads(result.stdout.strip())
    except Exception as e:
        print(f"Exception running aggregator: {e}")
        return None

def generate_central_cache():
    """
    Generate the centralized dashboard cache by aggregating all dashboard data.
    """
    print("Generating centralized dashboard cache...")

    # Get base aggregation data (kpis, top_modules, series_distribution, top_models, high_issues)
    base_data = run_aggregator_command()
    if not base_data:
        print("Failed to get base aggregation data")
        return False

    # Get model-module matrix
    matrix_data = run_aggregator_command(['matrix'])
    if not matrix_data:
        print("Warning: Failed to get model-module matrix, using empty data")
        matrix_data = {"models": [], "modules": [], "matrix": []}

    # Get source-model summary
    summary_data = run_aggregator_command(['summary'])
    if not summary_data:
        print("Warning: Failed to get source-model summary, using empty data")
        summary_data = []

    # Get filtered top models for each source
    filtered_models = {}
    for source in ['beta', 'plm', 'voc']:
        command_map = {
            'beta': 'top-models-beta',
            'plm': 'top-models-plm',
            'voc': 'top-models-voc'
        }
        models_data = run_aggregator_command([command_map[source]])
        filtered_models[source] = models_data if models_data else []

    # Combine all data into cache structure
    cache_data = {
        "last_updated": datetime.now().isoformat(),
        "version": "1.0",
        "kpis": base_data.get("kpis", {}),
        "top_modules": base_data.get("top_modules", []),
        "series_distribution": base_data.get("series_distribution", []),
        "top_models": base_data.get("top_models", []),
        "high_issues": base_data.get("high_issues", []),
        "model_module_matrix": matrix_data,
        "source_model_summary": summary_data,
        "filtered_top_models": filtered_models
    }

    # Ensure cache directory exists
    cache_dir = Path("./downloads/__dashboard_cache__")
    cache_dir.mkdir(parents=True, exist_ok=True)

    # Write cache file
    cache_file = cache_dir / "central_dashboard.json"
    try:
        with open(cache_file, 'w', encoding='utf-8') as f:
            json.dump(cache_data, f, indent=2, ensure_ascii=False)
        print(f"Cache generated successfully: {cache_file}")
        print(f"Cache size: {os.path.getsize(cache_file)} bytes")
        return True
    except Exception as e:
        print(f"Failed to write cache file: {e}")
        return False

def validate_cache_freshness():
    """
    Check if cache is still fresh by comparing current data with cached data.
    Returns True if cache is fresh, False if it needs regeneration.
    """
    cache_file = Path("./downloads/__dashboard_cache__/central_dashboard.json")
    if not cache_file.exists():
        print("Cache file missing")
        return False

    try:
        # Get current data
        current_data = run_aggregator_command()
        if not current_data:
            print("Cache is stale - cannot get current data")
            return False

        # Load cached data
        with open(cache_file, 'r', encoding='utf-8') as f:
            cached_data = json.load(f)

        # Compare key metrics to detect if data has changed
        current_kpis = current_data.get("kpis", {})
        cached_kpis = cached_data.get("kpis", {})

        # Check if total counts have changed (indicates files added/deleted)
        for key in ['Beta User Issues', 'Samsung Members PLM', 'Samsung Members VOC']:
            if current_kpis.get(key, 0) != cached_kpis.get(key, 0):
                print(f"Cache is stale - {key} count changed from {cached_kpis.get(key, 0)} to {current_kpis.get(key, 0)}")
                return False

        # Check if top models have changed
        current_top_models = [item['label'] for item in current_data.get("top_models", [])[:5]]
        cached_top_models = [item['label'] for item in cached_data.get("top_models", [])[:5]]

        if set(current_top_models) != set(cached_top_models):
            print("Cache is stale - top models changed")
            return False

        print("Cache is fresh")
        return True

    except Exception as e:
        print(f"Error validating cache freshness: {e}")
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

#!/usr/bin/env python3
"""
Excel to JSON Converter - Single File Solution

A comprehensive tool for converting Excel files to JSON format with batch processing capabilities.
Supports multiple Excel formats, sheet handling options, and robust error handling.

Usage:
    python excel_to_json_converter.py [source_folder] [destination_folder]
    
    Or modify the CONFIG section at the top of this file to set default paths.

Author: Cline
Created: 2025
"""

import os
import sys
import json
import pandas as pd
import traceback
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any, Optional, Union
import argparse


# ==================== CONFIGURATION ====================
CONFIG = {
    'source_folder': 'C:\\Users\\dilli\\Downloads\\Raw Data\\Samsung_Member_VOC',           # Source folder path - CHANGE THIS
    'destination_folder': 'D:\\JSON_Files',      # Destination folder path - CHANGE THIS
    'convert_all_sheets': True,                  # True: convert all sheets, False: first sheet only
    'overwrite_existing': False,                 # Overwrite existing JSON files
    'pretty_print': True,                        # Pretty-print JSON output
    'date_format': 'iso',                        # 'iso' for ISO format, or custom format string
    'empty_value': None,                         # How to handle empty cells: None, '', or 'skip'
    'supported_formats': ['.xlsx', '.xls', '.xlsm'],  # File formats to process
    'indent': 2,                                 # JSON indentation for pretty printing
    'encoding': 'utf-8'                          # File encoding
}


# ==================== UTILITY FUNCTIONS ====================

def setup_logging(log_file: Optional[str] = None) -> None:
    """Setup logging configuration"""
    if not log_file:
        log_file = f"excel_to_json_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
    
    global LOG_FILE
    LOG_FILE = log_file


def log_message(message: str, level: str = 'INFO') -> None:
    """Log messages to file and console"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_entry = f"[{timestamp}] {level}: {message}"
    
    # Print to console
    print(log_entry)
    
    # Write to log file
    try:
        with open(LOG_FILE, 'a', encoding=CONFIG['encoding']) as f:
            f.write(log_entry + '\n')
    except Exception:
        pass  # Ignore logging errors


def safe_convert_value(value: Any) -> Any:
    """Safely convert Excel values to JSON-compatible types"""
    if pd.isna(value):
        if CONFIG['empty_value'] == 'skip':
            return None
        return CONFIG['empty_value']
    
    # Handle different data types
    if isinstance(value, (int, float)):
        # Check if it's a whole number
        if isinstance(value, float) and value.is_integer():
            return int(value)
        return float(value)
    elif isinstance(value, str):
        return value.strip()
    elif isinstance(value, bool):
        return bool(value)
    elif hasattr(value, 'strftime'):  # Date/time objects
        if CONFIG['date_format'] == 'iso':
            return value.isoformat()
        else:
            try:
                return value.strftime(CONFIG['date_format'])
            except:
                return value.isoformat()
    else:
        return str(value)


def clean_column_name(column: Any) -> str:
    """Clean column names for JSON keys"""
    if pd.isna(column):
        return "unnamed_column"
    
    # Convert to string and clean
    col_str = str(column).strip()
    
    # Replace invalid JSON key characters
    invalid_chars = [' ', '-', '.', '/', '\\', '(', ')', '[', ']', '{', '}', ':', ';', ',', '@', '#', '$', '%', '^', '&', '*', '+', '=', '|', '<', '>', '?', '!', '~']
    for char in invalid_chars:
        col_str = col_str.replace(char, '_')
    
    # Remove multiple underscores
    while '__' in col_str:
        col_str = col_str.replace('__', '_')
    
    # Remove leading/trailing underscores
    col_str = col_str.strip('_')
    
    # If empty after cleaning, use default
    if not col_str:
        col_str = "column"
    
    return col_str


def convert_excel_to_json(excel_file: Path, dest_folder: Path) -> Dict[str, Any]:
    """
    Convert a single Excel file to JSON format
    
    Returns:
        Dict with conversion results and statistics
    """
    result = {
        'file': excel_file.name,
        'success': False,
        'sheets_processed': 0,
        'total_rows': 0,
        'errors': [],
        'output_files': []
    }
    
    try:
        log_message(f"Processing: {excel_file.name}")
        
        # Read Excel file with all sheets
        excel_data = pd.read_excel(excel_file, sheet_name=None, engine='openpyxl')
        
        if not excel_data:
            result['errors'].append("No sheets found in Excel file")
            log_message(f"ERROR: No sheets found in {excel_file.name}", 'ERROR')
            return result
        
        # Prepare output data structure
        output_data = {}
        file_base_name = excel_file.stem
        
        # Process sheets based on configuration
        sheets_to_process = list(excel_data.keys())
        
        if not CONFIG['convert_all_sheets'] and sheets_to_process:
            # Only process first sheet
            first_sheet = sheets_to_process[0]
            sheets_to_process = [first_sheet]
            log_message(f"Processing first sheet only: {first_sheet}")
        else:
            log_message(f"Processing {len(sheets_to_process)} sheets: {', '.join(sheets_to_process)}")
        
        for sheet_name in sheets_to_process:
            try:
                df = excel_data[sheet_name]
                
                # Skip empty sheets
                if df.empty:
                    log_message(f"WARNING: Sheet '{sheet_name}' is empty, skipping", 'WARNING')
                    continue
                
                # Clean column names
                df.columns = [clean_column_name(col) for col in df.columns]
                
                # Convert to list of dictionaries
                sheet_data = []
                for _, row in df.iterrows():
                    row_dict = {}
                    for col, val in row.items():
                        converted_val = safe_convert_value(val)
                        if converted_val is not None or CONFIG['empty_value'] != 'skip':
                            row_dict[col] = converted_val
                    sheet_data.append(row_dict)
                
                # Add to output data
                if CONFIG['convert_all_sheets']:
                    output_data[sheet_name] = sheet_data
                else:
                    output_data = sheet_data
                
                result['sheets_processed'] += 1
                result['total_rows'] += len(sheet_data)
                
                log_message(f"  Sheet '{sheet_name}': {len(sheet_data)} rows processed")
                
            except Exception as e:
                error_msg = f"Error processing sheet '{sheet_name}': {str(e)}"
                result['errors'].append(error_msg)
                log_message(f"ERROR: {error_msg}", 'ERROR')
        
        if result['sheets_processed'] == 0:
            result['errors'].append("No sheets were successfully processed")
            log_message(f"ERROR: No sheets processed for {excel_file.name}", 'ERROR')
            return result
        
        # Determine output filename(s)
        if CONFIG['convert_all_sheets']:
            # Single file with all sheets
            output_file = dest_folder / f"{file_base_name}.json"
            files_to_create = [(output_file, output_data)]
        else:
            # Single file for first sheet
            output_file = dest_folder / f"{file_base_name}.json"
            files_to_create = [(output_file, output_data)]
        
        # Write JSON files
        for output_file, data in files_to_create:
            try:
                # Check if file exists and handle overwrite
                if output_file.exists() and not CONFIG['overwrite_existing']:
                    log_message(f"SKIPPING: {output_file.name} already exists (overwrite=False)", 'WARNING')
                    continue
                
                # Write JSON file
                with open(output_file, 'w', encoding=CONFIG['encoding']) as f:
                    if CONFIG['pretty_print']:
                        json.dump(data, f, indent=CONFIG['indent'], ensure_ascii=False)
                    else:
                        json.dump(data, f, ensure_ascii=False)
                
                result['output_files'].append(str(output_file))
                result['success'] = True
                log_message(f"SUCCESS: Created {output_file.name}")
                
            except Exception as e:
                error_msg = f"Error writing JSON file {output_file.name}: {str(e)}"
                result['errors'].append(error_msg)
                log_message(f"ERROR: {error_msg}", 'ERROR')
        
    except Exception as e:
        error_msg = f"Critical error processing {excel_file.name}: {str(e)}"
        result['errors'].append(error_msg)
        log_message(f"CRITICAL ERROR: {error_msg}", 'ERROR')
        log_message(traceback.format_exc(), 'DEBUG')
    
    return result


def process_folder(source_folder: Path, dest_folder: Path) -> Dict[str, Any]:
    """
    Process all Excel files in the source folder
    
    Returns:
        Dict with processing summary
    """
    summary = {
        'total_files': 0,
        'successful': 0,
        'failed': 0,
        'skipped': 0,
        'total_sheets': 0,
        'total_rows': 0,
        'files': []
    }
    
    # Create destination folder if it doesn't exist
    dest_folder.mkdir(parents=True, exist_ok=True)
    
    log_message(f"Source folder: {source_folder}")
    log_message(f"Destination folder: {dest_folder}")
    log_message(f"Processing mode: {'All sheets' if CONFIG['convert_all_sheets'] else 'First sheet only'}")
    
    # Find all Excel files
    excel_files = []
    for ext in CONFIG['supported_formats']:
        excel_files.extend(source_folder.glob(f"*{ext}"))
    
    if not excel_files:
        log_message(f"WARNING: No Excel files found in {source_folder}", 'WARNING')
        return summary
    
    log_message(f"Found {len(excel_files)} Excel files to process")
    log_message("-" * 50)
    
    # Process each file
    for excel_file in sorted(excel_files):
        summary['total_files'] += 1
        
        result = convert_excel_to_json(excel_file, dest_folder)
        summary['files'].append(result)
        
        if result['success']:
            summary['successful'] += 1
            summary['total_sheets'] += result['sheets_processed']
            summary['total_rows'] += result['total_rows']
        elif result['errors']:
            summary['failed'] += 1
        else:
            summary['skipped'] += 1
    
    return summary


def print_summary(summary: Dict[str, Any]) -> None:
    """Print processing summary"""
    log_message("=" * 60)
    log_message("PROCESSING SUMMARY")
    log_message("=" * 60)
    log_message(f"Total files found: {summary['total_files']}")
    log_message(f"Successfully processed: {summary['successful']}")
    log_message(f"Failed: {summary['failed']}")
    log_message(f"Skipped: {summary['skipped']}")
    log_message(f"Total sheets processed: {summary['total_sheets']}")
    log_message(f"Total rows converted: {summary['total_rows']:,}")
    
    if summary['failed'] > 0:
        log_message("\nFAILED FILES:")
        for file_result in summary['files']:
            if not file_result['success'] and file_result['errors']:
                log_message(f"  {file_result['file']}: {', '.join(file_result['errors'])}")
    
    log_message("=" * 60)


def validate_paths(source_path: str, dest_path: str) -> tuple[Path, Path]:
    """Validate and convert path strings to Path objects"""
    source_folder = Path(source_path).resolve()
    dest_folder = Path(dest_path).resolve()
    
    if not source_folder.exists():
        raise ValueError(f"Source folder does not exist: {source_folder}")
    
    if not source_folder.is_dir():
        raise ValueError(f"Source path is not a directory: {source_folder}")
    
    return source_folder, dest_folder


def main():
    """Main execution function"""
    parser = argparse.ArgumentParser(
        description="Excel to JSON Converter - Batch processing tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python excel_to_json_converter.py "C:\\Excel_Files" "C:\\JSON_Files"
  python excel_to_json_converter.py --source "D:\\Data" --dest "D:\\Output" --first-sheet
        """
    )
    
    parser.add_argument('source', nargs='?', help='Source folder containing Excel files')
    parser.add_argument('dest', nargs='?', help='Destination folder for JSON files')
    parser.add_argument('--source', '-s', help='Source folder (alternative to positional)')
    parser.add_argument('--dest', '-d', help='Destination folder (alternative to positional)')
    parser.add_argument('--first-sheet', action='store_true', help='Convert only the first sheet (default: all sheets)')
    parser.add_argument('--overwrite', action='store_true', help='Overwrite existing JSON files')
    parser.add_argument('--compact', action='store_true', help='Generate compact JSON (no pretty printing)')
    parser.add_argument('--log-file', help='Custom log file name')
    
    args = parser.parse_args()
    
    # Determine source and destination paths
    source_path = args.source or args.source or CONFIG['source_folder']
    dest_path = args.dest or args.dest or CONFIG['destination_folder']
    
    # Override config with command line arguments
    if args.first_sheet:
        CONFIG['convert_all_sheets'] = False
    if args.overwrite:
        CONFIG['overwrite_existing'] = True
    if args.compact:
        CONFIG['pretty_print'] = False
    
    try:
        # Validate paths
        source_folder, dest_folder = validate_paths(source_path, dest_path)
        
        # Setup logging
        log_file = args.log_file or f"excel_to_json_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
        setup_logging(log_file)
        
        log_message("Excel to JSON Converter Started")
        log_message(f"Configuration: convert_all_sheets={CONFIG['convert_all_sheets']}, "
                   f"overwrite={CONFIG['overwrite_existing']}, pretty_print={CONFIG['pretty_print']}")
        
        # Process files
        summary = process_folder(source_folder, dest_folder)
        
        # Print summary
        print_summary(summary)
        
        # Final message
        if summary['successful'] > 0:
            log_message(f"Conversion completed successfully! Check {LOG_FILE} for details.")
            if summary['failed'] > 0:
                log_message(f"Note: {summary['failed']} files failed. See log for details.")
        else:
            log_message("No files were successfully processed. Check the log for errors.")
            
    except Exception as e:
        log_message(f"CRITICAL ERROR: {str(e)}", 'ERROR')
        log_message(traceback.format_exc(), 'DEBUG')
        sys.exit(1)


if __name__ == "__main__":
    main()
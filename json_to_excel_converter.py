#!/usr/bin/env python3
"""
JSON to Excel Converter
Converts JSON files to Excel format with proper data handling.

Usage:
    python json_to_excel_converter.py <json_file_path> [--output <output_path>]
    python json_to_excel_converter.py --directory <directory_path>

Examples:
    python json_to_excel_converter.py "data.json"
    python json_to_excel_converter.py "C:/Users/dilli/Downloads/Auto_recored/Original_Cleaned Data.json"
    python json_to_excel_converter.py --directory "C:/Users/dilli/Downloads/Auto_recored"
"""

import json
import pandas as pd
import argparse
import os
from pathlib import Path
from typing import Union, Dict, List, Any
import sys


def flatten_json(nested_json: Any, separator: str = '.') -> Dict[str, Any]:
    """
    Flatten a nested JSON object into a single-level dictionary.
    Handles nested dictionaries and lists.

    Args:
        nested_json: The JSON object to flatten
        separator: Separator for nested keys

    Returns:
        Flattened dictionary
    """
    flattened = {}

    def _flatten(obj: Any, prefix: str = '') -> None:
        if isinstance(obj, dict):
            for key, value in obj.items():
                new_key = f"{prefix}{separator}{key}" if prefix else key
                _flatten(value, new_key)
        elif isinstance(obj, list):
            # Handle lists by converting to string representation
            flattened[prefix] = str(obj)
        else:
            flattened[prefix] = obj

    _flatten(nested_json)
    return flattened


def json_to_excel(json_path: str, output_path: str = None) -> str:
    """
    Convert JSON file to Excel format.

    Args:
        json_path: Path to the JSON file
        output_path: Optional output path for Excel file

    Returns:
        Path to the created Excel file
    """
    # Generate output path if not provided
    if output_path is None:
        json_file = Path(json_path)
        output_path = json_file.with_suffix('.xlsx')

    # Read JSON file
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            json_data = json.load(f)
    except FileNotFoundError:
        raise FileNotFoundError(f"JSON file not found: {json_path}")
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON file: {e}")

    # Convert JSON to DataFrame based on structure
    if isinstance(json_data, list):
        # Handle list of objects (most common case)
        if all(isinstance(item, dict) for item in json_data):
            # List of dictionaries - most common structure
            df = pd.DataFrame(json_data)
        elif all(isinstance(item, (str, int, float, bool, type(None))) for item in json_data):
            # List of simple values - convert to single column DataFrame
            df = pd.DataFrame({'values': json_data})
        else:
            # Mixed list - convert each item to dict and flatten
            flattened_data = []
            for i, item in enumerate(json_data):
                if isinstance(item, dict):
                    flattened_data.append(flatten_json(item))
                else:
                    flattened_data.append({f'item_{i}': item})
            df = pd.DataFrame(flattened_data)

    elif isinstance(json_data, dict):
        # Handle single dictionary object
        flattened = flatten_json(json_data)
        df = pd.DataFrame([flattened])
    else:
        # Handle single value
        df = pd.DataFrame({'value': [json_data]})

    # Clean and format the DataFrame
    # Replace NaN values with empty strings
    df = df.fillna('')

    # Convert column names to string to avoid Excel compatibility issues
    df.columns = df.columns.astype(str)

    # Create Excel writer with formatting
    with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
        df.to_excel(writer, sheet_name='Data', index=False)

        # Access the workbook and worksheet for formatting
        workbook = writer.book
        worksheet = writer.sheets['Data']

        # Auto-adjust column widths
        for column in worksheet.columns:
            max_length = 0
            column_letter = column[0].column_letter

            for cell in column:
                try:
                    if len(str(cell.value)) > max_length:
                        max_length = len(str(cell.value))
                except:
                    pass

            # Set column width (max 50 characters)
            adjusted_width = min(max_length + 2, 50)
            worksheet.column_dimensions[column_letter].width = adjusted_width

        # Format header row (if openpyxl allows it)
        try:
            from openpyxl.styles import Font, PatternFill
            header_font = Font(bold=True, color='FFFFFF')
            header_fill = PatternFill(start_color='366092', end_color='366092', fill_type='solid')

            for cell in worksheet[1]:
                cell.font = header_font
                cell.fill = header_fill
        except ImportError:
            # Skip formatting if openpyxl styling is not available
            pass

    print(f"Successfully converted JSON to Excel: {output_path}")
    print(f"Rows: {len(df)}, Columns: {len(df.columns)}")

    return output_path


def convert_directory(json_directory: str) -> List[str]:
    """
    Convert all JSON files in a directory to Excel format.

    Args:
        json_directory: Path to the directory containing JSON files

    Returns:
        List of output Excel file paths
    """
    directory_path = Path(json_directory)
    if not directory_path.exists():
        raise FileNotFoundError(f"Directory not found: {json_directory}")

    if not directory_path.is_dir():
        raise ValueError(f"Path is not a directory: {json_directory}")

    # Find all JSON files in the directory
    json_files = list(directory_path.glob('*.json'))
    json_files.sort()  # Sort for consistent order

    if not json_files:
        print(f"No JSON files found in directory: {json_directory}")
        return []

    output_files = []
    successful_conversions = 0
    failed_conversions = 0

    print(f"Found {len(json_files)} JSON files in directory: {json_directory}")
    print("-" * 60)

    for json_file in json_files:
        try:
            print(f"Converting: {json_file.name}")
            output_file = json_to_excel(str(json_file))
            output_files.append(output_file)
            successful_conversions += 1
        except Exception as e:
            print(f"Error converting {json_file.name}: {e}")
            failed_conversions += 1

    print("-" * 60)
    print(f"Conversion summary:")
    print(f"  Successfully converted: {successful_conversions} files")
    print(f"  Failed conversions: {failed_conversions} files")
    print(f"  Total JSON files: {len(json_files)}")

    return output_files


def main():
    """Main function for command-line usage."""
    parser = argparse.ArgumentParser(
        description='Convert JSON files to Excel format',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  Convert single file:
    python json_to_excel_converter.py "data.json"
    python json_to_excel_converter.py "input.json" --output "output.xlsx"

  Convert all JSON files in a directory:
    python json_to_excel_converter.py --directory "C:/Users/dilli/Downloads/Auto_recored"
    python json_to_excel_converter.py -d "/path/to/json/files"
        """
    )

    parser.add_argument('--directory', '-d', metavar='DIR',
                       help='Convert all JSON files in the specified directory')

    parser.add_argument('json_file', nargs='?',
                       help='Path to the JSON file to convert (if not using --directory)')
    parser.add_argument('--output', '-o', metavar='OUTPUT',
                       help='Output Excel file path (for single file conversion)')

    # Make sure both modes aren't specified simultaneously
    args = parser.parse_args()

    if args.directory and args.json_file:
        parser.error("Cannot specify both --directory and a JSON file. Use one or the other.")

    if not args.directory and not args.json_file:
        parser.error("Must specify either --directory or a JSON file to convert.")

    try:
        if args.directory:
            # Batch conversion mode
            output_files = convert_directory(args.directory)
            if output_files:
                print(f"\nAll conversions completed! Check the directory: {args.directory}")
            else:
                print("\nNo files were converted.")
        else:
            # Single file conversion mode
            output_file = json_to_excel(args.json_file, args.output)
            print(f"\nConversion completed successfully!")
            print(f"Output file: {output_file}")

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

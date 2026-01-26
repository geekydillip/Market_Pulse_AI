#!/usr/bin/env python3
"""
Initialize RAG Service with Data from Excel Files
This script processes existing Excel files and adds their content to the RAG service.
"""

import pandas as pd
import os
import sys
import logging
from pathlib import Path

# Add the parent directory to Python path to allow imports from rag module
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, parent_dir)

from rag.service import create_rag_service

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def extract_text_from_excel(file_path: str) -> list:
    """
    Extract text content from an Excel file.
    
    Args:
        file_path: Path to the Excel file
        
    Returns:
        List of text chunks extracted from the Excel file
    """
    try:
        # Read all sheets from the Excel file
        xls = pd.ExcelFile(file_path)
        chunks = []
        
        for sheet_name in xls.sheet_names:
            # Read the sheet
            df = pd.read_excel(xls, sheet_name=sheet_name)
            
            # Process each row as a separate document
            for index, row in df.iterrows():
                # Convert row to text
                row_text = ""
                for col_name, value in row.items():
                    if pd.notna(value):  # Only include non-null values
                        row_text += f"{col_name}: {value}\n"
                
                if row_text.strip():  # Only include non-empty rows
                    chunks.append({
                        "content": row_text.strip(),
                        "source": file_path,
                        "sheet": sheet_name,
                        "row": index + 1
                    })
        
        logger.info(f"Extracted {len(chunks)} text chunks from {file_path}")
        return chunks
    except Exception as e:
        logger.error(f"Error processing {file_path}: {e}")
        return []

def initialize_rag_with_excel_data(data_directory: str = "./downloads"):
    """
    Initialize RAG service with data from Excel files.
    
    Args:
        data_directory: Directory containing Excel files to process
    """
    # Create RAG service instance
    rag_service = create_rag_service()
    
    # Check current document count
    health = rag_service.health_check()
    initial_count = health["documents_count"]
    logger.info(f"Initial document count: {initial_count}")
    
    # Find all Excel files in the data directory
    excel_files = []
    data_path = Path(data_directory)
    
    if not data_path.exists():
        logger.warning(f"Data directory {data_directory} does not exist")
        return
    
    # Recursively find all .xlsx files
    for file_path in data_path.rglob("*.xlsx"):
        # Skip processed files to avoid duplication
        if "_Processed.xlsx" not in file_path.name:
            excel_files.append(file_path)
    
    logger.info(f"Found {len(excel_files)} Excel files to process")
    
    # Process each Excel file
    all_documents = []
    for file_path in excel_files:
        logger.info(f"Processing {file_path}")
        documents = extract_text_from_excel(str(file_path))
        all_documents.extend(documents)
    
    # Add documents to RAG service
    if all_documents:
        logger.info(f"Adding {len(all_documents)} documents to RAG service")
        rag_service.add_documents(all_documents)
    else:
        logger.info("No documents to add")
    
    # Check final document count
    health = rag_service.health_check()
    final_count = health["documents_count"]
    logger.info(f"Final document count: {final_count}")
    logger.info(f"Added {final_count - initial_count} new documents")

def main():
    """
    Main function to run the initialization script.
    """
    logger.info("Initializing RAG service with Excel data")
    
    # Initialize with data from downloads directory
    initialize_rag_with_excel_data("./downloads")
    
    logger.info("RAG initialization complete")

if __name__ == "__main__":
    main()
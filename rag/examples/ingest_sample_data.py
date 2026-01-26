#!/usr/bin/env python3
"""
Sample script to demonstrate ingesting data into the RAG system
"""

import sys
import os
import pandas as pd

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Import RAG client
from rag.client import create_rag_client, RAGClient

def load_sample_data():
    """Load sample data from existing Excel files for ingestion"""
    # Find sample Excel files in the downloads directory
    downloads_path = "../downloads"
    sample_files = []
    
    # Walk through downloads directory to find processed Excel files
    for root, dirs, files in os.walk(downloads_path):
        for file in files:
            if file.endswith("_Processed.xlsx"):
                sample_files.append(os.path.join(root, file))
    
    return sample_files[:3]  # Limit to first 3 files for demo

def extract_text_from_excel(file_path):
    """Extract text content from Excel file"""
    try:
        # Read all sheets
        excel_file = pd.read_excel(file_path, sheet_name=None)
        
        text_content = []
        metadata = []
        
        for sheet_name, df in excel_file.items():
            # Convert dataframe to text
            sheet_text = f"Sheet: {sheet_name}\n"
            sheet_text += df.to_string(index=False)
            
            text_content.append(sheet_text)
            metadata.append({
                "source": file_path,
                "sheet": sheet_name,
                "type": "excel_sheet"
            })
            
        return text_content, metadata
    except Exception as e:
        print(f"Error processing {file_path}: {e}")
        return [], []

def main():
    """Main function to ingest sample data"""
    print("Loading sample data...")
    sample_files = load_sample_data()
    
    if not sample_files:
        print("No sample files found!")
        return
    
    print(f"Found {len(sample_files)} sample files")
    
    # Create RAG client
    client = create_rag_client("http://localhost:5000")
    
    # Check if service is healthy
    health = client.health_check()
    if not health.get("status") == "healthy":
        print("RAG service is not healthy:", health.get("error", "Unknown error"))
        return
    
    print("RAG service is healthy, beginning ingestion...")
    
    # Process each file
    all_documents = []
    all_metadata = []
    
    for file_path in sample_files:
        print(f"Processing {file_path}...")
        documents, metadata = extract_text_from_excel(file_path)
        
        all_documents.extend(documents)
        all_metadata.extend(metadata)
        
        print(f"  Extracted {len(documents)} documents")
    
    # Ingest all documents
    if all_documents:
        print(f"\nIngesting {len(all_documents)} documents into RAG service...")
        result = client.ingest_documents(all_documents, all_metadata)
        
        if result.get("success"):
            print(f"Successfully ingested {result.get('ingested_count')} documents")
            print(f"Total documents in index: {result.get('total_documents')}")
        else:
            print("Ingestion failed:", result.get("error"))
    else:
        print("No documents to ingest")

if __name__ == "__main__":
    main()
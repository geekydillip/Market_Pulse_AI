#!/usr/bin/env python3
"""
Initialize RAG Service with Data from Excel Files
This script processes existing Excel files and adds their content to the RAG service.
"""

import pandas as pd
import logging
from pathlib import Path
from rag.service import create_rag_service

logger = logging.getLogger(__name__)

# Define common column names used across different processors
COLUMN_MAPPING = {
    "content": ["Content", "Issue Description", "Raw Text", "Problem", "Feedback"],
    "module": ["Module", "Product Area", "Category", "Application Name"],
    "sub_module": ["Sub-Module", "Component", "Functional Area", "Feature"],
    "issue_type": ["Issue Type", "Classification", "Category Type"],
    "sub_issue_type": ["Sub-Issue Type", "Detailed Issue", "Symptom"]
}

def map_columns(df_columns):
    """Maps spreadsheet columns to structured vision fields."""
    mapping = {}
    for target, aliases in COLUMN_MAPPING.items():
        # Find the first matching column name from the spreadsheet
        match = next((col for col in df_columns if col in aliases), None)
        mapping[target] = match
    return mapping

def extract_structured_data(file_path: str) -> list:
    """Extracts content for vectorization and labels for metadata."""
    try:
        xls = pd.ExcelFile(file_path)
        structured_chunks = []

        for sheet_name in xls.sheet_names:
            df = pd.read_excel(xls, sheet_name=sheet_name)
            col_map = map_columns(df.columns)

            # Skip sheets that don't have at least a content column
            if not col_map["content"]:
                continue

            for index, row in df.iterrows():
                # 1. Extract the raw text for vectorization (NO labels included)
                raw_content = str(row.get(col_map["content"], "")).strip()

                if not raw_content or raw_content.lower() == "nan":
                    continue

                # 2. Extract classification labels as separate metadata fields
                doc = {
                    "content": raw_content, # Only this will be vectorized in service.py
                    "module": str(row.get(col_map["module"], "Other")),
                    "sub_module": str(row.get(col_map["sub_module"], "")),
                    "issue_type": str(row.get(col_map["issue_type"], "")),
                    "sub_issue_type": str(row.get(col_map["sub_issue_type"], "")),
                    "source": Path(file_path).stem, # Identifies the processor source
                    "row": index + 1
                }
                structured_chunks.append(doc)

        return structured_chunks
    except Exception as e:
        logger.error(f"Error processing {file_path}: {e}")
        return []

def initialize_rag_with_excel_data(data_directory: str = "./downloads"):
    """Initializes RAG with clean, structured data."""
    rag_service = create_rag_service()
    data_path = Path(data_directory)

    # 1. Find relevant files
    excel_files = [f for f in data_path.rglob("*.xlsx") if "_Processed" not in f.name]

    all_docs = []
    for file in excel_files:
        logger.info(f"Ingesting structured data from: {file.name}")
        all_docs.extend(extract_structured_data(str(file)))

    # 2. Batch add to service
    if all_docs:
        rag_service.add_documents(all_docs)
        logger.info(f"RAG vision initialized with {len(all_docs)} structured examples.")

def clear_existing_index(index_path: str = "./rag/index.faiss", docs_path: str = "./rag/documents.json"):
    """
    Clear existing FAISS index and documents to ensure clean structured data.
    
    Args:
        index_path: Path to FAISS index file
        docs_path: Path to documents JSON file
    """
    logger.info("Clearing existing RAG index and documents for clean structured data")
    
    # Clear FAISS index
    if os.path.exists(index_path):
        os.remove(index_path)
        logger.info(f"Cleared FAISS index at {index_path}")
    
    # Clear documents file
    if os.path.exists(docs_path):
        os.remove(docs_path)
        logger.info(f"Cleared documents file at {docs_path}")

def map_to_structured_classification(row_data: Dict[str, Any]) -> Dict[str, str]:
    """
    Map incoming data to structured classification fields using predefined logic.
    
    Args:
        row_data: Input row data from Excel/CSV
        
    Returns:
        Dictionary with structured classification fields
    """
    # Extract text content for classification
    content_text = " ".join(str(value) for value in row_data.values() if value)
    
    # Classification mapping logic
    classification = {
        "module": "Other",
        "sub_module": "",
        "issue_type": "",
        "sub_issue_type": ""
    }
    
    # Module classification
    module_keywords = {
        "Camera": ["camera", "photo", "video", "lens", "zoom", "flash", "selfie"],
        "Battery": ["battery", "charge", "drain", "power", "charging", "battery life"],
        "Network": ["network", "wifi", "cellular", "signal", "lte", "5g", "connection"],
        "Display": ["display", "screen", "touch", "touchscreen", "display", "pixel"],
        "Heating": ["heat", "overheat", "temperature", "hot", "warm"],
        "Connectivity": ["bluetooth", "usb", "headphone", "connection", "pairing"]
    }
    
    # Issue Type classification (order matters - more specific first)
    issue_type_keywords = {
        "Crash": ["crash", "freeze", "hang", "restart", "shutdown"],
        "Performance": ["performance", "slow", "lag", "speed", "responsive"],
        "Functional": ["function", "feature", "work", "not working", "broken"],
        "Usability": ["user interface", "ui", "ux", "difficult", "confusing", "easy to use", "hard to use"],
        "System": ["system", "os", "operating system", "firmware", "update"],
        "Compatibility": ["compatible", "support", "work with", "integration"],
        "Security": ["security", "virus", "malware", "hack", "secure"],
        "Battery": ["battery", "charge", "drain", "power"],
        "UI/UX": ["interface", "ui", "ux", "design", "layout", "button"]
    }
    
    # Sub-Issue Type classification
    sub_issue_keywords = {
        "CP Crash": ["cp crash", "communication processor", "modem crash"],
        "App Crash": ["app crash", "application crash", "app stopped"],
        "ANR": ["anr", "application not responding", "not responding"],
        "Slow/Lag": ["slow", "lag", "delay", "performance issue"],
        "Feature Not Working": ["not working", "broken", "malfunction", "feature issue"],
        "Poor Quality": ["poor quality", "bad quality", "low quality", "defective"]
    }
    
    # Determine Module
    content_lower = content_text.lower()
    for module, keywords in module_keywords.items():
        if any(keyword in content_lower for keyword in keywords):
            classification["module"] = module
            break
    
    # Determine Issue Type (check in order - more specific first)
    for issue_type, keywords in issue_type_keywords.items():
        if any(keyword in content_lower for keyword in keywords):
            classification["issue_type"] = issue_type
            break
    
    # Determine Sub-Issue Type
    for sub_issue, keywords in sub_issue_keywords.items():
        if any(keyword in content_lower for keyword in keywords):
            classification["sub_issue_type"] = sub_issue
            break
    
    # Determine Sub-Module based on Module and content
    if classification["module"] == "Camera":
        if "zoom" in content_lower:
            classification["sub_module"] = "Zoom"
        elif "flash" in content_lower:
            classification["sub_module"] = "Flash"
        elif "video" in content_lower:
            classification["sub_module"] = "Video Recording"
        else:
            classification["sub_module"] = "General"
    elif classification["module"] == "Battery":
        if "drain" in content_lower:
            classification["sub_module"] = "Drain"
        elif "charging" in content_lower:
            classification["sub_module"] = "Charging"
        else:
            classification["sub_module"] = "General"
    
    return classification

def extract_text_from_excel(file_path: str) -> list:
    """
    Extract text content from an Excel file with structured classification.
    Separates user content from labels to improve vector search accuracy.
    
    Args:
        file_path: Path to the Excel file
        
    Returns:
        List of text chunks extracted from the Excel file with structured metadata
    """
    try:
        # Read all sheets from the Excel file
        xls = pd.ExcelFile(file_path)
        chunks = []
        
        # Define columns that contain user content vs metadata/labels
        # These are typically the columns that contain the actual user complaint/issue
        user_content_columns = [
            'content', 'issue', 'problem', 'description', 'summary', 'details',
            'complaint', 'feedback', 'comment', 'text', 'message'
        ]
        
        # Define columns that contain metadata/labels (should not be vectorized)
        metadata_columns = [
            'module', 'sub_module', 'issue_type', 'sub_issue_type', 'category',
            'priority', 'severity', 'status', 'assignee', 'date', 'id', 'source'
        ]
        
        for sheet_name in xls.sheet_names:
            # Read the sheet
            df = pd.read_excel(xls, sheet_name=sheet_name)
            
            # Process each row as a separate document
            for index, row in df.iterrows():
                # Extract user content (actual complaint text)
                user_content = ""
                for col_name, value in row.items():
                    if pd.notna(value) and col_name.lower() in [col.lower() for col in user_content_columns]:
                        user_content += f"{value}\n"
                
                # If no specific content columns found, use the first non-metadata column
                if not user_content.strip():
                    for col_name, value in row.items():
                        if pd.notna(value) and col_name.lower() not in [col.lower() for col in metadata_columns]:
                            user_content += f"{value}\n"
                            break
                
                # Extract metadata for structured classification
                metadata_dict = {}
                for col_name, value in row.items():
                    if pd.notna(value) and col_name.lower() in [col.lower() for col in metadata_columns]:
                        metadata_dict[col_name] = str(value)
                
                # Only include rows with actual user content
                if user_content.strip():
                    # Map to structured classification using metadata
                    classification = map_to_structured_classification(metadata_dict)
                    
                    # Create structured document with separated content and labels
                    structured_doc = {
                        "content": user_content.strip(),  # Only the actual user complaint
                        "source": file_path,
                        "sheet": sheet_name,
                        "row": index + 1,
                        **classification,  # Add structured classification fields
                        "raw_metadata": metadata_dict  # Store original metadata for reference
                    }
                    chunks.append(structured_doc)
        
        logger.info(f"Extracted {len(chunks)} structured documents from {file_path}")
        return chunks
    except Exception as e:
        logger.error(f"Error processing {file_path}: {e}")
        return []

def initialize_rag_with_excel_data(data_directory: str = "./downloads"):
    """
    Initialize RAG service with structured data from Excel files.
    
    Args:
        data_directory: Directory containing Excel files to process
    """
    # Clear existing index to ensure clean structured data
    clear_existing_index()
    
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
        logger.info(f"Adding {len(all_documents)} structured documents to RAG service")
        rag_service.add_documents(all_documents)
    else:
        logger.info("No documents to add")
    
    # Check final document count
    health = rag_service.health_check()
    final_count = health["documents_count"]
    logger.info(f"Final document count: {final_count}")
    logger.info(f"Added {final_count - initial_count} new structured documents")

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

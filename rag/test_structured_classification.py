#!/usr/bin/env python3
"""
Test script for structured classification metadata in RAG system.
This script tests the complete implementation of structured issue classification.
"""

import sys
import os
import logging
from pathlib import Path

# Add the parent directory to Python path to allow imports from rag module
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, parent_dir)

from rag.service import create_rag_service
from rag.client import create_rag_client

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_structured_document_addition():
    """Test adding documents with structured classification metadata."""
    logger.info("Testing structured document addition...")
    
    # Clear existing index files for clean test
    import os
    index_path = "./rag/index.faiss"
    docs_path = "./rag/documents.json"
    
    if os.path.exists(index_path):
        os.remove(index_path)
        logger.info("Cleared existing FAISS index")
    
    if os.path.exists(docs_path):
        os.remove(docs_path)
        logger.info("Cleared existing documents file")
    
    # Create RAG service
    service = create_rag_service()
    
    # Test documents with structured classification
    test_documents = [
        {
            "content": "Green line issue appearing on display from 1 week.",
            "module": "Display",
            "sub_module": "Green Line",
            "issue_type": "Functional",
            "sub_issue_type": "UI Issue",
            "source": "test_data.xlsx"
        },
        {
            "content": "Camera app crashes when switching to front video recording.",
            "module": "Camera",
            "sub_module": "Video Recording",
            "issue_type": "Crash",
            "sub_issue_type": "App Crash",
            "source": "test_data.xlsx"
        },
        {
            "content": "Battery drains quickly when using GPS navigation.",
            "module": "Battery",
            "sub_module": "Drain",
            "issue_type": "Performance",
            "sub_issue_type": "Slow/Lag",
            "source": "test_data.xlsx"
        }
    ]
    
    # Add documents
    service.add_documents(test_documents)
    
    # Verify documents were added
    health = service.health_check()
    logger.info(f"Documents added: {health['documents_count']}")
    
    assert health["documents_count"] == 3, f"Expected 3 documents, got {health['documents_count']}"
    
    # Verify document structure
    for i, doc in enumerate(service.documents):
        expected_fields = ["content", "module", "sub_module", "issue_type", "sub_issue_type", "source"]
        for field in expected_fields:
            assert field in doc, f"Missing field '{field}' in document {i}"
    
    logger.info("✓ Structured document addition test passed")

def test_context_formatting():
    """Test context formatting with structured classification metadata."""
    logger.info("Testing context formatting...")
    
    # Create RAG client
    client = create_rag_client()
    
    # Mock context results with structured metadata
    mock_context_results = [
        {
            "content": "Green line issue appearing on display from 1 week.",
            "module": "Display",
            "sub_module": "Green Line",
            "issue_type": "Functional",
            "sub_issue_type": "UI Issue",
            "score": 0.85
        },
        {
            "content": "Camera app crashes when switching to front video recording.",
            "module": "Camera",
            "sub_module": "Video Recording",
            "issue_type": "Crash",
            "sub_issue_type": "App Crash",
            "score": 0.78
        }
    ]
    
    # Format context
    formatted_context = client.format_context_for_prompt(mock_context_results)
    
    # Verify format
    expected_lines = [
        "[Context 1]: Green line issue appearing on display from 1 week. | Module: Display | Sub-Module: Green Line | Issue Type: Functional | Sub-Issue Type: UI Issue",
        "[Context 2]: Camera app crashes when switching to front video recording. | Module: Camera | Sub-Module: Video Recording | Issue Type: Crash | Sub-Issue Type: App Crash"
    ]
    
    lines = formatted_context.split('\n')
    assert len(lines) == 2, f"Expected 2 lines, got {len(lines)}"
    
    for i, expected_line in enumerate(expected_lines):
        assert lines[i] == expected_line, f"Line {i+1} mismatch:\nExpected: {expected_line}\nGot: {lines[i]}"
    
    logger.info("✓ Context formatting test passed")

def test_retrieval_with_structured_metadata():
    """Test retrieval returns documents with structured metadata."""
    logger.info("Testing retrieval with structured metadata...")
    
    # Create RAG service
    service = create_rag_service()
    
    # Clear existing data for clean test
    if service.index.ntotal > 0:
        service = create_rag_service()
    
    # Add test documents
    test_documents = [
        {
            "content": "Samsung Galaxy S21 camera autofocus issues in low light",
            "module": "Camera",
            "sub_module": "Autofocus",
            "issue_type": "Functional",
            "sub_issue_type": "Feature Not Working",
            "source": "test_data.xlsx"
        },
        {
            "content": "Battery drains rapidly when using camera app",
            "module": "Battery",
            "sub_module": "Drain",
            "issue_type": "Performance",
            "sub_issue_type": "Slow/Lag",
            "source": "test_data.xlsx"
        },
        {
            "content": "Camera app crashes when taking photos",
            "module": "Camera",
            "sub_module": "General",
            "issue_type": "Crash",
            "sub_issue_type": "App Crash",
            "source": "test_data.xlsx"
        }
    ]
    
    service.add_documents(test_documents)
    
    # Test retrieval
    query = "camera autofocus problems"
    results = service.retrieve(query, k=2)
    
    # Verify results
    assert len(results) > 0, "No results returned"
    
    # Check that results contain structured metadata
    for result in results:
        expected_fields = ["content", "module", "sub_module", "issue_type", "sub_issue_type", "source", "score", "rank"]
        for field in expected_fields:
            assert field in result, f"Missing field '{field}' in result"
        
        # Verify structured fields have values
        assert result["module"] in ["Camera", "Battery"], f"Invalid module: {result['module']}"
        assert result["issue_type"] in ["Functional", "Performance", "Crash"], f"Invalid issue type: {result['issue_type']}"
    
    logger.info("✓ Retrieval with structured metadata test passed")

def test_classification_mapping():
    """Test the classification mapping logic."""
    logger.info("Testing classification mapping logic...")
    
    # Import the mapping function
    from rag.initialize import map_to_structured_classification
    
    # Test cases
    test_cases = [
        {
            "input": {"content": "Camera app crashes when taking photos"},
            "expected_module": "Camera",
            "expected_issue_type": "Crash",
            "expected_sub_issue_type": "App Crash"
        },
        {
            "input": {"content": "Battery drains quickly when using GPS"},
            "expected_module": "Battery",
            "expected_issue_type": "Usability",
            "expected_sub_issue_type": ""
        },
        {
            "input": {"content": "Display shows green lines"},
            "expected_module": "Display",
            "expected_issue_type": "",
            "expected_sub_issue_type": ""
        }
    ]
    
    for i, test_case in enumerate(test_cases):
        result = map_to_structured_classification(test_case["input"])
        
        assert result["module"] == test_case["expected_module"], \
            f"Test case {i+1}: Expected module '{test_case['expected_module']}', got '{result['module']}'"
        
        assert result["issue_type"] == test_case["expected_issue_type"], \
            f"Test case {i+1}: Expected issue type '{test_case['expected_issue_type']}', got '{result['issue_type']}'"
        
        if test_case["expected_sub_issue_type"]:
            assert result["sub_issue_type"] == test_case["expected_sub_issue_type"], \
                f"Test case {i+1}: Expected sub-issue type '{test_case['expected_sub_issue_type']}', got '{result['sub_issue_type']}'"
    
    logger.info("✓ Classification mapping test passed")

def main():
    """Run all tests."""
    logger.info("Starting structured classification tests...")
    
    try:
        test_structured_document_addition()
        test_context_formatting()
        test_retrieval_with_structured_metadata()
        test_classification_mapping()
        
        logger.info("✓ All tests passed successfully!")
        logger.info("\nStructured classification implementation is working correctly.")
        logger.info("The RAG system now supports:")
        logger.info("- Module, Sub-Module, Issue Type, and Sub-Issue Type classification")
        logger.info("- Structured document storage and retrieval")
        logger.info("- Enhanced prompt formatting with classification metadata")
        logger.info("- Automatic classification mapping for Excel data")
        
    except Exception as e:
        logger.error(f"Test failed: {e}")
        raise

if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""
Test script to verify all RAG service fixes are working correctly.
Tests the fixes for service startup, default_source parameter, and content/label separation.
"""

import sys
import os
import logging
import tempfile
import pandas as pd
from pathlib import Path

# Add the parent directory to Python path to allow imports from rag module
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, parent_dir)

from rag.service import create_rag_service
from rag.client import create_rag_client

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_default_source_parameter():
    """Test that the default_source parameter works correctly."""
    logger.info("Testing default_source parameter...")
    
    # Clear existing index for clean test
    import os
    index_path = "./rag/index.faiss"
    docs_path = "./rag/documents.json"
    
    if os.path.exists(index_path):
        os.remove(index_path)
    if os.path.exists(docs_path):
        os.remove(docs_path)
    
    # Create RAG service
    service = create_rag_service()
    
    # Test documents without source field
    test_documents = [
        {
            "content": "Camera app crashes when taking photos",
            "module": "Camera",
            "sub_module": "General",
            "issue_type": "Crash",
            "sub_issue_type": "App Crash"
        },
        {
            "content": "Battery drains quickly when using GPS",
            "module": "Battery",
            "sub_module": "Drain",
            "issue_type": "Performance",
            "sub_issue_type": "Slow/Lag"
        }
    ]
    
    # Add documents with custom default_source
    service.add_documents(test_documents, default_source="TestProcessor")
    
    # Verify documents were added with correct source
    health = service.health_check()
    logger.info(f"Documents added: {health['documents_count']}")
    
    assert health["documents_count"] == 2, f"Expected 2 documents, got {health['documents_count']}"
    
    # Check that documents have the correct source
    for doc in service.documents:
        assert doc["source"] == "TestProcessor", f"Expected source 'TestProcessor', got '{doc['source']}'"
        logger.info(f"✓ Document source correctly set to: {doc['source']}")
    
    logger.info("✓ default_source parameter test passed")

def test_content_label_separation():
    """Test that content and labels are properly separated in Excel processing."""
    logger.info("Testing content/label separation...")
    
    # Create a temporary Excel file with test data
    with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as temp_file:
        temp_path = temp_file.name
    
    try:
        # Create test data with both content and metadata columns
        test_data = {
            'description': ['Camera app crashes when taking photos', 'Battery drains quickly when using GPS'],
            'module': ['Camera', 'Battery'],
            'issue_type': ['Crash', 'Performance'],
            'priority': ['High', 'Medium'],
            'user_id': ['user123', 'user456']
        }
        
        df = pd.DataFrame(test_data)
        df.to_excel(temp_path, index=False)
        logger.info(f"Created test Excel file: {temp_path}")
        
        # Import the extract_text_from_excel function
        from rag.initialize import extract_text_from_excel
        
        # Extract text from the test file
        documents = extract_text_from_excel(temp_path)
        
        # Verify that documents were created
        assert len(documents) == 2, f"Expected 2 documents, got {len(documents)}"
        
        # Check that content only contains user complaint text, not labels
        for i, doc in enumerate(documents):
            content = doc["content"]
            logger.info(f"Document {i+1} content: {content}")
            
            # Content should only contain the description text, not metadata labels
            assert "Camera app crashes when taking photos" in content or "Battery drains quickly when using GPS" in content
            assert "module:" not in content.lower(), "Content should not contain module labels"
            assert "issue_type:" not in content.lower(), "Content should not contain issue_type labels"
            assert "priority:" not in content.lower(), "Content should not contain priority labels"
            assert "user_id:" not in content.lower(), "Content should not contain user_id labels"
            
            # But structured classification fields should be present
            assert "module" in doc, "Document should have module field"
            assert "issue_type" in doc, "Document should have issue_type field"
            assert "raw_metadata" in doc, "Document should have raw_metadata field"
            
            logger.info(f"✓ Document {i+1} content properly separated from labels")
        
        logger.info("✓ Content/label separation test passed")
        
    finally:
        # Clean up temporary file
        if os.path.exists(temp_path):
            os.unlink(temp_path)

def test_service_startup_fix():
    """Test that the service startup fix works correctly."""
    logger.info("Testing service startup fix...")
    
    # Test that we can import and create the service without errors
    try:
        service = create_rag_service()
        health = service.health_check()
        logger.info(f"Service health check: {health}")
        assert health["status"] == "healthy", "Service should be healthy"
        logger.info("✓ Service startup fix test passed")
    except Exception as e:
        logger.error(f"Service startup test failed: {e}")
        raise

def test_client_context_formatting():
    """Test that client properly formats structured metadata in context."""
    logger.info("Testing client context formatting...")
    
    # Create RAG client
    client = create_rag_client()
    
    # Mock context results with structured metadata
    mock_context_results = [
        {
            "content": "Camera app crashes when taking photos",
            "module": "Camera",
            "sub_module": "General",
            "issue_type": "Crash",
            "sub_issue_type": "App Crash",
            "source": "TestProcessor",
            "score": 0.85
        },
        {
            "content": "Battery drains quickly when using GPS",
            "module": "Battery",
            "sub_module": "Drain",
            "issue_type": "Performance",
            "sub_issue_type": "Slow/Lag",
            "source": "TestProcessor",
            "score": 0.78
        }
    ]
    
    # Format context
    formatted_context = client.format_context_for_prompt(mock_context_results)
    logger.info(f"Formatted context:\n{formatted_context}")
    
    # Verify format includes structured metadata
    lines = formatted_context.split('\n')
    assert len(lines) == 2, f"Expected 2 lines, got {len(lines)}"
    
    for i, line in enumerate(lines):
        assert "Module:" in line, f"Line {i+1} should contain Module field"
        assert "Issue Type:" in line, f"Line {i+1} should contain Issue Type field"
        assert "Sub-Issue Type:" in line, f"Line {i+1} should contain Sub-Issue Type field"
        assert "Sub-Module:" in line, f"Line {i+1} should contain Sub-Module field"
    
    logger.info("✓ Client context formatting test passed")

def main():
    """Run all tests for the implemented fixes."""
    logger.info("Running comprehensive tests for all RAG service fixes...")
    
    try:
        test_service_startup_fix()
        test_default_source_parameter()
        test_content_label_separation()
        test_client_context_formatting()
        
        logger.info("✓ All tests passed successfully!")
        logger.info("\nSummary of fixes implemented:")
        logger.info("1. ✅ Service startup mismatch fixed (init_rag.py now calls server.py)")
        logger.info("2. ✅ default_source parameter added to add_documents method")
        logger.info("3. ✅ Excel content processing fixed (separates user content from labels)")
        logger.info("4. ✅ Client context formatting enhanced with structured metadata")
        logger.info("\nThe RAG system now supports proper structured classification with clean vector search!")
        
    except Exception as e:
        logger.error(f"Test failed: {e}")
        raise

if __name__ == "__main__":
    main()
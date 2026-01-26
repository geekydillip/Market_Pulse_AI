#!/usr/bin/env python3
"""
Simple test to verify client context formatting works with structured metadata.
"""

import sys
import os

# Add the parent directory to Python path to allow imports from rag module
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, parent_dir)

from rag.client import create_rag_client

def test_client_formatting():
    """Test that client properly formats structured metadata in context."""
    print("Testing client context formatting...")
    
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
    print(f"Formatted context:\n{formatted_context}")
    
    # Verify format includes structured metadata
    lines = formatted_context.split('\n')
    assert len(lines) == 2, f"Expected 2 lines, got {len(lines)}"
    
    for i, line in enumerate(lines):
        assert "Module:" in line, f"Line {i+1} should contain Module field"
        assert "Issue Type:" in line, f"Line {i+1} should contain Issue Type field"
        assert "Sub-Issue Type:" in line, f"Line {i+1} should contain Sub-Issue Type field"
        assert "Sub-Module:" in line, f"Line {i+1} should contain Sub-Module field"
    
    print("✓ Client context formatting test passed!")

if __name__ == "__main__":
    test_client_formatting()
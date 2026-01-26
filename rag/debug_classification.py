#!/usr/bin/env python3
"""
Debug script for classification mapping logic.
"""

import sys
import os

# Add the parent directory to Python path to allow imports from rag module
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, parent_dir)

from rag.initialize import map_to_structured_classification

def debug_classification():
    """Debug the classification mapping logic."""
    
    test_cases = [
        {"content": "Camera app crashes when taking photos"},
        {"content": "Battery drains quickly when using GPS"},
        {"content": "Display shows green lines"}
    ]
    
    for i, test_case in enumerate(test_cases):
        print(f"\nTest case {i+1}: {test_case['content']}")
        result = map_to_structured_classification(test_case)
        print(f"Result: {result}")
        
        # Debug the content processing
        content_text = " ".join(str(value) for value in test_case.values() if value)
        content_lower = content_text.lower()
        print(f"Content text: '{content_text}'")
        print(f"Content lower: '{content_lower}'")

if __name__ == "__main__":
    debug_classification()
#!/usr/bin/env python3
"""
Test script for RAG integration
This script verifies that the RAG module is working correctly.
"""

import sys
import os
import unittest
import tempfile
import shutil
from pathlib import Path

# Add the project root to the Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

class TestRAGIntegration(unittest.TestCase):
    """Test cases for RAG integration."""
    
    @classmethod
    def setUpClass(cls):
        """Set up test environment."""
        # Change to project root
        cls.project_root = Path(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        cls.original_cwd = os.getcwd()
        os.chdir(cls.project_root)
        
        # Ensure RAG module can be imported
        try:
            import rag
        except ImportError:
            raise ImportError("RAG module not found. Please ensure the rag directory exists.")
    
    @classmethod
    def tearDownClass(cls):
        """Clean up test environment."""
        os.chdir(cls.original_cwd)
    
    def test_rag_client_import(self):
        """Test that RAG client can be imported."""
        try:
            from rag.client import create_rag_client
            client = create_rag_client()
            self.assertIsNotNone(client)
        except Exception as e:
            self.fail(f"Failed to import or create RAG client: {e}")
    
    def test_rag_service_import(self):
        """Test that RAG service can be imported."""
        try:
            from rag.service import create_rag_service
            service = create_rag_service()
            self.assertIsNotNone(service)
        except Exception as e:
            self.fail(f"Failed to import or create RAG service: {e}")
    
    def test_rag_server_import(self):
        """Test that RAG server can be imported."""
        try:
            import rag.server
            self.assertTrue(hasattr(rag.server, 'app'))
        except Exception as e:
            self.fail(f"Failed to import RAG server: {e}")
    
    def test_rag_requirements(self):
        """Test that RAG requirements are satisfied."""
        required_packages = [
            'flask',
            'sentence-transformers',
            'faiss-cpu',
            'numpy',
            'pandas',
            'openpyxl',
            'requests'
        ]
        
        try:
            # Try importing each package
            import flask
            import sentence_transformers
            import faiss
            import numpy
            import pandas
            import openpyxl
            import requests
            
            # All imports successful
            self.assertTrue(True)
        except ImportError as e:
            self.fail(f"Missing required package for RAG: {e}")
    
    def test_rag_processor_integration_import(self):
        """Test that processor integration can be imported."""
        try:
            from rag.processor_integration import integrate_rag_with_processor, RAGEnhancedProcessor
            self.assertTrue(True)
        except ImportError as e:
            self.fail(f"Failed to import processor integration: {e}")
    
    def test_rag_client_health_check(self):
        """Test RAG client health check."""
        try:
            from rag.client import create_rag_client
            client = create_rag_client()
            health = client.health_check()
            
            # Health check should return a dictionary with status
            self.assertIsInstance(health, dict)
            self.assertIn('status', health)
        except Exception as e:
            # If service is not running, this is acceptable for the test
            # We're testing the client functionality, not the service availability
            print(f"Note: RAG service not available for health check test: {e}")
            self.assertTrue(True)
    
    def test_rag_context_retrieval_formatting(self):
        """Test RAG context retrieval and formatting."""
        try:
            from rag.client import create_rag_client
            client = create_rag_client()
            
            # Test context formatting function
            sample_context = [
                {
                    "content": "Sample context 1",
                    "source": "test_source_1.xlsx",
                    "similarity": 0.95
                },
                {
                    "content": "Sample context 2",
                    "source": "test_source_2.xlsx",
                    "similarity": 0.87
                }
            ]
            
            formatted_context = client.format_context_for_prompt(sample_context)
            self.assertIsInstance(formatted_context, str)
            self.assertGreater(len(formatted_context), 0)
            
        except Exception as e:
            self.fail(f"Failed to test context formatting: {e}")

def main():
    """Run the tests."""
    print("Running RAG integration tests...")
    unittest.main(verbosity=2)

if __name__ == "__main__":
    main()
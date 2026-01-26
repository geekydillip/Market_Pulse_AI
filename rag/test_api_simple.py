#!/usr/bin/env python3
"""
Simple test script to verify API endpoint enhancements for structured classification.
Tests the enhanced /add_documents endpoint with source parameter support.
"""

import sys
import os
import requests
import json
import time
import subprocess
from pathlib import Path

# Add the parent directory to Python path to allow imports from rag module
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, parent_dir)

def test_api_endpoint():
    """Test the enhanced API endpoints with source parameter support."""
    print("Testing API endpoint enhancements...")

    # Start the RAG service
    print("Starting RAG service...")
    service_process = subprocess.Popen([
        sys.executable, "server.py"
    ], cwd="rag", stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    # Wait for service to start
    time.sleep(10)

    try:
        # Test 1: Health check
        print("Test 1: Health check")
        response = requests.get("http://localhost:5000/health", timeout=5)
        assert response.status_code == 200
        health_data = response.json()
        assert health_data["status"] == "healthy"
        print(f"Service health: {health_data}")

        # Test 2: Add documents with source parameter
        print("Test 2: Add documents with source parameter")
        test_documents = [
            {
                "content": "Camera app crashes when taking photos",
                "module": "Camera",
                "sub_module": "General",
                "issue_type": "Crash",
                "sub_issue_type": "App Crash"
            }
        ]

        response = requests.post(
            "http://localhost:5000/add_documents",
            json={
                "documents": test_documents,
                "source": "BetaIssuesProcessor"
            },
            timeout=10
        )

        assert response.status_code == 200
        result = response.json()
        assert "message" in result
        assert "source" in result
        assert "total_documents" in result
        assert result["source"] == "BetaIssuesProcessor"
        print(f"Added documents: {result}")

        # Test 3: Add documents without source parameter (should use default)
        print("Test 3: Add documents without source parameter")
        test_documents_2 = [
            {
                "content": "Display shows green lines after update",
                "module": "Display",
                "sub_module": "General",
                "issue_type": "Functional",
                "sub_issue_type": "UI Issue"
            }
        ]

        response = requests.post(
            "http://localhost:5000/add_documents",
            json={
                "documents": test_documents_2
                # No source parameter - should default to "Unknown"
            },
            timeout=10
        )

        assert response.status_code == 200
        result = response.json()
        assert result["source"] == "Unknown"
        print(f"Added documents with default source: {result}")

        # Test 4: Retrieve documents and verify structured metadata
        print("Test 4: Retrieve documents with structured metadata")
        response = requests.post(
            "http://localhost:5000/retrieve",
            json={
                "query": "camera crash",
                "k": 1
            },
            timeout=10
        )

        assert response.status_code == 200
        results = response.json()["results"]
        assert len(results) > 0

        # Verify structured metadata is present
        result = results[0]
        assert "content" in result
        assert "module" in result
        assert "sub_module" in result
        assert "issue_type" in result
        assert "sub_issue_type" in result
        assert "source" in result
        assert "score" in result
        assert "rank" in result
        print(f"Retrieved document: {result['content'][:50]}... | Module: {result['module']} | Source: {result['source']}")

        print("All API enhancement tests passed!")
        return True

    except Exception as e:
        print(f"API test failed: {e}")
        return False

    finally:
        # Clean up: terminate the service
        print("Cleaning up...")
        service_process.terminate()
        service_process.wait(timeout=5)
        print("Service terminated")

def main():
    """Run API enhancement tests."""
    print("Starting API enhancement tests...\n")

    try:
        success = test_api_endpoint()

        if success:
            print("\nAll tests passed successfully!")
            print("\nSummary of API enhancements:")
            print("1. [OK] /add_documents endpoint supports source parameter")
            print("2. [OK] Source attribution works for document batches")
            print("3. [OK] Default source handling (Unknown) works")
            print("4. [OK] Structured metadata preserved in retrieval")
            print("\nThe RAG API now fully supports structured classification!")
        else:
            print("\nSome tests failed. Please check the implementation.")

    except Exception as e:
        print(f"\nTest suite failed: {e}")

if __name__ == "__main__":
    main()
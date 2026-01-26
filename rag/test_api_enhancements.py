#!/usr/bin/env python3
"""
Test script to verify API endpoint enhancements for structured classification.
Tests the enhanced /add_documents endpoint with source parameter support.
"""

import sys
import os
import requests
import json
import time
import subprocess
import signal
from pathlib import Path

# Add the parent directory to Python path to allow imports from rag module
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, parent_dir)

def test_api_endpoint_enhancements():
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
            },
            {
                "content": "Battery drains quickly when using GPS",
                "module": "Battery",
                "sub_module": "Drain",
                "issue_type": "Performance",
                "sub_issue_type": "Slow/Lag"
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
                "k": 2
            },
            timeout=10
        )

        assert response.status_code == 200
        results = response.json()["results"]
        assert len(results) > 0

        # Verify structured metadata is present
        for result in results:
            assert "content" in result
            assert "module" in result
            assert "sub_module" in result
            assert "issue_type" in result
            assert "sub_issue_type" in result
            assert "source" in result
            assert "score" in result
            assert "rank" in result
            print(f"Retrieved document: {result['content'][:50]}... | Module: {result['module']} | Source: {result['source']}")

        # Test 5: Document count endpoint
        print("Test 5: Document count endpoint")
        response = requests.get("http://localhost:5000/documents/count", timeout=5)
        assert response.status_code == 200
        count_data = response.json()
        assert "count" in count_data
        assert count_data["count"] >= 3  # Should have at least our 3 test documents
        print(f"Total documents: {count_data['count']}")

        print("All API enhancement tests passed!")
        return True

    except Exception as e:
        print(f"❌ API test failed: {e}")
        return False

    finally:
        # Clean up: terminate the service
        print("🧹 Cleaning up...")
        service_process.terminate()
        service_process.wait(timeout=5)
        print("🎯 Service terminated")

def test_end_to_end_workflow():
    """Test the complete end-to-end workflow with structured classification."""
    print("\n🔄 Testing end-to-end workflow...")

    try:
        # Test the complete workflow from document addition to retrieval
        # This verifies that structured metadata is preserved throughout

        # Start service
        service_process = subprocess.Popen([
            sys.executable, "server.py"
        ], cwd="rag", stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        time.sleep(8)  # Wait for service to start

        # Clear existing index for clean test
        import os
        index_path = "./rag/index.faiss"
        docs_path = "./rag/documents.json"

        if os.path.exists(index_path):
            os.remove(index_path)
        if os.path.exists(docs_path):
            os.remove(docs_path)

        # Add test documents from different sources
        sources_and_documents = {
            "BetaIssuesProcessor": [
                {
                    "content": "Camera autofocus fails in low light",
                    "module": "Camera",
                    "sub_module": "Autofocus",
                    "issue_type": "Functional",
                    "sub_issue_type": "Feature Not Working"
                }
            ],
            "SamsungMembersVOC": [
                {
                    "content": "Battery overheats during charging",
                    "module": "Battery",
                    "sub_module": "Charging",
                    "issue_type": "Performance",
                    "sub_issue_type": "Slow/Lag"
                }
            ]
        }

        for source, documents in sources_and_documents.items():
            response = requests.post(
                "http://localhost:5000/add_documents",
                json={"documents": documents, "source": source},
                timeout=10
            )
            assert response.status_code == 200
            print(f"✅ Added documents from {source}")

        # Test retrieval with structured metadata
        query = "camera autofocus"
        response = requests.post(
            "http://localhost:5000/retrieve",
            json={"query": query, "k": 1},
            timeout=10
        )

        results = response.json()["results"]
        assert len(results) == 1
        result = results[0]

        # Verify all structured fields are present and correct
        assert result["module"] == "Camera"
        assert result["sub_module"] == "Autofocus"
        assert result["issue_type"] == "Functional"
        assert result["sub_issue_type"] == "Feature Not Working"
        assert result["source"] == "BetaIssuesProcessor"
        assert "Camera autofocus fails in low light" in result["content"]

        print(f"🎯 End-to-end workflow test passed!")
        print(f"📋 Retrieved: {result['content']}")
        print(f"📋 Module: {result['module']}")
        print(f"📋 Source: {result['source']}")

        # Clean up
        service_process.terminate()
        service_process.wait(timeout=5)

        return True

    except Exception as e:
        print(f"❌ End-to-end test failed: {e}")
        return False

def main():
    """Run all API enhancement tests."""
    print("Starting comprehensive API enhancement tests...\n")

    try:
        success = test_api_endpoint_enhancements()
        if success:
            success = test_end_to_end_workflow()

        if success:
            print("\nAll tests passed successfully!")
            print("\nSummary of API enhancements:")
            print("1. [OK] /add_documents endpoint supports source parameter")
            print("2. [OK] Source attribution works for document batches")
            print("3. [OK] Default source handling (Unknown) works")
            print("4. [OK] Structured metadata preserved in retrieval")
            print("5. [OK] End-to-end workflow verified")
            print("\nThe RAG API now fully supports structured classification!")
        else:
            print("\nSome tests failed. Please check the implementation.")

    except Exception as e:
        print(f"\nTest suite failed: {e}")

if __name__ == "__main__":
    main()
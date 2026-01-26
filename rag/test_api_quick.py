#!/usr/bin/env python3
"""
Quick test of the enhanced API endpoint.
"""

import requests
import json

def test_api():
    # Test the enhanced /add_documents endpoint
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

    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")

    # Test retrieval
    response = requests.post(
        "http://localhost:5000/retrieve",
        json={"query": "camera crash", "k": 1},
        timeout=10
    )

    print(f"Retrieval: {response.json()}")

if __name__ == "__main__":
    test_api()
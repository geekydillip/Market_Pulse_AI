#!/usr/bin/env python3
"""
Flask API Server for RAG Service
Provides RESTful endpoints for the RAG service.
"""

from flask import Flask, request, jsonify
import logging
import os
import sys

# Add the current directory to Python path to allow imports from rag module
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Also add the parent directory to find the rag module
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rag.service import create_rag_service

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create Flask app
app = Flask(__name__)

# Create RAG service instance
rag_service = create_rag_service()

@app.route('/health', methods=['GET'])
def health_check():
    """
    Health check endpoint.
    
    Returns:
        Health status of the RAG service
    """
    try:
        health = rag_service.health_check()
        return jsonify(health)
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return jsonify({"status": "unhealthy", "error": str(e)}), 500

@app.route('/retrieve', methods=['POST'])
def retrieve():
    """
    Retrieve relevant context for a query.
    
    Request Body:
        query (str): Query string to search for relevant context
        k (int, optional): Number of context passages to retrieve (default: 3)
        
    Returns:
        List of context passages
    """
    try:
        # Parse request data
        data = request.get_json()
        if not data:
            return jsonify({"error": "No JSON data provided"}), 400
            
        query = data.get('query')
        if not query:
            return jsonify({"error": "Missing 'query' parameter"}), 400
            
        k = data.get('k', 3)
        
        # Retrieve context
        results = rag_service.retrieve(query, k=k)
        
        return jsonify({"results": results})
    except Exception as e:
        logger.error(f"Retrieve failed: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/add_documents', methods=['POST'])
def add_documents():
    """
    Add documents to the RAG service with structured classification support.

    Request Body:
        documents (list): List of document dictionaries with structured classification fields
        source (str, optional): Source identifier for document attribution

    Returns:
        Success message with document count
    """
    try:
        # Parse request data
        data = request.get_json()
        if not data:
            return jsonify({"error": "No JSON data provided"}), 400

        documents = data.get('documents')
        if not documents:
            return jsonify({"error": "Missing 'documents' parameter"}), 400

        # Get source parameter for document attribution
        source = data.get('source', 'Unknown')

        # Add documents with source attribution
        rag_service.add_documents(documents, default_source=source)

        # Get updated document count
        health = rag_service.health_check()
        document_count = health["documents_count"]

        return jsonify({
            "message": f"Successfully added {len(documents)} documents",
            "source": source,
            "total_documents": document_count
        })
    except Exception as e:
        logger.error(f"Add documents failed: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/documents/count', methods=['GET'])
def get_document_count():
    """
    Get the count of indexed documents.
    
    Returns:
        Document count
    """
    try:
        health = rag_service.health_check()
        return jsonify({"count": health["documents_count"]})
    except Exception as e:
        logger.error(f"Get document count failed: {e}")
        return jsonify({"error": str(e)}), 500

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    # Get port from environment variable or default to 5000
    port = int(os.environ.get('PORT', 5000))
    
    logger.info(f"Starting RAG service server on port {port}")
    app.run(host='127.0.0.1', port=port, debug=False)
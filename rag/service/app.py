import os
import sys
import logging
from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
import faiss
from sentence_transformers import SentenceTransformer
import pickle
import json
from typing import List, Dict, Any
import threading
from datetime import datetime

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Global variables for the RAG service
model = None
index = None
documents = []
metadata = []
lock = threading.Lock()

# Configuration
INDEX_PATH = os.path.join(os.path.dirname(__file__), '..', 'indexes', 'faiss_indexes')
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
INDEX_DIMENSION = 384  # For all-MiniLM-L6-v2

def initialize_service():
    """Initialize the RAG service with model and index"""
    global model, index, documents, metadata
    
    try:
        # Load embedding model
        logger.info("Loading embedding model...")
        model = SentenceTransformer(EMBEDDING_MODEL)
        
        # Create indexes directory if it doesn't exist
        os.makedirs(INDEX_PATH, exist_ok=True)
        
        # Try to load existing index
        index_file = os.path.join(INDEX_PATH, 'faiss_index.bin')
        docs_file = os.path.join(INDEX_PATH, 'documents.pkl')
        meta_file = os.path.join(INDEX_PATH, 'metadata.pkl')
        
        if os.path.exists(index_file) and os.path.exists(docs_file) and os.path.exists(meta_file):
            logger.info("Loading existing FAISS index...")
            index = faiss.read_index(index_file)
            
            with open(docs_file, 'rb') as f:
                documents = pickle.load(f)
                
            with open(meta_file, 'rb') as f:
                metadata = pickle.load(f)
                
            logger.info(f"Loaded index with {index.ntotal} documents")
        else:
            # Create new index
            logger.info("Creating new FAISS index...")
            index = faiss.IndexFlatIP(INDEX_DIMENSION)  # Inner product for cosine similarity
            documents = []
            metadata = []
            logger.info("Created new empty index")
            
    except Exception as e:
        logger.error(f"Error initializing service: {str(e)}")
        raise

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "model_loaded": model is not None,
        "index_size": index.ntotal if index else 0,
        "documents_count": len(documents)
    })

@app.route('/ingest', methods=['POST'])
def ingest_documents():
    """Ingest documents into the FAISS index"""
    global index, documents, metadata
    
    try:
        data = request.get_json()
        if not data or 'documents' not in data:
            return jsonify({"error": "No documents provided"}), 400
            
        docs = data['documents']
        docs_metadata = data.get('metadata', [])
        
        if not isinstance(docs, list):
            return jsonify({"error": "Documents must be a list"}), 400
            
        logger.info(f"Ingesting {len(docs)} documents")
        
        # Acquire lock for thread safety
        with lock:
            # Generate embeddings
            embeddings = model.encode(docs)
            
            # Normalize for inner product (cosine similarity)
            faiss.normalize_L2(embeddings)
            
            # Add to index
            start_id = len(documents)
            index.add(embeddings.astype(np.float32))
            
            # Store documents and metadata
            documents.extend(docs)
            metadata.extend(docs_metadata if docs_metadata else [{}] * len(docs))
            
            # Save index periodically
            save_index()
            
        return jsonify({
            "success": True,
            "ingested_count": len(docs),
            "total_documents": len(documents),
            "start_id": start_id
        })
        
    except Exception as e:
        logger.error(f"Error ingesting documents: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/retrieve', methods=['POST'])
def retrieve_documents():
    """Retrieve relevant documents using semantic search"""
    try:
        data = request.get_json()
        if not data or 'query' not in data:
            return jsonify({"error": "No query provided"}), 400
            
        query = data['query']
        k = data.get('k', 5)  # Default to 5 results
        filter_metadata = data.get('filter', {})
        
        if not query:
            return jsonify({"error": "Query cannot be empty"}), 400
            
        logger.info(f"Retrieving top {k} documents for query: {query}")
        
        # Generate query embedding
        query_embedding = model.encode([query])
        faiss.normalize_L2(query_embedding)
        
        # Search index
        with lock:
            if index.ntotal == 0:
                return jsonify({
                    "success": True,
                    "results": [],
                    "query": query
                })
            
            scores, indices = index.search(query_embedding.astype(np.float32), min(k, index.ntotal))
            
        # Format results
        results = []
        for i, (score, idx) in enumerate(zip(scores[0], indices[0])):
            if idx != -1 and score > 0:  # Valid result
                result = {
                    "id": int(idx),
                    "score": float(score),
                    "document": documents[idx] if idx < len(documents) else "",
                    "metadata": metadata[idx] if idx < len(metadata) else {}
                }
                
                # Apply metadata filtering if requested
                if not filter_metadata or matches_metadata(result["metadata"], filter_metadata):
                    results.append(result)
                    
                if len(results) >= k:
                    break
        
        return jsonify({
            "success": True,
            "results": results,
            "query": query
        })
        
    except Exception as e:
        logger.error(f"Error retrieving documents: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/stats', methods=['GET'])
def get_stats():
    """Get service statistics"""
    try:
        with lock:
            return jsonify({
                "success": True,
                "index_size": index.ntotal,
                "documents_count": len(documents),
                "metadata_count": len(metadata),
                "embedding_model": EMBEDDING_MODEL,
                "index_dimension": INDEX_DIMENSION,
                "last_updated": datetime.now().isoformat()
            })
    except Exception as e:
        logger.error(f"Error getting stats: {str(e)}")
        return jsonify({"error": str(e)}), 500

def matches_metadata(doc_meta: Dict, filter_meta: Dict) -> bool:
    """Check if document metadata matches filter criteria"""
    for key, value in filter_meta.items():
        if key not in doc_meta or doc_meta[key] != value:
            return False
    return True

def save_index():
    """Save the FAISS index and associated data"""
    try:
        # Create indexes directory if it doesn't exist
        os.makedirs(INDEX_PATH, exist_ok=True)
        
        # Save FAISS index
        index_file = os.path.join(INDEX_PATH, 'faiss_index.bin')
        faiss.write_index(index, index_file)
        
        # Save documents
        docs_file = os.path.join(INDEX_PATH, 'documents.pkl')
        with open(docs_file, 'wb') as f:
            pickle.dump(documents, f)
            
        # Save metadata
        meta_file = os.path.join(INDEX_PATH, 'metadata.pkl')
        with open(meta_file, 'wb') as f:
            pickle.dump(metadata, f)
            
        logger.info(f"Saved index with {index.ntotal} documents")
        
    except Exception as e:
        logger.error(f"Error saving index: {str(e)}")

if __name__ == '__main__':
    # Initialize service
    initialize_service()
    
    # Run Flask app
    app.run(host='localhost', port=5000, debug=False)
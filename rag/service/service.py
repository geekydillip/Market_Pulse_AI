#!/usr/bin/env python3
"""
RAG Service Implementation for Market Pulse AI
Provides a lightweight RAG service using FAISS for vector storage and retrieval.
"""

import os
import json
import logging
from typing import List, Dict, Any, Tuple
import numpy as np
import faiss
from sentence_transformers import SentenceTransformer
import pickle
import hashlib
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class RAGService:
    """
    RAG Service implementation using FAISS for vector storage and retrieval.
    """
    
    def __init__(self, 
                 model_name: str = "all-MiniLM-L6-v2",
                 index_path: str = "./rag/index.faiss",
                 documents_path: str = "./rag/documents.json",
                 cache_dir: str = "./rag/cache"):
        """
        Initialize the RAG service.
        
        Args:
            model_name: Name of the sentence transformer model to use
            index_path: Path to store/load the FAISS index
            documents_path: Path to store/load document metadata
            cache_dir: Directory for caching embeddings
        """
        self.model_name = model_name
        self.index_path = index_path
        self.documents_path = documents_path
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        
        # Initialize sentence transformer model
        logger.info(f"Loading sentence transformer model: {model_name}")
        self.model = SentenceTransformer(model_name)
        
        # Initialize FAISS index
        self.dimension = self.model.get_sentence_embedding_dimension()
        self.index = None
        self.documents = []
        
        # Load existing index and documents if they exist
        self.load_index()
        
    def load_index(self):
        """
        Load existing FAISS index and documents if they exist.
        """
        try:
            if os.path.exists(self.index_path) and os.path.exists(self.documents_path):
                logger.info("Loading existing FAISS index and documents")
                self.index = faiss.read_index(self.index_path)
                
                with open(self.documents_path, 'r') as f:
                    self.documents = json.load(f)
                    
                logger.info(f"Loaded {len(self.documents)} documents")
            else:
                logger.info("Creating new FAISS index")
                self.index = faiss.IndexFlatIP(self.dimension)  # Inner product for cosine similarity
                self.documents = []
        except Exception as e:
            logger.error(f"Failed to load index: {e}")
            logger.info("Creating new FAISS index")
            self.index = faiss.IndexFlatIP(self.dimension)
            self.documents = []
    
    def save_index(self):
        """
        Save the FAISS index and documents.
        """
        try:
            # Create directory if it doesn't exist
            os.makedirs(os.path.dirname(self.index_path), exist_ok=True)
            
            # Save FAISS index
            faiss.write_index(self.index, self.index_path)
            
            # Save documents
            with open(self.documents_path, 'w') as f:
                json.dump(self.documents, f, indent=2)
                
            logger.info(f"Saved {len(self.documents)} documents to index")
        except Exception as e:
            logger.error(f"Failed to save index: {e}")
    
    def _get_embedding_cache_key(self, text: str) -> str:
        """
        Generate a cache key for embeddings based on text content.
        
        Args:
            text: Text to generate cache key for
            
        Returns:
            Cache key string
        """
        text_hash = hashlib.md5(text.encode('utf-8')).hexdigest()
        return f"{text_hash}.pkl"
    
    def _get_cached_embedding(self, text: str) -> np.ndarray:
        """
        Get cached embedding for text if available.
        
        Args:
            text: Text to get embedding for
            
        Returns:
            Embedding vector or None if not cached
        """
        cache_key = self._get_embedding_cache_key(text)
        cache_path = self.cache_dir / cache_key
        
        if cache_path.exists():
            try:
                with open(cache_path, 'rb') as f:
                    return pickle.load(f)
            except Exception as e:
                logger.warning(f"Failed to load cached embedding: {e}")
        
        return None
    
    def _cache_embedding(self, text: str, embedding: np.ndarray):
        """
        Cache embedding for text.
        
        Args:
            text: Text the embedding is for
            embedding: Embedding vector to cache
        """
        cache_key = self._get_embedding_cache_key(text)
        cache_path = self.cache_dir / cache_key
        
        try:
            with open(cache_path, 'wb') as f:
                pickle.dump(embedding, f)
        except Exception as e:
            logger.warning(f"Failed to cache embedding: {e}")
    
    def encode_text(self, text: str) -> np.ndarray:
        """
        Encode text into embedding vector.
        
        Args:
            text: Text to encode
            
        Returns:
            Embedding vector
        """
        # Check cache first
        embedding = self._get_cached_embedding(text)
        if embedding is not None:
            return embedding
        
        # Generate embedding
        embedding = self.model.encode([text], show_progress_bar=False)[0]
        
        # Normalize for cosine similarity
        embedding = embedding / np.linalg.norm(embedding)
        
        # Cache the embedding
        self._cache_embedding(text, embedding)
        
        return embedding
    
    def add_documents(self, documents: List[Dict[str, Any]]):
        """
        Add documents with structured classification metadata to the RAG service.
        Expected keys: content, module, sub_module, issue_type, sub_issue_type
        
        Args:
            documents: List of document dictionaries with structured classification fields
        """
        logger.info(f"Adding {len(documents)} structured documents to RAG service")
        
        # Prepare embeddings
        embeddings = []
        valid_documents = []
        
        for doc in documents:
            content = doc.get('content', '')
            if content.strip():  # Skip empty documents
                # Ensure all structured classification fields exist, defaulting to empty strings if missing
                structured_doc = {
                    "content": content,
                    "module": doc.get("module", "Other"),
                    "sub_module": doc.get("sub_module", ""),
                    "issue_type": doc.get("issue_type", ""),
                    "sub_issue_type": doc.get("sub_issue_type", ""),
                    "source": doc.get("source", "Unknown")
                }
                
                embedding = self.encode_text(content)
                embeddings.append(embedding)
                valid_documents.append(structured_doc)
        
        if embeddings:
            # Convert to numpy array
            embeddings_array = np.array(embeddings).astype('float32')
            
            # Add to index
            self.index.add(embeddings_array)
            
            # Add to documents list
            self.documents.extend(valid_documents)
            
            # Save updated index
            self.save_index()
            
            logger.info(f"Successfully added {len(valid_documents)} structured documents")
        else:
            logger.warning("No valid documents to add")
    
    def retrieve(self, query: str, k: int = 3) -> List[Dict[str, Any]]:
        """
        Retrieve relevant documents for a query.
        
        Args:
            query: Query string
            k: Number of documents to retrieve
            
        Returns:
            List of relevant documents with scores
        """
        if self.index.ntotal == 0:
            logger.warning("No documents in index")
            return []
        
        # Encode query
        query_embedding = self.encode_text(query)
        query_embedding = query_embedding.reshape(1, -1).astype('float32')
        
        # Search index
        scores, indices = self.index.search(query_embedding, min(k, self.index.ntotal))
        
        # Prepare results
        results = []
        for i, (score, idx) in enumerate(zip(scores[0], indices[0])):
            if idx < len(self.documents) and score > 0:  # Only include valid results with positive scores
                result = self.documents[idx].copy()
                result['score'] = float(score)
                result['rank'] = i + 1
                results.append(result)
        
        return results
    
    def health_check(self) -> Dict[str, Any]:
        """
        Check the health of the RAG service.
        
        Returns:
            Health status dictionary
        """
        return {
            "status": "healthy",
            "model": self.model_name,
            "documents_count": len(self.documents),
            "index_size": self.index.ntotal if self.index else 0,
            "dimension": self.dimension
        }

def create_rag_service(**kwargs) -> RAGService:
    """
    Factory function to create a RAG service.
    
    Args:
        **kwargs: Arguments to pass to RAGService constructor
        
    Returns:
        RAGService instance
    """
    return RAGService(**kwargs)

# Example usage and testing
if __name__ == "__main__":
    # Create service
    service = create_rag_service()
    
    # Check health
    health = service.health_check()
    print(f"RAG Service Health: {health}")
    
    # Add sample documents
    sample_docs = [
        {
            "content": "Samsung Galaxy S21 camera issues often relate to the autofocus system failing in low light conditions.",
            "source": "tech_support_guide.pdf",
            "category": "camera"
        },
        {
            "content": "Battery drain issues in Samsung devices can be caused by third-party apps running in the background.",
            "source": "battery_optimization_guide.pdf",
            "category": "battery"
        },
        {
            "content": "Display flickering problems may indicate a loose connection between the screen and motherboard.",
            "source": "hardware_repair_manual.pdf",
            "category": "display"
        }
    ]
    
    # Add documents (only if index is empty)
    if service.index.ntotal == 0:
        service.add_documents(sample_docs)
        print(f"Added {len(sample_docs)} sample documents")
    
    # Test retrieval
    query = "Samsung Galaxy S21 camera problems"
    results = service.retrieve(query, k=2)
    print(f"\nRetrieval results for '{query}':")
    for result in results:
        print(f"- Score: {result['score']:.4f}, Content: {result['content'][:100]}...")
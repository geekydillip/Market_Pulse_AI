import hashlib
import json
import os
import pickle
from typing import List, Dict, Any, Tuple
import logging
from sentence_transformers import SentenceTransformer

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ChunkingUtils:
    """Utility class for document chunking and caching"""
    
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        """
        Initialize chunking utilities
        
        Args:
            model_name: Name of the sentence transformer model to use
        """
        self.model = SentenceTransformer(model_name)
        
    def chunk_text_by_sentences(self, text: str, max_chunk_size: int = 512, overlap: int = 50) -> List[str]:
        """
        Chunk text by sentences with overlap
        
        Args:
            text: Text to chunk
            max_chunk_size: Maximum size of each chunk in tokens
            overlap: Number of sentences to overlap between chunks
            
        Returns:
            List of text chunks
        """
        import re
        
        # Split by sentences
        sentences = re.split(r'[.!?]+', text)
        sentences = [s.strip() for s in sentences if s.strip()]
        
        if not sentences:
            return [text] if text.strip() else []
            
        chunks = []
        current_chunk = []
        current_length = 0
        
        for sentence in sentences:
            sentence_length = len(sentence.split())
            
            # If adding this sentence would exceed the chunk size, finalize current chunk
            if current_length + sentence_length > max_chunk_size and current_chunk:
                chunks.append('. '.join(current_chunk) + '.')
                # Start new chunk with overlap
                overlap_start = max(0, len(current_chunk) - overlap)
                current_chunk = current_chunk[overlap_start:] if overlap_start < len(current_chunk) else []
                current_length = sum(len(s.split()) for s in current_chunk)
            
            # Add sentence to current chunk
            current_chunk.append(sentence)
            current_length += sentence_length
            
        # Add final chunk if it exists
        if current_chunk:
            chunks.append('. '.join(current_chunk) + '.')
            
        return chunks
    
    def chunk_text_by_tokens(self, text: str, max_chunk_size: int = 512, overlap: int = 50) -> List[str]:
        """
        Chunk text by token count with overlap
        
        Args:
            text: Text to chunk
            max_chunk_size: Maximum size of each chunk in tokens
            overlap: Number of tokens to overlap between chunks
            
        Returns:
            List of text chunks
        """
        words = text.split()
        chunks = []
        
        for i in range(0, len(words), max_chunk_size - overlap):
            chunk_words = words[i:i + max_chunk_size]
            if chunk_words:
                chunks.append(' '.join(chunk_words))
                
        return chunks
    
    def semantic_chunking(self, text: str, max_chunks: int = 10) -> List[str]:
        """
        Perform semantic chunking using sentence embeddings
        
        Args:
            text: Text to chunk
            max_chunks: Maximum number of chunks to create
            
        Returns:
            List of semantically coherent chunks
        """
        import numpy as np
        from sklearn.cluster import KMeans
        
        # Split into sentences
        import re
        sentences = re.split(r'[.!?]+', text)
        sentences = [s.strip() for s in sentences if s.strip()]
        
        if len(sentences) <= max_chunks:
            return sentences
            
        # Get sentence embeddings
        embeddings = self.model.encode(sentences)
        
        # Cluster sentences
        kmeans = KMeans(n_clusters=max_chunks, random_state=42)
        cluster_labels = kmeans.fit_predict(embeddings)
        
        # Group sentences by clusters
        chunks = [''] * max_chunks
        for sentence, label in zip(sentences, cluster_labels):
            if chunks[label]:
                chunks[label] += ' ' + sentence
            else:
                chunks[label] = sentence
                
        # Remove empty chunks
        chunks = [chunk for chunk in chunks if chunk.strip()]
        
        return chunks

class CacheManager:
    """Cache manager for storing and retrieving processed data"""
    
    def __init__(self, cache_dir: str = "./cache"):
        """
        Initialize cache manager
        
        Args:
            cache_dir: Directory to store cache files
        """
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)
        
    def _get_cache_key(self, data: Any) -> str:
        """
        Generate a cache key for the given data
        
        Args:
            data: Data to generate cache key for
            
        Returns:
            Hash string for cache key
        """
        data_str = json.dumps(data, sort_keys=True, default=str)
        return hashlib.md5(data_str.encode()).hexdigest()
        
    def get_cached_result(self, key_data: Any, cache_type: str = "default") -> Any:
        """
        Retrieve cached result if available
        
        Args:
            key_data: Data to generate cache key from
            cache_type: Type of cache (for organizing cache files)
            
        Returns:
            Cached result or None if not found
        """
        cache_key = self._get_cache_key(key_data)
        cache_file = os.path.join(self.cache_dir, f"{cache_type}_{cache_key}.pkl")
        
        if os.path.exists(cache_file):
            try:
                with open(cache_file, 'rb') as f:
                    result = pickle.load(f)
                logger.info(f"Cache hit for {cache_type}: {cache_key}")
                return result
            except Exception as e:
                logger.warning(f"Failed to load cache {cache_file}: {str(e)}")
                
        logger.info(f"Cache miss for {cache_type}: {cache_key}")
        return None
        
    def set_cached_result(self, key_data: Any, result: Any, cache_type: str = "default"):
        """
        Store result in cache
        
        Args:
            key_data: Data to generate cache key from
            result: Result to cache
            cache_type: Type of cache (for organizing cache files)
        """
        cache_key = self._get_cache_key(key_data)
        cache_file = os.path.join(self.cache_dir, f"{cache_type}_{cache_key}.pkl")
        
        try:
            with open(cache_file, 'wb') as f:
                pickle.dump(result, f)
            logger.info(f"Cached result for {cache_type}: {cache_key}")
        except Exception as e:
            logger.warning(f"Failed to cache result {cache_key}: {str(e)}")

# Pre-initialized instances for convenience
chunker = ChunkingUtils()
cache_manager = CacheManager()

def chunk_and_cache_text(text: str, chunking_method: str = "sentences", 
                        max_chunk_size: int = 512, overlap: int = 50) -> List[str]:
    """
    Chunk text with caching
    
    Args:
        text: Text to chunk
        chunking_method: Method to use ("sentences", "tokens", or "semantic")
        max_chunk_size: Maximum chunk size for token/sentence methods
        overlap: Overlap between chunks
        
    Returns:
        List of text chunks
    """
    # Check cache first
    cache_key = {
        "text_hash": hashlib.md5(text.encode()).hexdigest(),
        "method": chunking_method,
        "max_chunk_size": max_chunk_size,
        "overlap": overlap
    }
    
    cached_result = cache_manager.get_cached_result(cache_key, "chunking")
    if cached_result is not None:
        return cached_result
        
    # Chunk if not cached
    if chunking_method == "sentences":
        chunks = chunker.chunk_text_by_sentences(text, max_chunk_size, overlap)
    elif chunking_method == "tokens":
        chunks = chunker.chunk_text_by_tokens(text, max_chunk_size, overlap)
    elif chunking_method == "semantic":
        chunks = chunker.semantic_chunking(text, max_chunk_size)
    else:
        raise ValueError(f"Unknown chunking method: {chunking_method}")
        
    # Cache result
    cache_manager.set_cached_result(cache_key, chunks, "chunking")
    
    return chunks
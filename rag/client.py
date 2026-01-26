#!/usr/bin/env python3
"""
RAG Client for Market Pulse AI
Provides functions to interact with the RAG service for enhancing prompts with contextual information.
"""

import requests
import json
import logging
from typing import List, Dict, Any, Optional

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class RAGClient:
    """
    Client for interacting with the RAG service.
    Provides methods to retrieve context and enhance prompts with relevant information.
    """
    
    def __init__(self, base_url: str = "http://localhost:5000"):
        """
        Initialize the RAG client.
        
        Args:
            base_url: Base URL of the RAG service
        """
        self.base_url = base_url.rstrip('/')
        
    def health_check(self) -> Dict[str, Any]:
        """
        Check if the RAG service is healthy.
        
        Returns:
            Health status dictionary
        """
        try:
            response = requests.get(f"{self.base_url}/health", timeout=5)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            logger.warning(f"RAG service health check failed: {e}")
            return {"status": "unhealthy", "error": str(e)}
    
    def retrieve_context(self, query: str, k: int = 3) -> List[Dict[str, Any]]:
        """
        Retrieve relevant context for a query.
        
        Args:
            query: Query string to search for relevant context
            k: Number of context passages to retrieve
            
        Returns:
            List of context passages
        """
        try:
            payload = {
                "query": query,
                "k": k
            }
            response = requests.post(
                f"{self.base_url}/retrieve", 
                json=payload, 
                timeout=30
            )
            response.raise_for_status()
            return response.json().get("results", [])
        except requests.RequestException as e:
            logger.error(f"Failed to retrieve context: {e}")
            return []
    
    def format_context_for_prompt(self, context_results: List[Dict[str, Any]]) -> str:
        """
        Format retrieved context for inclusion in prompts with structured classification.
        
        Args:
            context_results: List of context passages from retrieval
            
        Returns:
            Formatted context string with structured classification metadata
        """
        if not context_results:
            return ""
            
        context_parts = []
        for i, result in enumerate(context_results, 1):
            content = result.get("content", "").strip()
            module = result.get("module", "N/A")
            sub_module = result.get("sub_module", "N/A")
            issue_type = result.get("issue_type", "N/A")
            sub_issue_type = result.get("sub_issue_type", "N/A")
            
            # Format with structured classification metadata
            formatted_context = (
                f"[Context {i}]: {content} | "
                f"Module: {module} | "
                f"Sub-Module: {sub_module} | "
                f"Issue Type: {issue_type} | "
                f"Sub-Issue Type: {sub_issue_type}"
            )
            context_parts.append(formatted_context)
                
        return "\n".join(context_parts)
    
    def inject_context_into_prompt(self, original_prompt: str, context: str) -> str:
        """
        Inject context into the original prompt.
        
        Args:
            original_prompt: Original prompt template
            context: Context to inject
            
        Returns:
            Enhanced prompt with context
        """
        if not context:
            return original_prompt
            
        # Add context at the beginning of the prompt
        enhanced_prompt = f"""Contextual Information:
{context}

Instructions:
{original_prompt}"""
        
        return enhanced_prompt

def create_rag_client(base_url: str = "http://localhost:5000") -> RAGClient:
    """
    Factory function to create a RAG client.
    
    Args:
        base_url: Base URL of the RAG service
        
    Returns:
        RAGClient instance
    """
    return RAGClient(base_url)

def format_context_for_prompt(context_results: List[Dict[str, Any]]) -> str:
    """
    Format retrieved context for inclusion in prompts.
    
    Args:
        context_results: List of context passages from retrieval
        
    Returns:
        Formatted context string
    """
    client = RAGClient()
    return client.format_context_for_prompt(context_results)

def inject_context_into_prompt(original_prompt: str, context: str) -> str:
    """
    Inject context into the original prompt.
    
    Args:
        original_prompt: Original prompt template
        context: Context to inject
        
    Returns:
        Enhanced prompt with context
    """
    client = RAGClient()
    return client.inject_context_into_prompt(original_prompt, context)

# Example usage
if __name__ == "__main__":
    # Create client
    client = create_rag_client()
    
    # Check health
    health = client.health_check()
    print(f"RAG Service Health: {health}")
    
    # Retrieve context
    query = "Samsung Galaxy S21 camera issues"
    context = client.retrieve_context(query, k=2)
    print(f"Retrieved Context: {context}")
    
    # Format context
    formatted_context = client.format_context_for_prompt(context)
    print(f"Formatted Context:\n{formatted_context}")
    
    # Original prompt
    original_prompt = """Analyze the following issue:
    
    Issue: Camera app crashes when taking photos
    Device: Samsung Galaxy S21
    
    Please provide:
    1. Root cause analysis
    2. Recommended fix approach
    3. Priority classification"""
    
    # Enhance prompt
    enhanced_prompt = client.inject_context_into_prompt(original_prompt, formatted_context)
    print(f"Enhanced Prompt:\n{enhanced_prompt}")
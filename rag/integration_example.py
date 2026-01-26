#!/usr/bin/env python3
"""
Example of integrating RAG with existing processors
This script demonstrates how to enhance prompts with contextual information from RAG.
"""

import sys
import os
import logging
from rag.client import create_rag_client, inject_context_into_prompt

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def enhance_prompt_with_rag(original_prompt: str, query: str, k: int = 3) -> str:
    """
    Enhance a prompt with contextual information from RAG.
    
    Args:
        original_prompt: Original prompt to enhance
        query: Query to retrieve context for
        k: Number of context passages to retrieve
        
    Returns:
        Enhanced prompt with contextual information
    """
    # Create RAG client
    client = create_rag_client()
    
    # Check if RAG service is available
    health = client.health_check()
    if health.get("status") != "healthy":
        logger.warning("RAG service is not healthy, using original prompt")
        return original_prompt
    
    # Retrieve context
    context_results = client.retrieve_context(query, k=k)
    
    # Format context
    context = client.format_context_for_prompt(context_results)
    
    # Inject context into prompt
    enhanced_prompt = client.inject_context_into_prompt(original_prompt, context)
    
    return enhanced_prompt

def main():
    """
    Main function to demonstrate RAG integration.
    """
    # Example usage with a beta issues processor prompt
    original_prompt = """Analyze the following issue report:
    
    Issue Summary: App crashes when taking photos
    Device Model: Samsung Galaxy S21
    Software Version: Android 12
    Frequency: Occurs frequently during nighttime photography
    
    Please provide:
    1. Root cause analysis
    2. Recommended fix approach
    3. Priority classification (High/Medium/Low)
    4. Additional notes or observations"""
    
    query = "Samsung Galaxy S21 camera app crash issues"
    
    print("Original Prompt:")
    print(original_prompt)
    print("\n" + "="*50 + "\n")
    
    # Enhance prompt with RAG
    enhanced_prompt = enhance_prompt_with_rag(original_prompt, query, k=2)
    
    print("Enhanced Prompt with RAG Context:")
    print(enhanced_prompt)

if __name__ == "__main__":
    main()
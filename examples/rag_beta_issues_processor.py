#!/usr/bin/env python3
"""
Example of a RAG-enhanced Beta Issues Processor
This script demonstrates how to modify an existing processor to use RAG capabilities.
"""

import sys
import os
import logging

# Add the project root to the Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import existing processor
import processors.betaIssues as beta_issues_processor

# Import RAG integration utilities
from rag.processor_integration import integrate_rag_with_processor

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def create_rag_enhanced_beta_issues_processor():
    """
    Create a RAG-enhanced version of the beta issues processor.
    
    Returns:
        RAGEnhancedProcessor: Processor with RAG capabilities
    """
    # Integrate existing processor with RAG
    rag_processor = integrate_rag_with_processor(beta_issues_processor)
    return rag_processor

def process_beta_issue_with_rag(issue_data: dict) -> dict:
    """
    Process a beta issue with RAG enhancement.
    
    Args:
        issue_data: Dictionary containing issue information
        
    Returns:
        dict: Processed results with RAG enhancement
    """
    # Create RAG-enhanced processor
    rag_processor = create_rag_enhanced_beta_issues_processor()
    
    # Process with RAG enhancement
    result = rag_processor.process_with_rag_enhancement(issue_data)
    
    return result

def main():
    """
    Main function to demonstrate RAG-enhanced processing.
    """
    # Sample issue data (similar to what would come from Excel)
    sample_issue = {
        "Issue_ID": "BUG-12345",
        "Summary": "Camera app crashes when taking photos",
        "Device_Model": "Samsung Galaxy S21",
        "Software_Version": "Android 12",
        "Frequency": "Often",
        "Description": "App crashes consistently during nighttime photography",
        "Priority": "High"
    }
    
    print("Processing beta issue with RAG enhancement...")
    print(f"Input: {sample_issue}")
    print("\n" + "="*50 + "\n")
    
    # Process with RAG enhancement
    result = process_beta_issue_with_rag(sample_issue)
    
    print("Results:")
    for key, value in result.items():
        if key == '_rag_enhanced_prompt':
            print(f"{key}: [Enhanced prompt content (truncated)]")
        else:
            print(f"{key}: {value}")

# Alternative approach: Direct prompt enhancement
def enhance_beta_issues_prompt(original_prompt: str, issue_data: dict) -> str:
    """
    Directly enhance a beta issues prompt with RAG context.
    
    Args:
        original_prompt: Original prompt from processor
        issue_data: Issue data for context query generation
        
    Returns:
        str: Enhanced prompt with RAG context
    """
    # Import RAG client directly for more control
    from rag.client import create_rag_client
    
    # Create RAG client
    client = create_rag_client()
    
    # Generate context query from issue data
    context_query = f"{issue_data.get('Device_Model', '')} {issue_data.get('Summary', '')}".strip()
    
    # Check if RAG service is available
    health = client.health_check()
    if health.get("status") != "healthy":
        logger.warning("RAG service is not healthy, using original prompt")
        return original_prompt
    
    # Retrieve context
    context_results = client.retrieve_context(context_query, k=3)
    
    # Format context
    context = client.format_context_for_prompt(context_results)
    
    # Inject context into prompt
    enhanced_prompt = client.inject_context_into_prompt(original_prompt, context)
    
    return enhanced_prompt

if __name__ == "__main__":
    main()
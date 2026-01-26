#!/usr/bin/env python3
"""
Sample script demonstrating how to integrate RAG with existing processors
"""

import sys
import os

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Import RAG client
from rag.client import create_rag_client, format_context_for_prompt, inject_context_into_prompt

# Import existing processor helpers
sys.path.append("../processors")
from _helpers import sendPromptToOllama

def enhance_prompt_with_rag(original_prompt, query_context=None):
    """
    Enhance a prompt with RAG context
    
    Args:
        original_prompt: The original prompt to enhance
        query_context: Optional context for querying the RAG system
        
    Returns:
        Enhanced prompt with RAG context
    """
    # Create RAG client
    client = create_rag_client("http://localhost:5000")
    
    # Check if service is healthy
    health = client.health_check()
    if not health.get("status") == "healthy":
        print("RAG service is not healthy, using original prompt")
        return original_prompt
    
    # Use provided context or derive from original prompt
    query = query_context if query_context else original_prompt
    
    # Retrieve relevant context
    context_results = client.retrieve_context(query, k=3)
    
    # Format context for prompt injection
    formatted_context = format_context_for_prompt(context_results)
    
    # Inject context into original prompt
    enhanced_prompt = inject_context_into_prompt(original_prompt, formatted_context)
    
    return enhanced_prompt

def process_with_rag_enhancement(processor_function, data, original_prompt):
    """
    Process data using a processor function with RAG-enhanced prompts
    
    Args:
        processor_function: Function that processes data with a prompt
        data: Data to process
        original_prompt: Original prompt for the processor
        
    Returns:
        Processing result
    """
    # Enhance the prompt with RAG context
    enhanced_prompt = enhance_prompt_with_rag(original_prompt)
    
    # Process with the enhanced prompt
    result = processor_function(data, enhanced_prompt)
    
    return result

def demo_beta_issues_integration():
    """Demo integration with beta issues processor"""
    print("=== Beta Issues Processor RAG Integration Demo ===")
    
    # Sample data (in a real scenario, this would come from Excel files)
    sample_data = {
        "issue_id": "BUG-12345",
        "description": "Application crashes when loading large datasets",
        "severity": "High",
        "model": "Samsung Galaxy S21"
    }
    
    # Original prompt (this would normally come from prompts/betaIssuesPrompt.js)
    original_prompt = f"""
    Analyze the following beta issue report:
    
    Issue ID: {sample_data['issue_id']}
    Description: {sample_data['description']}
    Severity: {sample_data['severity']}
    Affected Model: {sample_data['model']}
    
    Please provide:
    1. Root cause analysis
    2. Recommended fix approach
    3. Priority classification
    """
    
    # Enhance prompt with RAG
    enhanced_prompt = enhance_prompt_with_rag(
        original_prompt, 
        f"Samsung {sample_data['model']} {sample_data['description']}"
    )
    
    print("Original Prompt:")
    print(original_prompt)
    print("\n" + "="*50 + "\n")
    print("Enhanced Prompt with RAG Context:")
    print(enhanced_prompt)
    
    # In a real implementation, we would call the processor function here
    # For demo purposes, we'll simulate the result
    print("\n" + "="*50 + "\n")
    print("Processing with Ollama (simulated)...")
    
    # This is where we would normally call:
    # result = sendPromptToOllama(enhanced_prompt, "qwen3:4b-instruct")
    
    # Simulated result
    simulated_result = """
    Analysis Complete:
    
    1. Root Cause: Memory allocation issue when handling datasets larger than 50MB
    2. Fix Approach: Implement pagination for large dataset loading
    3. Priority: High - Affects user experience significantly
    
    Additional Context from Knowledge Base:
    - Similar issue reported in Galaxy S20 models
    - Previous fix involved increasing heap size temporarily
    """
    
    print(simulated_result)

def main():
    """Main demo function"""
    print("RAG Integration Demo")
    print("="*50)
    
    # Run beta issues integration demo
    demo_beta_issues_integration()

if __name__ == "__main__":
    main()
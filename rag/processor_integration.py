#!/usr/bin/env python3
"""
Integration module for RAG with existing processors
This module provides utilities to enhance existing processors with RAG capabilities.
"""

import logging
from typing import Dict, Any, List
from rag.client import create_rag_client

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class RAGEnhancedProcessor:
    """
    Wrapper class to enhance existing processors with RAG capabilities.
    """
    
    def __init__(self, processor_module: Any, rag_client=None):
        """
        Initialize the RAG-enhanced processor.
        
        Args:
            processor_module: Existing processor module to enhance
            rag_client: RAG client instance (will create default if None)
        """
        self.processor = processor_module
        self.rag_client = rag_client or create_rag_client()
        
    def enhance_prompt(self, original_prompt: str, context_query: str, k: int = 3) -> str:
        """
        Enhance a prompt with contextual information from RAG.
        
        Args:
            original_prompt: Original prompt to enhance
            context_query: Query to retrieve context for
            k: Number of context passages to retrieve
            
        Returns:
            Enhanced prompt with contextual information
        """
        # Check if RAG service is available
        health = self.rag_client.health_check()
        if health.get("status") != "healthy":
            logger.warning("RAG service is not healthy, using original prompt")
            return original_prompt
        
        # Retrieve context
        context_results = self.rag_client.retrieve_context(context_query, k=k)
        
        # Format context
        context = self.rag_client.format_context_for_prompt(context_results)
        
        # Inject context into prompt
        enhanced_prompt = self.rag_client.inject_context_into_prompt(original_prompt, context)
        
        return enhanced_prompt
    
    def process_with_rag_enhancement(self, data: Dict[str, Any], context_query: str = None) -> Dict[str, Any]:
        """
        Process data with RAG-enhanced prompts.
        
        Args:
            data: Input data for processing
            context_query: Query for retrieving context (uses data summary if None)
            
        Returns:
            Processed results with RAG enhancement
        """
        # Generate context query if not provided
        if context_query is None:
            context_query = self._generate_context_query(data)
        
        # Get original prompt from processor
        if hasattr(self.processor, 'get_prompt'):
            original_prompt = self.processor.get_prompt(data)
        else:
            # Fallback to a generic prompt generation
            original_prompt = self._generate_generic_prompt(data)
        
        # Enhance prompt with RAG
        enhanced_prompt = self.enhance_prompt(original_prompt, context_query)
        
        # Process with enhanced prompt
        if hasattr(self.processor, 'process_with_prompt'):
            result = self.processor.process_with_prompt(data, enhanced_prompt)
        else:
            # Fallback processing
            result = self._fallback_process(data, enhanced_prompt)
        
        # Add RAG context to results
        result['_rag_context_query'] = context_query
        result['_rag_enhanced_prompt'] = enhanced_prompt
        
        return result
    
    def _generate_context_query(self, data: Dict[str, Any]) -> str:
        """
        Generate a context query from data.
        
        Args:
            data: Input data
            
        Returns:
            Context query string
        """
        # Simple heuristic to generate query from data
        summary_parts = []
        
        # Add device model if present
        if 'device_model' in data:
            summary_parts.append(data['device_model'])
        elif 'model' in data:
            summary_parts.append(data['model'])
            
        # Add issue category if present
        if 'issue_category' in data:
            summary_parts.append(data['issue_category'])
        elif 'category' in data:
            summary_parts.append(data['category'])
            
        # Add error description if present
        if 'error_description' in data:
            summary_parts.append(data['error_description'])
        elif 'description' in data:
            summary_parts.append(data['description'])
            
        return " ".join(summary_parts) if summary_parts else "general device issues"
    
    def _generate_generic_prompt(self, data: Dict[str, Any]) -> str:
        """
        Generate a generic prompt from data.
        
        Args:
            data: Input data
            
        Returns:
            Generic prompt string
        """
        prompt = "Analyze the following issue:\n\n"
        for key, value in data.items():
            prompt += f"{key.title()}: {value}\n"
        prompt += "\nPlease provide analysis and recommendations."
        return prompt
    
    def _fallback_process(self, data: Dict[str, Any], prompt: str) -> Dict[str, Any]:
        """
        Fallback processing method.
        
        Args:
            data: Input data
            prompt: Enhanced prompt
            
        Returns:
            Processing results
        """
        # This is a placeholder for actual processing
        # In a real implementation, this would call the LLM with the prompt
        return {
            "input_data": data,
            "enhanced_prompt": prompt,
            "status": "processed_with_rag",
            "notes": "This is a placeholder result. In a full implementation, this would call an LLM with the enhanced prompt."
        }

def integrate_rag_with_processor(processor_module: Any) -> RAGEnhancedProcessor:
    """
    Factory function to create a RAG-enhanced processor.
    
    Args:
        processor_module: Existing processor module to enhance
        
    Returns:
        RAGEnhancedProcessor instance
    """
    return RAGEnhancedProcessor(processor_module)

# Example usage
if __name__ == "__main__":
    # This is a demonstration of how the integration would work
    # In practice, you would import an actual processor module
    
    # Mock processor module for demonstration
    class MockProcessor:
        def get_prompt(self, data):
            return f"Analyze issue: {data.get('issue_summary', 'General issue')}"
    
    # Create mock processor
    mock_processor = MockProcessor()
    
    # Integrate with RAG
    rag_processor = integrate_rag_with_processor(mock_processor)
    
    # Sample data
    sample_data = {
        "issue_summary": "Camera app crashes when taking photos",
        "device_model": "Samsung Galaxy S21",
        "software_version": "Android 12"
    }
    
    # Process with RAG enhancement
    print("Processing with RAG enhancement...")
    result = rag_processor.process_with_rag_enhancement(sample_data)
    
    print("Result:")
    for key, value in result.items():
        if key == '_rag_enhanced_prompt':
            print(f"{key}: [Prompt content too long to display]")
        else:
            print(f"{key}: {value}")
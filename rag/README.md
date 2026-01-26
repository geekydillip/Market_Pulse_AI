# RAG Module for Market Pulse AI

This module implements Retrieval-Augmented Generation (RAG) capabilities for the Market Pulse AI application. It enhances the existing Excel-processing workflow with contextual information retrieval from processed data.

## Architecture Overview

```
rag/
├── client.py              # Client interface for RAG service
├── service.py             # Core RAG service implementation
├── server.py              # Flask server for RAG service
├── initialize.py          # Data initialization script
├── start_rag_service.py   # Service startup script
├── integration_example.py # Example of RAG integration
├── processor_integration.py # Integration utilities for existing processors
├── requirements.txt       # Python dependencies
└── data/                 # Vector database storage
    └── faiss_index.bin   # FAISS vector index
```

## Components

### 1. RAG Service (`service.py`)
- Implements core RAG functionality
- Manages FAISS vector store
- Handles document ingestion and retrieval
- Uses sentence transformers for embedding generation

### 2. RAG Server (`server.py`)
- Flask-based REST API for RAG service
- Provides endpoints for health checks, document ingestion, and context retrieval
- Runs on port 5000 by default

### 3. RAG Client (`client.py`)
- Python client for interacting with RAG service
- Provides utilities for prompt enhancement
- Handles context formatting and injection

### 4. Initialization (`initialize.py`)
- Script to populate RAG service with existing Excel data
- Processes files from the downloads directory
- Extracts text content for indexing

### 5. Processor Integration (`processor_integration.py`)
- Utilities for integrating RAG with existing processors
- Provides wrapper classes for RAG-enhanced processing
- Maintains minimal changes to existing code

## Setup and Usage

### Installation
```bash
pip install -r rag/requirements.txt
```

### Starting the RAG Service
```bash
python -m rag.start_rag_service
```

This will:
1. Start the Flask server
2. Initialize the RAG service with existing data

### Integrating with Processors
To enhance existing processors with RAG capabilities:

```python
from rag.processor_integration import integrate_rag_with_processor
import processors.betaIssues as beta_issues_processor

# Create RAG-enhanced processor
rag_processor = integrate_rag_with_processor(beta_issues_processor)

# Process data with RAG enhancement
result = rag_processor.process_with_rag_enhancement(data)
```

### Direct Client Usage
```python
from rag.client import create_rag_client

# Create client
client = create_rag_client()

# Retrieve context
context = client.retrieve_context("Samsung Galaxy S21 camera issues")

# Enhance prompt
enhanced_prompt = client.inject_context_into_prompt(
    original_prompt, 
    client.format_context_for_prompt(context)
)
```

## Performance Optimizations

1. **Caching**: FAISS index is cached in memory after first load
2. **Chunking**: Documents are processed in optimal chunks for embedding
3. **Batch Processing**: Multiple documents can be added simultaneously
4. **Health Checks**: Service status monitoring for graceful degradation

## Offline Operation

All components work fully offline:
- Sentence transformers models are downloaded locally
- FAISS vector store operates without internet
- No external API dependencies

## Best Practices Implemented

1. **Minimal Changes**: Existing processors require no modification
2. **Graceful Degradation**: Falls back to original prompts if RAG unavailable
3. **Context Injection**: Enhances prompts without replacing logic
4. **Production Ready**: Logging, error handling, and health monitoring
5. **Clean Separation**: RAG module isolated from existing codebase
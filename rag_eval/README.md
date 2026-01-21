# RAG Evaluation Framework

This directory contains the evaluation framework for testing the RAG (Retrieval-Augmented Generation) system's performance on domain-specific queries.

## Files

- `gold_queries.json` - Domain-specific test queries with expected modules
- `evaluate_rag.js` - Evaluation script that tests RAG performance
- `evaluation_results.json` - Generated evaluation results (after running tests)

## Gold Queries

The evaluation uses 12 carefully selected queries covering common Samsung/Market Pulse issue categories:

- **Thermal & Performance**: Phone heating, battery drain
- **Network & Connectivity**: 5G issues, WiFi calling, airplane mode
- **Camera & Multimedia**: App crashes, video recording
- **System & Storage**: App installation, storage issues
- **Hardware**: Touch screen, GPS, NFC payments

Each query includes:
- `query`: The test question
- `expected_modules`: Array of modules that should be relevant
- `category`: Issue category for grouping

## Running Evaluation

### Prerequisites
1. Start the Market Pulse server: `node server/server.js`
2. Ensure Ollama is running with qwen3:4b-instruct model
3. Have discovery data processed and embedded

### Run Evaluation
```bash
cd rag_eval
node evaluate_rag.js
```

## Evaluation Metrics

The script evaluates three key aspects:

### 1. **Retrieval Relevance** (40% weight)
- Measures similarity scores of retrieved documents
- Considers sources with similarity > 0.7 as "relevant"
- Calculates weighted score based on average similarity and relevance ratio

### 2. **Module Prediction Accuracy** (30% weight)
- Checks if RAG responses mention expected module keywords
- Uses comprehensive keyword mapping for each module type
- Calculates accuracy based on detected vs expected modules

### 3. **Answer Quality** (30% weight)
- Evaluates response informativeness and appropriateness
- Checks for hallucination indicators
- Validates use of retrieved context
- Rewards appropriate "insufficient information" responses

## Expected Results

When the RAG system has been properly trained on discovery data, you should expect:

- **Success Rate**: >90% (queries complete without errors)
- **Retrieval Relevance**: >70% (relevant sources retrieved)
- **Module Prediction**: >60% (correct modules identified)
- **Answer Quality**: >75% (informative, non-hallucinating responses)

## Interpreting Results

### High Scores (80%+)
- RAG system working well
- Good retrieval and generation quality
- Ready for production use

### Medium Scores (50-80%)
- System functional but needs improvement
- Check if discovery data is comprehensive
- Review prompt engineering
- Consider fine-tuning embeddings

### Low Scores (<50%)
- System not properly configured
- Missing or insufficient training data
- Check server logs for errors
- Verify embeddings are created and stored

## Troubleshooting

### All Queries Fail
- Server not running: Start with `node server/server.js`
- Port mismatch: Ensure server runs on port 3001
- No discovery data: Process some Excel files first

### Low Retrieval Scores
- No embeddings: Check if discovery processing created embeddings
- Wrong embedding type: Ensure retriever filters for 'discovery' type
- Poor similarity: Consider different embedding models

### Poor Module Prediction
- Generic responses: Check prompt engineering
- Missing context: Ensure discovery data includes module information
- Hallucination: Review prompt safety constraints

## Extending Evaluation

### Adding New Queries
Edit `gold_queries.json` to add more test cases:
```json
{
  "query": "New test query",
  "expected_modules": ["Module1", "Module2"],
  "category": "new_category"
}
```

### Custom Metrics
Modify `evaluate_rag.js` to add custom evaluation criteria specific to your domain.

## Continuous Evaluation

Run this evaluation:
- After major RAG system changes
- When adding new discovery data
- Before deploying to production
- As part of CI/CD pipeline

This framework ensures your RAG system maintains high quality and relevance for Samsung/Market Pulse use cases.

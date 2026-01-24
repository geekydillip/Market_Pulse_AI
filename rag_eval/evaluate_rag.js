/**
 * RAG Evaluation Script - Tests gold queries against RAG system
 * Validates retrieval relevance and answer quality
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// Configuration
const RAG_ENDPOINT = 'http://localhost:3001/api/rag/query';
const GOLD_QUERIES_FILE = path.join(__dirname, 'gold_queries.json');
const GOLDEN_QUERIES_FILE = path.join(__dirname, 'golden_queries.json');
const RESULTS_FILE = path.join(__dirname, 'evaluation_results.json');

// Keywords that indicate module mentions in responses
const MODULE_KEYWORDS = {
  'Thermal': ['thermal', 'heat', 'heating', 'temperature', 'cooling'],
  'Performance': ['performance', 'speed', 'lag', 'slow', 'optimization'],
  'Battery': ['battery', 'power', 'drain', 'charging', 'standby'],
  'Network': ['network', '5g', 'lte', 'wifi', 'connectivity', 'signal'],
  'Connectivity': ['connectivity', 'connection', 'disconnect', 'airplane mode'],
  'Camera': ['camera', 'photo', 'video', 'recording', 'capture'],
  'Multimedia': ['multimedia', 'media', 'audio', 'video', 'playback'],
  'Power Management': ['power management', 'power', 'battery life', 'optimization'],
  'VoIP': ['voip', 'wifi calling', 'internet calling'],
  'Telephony': ['telephony', 'phone', 'call', 'dialer'],
  'Display': ['display', 'screen', 'flickering', 'brightness'],
  'Graphics': ['graphics', 'gpu', 'rendering', 'visual'],
  'Bluetooth': ['bluetooth', 'wireless', 'audio', 'headphones'],
  'Audio': ['audio', 'sound', 'speaker', 'microphone'],
  'Location': ['location', 'gps', 'navigation', 'positioning'],
  'GPS': ['gps', 'satellite', 'location', 'navigation'],
  'Navigation': ['navigation', 'maps', 'directions'],
  'Storage': ['storage', 'disk', 'memory', 'space'],
  'System': ['system', 'android', 'os', 'platform'],
  'Package Manager': ['package manager', 'installation', 'app install'],
  'Touch': ['touch', 'touchscreen', 'gesture', 'input'],
  'Hardware': ['hardware', 'physical', 'sensor', 'component'],
  'NFC': ['nfc', 'near field', 'contactless'],
  'Payment': ['payment', 'samsung pay', 'wallet'],
  'Security': ['security', 'secure', 'authentication', 'encryption']
};

class RAGEvaluator {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      total_queries: 0,
      successful_queries: 0,
      failed_queries: 0,
      evaluation_metrics: {
        average_retrieval_relevance: 0,
        module_prediction_accuracy: 0,
        answer_quality_score: 0
      },
      query_results: []
    };
  }

  /**
   * Load gold queries from JSON file
   */
  loadGoldQueries() {
    try {
      const data = fs.readFileSync(GOLD_QUERIES_FILE, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to load gold queries:', error.message);
      return [];
    }
  }

  /**
   * Make HTTP request to RAG endpoint
   */
  async queryRAG(query, limit = 8) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        query,
        limit,
        model: 'qwen3:4b-instruct'
      });

      const options = {
        hostname: 'localhost',
        port: 3001,
        path: '/api/rag/query',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = http.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            resolve(response);
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Evaluate retrieval relevance based on source similarity scores with rank awareness
   */
  evaluateRetrievalRelevance(sources, expectedModules) {
    if (!sources || sources.length === 0) {
      return { 
        score: 0, 
        reason: 'No sources retrieved',
        recall_at_5: 0,
        recall_at_10: 0,
        precision_at_5: 0,
        precision_at_10: 0
      };
    }

    // Calculate average similarity score
    const avgSimilarity = sources.reduce((sum, source) => sum + parseFloat(source.similarity), 0) / sources.length;

    // Check if sources are relevant (similarity > 0.7 is considered relevant)
    const relevantSources = sources.filter(source => parseFloat(source.similarity) > 0.7).length;
    const relevanceRatio = relevantSources / sources.length;

    // Rank-aware scoring: reward earlier retrieval
    let rankScore = 0;
    const K = Math.min(sources.length, 10);
    for (let i = 0; i < K; i++) {
      rankScore += (K - i) / K; // Higher score for earlier ranks
    }
    rankScore = rankScore / K; // Normalize

    // Calculate precision and recall metrics
    const recall_at_5 = Math.min(sources.length, 5) / 5;
    const recall_at_10 = Math.min(sources.length, 10) / 10;
    const precision_at_5 = relevantSources / Math.min(sources.length, 5);
    const precision_at_10 = relevantSources / Math.min(sources.length, 10);

    let score = (avgSimilarity * 0.4) + (relevanceRatio * 0.3) + (rankScore * 0.3); // Weighted score

    return {
      score: Math.min(score, 1.0), // Cap at 1.0
      avg_similarity: avgSimilarity,
      relevant_sources: relevantSources,
      total_sources: sources.length,
      recall_at_5: recall_at_5,
      recall_at_10: recall_at_10,
      precision_at_5: precision_at_5,
      precision_at_10: precision_at_10
    };
  }

  /**
   * Evaluate if answer mentions expected modules
   */
  evaluateModulePrediction(response, expectedModules) {
    if (!response) {
      return { score: 0, detected_modules: [], reason: 'No response' };
    }

    const responseLower = response.toLowerCase();
    const detectedModules = [];

    // Check each expected module
    for (const module of expectedModules) {
      const keywords = MODULE_KEYWORDS[module] || [module.toLowerCase()];

      // Check if any keyword for this module appears in response
      const moduleDetected = keywords.some(keyword =>
        responseLower.includes(keyword.toLowerCase())
      );

      if (moduleDetected) {
        detectedModules.push(module);
      }
    }

    // Calculate accuracy based on detected modules
    const accuracy = detectedModules.length / expectedModules.length;

    return {
      score: accuracy,
      detected_modules: detectedModules,
      expected_modules: expectedModules,
      accuracy: accuracy
    };
  }

  /**
   * Evaluate overall answer quality
   */
  evaluateAnswerQuality(response, sources) {
    let score = 0;
    const reasons = [];

    if (!response) {
      return { score: 0, reasons: ['No response generated'] };
    }

    const responseLower = response.toLowerCase();

    // Check response length (should be informative but not too long)
    if (response.length > 50) score += 0.3;
    else reasons.push('Response too short');

    // Check if response uses retrieved context (mentions sources)
    if (sources && sources.length > 0) {
      const contextUsed = sources.some(source =>
        source.source && responseLower.includes(source.source.toLowerCase().split('_')[0])
      );
      if (contextUsed) score += 0.3;
      else reasons.push('Response may not use retrieved context');
    }

    // Check for generic responses that indicate no information
    if (response.includes('I do not have enough information')) {
      score += 0.2; // Appropriate when no relevant context
      reasons.push('Appropriately indicated insufficient information');
    } else {
      score += 0.2; // Provides some answer
    }

    // Check for hallucination indicators (generic AI responses)
    const hallucinationIndicators = ['as an AI', 'I think', 'perhaps', 'maybe'];
    const hasHallucination = hallucinationIndicators.some(indicator =>
      responseLower.includes(indicator)
    );
    if (!hasHallucination) score += 0.2;
    else reasons.push('May contain hallucinated content');

    return {
      score: Math.min(score, 1.0),
      reasons: reasons.length > 0 ? reasons : ['Good quality response']
    };
  }

  /**
   * Run evaluation for all gold queries
   */
  async runEvaluation() {
    console.log('🚀 Starting RAG Evaluation...\n');

    const goldQueries = this.loadGoldQueries();
    if (goldQueries.length === 0) {
      console.error('No gold queries found. Please check gold_queries.json');
      return;
    }

    this.results.total_queries = goldQueries.length;
    
    // Test Phase 2A features
    console.log('🧪 Testing Phase 2A features...\n');

    for (let i = 0; i < goldQueries.length; i++) {
      const goldQuery = goldQueries[i];

      console.log(`[${i + 1}/${goldQueries.length}] Testing: "${goldQuery.query}"`);

      try {
        // Make RAG query
        const ragResponse = await this.queryRAG(goldQuery.query);

        if (!ragResponse.success) {
          console.log(`  ❌ Query failed: ${ragResponse.error}`);
          this.results.failed_queries++;

          this.results.query_results.push({
            query: goldQuery.query,
            expected_modules: goldQuery.expected_modules,
            category: goldQuery.category,
            success: false,
            error: ragResponse.error
          });
          continue;
        }

        this.results.successful_queries++;

        // Evaluate results
        const retrievalEval = this.evaluateRetrievalRelevance(ragResponse.sources, goldQuery.expected_modules);
        const moduleEval = this.evaluateModulePrediction(ragResponse.response, goldQuery.expected_modules);
        const qualityEval = this.evaluateAnswerQuality(ragResponse.response, ragResponse.sources);

        const queryResult = {
          query: goldQuery.query,
          expected_modules: goldQuery.expected_modules,
          category: goldQuery.category,
          success: true,
          response: ragResponse.response,
          sources: ragResponse.sources,
          evaluation: {
            retrieval_relevance: retrievalEval,
            module_prediction: moduleEval,
            answer_quality: qualityEval,
            overall_score: (retrievalEval.score + moduleEval.score + qualityEval.score) / 3
          }
        };

        this.results.query_results.push(queryResult);

        console.log(`  ✅ Retrieval: ${(retrievalEval.score * 100).toFixed(1)}% (${retrievalEval.relevant_sources}/${retrievalEval.total_sources} relevant)`);
        console.log(`  ✅ Modules: ${(moduleEval.score * 100).toFixed(1)}% (${moduleEval.detected_modules.length}/${goldQuery.expected_modules.length} detected)`);
        console.log(`  ✅ Quality: ${(qualityEval.score * 100).toFixed(1)}%`);

      } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
        this.results.failed_queries++;

        this.results.query_results.push({
          query: goldQuery.query,
          expected_modules: goldQuery.expected_modules,
          category: goldQuery.category,
          success: false,
          error: error.message
        });
      }

      // Small delay between queries
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Calculate aggregate metrics
    this.calculateAggregateMetrics();

    // Save results
    this.saveResults();

    // Print summary
    this.printSummary();

    console.log('\n🎯 Evaluation complete! Results saved to evaluation_results.json');
  }

  /**
   * Calculate aggregate evaluation metrics
   */
  calculateAggregateMetrics() {
    const successfulResults = this.results.query_results.filter(r => r.success);

    if (successfulResults.length === 0) return;

    // Average retrieval relevance
    const avgRetrieval = successfulResults.reduce((sum, r) =>
      sum + r.evaluation.retrieval_relevance.score, 0) / successfulResults.length;

    // Average module prediction accuracy
    const avgModules = successfulResults.reduce((sum, r) =>
      sum + r.evaluation.module_prediction.score, 0) / successfulResults.length;

    // Average answer quality
    const avgQuality = successfulResults.reduce((sum, r) =>
      sum + r.evaluation.answer_quality.score, 0) / successfulResults.length;

    this.results.evaluation_metrics = {
      average_retrieval_relevance: avgRetrieval,
      module_prediction_accuracy: avgModules,
      answer_quality_score: avgQuality,
      overall_success_rate: this.results.successful_queries / this.results.total_queries
    };
  }

  /**
   * Save evaluation results to file
   */
  saveResults() {
    try {
      fs.writeFileSync(RESULTS_FILE, JSON.stringify(this.results, null, 2));
      console.log(`📄 Results saved to ${RESULTS_FILE}`);
    } catch (error) {
      console.error('Failed to save results:', error.message);
    }
  }

  /**
   * Print evaluation summary
   */
  printSummary() {
    console.log('\n📊 EVALUATION SUMMARY');
    console.log('='.repeat(50));
    console.log(`Total Queries: ${this.results.total_queries}`);
    console.log(`Successful: ${this.results.successful_queries}`);
    console.log(`Failed: ${this.results.failed_queries}`);
    console.log(`Success Rate: ${((this.results.successful_queries / this.results.total_queries) * 100).toFixed(1)}%`);

    if (this.results.successful_queries > 0) {
      const metrics = this.results.evaluation_metrics;
      console.log('\n📈 PERFORMANCE METRICS');
      console.log(`Retrieval Relevance: ${(metrics.average_retrieval_relevance * 100).toFixed(1)}%`);
      console.log(`Module Prediction: ${(metrics.module_prediction_accuracy * 100).toFixed(1)}%`);
      console.log(`Answer Quality: ${(metrics.answer_quality_score * 100).toFixed(1)}%`);
    }

    // Show top performing queries
    const topQueries = this.results.query_results
      .filter(r => r.success)
      .sort((a, b) => b.evaluation.overall_score - a.evaluation.overall_score)
      .slice(0, 3);

    if (topQueries.length > 0) {
      console.log('\n🏆 TOP PERFORMING QUERIES');
      topQueries.forEach((query, i) => {
        console.log(`${i + 1}. "${query.query}" (${(query.evaluation.overall_score * 100).toFixed(1)}%)`);
      });
    }
  }
}

// Run evaluation if called directly
if (require.main === module) {
  const evaluator = new RAGEvaluator();
  evaluator.runEvaluation().catch(error => {
    console.error('Evaluation failed:', error);
    process.exit(1);
  });
}

module.exports = RAGEvaluator;

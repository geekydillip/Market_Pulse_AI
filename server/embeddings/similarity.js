/**
 * Similarity Threshold Configuration
 * Centralized governance for all similarity-based decisions
 * Prevents threshold drift and ensures consistency across Phase 1 & 2
 */

const SIMILARITY_THRESHOLDS = {
  // Row-level deduplication (highest precision - avoid processing duplicates)
  REUSE_ROW: 0.95,        // Skip LLM processing if row embedding ≥95% similar to existing
  ROW_CLUSTER: 0.90,      // Group rows into clusters for analysis

  // Label-level operations (medium precision - semantic grouping)
  CLUSTER_LABEL: 0.85,    // Group similar discovered labels for taxonomy candidates
  MERGE_LABEL: 0.80,      // Auto-merge labels in restricted mode

  // Review thresholds (lower precision - human oversight needed)
  REVIEW_REQUIRED: 0.75,  // Flag potential merges for human review
  SEMANTIC_RELATED: 0.60, // Show related items in search results

  // Performance tuning
  CACHE_SIMILARITY: 0.98, // Consider embeddings identical for caching
  PREFETCH_THRESHOLD: 0.70 // Preload similar items if above threshold
};

const PROCESSING_MODES = {
  DISCOVERY: 'discovery',     // Organic label discovery, no restrictions
  RESTRICTED: 'restricted',   // Use canonical taxonomy, enforce rules
  HYBRID: 'hybrid'           // Mix of discovery + restrictions (future)
};

const EMBEDDING_TYPES = {
  ROW: 'row',                    // Full row text embedding
  MODULE: 'module',              // Discovered module labels
  SUB_MODULE: 'sub_module',      // Discovered sub-module labels
  ISSUE_TYPE: 'issue_type',      // Discovered issue type labels
  SUB_ISSUE_TYPE: 'sub_issue_type' // Discovered sub-issue type labels
};

const PROCESSING_MODE = process.env.PROCESSING_MODE || PROCESSING_MODES.DISCOVERY;

// Validate processing mode
if (!Object.values(PROCESSING_MODES).includes(PROCESSING_MODE)) {
  console.error(`❌ Invalid PROCESSING_MODE: ${PROCESSING_MODE}`);
  console.error(`Valid modes: ${Object.values(PROCESSING_MODES).join(', ')}`);
  process.exit(1);
}

console.log(`🔧 Processing Mode: ${PROCESSING_MODE}`);

// Phase-specific threshold adjustments
const getThresholdsForMode = (mode) => {
  const baseThresholds = { ...SIMILARITY_THRESHOLDS };

  switch (mode) {
    case PROCESSING_MODES.DISCOVERY:
      // Discovery mode: More permissive, focus on collection
      return {
        ...baseThresholds,
        REUSE_ROW: 0.97,        // Stricter deduplication to maximize diversity
        CLUSTER_LABEL: 0.80,    // More aggressive clustering for patterns
        MERGE_LABEL: 0.90       // Conservative merging to preserve signals
      };

    case PROCESSING_MODES.RESTRICTED:
      // Restricted mode: Stricter, focus on consistency
      return {
        ...baseThresholds,
        REUSE_ROW: 0.93,        // More lenient deduplication for canonical processing
        CLUSTER_LABEL: 0.90,    // Tighter clustering for taxonomy enforcement
        MERGE_LABEL: 0.75       // More aggressive merging for normalization
      };

    default:
      return baseThresholds;
  }
};

const ACTIVE_THRESHOLDS = getThresholdsForMode(PROCESSING_MODE);

module.exports = {
  SIMILARITY_THRESHOLDS: ACTIVE_THRESHOLDS,
  PROCESSING_MODES,
  EMBEDDING_TYPES,
  PROCESSING_MODE,

  // Utility functions
  isDiscoveryMode: () => PROCESSING_MODE === PROCESSING_MODES.DISCOVERY,
  isRestrictedMode: () => PROCESSING_MODE === PROCESSING_MODES.RESTRICTED,
  isHybridMode: () => PROCESSING_MODE === PROCESSING_MODES.HYBRID,

  // Threshold validation
  validateThreshold: (operation, value) => {
    const threshold = ACTIVE_THRESHOLDS[operation];
    if (threshold === undefined) {
      throw new Error(`Unknown threshold operation: ${operation}`);
    }
    return value >= threshold;
  },

  // Get threshold for operation
  getThreshold: (operation) => {
    const threshold = ACTIVE_THRESHOLDS[operation];
    if (threshold === undefined) {
      throw new Error(`Unknown threshold operation: ${operation}`);
    }
    return threshold;
  }
};

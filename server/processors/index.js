/**
 * Processor Registry
 * Centralized registry for all available processors
 */

// Import all available processors
const betaIssues = require('./betaIssues');
const samsungMembersPlm = require('./samsungMembersPlm');
const plmIssues = require('./plmIssues');
const samsungMembersVoc = require('./samsungMembersVoc');
const utPortal = require('./utPortal');

/**
 * Processor registry mapping
 * Maps processing types to their respective processor implementations
 */
const processors = {
  beta_user_issues: betaIssues,
  samsung_members_plm: samsungMembersPlm,
  plm_issues: plmIssues,
  samsung_members_voc: samsungMembersVoc,
  ut_portal: utPortal
};

/**
 * Get processor by processing type
 * @param {string} processingType - Type of processing
 * @returns {Object|null} Processor implementation or null if not found
 */
function getProcessor(processingType) {
  return processors[processingType] || null;
}

/**
 * Get processor transform function by processing type
 * @param {string} processingType - Type of processing
 * @returns {Function|null} Transform function or null if not found
 */
function getProcessorTransform(processingType) {
  const processor = processors[processingType];
  if (processor && typeof processor.transform === 'function') {
    return processor.transform;
  }
  return null;
}

/**
 * Get processor buildPrompt function by processing type
 * @param {string} processingType - Type of processing
 * @returns {Function|null} BuildPrompt function or null if not found
 */
function getProcessorBuildPrompt(processingType) {
  const processor = processors[processingType];
  if (processor && typeof processor.buildPrompt === 'function') {
    return processor.buildPrompt;
  }
  return null;
}

/**
 * Get processor formatResponse function by processing type
 * @param {string} processingType - Type of processing
 * @returns {Function|null} FormatResponse function or null if not found
 */
function getProcessorFormatResponse(processingType) {
  const processor = processors[processingType];
  if (processor && typeof processor.formatResponse === 'function') {
    return processor.formatResponse;
  }
  return null;
}

/**
 * Check if processor exists
 * @param {string} processingType - Type of processing
 * @returns {boolean} True if processor exists, false otherwise
 */
function hasProcessor(processingType) {
  return processors.hasOwnProperty(processingType);
}

/**
 * Get all available processor types
 * @returns {Array} Array of available processor types
 */
function getAvailableProcessorTypes() {
  return Object.keys(processors);
}

module.exports = {
  getProcessor,
  hasProcessor,
  getAvailableProcessorTypes,
  processors // Export raw processors for direct access if needed
};
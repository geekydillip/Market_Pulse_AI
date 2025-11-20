const promptTemplate = require('../prompts/betaIssuesPrompt');

module.exports = {
  id: 'betaIssues',
  expectedHeaders: ['Case Code', 'Occurr. Stg.', 'Title', 'Problem', 'Model No.', 'S/W Ver.', 'Module', 'Sub-Module', 'Summarized Problem', 'Severity', 'Severity Reason'],

  validateHeaders(rawHeaders) {
    // Check if required fields are present
    const required = ['Title', 'Problem'];
    return required.some(header =>
      rawHeaders.includes(header) ||
      rawHeaders.some(h => h.toLowerCase().trim() === header.toLowerCase().trim())
    );
  },

  transform(rows) {
    // Use the existing normalizeHeaders function from server.js
    // For now, pass through - the server will call normalizeHeaders
    return rows;
  },

  buildPrompt(rows) {
    return promptTemplate.replace('{INPUTDATA_JSON}', JSON.stringify(rows, null, 2));
  },

  formatResponse(aiResult) {
    const text = aiResult.trim();
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      const jsonStr = text.substring(firstBracket, lastBracket + 1);
      return JSON.parse(jsonStr);
    }
    throw new Error('No valid JSON array found in response');
  }
};

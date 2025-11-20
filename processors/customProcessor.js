const promptTemplate = require('../prompts/customProcessorPrompt');

module.exports = {
  id: 'customProcessor',
  expectedHeaders: ['Case Code', 'Occurr. Stg.', 'Title', 'Problem', 'Model No.', 'S/W Ver.', 'Module', 'Sub-Module', 'Summarized Problem', 'Severity', 'Severity Reason'],

  validateHeaders(rawHeaders) {
    const required = ['Title', 'Problem'];
    return required.some(header =>
      rawHeaders.includes(header) ||
      rawHeaders.some(h => h.toLowerCase().trim() === header.toLowerCase().trim())
    );
  },

  transform(rows) {
    return rows;
  },

  buildPrompt(rows, customPrompt = '') {
    let prompt = promptTemplate.replace('{CUSTOM_PROMPT}', customPrompt || 'Process this data');
    return prompt.replace('{INPUTDATA_JSON}', JSON.stringify(rows, null, 2));
  },

  formatResponse(aiResult) {
    const text = aiResult.trim();
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      const jsonStr = text.substring(firstBracket, lastBracket + 1);
      return JSON.parse(jsonStr);
    }
    // For custom processing, sometimes it might return different format
    // Fallback to returning as is if no JSON array
    return aiResult;
  }
};

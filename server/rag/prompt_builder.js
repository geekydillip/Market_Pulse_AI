/**
 * Prompt Builder - Context + prompt assembly for RAG
 */

class PromptBuilder {
  constructor() {
    this.templates = {
      default: `
You are an expert analyst.
You MUST answer strictly using the CONTEXT below.

CONTEXT:
{context}

QUESTION:
{query}

RULES:
- If the answer is not present in the context, say: "I do not have enough information to answer this."
- Do NOT add external knowledge or assumptions.
- Be concise and factual.
- Only use information explicitly stated in the context.
`,

      technical: `
You are a technical documentation expert.
You MUST answer strictly using the TECHNICAL CONTEXT below.

TECHNICAL CONTEXT:
{context}

QUERY:
{query}

RULES:
- If the technical information is not in the context, say: "I do not have enough technical information to answer this."
- Do NOT use external technical knowledge.
- Be precise and cite specific details from the context.
- Do not make assumptions about technologies not mentioned.
`,

      issue_analysis: `
You are an issue analysis expert.
You MUST analyze strictly using the ISSUE DATA below.

ISSUE DATA:
{context}

QUESTION:
{query}

RULES:
- If the issue data does not contain the answer, say: "I do not have enough issue data to answer this."
- Do NOT add external knowledge about issues or solutions.
- Base all analysis on the provided issue data only.
- Be factual and data-driven.
`
    };
  }

  /**
   * Build a prompt with context for RAG
   * @param {string} query - The user's query
   * @param {Array} contextDocs - Array of retrieved documents
   * @param {string} additionalContext - Additional context to include
   * @param {string} template - Template to use ('default', 'technical', 'issue_analysis')
   * @returns {string} Formatted prompt
   */
  async buildPrompt(query, contextDocs, additionalContext = '', template = 'default') {
    try {
      if (!Array.isArray(contextDocs)) {
        throw new Error('Context documents must be an array');
      }

      // Format context from retrieved documents
      const contextText = this.formatContext(contextDocs);

      // Select template
      const promptTemplate = this.templates[template] || this.templates.default;

      // Build the prompt
      let prompt = promptTemplate
        .replace('{query}', query)
        .replace('{context}', contextText);

      // Add additional context if provided
      if (additionalContext && additionalContext.trim()) {
        prompt = prompt.replace('{context}', `${additionalContext}\n\n${contextText}`);
      }

      return prompt;

    } catch (error) {
      console.error('[PromptBuilder Error]:', error);
      throw new Error(`Prompt building failed: ${error.message}`);
    }
  }

  /**
   * Format retrieved documents into context text with source grouping
   * @param {Array} docs - Array of retrieved documents
   * @returns {string} Formatted context
   */
  formatContext(docs) {
    if (!docs || docs.length === 0) {
      return 'No context available.';
    }

    // Group documents by source for better LLM comprehension
    const groupedDocs = this.groupDocsBySource(docs);

    const contextParts = [];

    // Format each source group
    Object.entries(groupedDocs).forEach(([source, sourceDocs], groupIndex) => {
      const sourceHeader = `📁 Source: ${source} (${sourceDocs.length} chunks)`;
      contextParts.push(sourceHeader);

      sourceDocs.forEach((doc, docIndex) => {
        const header = this.formatDocumentHeader(doc, docIndex + 1);
        const content = this.formatDocumentContent(doc);
        contextParts.push(`${header}\n${content}`);
      });

      // Add separator between source groups
      if (groupIndex < Object.keys(groupedDocs).length - 1) {
        contextParts.push('---');
      }
    });

    return contextParts.join('\n\n');
  }

  /**
   * Group documents by source for better context organization
   * @param {Array} docs - Array of retrieved documents
   * @returns {Object} Documents grouped by source
   */
  groupDocsBySource(docs) {
    const grouped = {};

    docs.forEach(doc => {
      const source = doc.source || 'unknown';
      if (!grouped[source]) {
        grouped[source] = [];
      }
      grouped[source].push(doc);
    });

    return grouped;
  }

  /**
   * Format document header with metadata
   * @param {Object} doc - Document object
   * @param {number} index - Document index
   * @returns {string} Formatted header
   */
  formatDocumentHeader(doc, index) {
    const parts = [`Document ${index}`];

    if (doc.type) {
      parts.push(`Type: ${doc.type}`);
    }

    if (doc.source) {
      parts.push(`Source: ${doc.source}`);
    }

    if (doc.similarity) {
      parts.push(`Similarity: ${(doc.similarity * 100).toFixed(1)}%`);
    }

    return `[${parts.join(' | ')}]`;
  }

  /**
   * Format document content
   * @param {Object} doc - Document object
   * @returns {string} Formatted content
   */
  formatDocumentContent(doc) {
    let content = doc.text || '';

    // Add metadata if available
    if (doc.metadata) {
      try {
        const metadata = typeof doc.metadata === 'string'
          ? JSON.parse(doc.metadata)
          : doc.metadata;

        const metaParts = [];
        if (metadata.mode) metaParts.push(`Mode: ${metadata.mode}`);
        if (metadata.processor) metaParts.push(`Processor: ${metadata.processor}`);

        if (metaParts.length > 0) {
          content += `\n\nMetadata: ${metaParts.join(', ')}`;
        }
      } catch (e) {
        // Ignore metadata parsing errors
      }
    }

    return content;
  }

  /**
   * Add a custom template
   * @param {string} name - Template name
   * @param {string} template - Template string with {query} and {context} placeholders
   */
  addTemplate(name, template) {
    if (!name || !template) {
      throw new Error('Template name and content are required');
    }

    if (!template.includes('{query}') || !template.includes('{context}')) {
      throw new Error('Template must include {query} and {context} placeholders');
    }

    this.templates[name] = template;
  }

  /**
   * Get available templates
   * @returns {Array} List of template names
   */
  getAvailableTemplates() {
    return Object.keys(this.templates);
  }

  /**
   * Build prompt for conversational context (follow-up questions)
   * @param {string} query - Current query
   * @param {Array} contextDocs - Retrieved documents
   * @param {Array} conversationHistory - Previous conversation turns
   * @returns {string} Formatted conversational prompt
   */
  async buildConversationalPrompt(query, contextDocs, conversationHistory = []) {
    const contextText = this.formatContext(contextDocs);

    let historyText = '';
    if (conversationHistory.length > 0) {
      historyText = '\n\nConversation History:\n' +
        conversationHistory.map(turn =>
          `Q: ${turn.query}\nA: ${turn.response}`
        ).join('\n\n');
    }

    const prompt = `
You are a helpful AI assistant with access to relevant context and conversation history.

${historyText}

Current Context:
${contextText}

Current Question: ${query}

Please provide a helpful and accurate answer based on the context and conversation history. Maintain continuity with previous responses when appropriate.
`;

    return prompt;
  }
}

module.exports = PromptBuilder;

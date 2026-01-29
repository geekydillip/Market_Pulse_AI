/**
 * Generator - Ollama call wrapper for RAG
 */

const http = require('http');

class Generator {
  constructor() {
    this.keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
    this.defaultPort = 11434;
    this.defaultModel = 'qwen3:4b-instruct';
  }

  /**
   * Generate response using Ollama
   * @param {string} prompt - The prompt to send to Ollama
   * @param {string} model - Model to use (default: qwen3:4b-instruct)
   * @param {Object} options - Additional options
   * @returns {string} Generated response
   */
  async generate(prompt, model = this.defaultModel, options = {}) {
    try {
      const port = options.port || this.defaultPort;
      const timeoutMs = options.timeoutMs !== undefined ? options.timeoutMs : false; // Infinite timeout by default
      const useStream = options.stream === true;

      console.log(`[Generator] Generating response with model: ${model}, port: ${port}, stream: ${useStream}`);

      const payload = {
        model,
        prompt,
        stream: useStream
      };

      const data = JSON.stringify(payload);

      const response = await this.callOllama(data, port, timeoutMs, useStream);

      return response;

    } catch (error) {
      console.error('[Generator generateResponse Error]:', error);
      throw new Error(`Generation failed: ${error.message}`);
    }
  }

  /**
   * Make HTTP call to Ollama
   * @param {string} data - JSON payload
   * @param {number} port - Ollama port
   * @param {number} timeoutMs - Timeout in milliseconds
   * @param {boolean} useStream - Whether to use streaming
   * @returns {string} Response from Ollama
   */
  callOllama(data, port, timeoutMs, useStream) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
        port,
        path: '/api/generate',
        method: 'POST',
        agent: this.keepAliveAgent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'Connection': 'keep-alive'
        }
      };

      const req = http.request(options, (res) => {
        res.setEncoding('utf8');

        if (!useStream) {
          // Non-streaming response
          let raw = '';
          res.on('data', (chunk) => raw += chunk);
          res.on('end', () => {
            if (!raw) return reject(new Error(`Empty response from Ollama (status ${res.statusCode})`));
            try {
              const json = JSON.parse(raw);
              if (res.statusCode >= 200 && res.statusCode < 300 && json.response) {
                resolve(json.response);
              } else {
                reject(new Error(`Ollama generation failed: ${JSON.stringify(json)}`));
              }
            } catch (err) {
              reject(new Error('Failed to parse Ollama response: ' + err.message));
            }
          });
        } else {
          // Streaming response - safer handling for partial chunks
          let body = '';
          res.on('data', (chunk) => {
            body += chunk.toString();
          });

          res.on('end', () => {
            try {
              // Try to parse as JSON first
              const parsed = JSON.parse(body);
              resolve(parsed.response || parsed.message || parsed.output || body);
            } catch {
              // If JSON parsing fails, return the raw body
              resolve(body);
            }
          });
        }
      });

      if (timeoutMs !== false && timeoutMs !== 0) {
        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error(`Generation timeout after ${timeoutMs} ms`));
        });
      }

      req.on('error', (err) => {
        reject(new Error('Failed to connect to Ollama: ' + err.message));
      });

      req.write(data);
      req.end();
    });
  }

  /**
   * Generate with conversation history
   * @param {string} prompt - Current prompt
   * @param {Array} history - Array of previous {role, content} objects
   * @param {string} model - Model to use
   * @param {Object} options - Additional options
   * @returns {string} Generated response
   */
  async generateWithHistory(prompt, history = [], model = this.defaultModel, options = {}) {
    try {
      // Build conversation context
      const messages = [];

      // Add history
      history.forEach(item => {
        if (item.role === 'user') {
          messages.push({ role: 'user', content: item.content });
        } else if (item.role === 'assistant') {
          messages.push({ role: 'assistant', content: item.content });
        }
      });

      // Add current prompt as user message
      messages.push({ role: 'user', content: prompt });

      const port = options.port || this.defaultPort;
      const timeoutMs = options.timeoutMs !== undefined ? options.timeoutMs : 5 * 60 * 1000;

      const payload = {
        model,
        messages,
        stream: false
      };

      const data = JSON.stringify(payload);
      const response = await this.callOllama(data, port, timeoutMs, false);

      return response;

    } catch (error) {
      console.error('[Generator generateWithHistory Error]:', error);
      throw new Error(`Generation with history failed: ${error.message}`);
    }
  }

  /**
   * Test Ollama connection
   * @param {number} port - Port to test
   * @returns {boolean} True if connected
   */
  async testConnection(port = this.defaultPort) {
    try {
      const response = await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/api/tags`, (res) => {
          resolve(res.statusCode === 200);
        });

        req.on('error', () => resolve(false));
        req.setTimeout(5000, () => {
          req.destroy();
          resolve(false);
        });
      });

      return response;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get available models from Ollama
   * @param {number} port - Ollama port
   * @returns {Array} List of available models
   */
  async getAvailableModels(port = this.defaultPort) {
    try {
      const response = await new Promise((resolve, reject) => {
        const options = {
          hostname: '127.0.0.1',
          port,
          path: '/api/tags',
          method: 'GET',
          agent: this.keepAliveAgent,
          headers: {
            'Connection': 'keep-alive'
          }
        };

        const req = http.request(options, (res) => {
          let raw = '';
          res.setEncoding('utf8');

          res.on('data', (chunk) => raw += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(raw);
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve(json);
              } else {
                reject(new Error(`Ollama tags failed: ${JSON.stringify(json)}`));
              }
            } catch (err) {
              reject(new Error('Failed to parse Ollama tags response'));
            }
          });
        });

        req.on('error', (err) => {
          reject(new Error('Failed to connect to Ollama for models'));
        });

        req.setTimeout(10000, () => {
          req.destroy(new Error('Timeout getting models'));
        });

        req.end();
      });

      return response.models ? response.models.map(m => m.name) : [];
    } catch (error) {
      console.error('[Generator getAvailableModels Error]:', error);
      return [];
    }
  }

  /**
   * Cleanup HTTP agent to prevent memory leaks
   */
  cleanup() {
    if (this.keepAliveAgent) {
      this.keepAliveAgent.destroy();
      console.log('[Generator] HTTP agent destroyed');
    }
  }

  /**
   * Generate embeddings using Ollama
   * @param {string} text - Text to embed
   * @param {string} model - Embedding model (default: nomic-embed-text)
   * @param {Object} options - Additional options
   * @returns {Array} Embedding vector
   */
  async generateEmbedding(text, model = 'nomic-embed-text', options = {}) {
    try {
      const port = options.port || this.defaultPort;
      const timeoutMs = options.timeoutMs !== undefined ? options.timeoutMs : 30 * 1000; // 30s for embeddings

      const payload = { model, prompt: text };
      const data = JSON.stringify(payload);

      return new Promise((resolve, reject) => {
        const options_req = {
          hostname: '127.0.0.1',
          port,
          path: '/api/embeddings',
          method: 'POST',
          agent: this.keepAliveAgent,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            'Connection': 'keep-alive'
          }
        };

        const req = http.request(options_req, (res) => {
          res.setEncoding('utf8');

          let raw = '';
          res.on('data', (chunk) => raw += chunk);
          res.on('end', () => {
            if (!raw) return reject(new Error(`Empty response from Ollama embeddings (status ${res.statusCode})`));
            try {
              const json = JSON.parse(raw);
              if (res.statusCode >= 200 && res.statusCode < 300 && json.embedding) {
                resolve(json.embedding);
              } else {
                reject(new Error(`Ollama embeddings failed: ${JSON.stringify(json)}`));
              }
            } catch (err) {
              reject(new Error('Failed to parse Ollama embeddings response'));
            }
          });
        });

        if (timeoutMs !== false && timeoutMs !== 0) {
          req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`Embedding timeout after ${timeoutMs} ms`));
          });
        }

        req.on('error', (err) => {
          reject(new Error('Failed to connect to Ollama for embeddings'));
        });

        req.write(data);
        req.end();
      });

    } catch (error) {
      console.error('[Generator generateEmbedding Error]:', error);
      throw new Error(`Embedding generation failed: ${error.message}`);
    }
  }
}

module.exports = Generator;

const { spawn } = require('child_process');
const path = require('path');

/**
 * RAG Service Manager for Node.js
 * Manages the Python RAG service lifecycle
 */
class RAGServiceManager {
  constructor() {
    this.process = null;
    this.isRunning = false;
    this.port = 5000;
  }

  /**
   * Start the RAG service
   */
  async start() {
    return new Promise((resolve, reject) => {
      if (this.isRunning) {
        resolve({ success: true, message: 'RAG service already running' });
        return;
      }

      try {
        // Start Python RAG service
        const ragServicePath = path.join(__dirname, 'service', 'app.py');
        this.process = spawn('python', [ragServicePath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: path.join(__dirname, 'service')
        });

        this.process.stdout.on('data', (data) => {
          console.log('[RAG] Service output:', data.toString());
        });

        this.process.stderr.on('data', (data) => {
          console.error('[RAG] Service error:', data.toString());
        });

        this.process.on('close', (code) => {
          console.log(`[RAG] Service exited with code ${code}`);
          this.isRunning = false;
        });

        // Wait for service to start
        setTimeout(() => {
          this.isRunning = true;
          resolve({
            success: true,
            message: 'RAG service started successfully',
            port: this.port
          });
        }, 3000);

      } catch (error) {
        reject(new Error(`Failed to start RAG service: ${error.message}`));
      }
    });
  }

  /**
   * Stop the RAG service
   */
  async stop() {
    return new Promise((resolve) => {
      if (this.process) {
        this.process.kill('SIGTERM');
        this.process = null;
        this.isRunning = false;
        resolve({ success: true, message: 'RAG service stopped' });
      } else {
        resolve({ success: true, message: 'RAG service was not running' });
      }
    });
  }

  /**
   * Check if service is running
   */
  isServiceRunning() {
    return this.isRunning && this.process && !this.process.killed;
  }
}

module.exports = {
  RAGServiceManager,
  startRagService: async () => {
    const manager = new RAGServiceManager();
    return await manager.start();
  },
  stopRagService: async () => {
    const manager = new RAGServiceManager();
    return await manager.stop();
  },
  waitForRagReady: async () => {
    // Simple wait for RAG service to be ready
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ success: true, message: 'RAG service ready' });
      }, 5000);
    });
  }
};

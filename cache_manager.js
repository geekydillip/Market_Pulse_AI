/*
  Processing State Cache Manager
  Handles persistence of processing state for resume functionality
*/

const fs = require('fs');
const path = require('path');

class ProcessingCacheManager {
  constructor() {
    this.cacheDir = path.join(__dirname, 'cache');
    this.ensureCacheDirectory();
  }

  ensureCacheDirectory() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Get cache directory for a specific processing session
   */
  getSessionCacheDir(processingType, sessionId) {
    return path.join(this.cacheDir, processingType, sessionId);
  }

  /**
   * Initialize cache for a new processing session
   */
  initializeSession(processingType, sessionId, metadata) {
    const sessionDir = this.getSessionCacheDir(processingType, sessionId);

    try {
      // Create session directory
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }

      // Create chunks subdirectory
      const chunksDir = path.join(sessionDir, 'chunks');
      if (!fs.existsSync(chunksDir)) {
        fs.mkdirSync(chunksDir, { recursive: true });
      }

      // Save session metadata
      const sessionState = {
        sessionId,
        processingType,
        startTime: Date.now(),
        status: 'active',
        totalChunks: metadata.totalChunks || 0,
        completedChunks: 0,
        currentChunk: 0,
        ...metadata
      };

      this.saveSessionState(processingType, sessionId, sessionState);

      return sessionState;
    } catch (error) {
      console.error('Failed to initialize session cache:', error);
      return null;
    }
  }

  /**
   * Save session state
   */
  saveSessionState(processingType, sessionId, state) {
    const sessionDir = this.getSessionCacheDir(processingType, sessionId);
    const stateFile = path.join(sessionDir, 'state.json');

    try {
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      return true;
    } catch (error) {
      console.error('Failed to save session state:', error);
      return false;
    }
  }

  /**
   * Load session state
   */
  loadSessionState(processingType, sessionId) {
    const sessionDir = this.getSessionCacheDir(processingType, sessionId);
    const stateFile = path.join(sessionDir, 'state.json');

    try {
      if (fs.existsSync(stateFile)) {
        const data = fs.readFileSync(stateFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Failed to load session state:', error);
    }
    return null;
  }

  /**
   * Save processed chunk data
   */
  saveChunkData(processingType, sessionId, chunkId, chunkData) {
    const sessionDir = this.getSessionCacheDir(processingType, sessionId);
    const chunksDir = path.join(sessionDir, 'chunks');
    const chunkFile = path.join(chunksDir, `chunk_${chunkId}.json`);

    try {
      // Ensure chunks directory exists
      if (!fs.existsSync(chunksDir)) {
        fs.mkdirSync(chunksDir, { recursive: true });
      }

      fs.writeFileSync(chunkFile, JSON.stringify(chunkData, null, 2));
      return true;
    } catch (error) {
      console.error('Failed to save chunk data:', error);
      return false;
    }
  }

  /**
   * Load processed chunk data
   */
  loadChunkData(processingType, sessionId, chunkId) {
    const sessionDir = this.getSessionCacheDir(processingType, sessionId);
    const chunksDir = path.join(sessionDir, 'chunks');
    const chunkFile = path.join(chunksDir, `chunk_${chunkId}.json`);

    try {
      if (fs.existsSync(chunkFile)) {
        const data = fs.readFileSync(chunkFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Failed to load chunk data:', error);
    }
    return null;
  }

  /**
   * Get all completed chunks for a session
   */
  getCompletedChunks(processingType, sessionId) {
    const sessionDir = this.getSessionCacheDir(processingType, sessionId);
    const chunksDir = path.join(sessionDir, 'chunks');

    try {
      if (!fs.existsSync(chunksDir)) {
        return [];
      }

      const chunkFiles = fs.readdirSync(chunksDir)
        .filter(file => file.startsWith('chunk_') && file.endsWith('.json'))
        .map(file => {
          const chunkId = parseInt(file.replace('chunk_', '').replace('.json', ''));
          return { id: chunkId, file: path.join(chunksDir, file) };
        })
        .sort((a, b) => a.id - b.id);

      const completedChunks = [];
      for (const chunk of chunkFiles) {
        try {
          const data = fs.readFileSync(chunk.file, 'utf8');
          completedChunks.push({
            chunkId: chunk.id,
            data: JSON.parse(data)
          });
        } catch (error) {
          console.warn(`Failed to load chunk ${chunk.id}:`, error);
        }
      }

      return completedChunks;
    } catch (error) {
      console.error('Failed to get completed chunks:', error);
      return [];
    }
  }

  /**
   * Update session progress
   */
  updateProgress(processingType, sessionId, progress) {
    const state = this.loadSessionState(processingType, sessionId);
    if (state) {
      Object.assign(state, progress);
      state.lastUpdated = Date.now();
      this.saveSessionState(processingType, sessionId, state);
    }
  }

  /**
   * Mark session as completed
   */
  completeSession(processingType, sessionId) {
    const state = this.loadSessionState(processingType, sessionId);
    if (state) {
      state.status = 'completed';
      state.endTime = Date.now();
      this.saveSessionState(processingType, sessionId, state);
    }
  }

  /**
   * Mark session as failed
   */
  failSession(processingType, sessionId, error) {
    const state = this.loadSessionState(processingType, sessionId);
    if (state) {
      state.status = 'failed';
      state.error = error;
      state.endTime = Date.now();
      this.saveSessionState(processingType, sessionId, state);
    }
  }

  /**
   * Pause session
   */
  pauseSession(processingType, sessionId) {
    const state = this.loadSessionState(processingType, sessionId);
    if (state) {
      state.status = 'paused';
      state.pausedAt = Date.now();
      this.saveSessionState(processingType, sessionId, state);
    }
  }

  /**
   * Resume session
   */
  resumeSession(processingType, sessionId) {
    const state = this.loadSessionState(processingType, sessionId);
    if (state) {
      state.status = 'active';
      state.resumedAt = Date.now();
      this.saveSessionState(processingType, sessionId, state);
    }
  }

  /**
   * Check if session can be resumed
   */
  canResumeSession(processingType, sessionId) {
    const state = this.loadSessionState(processingType, sessionId);
    return state && (state.status === 'paused' || state.status === 'active');
  }

  /**
   * Get resume data for a session
   */
  getResumeData(processingType, sessionId) {
    const state = this.loadSessionState(processingType, sessionId);
    if (!state || !this.canResumeSession(processingType, sessionId)) {
      return null;
    }

    const completedChunks = this.getCompletedChunks(processingType, sessionId);

    return {
      sessionState: state,
      completedChunks: completedChunks,
      nextChunkId: completedChunks.length
    };
  }

  /**
   * Clean up old cache (keep only recent sessions)
   */
  cleanupOldCache(maxAgeDays = 7) {
    try {
      const maxAge = maxAgeDays * 24 * 60 * 60 * 1000; // Convert to milliseconds
      const now = Date.now();

      const processingTypes = fs.readdirSync(this.cacheDir);

      for (const processingType of processingTypes) {
        const typeDir = path.join(this.cacheDir, processingType);
        if (!fs.statSync(typeDir).isDirectory()) continue;

        const sessions = fs.readdirSync(typeDir);

        for (const sessionId of sessions) {
          const sessionDir = path.join(typeDir, sessionId);
          if (!fs.statSync(sessionDir).isDirectory()) continue;

          try {
            const stateFile = path.join(sessionDir, 'state.json');
            if (fs.existsSync(stateFile)) {
              const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
              const sessionAge = now - (state.startTime || 0);

              if (sessionAge > maxAge && state.status !== 'active') {
                console.log(`Cleaning up old cache: ${processingType}/${sessionId}`);
                fs.rmSync(sessionDir, { recursive: true, force: true });
              }
            } else {
              // No state file, remove directory
              fs.rmSync(sessionDir, { recursive: true, force: true });
            }
          } catch (error) {
            console.warn(`Failed to check session ${sessionId}:`, error);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to cleanup old cache:', error);
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    try {
      const stats = {
        totalSessions: 0,
        activeSessions: 0,
        completedSessions: 0,
        failedSessions: 0,
        totalSize: 0
      };

      const processingTypes = fs.readdirSync(this.cacheDir);

      for (const processingType of processingTypes) {
        const typeDir = path.join(this.cacheDir, processingType);
        if (!fs.statSync(typeDir).isDirectory()) continue;

        const sessions = fs.readdirSync(typeDir);

        for (const sessionId of sessions) {
          const sessionDir = path.join(typeDir, sessionId);
          if (!fs.statSync(sessionDir).isDirectory()) continue;

          stats.totalSessions++;

          try {
            const stateFile = path.join(sessionDir, 'state.json');
            if (fs.existsSync(stateFile)) {
              const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

              if (state.status === 'active') stats.activeSessions++;
              else if (state.status === 'completed') stats.completedSessions++;
              else if (state.status === 'failed') stats.failedSessions++;
            }

            // Calculate directory size
            const getDirSize = (dirPath) => {
              let size = 0;
              const items = fs.readdirSync(dirPath);

              for (const item of items) {
                const itemPath = path.join(dirPath, item);
                const stat = fs.statSync(itemPath);

                if (stat.isDirectory()) {
                  size += getDirSize(itemPath);
                } else {
                  size += stat.size;
                }
              }

              return size;
            };

            stats.totalSize += getDirSize(sessionDir);
          } catch (error) {
            // Ignore errors in stats calculation
          }
        }
      }

      return stats;
    } catch (error) {
      console.warn('Failed to get cache stats:', error);
      return null;
    }
  }
}

// Export singleton instance
module.exports = new ProcessingCacheManager();

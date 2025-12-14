// Set light theme permanently
document.body.className = 'theme-light';

// DOM Elements (will be defined inside DOMContentLoaded)
let dropzone, fileInput, filePreview, fileName, fileSize, fileContent, removeFile, processBtn, loadingOverlay;
let statusElement, progressContainer, progressFill, progressText, modelSelect, stopBtn;

// State
let currentFile = null;
let currentResult = '';

// Initialize
    document.addEventListener('DOMContentLoaded', () => {
    // Initialize DOM elements after DOM is loaded
    dropzone = document.getElementById('dropzone');
    fileInput = document.getElementById('fileInput');
    filePreview = document.getElementById('filePreview');
    fileName = document.getElementById('fileName');
    fileSize = document.getElementById('fileSize');
    fileContent = document.getElementById('fileContent');
    removeFile = document.getElementById('removeFile');
    processBtn = document.getElementById('processBtn');
    loadingOverlay = document.getElementById('loadingOverlay');
    statusElement = document.getElementById('status');
    progressContainer = document.getElementById('progressContainer');
    progressFill = document.getElementById('progressFill');
    progressText = document.getElementById('progressText');
    modelSelect = document.getElementById('modelSelect');
    stopBtn = document.getElementById('stopBtn');

    setupEventListeners();
    loadModels();
    checkOllamaConnection();

    // Initialize processing options visibility - show by default (not hidden until file uploaded)
    const processingSection = document.querySelector('.processing-section');
    if (processingSection) {
        processingSection.style.display = 'block';
    }

    // Initialize Desire Selector visual state
    updateSelectionState();
    initializeProgressState();
});

function initializeProgressState() {
    progressFill.style.width = '0%';
    progressContainer.style.display = 'none';
}

// Global processing timing variables
let processingStartTime = null;
let processingEndTime = null;
let processingStartTimestamp = null; // milliseconds timestamp for ETC calculations

// Configurable parameters for ETC calculation
const EST_ALPHA = 0.30;         // EWMA alpha (0.2-0.4 recommended)
const DEFAULT_CONCURRENCY = 4;  // fallback concurrency (documented default)
let OVERHEAD_MS = 0;            // optional extra overhead (T_read + T_write etc.) - now dynamic

// Processing metrics for estimated completion time
let processingMetrics = {
    chunkCompletionTimes: [], // Track when each chunk completes
    chunksCompleted: 0,
    totalChunks: 0,
    avgChunkInterval: null // Average time between chunk completions
};

function setupEventListeners() {
    // Dropzone events
    if (dropzone) dropzone.addEventListener('click', () => fileInput.click());
    if (dropzone) dropzone.addEventListener('dragover', handleDragOver);
    if (dropzone) dropzone.addEventListener('dragleave', handleDragLeave);
    if (dropzone) dropzone.addEventListener('drop', handleDrop);

    // File input
    if (fileInput) fileInput.addEventListener('change', handleFileSelect);
    if (removeFile) removeFile.addEventListener('click', clearFile);

    // Processing type change
    document.querySelectorAll('input[name="processingType"]').forEach(radio => {
        radio.addEventListener('change', handleProcessingTypeChange);
    });

    // Model change
    if (modelSelect) modelSelect.addEventListener('change', handleModelChange);

    // Process button
    if (processBtn) processBtn.addEventListener('click', handleProcess);

    // Stop button
    if (stopBtn) stopBtn.addEventListener('click', handleStop);
}



// Helper functions for file handling
function handleDragOver(e) {
    e.preventDefault();
    dropzone.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFile(files[0]);
    }
}

function handleFileSelect(e) {
    if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
    }
}

function handleFile(file) {
    // Validate file type
    const validTypes = ['.txt', '.md', '.json', '.csv', '.log', '.xls', '.xlsx'];
    const fileExt = '.' + file.name.split('.').pop().toLowerCase();

    if (!validTypes.includes(fileExt)) {
        alert('Please upload a valid file type: .txt, .md, .json, .csv, .log, .xls, or .xlsx');
        return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
        alert('File size must be less than 10MB');
        return;
    }

    currentFile = file;
    
    // Display file info
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    
    // Read and display file content
    if (fileExt === '.xls' || fileExt === '.xlsx') {
        fileContent.textContent = 'Excel file - content will be extracted as XLSX format for processing.';
        dropzone.style.display = 'none';
        filePreview.style.display = 'block';

        // Show processing section when Excel file is uploaded
        const processingSection = document.querySelector('.processing-section');
        if (processingSection) {
            processingSection.style.display = 'block';
        }
    } else {
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            fileContent.textContent = content.length > 500 ? content.substring(0, 500) + '...' : content;
            dropzone.style.display = 'none';
            filePreview.style.display = 'block';
        };
        reader.readAsText(file);
    }
}

function clearFile() {
    currentFile = null;
    fileInput.value = '';
    dropzone.style.display = 'block';
    filePreview.style.display = 'none';
    fileContent.textContent = '';

    // Hide processing section when file is cleared
    const processingSection = document.querySelector('.processing-section');
    if (processingSection) {
        processingSection.style.display = 'none';
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Processing type change handler
function handleProcessingTypeChange(e) {
    // Update visual selection state
    updateSelectionState();
}

// Selection state management
function updateSelectionState() {
    const selectedRadio = document.querySelector('input[name="processingType"]:checked');
    const processBtn = document.getElementById('processBtn');
    const statusElement = document.getElementById('selectionStatus');
    const selectionText = document.getElementById('selectionText');

    // Reset all cards to unselected state
    document.querySelectorAll('.radio-card-content').forEach(card => {
        card.classList.remove('selected');
        const indicator = card.querySelector('.selection-indicator');
        if (indicator) {
            indicator.style.opacity = '0';
            indicator.style.transform = 'scale(0.8)';
        }
    });

    if (selectedRadio) {
        // Mark the selected card
        const selectedCard = selectedRadio.closest('.radio-card').querySelector('.radio-card-content');
        selectedCard.classList.add('selected');

        // Show check mark
        const indicator = selectedCard.querySelector('.selection-indicator');
        if (indicator) {
            indicator.style.opacity = '1';
            indicator.style.transform = 'scale(1)';
        }

        // Update status text
        const selectedTitle = selectedCard.querySelector('h3').textContent;
        selectionText.textContent = `✓ ${selectedTitle} Selected`;
        statusElement.className = 'selection-status selected';

        // Enable process button
        processBtn.disabled = false;

    } else {
        // No selection
        selectionText.textContent = '✗ No Processing Type Selected';
        statusElement.className = 'selection-status not-selected';
        processBtn.disabled = true;
    }
}

async function handleModelChange(e) {
    const selectedModel = e.target.value;
    console.log('Model changed to:', selectedModel);

    // Check Ollama connection with the selected model
    try {
        const response = await fetch('/api/health');
        const data = await response.json();

        if (data.ollama === 'connected') {
            updateStatus('connected', `Ollama Connected - ${selectedModel} ready`);
        } else {
            updateStatus('error', `Ollama Disconnected - ${selectedModel} unavailable`);
        }
    } catch (error) {
        updateStatus('error', `Connection check failed - ${selectedModel}`);
    }
}

// Make concurrency configurable / discoverable
function getConcurrency() {
    // TODO: read from server config or app settings if available.
    // Fallback to documented default of 4.
    return window.appConcurrency || DEFAULT_CONCURRENCY;
}

// Main processing function
async function handleProcess() {
    if (!currentFile) {
        alert('Please upload a file first');
        return;
    }

    // Record processing start time
    processingStartTime = new Date();
    processingStartTimestamp = processingStartTime.getTime(); // milliseconds timestamp for ETC calculations
    processingEndTime = null; // Reset end time

    // Initialize processing metrics for estimated completion time
    initializeProcessingMetrics();

    // Get processing type and model
    const processingType = document.querySelector('input[name="processingType"]:checked').value;
    const selectedModel = modelSelect.value;

    // Generate unique session ID for this processing request
    const sessionId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);

    try {
        if (currentFile.name.endsWith('.xlsx') || currentFile.name.endsWith('.xls') || currentFile.name.endsWith('.json')) {
            // Handle Excel/JSON processing with chunked progress
            progressContainer.style.display = 'block';
            updateProgress(0, 'Initializing...');
            await processStructuredFile(currentFile, processingType, selectedModel, sessionId);
        } else {
            // Process other files - show loading overlay
            showLoading(selectedModel);
            const formData = new FormData();
            formData.append('file', currentFile);
            formData.append('processingType', processingType);

            formData.append('model', selectedModel);

            const response = await fetch('/api/process', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('Failed to process file');
            }

            const result = await response.json();

            if (result.success) {
                // Record processing end time and show summary
                processingEndTime = new Date();
                showProcessingSummary(result.total_processing_time_ms, [], processingStartTime, processingEndTime);
                // For non-structured files, download as text
                downloadText(result.result, `processed-${Date.now()}.txt`);
            } else {
                throw new Error(result.error || 'Processing failed');
            }
        }

    } catch (error) {
        console.error('Processing error:', error);
        alert('Error: ' + error.message + '\n\nMake sure Ollama is running with the selected model.');
    } finally {
        hideLoading();
        progressContainer.style.display = 'none';
    }
}

async function processStructuredFile(file, processingType, model, sessionId) {
    return new Promise(async (resolve, reject) => {
        try {
            // Set global session tracking
            currentSessionId = sessionId;

            // Add processing class to enable shining animation
            processBtn.classList.add('processing');

            // Show stop button
            stopBtn.style.display = 'inline-block';

            const processStartTime = Date.now();
            let timerInterval;
            let eventSource;

            // Connect to SSE for real-time progress updates
            eventSource = new EventSource(`/api/progress/${sessionId}`);
            currentEventSource = eventSource;

            eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'progress') {
                        // Cache metadata for better ETA calculations
                        if (data.totalChunks && Number.isFinite(data.totalChunks)) {
                            processingMetrics.totalChunks = parseInt(data.totalChunks, 10);
                        }
                        if (data.chunksCompleted && Number.isFinite(data.chunksCompleted)) {
                            processingMetrics.chunksCompleted = parseInt(data.chunksCompleted, 10);
                        }

                        updateProgress(data.percent, data.message);
                        console.log(`Progress: ${data.percent}% - ${data.message}`);
                    }
                } catch (e) {
                    console.error('Error parsing SSE data:', e);
                }
            };

            eventSource.onerror = (error) => {
                console.error('SSE error:', error);
            };

            // Start live timer
            currentTimerInterval = setInterval(() => {
                const elapsedMs = Date.now() - processStartTime;
                const elapsedSec = Math.floor(elapsedMs / 1000);
                const message = `Processing... (${elapsedSec}s)`;
                // Update timer display, but allow current progress message to show if it's detailed
                if (!progressText.textContent.includes('Processing Data') &&
                    !progressText.textContent.includes('Finalizing output') &&
                    !progressText.textContent.includes('Processing complete')) {
                    progressText.textContent = message;
                }
            }, 1000);

            // Send processing request
            const formData = new FormData();
            formData.append('file', file);
            formData.append('processingType', processingType);

            formData.append('model', model);
            formData.append('sessionId', sessionId);

            const response = await fetch('/api/process', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                eventSource.close();
                reject(new Error('Processing failed'));
                return;
            }

            // Wait for response and handle download
            const result = await response.json();

            if (result.success && result.downloads && result.downloads.length > 0) {
                clearInterval(currentTimerInterval);
                eventSource.close();
                updateProgress(100, 'Processing complete');
                // Download the first file (processed Excel/JSON)
                downloadFile(result.downloads[0].url, result.downloads[0].filename);

                // Record processing end time
                processingEndTime = new Date();

                // Show processing summary
                showProcessingSummary(result.total_processing_time_ms, result.downloads, processingStartTime, processingEndTime);
            } else {
                clearInterval(currentTimerInterval);
                eventSource.close();
                reject(new Error(result.error || 'Processing failed'));
            }

            resolve();
        } catch (error) {
            if (timerInterval) clearInterval(timerInterval);
            if (eventSource) eventSource.close();
            reject(error);
        } finally {
            // Remove processing class to stop shining animation
            processBtn.classList.remove('processing');

            // Hide stop button when processing completes
            stopBtn.style.display = 'none';

            // Clear session tracking
            currentSessionId = null;
            currentEventSource = null;
        }
    });
}

function updateProgress(percent, text, timerInterval) {
    console.log('Updating progress to ' + percent + '%', 'type:', typeof percent, 'element exists:', !!progressFill);
    progressFill.style.width = percent + '%';
    console.log('Set width to:', progressFill.style.width);
    if (timerInterval) {
        // If timer is running, don't override the timer text
        return;
    }
    progressText.textContent = text;

    // Update estimated completion time based on progress
    updateEstimatedTime(text, percent);
}

// Store current timer for cleanup
let currentTimerInterval = null;

function downloadFile(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function downloadText(text, filename) {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function showLoading(model) {
    const loadingText = loadingOverlay.querySelector('p');
    loadingText.textContent = `Processing with ${model}...`;
    loadingOverlay.style.display = 'flex';
    processBtn.disabled = true;
    processBtn.classList.add('processing');
}

function hideLoading() {
    loadingOverlay.style.display = 'none';
    processBtn.disabled = false;
    processBtn.classList.remove('processing');
}

// Connection status functions
async function checkOllamaConnection() {
    try {
        const response = await fetch('/api/health');
        const data = await response.json();

        if (data.ollama === 'connected') {
            updateStatus('connected', 'Ollama Connected');
        } else {
            updateStatus('error', 'Ollama Disconnected');
        }
    } catch (error) {
        updateStatus('error', 'Ollama Not Running');
    }

    // Check again every 30 seconds
    setTimeout(checkOllamaConnection, 30000);
}

function updateStatus(status, text) {
    statusElement.className = 'status ' + status;
    statusElement.querySelector('.status-text').textContent = text;
}

async function loadModels() {
    // Use the global modelSelect variable (already assigned in DOMContentLoaded)
    if (!modelSelect) {
        console.error('modelSelect element not found');
        return;
    }

    try {
        const response = await fetch('/api/ollama-models');
        const data = await response.json();

        if (data.success && data.models.length > 0) {
            modelSelect.innerHTML = '';
            data.models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                modelSelect.appendChild(option);
            });

            // Default to qwen3:4b-instruct or gemma3:4b if available, else first model
            const defaultModel = data.models.includes('qwen3:4b-instruct') ? 'qwen3:4b-instruct' :
                                data.models.includes('gemma3:4b') ? 'gemma3:4b' : data.models[0];
            modelSelect.value = defaultModel;
        } else {
            // Fallback
            modelSelect.innerHTML = '<option value="gemma3:4b">gemma3:4b</option>';
        }
    } catch (error) {
        console.error('Error loading models:', error);
        // Fallback
        if (modelSelect) {
            modelSelect.innerHTML = '<option value="gemma3:4b">gemma3:4b</option>';
        }
    }
}

// Show processing summary
function showProcessingSummary(serverTimeMs, downloads, startTime, endTime) {
    const summary = document.getElementById('processingSummary');
    const timeElement = document.getElementById('processingTime');
    const downloadsElement = document.getElementById('summaryDownloads');

    // Calculate actual processing time from start/end times if available
    let processingTimeMs = serverTimeMs;
    let processingTimeText = '';

    if (startTime && endTime) {
        processingTimeMs = endTime.getTime() - startTime.getTime();

        // Format start and end times
        const startFormatted = startTime.toLocaleString();
        const endFormatted = endTime.toLocaleString();

        // Calculate duration
        const duration = processingTimeMs;
        const totalSeconds = Math.floor(duration / 1000);

        let durationText;
        if (totalSeconds >= 3600) {
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const secs = totalSeconds % 60;
            durationText = `${hours}h:${minutes}m:${secs.toString().padStart(2, '0')}s`;
        } else {
            const minutes = Math.floor(totalSeconds / 60);
            const secs = totalSeconds % 60;
            durationText = `${minutes}m:${secs.toString().padStart(2, '0')}s`;
        }

        processingTimeText = `${startFormatted} - ${endFormatted}\nDuration: ${durationText}`;
    } else {
        // Fallback to server-provided time if client-side timing not available
        const totalSeconds = Math.floor(processingTimeMs / 1000);

        let durationText;
        if (totalSeconds >= 3600) {
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const secs = totalSeconds % 60;
            durationText = `${hours}h:${minutes}m:${secs.toString().padStart(2, '0')}s`;
        } else {
            const minutes = Math.floor(totalSeconds / 60);
            const secs = totalSeconds % 60;
            durationText = `${minutes}m:${secs.toString().padStart(2, '0')}s`;
        }

        processingTimeText = `Processing time: ${durationText}`;
    }

    timeElement.textContent = processingTimeText;

    // Clear previous downloads
    downloadsElement.innerHTML = '';

    // Add download buttons
    downloads.forEach(download => {
        const btn = document.createElement('button');
        btn.className = 'btn-action';
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            Download ${download.filename.split('_').pop().replace('.xlsx', '').replace('.json', '')}
        `;
        btn.onclick = () => downloadFile(download.url, download.filename);
        downloadsElement.appendChild(btn);
    });

    summary.style.display = 'block';
}

// Function to parse chunk information from progress messages
function parseChunkInfo(message) {
    // Look for patterns like "Processed chunk 2/5" or "Processing chunk 3 of 10"
    const chunkMatch = message.match(/Processed chunk (\d+)\/(\d+)/i) ||
                      message.match(/Processing chunk (\d+) of (\d+)/i) ||
                      message.match(/chunk (\d+)\/(\d+)/i);

    if (chunkMatch) {
        return {
            completed: parseInt(chunkMatch[1]),
            total: parseInt(chunkMatch[2])
        };
    }
    return null;
}

// Updated updateEstimatedTime to fix logic and use EWMA smoothing
function updateEstimatedTime(progressMessage, percent) {
    const estimatedTimeElement = document.getElementById('estimatedTime');
    if (!estimatedTimeElement) return;

    const chunkInfo = parseChunkInfo(progressMessage);

    if (chunkInfo) {
        // Update counts from message
        processingMetrics.chunksCompleted = chunkInfo.completed;
        processingMetrics.totalChunks = chunkInfo.total;

        const now = Date.now();
        // push the completion timestamp
        processingMetrics.chunkCompletionTimes.push(now);

        // compute latest interval: difference between last two timestamps
        const len = processingMetrics.chunkCompletionTimes.length;
        if (len >= 2) {
            const latestInterval = processingMetrics.chunkCompletionTimes[len - 1] - processingMetrics.chunkCompletionTimes[len - 2];

            // update EWMA
            if (processingMetrics.ewmaIntervalMs == null) {
                processingMetrics.ewmaIntervalMs = latestInterval;
            } else {
                processingMetrics.ewmaIntervalMs = EST_ALPHA * latestInterval + (1 - EST_ALPHA) * processingMetrics.ewmaIntervalMs;
            }
        }

        // derive safe percent as number
        percent = (typeof percent === 'string') ? parseFloat(percent) : percent;
        percent = Number.isFinite(percent) ? percent : 0;

        // Now compute ETC using smoothed T1
        const T1 = processingMetrics.ewmaIntervalMs; // ms
        const M_remaining = Math.max(0, processingMetrics.totalChunks - processingMetrics.chunksCompleted);

        // compute concurrency to use: cannot be greater than remaining chunks
        const declaredK = getConcurrency();
        const effectiveK = Math.max(1, Math.min(declaredK, Math.max(1, M_remaining))); // at least 1
        const k = effectiveK;

        // If job finished, hide estimate
        if (processingMetrics.chunksCompleted >= processingMetrics.totalChunks || (percent >= 100)) {
            estimatedTimeElement.style.display = 'none';
            return;
        }

        if (T1 != null && M_remaining > 0) {
            // estimated remaining ms
            let estimatedRemainingMs = (M_remaining / k) * T1 + OVERHEAD_MS;

            const progressRatio = processingMetrics.chunksCompleted / processingMetrics.totalChunks;

            // Conservative correction factor
            let safetyFactor;

            if (progressRatio < 0.15) {
                safetyFactor = 2.2;   // very early → heavy underestimation risk
            } else if (progressRatio < 0.30) {
                safetyFactor = 1.8;
            } else if (progressRatio < 0.50) {
                safetyFactor = 1.4;
            } else if (progressRatio < 0.70) {
                safetyFactor = 1.2;
            } else {
                safetyFactor = 1.05;  // near completion → accurate
            }

            estimatedRemainingMs *= safetyFactor;

            // compute completion timestamp
            const completionTs = new Date(now + estimatedRemainingMs);

            const formattedTime = completionTs.toLocaleTimeString('en-GB', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            // also show remaining duration (human friendly)
            const sec = Math.round(estimatedRemainingMs / 1000);
            const durationText = sec >= 60 ? Math.floor(sec / 60) + 'm ' + (sec % 60) + 's' : sec + 's';

            estimatedTimeElement.textContent = `Estimated time remaining: ${durationText}`;
            estimatedTimeElement.style.display = 'block';


            console.log(`ETC debug: M=${processingMetrics.totalChunks}, completed=${processingMetrics.chunksCompleted}, remaining=${M_remaining}, T1=${(T1).toFixed(0)}ms, k=${k}, ETC=${(estimatedRemainingMs/1000).toFixed(1)}s`);
        } else if (T1 == null && processingMetrics.chunkCompletionTimes.length === 2) {
            // We have exactly one interval (first chunk), use it (already set via EWMA path)
            // (This block may be redundant due to above condition)
        }
    } else if (percent > 0 && percent < 100) {
        // Percent-based fallback — use processingStartTimestamp for elapsed time
        if (!processingStartTimestamp) {
            processingStartTimestamp = Date.now();
        }

        const elapsed = Date.now() - processingStartTimestamp; // ms
        if (elapsed > 0) {
            const estimatedTotal = (elapsed / percent) * 100;
            const estimatedRemaining = estimatedTotal - elapsed;
            if (estimatedRemaining > 0) {
                const completionTs = new Date(Date.now() + estimatedRemaining);
                const formattedTime = completionTs.toLocaleTimeString('en-GB', {
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });
                estimatedTimeElement.textContent = `Estimated completion: ${formattedTime}`;
                estimatedTimeElement.style.display = 'block';
            }
        }
    } else {
        estimatedTimeElement.style.display = 'none';
    }
}

// Function to initialize processing metrics
function initializeProcessingMetrics() {
    processingMetrics = {
        chunkCompletionTimes: [], // timestamps in ms. first entry will be start time.
        chunksCompleted: 0,
        totalChunks: 0,
        ewmaIntervalMs: null // EWMA-smoothed interval (T1)
    };

    // Capture processing start time (ms) so first interval is meaningful
    processingStartTimestamp = Date.now();      // global var (already set in handleProcess)
    processingMetrics.chunkCompletionTimes.push(processingStartTimestamp);

    // Hide estimated time initially
    const estimatedTimeElement = document.getElementById('estimatedTime');
    if (estimatedTimeElement) {
        estimatedTimeElement.style.display = 'none';
    }
}

// Tab switching functionality
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    const tab = btn.getAttribute('data-tab');
    if (!tab) return;

    // deactivate all and activate
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    const content = document.getElementById(tab + '-tab') || document.getElementById(tab);
    if (content) content.classList.add('active');
});

// Stop processing function
async function handleStop() {
    console.log('Stop button clicked, currentSessionId:', currentSessionId);

    if (!currentSessionId) {
        console.warn('No active session to stop');
        alert('No active processing session to cancel');
        return;
    }

    try {
        console.log('Calling cancel endpoint for session:', currentSessionId);

        // Call cancel endpoint
        const response = await fetch(`/api/cancel/${currentSessionId}`, {
            method: 'POST'
        });

        console.log('Cancel response status:', response.status);

        const result = await response.json();
        console.log('Cancel response:', result);

        if (result.success) {
            console.log('Processing cancelled successfully');

            // Reset UI state
            resetProcessingState();

            // Show cancellation message
            updateProgress(0, 'Processing cancelled by user');
            setTimeout(() => {
                progressContainer.style.display = 'none';
                progressFill.style.width = '0%';
            }, 2000);

        } else {
            console.error('Failed to cancel processing:', result.error);
            alert('Failed to cancel processing: ' + result.error);
        }

    } catch (error) {
        console.error('Error cancelling processing:', error);
        alert('Error cancelling processing: ' + error.message);
    }
}

// Reset processing state after cancellation
function resetProcessingState() {
    // Clear timers
    if (currentTimerInterval) {
        clearInterval(currentTimerInterval);
        currentTimerInterval = null;
    }

    // Close event source
    if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
    }

    // Reset processing metrics
    processingMetrics = {
        chunkCompletionTimes: [],
        chunksCompleted: 0,
        totalChunks: 0,
        ewmaIntervalMs: null
    };

    // Hide progress elements
    progressContainer.style.display = 'none';
    stopBtn.style.display = 'none';

    // Reset progress bar
    progressFill.style.width = '0%';

    // Re-enable process button
    processBtn.disabled = false;
    processBtn.classList.remove('processing');

    // Clear session ID
    currentSessionId = null;
}

// Global variables for cleanup
let currentSessionId = null;
let currentEventSource = null;

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + Enter to process
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleProcess();
    }

    // Ctrl/Cmd + K to clear
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        clearFile();
    }
});

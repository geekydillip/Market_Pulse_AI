// Set light theme permanently
document.body.className = 'theme-light';

// DOM Elements (will be defined inside DOMContentLoaded)
let dropzone, fileInput, filePreview, fileName, fileSize, fileContent, removeFile, processBtn, loadingOverlay;
let statusElement, progressContainer, progressFill, progressText, modelSelect;

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

// Main processing function
async function handleProcess() {
    if (!currentFile) {
        alert('Please upload a file first');
        return;
    }

    // Record processing start time
    processingStartTime = new Date();
    processingEndTime = null; // Reset end time

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
            // Add processing class to enable shining animation
            processBtn.classList.add('processing');

            const processStartTime = Date.now();
            let timerInterval;
            let eventSource;

            // Connect to SSE for real-time progress updates
            eventSource = new EventSource(`/api/progress/${sessionId}`);

            eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'progress') {
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
                if (!progressText.textContent.includes('Processed chunk')) {
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
        const seconds = Math.floor(duration / 1000);
        const milliseconds = Math.floor(duration % 1000);

        processingTimeText = `${startFormatted} - ${endFormatted}\nDuration: ${seconds}.${milliseconds.toString().padStart(3, '0')} seconds`;
    } else {
        // Fallback to server-provided time if client-side timing not available
        const seconds = Math.floor(processingTimeMs / 1000);
        const milliseconds = Math.floor(processingTimeMs % 1000);
        processingTimeText = `Processing time: ${seconds}.${milliseconds.toString().padStart(3, '0')} seconds`;
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

// Wrap uploader logic in IIFE to prevent global scope pollution
(() => {
    // Set light theme permanently
    document.body.className = 'theme-light';

    // Debug configuration
    const DEBUG = false;

    // DOM Elements (will be defined inside DOMContentLoaded)
    let dropzone, fileInput, filePreview, fileName, fileSize, fileContent, removeFile, fileActions, processBtn, loadingOverlay;
    let statusElement, progressContainer, progressFill, progressText, modelSelect, stopBtn;

    // State
    let currentFile = null;
    let currentResult = '';
    let fileQueue = []; // Array of file objects with id, file, status, etc.
    let queueCounter = 0; // For unique IDs
    let isProcessingQueue = false;
    let currentProcessingIndex = -1;

    // Global variables for cleanup
    let currentSessionId = null;
    let currentEventSource = null;

    // Initialize
    document.addEventListener('DOMContentLoaded', () => {
        // Initialize DOM elements after DOM is loaded
        dropzone = document.getElementById('dropzone');
        fileInput = document.getElementById('fileInput');
        filePreview = document.getElementById('filePreview');
        fileName = document.getElementById('fileName');
        fileSize = document.getElementById('fileSize');
        fileContent = document.getElementById('fileContent');
        fileActions = document.getElementById('fileActions');
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

        // Setup drag and drop for Processing Queue
        setupQueueDragDrop();
    });

    // Add beforeunload event listener to close EventSource and prevent memory leaks
    window.addEventListener('beforeunload', () => {
        if (currentEventSource) {
            currentEventSource.close();
            currentEventSource = null;
        }
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

    // Queue buttons
    const clearQueueBtn = document.getElementById('clearQueueBtn');

    if (clearQueueBtn) clearQueueBtn.addEventListener('click', () => clearQueue());
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
        Array.from(files).forEach(file => addFileToQueue(file));
        toggleUIState();
        updateQueueUI();
    }
}

function handleFileSelect(e) {
    if (DEBUG) console.log('=== FILE SELECT START ===');
    const files = Array.from(e.target.files);
    if (DEBUG) console.log('Total files selected:', files.length);
    if (DEBUG) console.log('Files:', files.map(f => ({name: f.name, size: f.size, type: f.type})));

    if (files.length > 0) {
        const excelFiles = [];
        const otherFiles = [];

        // Separate Excel and other files
        files.forEach(file => {
            const fileExt = '.' + file.name.split('.').pop().toLowerCase();
            if (DEBUG) console.log(`File: ${file.name} → extension: ${fileExt}`);
            if (fileExt === '.xls' || fileExt === '.xlsx') {
                excelFiles.push(file);
                if (DEBUG) console.log(`  → Added to Excel files (${excelFiles.length} total)`);
            } else {
                otherFiles.push(file);
                if (DEBUG) console.log(`  → Added to other files (${otherFiles.length} total)`);
            }
        });

        if (DEBUG) console.log(`Final counts - Excel: ${excelFiles.length}, Other: ${otherFiles.length}`);

        // Handle other files (go directly to queue)
        if (DEBUG) console.log('Adding other files to queue...');
        otherFiles.forEach(file => {
            if (DEBUG) console.log(`  Adding ${file.name} to queue...`);
            addFileToQueue(file);
        });

        // Handle Excel files (add to queue directly like other files)
        if (excelFiles.length > 0) {
            if (DEBUG) console.log('Adding Excel files to queue...');
            excelFiles.forEach(file => {
                if (DEBUG) console.log(`  Adding ${file.name} to queue...`);
                addFileToQueue(file);
            });
        }

        if (DEBUG) console.log('Current fileQueue length:', fileQueue.length);
        if (DEBUG) console.log('FileQueue contents:', fileQueue.map(item => ({name: item.file.name, status: item.status})));

        // Update queue display first
        if (DEBUG) console.log('Updating queue UI...');
        updateQueueUI();

        // Now show Processing Queue (after cards are created)
        if (DEBUG) console.log('Toggling UI state...');
        toggleUIState();

        if (DEBUG) console.log('File select process complete');
        if (DEBUG) console.log('=== FILE SELECT END ===');
    } else {
        if (DEBUG) console.log('No files selected');
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

    // Validate file size (200MB max)
    if (file.size > 200 * 1024 * 1024) {
        alert('File size must be less than 200MB');
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

// Queue management functions
function addFileToQueue(file) {
    // Validate file type
    const validTypes = ['.json', '.csv', '.log', '.xls', '.xlsx'];
    const fileExt = '.' + file.name.split('.').pop().toLowerCase();

    if (!validTypes.includes(fileExt)) {
        alert(`Invalid file type: ${file.name}. Please upload valid file types: .json, .csv, .log, .xls, or .xlsx`);
        return;
    }

    // Validate file size (200MB max)
    if (file.size > 200 * 1024 * 1024) {
        alert(`File too large: ${file.name}. Maximum size is 200MB`);
        return;
    }

    // Check if file already exists in queue
    const existingFile = fileQueue.find(item => item.file.name === file.name && item.file.size === file.size);
    if (existingFile) {
        alert(`File ${file.name} is already in the queue`);
        return;
    }

    // Add to queue
    const queueItem = {
        id: ++queueCounter,
        file: file,
        status: 'queued', // queued, processing, completed, failed
        progress: 0, // Real-time progress percentage
        processingTime: null, // Time taken to process the file
        rows: 0, // Number of rows (for Excel/CSV files)
        chunks: 0, // Number of chunks processed
        addedAt: new Date()
    };

    fileQueue.push(queueItem);
}

function removeFromQueue(itemId) {
    const index = fileQueue.findIndex(item => item.id === itemId);
    if (index !== -1) {
        fileQueue.splice(index, 1);
        updateQueueUI();
    }
}

function moveQueueItem(itemId, direction) {
    const index = fileQueue.findIndex(item => item.id === itemId);
    if (index === -1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= fileQueue.length) return;

    // Only allow moving non-processing items
    if (fileQueue[index].status === 'processing') return;

    // Swap items
    [fileQueue[index], fileQueue[newIndex]] = [fileQueue[newIndex], fileQueue[index]];
    updateQueueUI();
}

function clearQueue() {
    // Only clear non-processing items
    fileQueue = fileQueue.filter(item => item.status === 'processing');
    updateQueueUI();
    updateFileCount();
}

function updateQueueUI() {
    const queueGrid = document.getElementById('queueGrid');

    // Clear existing items
    queueGrid.innerHTML = '';

    // Render queue items
    fileQueue.forEach((item, index) => {
        const cardElement = createFileCardElement(item, index);
        queueGrid.appendChild(cardElement);
    });
}

function createFileCardElement(item, index) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'file-card';

    // Determine status for display
    let statusPill = '';
    let progressSection = '';
    let actionButtons = '';

    if (item.status === 'processing') {
        statusPill = '<span class="status-pill status-processing">Processing...</span>';
        progressSection = `
            <div class="progress-container">
                <div class="progress-bar" data-progress="${Math.round(item.progress)}"></div>
                <span class="progress-text">${Math.round(item.progress)}%</span>
            </div>
        `;
        actionButtons = `
            <div class="action-buttons">
                <button class="action-btn download-btn" disabled>⬇️ Download</button>
                <button class="action-btn remove-btn">🗑️ Remove</button>
            </div>
        `;
    } else if (item.status === 'completed') {
        statusPill = '<span class="status-pill status-completed">✓ Completed</span>';
        progressSection = '';
        actionButtons = `
            <div class="action-buttons">
                <button class="action-btn download-btn">⬇️ Download</button>
                <button class="action-btn remove-btn">🗑️ Remove</button>
            </div>
        `;
    } else if (item.status === 'queued') {
        statusPill = '<span class="status-pill status-queued">Queued</span>';
        progressSection = '';
        actionButtons = `
            <div class="action-buttons">
                <button class="action-btn download-btn" disabled>⬇️ Download</button>
                <button class="action-btn remove-btn">🗑️ Remove</button>
            </div>
        `;
    }

    cardDiv.innerHTML = `
        <div class="card-header">
            <div class="file-info">
                <span class="file-icon">📄</span>
                <span class="filename">${item.file.name}</span>
            </div>
            ${statusPill}
        </div>
        <div class="card-meta">
            <span>Size: ${formatFileSize(item.file.size)}</span>
            <span>Rows: ${item.rows || 0}</span>
            <span>Chunks: ${item.chunks || 0}</span>
            ${item.status === 'completed' && item.processingTime ? `<span>Processed in ${item.processingTime}</span>` : ''}
        </div>
        ${progressSection}
        ${actionButtons}
    `;

    return cardDiv;
}

// Drag and drop variables
let draggedElement = null;
let draggedIndex = -1;

function handleDragStart(e) {
    draggedElement = e.target;
    draggedIndex = Array.from(draggedElement.parentNode.children).indexOf(draggedElement);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', draggedElement.outerHTML);
    draggedElement.classList.add('dragging');
}

function handleDragEnd(e) {
    draggedElement.classList.remove('dragging');
    draggedElement = null;
    draggedIndex = -1;

    // Remove drop indicators
    document.querySelectorAll('.queue-item.drop-above, .queue-item.drop-below').forEach(item => {
        item.classList.remove('drop-above', 'drop-below');
    });
}

function handleDragOverQueue(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const target = e.target.closest('.queue-item');
    if (!target || target === draggedElement) return;

    const rect = target.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;

    // Remove previous indicators
    document.querySelectorAll('.queue-item.drop-above, .queue-item.drop-below').forEach(item => {
        item.classList.remove('drop-above', 'drop-below');
    });

    if (e.clientY < midpoint) {
        target.classList.add('drop-above');
    } else {
        target.classList.add('drop-below');
    }
}

function handleDropQueue(e) {
    e.preventDefault();

    const target = e.target.closest('.queue-item');
    if (!target || target === draggedElement) return;

    const targetIndex = Array.from(target.parentNode.children).indexOf(target);
    const rect = target.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;

    let newIndex;
    if (e.clientY < midpoint) {
        newIndex = targetIndex;
    } else {
        newIndex = targetIndex + 1;
    }

    // Reorder the queue
    if (draggedIndex !== -1 && newIndex !== draggedIndex && newIndex !== draggedIndex + 1) {
        const [movedItem] = fileQueue.splice(draggedIndex, 1);
        fileQueue.splice(newIndex > draggedIndex ? newIndex - 1 : newIndex, 0, movedItem);
        updateQueueUI();
    }

    // Clean up
    handleDragEnd(e);
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
    if (DEBUG) console.log('Model changed to:', selectedModel);

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

// Main processing function - Unified for single files and queue processing
async function handleProcess() {
    // Check if there are queued files to process
    const pendingItems = fileQueue.filter(item => item.status === 'queued');
    if (pendingItems.length > 0) {
        // Process the queue
        await handleProcessQueue();
        return;
    }

    // Fallback: single file processing (for backward compatibility)
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
                        if (DEBUG) console.log(`Progress: ${data.percent}% - ${data.message}`);
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
    if (DEBUG) console.log('Updating progress to ' + percent + '%', 'type:', typeof percent, 'element exists:', !!progressFill);
    progressFill.style.width = percent + '%';
    if (DEBUG) console.log('Set width to:', progressFill.style.width);
    if (timerInterval) {
        // If timer is running, don't override the timer text
        return;
    }
    progressText.textContent = text;

    // Update currently processing queue item progress if in queue mode
    updateCurrentQueueItemProgress(percent, text);

    // Update estimated completion time based on progress
    updateEstimatedTime(text, percent);
}

// Update the currently processing queue item's progress bar
function updateCurrentQueueItemProgress(percent, text) {
    // Find the currently processing queue item
    const processingItem = fileQueue.find(item => item.status === 'processing');
    if (!processingItem) return;

    // Update the progress in the queue item data
    processingItem.progress = Math.max(0, Math.min(100, percent));

    // Find the corresponding DOM element and update it
    const queueGrid = document.getElementById('queueGrid');
    if (!queueGrid) return;

    const fileCards = queueGrid.querySelectorAll('.file-card');
    for (let card of fileCards) {
        const filenameElement = card.querySelector('.filename');
        if (filenameElement && filenameElement.textContent === processingItem.file.name) {
            // Update progress bar
            const progressBar = card.querySelector('.progress-bar');
            const progressText = card.querySelector('.progress-text');

            if (progressBar) {
                progressBar.style.width = percent + '%';
                progressBar.setAttribute('data-progress', percent);
            }

            if (progressText) {
                progressText.textContent = Math.round(percent) + '%';
            }
            break;
        }
    }
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
    if (DEBUG) console.log('Stop button clicked, currentSessionId:', currentSessionId);

    if (!currentSessionId) {
        console.warn('No active session to stop');
        alert('No active processing session to cancel');
        return;
    }

    try {
        if (DEBUG) console.log('Calling cancel endpoint for session:', currentSessionId);

        // Call cancel endpoint
        const response = await fetch(`/api/cancel/${currentSessionId}`, {
            method: 'POST'
        });

        if (DEBUG) console.log('Cancel response status:', response.status);

        const result = await response.json();
        if (DEBUG) console.log('Cancel response:', result);

        if (result.success) {
            if (DEBUG) console.log('Processing cancelled successfully');

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

// Queue processing function
async function handleProcessQueue() {
    if (isProcessingQueue) return;

    const pendingItems = fileQueue.filter(item => item.status === 'queued');
    if (pendingItems.length === 0) return;

    isProcessingQueue = true;
    const processBtn = document.getElementById('processBtn');
    processBtn.disabled = true;
    const textSpan = processBtn.querySelector('.text_button');
    if (textSpan) textSpan.textContent = 'Processing Queue...';

    // Get processing type and model
    const processingType = document.querySelector('input[name="processingType"]:checked').value;
    const selectedModel = modelSelect.value;

    // Record batch start time
    const batchStartTime = new Date();

    // Process files sequentially
    for (let i = 0; i < fileQueue.length; i++) {
        const item = fileQueue[i];
        if (item.status !== 'queued') continue;

        // Update status to processing
        item.status = 'processing';
        updateQueueUI();

        // Update next item to "up-next" if exists
        const nextItem = fileQueue[i + 1];
        if (nextItem && nextItem.status === 'queued') {
            nextItem.status = 'up-next';
            updateQueueUI();
        }

        try {
            // Record start time for this file
            const fileStartTime = Date.now();

            // Process the file
            const sessionId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);

            if (item.file.name.endsWith('.xlsx') || item.file.name.endsWith('.xls') || item.file.name.endsWith('.json')) {
                // Handle Excel/JSON processing with chunked progress
                progressContainer.style.display = 'block';
                updateProgress(0, `Processing ${item.file.name}...`);
                await processStructuredFile(item.file, processingType, selectedModel, sessionId);
            } else {
                // Process other files - show loading overlay
                showLoading(selectedModel);
                const formData = new FormData();
                formData.append('file', item.file);
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
                    // For non-structured files, download as text
                    downloadText(result.result, `processed-${Date.now()}.txt`);
                } else {
                    throw new Error(result.error || 'Processing failed');
                }
            }

            // Calculate processing time
            const fileEndTime = Date.now();
            const processingTimeMs = fileEndTime - fileStartTime;
            const processingTimeText = processingTimeMs >= 1000 ?
                `${Math.round(processingTimeMs / 1000)}s` :
                `${processingTimeMs}ms`;

            // Update metadata
            item.processingTime = processingTimeText;
            item.chunks = processingMetrics.totalChunks || 0;
            item.rows = 0; // Would need server response for actual row count

            // Mark as completed
            item.status = 'completed';

        } catch (error) {
            console.error(`Error processing ${item.file.name}:`, error);
            item.status = 'failed';
            // Continue with next file
        }

        // Reset next item status
        if (nextItem) {
            nextItem.status = 'queued';
        }

        updateQueueUI();
        hideLoading();
        progressContainer.style.display = 'none';
    }

    // Batch completed
    isProcessingQueue = false;
    processBtn.disabled = false;
    const finalTextSpan = processBtn.querySelector('.text_button');
    if (finalTextSpan) finalTextSpan.textContent = 'Process with AI';

    // Show batch completion summary
    const batchEndTime = new Date();
    const completedCount = fileQueue.filter(item => item.status === 'completed').length;
    const failedCount = fileQueue.filter(item => item.status === 'failed').length;

    alert(`Batch processing completed!\nCompleted: ${completedCount}\nFailed: ${failedCount}\nDuration: ${Math.round((batchEndTime - batchStartTime) / 1000)}s`);
}

// Processing Queue JS
document.addEventListener('DOMContentLoaded', function() {
  // Update progress bars based on data attributes
  const progressBars = document.querySelectorAll('.progress-bar');
  progressBars.forEach(bar => {
    const progress = bar.getAttribute('data-progress');
    if (progress) {
      bar.style.setProperty('--progress', progress + '%');
      bar.style.width = progress + '%';
    }
  });

  // Add event listeners for Processing Queue buttons
  setupQueueButtonListeners();
});

function setupQueueButtonListeners() {
  // Download buttons
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('download-btn') && !e.target.disabled) {
      handleDownload(e.target);
    }
  });

  // Remove buttons
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('remove-btn')) {
      handleRemove(e.target);
    }
  });

  // Clear All button
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('clear-all-btn')) {
      handleClearAll();
    }
  });
}

function handleDownload(button) {
  // Find the card this button belongs to
  const card = button.closest('.file-card');
  const filename = card.querySelector('.filename').textContent;

  // Create sample processed data based on file type
  let content = '';
  let mimeType = 'text/plain';

  if (filename.endsWith('.xlsx')) {
    content = 'Sample processed Excel data\nRow 1, Column A, Column B\nRow 2, Data 1, Data 2\nRow 3, Data 3, Data 4';
    mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  } else if (filename.endsWith('.csv')) {
    content = 'id,name,value\n1,Sample Data,100\n2,Another Row,200\n3,Final Row,300';
    mimeType = 'text/csv';
  } else {
    content = 'Sample processed text data\nThis is the result of AI processing\nContaining analyzed information and insights';
  }

  // Create and trigger download
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `processed_${filename}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // Visual feedback
  button.textContent = '✅ Downloaded';
  setTimeout(() => {
    button.innerHTML = '⬇️ Download';
  }, 2000);
}

function handleRemove(button) {
  // Find the card this button belongs to
  const card = button.closest('.file-card');

  // Add fade out animation
  card.style.transition = 'opacity 0.3s ease';
  card.style.opacity = '0';

  // Remove after animation
  setTimeout(() => {
    card.remove();
    updateFileCount();
  }, 300);
}

function handleClearAll() {
  const queueGrid = document.querySelector('.queue-grid');
  const cards = queueGrid.querySelectorAll('.file-card');

  if (cards.length === 0) return;

  // Add fade out animation to all cards
  cards.forEach(card => {
    card.style.transition = 'opacity 0.3s ease';
    card.style.opacity = '0';
  });

  // Remove all cards after animation and clear the array
  setTimeout(() => {
    cards.forEach(card => card.remove());
    fileQueue = []; // Clear the fileQueue array
    updateFileCount();
  }, 300);
}



function updateFileCount() {
  const fileCountElement = document.getElementById('fileCount');
  const cards = document.querySelectorAll('.file-card');

  if (cards.length === 0) {
    fileCountElement.textContent = '0 files';
    // Show dropzone when no files
    toggleUIState();
  } else {
    fileCountElement.textContent = `${cards.length} file${cards.length !== 1 ? 's' : ''}`;
  }
}

// Toggle UI state between dropzone and Processing Queue
function toggleUIState() {
  const dropzone = document.getElementById('dropzone');
  const processingQueue = document.getElementById('processingQueue');
  const cards = document.querySelectorAll('.file-card');

  if (cards.length > 0) {
    // Show Processing Queue, hide dropzone
    dropzone.style.display = 'none';
    processingQueue.style.display = 'block';
  } else {
    // Show dropzone, hide Processing Queue
    dropzone.style.display = 'block';
    processingQueue.style.display = 'none';
  }
}

// Add drag and drop to Processing Queue section
function setupQueueDragDrop() {
  const processingQueue = document.getElementById('processingQueue');
  const queueGrid = document.getElementById('queueGrid');

  if (!processingQueue) return;

  // Drag over handler for the queue section
  processingQueue.addEventListener('dragover', function(e) {
    e.preventDefault();
    e.stopPropagation();
    processingQueue.classList.add('drag-over-queue');
  });

  processingQueue.addEventListener('dragleave', function(e) {
    e.preventDefault();
    e.stopPropagation();
    // Only remove class if leaving the queue area entirely
    if (!processingQueue.contains(e.relatedTarget)) {
      processingQueue.classList.remove('drag-over-queue');
    }
  });

  processingQueue.addEventListener('drop', function(e) {
    e.preventDefault();
    e.stopPropagation();
    processingQueue.classList.remove('drag-over-queue');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      Array.from(files).forEach(file => addFileToQueue(file));
      toggleUIState();
      updateQueueUI();
    }
  });
}

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

// Close the IIFE
})();

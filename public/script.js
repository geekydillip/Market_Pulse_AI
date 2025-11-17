// DOM Elements
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const filePreview = document.getElementById('filePreview');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const fileContent = document.getElementById('fileContent');
const removeFile = document.getElementById('removeFile');
const processBtn = document.getElementById('processBtn');
const loadingOverlay = document.getElementById('loadingOverlay');
const customPrompt = document.getElementById('customPrompt');
const customPromptInput = document.getElementById('customPromptInput');
const statusElement = document.getElementById('status');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const modelSelect = document.getElementById('modelSelect');

// State
let currentFile = null;
let currentResult = '';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadModels();
    checkOllamaConnection();
});

function setupEventListeners() {
    // Dropzone events
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', handleDragOver);
    dropzone.addEventListener('dragleave', handleDragLeave);
    dropzone.addEventListener('drop', handleDrop);

    // File input
    fileInput.addEventListener('change', handleFileSelect);
    removeFile.addEventListener('click', clearFile);

    // Processing type change
    document.querySelectorAll('input[name="processingType"]').forEach(radio => {
        radio.addEventListener('change', handleProcessingTypeChange);
    });

    // Model change
    modelSelect.addEventListener('change', handleModelChange);

    // Process button
    processBtn.addEventListener('click', handleProcess);
}



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
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}



function handleProcessingTypeChange(e) {
    if (e.target.value === 'custom') {
        customPrompt.style.display = 'block';
    } else {
        customPrompt.style.display = 'none';
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

async function handleProcess() {
    if (!currentFile) {
        alert('Please upload a file first');
        return;
    }

    // Get processing type and model
    const processingType = document.querySelector('input[name="processingType"]:checked').value;
    const customPromptValue = customPromptInput.value;
    const selectedModel = modelSelect.value;

    // Validate custom prompt
    if (processingType === 'custom' && !customPromptValue.trim()) {
        alert('Please enter a custom prompt');
        return;
    }

    // Generate unique session ID for this processing request
    const sessionId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);

    try {
        if (currentFile.name.endsWith('.xlsx') || currentFile.name.endsWith('.xls') || currentFile.name.endsWith('.json')) {
            // Handle Excel/JSON processing with chunked progress
            progressContainer.style.display = 'block';
            updateProgress(0, 'Initializing...');
            await processStructuredFile(currentFile, processingType, customPromptValue, selectedModel, sessionId);
        } else {
            // Process other files - show loading overlay
            showLoading(selectedModel);
            const formData = new FormData();
            formData.append('file', currentFile);
            formData.append('processingType', processingType);
            formData.append('customPrompt', customPromptValue);
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

    } catch (error) {
        console.error('Processing error:', error);
        alert('Error: ' + error.message + '\n\nMake sure Ollama is running with the selected model.');
    } finally {
        hideLoading();
        progressContainer.style.display = 'none';
    }
}

async function processStructuredFile(file, processingType, customPrompt, model, sessionId) {
    return new Promise(async (resolve, reject) => {
        try {
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
            formData.append('customPrompt', customPrompt);
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

                // Show processing summary
                showProcessingSummary(result.total_processing_time_ms / 1000, result.downloads);
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
}

function hideLoading() {
    loadingOverlay.style.display = 'none';
    processBtn.disabled = false;
}

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
    try {
        const response = await fetch('/api/models');
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
        modelSelect.innerHTML = '<option value="gemma3:4b">gemma3:4b</option>';
    }
}

// Show processing summary
function showProcessingSummary(timeSeconds, downloads) {
    const summary = document.getElementById('processingSummary');
    const timeElement = document.getElementById('processingTime');
    const downloadsElement = document.getElementById('summaryDownloads');

    // Format time
    const timeFormatted = timeSeconds >= 1 ?
        `${timeSeconds.toFixed(2)} seconds` :
        `${Math.round(timeSeconds * 1000)} ms`;

    timeElement.textContent = `Total processing time: ${timeFormatted}`;

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

// --- Additions to script.js (append near other UI handlers) ---

// Tab switching: reuse existing tab-btn behavior
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

    // if visualize tab opened, trigger a load
    if (tab === 'visualize') {
        loadVisualization();
    }
});

// Hook refresh button
const refreshBtn = document.getElementById('refreshVisualization');
if (refreshBtn) refreshBtn.addEventListener('click', loadVisualization);

// Hook CSV export button
const exportBtn = document.getElementById('exportVisualization');
if (exportBtn) exportBtn.addEventListener('click', exportVisualization);

// CSV export function
async function exportVisualization() {
    try {
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
        const filename = `visualize_summary_${timestamp}.csv`;
        downloadFile('/api/visualize/export', filename);
    } catch (error) {
        console.error('Export error:', error);
        alert('Failed to export CSV: ' + error.message);
    }
}

let vizChartInstance = null;

async function loadVisualization() {
    const statusEl = document.getElementById('visualizeStatus');
    const tbody = document.getElementById('vizTableBody');
    const chartEl = document.getElementById('vizChart');

    statusEl.textContent = 'Loading summary...';
    tbody.innerHTML = '';
    if (vizChartInstance) {
        try { vizChartInstance.destroy(); } catch(e) {}
        vizChartInstance = null;
    }

    try {
        const resp = await fetch('/api/visualize');
        const data = await resp.json();
        if (!data.success) {
            statusEl.textContent = 'Failed to load summary: ' + (data.error || 'unknown');
            return;
        }

        const summary = data.summary || [];
        let location = '';
        if (data.chosenDir) {
            location = ` from ${data.chosenDir.split(/[\/\\\\]/).pop()}`;
        }
        statusEl.textContent = `Scanned ${data.filesScanned || 0} file(s)${location}. ${summary.length} rows grouped.`;

        // Fill table - now with 7 columns (added Sub-Module)
        if (summary.length === 0) {
            tbody.innerHTML = '<tr><td colspan=\"7\" style=\"padding:16px; text-align:center; color:var(--text-secondary); border-bottom:1px solid #374151;\">No data found</td></tr>';
        } else {
            tbody.innerHTML = summary.map((row, index) => `
                <tr style="border-bottom:1px solid #374151;">
                    <td style="padding:12px 8px; background:${index % 2 === 0 ? 'transparent' : '#1a1d22'};">${escapeHtml(row.model)}</td>
                    <td style="padding:12px 8px; background:${index % 2 === 0 ? 'transparent' : '#1a1d22'};">${escapeHtml(row.swver)}</td>
                    <td style="padding:12px 8px; background:${index % 2 === 0 ? 'transparent' : '#1a1d22'};">${escapeHtml(row.grade)}</td>
                    <td style="padding:12px 8px; background:${index % 2 === 0 ? 'transparent' : '#1a1d22'};">${escapeHtml(row.critical_module)}</td>
                    <td style="padding:12px 8px; background:${index % 2 === 0 ? 'transparent' : '#1a1d22'};">${escapeHtml(row.sub_module || row.critical_module || 'N/A')}</td>
                    <td style="padding:12px 8px; background:${index % 2 === 0 ? 'transparent' : '#1a1d22'};">${escapeHtml(row.critical_voc)}</td>
                    <td style="padding:12px 8px; text-align:right; background:${index % 2 === 0 ? 'transparent' : '#1a1d22'};"><button class="detail-btn" data-model="${escapeHtml(row.model)}" data-swver="${escapeHtml(row.swver)}" data-grade="${escapeHtml(row.grade)}" data-module="${escapeHtml(row.critical_module)}" data-voc="${escapeHtml(row.critical_voc)}" style="background:none; border:none; color:#3b82f6; text-decoration:underline; cursor:pointer; font-weight:600;">${row.count}</button></td>
                </tr>
            `).join('');
        }

        // Build chart data: top 8 modules by total count
        const moduleCounts = {};
        summary.forEach(r => {
            const key = r.critical_module || '(none)';
            moduleCounts[key] = (moduleCounts[key] || 0) + r.count;
        });
        const moduleEntries = Object.entries(moduleCounts).sort((a,b)=>b[1]-a[1]).slice(0,8);
        const labels = moduleEntries.map(e => e[0]);
        const counts = moduleEntries.map(e => e[1]);

        // Render chart with Chart.js
        if (chartEl && labels.length > 0) {
            const gradient = chartEl.getContext('2d').createLinearGradient(0, 0, 0, 400);
            gradient.addColorStop(0, 'rgba(59, 130, 246, 0.8)');
            gradient.addColorStop(1, 'rgba(30, 41, 59, 0.4)');

            vizChartInstance = new Chart(chartEl.getContext('2d'), {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Issue Count',
                        data: counts,
                        backgroundColor: gradient,
                        borderColor: '#3b82f6',
                        borderWidth: 1,
                        borderRadius: 4,
                        borderSkipped: false
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: {
                            display: true,
                            text: 'Critical Modules Distribution',
                            color: '#cbd5e1',
                            font: { size: 16, weight: 'bold' }
                        },
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(15, 23, 42, 0.9)',
                            titleColor: '#cbd5e1',
                            bodyColor: '#cbd5e1',
                            borderColor: '#374151',
                            borderWidth: 1
                        }
                    },
                    scales: {
                        x: {
                            ticks: { color: '#cbd5e1' },
                            grid: { color: '#374151' },
                            title: { display: true, text: 'Modules', color: '#cbd5e1' }
                        },
                        y: {
                            ticks: { color: '#cbd5e1' },
                            grid: { color: '#374151' },
                            title: { display: true, text: 'Count', color: '#cbd5e1' }
                        }
                    }
                }
            });
        }

    } catch (error) {
        console.error('Visualization load error:', error);
        statusEl.textContent = 'Error loading visualization: ' + (error.message || error);
    }
}

function escapeHtml(text) {
    if (!text && text !== 0) return '';
    return String(text).replaceAll('&', '&').replaceAll('<', '<').replaceAll('>', '>').replaceAll('\"', '"');
}

// Event listener for detail buttons
document.addEventListener('click', e => {
    if (e.target.classList.contains('detail-btn')) {
        const dataset = e.target.dataset;
        showModuleDetails(dataset);
    }
});

async function showModuleDetails(param) {
    const modal = document.getElementById('moduleModal');
    const content = document.getElementById('modalContent');
    const closeBtn = document.getElementById('closeModal');

    const moduleName = param.module;

    const url = new URLSearchParams({
        model: param.model,
        swver: param.swver,
        grade: param.grade,
        module: param.module,
        voc: param.voc
    });

    content.innerHTML = 'Loading details...';
    modal.style.display = 'flex';

    const closeModal = () => modal.style.display = 'none';
    closeBtn.onclick = closeModal;
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    try {
        const resp = await fetch(`/api/module-details?${url.toString()}`);
        const data = await resp.json();
        if (data.success && data.details && data.details.length > 0) {
            // Create download function for this modal
            const downloadTableData = (details) => {
                const headers = ['Case Code', 'Model', 'SW Ver', 'Grade', 'Critical VOC', 'Title', 'Problem', 'Summarized Problem', 'Severity', 'Severity Reason'];
                const csvData = [headers.join(',')];

                details.forEach(d => {
                    const row = [
                        `"${(d.caseCode || '').replace(/"/g, '""')}"`,
                        `"${(d.model || '').replace(/"/g, '""')}"`,
                        `"${(d.swver || '').replace(/"/g, '""')}"`,
                        `"${(d.grade || '').replace(/"/g, '""')}"`,
                        `"${(d.critical_voc || '').replace(/"/g, '""')}"`,
                        `"${(d.title || '').replace(/"/g, '""')}"`,
                        `"${(d.problem || '').replace(/"/g, '""')}"`,
                        `"${(d.summarized_problem || '').replace(/"/g, '""')}"`,
                        `"${(d.severity || '').replace(/"/g, '""')}"`,
                        `"${(d.severity_reason || '').replace(/"/g, '""')}"`
                    ];
                    csvData.push(row.join(','));
                });

                const csvText = csvData.join('\n');
                const blob = new Blob([csvText], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${moduleName}_details_${Date.now()}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            };

            content.innerHTML = `<div style="text-align:center; margin-bottom:20px;"><h1 style="background: var(--accent-gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; margin:0; font-size:28px; font-weight:700;">${escapeHtml(moduleName)} Module Details</h1><p style="color:var(--text-secondary); margin-top:8px;">Detailed breakdown of all related issues for ${escapeHtml(param.model)} ${escapeHtml(param.swver)}</p><button id="downloadTableBtn" class="btn-action" style="margin-top:15px; background: var(--accent-bg); color: var(--text-primary); border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 500;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px; height:16px; margin-right:8px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg> Download CSV</button></div><div style="overflow-x:auto; border:1px solid #374151; border-radius:8px; background: var(--card-bg);"><table style="width:100%; border-collapse:collapse;"><thead><tr style="background: var(--card-hover);"><th style="padding:12px 8px; color:#cbd5e1; font-weight:600; border-bottom:1px solid #374151; width:100px;">Case Code</th><th style="padding:12px 8px; color:#cbd5e1; font-weight:600; border-bottom:1px solid #374151; width:150px;">Model</th><th style="padding:12px 8px; color:#cbd5e1; font-weight:600; border-bottom:1px solid #374151; width:80px;">SW Ver</th><th style="padding:12px 8px; color:#cbd5e1; font-weight:600; border-bottom:1px solid #374151; width:80px;">Grade</th><th style="padding:12px 8px; color:#cbd5e1; font-weight:600; border-bottom:1px solid #374151; width:250px;">Title</th><th style="padding:12px 8px; color:#cbd5e1; font-weight:600; border-bottom:1px solid #374151; width:250px;">Problem</th><th style="padding:12px 8px; color:#cbd5e1; font-weight:600; border-bottom:1px solid #374151; width:250px;">Summarized</th><th style="padding:12px 8px; color:#cbd5e1; font-weight:600; border-bottom:1px solid #374151; width:80px;">Severity</th><th style="padding:12px 8px; color:#cbd5e1; font-weight:600; border-bottom:1px solid #374151; width:250px;">Severity Reason</th></tr></thead><tbody>${data.details.map((d, idx) => `<tr style="border-bottom:1px solid #374151;"><td style="padding:10px 8px; background:${idx % 2 === 0 ? 'rgba(107,114,128,0.1)' : 'transparent'}; font-weight:500; word-wrap:break-word;">${escapeHtml(d.caseCode)}</td><td style="padding:10px 8px; background:${idx % 2 === 0 ? 'rgba(107,114,128,0.1)' : 'transparent'}; word-wrap:break-word;">${escapeHtml(d.model)}</td><td style="padding:10px 8px; background:${idx % 2 === 0 ? 'rgba(107,114,128,0.1)' : 'transparent'}; word-wrap:break-word;">${escapeHtml(d.swver)}</td><td style="padding:10px 8px; background:${idx % 2 === 0 ? 'rgba(107,114,128,0.1)' : 'transparent'}; word-wrap:break-word;">${escapeHtml(d.grade)}</td><td style="padding:10px 8px; background:${idx % 2 === 0 ? 'rgba(107,114,128,0.1)' : 'transparent'}; word-wrap:break-word;">${escapeHtml(d.title)}</td><td style="padding:10px 8px; background:${idx % 2 === 0 ? 'rgba(107,114,128,0.1)' : 'transparent'}; word-wrap:break-word;">${escapeHtml(d.problem)}</td><td style="padding:10px 8px; background:${idx % 2 === 0 ? 'rgba(107,114,128,0.1)' : 'transparent'}; word-wrap:break-word;">${escapeHtml(d.summarized_problem)}</td><td style="padding:10px 8px; background:${idx % 2 === 0 ? 'rgba(107,114,128,0.1)' : 'transparent'}; word-wrap:break-word;">${escapeHtml(d.severity)}</td><td style="padding:10px 8px; background:${idx % 2 === 0 ? 'rgba(107,114,128,0.1)' : 'transparent'}; word-wrap:break-word;">${escapeHtml(d.severity_reason)}</td></tr>`).join('')}</tbody></table></div>`;

            // Add event listener for download button
            const downloadBtn = content.querySelector('#downloadTableBtn');
            if (downloadBtn) {
                downloadBtn.addEventListener('click', () => downloadTableData(data.details));
            }
        } else {
            content.innerHTML = `<h3 style="color:#cbd5e1; text-align:center;">Details for Module: ${escapeHtml(moduleName)}</h3><p style="color:var(--text-secondary); text-align:center;">No details found.</p>`;
        }
    } catch (error) {
        content.innerHTML = '<h3 style="color:#cbd5e1; text-align:center;">Error</h3><p style="color:#ef4444; text-align:center;">Error loading details: ' + error.message + '</p>';
    }
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

/*
  Dashboard with Pagination - Individual Cases View
*/
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Network ${r.status} ${r.statusText} ${text}`);
  }
  return r.json();
}

// Global state
let severityChart = null;
let moduleChart = null;
let currentTheme = 'dark';

// Get dashboard category from body data attribute
const dashboardCategory = document.body.dataset.category;

// Model search variables
let allModels = [];
let searchTimeout = null;
let suggestionsContainer = null;
let selectedSuggestionIndex = -1;

// Focus management variables
let previousFocusElement = null;

// Filter state management - centralized source of truth
let currentFilters = {
  model: null,
  severity: null
};

// Pagination state
let paginationState = {
  page: 1,
  pageSize: 10,
  totalRows: 0,
  totalPages: 1,
  loading: false
};

// Current dashboard data storage for consistent exports
let currentDashboardData = {
  rows: [], // Raw individual case data for exports
  aggregatedData: [] // Aggregated modules for pagination
};

// Unified filter setter - ensures consistent behavior across all filter operations
function updateFilters(newFilters) {
  // Merge new filters with existing ones
  const oldFilters = { ...currentFilters };
  currentFilters = { ...currentFilters, ...newFilters };

  // Reset to page 1 when filters change
  paginationState.page = 1;
  updateURL();

  // Refresh dashboard overview with new filters
  refreshDashboardOverview();

  // Update filter indicators
  updateModelIndicator();
  updatePaginationControls();
}

// Update URL with current page
function updateURL() {
  const url = new URL(window.location);
  if (paginationState.page > 1) {
    url.searchParams.set('page', paginationState.page);
  } else {
    url.searchParams.delete('page');
  }

  // Use replaceState to avoid creating history entries
  window.history.replaceState(null, '', url);
}

// Read page from URL on load
function readPageFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  const pageParam = urlParams.get('page');
  if (pageParam) {
    const page = parseInt(pageParam, 10);
    if (page > 0) {
      paginationState.page = page;
    }
  }
}

// Update model indicator in UI
function updateModelIndicator() {
  const modelIndicator = document.getElementById('currentModelIndicator');
  const modelNameElement = document.getElementById('currentModelName');

  if (currentFilters.model && modelNameElement) {
    if (modelIndicator) modelIndicator.style.display = 'inline';
    modelNameElement.textContent = currentFilters.model;
  } else {
    if (modelIndicator) modelIndicator.style.display = 'none';
  }
}

// Refresh dashboard overview data (charts and KPIs)
async function refreshDashboardOverview() {
  try {
    let url = '/api/dashboard';
    const params = [];
    if (dashboardCategory) params.push(`category=${encodeURIComponent(dashboardCategory)}`);
    if (currentFilters.model) params.push(`model=${encodeURIComponent(currentFilters.model)}`);
    if (currentFilters.severity) params.push(`severity=${encodeURIComponent(currentFilters.severity)}`);
    if (params.length > 0) url += '?' + params.join('&');

    const resp = await fetchJSON(url);

    if (!resp || resp.success === false) {
      throw new Error(resp && resp.error ? resp.error : 'dashboard error');
    }

    // Update totals
    const totals = resp.totals || { totalCases: 0, critical: 0, high: 0, medium: 0, low: 0 };
    document.getElementById('dashTotal').textContent = totals.totalCases || 0;
    document.getElementById('dashHigh').textContent = totals.high || 0;
    document.getElementById('dashDistinct').textContent = (resp.moduleDistribution && resp.moduleDistribution.length) || 0;

    // Cache raw data for exports
    currentDashboardData.rows = resp.rows || [];

    // Aggregate data and update pagination total
    currentDashboardData.aggregatedData = aggregateByModule(resp.rows || []);
    paginationState.totalRows = currentDashboardData.aggregatedData.length;
    paginationState.totalPages = Math.ceil(paginationState.totalRows / paginationState.pageSize);

    // Update charts
    renderCharts(resp.severityDistribution || [], resp.moduleDistribution || []);

    document.getElementById('moduleCount').textContent = `${currentDashboardData.aggregatedData.length} modules`;

    // Render paginated table
    renderTable();
  } catch (err) {
    console.error('refreshDashboardOverview error', err);
    alert('Failed to refresh dashboard: ' + (err.message || err));
  }
}

// Refresh cases page with pagination
async function refreshCasesPage() {
  if (paginationState.loading) return;

  try {
    paginationState.loading = true;

    // Show loading skeleton
    renderLoadingTable();

    let url = '/api/cases';
    const params = [];
    if (currentFilters.model) params.push(`model=${encodeURIComponent(currentFilters.model)}`);
    if (currentFilters.severity) params.push(`severity=${encodeURIComponent(currentFilters.severity)}`);
    params.push(`page=${paginationState.page}`);
    params.push(`limit=${paginationState.pageSize}`);
    url += '?' + params.join('&');

    const resp = await fetchJSON(url);

    if (!resp || resp.success === false) {
      throw new Error(resp && resp.error ? resp.error : 'cases error');
    }

    // Update pagination state
    paginationState.totalRows = resp.total || 0;
    paginationState.totalPages = resp.totalPages || 1;

    // Cache current page data
    currentDashboardData.currentPageRows = resp.rows || [];

    // Render cases table
    renderCasesTable(resp.rows || []);

    // Update UI
    updatePaginationControls();

  } catch (err) {
    console.error('refreshCasesPage error', err);
    alert('Failed to load cases: ' + (err.message || err));
  } finally {
    paginationState.loading = false;
  }
}

// Pagination control functions
function goToPage(page) {
  paginationState.page = Math.max(1, Math.min(page, paginationState.totalPages));
  updateURL();
  renderTable();
}

function prevPage() {
  if (paginationState.page > 1) {
    goToPage(paginationState.page - 1);
  }
}

function nextPage() {
  if (paginationState.page < paginationState.totalPages) {
    goToPage(paginationState.page + 1);
  }
}

function firstPage() {
  goToPage(1);
}

function lastPage() {
  goToPage(paginationState.totalPages);
}

function goToPageFromInput() {
  const pageInput = document.getElementById('pageInput');
  const page = parseInt(pageInput.value, 10);
  if (!isNaN(page)) {
    goToPage(page);
  }
}

function changePageSize() {
  const select = document.getElementById('pageSizeSelect');
  const newSize = parseInt(select.value, 10);
  if (newSize !== paginationState.pageSize) {
    paginationState.pageSize = newSize;
    paginationState.page = 1;
    updateURL();
    renderTable();
  }
}

// Update pagination controls state
function updatePaginationControls() {
  const firstBtn = document.getElementById('firstPageBtn');
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');
  const lastBtn = document.getElementById('lastPageBtn');
  const pageInput = document.getElementById('pageInput');
  const totalPages = document.getElementById('totalPages');

  if (firstBtn) firstBtn.disabled = paginationState.page <= 1;
  if (prevBtn) prevBtn.disabled = paginationState.page <= 1;
  if (nextBtn) nextBtn.disabled = paginationState.page >= paginationState.totalPages;
  if (lastBtn) lastBtn.disabled = paginationState.page >= paginationState.totalPages;

  if (pageInput) {
    pageInput.value = paginationState.page;
    pageInput.max = paginationState.totalPages;
  }

  if (totalPages) totalPages.textContent = paginationState.totalPages;
}

// Keyboard shortcuts for pagination
document.addEventListener('keydown', (e) => {
  // Only handle if not in input field or modal
  if (e.target.tagName.toLowerCase() === 'input' || e.target.tagName.toLowerCase() === 'textarea') {
    return;
  }

  // If modal is open, don't handle pagination shortcuts
  if (document.getElementById('issues-modal').style.display === 'flex') {
    return;
  }

  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault();
      prevPage();
      break;
    case 'ArrowRight':
      e.preventDefault();
      nextPage();
      break;
  }
});

// Export current page (current page of modules)
function exportCurrentPage() {
  setTimeout(() => {
    try {
      // Get current page modules - calculate the slice
      const startIndex = (paginationState.page - 1) * paginationState.pageSize;
      const endIndex = Math.min(startIndex + paginationState.pageSize, currentDashboardData.aggregatedData.length);
      const pageModules = currentDashboardData.aggregatedData.slice(startIndex, endIndex);

      if (pageModules.length === 0) {
        alert('No data available to export.');
        return;
      }

      const now = new Date();
      const timestamp = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}`;
      const model = currentFilters.model ? currentFilters.model.replace(/[^a-zA-Z0-9]/g, '_') : 'All_Models';
      const severity = currentFilters.severity ? currentFilters.severity : 'All_Severities';
      const fileName = `dashboard_modules_${model}_${severity}_page_${paginationState.page}_${timestamp}.xlsx`;

      exportToExcel(pageModules, fileName);
    } catch (error) {
      console.error('Export error:', error);
      alert('Export failed. Please try again.');
    }
  }, 100);
}



// Refresh dashboard components with current filters
async function refreshDashboard() {
  try {
    // Build URL with current filters
    let url = '/api/dashboard';
    const params = [];
    if (currentFilters.model) params.push(`model=${encodeURIComponent(currentFilters.model)}`);
    if (currentFilters.severity) params.push(`severity=${encodeURIComponent(currentFilters.severity)}`);
    if (params.length > 0) url += '?' + params.join('&');

    const resp = await fetchJSON(url);

    if (!resp || resp.success === false) {
      throw new Error(resp && resp.error ? resp.error : 'dashboard error');
    }

    // Update model indicator
    const modelIndicator = document.getElementById('currentModelIndicator');
    const modelNameElement = document.getElementById('currentModelName');

    if (currentFilters.model && modelNameElement) {
      if (modelIndicator) modelIndicator.style.display = 'inline';
      modelNameElement.textContent = currentFilters.model;
    } else {
      if (modelIndicator) modelIndicator.style.display = 'none';
    }

    // Update totals
    const totals = resp.totals || { totalCases: 0, critical: 0, high: 0, medium: 0, low: 0 };
    document.getElementById('dashTotal').textContent = totals.totalCases || 0;
    document.getElementById('dashHigh').textContent = totals.high || 0;
    document.getElementById('dashDistinct').textContent = (resp.moduleDistribution && resp.moduleDistribution.length) || 0;

    // Aggregate data by module (store for later use)
    const aggregatedData = aggregateByModule(resp.rows || []);

    document.getElementById('moduleCount').textContent = `${aggregatedData.length} modules`;

    // Cache current data for consistent exports
    currentDashboardData = {
      rows: resp.rows || [],
      aggregatedData: aggregatedData
    };

    // Update charts
    renderCharts(resp.severityDistribution || [], resp.moduleDistribution || []);

    // Update table
    renderTable(aggregatedData);

  } catch (err) {
    console.error('refreshDashboard error', err);
    alert('Failed to refresh dashboard: ' + (err.message || err));
  }
}

// Refresh table (alias for consistency)
function refreshTable() {
  renderTable();
}

// Disable Chart.js animations globally
Chart.defaults.animation.duration = 0;
Chart.defaults.animation.delay = 0;
Chart.defaults.responsiveAnimationDuration = 0;



// Theme Management
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  setTheme(savedTheme);
  updateThemeToggleIcon();

  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
}

function setTheme(theme) {
  currentTheme = theme;
  document.body.className = `theme-${theme}`;
  localStorage.setItem('theme', theme);
  updateThemeToggleIcon();
}

function toggleTheme() {
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);

  // Re-render charts with new theme colors
  if (severityChart || moduleChart) {
    // Charts will re-render on next data load, but we can force update if needed
    setTimeout(() => {
      // Force re-render of existing charts if they exist
      if (severityChart) severityChart.update();
      if (moduleChart) moduleChart.update();
    }, 100);
  }
}

function updateThemeToggleIcon() {
    const icon = document.querySelector('#themeToggle svg');
    if (currentTheme === 'light') {
        icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    } else {
        icon.innerHTML = '<circle cx="12" cy="12" r="5"/><path d="m12 1v2m0 18v2M4.93 4.93l1.41 1.41m11.32 0l1.41 -1.41M1 12h2m18 0h2M4.93 19.07l1.41 -1.41m11.32 0l1.41 1.41"/>';
    }
}

// Safe helpers for optional elements
function updateProgress(percent, text, timerInterval) {
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const progressContainer = document.getElementById('progressContainer');
    if (progressFill) progressFill.style.width = percent + '%';
    if (progressText && !timerInterval) progressText.textContent = text;
    if (progressContainer) progressContainer.style.display = 'block';
}

function initializeProgressState() {
    const progressFill = document.getElementById('progressFill');
    const progressContainer = document.getElementById('progressContainer');
    if (progressFill) progressFill.style.width = '0%';
    if (progressContainer) progressContainer.style.display = 'none';
}

function showLoading(model) {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        loadingOverlay.style.display = 'flex';
        const loadingText = loadingOverlay.querySelector('p');
        if (loadingText) loadingText.textContent = `Processing with ${model}...`;
    }
    const processBtn = document.getElementById('processBtn');
    if (processBtn) processBtn.disabled = true;
}

function hideLoading() {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) loadingOverlay.style.display = 'none';
    const processBtn = document.getElementById('processBtn');
    if (processBtn) processBtn.disabled = false;
}

// Safe escape
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/\"/g, '"')
    .replace(/'/g, '&#39;');
}

// --- Utility: normalized lookup for field names from Excel row ---
function getField(row, names) {
  for (const n of names) {
    if (Object.prototype.hasOwnProperty.call(row, n) && row[n] != null) return String(row[n]).trim();
  }
  return '';
}

// --- Aggregate rows by key name ---
function aggregate(rows, keyNames) {
  const counts = Object.create(null);
  for (const row of rows) {
    const key = getField(row, keyNames) || 'Unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts; // { "ModuleA": 12, "ModuleB": 3, ... }
}

// Donut (Severity) — remove "Critical"
function buildSeverityDonutData(rows) {
  // possible column names to try:
  const severityCounts = aggregate(rows, ['severity', 'Severity', 'SEVERITY', 'Severity Level', 'level']);

  // remove 'critical' entries (case-insensitive)
  for (const k of Object.keys(severityCounts)) {
    if (/^\s*critical\s*$/i.test(k)) {
      delete severityCounts[k];
    }
  }

  const labels = Object.keys(severityCounts);
  const data = labels.map(l => severityCounts[l]);

  // Optional: If you want a fixed order (High, Medium, Low) -- reorder:
  const order = ['Critical','High','Medium','Low'];
  const orderedLabels = [];
  const orderedData = [];
  for (const o of order) {
    for (let i = 0; i < labels.length; i++) {
      if (labels[i].toLowerCase() === o.toLowerCase() && severityCounts[labels[i]] != null) {
        orderedLabels.push(labels[i]);
        orderedData.push(severityCounts[labels[i]]);
      }
    }
  }
  // append remaining labels not in order:
  for (let i = 0; i < labels.length; i++) {
    if (!orderedLabels.includes(labels[i])) {
      orderedLabels.push(labels[i]);
      orderedData.push(severityCounts[labels[i]]);
    }
  }

  return { labels: orderedLabels, data: orderedData };
}

// Module distribution — remove "Others" and keep top 10
function buildTopModulesData(rows, topN = 10) {
  // try common column names for module
  const moduleCounts = aggregate(rows, ['module', 'Module', 'MODULE', 'Module Name', 'Sub-Module']);

  // remove explicit "Others" entries (case-insensitive)
  for (const k of Object.keys(moduleCounts)) {
    if (/^\s*others?\s*$/i.test(k)) {
      delete moduleCounts[k];
    }
  }

  // convert to array and sort descending by count
  const arr = Object.entries(moduleCounts)
    .map(([k, v]) => ({ module: k, count: v }))
    .sort((a, b) => b.count - a.count);

  // keep only topN
  const top = arr.slice(0, topN);

  const labels = top.map(x => x.module);
  const data = top.map(x => x.count);

  return { labels, data };
}

// Combined function to rebuild both charts (optional convenience function)
function rebuildCharts(rows) {
  // severity donut
  const severity = buildSeverityDonutData(rows);
  if (severityChart) {
    severityChart.data.labels = severity.labels;
    severityChart.data.datasets[0].data = severity.data;
    severityChart.update();
  }

  // modules top 10
  const modules = buildTopModulesData(rows, 10);
  if (moduleChart) {
    moduleChart.data.labels = modules.labels;
    moduleChart.data.datasets[0].data = modules.data;
    moduleChart.update();
  }
}

// Copy to clipboard utility
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    // Simple visual feedback - could be enhanced with toast notifications
    console.log('Copied to clipboard:', text);
  } catch (err) {
    console.error('Failed to copy:', err);
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      console.log('Copied to clipboard (fallback):', text);
    } catch (fallbackErr) {
      console.error('Fallback copy failed:', fallbackErr);
    }
    document.body.removeChild(textArea);
  }
}

// Enhanced Charts with Professional Styling
function renderCharts(severityDistribution, moduleDistribution) {
  // Use raw rows data to build custom charts
  const rows = currentDashboardData.rows || [];

  // Build severity donut data (removes Critical)
  const severityPayload = buildSeverityDonutData(rows);
  const sevLabels = severityPayload.labels;
  const sevCounts = severityPayload.data;

  // Build top 10 modules data (removes Others, keeps top 10)
  const modulesPayload = buildTopModulesData(rows, 10);
  const modLabels = modulesPayload.labels;
  const modCounts = modulesPayload.data;

  // Use CSS custom properties for chart colors
  const computedStyle = getComputedStyle(document.body);
  const chartCriticalStart = computedStyle.getPropertyValue('--chart-critical-start').trim();
  const chartCriticalEnd = computedStyle.getPropertyValue('--chart-critical-end').trim();
  const chartHighStart = computedStyle.getPropertyValue('--chart-high-start').trim();
  const chartHighEnd = computedStyle.getPropertyValue('--chart-high-end').trim();
  const chartMiddleStart = computedStyle.getPropertyValue('--chart-middle-start').trim();
  const chartMiddleEnd = computedStyle.getPropertyValue('--chart-middle-end').trim();
  const chartLowStart = computedStyle.getPropertyValue('--chart-low-start').trim();
  const chartLowEnd = computedStyle.getPropertyValue('--chart-low-end').trim();

  const severityColors = {
    'Low': [chartLowStart, chartLowEnd],
    'Medium': [chartMiddleStart, chartMiddleEnd],
    'High': [chartHighStart, chartHighEnd],
  };

  // Assign colors based on labels
  const backgroundColors = sevLabels.map(label => severityColors[label] ? severityColors[label][0] : 'rgba(150, 150, 150, 0.8)');
  const borderColors = sevLabels.map(label => severityColors[label] ? severityColors[label][1] : 'rgba(120, 120, 120, 1)');

  const sevEl = document.getElementById('severityChart');
  const modEl = document.getElementById('moduleChart');

    if (sevEl) {
    // Add chart accessibility
    sevEl.setAttribute('role', 'img');
    sevEl.setAttribute('tabindex', '0');
    sevEl.setAttribute('aria-label', 'Severity distribution chart showing breakdown by criticality levels');

    // Update summary for screen readers
    const totalIssues = sevCounts.reduce((sum, count) => sum + count, 0);
    const severitySummary = sevLabels.map((label, idx) =>
      `${label}: ${sevCounts[idx]} issues (${Math.round((sevCounts[idx]/totalIssues)*100)}%)`
    ).join(', ');
    sevEl.setAttribute('aria-description', `Total issues: ${totalIssues}. ${severitySummary}.`);

    // Add keyboard interaction
    sevEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const meta = severityChart.getDatasetMeta(0);
        meta.data.forEach((element, index) => {
          element.hidden = !element.hidden;
          severityChart.update();
        });
      }
    });

    const sevCtx = sevEl.getContext('2d');
    if (severityChart) severityChart.destroy();
    severityChart = new Chart(sevCtx, {
      type: 'doughnut',
      data: {
        labels: sevLabels,
        datasets: [{
          data: sevCounts,
          backgroundColor: backgroundColors,
          borderColor: borderColors,
          borderWidth: 2,
          hoverBorderWidth: 3,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              padding: 20,
              font: {
                size: 13,
                weight: '500'
              },
              usePointStyle: true,
              pointStyle: 'circle'
            },
            onClick: function(e, legendItem) {
              const index = legendItem.index;
              const ci = severityChart;
              const meta = ci.getDatasetMeta(0);
              meta.data[index].hidden = !meta.data[index].hidden;
              ci.update();
            },
            onHover: function(e, legendItem) {
              e.target.style.cursor = 'pointer';
            },
            onLeave: function(e, legendItem) {
              e.target.style.cursor = 'default';
            }
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: '#fff',
            bodyColor: '#fff',
            borderColor: 'rgba(255, 255, 255, 0.3)',
            borderWidth: 1,
            cornerRadius: 8,
            displayColors: true,
            callbacks: {
              label: function(context) {
                const label = context.label || '';
                const value = context.parsed;
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const percentage = Math.round((value / total) * 100);
                return `${label}: ${value} (${percentage}%)`;
              }
            }
          }
        },
        animation: {
          animateScale: false,
          animateRotate: false,
          duration: 0
        },
        cutout: '40%', // Smaller center hole for better data visibility
        elements: {
          arc: {
            borderRadius: 4 // Rounded chart segments
          }
        }
      }
    });
  }

  if (modEl) {
    // Add chart accessibility
    modEl.setAttribute('role', 'img');
    modEl.setAttribute('tabindex', '0');
    modEl.setAttribute('aria-label', 'Top module issues distribution');

    // Create textual summary
    const topModulesText = modLabels.slice(0, 5).map((module, idx) =>
      `${module}: ${modCounts[idx]} issues`
    ).join(', ');
    modEl.setAttribute('aria-description', `Top modules by issue count: ${topModulesText}${modLabels.length > 5 ? ', and others' : ''}.`);

    // Add keyboard interaction
    modEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const meta = moduleChart.getDatasetMeta(0);
        meta.data.forEach((element, index) => {
          element.hidden = !element.hidden;
          moduleChart.update();
        });
      }
    });

    const modCtx = modEl.getContext('2d');
    if (moduleChart) moduleChart.destroy();
    moduleChart = new Chart(modCtx, {
      type: 'bar',
      data: {
        labels: modLabels,
        datasets: [{
          label: 'Issue Count',
          data: modCounts,
          backgroundColor: modLabels.map((_, i) => `hsl(${(i * 137.5) % 360}, 70%, 60%)`), // Varied colors
          borderColor: modLabels.map((_, i) => `hsl(${(i * 137.5) % 360}, 80%, 50%)`),
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false,
          maxBarThickness: 30,
          barThickness: 25,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: {
            top: 10,
            right: 20,
            bottom: 10,
            left: 10
          }
        },
        plugins: {
          legend: {
            display: false // Hide legend for cleaner look
          },
            tooltip: {
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              titleColor: '#fff',
              bodyColor: '#fff',
              borderColor: 'rgba(255, 255, 255, 0.3)',
              borderWidth: 1,
              cornerRadius: 8,
              callbacks: {
                title: function(context) {
                  return `Module: ${context[0].label}`;
                },
                label: function(context) {
                  const value = context.parsed.x;
                  const total = context.dataset.data.reduce((a, b) => a + b, 0);
                  const percentage = Math.round((value / total) * 100);
                  return `Issues: ${value} (${percentage}%)`;
                }
              }
            }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              precision: 0,
              color: currentTheme === 'dark' ? '#bbb' : '#64748b',
              font: {
                size: 11
              }
            },
            grid: {
              color: currentTheme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
              drawBorder: false
            },
            title: {
              display: true,
              text: 'Number of Issues',
              color: currentTheme === 'dark' ? '#bbb' : '#64748b',
              font: {
                size: 12,
                weight: '600'
              }
            }
          },
          y: {
            ticks: {
              color: currentTheme === 'dark' ? '#bbb' : '#64748b',
              font: {
                size: 11
              },
              callback: function(value, index) {
                const label = this.getLabelForValue(index);
                return label.length > 15 ? label.substring(0, 15) + '...' : label;
              }
            },
            grid: {
              color: currentTheme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
              drawBorder: false
            }
          }
        },
        elements: {
          bar: {
            borderRadius: 4
          }
        },
        animation: {
          duration: 0
        }
      }
    });
  }
}

// Aggregate data by module
function aggregateByModule(rows) {
  const moduleMap = new Map();

  rows.forEach(row => {
    const module = row.module || 'Unknown';
    const modelNo = row.modelFromFile || 'Unknown';

    if (!moduleMap.has(module)) {
      moduleMap.set(module, {
        module: module,
        models: new Set(), // Track all unique models
        count: 0,
        rows: [],
        titleCount: new Map()
      });
    }

    const moduleData = moduleMap.get(module);
    moduleData.count++;
    moduleData.rows.push(row);
    moduleData.models.add(modelNo); // Add model to the set

    // Count title frequencies
    const title = (row.title || '').toLowerCase().trim();
    if (title) {
      moduleData.titleCount.set(title, (moduleData.titleCount.get(title) || 0) + 1);
    }
  });

  // Convert to array and find top title for each module
  return Array.from(moduleMap.values()).map(moduleData => {
    // Find most frequent title
    let topTitle = 'N/A';
    let maxCount = 0;
    for (const [title, count] of moduleData.titleCount.entries()) {
      if (count > maxCount) {
        maxCount = count;
        topTitle = title;
      }
    }

    // Determine model display text
    const modelsArray = Array.from(moduleData.models).sort();
    let modelDisplay;
    if (modelsArray.length === 1) {
      modelDisplay = modelsArray[0];
    } else if (modelsArray.length === 2) {
      modelDisplay = modelsArray.join(', ');
    } else if (modelsArray.length > 2) {
      modelDisplay = `${modelsArray[0]}, ${modelsArray[1]}, +${modelsArray.length - 2} more`;
    } else {
      modelDisplay = 'Unknown';
    }

    return {
      ...moduleData,
      modelNo: modelDisplay, // For backward compatibility with table rendering
      models: modelsArray,   // Keep full list for future use
      topIssueTitle: topTitle.charAt(0).toUpperCase() + topTitle.slice(1)
    };
  }).sort((a, b) => b.count - a.count);
}

// Render aggregated table with pagination
function renderTable() {
  const tbody = document.querySelector('#dataTable tbody');
  tbody.innerHTML = '';

  // Calculate paginated slice
  const startIndex = (paginationState.page - 1) * paginationState.pageSize;
  const endIndex = Math.min(startIndex + paginationState.pageSize, currentDashboardData.aggregatedData.length);
  const pageData = currentDashboardData.aggregatedData.slice(startIndex, endIndex);

  pageData.forEach((moduleData, index) => {
    const globalIndex = startIndex + index + 1;
    const tr = document.createElement('tr');

    // Enhanced text truncation with better handling
    const truncatedTitle = moduleData.topIssueTitle.length > 50
      ? moduleData.topIssueTitle.substring(0, 50) + '...'
      : moduleData.topIssueTitle;

    const truncatedModel = moduleData.modelNo.length > 25
      ? moduleData.modelNo.substring(0, 25) + '...'
      : moduleData.modelNo;

    tr.innerHTML = `
      <td>${globalIndex}</td>
      <td title="${escapeHtml(moduleData.modelNo)}">${escapeHtml(truncatedModel)}</td>
      <td><button class="module-name-link" data-module="${escapeHtml(moduleData.module)}" data-count="${moduleData.count}">${escapeHtml(moduleData.module)}</button></td>
      <td title="${escapeHtml(moduleData.topIssueTitle)}">${escapeHtml(truncatedTitle)}</td>
      <td>${moduleData.count}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('tableCount').textContent = `${currentDashboardData.aggregatedData.length} modules`;

  // Attach click handlers to module name buttons
  document.querySelectorAll('.module-name-link').forEach(button => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      const module = button.dataset.module;
      const count = parseInt(button.dataset.count);
      showModuleDetails(module, currentDashboardData.aggregatedData.find(m => m.module === module));
    });
  });
}

// Model search functions
// Model search functions
function setupModelSearch(models) {
  allModels = models;

  // Get container reference
  const container = document.getElementById('modelButtons');

  // Create search input
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.id = 'modelSearchInput';
  searchInput.className = 'model-search-input';
  searchInput.placeholder = 'Search models...';
  searchInput.autocomplete = 'off';
  container.appendChild(searchInput);

  // Create suggestions container with ARIA attributes
  suggestionsContainer = document.createElement('div');
  suggestionsContainer.id = 'searchSuggestions';
  suggestionsContainer.className = 'search-suggestions';
  suggestionsContainer.setAttribute('role', 'listbox');
  suggestionsContainer.setAttribute('aria-label', 'Model suggestions');
  container.appendChild(suggestionsContainer);

  // Event listeners
  searchInput.addEventListener('input', handleSearchInput);
  searchInput.addEventListener('keydown', handleSearchKeydown);
  searchInput.addEventListener('focus', () => showSuggestions([]));
  searchInput.addEventListener('blur', () => setTimeout(hideSuggestions, 150));

  // Click outside to hide suggestions
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !suggestionsContainer.contains(e.target)) {
      hideSuggestions();
    }
  });
}

function handleSearchInput(e) {
  const query = e.target.value.trim();
  clearTimeout(searchTimeout);

  selectedSuggestionIndex = -1;

  if (query.length >= 2) {
    searchTimeout = setTimeout(() => {
      const filteredModels = allModels.filter(model =>
        model.toLowerCase().includes(query.toLowerCase())
      );
      showSuggestions(filteredModels);
    }, 300); // 300ms debounce
  } else {
    hideSuggestions();
  }
}

function handleSearchKeydown(e) {
  if (!suggestionsContainer || suggestionsContainer.style.display === 'none') return;

  const suggestions = suggestionsContainer.querySelectorAll('.search-suggestion');
  const maxIndex = suggestions.length - 1;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      selectedSuggestionIndex = (selectedSuggestionIndex + 1) % (maxIndex + 1);
      updateSuggestionSelection(suggestions);
      break;
    case 'ArrowUp':
      e.preventDefault();
      selectedSuggestionIndex = selectedSuggestionIndex <= 0 ? maxIndex : selectedSuggestionIndex - 1;
      updateSuggestionSelection(suggestions);
      break;
    case 'Enter':
      e.preventDefault();
      if (selectedSuggestionIndex >= 0 && selectedSuggestionIndex <= maxIndex) {
        selectSuggestion(suggestions[selectedSuggestionIndex].textContent);
      }
      break;
    case 'Escape':
      hideSuggestions();
      document.getElementById('modelSearchInput').blur();
      break;
  }
}

function showSuggestions(suggestions) {
  if (!suggestionsContainer) return;

  suggestionsContainer.innerHTML = '';
  suggestionsContainer.style.display = 'block';

  if (suggestions.length === 0) {
    suggestionsContainer.innerHTML = '<div class="no-suggestions">No models found</div>';
    return;
  }

  suggestions.forEach((model, index) => {
    const suggestionEl = document.createElement('div');
    suggestionEl.className = 'search-suggestion';
    suggestionEl.textContent = model;
    suggestionEl.setAttribute('role', 'option');
    suggestionEl.setAttribute('aria-selected', 'false');
    suggestionEl.onclick = () => selectSuggestion(model);
    suggestionEl.onmouseover = () => {
      selectedSuggestionIndex = index;
      updateSuggestionSelection(suggestionsContainer.querySelectorAll('.search-suggestion'));
    };
    suggestionsContainer.appendChild(suggestionEl);
  });
}

function hideSuggestions() {
  if (suggestionsContainer) {
    suggestionsContainer.style.display = 'none';
  }
  selectedSuggestionIndex = -1;
}

function updateSuggestionSelection(suggestions) {
  suggestions.forEach((suggestion, index) => {
    suggestion.classList.toggle('selected', index === selectedSuggestionIndex);
    suggestion.setAttribute('aria-selected', selectedSuggestionIndex === index ? 'true' : 'false');
  });
}

function selectSuggestion(model) {
  // Update filters using centralized filter management
  updateFilters({ model: model });
  // Clear search input and hide suggestions
  const searchInput = document.getElementById('modelSearchInput');
  searchInput.value = '';
  hideSuggestions();
  searchInput.blur();
}

async function loadModels() {
  try {
    const resp = await fetchJSON('/api/models?category=' + encodeURIComponent(dashboardCategory));
    const container = document.getElementById('modelButtons');
    container.innerHTML = '';

    // Add 'All Models' as the first chip
    const allBtn = document.createElement('button');
    allBtn.className = 'all-models';
    allBtn.textContent = 'All Models';
    allBtn.onclick = () => loadDashboard(null, allBtn); // Keep original for complete initial setup
    container.appendChild(allBtn);

    // Fetch models for search functionality, but don't display individual buttons
    if (resp && Array.isArray(resp.models)) {
      // Setup model search after models are loaded
      setupModelSearch(resp.models);
    }

    // auto-click 'All Models' by default (aggregated)
    allBtn.click();
  } catch (err) {
    console.error('loadModels error', err);
    alert('Failed to load models: ' + (err.message || err));
  }
}

async function loadDashboard(model, btn, severity = null) {
  // Update filters and delegate to refreshDashboardOverview for consistent behavior
  updateFilters({ model: model, severity: severity });
}

// Handle High severity filter toggle
function toggleHighSeverityFilter() {
  const card = document.getElementById('highFilterCard');
  const isCurrentlyPressed = card.getAttribute('aria-pressed') === 'true';

  if (isCurrentlyPressed) {
    // Clear severity filter using centralized function
    updateFilters({ severity: null });
    card.setAttribute('aria-pressed', 'false');
  } else {
    // Apply High severity filter using centralized function
    updateFilters({ severity: 'High' });
    card.setAttribute('aria-pressed', 'true');
  }
}

// Excel Export utility function
function exportToExcel(dataArray, fileName = 'export.xlsx') {
  if (!dataArray || dataArray.length === 0) {
    alert('No data available to export.');
    return;
  }

  const ws = XLSX.utils.json_to_sheet(dataArray);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  XLSX.writeFile(wb, fileName);
}



// Export all filtered rows
function exportFiltered() {
  setTimeout(() => {
    try {
      const data = currentDashboardData.rows;
      if (data.length === 0) {
        alert('No table data available to export.');
        return;
      }

      const now = new Date();
      const timestamp = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}`;
      const model = currentFilters.model ? currentFilters.model.replace(/[^a-zA-Z0-9]/g, '_') : 'All_Models';
      const severity = currentFilters.severity ? currentFilters.severity : 'All_Severities';
      const fileName = `dashboard_${model}_${severity}_${timestamp}.xlsx`;

      exportToExcel(data, fileName);
    } catch (error) {
      console.error('Export error:', error);
      alert('Export failed. Please try again.');
    }
  }, 100);
}

// Export current view (first 20 rows)
function exportCurrentView() {
  setTimeout(() => {
    try {
      const allData = currentDashboardData.rows;
      const data = allData.slice(0, 20); // Take first 20 rows

      if (data.length === 0) {
        alert('No table data available to export.');
        return;
      }

      const now = new Date();
      const timestamp = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}`;
      const model = currentFilters.model ? currentFilters.model.replace(/[^a-zA-Z0-9]/g, '_') : 'All_Models';
      const severity = currentFilters.severity ? currentFilters.severity : 'All_Severities';
      const fileName = `dashboard_${model}_${severity}_first_20_${timestamp}.xlsx`;

      exportToExcel(data, fileName);
    } catch (error) {
      console.error('Export error:', error);
      alert('Export failed. Please try again.');
    }
  }, 100);
}

// Handle export dropdown toggle
function toggleExportDropdown() {
  const dropdown = document.querySelector('.export-dropdown');
  dropdown.classList.toggle('active');
}

// Handle export option selection
function handleExportOption(action) {
  // Hide dropdown
  toggleExportDropdown();

  if (action === 'all') {
    exportFiltered();
  } else if (action === 'visible') {
    exportCurrentPage();
  }
}

// Close dropdown when clicking outside
function closeExportDropdown(event) {
  const dropdown = document.querySelector('.export-dropdown');
  const toggleBtn = document.getElementById('exportToggleBtn');

  if (!dropdown.contains(event.target) && event.target !== toggleBtn) {
    dropdown.classList.remove('active');
  }
}

// Export High severity data (from card download button)
function handleHighCardExport() {
  // Use a timeout to ensure any pending updates are complete
  setTimeout(async () => {
    try {
      // Fetch specifically High severity data regardless of current filter
      let url = '/api/dashboard';
      const params = [];
      if (dashboardCategory) params.push(`category=${encodeURIComponent(dashboardCategory)}`);
      if (currentFilters.model) params.push(`model=${encodeURIComponent(currentFilters.model)}`);
      params.push('severity=High'); // Force High severity
      if (params.length > 0) url += '?' + params.join('&');

      const resp = await fetchJSON(url);
      if (!resp || !resp.rows || resp.rows.length === 0) {
        alert('No High severity data available to export.');
        return;
      }

      const now = new Date();
      const timestamp = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}`;
      const model = currentFilters.model ? currentFilters.model.replace(/[^a-zA-Z0-9]/g, '_') : 'All_Models';
      const fileName = `dashboard_${model}_High_Severity_${timestamp}.xlsx`;

      exportToExcel(resp.rows, fileName);
    } catch (error) {
      console.error('High card export error:', error);
      alert('Export failed. Please try again.');
    }
  }, 100);
}

// Export modal data (from modal export button)
function handleModalExport() {
  setTimeout(() => {
    try {
      const tableBody = document.getElementById('modalBody');
      const modalTitle = document.getElementById('modalTitle');
      if (!tableBody || !modalTitle) return;

      const rows = Array.from(tableBody.querySelectorAll('tr'));
      if (rows.length === 0) {
        alert('No modal data available to export.');
        return;
      }

      const data = rows.map(row => {
        const cells = Array.from(row.querySelectorAll('td'));
        return {
          'Case Code': cells[0]?.textContent?.trim() || '',
          'Model No.': cells[1]?.textContent?.trim() || '',
          'S/W Ver.': cells[2]?.textContent?.trim() || '',
          'Title': cells[3]?.textContent?.trim() || '',
          'Problem': cells[4]?.textContent?.trim() || '',
          'Sub-Module': cells[5]?.textContent?.trim() || '',
          'Severity': cells[6]?.textContent?.trim() || '',
          'Severity Reason': cells[7]?.textContent?.trim() || ''
        };
      });

      const module = modalTitle.textContent.replace('Issues in ', '').replace(' — Loading...', '').replace(/ \([\d]+ issues\)$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
      const now = new Date();
      const timestamp = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}`;
      const fileName = `module_${module}_${timestamp}.xlsx`;

      exportToExcel(data, fileName);
    } catch (error) {
      console.error('Modal export error:', error);
      alert('Export failed. Please try again.');
    }
  }, 100);
}

// Modal management for module details
function showModuleDetails(module, moduleData) {
  const modalTable = document.querySelector('#issues-modal table.issues-table');

  // Set table with column classes for exact widths - updated for 11-column structure
  modalTable.innerHTML = `
    <thead>
      <tr>
        <th class="col-sn">S/N</th>
        <th class="col-case">Case Code</th>
        <th class="col-title">Title</th>
        <th class="col-problem table-cell-wrap">Problem</th>
        <th class="col-model">Model No.</th>
        <th class="col-sw">S/W Ver.</th>
        <th class="col-module">Module</th>
        <th class="col-sub">Sub-Module</th>
        <th class="col-summarized table-cell-wrap">Summarized Problem</th>
        <th class="col-severity">Severity</th>
        <th class="col-reason">Severity Reason</th>
      </tr>
    </thead>
    <tbody id="modalBody"></tbody>
  `;

  const modal = document.getElementById('issues-modal');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const modalContainer = modal.querySelector('.modal-container');

  // Store previous focus element before showing modal
  previousFocusElement = document.activeElement;

  // Disable background scroll
  document.body.style.overflow = 'hidden';

  // Get individual cases for this module from raw data
  const moduleRows = currentDashboardData.rows.filter(row =>
    (row.module || 'Unknown') === module
  );

  modalTitle.textContent = `Issues in ${module} (${moduleRows.length} issues)`;
  modalBody.innerHTML = '';

  if (!moduleRows.length) {
    modalBody.innerHTML = `<div class="modal-empty">No details available for this module.</div>`;
  } else {
  moduleRows.forEach((row, index) => {
    const tr = document.createElement('tr');

    // Format severity with colored badge
    const severity = (row.severity || '').toLowerCase();
    const severityPill = severity === 'high' ?
      '<span class="pill high">High</span>' :
      '<span class="pill">Medium</span>'; // Default fallback

    // Handle empty summarized problem with pending badge
    const summarizedProblem = row.summarizedProblem || '';
    const summarizedDisplay = summarizedProblem.trim() ?
      escapeHtml(summarizedProblem) :
      '<span class="empty-badge">Pending</span>';

    // Reorder columns to match EXPECTED COLUMNS order: S/N, Case Code, Title, Problem, Model No., S/W Ver., Module, Sub-Module, Summarized Problem, Severity, Severity Reason
    tr.innerHTML = `
      <td class="col-sn">${index + 1}</td>
      <td class="col-case" data-full="${escapeHtml(row.caseId || '')}">${escapeHtml(row.caseId || '')}</td>
      <td class="col-title" data-full="${escapeHtml(row.title || '')}">${escapeHtml(row.title || '')}</td>
      <td class="col-problem" data-full="${escapeHtml(row.problem || '')}">${escapeHtml(row.problem || '')}</td>
      <td class="col-model" data-full="${escapeHtml(row.modelFromFile || '')}" onclick="copyToClipboard('${escapeHtml(row.modelFromFile || '')}')">${escapeHtml(row.modelFromFile || '')}</td>
      <td class="col-sw" onclick="copyToClipboard('${escapeHtml(row.sWVer || row['S/W Ver.'] || '')}')">${escapeHtml(row.sWVer || row['S/W Ver.'] || '')}</td>
      <td class="col-module" data-full="${escapeHtml(row.module || '')}">${escapeHtml(row.module || '')}</td>
      <td class="col-sub" data-full="${escapeHtml(row.subModule || '')}">${escapeHtml(row.subModule || '')}</td>
      <td class="col-summarized" data-full="${escapeHtml(summarizedProblem)}">${summarizedDisplay}</td>
      <td class="col-severity">${severityPill}</td>
      <td class="col-reason" data-full="${escapeHtml(row.severityReason || '')}">${escapeHtml(row.severityReason || '')}</td>
    `;
    modalBody.appendChild(tr);
  });
  }

  modal.classList.add('show');
  modal.style.display = 'flex';

  // Remove modal overlay behavior for full-screen view
  const modalOverlay = document.querySelector('#issues-modal .modal-overlay');
  if (modalOverlay) {
    modalOverlay.style.background = 'none';
    modalOverlay.style.backdropFilter = 'none';
  }

  // Ensure full-screen layout
  const fullScreenContainer = document.querySelector('#issues-modal .modal-container');
  if (fullScreenContainer) {
    fullScreenContainer.style.transform = 'none';
    fullScreenContainer.style.width = '100%';
    fullScreenContainer.style.height = '100vh';
  }

  // Focus trap setup
  const focusableElements = modalContainer.querySelectorAll('a[href], button:not([disabled]), textarea, input[type="text"], input[type="radio"], input[type="checkbox"], select, [tabindex]:not([tabindex="-1"])');
  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    }
  });

  // Focus first element for accessibility
  if (firstElement) {
    firstElement.focus();
  }
}

function closeModal() {
  const modal = document.getElementById('issues-modal');
  modal.classList.remove('show');
  setTimeout(() => {
    modal.style.display = 'none';

    // Restore focus to previous element
    if (previousFocusElement) {
      previousFocusElement.focus();
    }

    // Restore background scroll
    document.body.style.overflow = '';
  }, 300);
}

document.addEventListener('DOMContentLoaded', () => {
  // Initialize theme
  initTheme();

  // Initialize modal close handlers
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('issues-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      closeModal();
    }
  });

  // Enhanced legacy element cleanup for full-screen table
  const removeLegacyElements = () => {
    const legacySelectors = [
      '.legacy-pagination',
      '.page-info',
      '.pagination-legacy',
      '.modal-backdrop',
      '.modal-fade'
    ];
    legacySelectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    });
  };

  // Call cleanup
  removeLegacyElements();

  // MutationObserver for dynamically injected legacy elements
  const modal = document.getElementById('issues-modal');
  if (modal) {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            const legacyEls = node.querySelectorAll ?
              node.querySelectorAll('.legacy-pagination, .page-info, .pagination-legacy, .modal-backdrop') : [];
            legacyEls.forEach(el => el.remove());
          }
        });
      });
    });
    observer.observe(modal, { childList: true, subtree: true });
  }

  // Modal export button handler
  document.getElementById('exportBtn').addEventListener('click', handleModalExport);

  // Export dropdown is handled by exportToggleBtn and export-options

  // High card filter toggle handler
  document.getElementById('highFilterCard').addEventListener('click', (e) => {
    // Don't trigger if clicking the download button itself
    if (!e.target.closest('.inline-download-btn')) {
      toggleHighSeverityFilter();
    }
  });

  // Handle Enter and Space key for accessibility
  document.getElementById('highFilterCard').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleHighSeverityFilter();
    }
  });

  // High card download button handler
  document.getElementById('highCardDownloadBtn').addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent triggering the card click
    handleHighCardExport();
  });

  // Close modal on ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  });

  // Export dropdown functionality
  const exportToggleBtn = document.getElementById('exportToggleBtn');
  const exportOptions = document.querySelectorAll('.export-option');

  if (exportToggleBtn) {
    exportToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleExportDropdown();
    });
  }

  exportOptions.forEach(option => {
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = option.getAttribute('data-action');
      handleExportOption(action);
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', closeExportDropdown);

  // Pagination event listeners
  const firstPageBtn = document.getElementById('firstPageBtn');
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  const lastPageBtn = document.getElementById('lastPageBtn');
  const pageInput = document.getElementById('pageInput');
  const pageSizeSelect = document.getElementById('pageSizeSelect');

  if (firstPageBtn) firstPageBtn.addEventListener('click', firstPage);
  if (prevPageBtn) prevPageBtn.addEventListener('click', prevPage);
  if (nextPageBtn) nextPageBtn.addEventListener('click', nextPage);
  if (lastPageBtn) lastPageBtn.addEventListener('click', lastPage);
  if (pageInput) pageInput.addEventListener('change', goToPageFromInput);
  if (pageSizeSelect) pageSizeSelect.addEventListener('change', changePageSize);

  // Read initial page from URL and start
  readPageFromURL();
  loadModels();
});

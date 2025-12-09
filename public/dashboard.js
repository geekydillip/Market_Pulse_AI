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

// Category display names
const categoryTitles = {
  'beta_user_issues': 'Beta User Issues',
  'samsung_members_plm': 'Samsung Members PLM',
  'samsung_members_voc': 'Samsung Members VOC',
  'plm_issues': 'PLM Issues',
  'blogger_issues': 'Blogger Issues',
  'qi': 'Quality Index',
  'qings': 'QINGS'
};

// Get display title for category
function getCategoryTitle(category) {
  return categoryTitles[category] || category.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

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

  // Update Cases Table visibility: show when specific model selected, hide when "All Models"
  const casesSection = document.querySelector('.cases-section');
  if (casesSection) {
    if (currentFilters.model && currentFilters.model !== null) {
      casesSection.classList.remove('section-hidden');
    } else {
      casesSection.classList.add('section-hidden');
    }
  }

  // Update active state of All Models button
  updateAllModelsButtonState();

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

// Update active state of All Models button
function updateAllModelsButtonState() {
  const allModelsBtn = document.getElementById('allModelsBtn');
  if (allModelsBtn) {
    if (currentFilters.model === null) {
      allModelsBtn.classList.add('active');
    } else {
      allModelsBtn.classList.remove('active');
    }
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

    // Update the main header title to include selected model name
    const headerTitle = document.querySelector('.header-title');
    if (headerTitle) {
      const baseTitle = 'Beta User Issues Overview';
      if (currentFilters.model && currentFilters.model !== null) {
        headerTitle.textContent = `${baseTitle} - ${currentFilters.model}`;
      } else {
        headerTitle.textContent = baseTitle;
      }
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

    // Only render table if a specific model is selected (not on initial "All Models" load)
    if (currentFilters.model && currentFilters.model !== null) {
      renderTable();
    }
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
  const pageDisplay = document.getElementById('pageDisplay');
  const totalPages = document.getElementById('totalPages');

  if (firstBtn) firstBtn.disabled = paginationState.page <= 1;
  if (prevBtn) prevBtn.disabled = paginationState.page <= 1;
  if (nextBtn) nextBtn.disabled = paginationState.page >= paginationState.totalPages;
  if (lastBtn) lastBtn.disabled = paginationState.page >= paginationState.totalPages;

  if (pageDisplay) {
    pageDisplay.textContent = paginationState.page;
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



// Theme Management (Removed - now permanently light theme)
function initTheme() {
  // Always set to light theme
  currentTheme = 'light';
  document.body.className = 'theme-light';
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

// Clean issue titles by fixing common formatting issues
function cleanIssueTitle(title) {
  if (!title) return "";
  return title.replace(/([a-z])([A-Z])/g, '$1 $2') // Insert space between lowercase and uppercase
              .replace(/Camerasays/gi, 'Camera says') // Specific override for common error
              .replace(/camerassays/gi, 'Camera says') // Handle case variations
              .trim();
}

// --- START: Normalize model helper ---
function normalizeModelString(s) {
  if (s === null || s === undefined) return '';
  let v = String(s);

  // Trim and collapse whitespace, remove NBSP
  v = v.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();

  // Remove invisible control characters
  v = v.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');

  // If everything is uppercase/lowercase inconsistent, preserve original but trim.
  // Optionally, standardize common separator variety:
  v = v.replace(/[_]+/g, '_').replace(/[-]{2,}/g, '-');

  return v;
}
// --- END: Normalize model helper ---

// --- Utility: normalized lookup for field names from Excel row ---
function getField(row, names) {
  for (const n of names) {
    if (Object.prototype.hasOwnProperty.call(row, n) && row[n] != null) return String(row[n]).trim();
  }
  return '';
}

function renderModelList(sortedModels, containerEl) {
  // Clear existing content after the search input and suggestions
  const searchInput = containerEl.querySelector('#modelSearchInput');
  const suggestions = containerEl.querySelector('#searchSuggestions');
  const elementsToKeep = [searchInput, suggestions].filter(el => el);

  // Remove all children except the ones we want to keep
  Array.from(containerEl.children).forEach(child => {
    if (!elementsToKeep.includes(child)) {
      containerEl.removeChild(child);
    }
  });

  const top = sortedModels.slice(0, 10);
  top.forEach(({model, count}) => {
    const btn = document.createElement('button');
    btn.className = 'model-chip';

    // Create span for model name
    const modelNameSpan = document.createElement('span');
    modelNameSpan.textContent = model;

    // Create badge for count
    const countBadge = document.createElement('span');
    countBadge.className = 'model-badge';
    countBadge.textContent = `(${count})`;

    // Append elements to button
    btn.appendChild(modelNameSpan);
    btn.appendChild(countBadge);

    btn.onclick = () => updateFilters({ model: model });
    containerEl.appendChild(btn);
  });

  if (sortedModels.length > 10) {
    const moreBtn = document.createElement('button');
    moreBtn.className = 'model-more-btn';
    moreBtn.textContent = `More (${sortedModels.length - 10})`;
    moreBtn.onclick = () => {
      // simple inline dropdown: render the remainder below the button
      let dropdown = containerEl.querySelector('.model-more-dropdown');
      if (dropdown) { dropdown.remove(); return; } // toggle
      dropdown = document.createElement('div');
      dropdown.className = 'model-more-dropdown';
      sortedModels.slice(10).forEach(({model, count}) => {
        const item = document.createElement('div');
        item.className = 'model-more-item';
        item.textContent = `${model} (${count})`;
        item.onclick = () => { updateFilters({ model: model }); };
        dropdown.appendChild(item);
      });
      containerEl.appendChild(dropdown);
    };
    containerEl.appendChild(moreBtn);
  }
}

// canonical extraction that tries many header names then normalizes
function extractModelFromRow(row) {
  const candidates = ['Model No.','Model','modelFromFile','ModelNo','Model_No','model','model_no','Model Name'];
  let raw = '';
  for (const c of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, c) && row[c] !== null && row[c] !== undefined && String(row[c]).trim() !== '') {
      raw = row[c];
      break;
    }
  }
  // fallback to first non-empty property if none of the candidates matched
  if (!raw) {
    for (const k of Object.keys(row)) {
      if (String(row[k]).trim() !== '') { raw = row[k]; break; }
    }
  }
  const normalized = normalizeModelString(raw);
  return normalized || 'Unknown';
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

  // remove 'critical' entries (case-insensitive) - keeping for backward compatibility but no longer needed
  for (const k of Object.keys(severityCounts)) {
    if (/^\s*critical\s*$/i.test(k)) {
      delete severityCounts[k];
    }
  }

  const labels = Object.keys(severityCounts);
  const data = labels.map(l => severityCounts[l]);

  // Optional: If you want a fixed order (High, Medium, Low) -- reorder:
  const order = ['High','Medium','Low'];
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

  // Professional color palette for severity levels - Updated colors
  const severityColorPalette = {
    'High': '#EF4444',    // Red
    'Medium': '#F59E0B',  // Orange
    'Low': '#10B981'      // Green
  };

  // Assign colors based on labels using the new palette
  const backgroundColors = sevLabels.map(label => severityColorPalette[label] || '#6B7280');
  const hoverBackgroundColors = sevLabels.map(label => {
    const color = severityColorPalette[label] || '#6B7280';
    // Darken the color for hover
    if (color === '#EF4444') return '#B91C1C';
    if (color === '#F59E0B') return '#B45309';
    if (color === '#10B981') return '#047857';
    return '#374151';
  });

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
          hoverBackgroundColor: hoverBackgroundColors,
          borderWidth: 0,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false, // Ensures it fills the new CSS height
        layout: {
          padding: {
            bottom: 15  // <--- ADD THIS: Adds breathing room at the bottom
          }
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              padding: 35, // INCREASED: Adds space between the chart and the legend text
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
        cutout: '30%', // Thinner ring as specified
        elements: {
          arc: {
            borderRadius: 4
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

    // Create colors that cycle through severity palette for each module
    const moduleColors = modLabels.map((_, index) => {
      const severityColors = ['#EF4444', '#F59E0B', '#10B981']; // High, Medium, Low colors
      return severityColors[index % severityColors.length];
    });

    const moduleHoverColors = moduleColors.map(color => {
      // Darken the color for hover
      if (color === '#EF4444') return '#B91C1C'; // High hover
      if (color === '#F59E0B') return '#B45309'; // Medium hover
      return '#047857'; // Low hover
    });

    const modCtx = modEl.getContext('2d');
    if (moduleChart) moduleChart.destroy();

    // Create gradient colors for Red to Green effect
    const gradientColors = modLabels.map((_, index) => {
      const ratio = index / (modLabels.length - 1); // 0 to 1
      const red = Math.round(239 - (239 - 34) * ratio);   // 239 (red) to 34 (green)
      const green = Math.round(68 + (163 - 68) * ratio);  // 68 to 163
      const blue = Math.round(68 - 68 * ratio);           // 68 to 0
      return `rgb(${red}, ${green}, ${blue})`;
    });

    moduleChart = new Chart(modCtx, {
      type: 'bar',
      data: {
        labels: modLabels,
        datasets: [{
          label: 'Number of Issues',
          data: modCounts,
          backgroundColor: gradientColors,
          hoverBackgroundColor: gradientColors.map(color => color.replace('rgb', 'rgba').replace(')', ', 0.8)')),
          barThickness: 20,
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y', // Horizontal bar chart
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: {
            top: 10,
            right: 20,
            bottom: 20,
            left: 10
          }
        },
        plugins: {
          legend: {
            display: false
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
              autoSkip: true,    // PREVENTS OVERCROWDING
              maxRotation: 0,    // PREVENTS TILT (keeps numbers straight)
              precision: 0,
              color: '#64748b',
              font: {
                size: 12
              }
            },
            grid: {
              display: false // Minimize grid lines
            },
            title: {
              display: true,
              text: 'Number of Issues',
              color: '#0467f1ff',
              font: {
                size: 13,
                weight: '600'
              },
              padding: { top: 10 }  // <--- ADD THIS: Pushes title down away from numbers
            }
          },
          y: {
            ticks: {
              color: '#64748b',
              font: {
                size: 11
              },
              callback: function(value, index) {
                const label = this.getLabelForValue(index);
                return label.length > 15 ? label.substring(0, 15) + '...' : label;
              }
            },
            grid: {
              display: false // Minimize grid lines
            }
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
    const modelNo = extractModelFromRow(row);

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

  // Convert to array and find top titles for each module
  return Array.from(moduleMap.values()).map(moduleData => {
    // Find top 2 most frequent titles
    const titleEntries = Array.from(moduleData.titleCount.entries())
      .sort((a, b) => b[1] - a[1]) // Sort by count descending
      .slice(0, 2); // Take top 2

    // Format the top titles
    let topTitlesText = 'N/A';
    if (titleEntries.length > 0) {
      const formattedTitles = titleEntries.map(([title]) =>
        cleanIssueTitle(title.charAt(0).toUpperCase() + title.slice(1))
      );
      topTitlesText = formattedTitles.join(' | ');
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
      topIssueTitle: topTitlesText
    };
  }).sort((a, b) => b.count - a.count);
}

// Render loading skeleton for table
function renderLoadingTable() {
  const tbody = document.querySelector('#dataTable tbody');
  tbody.innerHTML = '';

  // Show 5 skeleton rows
  for (let i = 0; i < 5; i++) {
    const tr = document.createElement('tr');
    tr.className = 'table-loading';
    tr.innerHTML = `
      <td><div class="loading-skeleton"></div></td>
      <td><div class="loading-skeleton"></div></td>
      <td><div class="loading-skeleton"></div></td>
      <td><div class="loading-skeleton"></div></td>
      <td><div class="loading-skeleton"></div></td>
    `;
    tbody.appendChild(tr);
  }

  document.getElementById('tableCount').textContent = 'Loading...';
}

// Render aggregated table with pagination
function renderTable() {
  const table = document.getElementById('dataTable');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  tbody.innerHTML = '';

  // Update table headers based on filter state
  const isFilteredToSingleModel = currentFilters.model && currentFilters.model !== null;

  // Create header row
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = `
    <th>S/N</th>
    <th>Model No.</th>
    <th>Module</th>
    <th>Top Issue Title</th>
    <th>Count</th>
  `;
  thead.innerHTML = '';
  thead.appendChild(headerRow);

  // Calculate paginated slice
  const startIndex = (paginationState.page - 1) * paginationState.pageSize;
  const endIndex = Math.min(startIndex + paginationState.pageSize, currentDashboardData.aggregatedData.length);
  const pageData = currentDashboardData.aggregatedData.slice(startIndex, endIndex);

  pageData.forEach((moduleData, index) => {
    const globalIndex = startIndex + index + 1;
    const tr = document.createElement('tr');



    tr.innerHTML = `
      <td>${globalIndex}</td>
      <td><div class="truncate-cell" title="${escapeHtml(moduleData.modelNo)}">${escapeHtml(moduleData.modelNo)}</div></td>
      <td><button class="module-name-link" data-module="${escapeHtml(moduleData.module)}" data-count="${moduleData.count}">${escapeHtml(moduleData.module)}</button></td>
      <td><div class="truncate-cell" title="${escapeHtml(moduleData.topIssueTitle)}">${escapeHtml(moduleData.topIssueTitle)}</div></td>
      <td>${moduleData.count}</td>
    `;

    // Add row click handler
    tr.addEventListener('click', () => {
      const module = moduleData.module;
      showModuleDetails(module, moduleData);
    });

    tbody.appendChild(tr);
  });

  document.getElementById('tableCount').textContent = `${currentDashboardData.aggregatedData.length} modules`;

  // Update pagination controls
  updatePaginationControls();

  // Attach click handlers to module name buttons
  document.querySelectorAll('.module-name-link').forEach(button => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation(); // Prevent row click when clicking module button
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

  // Get search wrapper reference
  const searchWrapper = document.querySelector('.search-wrapper');
  const searchInput = document.getElementById('modelSearchInput');

  // Create suggestions container with ARIA attributes
  suggestionsContainer = document.createElement('div');
  suggestionsContainer.id = 'searchSuggestions';
  suggestionsContainer.className = 'search-suggestions';
  suggestionsContainer.setAttribute('role', 'listbox');
  suggestionsContainer.setAttribute('aria-label', 'Model suggestions');
  searchWrapper.appendChild(suggestionsContainer);

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
    // Fetch full dataset from /api/dashboard to access all rows for model aggregation
    const resp = await fetchJSON('/api/dashboard?category=' + encodeURIComponent(dashboardCategory));
    const container = document.getElementById('modelButtons');
    container.innerHTML = '';

    // Aggregate model counts from all rows using normalized extraction
    const modelCounts = {};
    (resp.rows || []).forEach(row => {
      const model = extractModelFromRow(row);
      modelCounts[model] = (modelCounts[model] || 0) + 1;
    });

    // Convert to array and sort by count descending
    const sortedModels = Object.entries(modelCounts)
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count);

    // Store all models for search functionality
    allModels = sortedModels.map(item => item.model);

    // Setup model search with all models (including those not in top 10)
    setupModelSearch(allModels);

    // Render model list with top 10 + More dropdown
    renderModelList(sortedModels, container);

    // Update active state of All Models button (it's already in the HTML)
    updateAllModelsButtonState();

    // Load initial dashboard data
    refreshDashboardOverview();
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
          'Sub-Module': cells[4]?.textContent?.trim() || '',
          'Summarized Problem': cells[5]?.textContent?.trim() || '',
          'Severity': cells[6]?.textContent?.trim() || ''
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
  const modal = document.getElementById('issues-modal');
  const modalTitle = document.getElementById('modalTitle');
  const modalContainer = modal.querySelector('.modal-container');

  // Store previous focus element before showing modal
  previousFocusElement = document.activeElement;

  // Disable background scroll
  document.body.style.overflow = 'hidden';

  // Get individual cases for this module from raw data
  let moduleRows = currentDashboardData.rows.filter(row =>
    (row.module || 'Unknown') === module
  );

  // Sorting state
  let currentSortColumn = null;
  let currentSortDirection = 'asc'; // 'asc' or 'desc'

  // Function to get severity priority for sorting (High > Medium > Low)
  function getSeverityPriority(severity) {
    const sev = (severity || '').toLowerCase();
    if (sev === 'high') return 3;
    if (sev === 'medium') return 2;
    if (sev === 'low') return 1;
    return 0; // Unknown severities
  }

  // Function to sort rows
  function sortRows(column, direction) {
    if (column === 'severity') {
      moduleRows.sort((a, b) => {
        const aPriority = getSeverityPriority(a.severity);
        const bPriority = getSeverityPriority(b.severity);
        if (aPriority !== bPriority) {
          return direction === 'asc' ? aPriority - bPriority : bPriority - aPriority;
        }
        // If same priority, sort by severity string as fallback
        const aSev = (a.severity || '').toLowerCase();
        const bSev = (b.severity || '').toLowerCase();
        return direction === 'asc' ? aSev.localeCompare(bSev) : bSev.localeCompare(aSev);
      });
    }
  }

  // Function to render the table
  function renderTable() {
    // Get the tbody for the new table structure
    const tbody = document.querySelector('#moduleDetailTable tbody');
    tbody.innerHTML = '';

    if (!moduleRows.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="modal-empty">No details available for this module.</td></tr>`;
    } else {
      moduleRows.forEach((row, index) => {
        const tr = document.createElement('tr');

        // CHECK: Ensure you use the exact property name from server data
        // Server returns caseId, title, problem, modelFromFile, module, severity, sWVer, subModule, summarizedProblem, severityReason
        const caseCode = row.caseId || 'N/A';

        // Format severity with colored badge
        const severity = (row.severity || '').toLowerCase();
        const severityPill = severity === 'high' ?
          '<span class="pill high">High</span>' :
          severity === 'medium' ?
          '<span class="pill">Medium</span>' :
          '<span class="pill">Low</span>'; // Default fallback

        // Handle empty summarized problem with pending badge
        const summarizedProblem = row.summarizedProblem || '';
        const summarizedDisplay = summarizedProblem.trim() ?
          escapeHtml(summarizedProblem) :
          '<span class="empty-badge">Pending</span>';

        tr.innerHTML = `
          <td>${index + 1}</td>
          <td style="font-weight:bold; color:#4F46E5;">
            ${escapeHtml(caseCode)}
          </td>
          <td>${escapeHtml(row.modelFromFile || row.model || 'N/A')}</td>
          <td>${escapeHtml(row.sWVer || row['S/W Ver.'] || 'N/A')}</td>
          <td>${escapeHtml(row.title || row.issueTitle || 'N/A')}</td>
          <td>${escapeHtml(row.subModule || 'N/A')}</td>
          <td>${summarizedDisplay}</td>
          <td>${severityPill}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  }

  // UI/UX: Update the Title to include the Module Name explicitly
  modalTitle.textContent = `${module} Issues Detail`;

  // Initial render
  renderTable();

  // Add click handlers for sortable headers
  const severityHeader = document.querySelector('#moduleDetailTable thead th.sortable');
  if (severityHeader) {
    severityHeader.addEventListener('click', () => {
      // Remove existing sort classes
      document.querySelectorAll('#moduleDetailTable thead th.sortable').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
      });

      // Toggle sort direction if same column, otherwise set to asc
      if (currentSortColumn === 'severity') {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        currentSortColumn = 'severity';
        currentSortDirection = 'asc';
      }

      // Add sort class to header
      severityHeader.classList.add(`sort-${currentSortDirection}`);

      // Sort and re-render
      sortRows(currentSortColumn, currentSortDirection);
      renderTable();
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
  const pageSizeSelect = document.getElementById('pageSizeSelect');

  if (firstPageBtn) firstPageBtn.addEventListener('click', firstPage);
  if (prevPageBtn) prevPageBtn.addEventListener('click', prevPage);
  if (nextPageBtn) nextPageBtn.addEventListener('click', nextPage);
  if (lastPageBtn) lastPageBtn.addEventListener('click', lastPage);
  if (pageSizeSelect) pageSizeSelect.addEventListener('change', changePageSize);

  // Read initial page from URL and start
  readPageFromURL();
  loadModels();
});

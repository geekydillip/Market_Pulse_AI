// Dashboard JavaScript with enhanced features
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Network ${r.status} ${r.statusText} ${text}`);
  }
  return r.json();
}

let severityChart = null;
let moduleChart = null;
let currentTheme = 'dark';

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

// Safe escape
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/\"/g, '"')
    .replace(/'/g, '&#39;');
}

// Enhanced Charts with Professional Styling
function renderCharts(severityDistribution, moduleDistribution) {
  // Sort severity data to match desired order: Critical, High, Medium, Low
  const severityOrder = ['Critical', 'High', 'Medium', 'Low'];
  const sortedSeverityData = severityDistribution.sort((a, b) => {
    return severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity);
  });

  const sevLabels = sortedSeverityData.map(s => s.severity);
  const sevCounts = sortedSeverityData.map(s => s.count);
  const modLabels = moduleDistribution.map(m => m.module);
  const modCounts = moduleDistribution.map(m => m.count);

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
    'Critical': [chartCriticalStart, chartCriticalEnd],
  };

  // Assign colors based on labels
  const backgroundColors = sevLabels.map(label => severityColors[label] ? severityColors[label][0] : 'rgba(150, 150, 150, 0.8)');
  const borderColors = sevLabels.map(label => severityColors[label] ? severityColors[label][1] : 'rgba(120, 120, 120, 1)');

  const sevEl = document.getElementById('severityChart');
  const modEl = document.getElementById('moduleChart');

  if (sevEl) {
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
          borderWidth: 1,
          hoverBorderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              padding: 25,
              font: {
                size: 12,
                weight: '400'
              }
            }
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: '#fff',
            bodyColor: '#fff',
            borderColor: 'rgba(255, 255, 255, 0.3)',
            borderWidth: 1,
            cornerRadius: 8,
            displayColors: false,
          }
        },
        animation: {
          animateScale: false,
          animateRotate: false,
          duration: 0
        },
        cutout: '60%', // Make donut have wider hole for better balance
      }
    });
  }

  if (modEl) {
    const modCtx = modEl.getContext('2d');
    if (moduleChart) moduleChart.destroy();
    moduleChart = new Chart(modCtx, {
      type: 'bar',
      data: {
        labels: modLabels,
        datasets: [{
          label: 'Issue Count',
          data: modCounts,
          backgroundColor: 'rgba(186, 85, 211, 0.8)', // Soft lavender
          borderColor: 'rgba(186, 85, 211, 1)',
          borderWidth: 1,
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 35,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: '#fff',
            bodyColor: '#fff',
            cornerRadius: 8,
            callbacks: {
              title: function(context) {
                return `Module: ${context[0].label}`;
              },
              label: function(context) {
                return `Issues: ${context.parsed.x}`;
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              precision: 0,
              color: currentTheme === 'dark' ? '#bbb' : '#64748b'
            },
            grid: {
              color: currentTheme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
            }
          },
          y: {
            ticks: {
              color: currentTheme === 'dark' ? '#bbb' : '#64748b'
            },
            grid: {
              color: currentTheme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
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
    const modelNo = row.modelFromFile || 'Unknown';

    if (!moduleMap.has(module)) {
      moduleMap.set(module, {
        module: module,
        modelNo: modelNo,
        count: 0,
        rows: [],
        titleCount: new Map()
      });
    }

    const moduleData = moduleMap.get(module);
    moduleData.count++;
    moduleData.rows.push(row);

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

    return {
      ...moduleData,
      topIssueTitle: topTitle.charAt(0).toUpperCase() + topTitle.slice(1)
    };
  }).sort((a, b) => b.count - a.count);
}

// Render aggregated table
function renderTable(aggregatedData) {
  const tbody = document.querySelector('#dataTable tbody');
  tbody.innerHTML = '';

  aggregatedData.forEach((moduleData, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${escapeHtml(moduleData.modelNo)}</td>
      <td>${escapeHtml(moduleData.module)}</td>
      <td title="${escapeHtml(moduleData.topIssueTitle)}">${escapeHtml(moduleData.topIssueTitle.slice(0, 60))}${moduleData.topIssueTitle.length > 60 ? '...' : ''}</td>
      <td><a href="#" class="module-link" data-module="${escapeHtml(moduleData.module)}" data-count="${moduleData.count}">${moduleData.count}</a></td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('tableCount').textContent = `${aggregatedData.length} modules`;

  // Attach click handlers to module links
  document.querySelectorAll('.module-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const module = link.dataset.module;
      const count = parseInt(link.dataset.count);
      showModuleDetails(module, aggregatedData.find(m => m.module === module));
    });
  });
}

async function loadModels() {
  try {
    const resp = await fetchJSON('/api/models');
    const container = document.getElementById('modelButtons');
    container.innerHTML = '';

    // Add 'All Models' as the first chip
    const allBtn = document.createElement('button');
    allBtn.className = 'model-chip';
    allBtn.textContent = 'All Models';
    allBtn.onclick = () => loadDashboard(null, allBtn);
    container.appendChild(allBtn);

    if (resp && Array.isArray(resp.models)) {
      resp.models.forEach(m => {
        const btn = document.createElement('button');
        btn.className = 'model-chip';
        btn.textContent = m;
        btn.onclick = () => loadDashboard(m, btn);
        container.appendChild(btn);
      });
    }

    // auto-click 'All Models' by default (aggregated)
    allBtn.click();
  } catch (err) {
    console.error('loadModels error', err);
    alert('Failed to load models: ' + (err.message || err));
  }
}

async function loadDashboard(model, btn) {
  try {
    // set active style
    document.querySelectorAll('.model-chip').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    // If model is null -> aggregate (do not send model param)
    const url = model ? `/api/dashboard?model=${encodeURIComponent(model)}` : `/api/dashboard`;
    const resp = await fetchJSON(url);

    if (!resp || resp.success === false) {
      throw new Error(resp && resp.error ? resp.error : 'dashboard error');
    }

    // totals
    const totals = resp.totals || { totalCases: 0, critical: 0, high: 0, medium: 0, low: 0 };
    document.getElementById('dashTotal').textContent = totals.totalCases || 0;
    document.getElementById('dashCritical').textContent = totals.critical || 0;
    document.getElementById('dashDistinct').textContent = (resp.moduleDistribution && resp.moduleDistribution.length) || 0;

    // Aggregate data by module
    const aggregatedData = aggregateByModule(resp.rows || []);

    document.getElementById('moduleCount').textContent = `${aggregatedData.length} modules`;

    // charts
    renderCharts(resp.severityDistribution || [], resp.moduleDistribution || []);

    // table rows (aggregated)
    renderTable(aggregatedData);
  } catch (err) {
    console.error('loadDashboard error', err);
    alert('Failed to load dashboard: ' + (err.message || err));
  }
}

// Modal management for module details
function showModuleDetails(module, moduleData) {
  const modal = document.getElementById('moduleModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');

  modalTitle.textContent = `Issues in ${module} (${moduleData.count} issues)`;
  modalBody.innerHTML = '';

  if (!moduleData.rows.length) {
    modalBody.innerHTML = '<div class="modal-empty">No details available for this module.</div>';
  } else {
    moduleData.rows.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(row.caseId || '')}</td>
        <td>${escapeHtml(row.modelFromFile || '')}</td>
        <td>${escapeHtml(row.sWVer || row['S/W Ver.'] || '')}</td>
        <td title="${escapeHtml(row.title || '')}">${escapeHtml((row.title || '').slice(0, 50))}${row.title && row.title.length > 50 ? '...' : ''}</td>
        <td title="${escapeHtml(row.problem || '')}">${escapeHtml((row.problem || '').slice(0, 50))}${row.problem && row.problem.length > 50 ? '...' : ''}</td>
        <td>${escapeHtml(row.subModule || row['Sub-Module'] || '')}</td>
        <td>${escapeHtml(row.severity || '')}</td>
        <td title="${escapeHtml(row.severityReason || '')}">${escapeHtml((row.severityReason || '').slice(0, 50))}${row.severityReason && row.severityReason.length > 50 ? '...' : ''}</td>
      `;
      modalBody.appendChild(tr);
    });
  }

  modal.classList.add('show');
  modal.style.display = 'flex';
}

function closeModal() {
  const modal = document.getElementById('moduleModal');
  modal.classList.remove('show');
  setTimeout(() => {
    modal.style.display = 'none';
  }, 300);
}

document.addEventListener('DOMContentLoaded', () => {
  // Initialize theme
  initTheme();

  // Initialize modal close handlers
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('moduleModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      closeModal();
    }
  });

  // Close modal on ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  });

  loadModels();
});

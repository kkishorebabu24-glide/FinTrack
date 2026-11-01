/**
 * FinTrack - Core Application Orchestrator
 * Conforms to ISO/IEC 25010 maintainability, modularity, and single responsibility.
 * 
 * Handles:
 * - Net worth calculations and 5-year savings projection modeling (Chart.js)
 * - Dashboard KPI summaries and 6-month historical income vs expense trends
 * - Expenses and Income ledger management & CRUD operations
 * - Daily chores tracking, Indian personal finance criteria checklist, and savings goals
 * - Category management and dropdown binding
 * - Local backup export/import (JSON) and CSV ledger export
 * - Navigation tabs & statement subtab routing
 * - Application bootstrap lifecycle & PWA offline service worker
 */

// ============================================
// CATEGORY MANAGEMENT & DROPDOWNS
// ============================================

function addCategory(name, type) {
  name = name.trim();
  if (!name) return false;
  if (getCategoryType(name)) { alert('Category already exists!'); return false; }
  if (!categories[type]) categories[type] = [];
  categories[type].push(name);
  saveData('ft_categories', categories);
  renderCategories();
  populateDropdowns();
  return true;
}

function deleteCategory(name) {
  if (!confirm(`Delete category "${name}"?`)) return;
  const type = getCategoryType(name);
  if (!type) return;
  categories[type] = categories[type].filter(c => c !== name);
  saveData('ft_categories', categories);
  renderCategories();
  populateDropdowns();
}
window.deleteCategory = deleteCategory;

function renderCategories() {
  const list = document.getElementById('categoryList');
  if (!list) return;
  let html = '';
  // Expense
  html += `<li style="font-weight:bold; color:#2c3e50;">💸 Expense</li>`;
  categories.expense.forEach(c => {
    html += `<li><span>${c}</span><button onclick="deleteCategory('${c}')" style="background:#c0392b; padding:0.2rem 0.6rem;">✕</button></li>`;
  });
  html += `<li style="font-weight:bold; color:#27ae60;">💰 Income</li>`;
  categories.income.forEach(c => {
    html += `<li><span>${c}</span><button onclick="deleteCategory('${c}')" style="background:#c0392b; padding:0.2rem 0.6rem;">✕</button></li>`;
  });
  html += `<li style="font-weight:bold; color:#f39c12;">🔄 Transfer (neutral)</li>`;
  categories.transfer.forEach(c => {
    html += `<li><span>${c}</span><button onclick="deleteCategory('${c}')" style="background:#c0392b; padding:0.2rem 0.6rem;">✕</button></li>`;
  });
  list.innerHTML = html;
}

function populateDropdowns() {
  const expSelect = document.getElementById('expCategory');
  const incSelect = document.getElementById('incCategory');
  if (expSelect) {
    const current = expSelect.value;
    expSelect.innerHTML = categories.expense.map(c => `<option>${c}</option>`).join('');
    if (categories.expense.includes(current)) expSelect.value = current;
  }
  if (incSelect) {
    const current = incSelect.value;
    incSelect.innerHTML = categories.income.map(c => `<option>${c}</option>`).join('');
    if (categories.income.includes(current)) incSelect.value = current;
  }
}

// ============================================
// NET WORTH & SAVINGS PREDICTION MODEL
// ============================================

function getNetWorth() {
  const totalExp = expenses
    .filter(e => getCategoryType(e.category) !== 'transfer')
    .reduce((s,e) => s + parseFloat(e.amount), 0);
  const totalInc = incomeEntries
    .filter(e => getCategoryType(e.category) !== 'transfer')
    .reduce((s,e) => s + parseFloat(e.amount), 0);
  return totalInc - totalExp;
}

let predictionChart = null;

function updatePrediction() {
  const chartCanvas = document.getElementById('predictionChart');
  if (!chartCanvas) return;
  const currentNetWorth = getNetWorth();
  const monthlySavings = parseFloat(document.getElementById('predMonthlySavings')?.value) || 0;
  const annualGrowth = parseFloat(document.getElementById('predGrowthRate')?.value) || 0;
  const target = parseFloat(document.getElementById('predTarget')?.value) || 0;

  const months = 60;
  const labels = [];
  const projected = [];
  let value = currentNetWorth;
  const monthlyRate = annualGrowth / 100 / 12;
  for (let i = 0; i <= months; i++) {
    if (i > 0) value = value * (1 + monthlyRate) + monthlySavings;
    labels.push(`M${i}`);
    projected.push(Math.round(value));
  }

  const ctx = chartCanvas.getContext('2d');
  if (predictionChart) predictionChart.destroy();
  predictionChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Projected Net Worth',
        data: projected,
        borderColor: '#3498db',
        backgroundColor: 'rgba(52,152,219,0.1)',
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => '₹' + ctx.parsed.y.toLocaleString() } } },
      scales: { y: { beginAtZero: false, ticks: { callback: v => '₹' + v.toLocaleString() } } }
    }
  });

  const finalValue = projected[projected.length - 1];
  const summary = document.getElementById('predictionSummary');
  if (!summary) return;
  let html = `<strong>Current Net Worth:</strong> ₹${currentNetWorth.toLocaleString()}<br>`;
  html += `<strong>Projected after 5 years:</strong> ₹${finalValue.toLocaleString()}`;
  if (target > 0) {
    let val = currentNetWorth;
    let monthsToTarget = 0;
    while (val < target && monthsToTarget < 20*12) {
      val = val * (1 + monthlyRate) + monthlySavings;
      monthsToTarget++;
    }
    if (val >= target) html += `<br><strong>Target ₹${target.toLocaleString()} reached in:</strong> ${(monthsToTarget/12).toFixed(1)} years`;
    else html += `<br><strong>Target not reached within 20 years.</strong>`;
  }
  summary.innerHTML = html;
}

function autoFillSavings() {
  const savingsInput = document.getElementById('predMonthlySavings');
  if (!savingsInput) return;
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const monthlyExp = expenses.filter(e => {
    const d = new Date(e.date);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  }).reduce((s,e) => s + parseFloat(e.amount), 0);
  const monthlyInc = incomeEntries.filter(e => {
    const d = new Date(e.date);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  }).reduce((s,e) => s + parseFloat(e.amount), 0);
  const savings = monthlyInc - monthlyExp;
  savingsInput.value = Math.max(0, savings);
  updatePrediction();
}

// ============================================
// DASHBOARD & CHARTS RENDERING
// ============================================

let trendChart = null;

function renderDashboard() {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const monthlyExpenses = expenses.filter(e => {
    const d = new Date(e.date);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  }).reduce((sum, e) => sum + parseFloat(e.amount), 0);

  const monthlyIncome = incomeEntries.filter(e => {
    const d = new Date(e.date);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  }).reduce((sum, e) => sum + parseFloat(e.amount), 0);

  const netWorth = getNetWorth();

  const summaryCards = document.getElementById('summaryCards');
  if (summaryCards) {
    summaryCards.innerHTML = `
      <div class="stat"><div class="label">Month Income</div><div class="value">₹${monthlyIncome.toLocaleString()}</div></div>
      <div class="stat"><div class="label">Month Expenses</div><div class="value">₹${monthlyExpenses.toLocaleString()}</div></div>
      <div class="stat"><div class="label">Month Savings</div><div class="value">₹${(monthlyIncome-monthlyExpenses).toLocaleString()}</div></div>
      <div class="stat"><div class="label">Net Worth</div><div class="value">₹${netWorth.toLocaleString()}</div></div>
    `;
  }

  // Trend chart (6 months)
  const trendCanvas = document.getElementById('trendChart');
  if (trendCanvas) {
    const months = [];
    const incomeByMonth = [];
    const expenseByMonth = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - i, 1);
      const m = d.getMonth();
      const y = d.getFullYear();
      months.push(d.toLocaleString('default', { month:'short', year:'numeric' }));
      const inc = incomeEntries.filter(e => {
        const dt = new Date(e.date);
        return dt.getMonth() === m && dt.getFullYear() === y;
      }).reduce((s,e) => s + parseFloat(e.amount), 0);
      const exp = expenses.filter(e => {
        const dt = new Date(e.date);
        return dt.getMonth() === m && dt.getFullYear() === y;
      }).reduce((s,e) => s + parseFloat(e.amount), 0);
      incomeByMonth.push(inc);
      expenseByMonth.push(exp);
    }

    const ctx = trendCanvas.getContext('2d');
    if (trendChart) trendChart.destroy();
    trendChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: months,
        datasets: [
          { label: 'Income', data: incomeByMonth, borderColor: '#27ae60', backgroundColor: 'rgba(39,174,96,0.1)', tension: 0.2 },
          { label: 'Expenses', data: expenseByMonth, borderColor: '#e74c3c', backgroundColor: 'rgba(231,76,60,0.1)', tension: 0.2 }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position:'bottom' } },
        scales: { y: { beginAtZero: true, ticks: { callback: v => '₹'+v } } }
      }
    });
  }

  // Update prediction if dashboard active
  const dashPanel = document.getElementById('dashboard');
  if (dashPanel && dashPanel.classList.contains('active')) {
    updatePrediction();
  }
}

// ============================================
// EXPENSES & SPENDING ANALYSIS SUITE (Modern UI)
// ============================================

let expenseCurrentPage = 1;
let expensePageSize = 15;
let expenseCategoryChartInstance = null;
let expenseMonthlyChartInstance = null;

// Clean and parse note string into merchant title, details, and source
function parseExpenseNote(note) {
  if (!note) return { merchant: 'Expense', details: '', source: 'Manual', sourceClass: 'source-manual' };
  let str = String(note).trim();
  let source = 'Manual';
  let sourceClass = 'source-manual';

  if (str.includes('[Bank Statement]')) {
    source = 'Bank Statement';
    sourceClass = 'source-statement';
    str = str.replace(/\[Bank Statement\]/gi, '').trim();
  } else if (str.includes('[Merged Alert+Report]')) {
    source = 'Merged Alert';
    sourceClass = 'source-alert';
    str = str.replace(/\[Merged Alert\+Report\]/gi, '').trim();
  } else if (str.includes('[Email Alert]')) {
    source = 'Email Alert';
    sourceClass = 'source-alert';
    str = str.replace(/\[Email Alert\]/gi, '').trim();
  }

  let refId = '';
  const refM = str.match(/\[Ref:([A-Za-z0-9]+)\]/i);
  if (refM) {
    refId = refM[1];
    str = str.replace(/\[Ref:[A-Za-z0-9]+\]/gi, '').trim();
  }

  // Strip leading slashes and common prefixes like /sent U/ or /pay to/
  str = str.replace(/^[\s\/]+/, '');
  str = str.replace(/^(?:sent\s*u|pay\s*to|pay\s*via|payment)[\/\s]*/i, '');

  let cleanName = cleanNarration(str);
  if (!cleanName || cleanName === 'Unknown' || cleanName.length < 2) {
    cleanName = str.replace(/[_\-*#|\/]+/g, ' ').trim() || 'Expense';
  }

  return {
    merchant: cleanName,
    details: refId ? `Ref: ${refId}` : (str !== cleanName && str.length > cleanName.length ? str : ''),
    source,
    sourceClass
  };
}

// Category Badge Helper with curated colors & icons
function getCategoryBadge(category) {
  const cat = (category || 'Other').trim();
  const cLower = cat.toLowerCase();
  let cls = 'cat-other';
  let icon = '🏷️';

  if (cLower.includes('bill')) { cls = 'cat-bills'; icon = '⚡'; }
  else if (cLower.includes('food') || cLower.includes('drink') || cLower.includes('dining')) { cls = 'cat-food'; icon = '🍔'; }
  else if (cLower.includes('grocer')) { cls = 'cat-groceries'; icon = '🛒'; }
  else if (cLower.includes('shop')) { cls = 'cat-shopping'; icon = '🛍️'; }
  else if (cLower.includes('emi') || cLower.includes('loan')) { cls = 'cat-emi'; icon = '🏦'; }
  else if (cLower.includes('health') || cLower.includes('med')) { cls = 'cat-health'; icon = '💊'; }
  else if (cLower.includes('travel') || cLower.includes('flight')) { cls = 'cat-travel'; icon = '✈️'; }
  else if (cLower.includes('fuel') || cLower.includes('petrol')) { cls = 'cat-fuel'; icon = '⛽'; }
  else if (cLower.includes('entertain') || cLower.includes('movie')) { cls = 'cat-entertainment'; icon = '🎬'; }
  else if (cLower.includes('invest') || cLower.includes('mutual')) { cls = 'cat-investment'; icon = '📈'; }
  else if (cLower.includes('salary') || cLower.includes('income')) { cls = 'cat-salary'; icon = '💼'; }

  return `<span class="cat-badge ${cls}">${icon} ${cat}</span>`;
}

// Format Month Key (YYYY-MM) to User-Friendly Label (e.g. July 2026)
function formatMonthLabel(ymStr) {
  if (!ymStr) return '';
  const parts = ymStr.split('-');
  if (parts.length < 2) return ymStr;
  const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
  return d.toLocaleString('default', { month: 'long', year: 'numeric' });
}

function renderExpenses() {
  const tableBody = document.getElementById('expenseTableBody');
  if (!tableBody) return;

  // 1. Populate Month Filter options dynamically from expenses if needed
  const monthFilter = document.getElementById('expMonthFilter');
  if (monthFilter) {
    const prevMonthVal = monthFilter.value;
    const uniqueMonths = new Set();
    expenses.forEach(e => {
      if (e.date && e.date.length >= 7) {
        uniqueMonths.add(e.date.slice(0, 7)); // YYYY-MM
      }
    });
    const sortedMonths = Array.from(uniqueMonths).sort().reverse();
    let monthOpts = '<option value="all">📅 All Months</option>';
    sortedMonths.forEach(ym => {
      monthOpts += `<option value="${ym}">${formatMonthLabel(ym)}</option>`;
    });
    monthFilter.innerHTML = monthOpts;
    if (prevMonthVal && (prevMonthVal === 'all' || uniqueMonths.has(prevMonthVal))) {
      monthFilter.value = prevMonthVal;
    }
  }

  // 2. Populate Category Filter options dynamically
  const catFilter = document.getElementById('expCatFilter');
  if (catFilter) {
    const prevCatVal = catFilter.value;
    const uniqueCats = new Set(DEFAULT_CATEGORIES.expense || []);
    expenses.forEach(e => { if (e.category) uniqueCats.add(e.category); });
    let catOpts = '<option value="all">🏷️ All Categories</option>';
    Array.from(uniqueCats).sort().forEach(c => {
      catOpts += `<option value="${c}">${c}</option>`;
    });
    catFilter.innerHTML = catOpts;
    if (prevCatVal && (prevCatVal === 'all' || uniqueCats.has(prevCatVal))) {
      catFilter.value = prevCatVal;
    }
  }

  // 3. Apply Filters
  const searchInput = document.getElementById('expSearch');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const selectedMonth = monthFilter ? monthFilter.value : 'all';
  const selectedCat = catFilter ? catFilter.value : 'all';
  const sortSelect = document.getElementById('expSort');
  const sortMode = sortSelect ? sortSelect.value : 'date-desc';

  let filtered = expenses.filter(e => {
    // Month filter
    if (selectedMonth !== 'all') {
      if (!e.date || !e.date.startsWith(selectedMonth)) return false;
    }
    // Category filter
    if (selectedCat !== 'all') {
      if (e.category !== selectedCat) return false;
    }
    // Search query
    if (query) {
      const matchText = `${e.date} ${e.category} ${e.amount} ${e.note || ''}`.toLowerCase();
      if (!matchText.includes(query)) return false;
    }
    return true;
  });

  // 4. Sort
  filtered.sort((a, b) => {
    if (sortMode === 'date-asc') return new Date(a.date) - new Date(b.date);
    if (sortMode === 'amt-desc') return parseFloat(b.amount) - parseFloat(a.amount);
    if (sortMode === 'amt-asc') return parseFloat(a.amount) - parseFloat(b.amount);
    return new Date(b.date) - new Date(a.date); // default date-desc
  });

  // 5. Compute KPIs
  const totalFilteredAmt = filtered.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const avgFilteredSpend = filtered.length > 0 ? (totalFilteredAmt / filtered.length) : 0;

  // Category breakdown for KPIs and Chart
  const catSums = {};
  filtered.forEach(e => {
    const c = e.category || 'Other';
    catSums[c] = (catSums[c] || 0) + (parseFloat(e.amount) || 0);
  });

  let topCategory = 'None';
  let topCatAmt = 0;
  for (const [c, amt] of Object.entries(catSums)) {
    if (amt > topCatAmt) {
      topCatAmt = amt;
      topCategory = c;
    }
  }
  const topCatPct = totalFilteredAmt > 0 ? Math.round((topCatAmt / totalFilteredAmt) * 100) : 0;

  // Render KPI Summary Cards
  const kpiContainer = document.getElementById('expenseKpis');
  if (kpiContainer) {
    const periodLabel = selectedMonth !== 'all' ? formatMonthLabel(selectedMonth) : 'All Time';
    kpiContainer.innerHTML = `
      <div class="stat" style="border-top:3px solid #2563eb;">
        <div class="label">Total Spent (${periodLabel})</div>
        <div class="value" style="color:#1e293b;">₹${totalFilteredAmt.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
      </div>
      <div class="stat" style="border-top:3px solid #0f766e;">
        <div class="label">Top Category</div>
        <div class="value" style="font-size:1.35rem; color:#0f766e;">${topCategory} ${topCatPct ? `(${topCatPct}%)` : ''}</div>
      </div>
      <div class="stat" style="border-top:3px solid #d97706;">
        <div class="label">Transactions</div>
        <div class="value" style="color:#d97706;">${filtered.length}</div>
      </div>
      <div class="stat" style="border-top:3px solid #7c3aed;">
        <div class="label">Average Spend</div>
        <div class="value" style="color:#7c3aed;">₹${avgFilteredSpend.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
      </div>
    `;
  }

  // Update header count & sum
  const countBadge = document.getElementById('expenseFilteredCount');
  if (countBadge) countBadge.textContent = filtered.length;
  const sumBadge = document.getElementById('expenseFilteredSum');
  if (sumBadge) sumBadge.textContent = `Total: ₹${totalFilteredAmt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // 6. Update Charts
  renderExpenseCharts(catSums, totalFilteredAmt);

  // 7. Paginate and Render Table
  const emptyState = document.getElementById('expenseEmptyState');
  const table = document.getElementById('expenseTable');
  const paginationBar = document.getElementById('expensePagination');

  if (filtered.length === 0) {
    tableBody.innerHTML = '';
    if (table) table.classList.add('hidden');
    if (emptyState) emptyState.classList.remove('hidden');
    if (paginationBar) paginationBar.classList.add('hidden');
    return;
  }

  if (table) table.classList.remove('hidden');
  if (emptyState) emptyState.classList.add('hidden');
  if (paginationBar) paginationBar.classList.remove('hidden');

  const pageSizeNum = expensePageSize === 'all' ? filtered.length : parseInt(expensePageSize, 10);
  const totalPages = Math.ceil(filtered.length / pageSizeNum) || 1;
  if (expenseCurrentPage > totalPages) expenseCurrentPage = totalPages;
  if (expenseCurrentPage < 1) expenseCurrentPage = 1;

  const startIdx = (expenseCurrentPage - 1) * pageSizeNum;
  const endIdx = Math.min(startIdx + pageSizeNum, filtered.length);
  const pageItems = filtered.slice(startIdx, endIdx);

  // Render Rows
  tableBody.innerHTML = pageItems.map(e => {
    const parsed = parseExpenseNote(e.note);
    const amt = parseFloat(e.amount) || 0;
    const catBadgeHtml = getCategoryBadge(e.category);

    return `
      <tr>
        <td style="font-weight:500; color:#475569; white-space:nowrap;">${e.date || '–'}</td>
        <td>
          <div class="merchant-cell">
            <span class="merchant-name">${parsed.merchant}</span>
            ${parsed.details ? `<span class="merchant-sub">${parsed.details}</span>` : ''}
          </div>
        </td>
        <td>${catBadgeHtml}</td>
        <td><span class="source-badge ${parsed.sourceClass}">${parsed.source}</span></td>
        <td style="text-align:right;">
          <span class="amount-expense">- ₹${amt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </td>
        <td style="text-align:center;">
          <button type="button" class="btn-delete-row" onclick="deleteExpense('${e.id}')" title="Delete transaction">✕</button>
        </td>
      </tr>
    `;
  }).join('');

  // Update Pagination Controls
  const pageInfo = document.getElementById('expensePageInfo');
  if (pageInfo) {
    pageInfo.textContent = `Showing ${startIdx + 1}–${endIdx} of ${filtered.length} transactions`;
  }
  const pageNumSpan = document.getElementById('expCurrentPageNum');
  if (pageNumSpan) {
    pageNumSpan.textContent = `${expenseCurrentPage} / ${totalPages}`;
  }
  const prevBtn = document.getElementById('expPrevPage');
  if (prevBtn) prevBtn.disabled = expenseCurrentPage <= 1;
  const nextBtn = document.getElementById('expNextPage');
  if (nextBtn) nextBtn.disabled = expenseCurrentPage >= totalPages;
}

// Render Category Donut & Monthly Trend Bar Charts
function renderExpenseCharts(catSums, totalAmt) {
  // Chart 1: Category Donut
  const catCanvas = document.getElementById('expenseCategoryChart');
  const catHeaderTotal = document.getElementById('categoryChartTotal');
  if (catHeaderTotal) {
    catHeaderTotal.textContent = `₹${totalAmt.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }

  if (catCanvas && typeof Chart !== 'undefined') {
    const sortedCats = Object.entries(catSums).sort((a, b) => b[1] - a[1]);
    const labels = sortedCats.map(x => x[0]);
    const data = sortedCats.map(x => x[1]);

    const palette = [
      '#0284c7', '#ea580c', '#16a34a', '#d946ef', '#dc2626',
      '#0d9488', '#6366f1', '#ca8a04', '#8b5cf6', '#059669',
      '#475569', '#f43f5e', '#3b82f6', '#10b981', '#f59e0b'
    ];

    if (expenseCategoryChartInstance) {
      expenseCategoryChartInstance.destroy();
      expenseCategoryChartInstance = null;
    }

    if (data.length > 0) {
      const ctx = catCanvas.getContext('2d');
      expenseCategoryChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: labels,
          datasets: [{
            data: data,
            backgroundColor: palette.slice(0, data.length),
            borderWidth: 2,
            borderColor: '#ffffff',
            hoverOffset: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: {
                boxWidth: 12,
                font: { size: 11 },
                generateLabels: function(chart) {
                  const d = chart.data;
                  if (d.labels.length && d.datasets.length) {
                    return d.labels.slice(0, 7).map((label, i) => {
                      const val = d.datasets[0].data[i];
                      const pct = totalAmt > 0 ? Math.round((val / totalAmt) * 100) : 0;
                      return {
                        text: `${label} (${pct}%)`,
                        fillStyle: d.datasets[0].backgroundColor[i],
                        hidden: false,
                        index: i
                      };
                    });
                  }
                  return [];
                }
              }
            },
            tooltip: {
              callbacks: {
                label: function(item) {
                  const val = item.raw || 0;
                  const pct = totalAmt > 0 ? ((val / totalAmt) * 100).toFixed(1) : 0;
                  return ` ₹${val.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${pct}%)`;
                }
              }
            }
          },
          cutout: '62%'
        }
      });
    }
  }

  // Chart 2: Monthly Spending Trend Bar Chart
  const monthlyCanvas = document.getElementById('expenseMonthlyChart');
  if (monthlyCanvas && typeof Chart !== 'undefined') {
    const monthlySums = {};
    expenses.forEach(e => {
      if (e.date && e.date.length >= 7) {
        const ym = e.date.slice(0, 7);
        monthlySums[ym] = (monthlySums[ym] || 0) + (parseFloat(e.amount) || 0);
      }
    });

    const sortedMonths = Object.keys(monthlySums).sort();
    const monthLabels = sortedMonths.map(ym => {
      const parts = ym.split('-');
      const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
      return d.toLocaleString('default', { month: 'short', year: '2-digit' });
    });
    const monthData = sortedMonths.map(ym => monthlySums[ym]);

    if (expenseMonthlyChartInstance) {
      expenseMonthlyChartInstance.destroy();
      expenseMonthlyChartInstance = null;
    }

    if (monthData.length > 0) {
      const ctx = monthlyCanvas.getContext('2d');
      expenseMonthlyChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: monthLabels,
          datasets: [{
            label: 'Total Expenses',
            data: monthData,
            backgroundColor: 'rgba(239, 68, 68, 0.75)',
            borderColor: '#dc2626',
            borderWidth: 1.5,
            borderRadius: 6,
            maxBarThickness: 45
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function(item) {
                  return ` Spent: ₹${item.raw.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
                }
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                callback: function(val) {
                  return '₹' + (val >= 1000 ? (val / 1000).toFixed(0) + 'k' : val);
                },
                font: { size: 10 }
              },
              grid: { color: '#f1f5f9' }
            },
            x: {
              grid: { display: false },
              ticks: { font: { size: 11, weight: '500' } }
            }
          }
        }
      });
    }
  }
}

// Filter and Pagination Handlers
window.handleExpenseFilterChange = function() {
  expenseCurrentPage = 1;
  renderExpenses();
};

window.resetExpenseFilters = function() {
  const searchInput = document.getElementById('expSearch');
  if (searchInput) searchInput.value = '';
  const monthFilter = document.getElementById('expMonthFilter');
  if (monthFilter) monthFilter.value = 'all';
  const catFilter = document.getElementById('expCatFilter');
  if (catFilter) catFilter.value = 'all';
  const sortSelect = document.getElementById('expSort');
  if (sortSelect) sortSelect.value = 'date-desc';
  expenseCurrentPage = 1;
  renderExpenses();
};

window.prevExpensePage = function() {
  if (expenseCurrentPage > 1) {
    expenseCurrentPage--;
    renderExpenses();
  }
};

window.nextExpensePage = function() {
  expenseCurrentPage++;
  renderExpenses();
};

window.changeExpensePageSize = function(size) {
  expensePageSize = size;
  expenseCurrentPage = 1;
  renderExpenses();
};

window.toggleExpenseForm = function() {
  const card = document.getElementById('manualEntryCard');
  const icon = document.getElementById('toggleAddExpenseIcon');
  const text = document.getElementById('toggleAddExpenseText');
  if (!card) return;
  const isHidden = card.classList.contains('hidden');
  if (isHidden) {
    card.classList.remove('hidden');
    if (icon) icon.textContent = '✕';
    if (text) text.textContent = 'Close';
    document.getElementById('expDate')?.focus();
  } else {
    card.classList.add('hidden');
    if (icon) icon.textContent = '➕';
    if (text) text.textContent = 'Add Entry';
  }
};

window.switchManualForm = function(type) {
  const expForm = document.getElementById('expenseForm');
  const incForm = document.getElementById('incomeForm');
  const tabExp = document.getElementById('tabManualExp');
  const tabInc = document.getElementById('tabManualInc');
  if (!expForm || !incForm) return;

  if (type === 'expense') {
    expForm.classList.remove('hidden');
    incForm.classList.add('hidden');
    tabExp?.classList.add('active');
    tabInc?.classList.remove('active');
  } else {
    expForm.classList.add('hidden');
    incForm.classList.remove('hidden');
    tabExp?.classList.remove('active');
    tabInc?.classList.add('active');
  }
};

// Auto-clean all stored transaction notes (removes /sent U/, technical prefixes, branch numbers)
window.cleanUpAllStoredExpenses = function() {
  if (!expenses || expenses.length === 0) {
    alert('No stored expenses to clean.');
    return;
  }
  let count = 0;
  expenses.forEach(e => {
    if (e.note) {
      const parsed = parseExpenseNote(e.note);
      const newNote = parsed.details ? `${parsed.merchant} [${parsed.source}] [${parsed.details}]` : `${parsed.merchant} [${parsed.source}]`;
      if (newNote !== e.note) {
        e.note = newNote;
        count++;
      }
    }
  });
  saveData('ft_expenses', expenses);
  renderAll();
  alert(`✨ Successfully cleaned up narration for ${count} transaction(s)!`);
};

function renderChores() {
  const list = document.getElementById('choreList');
  if (!list) return;
  list.innerHTML = chores.map(c => `
    <li>
      <span class="${c.done ? 'done' : ''}" onclick="toggleChore('${c.id}')" style="cursor:pointer;">${c.task}</span>
      <button onclick="deleteChore('${c.id}')" style="background:#c0392b; padding:0.3rem 0.6rem;">✕</button>
    </li>
  `).join('');
}

function renderCriteria() {
  const container = document.getElementById('criteriaList');
  if (!container) return;
  container.innerHTML = criteria.map(c => `
    <div class="check-item">
      <label style="flex:1;">
        <input type="checkbox" ${c.achieved ? 'checked' : ''} onchange="toggleCriteria('${c.id}')">
        ${c.name}
      </label>
      <span style="font-size:0.8rem; color:#666;">${c.achieved ? '✔ Done' : 'Pending'}</span>
    </div>
  `).join('');
}

function renderGoals() {
  const list = document.getElementById('goalList');
  if (!list) return;
  list.innerHTML = goals.map(g => {
    const progress = g.target > 0 ? Math.min((g.current / g.target) * 100, 100) : 0;
    return `
      <li style="flex-direction:column; align-items:stretch;">
        <div style="display:flex; justify-content:space-between;">
          <strong>${g.name}</strong>
          <span>₹${g.current} / ₹${g.target} ${g.deadline ? '(by '+g.deadline+')' : ''}</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${progress}%;"></div></div>
        <div style="display:flex; gap:0.5rem; margin-top:4px;">
          <input type="number" placeholder="Update current" id="update-${g.id}" style="width:110px;">
          <button onclick="updateGoal('${g.id}')">Update</button>
          <button onclick="deleteGoal('${g.id}')" style="background:#c0392b;">✕</button>
        </div>
      </li>
    `;
  }).join('');
}

function renderAll() {
  renderDashboard();
  renderExpenses();
  renderChores();
  renderCriteria();
  renderGoals();
  renderCategories();
  populateDropdowns();
  if (typeof renderCreditDashboard === 'function') renderCreditDashboard();
  if (typeof renderMerchantRulesList === 'function') renderMerchantRulesList();
  if (typeof renderCreditProfile === 'function') renderCreditProfile();
}

// ============================================
// CRUD USER ACTIONS (Exposed to window)
// ============================================

window.deleteExpense = function(id) {
  expenses = expenses.filter(e => e.id !== id);
  saveData('ft_expenses', expenses);
  renderAll();
};

window.deleteChore = function(id) {
  chores = chores.filter(c => c.id !== id);
  saveData('ft_chores', chores);
  renderAll();
};

window.toggleChore = function(id) {
  const chore = chores.find(c => c.id === id);
  if (chore) chore.done = !chore.done;
  saveData('ft_chores', chores);
  renderChores();
};

window.toggleCriteria = function(id) {
  const item = criteria.find(c => c.id == id);
  if (item) item.achieved = !item.achieved;
  saveData('ft_criteria', criteria);
  renderCriteria();
};

window.updateGoal = function(id) {
  const input = document.getElementById(`update-${id}`);
  if (!input) return;
  const val = parseFloat(input.value);
  if (!isNaN(val)) {
    const goal = goals.find(g => g.id === id);
    if (goal) goal.current = val;
    saveData('ft_goals', goals);
    renderGoals();
  }
};

window.deleteGoal = function(id) {
  goals = goals.filter(g => g.id !== id);
  saveData('ft_goals', goals);
  renderGoals();
};

// ============================================
// SUBTAB & TAB SWITCHING
// ============================================

window.switchStatementSubtab = function(tabName, btn) {
  document.querySelectorAll('#statements .subtab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#statements .subview-panel').forEach(p => p.classList.add('hidden'));
  if (btn) btn.classList.add('active');
  if (tabName === 'parser') {
    document.getElementById('subviewParser')?.classList.remove('hidden');
  } else if (tabName === 'alerts') {
    document.getElementById('subviewAlerts')?.classList.remove('hidden');
  } else if (tabName === 'credit') {
    document.getElementById('subviewCredit')?.classList.remove('hidden');
    if (typeof renderCreditProfile === 'function') renderCreditProfile();
  } else if (tabName === 'rules') {
    document.getElementById('subviewRules')?.classList.remove('hidden');
    if (typeof renderMerchantRulesList === 'function') renderMerchantRulesList();
  }
};

// ============================================
// LOCAL BACKUP & EXPORT/IMPORT
// ============================================

function getAllData() {
  return {
    expenses: loadData('ft_expenses', []),
    income: loadData('ft_income', []),
    chores: loadData('ft_chores', []),
    criteria: loadData('ft_criteria', []),
    goals: loadData('ft_goals', []),
    categories: loadData('ft_categories', DEFAULT_CATEGORIES),
    merchantRules: loadData('ft_merchant_rules', DEFAULT_MERCHANT_RULES),
    creditProfile: loadData('ft_credit_profile', null),
    exportDate: new Date().toISOString()
  };
}

function restoreData(data) {
  if (data.expenses) { saveData('ft_expenses', data.expenses); expenses = data.expenses; }
  if (data.income) { saveData('ft_income', data.income); incomeEntries = data.income; }
  if (data.chores) { saveData('ft_chores', data.chores); chores = data.chores; }
  if (data.criteria) { saveData('ft_criteria', data.criteria); criteria = data.criteria; }
  if (data.goals) { saveData('ft_goals', data.goals); goals = data.goals; }
  if (data.categories) { saveData('ft_categories', data.categories); categories = data.categories; }
  if (data.merchantRules) { saveData('ft_merchant_rules', data.merchantRules); merchantRules = data.merchantRules; }
  if (data.creditProfile) { saveData('ft_credit_profile', data.creditProfile); creditProfile = data.creditProfile; }
  renderAll();
}

window.exportData = function() {
  const data = getAllData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fintrack_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

window.importData = function() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(event) {
      try {
        const data = JSON.parse(event.target.result);
        if (!data.expenses && !data.income) throw new Error('Invalid backup file.');
        if (confirm('⚠️ This will OVERWRITE all current data. Continue?')) {
          restoreData(data);
          alert('✅ Data restored successfully!');
        }
      } catch (err) {
        alert('❌ Failed to import: ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
};

window.exportCSV = function() {
  if (expenses.length === 0) { alert('No expenses to export.'); return; }
  let csv = 'Date,Category,Amount,Note\n';
  expenses.forEach(e => {
    csv += `${e.date},${e.category},${e.amount},"${e.note||''}"\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `expenses_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// ============================================
// BOOTSTRAP, FORM BINDINGS & DROPZONE SETUP
// ============================================

document.addEventListener('DOMContentLoaded', function() {
  // Setup Forms
  const expenseForm = document.getElementById('expenseForm');
  if (expenseForm) {
    expenseForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const exp = {
        id: Date.now().toString(),
        date: document.getElementById('expDate').value,
        category: document.getElementById('expCategory').value,
        amount: parseFloat(document.getElementById('expAmount').value),
        note: document.getElementById('expNote').value
      };
      expenses.push(exp);
      saveData('ft_expenses', expenses);
      this.reset();
      document.getElementById('expDate').value = new Date().toISOString().slice(0,10);
      renderAll();
    });
  }

  const incomeForm = document.getElementById('incomeForm');
  if (incomeForm) {
    incomeForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const inc = {
        id: Date.now().toString(),
        date: document.getElementById('incDate').value,
        category: document.getElementById('incCategory').value || 'Other',
        amount: parseFloat(document.getElementById('incAmount').value),
        source: document.getElementById('incSource').value
      };
      incomeEntries.push(inc);
      saveData('ft_income', incomeEntries);
      this.reset();
      document.getElementById('incDate').value = new Date().toISOString().slice(0,10);
      renderAll();
    });
  }

  const choreForm = document.getElementById('choreForm');
  if (choreForm) {
    choreForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const task = document.getElementById('choreInput').value.trim();
      if (task) {
        chores.push({ id: Date.now().toString(), task, done: false });
        saveData('ft_chores', chores);
        document.getElementById('choreInput').value = '';
        renderChores();
      }
    });
  }

  const goalForm = document.getElementById('goalForm');
  if (goalForm) {
    goalForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const goal = {
        id: Date.now().toString(),
        name: document.getElementById('goalName').value,
        target: parseFloat(document.getElementById('goalTarget').value),
        current: parseFloat(document.getElementById('goalCurrent').value) || 0,
        deadline: document.getElementById('goalDeadline').value
      };
      goals.push(goal);
      saveData('ft_goals', goals);
      this.reset();
      renderGoals();
    });
  }

  const categoryForm = document.getElementById('categoryForm');
  if (categoryForm) {
    categoryForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const name = document.getElementById('newCategoryName').value.trim();
      const type = document.getElementById('categoryType').value;
      if (addCategory(name, type)) {
        this.reset();
        renderAll();
      }
    });
  }

  // Setup Tab Switching
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      this.classList.add('active');
      const panel = document.getElementById(this.dataset.panel);
      if (panel) panel.classList.add('active');
      if (this.dataset.panel === 'dashboard') {
        renderDashboard();
        updatePrediction();
      } else if (this.dataset.panel === 'statements') {
        if (typeof renderMerchantRulesList === 'function') renderMerchantRulesList();
        if (typeof renderCreditProfile === 'function') renderCreditProfile();
      } else if (this.dataset.panel === 'expenses') {
        renderExpenses();
      }
    });
  });

  // Setup Dropzones
  if (typeof setupDropzone === 'function') {
    setupDropzone('statementDropzone', 'statementFileInput', file => handleStatementFileUpload(file));
    setupDropzone('creditDropzone', 'creditFileInput', file => {
      setParsingStatus(true, `Reading Credit Report: ${file.name}...`);
      if (file.name.toLowerCase().endsWith('.pdf')) {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            await parsePDFDocument(e.target.result);
          } catch(err) {
            setParsingStatus(true, 'Failed to parse credit report: ' + err.message, true);
          }
        };
        reader.readAsArrayBuffer(file);
      } else if (file.name.toLowerCase().endsWith('.json') || file.name.toLowerCase().endsWith('.txt')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            parseCreditReportText(e.target.result);
            setParsingStatus(false);
          } catch(err) {
            setParsingStatus(true, 'Failed to parse credit report JSON: ' + err.message, true);
          }
        };
        reader.readAsText(file);
      }
    });
  }

  // Initial Render & Date Defaults
  renderAll();
  const today = new Date().toISOString().slice(0,10);
  const expDate = document.getElementById('expDate'); if (expDate) expDate.value = today;
  const incDate = document.getElementById('incDate'); if (incDate) incDate.value = today;
  autoFillSavings();

  // Load Google APIs
  const script1 = document.createElement('script');
  script1.src = 'https://apis.google.com/js/api.js';
  script1.onload = gapiLoaded;
  document.head.appendChild(script1);

  const script2 = document.createElement('script');
  script2.src = 'https://accounts.google.com/gsi/client';
  script2.onload = gisLoaded;
  document.head.appendChild(script2);
});

// ============================================
// PWA SERVICE WORKER
// ============================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swCode = `
      const CACHE_NAME = 'fintrack-v1';
      const ASSETS = [
        self.location.href,
        'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
        'https://apis.google.com/js/api.js',
        'https://accounts.google.com/gsi/client'
      ];
      self.addEventListener('install', e => {
        e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
      });
      self.addEventListener('fetch', e => {
        e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
      });
    `;
    const blob = new Blob([swCode], {type: 'application/javascript'});
    const swUrl = URL.createObjectURL(blob);
    navigator.serviceWorker.register(swUrl)
      .catch(err => console.log('SW registration failed (may need https/localhost)', err));
  });
}

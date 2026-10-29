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

function renderExpenses() {
  const list = document.getElementById('expenseList');
  if (!list) return;
  const sorted = [...expenses].sort((a,b) => new Date(b.date) - new Date(a.date));
  list.innerHTML = sorted.slice(0,15).map(e => `
    <li>
      <span>${e.date} – ${e.category} – ₹${parseFloat(e.amount).toFixed(2)} ${e.note ? '('+e.note+')' : ''}</span>
      <button onclick="deleteExpense('${e.id}')" style="background:#c0392b; padding:0.3rem 0.6rem;">✕</button>
    </li>
  `).join('');
}

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

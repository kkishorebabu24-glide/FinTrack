/**
 * FinTrack - Reconciliation & Deduplication Engine
 * Conforms to ISO/IEC 25010 maintainability, modularity, and single responsibility.
 * 
 * Handles:
 * - Cross-source merge of Instant Alert Emails & Monthly Bank/Card Statements
 * - Comprehensive composite deduplication against ledger and within staging
 * - Staging table rendering, interactive overrides, categorization review, and batch ledger import
 */

// ============================================
// CROSS-SOURCE MERGE & DEDUPLICATION ENGINE
// ============================================

/**
 * Calculates calendar days between two date strings
 */
function daysBetween(d1, d2) {
  const t1 = new Date(d1).getTime();
  const t2 = new Date(d2).getTime();
  return Math.abs(t1 - t2) / (1000 * 60 * 60 * 24);
}

/**
 * Merges Instant Alert Emails with Monthly Statement Transactions (Zero Duplication)
 * Cross-references reference IDs (RRN/UTR) or composite fuzzy match (amount + direction + swipe date + merchant).
 */
function mergeAlertsAndStatements(alertTxns = [], statementTxns = []) {
  const merged = [];
  const matchedStatementIndices = new Set();
  const matchedAlertIndices = new Set();

  // Match each Alert with Statement Lines
  alertTxns.forEach((a, aIdx) => {
    let matchedStmtIdx = -1;

    for (let sIdx = 0; sIdx < statementTxns.length; sIdx++) {
      if (matchedStatementIndices.has(sIdx)) continue;
      const s = statementTxns[sIdx];

      // 1. Exact Ref ID / UPI RRN match
      if (a.refId && s.refId && a.refId === s.refId) {
        matchedStmtIdx = sIdx;
        break;
      }

      // 2. Fuzzy Composite match: direction + exact amount + swipe date within 3 days + merchant overlap
      if (a.isExpense === s.isExpense &&
          Math.abs(a.amount - s.amount) < 0.01 &&
          daysBetween(a.date, s.date) <= 3 &&
          (merchantMatches(a.merchant, s.merchant) || merchantMatches(a.merchant, s.rawNarration))) {
        matchedStmtIdx = sIdx;
        break;
      }
    }

    if (matchedStmtIdx !== -1) {
      // Merge Alert + Statement into a single enriched record
      const s = statementTxns[matchedStmtIdx];
      matchedStatementIndices.add(matchedStmtIdx);
      matchedAlertIndices.add(aIdx);

      merged.push({
        id: a.id,
        date: a.date, // keep original swipe/alert date
        time: a.time,
        amount: a.amount,
        isExpense: a.isExpense,
        merchant: a.merchant || s.merchant,
        rawNarration: `Statement: ${s.rawNarration} | Alert: ${a.rawNarration}`,
        category: a.category || s.category,
        refId: a.refId || s.refId || '',
        source: '⚡ Merged (Alert + Statement)',
        confidence: 100,
        badgeClass: 'conf-100',
        matchLabel: 'Merged (Alert+Report)',
        checked: true,
        isDuplicate: false,
        isMerged: true,
        remember: true
      });
    } else {
      merged.push(a);
    }
  });

  // Add remaining unmatched Statement lines
  statementTxns.forEach((s, sIdx) => {
    if (!matchedStatementIndices.has(sIdx)) {
      merged.push(s);
    }
  });

  return merged;
}

/**
 * Ledger Deduplication: marks and unchecks items already recorded in Expenses or Income
 */
function deduplicateAgainstLedger(stagedItems, existingExpenses = [], existingIncome = []) {
  stagedItems.forEach(t => {
    const ledger = t.isExpense ? existingExpenses : existingIncome;
    const dup = ledger.find(e => {
      // 1. Ref ID match
      if (t.refId && e.note && e.note.includes(t.refId)) return true;
      // 2. Amount and Date check
      const amtMatch = Math.abs(parseFloat(e.amount) - t.amount) < 0.01;
      if (!amtMatch) return false;
      const tDate = new Date(t.date).getTime();
      const eDate = new Date(e.date).getTime();
      const diffDays = Math.abs(tDate - eDate) / (1000 * 60 * 60 * 24);
      if (diffDays <= 2) {
        const normNote = (e.note || e.source || '').toLowerCase();
        const normMerchant = (t.merchant || '').toLowerCase();
        if (normNote.includes(normMerchant) || normMerchant.includes(normNote) || merchantMatches(t.merchant, normNote)) return true;
        if (diffDays === 0) return true; // exact date & amount
      }
      return false;
    });

    if (dup) {
      t.isDuplicate = true;
      t.checked = false; // Never auto-check duplicates!
      t.dupReason = `Already in FinTrack on ${dup.date} (₹${dup.amount})`;
    } else {
      t.isDuplicate = false;
    }
  });
  return stagedItems;
}

/**
 * Recalculates merged transactions and refreshes the staging table
 */
function recalculateStagedAndRender() {
  const merged = mergeAlertsAndStatements(currentEmailAlertTransactions, currentStatementTransactions);
  // Ensure categories are predicted
  merged.forEach(t => {
    if (!t.category || t.category === 'Other') {
      const pred = predictCategory(t.merchant, t.rawNarration, t.isExpense);
      t.category = pred.category;
      if (!t.isMerged) {
        t.confidence = pred.confidence;
        t.badgeClass = pred.badgeClass;
        t.matchLabel = pred.label;
      }
    }
  });
  deduplicateAgainstLedger(merged, expenses, incomeEntries);
  stagedTransactions = merged;
  renderStagingTable();
}

// ============================================
// STAGING TABLE RENDERING & UI
// ============================================

function renderStagingTable() {
  const section = document.getElementById('stagingSection');
  if (!section) return;
  section.classList.remove('hidden');

  // Counts
  const totalCount = stagedTransactions.length;
  const debitCount = stagedTransactions.filter(t => t.isExpense).length;
  const creditCount = stagedTransactions.filter(t => !t.isExpense).length;
  const mergedCount = stagedTransactions.filter(t => t.isMerged || (t.source && t.source.includes('Merged'))).length;
  const alertsCount = stagedTransactions.filter(t => t.source && t.source.includes('Alert') && !t.isMerged).length;
  const stmtsCount = stagedTransactions.filter(t => t.source && t.source.includes('Statement') && !t.isMerged).length;
  const reviewCount = stagedTransactions.filter(t => t.confidence < 80).length;
  const dupCount = stagedTransactions.filter(t => t.isDuplicate).length;

  const countAll = document.getElementById('countAll'); if (countAll) countAll.textContent = totalCount;
  const countDebit = document.getElementById('countDebit'); if (countDebit) countDebit.textContent = debitCount;
  const countCredit = document.getElementById('countCredit'); if (countCredit) countCredit.textContent = creditCount;
  const cMerged = document.getElementById('countMerged'); if (cMerged) cMerged.textContent = mergedCount;
  const cAlerts = document.getElementById('countAlerts'); if (cAlerts) cAlerts.textContent = alertsCount;
  const cStmts = document.getElementById('countStmts'); if (cStmts) cStmts.textContent = stmtsCount;
  const countReview = document.getElementById('countReview'); if (countReview) countReview.textContent = reviewCount;
  const countDup = document.getElementById('countDup'); if (countDup) countDup.textContent = dupCount;

  // Filter
  let displayed = stagedTransactions;
  if (stagedFilter === 'debit') displayed = displayed.filter(t => t.isExpense);
  else if (stagedFilter === 'credit') displayed = displayed.filter(t => !t.isExpense);
  else if (stagedFilter === 'merged') displayed = displayed.filter(t => t.isMerged || (t.source && t.source.includes('Merged')));
  else if (stagedFilter === 'alerts') displayed = displayed.filter(t => t.source && t.source.includes('Alert') && !t.isMerged);
  else if (stagedFilter === 'stmts') displayed = displayed.filter(t => t.source && t.source.includes('Statement') && !t.isMerged);
  else if (stagedFilter === 'review') displayed = displayed.filter(t => t.confidence < 80);
  else if (stagedFilter === 'dup') displayed = displayed.filter(t => t.isDuplicate);

  // Hide Duplicates toggle (unless viewing the Duplicates filter)
  if (hideDuplicates && stagedFilter !== 'dup') {
    displayed = displayed.filter(t => !t.isDuplicate);
  }
  const hideDupToggle = document.getElementById('hideDupToggle');
  if (hideDupToggle) hideDupToggle.checked = hideDuplicates;

  const tbody = document.getElementById('stagingTableBody');
  if (!tbody) return;
  const allExpenseCats = categories.expense;
  const allIncomeCats = categories.income;

  tbody.innerHTML = displayed.map(t => {
    const catList = t.isExpense ? allExpenseCats : allIncomeCats;
    const catOptions = catList.map(c =>
      `<option value="${c}" ${c === t.category ? 'selected' : ''}>${c}</option>`
    ).join('');

    let sourceBadge = '';
    if (t.isMerged) {
      sourceBadge = '<span class="badge source-merged" title="Merged from instant Alert & Statement">⚡ Merged</span>';
    } else if (t.source && t.source.includes('Alert')) {
      sourceBadge = '<span class="badge source-alert" title="Instant Alert Email / SMS">✉️ Alert</span>';
    } else {
      sourceBadge = '<span class="badge source-statement" title="Monthly Bank/Card Statement">📄 Stmt</span>';
    }

    const refSnippet = t.refId ? `<div style="font-size:0.7rem; color:#64748b; font-family:monospace; margin-top:2px;" title="Reference / UTR / RRN: ${t.refId}">#${t.refId.length > 8 ? t.refId.slice(-8) : t.refId}</div>` : '';

    return `
      <tr class="${t.isDuplicate ? 'is-duplicate' : ''}">
        <td style="text-align:center;">
          <input type="checkbox" ${t.checked ? 'checked' : ''} onchange="toggleStagedCheckbox('${t.id}', this.checked)">
        </td>
        <td>
          <input type="date" value="${t.date}" style="padding:0.25rem; font-size:0.8rem; width:100px;" onchange="updateStagedDate('${t.id}', this.value)">
        </td>
        <td>
          ${sourceBadge}
          ${refSnippet}
        </td>
        <td>
          <div class="merchant-name">${t.merchant}</div>
          <div class="narration-sub" title="${t.rawNarration}">${t.rawNarration}</div>
        </td>
        <td>
          <span class="badge ${t.isExpense ? 'type-debit' : 'type-credit'}">${t.isExpense ? 'Expense' : 'Income'}</span>
        </td>
        <td style="text-align:right; font-weight:600; color:${t.isExpense ? '#c0392b' : '#27ae60'};">
          ${t.isExpense ? '-' : '+'}₹${parseFloat(t.amount).toFixed(2)}
        </td>
        <td>
          <select style="padding:0.3rem; font-size:0.8rem; width:100%;" onchange="updateStagedCategory('${t.id}', this.value)">
            ${catOptions}
          </select>
        </td>
        <td>
          <span class="badge ${t.badgeClass}">${t.matchLabel}</span>
          ${t.isDuplicate ? `<br><span class="badge dup-badge" style="margin-top:2px;" title="${t.dupReason || 'Already recorded in FinTrack'}">⚠️ In FinTrack</span>` : ''}
        </td>
        <td style="text-align:center;">
          <input type="checkbox" ${t.remember ? 'checked' : ''} onchange="toggleStagedRemember('${t.id}', this.checked)" title="Remember this category for ${t.merchant}">
        </td>
      </tr>
    `;
  }).join('');

  updateImportStats();
}

function updateImportStats() {
  const statsElem = document.getElementById('importStats');
  if (!statsElem) return;
  const selected = stagedTransactions.filter(t => t.checked);
  const totalAmt = selected.reduce((s, t) => s + (t.isExpense ? -t.amount : t.amount), 0);
  const expCount = selected.filter(t => t.isExpense).length;
  const incCount = selected.filter(t => !t.isExpense).length;
  statsElem.textContent =
    `Selected: ${selected.length} items (${expCount} Expenses, ${incCount} Incomes) • Net: ₹${totalAmt.toLocaleString('en-IN', {minimumFractionDigits:2})}`;
}

// ============================================
// STAGING USER INTERACTIONS
// ============================================

window.updateStagedCategory = function(id, cat) {
  const item = stagedTransactions.find(t => t.id === id);
  if (item) {
    item.category = cat;
    item.confidence = 100;
    item.badgeClass = 'conf-100';
    item.matchLabel = 'Manual (100%)';
    renderStagingTable();
  }
};

window.updateStagedDate = function(id, date) {
  const item = stagedTransactions.find(t => t.id === id);
  if (item) item.date = date;
};

window.toggleStagedCheckbox = function(id, checked) {
  const item = stagedTransactions.find(t => t.id === id);
  if (item) item.checked = checked;
  updateImportStats();
};

window.toggleStagedRemember = function(id, checked) {
  const item = stagedTransactions.find(t => t.id === id);
  if (item) item.remember = checked;
};

window.toggleAllCheckboxes = function(checked) {
  stagedTransactions.forEach(t => t.checked = checked);
  renderStagingTable();
};

window.selectAllStaged = function(checked) {
  stagedTransactions.forEach(t => t.checked = checked);
  const headerCb = document.getElementById('headerCheckbox');
  if (headerCb) headerCb.checked = checked;
  renderStagingTable();
};

window.selectOnlyNetNew = function() {
  stagedTransactions.forEach(t => {
    t.checked = !t.isDuplicate;
  });
  const headerCb = document.getElementById('headerCheckbox');
  if (headerCb) headerCb.checked = stagedTransactions.length > 0 && stagedTransactions.every(t => t.checked);
  renderStagingTable();
};

window.toggleHideDuplicates = function(checked) {
  hideDuplicates = checked;
  renderStagingTable();
};

window.deselectDuplicates = function() {
  stagedTransactions.forEach(t => {
    if (t.isDuplicate) t.checked = false;
  });
  renderStagingTable();
};

window.clearStaging = function() {
  if (confirm('Discard all staged transactions?')) {
    stagedTransactions = [];
    currentStatementTransactions = [];
    currentEmailAlertTransactions = [];
    const sec = document.getElementById('stagingSection');
    if (sec) sec.classList.add('hidden');
  }
};

window.filterStaged = function(filterName) {
  stagedFilter = filterName;
  document.querySelectorAll('.filter-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filterName);
  });
  renderStagingTable();
};

// ============================================
// BATCH IMPORT SELECTED TRANSACTIONS
// ============================================

window.importSelectedTransactions = function() {
  const toImport = stagedTransactions.filter(t => t.checked);
  if (toImport.length === 0) {
    alert('Please select at least one transaction to import.');
    return;
  }

  let expCount = 0;
  let incCount = 0;
  let rulesLearned = 0;

  toImport.forEach(t => {
    let sourceTag = '';
    if (t.isMerged) sourceTag = '[Merged Alert+Report]';
    else if (t.source && t.source.includes('Alert')) sourceTag = '[Email Alert]';
    else if (t.source && t.source.includes('Statement')) sourceTag = '[Bank Statement]';
    const refTag = t.refId ? `[Ref:${t.refId}]` : '';
    const extraInfo = [refTag, sourceTag].filter(Boolean).join(' ');

    if (t.isExpense) {
      const finalNote = extraInfo ? `${t.merchant} ${extraInfo}` : t.merchant;
      expenses.push({
        id: Date.now() + Math.random().toString(),
        date: t.date,
        category: t.category,
        amount: t.amount,
        note: finalNote
      });
      expCount++;
    } else {
      const finalSource = extraInfo ? `${t.merchant} ${extraInfo}` : t.merchant;
      incomeEntries.push({
        id: Date.now() + Math.random().toString(),
        date: t.date,
        category: t.category,
        amount: t.amount,
        source: finalSource
      });
      incCount++;
    }

    // Save rule if remember is checked
    if (t.remember && t.merchant && t.merchant !== 'Unknown') {
      merchantRules[t.merchant.toLowerCase()] = t.category;
      rulesLearned++;
    }
  });

  saveData('ft_expenses', expenses);
  saveData('ft_income', incomeEntries);
  saveData('ft_merchant_rules', merchantRules);

  // Remove imported transactions from staged lists
  const importedIds = new Set(toImport.map(t => t.id));
  stagedTransactions = stagedTransactions.filter(t => !importedIds.has(t.id));
  currentStatementTransactions = currentStatementTransactions.filter(t => !importedIds.has(t.id));
  currentEmailAlertTransactions = currentEmailAlertTransactions.filter(t => !importedIds.has(t.id));

  const sec = document.getElementById('stagingSection');
  if (stagedTransactions.length === 0) {
    if (sec) sec.classList.add('hidden');
  } else {
    renderStagingTable();
  }

  if (typeof renderAll === 'function') renderAll();
  alert(`✅ Successfully imported ${expCount} expenses & ${incCount} income entries!\nLearned ${rulesLearned} merchant rules for future imports.`);
};

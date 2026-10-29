/**
 * FinTrack - Credit Bureau Report Extractor (CIBIL / Experian)
 * Standard: ISO/IEC 25010 Modularity & High Cohesion
 */

// Credit Bureau Report Extractor (CIBIL / Experian)
function parseCreditReportText(fullText) {
  const profile = {
    score: null,
    rating: 'Unknown',
    ratingColor: '#10b981',
    totalCreditLimit: 0,
    totalOutstanding: 0,
    utilizationPct: 0,
    totalMonthlyEmi: 0,
    accounts: [],
    rawExtractedAt: new Date().toISOString()
  };

  // 1. Extract Score (300 - 900)
  const scoreMatch = fullText.match(/(?:cibil|experian|equifax|transunion)?\s*(?:score|credit\s*score)\s*[:\-]?\s*([3-9]\d{2})\b/i) ||
                     fullText.match(/\b([3-9]\d{2})\s*(?:\/\s*900)?\b/);
  if (scoreMatch) {
    profile.score = parseInt(scoreMatch[1]);
    if (profile.score >= 750) {
      profile.rating = 'Excellent';
      profile.ratingColor = '#10b981';
    } else if (profile.score >= 700) {
      profile.rating = 'Good';
      profile.ratingColor = '#3b82f6';
    } else if (profile.score >= 650) {
      profile.rating = 'Fair';
      profile.ratingColor = '#f59e0b';
    } else {
      profile.rating = 'Needs Attention';
      profile.ratingColor = '#ef4444';
    }
  }

  // 2. Extract Accounts & Balances
  const lines = fullText.split('\n');
  const accounts = [];
  let totalLimit = 0;
  let totalBalance = 0;
  let totalEmi = 0;

  const bankNames = ['HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK', 'BAJAJ', 'CITI', 'INDUSIND', 'IDFC', 'RBL', 'STANDARD CHARTERED', 'BANK OF BARODA', 'PUNJAB NATIONAL'];
  const facilityTypes = ['Credit Card', 'Housing Loan', 'Home Loan', 'Auto Loan', 'Car Loan', 'Personal Loan', 'Education Loan', 'Consumer Loan', 'Two Wheeler Loan'];

  lines.forEach(line => {
    const foundBank = bankNames.find(b => new RegExp('\\b' + b + '\\b', 'i').test(line));
    const foundType = facilityTypes.find(t => new RegExp('\\b' + t + '\\b', 'i').test(line));
    const amounts = line.match(/\b\d{1,3}(?:,\d{2,3})*(?:\.\d{2})?\b/g);

    if (foundBank || foundType) {
      const amtNums = amounts ? amounts.map(parseAmount).filter(a => a > 500) : [];
      if (amtNums.length > 0) {
        const highCredit = amtNums[0] || 0;
        const curBalance = amtNums[1] || 0;
        const emiVal = amtNums.find(a => a >= 1000 && a <= 150000 && a !== highCredit && a !== curBalance) || 0;

        accounts.push({
          lender: foundBank ? foundBank + ' Bank' : 'Credit Institution',
          type: foundType || 'Credit Facility',
          limit: highCredit,
          balance: curBalance,
          emi: emiVal
        });

        totalLimit += highCredit;
        totalBalance += curBalance;
        totalEmi += emiVal;
      }
    }
  });

  profile.accounts = accounts;
  profile.totalCreditLimit = totalLimit;
  profile.totalOutstanding = totalBalance;
  profile.totalMonthlyEmi = totalEmi;
  profile.utilizationPct = totalLimit > 0 ? Math.min(Math.round((totalBalance / totalLimit) * 100), 100) : 0;

  creditProfile = profile;
  saveData('ft_credit_profile', creditProfile);
  renderCreditProfile();
  renderCreditDashboard();
  alert(`✅ Credit Report parsed successfully! Credit Score: ${profile.score || 'Recorded'}`);
}

// Render Credit Profile Subtab View
function renderCreditProfile() {
  const container = document.getElementById('creditReportContent');
  if (!container) return;

  if (!creditProfile || !creditProfile.score) {
    container.classList.remove('hidden');
    container.innerHTML = `
      <div style="text-align:center; padding:2rem; background:#fafafa; border-radius:12px; border:1px dashed #cbd5e1;">
        <span style="font-size:2.5rem; display:block; margin-bottom:0.5rem;">📊</span>
        <strong style="font-size:1.1rem; color:#1e293b;">No Credit Report Uploaded Yet</strong>
        <p style="font-size:0.85rem; color:#64748b; margin-top:0.4rem;">
          Upload your CIBIL or Experian CIR report (PDF or JSON) to track your credit score, credit card limits, and monthly EMI commitments.
        </p>
      </div>
    `;
    return;
  }

  container.classList.remove('hidden');
  const cp = creditProfile;

  let accountsHtml = '';
  if (cp.accounts && cp.accounts.length > 0) {
    accountsHtml = `
      <h4 style="margin:1rem 0 0.5rem; font-size:0.95rem; color:#1e293b;">Active Loans & Credit Facilities (${cp.accounts.length})</h4>
      <div style="max-height:240px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:8px;">
        <table class="staging-table">
          <thead>
            <tr>
              <th>Lender</th>
              <th>Facility</th>
              <th style="text-align:right;">Limit / Sanctioned</th>
              <th style="text-align:right;">Outstanding</th>
              <th style="text-align:right;">Monthly EMI</th>
            </tr>
          </thead>
          <tbody>
            ${cp.accounts.map(a => `
              <tr>
                <td style="font-weight:600;">${a.lender}</td>
                <td><span class="badge conf-80">${a.type}</span></td>
                <td style="text-align:right;">₹${a.limit.toLocaleString('en-IN')}</td>
                <td style="text-align:right; font-weight:600; color:#c0392b;">₹${a.balance.toLocaleString('en-IN')}</td>
                <td style="text-align:right; font-weight:600; color:#2c3e50;">${a.emi > 0 ? '₹' + a.emi.toLocaleString('en-IN') : '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="credit-score-card">
      <div class="score-circle" style="border-color:${cp.ratingColor};">
        <span class="score-val">${cp.score}</span>
        <span class="score-lbl">CIBIL / CIR</span>
      </div>
      <div class="score-details">
        <span class="score-rating-pill" style="background:${cp.ratingColor};">${cp.rating} Score</span>
        <div style="font-size:0.85rem; color:#64748b; margin-bottom:0.5rem;">
          Updated from credit report on ${new Date(cp.rawExtractedAt || Date.now()).toLocaleDateString()}
        </div>
        <div class="grid2" style="margin-top:0.5rem;">
          <div class="stat" style="padding:0.6rem;">
            <div class="label">Total Credit Limit</div>
            <div class="value" style="font-size:1.15rem;">₹${(cp.totalCreditLimit || 0).toLocaleString('en-IN')}</div>
          </div>
          <div class="stat" style="padding:0.6rem;">
            <div class="label">Total Outstanding</div>
            <div class="value" style="font-size:1.15rem; color:#c0392b;">₹${(cp.totalOutstanding || 0).toLocaleString('en-IN')}</div>
          </div>
          <div class="stat" style="padding:0.6rem;">
            <div class="label">Card Utilization</div>
            <div class="value" style="font-size:1.15rem; color:${cp.utilizationPct > 40 ? '#c0392b' : '#27ae60'};">${cp.utilizationPct}%</div>
          </div>
          <div class="stat" style="padding:0.6rem;">
            <div class="label">Monthly EMI Burden</div>
            <div class="value" style="font-size:1.15rem; color:#2c3e50;">₹${(cp.totalMonthlyEmi || 0).toLocaleString('en-IN')}</div>
          </div>
        </div>
      </div>
    </div>

    ${accountsHtml}

    <div style="display:flex; justify-content:flex-end; gap:0.5rem; margin-top:1rem;">
      ${cp.totalMonthlyEmi > 0 ? `
        <button onclick="addEmiToExpenses()" class="secondary" style="font-size:0.85rem;">
          ➕ Record Monthly EMI (₹${cp.totalMonthlyEmi.toLocaleString('en-IN')}) in Expenses
        </button>
      ` : ''}
      <button onclick="clearCreditProfile()" class="danger" style="font-size:0.85rem;">
        🗑️ Clear Credit Report Data
      </button>
    </div>
  `;
}
window.renderCreditProfile = renderCreditProfile;

window.clearCreditProfile = function() {
  if (confirm('Delete saved credit report profile and score?')) {
    creditProfile = null;
    saveData('ft_credit_profile', null);
    renderCreditProfile();
    renderCreditDashboard();
  }
};

window.addEmiToExpenses = function() {
  if (!creditProfile || !creditProfile.totalMonthlyEmi) return;
  const today = new Date().toISOString().slice(0, 10);
  expenses.push({
    id: Date.now().toString(),
    date: today,
    category: 'EMI',
    amount: creditProfile.totalMonthlyEmi,
    note: 'Monthly Loan / Card EMI commitment'
  });
  saveData('ft_expenses', expenses);
  renderAll();
  alert(`✅ Added ₹${creditProfile.totalMonthlyEmi.toLocaleString('en-IN')} EMI entry to today's expenses!`);
};

// Dashboard Credit Summary Widget
function renderCreditDashboard() {
  const card = document.getElementById('creditSummaryCard');
  if (!card) return;

  if (!creditProfile || !creditProfile.score) {
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.8rem;">
        <div>
          <h3 style="font-size:1.05rem; margin-bottom:0.2rem;">🛡️ Credit Health & Liabilities</h3>
          <p style="font-size:0.85rem; color:#666;">
            Track your official CIBIL credit score, card utilization, and monthly EMIs.
          </p>
        </div>
        <button onclick="document.querySelector('.tab[data-panel=statements]').click(); switchStatementSubtab('credit', document.querySelectorAll('#statements .subtab')[2]);" class="secondary" style="font-size:0.85rem;">
          📄 Upload Credit Report
        </button>
      </div>
    `;
    return;
  }

  const cp = creditProfile;
  card.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.8rem;">
      <h3 style="font-size:1.05rem;">🛡️ Credit Health & Debt Exposure</h3>
      <span class="badge" style="background:${cp.ratingColor}; color:#fff; font-size:0.8rem; padding:0.2rem 0.6rem;">${cp.rating} (${cp.score})</span>
    </div>
    <div class="grid2">
      <div class="stat" style="padding:0.6rem;">
        <div class="label">Credit Score</div>
        <div class="value" style="font-size:1.5rem; color:${cp.ratingColor};">${cp.score}</div>
      </div>
      <div class="stat" style="padding:0.6rem;">
        <div class="label">Credit Utilization</div>
        <div class="value" style="font-size:1.5rem; color:${cp.utilizationPct > 40 ? '#c0392b' : '#27ae60'};">${cp.utilizationPct}%</div>
      </div>
      <div class="stat" style="padding:0.6rem;">
        <div class="label">Total Outstanding Debt</div>
        <div class="value" style="font-size:1.4rem; color:#c0392b;">₹${(cp.totalOutstanding || 0).toLocaleString('en-IN')}</div>
      </div>
      <div class="stat" style="padding:0.6rem;">
        <div class="label">Monthly EMI Commitment</div>
        <div class="value" style="font-size:1.4rem; color:#2c3e50;">₹${(cp.totalMonthlyEmi || 0).toLocaleString('en-IN')}</div>
      </div>
    </div>
  `;
}
window.renderCreditDashboard = renderCreditDashboard;

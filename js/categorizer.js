/**
 * FinTrack - Merchant Categorizer & History Learning Engine
 * Standard: ISO/IEC 25010 Modularity & High Cohesion
 */

// Narration Cleaner & Merchant Extractor
function cleanNarration(raw) {
  if (!raw) return 'Unknown';
  let s = String(raw).trim();
  // Remove UPI prefixes: UPI/DR/123456/MERCHANT/BANK/HANDLE or UPI/CR/...
  s = s.replace(/^UPI\s*[\/\-:]\s*(?:DR|CR)?\s*[\/\-:]?\s*\d*\s*[\/\-:]?/i, '');
  // Remove POS prefixes: POS 421443XXXXXX1234 RELIANCE SMART
  s = s.replace(/^POS\s+[\dX*]+\s+/i, '');
  s = s.replace(/^POS\s+/i, '');
  // Remove NEFT/RTGS/IMPS prefixes: NEFT CR-HDFC0000001-SALARY...
  s = s.replace(/^(?:NEFT|RTGS)\s*(?:CR|DR)?\s*[\/\-:]\s*[A-Z0-9]+\s*[\/\-:]/i, '');
  s = s.replace(/^IMPS\s*[\/\-:]\s*\d*\s*[\/\-:]/i, '');
  // Remove ACH/NACH/ECS prefixes: ACH D- HDFC0000001-BAJAJ
  s = s.replace(/^(?:ACH|NACH|ECS)\s*(?:D|C)?\s*[\/\-:]\s*[A-Z0-9]*\s*[\/\-:]?/i, '');
  // Remove ATM withdrawals: ATM-WDL/CASH/LOC
  s = s.replace(/^ATM\s*[\/\-:]\s*(?:WDL|CASH)?\s*[\/\-:]?/i, 'ATM Cash ');
  // Remove BillDesk/EAW/BIL/CMS/INB: BILLDESK*AIRTEL
  s = s.replace(/^(?:BILLDESK|EAW|BIL|CMS|INB)\s*[*\/:\-]\s*/i, '');

  // Remove trailing VPA / bank handles
  s = s.replace(/@[a-zA-Z0-9\.\-]+/g, '');
  s = s.replace(/[\/](?:HDFC|ICICI|SBI|UTIB|AXIS|PAYTM|YESB|OKAXIS|OKHDFCBANK|PAY)[\/a-zA-Z0-9]*/gi, '');
  s = s.replace(/[\/]\d{6,}[\/]?/g, '');

  // Clean special characters and multi-spaces
  s = s.replace(/[_\-*#|]+/g, ' ').replace(/\s+/g, ' ').trim();

  // Title case for readability
  if (s.length > 0) {
    const words = s.split(' ').slice(0, 5);
    s = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  }
  return s || String(raw).slice(0, 30);
}

// Token-Based Merchant Similarity Matcher
function merchantMatches(m1, m2) {
  if (!m1 || !m2) return false;
  const s1 = String(m1).toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const s2 = String(m2).toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  if (s1.trim() === s2.trim()) return true;

  const STOP_WORDS = new Set(['india', 'retail', 'mumbai', 'bangalore', 'delhi', 'chennai', 'hyderabad', 'pvt', 'ltd', 'limited', 'pay', 'pos', 'online', 'store', 'card', 'bank', 'corp', 'the', 'and']);
  const tokens1 = s1.split(/\s+/).filter(w => w.length >= 3 && !STOP_WORDS.has(w));
  const tokens2 = s2.split(/\s+/).filter(w => w.length >= 3 && !STOP_WORDS.has(w));

  for (const t1 of tokens1) {
    for (const t2 of tokens2) {
      if (t1 === t2 || (t1.length >= 4 && t2.length >= 4 && (t1.includes(t2) || t2.includes(t1)))) {
        return true;
      }
    }
  }
  return false;
}

// History-Based Spend Tag Prediction Engine
function predictCategory(merchant, rawNarration, isExpense) {
  const normMerchant = (merchant || '').toLowerCase();
  const normRaw = (rawNarration || '').toLowerCase();

  // 1. Saved User Rules (100% Confidence)
  if (merchantRules[normMerchant]) {
    return { category: merchantRules[normMerchant], confidence: 100, badgeClass: 'conf-100', label: 'Saved Rule' };
  }
  for (const [key, cat] of Object.entries(merchantRules)) {
    if (key.length >= 3 && (normMerchant.includes(key) || normRaw.includes(key))) {
      return { category: cat, confidence: 100, badgeClass: 'conf-100', label: 'Saved Rule' };
    }
  }

  // 2. Historical Match from past user expenses / income (90% Confidence)
  const pastEntries = isExpense ? expenses : incomeEntries;
  const historyCounts = {};
  pastEntries.forEach(entry => {
    const note = (entry.note || entry.source || '').toLowerCase();
    if (!note) return;
    if (note.includes(normMerchant) || normMerchant.includes(note)) {
      historyCounts[entry.category] = (historyCounts[entry.category] || 0) + 1;
    }
  });
  let bestCategory = null;
  let maxCount = 0;
  for (const [cat, count] of Object.entries(historyCounts)) {
    if (count > maxCount) {
      maxCount = count;
      bestCategory = cat;
    }
  }
  if (bestCategory) {
    return { category: bestCategory, confidence: 90, badgeClass: 'conf-90', label: `History (${maxCount}x)` };
  }

  // 3. Common Indian Merchant Dictionary (80% Confidence)
  for (const [key, cat] of Object.entries(DEFAULT_MERCHANT_RULES)) {
    if (key.length >= 3 && (normMerchant.includes(key) || normRaw.includes(key))) {
      return { category: cat, confidence: 80, badgeClass: 'conf-80', label: 'Common Merchant' };
    }
  }

  // 4. Keyword Heuristics (60% Confidence)
  if (isExpense) {
    if (/\b(fuel|petrol|diesel|cng|oil pump|gas station)\b/i.test(normRaw)) return { category: 'Fuel', confidence: 60, badgeClass: 'conf-low', label: 'Keyword' };
    if (/\b(pharmacy|medicals|clinic|hospital|doctor|pathlab|health)\b/i.test(normRaw)) return { category: 'Health', confidence: 60, badgeClass: 'conf-low', label: 'Keyword' };
    if (/\b(cafe|restaurant|hotel|bakers|kitchen|dining|food|sweets|dhaba)\b/i.test(normRaw)) return { category: 'Food & Drinks', confidence: 60, badgeClass: 'conf-low', label: 'Keyword' };
    if (/\b(mart|supermarket|grocery|kirana|vegetables|fruits|provision)\b/i.test(normRaw)) return { category: 'Groceries', confidence: 60, badgeClass: 'conf-low', label: 'Keyword' };
    if (/\b(electricity|water bill|broadband|wifi|mobile recharge|postpaid|dth)\b/i.test(normRaw)) return { category: 'Bills', confidence: 60, badgeClass: 'conf-low', label: 'Keyword' };
    if (/\b(toll|fastag|metro|rail|flight|airline|cab|taxi|parking)\b/i.test(normRaw)) return { category: 'Travel', confidence: 60, badgeClass: 'conf-low', label: 'Keyword' };
    if (/\b(cinema|theatre|movies|multiplex|amusement)\b/i.test(normRaw)) return { category: 'Entertainment', confidence: 60, badgeClass: 'conf-low', label: 'Keyword' };
    if (/\b(loan|finance|emi|card payment|repay)\b/i.test(normRaw)) return { category: 'EMI', confidence: 60, badgeClass: 'conf-low', label: 'Keyword' };
  } else {
    if (/\b(salary|payroll|wages|stipend)\b/i.test(normRaw)) return { category: 'Salary', confidence: 60, badgeClass: 'conf-low', label: 'Keyword' };
    if (/\b(interest|dividend|yield|returns)\b/i.test(normRaw)) return { category: 'Investment Income', confidence: 60, badgeClass: 'conf-low', label: 'Keyword' };
    if (/\b(cashback|reward|refund)\b/i.test(normRaw)) return { category: 'Other', confidence: 60, badgeClass: 'conf-low', label: 'Refund/Reward' };
  }

  // Fallback
  return {
    category: isExpense ? (categories.expense[0] || 'Other') : (categories.income[0] || 'Other'),
    confidence: 0,
    badgeClass: 'conf-low',
    label: 'Needs Review'
  };
}

// Learned Merchant Rules Management
function renderMerchantRulesList() {
  const list = document.getElementById('merchantRulesList');
  const badge = document.getElementById('rulesCountBadge');
  const summary = document.getElementById('rulesCountSummary');
  const catSelect = document.getElementById('ruleCategorySelect');

  const entries = Object.entries(merchantRules);
  if (badge) badge.textContent = entries.length;
  if (summary) summary.textContent = `${entries.length} rules saved`;

  if (catSelect) {
    catSelect.innerHTML = getAllCategoryNames().map(c => `<option value="${c}">${c}</option>`).join('');
  }

  if (!list) return;
  const search = (document.getElementById('ruleSearchInput')?.value || '').toLowerCase().trim();
  const filtered = entries.filter(([k, v]) => k.includes(search) || v.toLowerCase().includes(search));

  list.innerHTML = filtered.map(([merchant, cat]) => `
    <li style="display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0.5rem; border-bottom:1px solid #edf2f7;">
      <div>
        <strong style="color:#2c3e50; text-transform:capitalize;">${merchant}</strong>
        <span class="category-tag ${getCategoryType(cat) || 'expense'}" style="margin-left:0.5rem;">${cat}</span>
      </div>
      <button onclick="deleteMerchantRule('${merchant}')" style="background:#fee2e2; color:#dc2626; border:none; padding:0.2rem 0.5rem; border-radius:4px; cursor:pointer;">✕</button>
    </li>
  `).join('');
}
window.renderMerchantRulesList = renderMerchantRulesList;

window.filterRulesList = function() {
  renderMerchantRulesList();
};

window.addMerchantRule = function(merchant, category) {
  merchant = merchant.toLowerCase().trim();
  if (!merchant) return;
  merchantRules[merchant] = category;
  saveData('ft_merchant_rules', merchantRules);
  renderMerchantRulesList();
};

window.deleteMerchantRule = function(merchant) {
  if (confirm(`Delete rule for "${merchant}"?`)) {
    delete merchantRules[merchant];
    saveData('ft_merchant_rules', merchantRules);
    renderMerchantRulesList();
  }
};

window.learnRulesFromHistory = function() {
  let count = 0;
  expenses.forEach(e => {
    if (e.note && e.note.trim().length >= 3) {
      const m = e.note.toLowerCase().trim();
      if (!merchantRules[m]) {
        merchantRules[m] = e.category;
        count++;
      }
    }
  });
  incomeEntries.forEach(inc => {
    if (inc.source && inc.source.trim().length >= 3) {
      const m = inc.source.toLowerCase().trim();
      if (!merchantRules[m]) {
        merchantRules[m] = inc.category;
        count++;
      }
    }
  });
  saveData('ft_merchant_rules', merchantRules);
  renderMerchantRulesList();
  alert(`🎉 FinTrack learned ${count} new merchant rules from your past expenses and income!`);
};

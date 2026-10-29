/**
 * FinTrack - Instant Transaction Alert Email & SMS Parser
 * Standard: ISO/IEC 25010 Modularity & Single Responsibility
 */

// Parse single alert email text / SMS
function parseEmailAlertText(subject = '', body = '', dateReceived = null, emailId = null) {
  const fullText = (subject + '\n' + body).trim();
  if (!fullText) return null;

  // 1. Debit vs Credit
  let isExpense = true;
  if (/\b(?:credited|credit|refund|cashback|received\s*from|salary)\b/i.test(fullText)) {
    isExpense = false;
  } else if (/\b(?:debited|debit|spent|withdrawn|paid|purchase|deducted|upi txn|done a upi)\b/i.test(fullText)) {
    isExpense = true;
  }

  // 2. Amount Extraction
  const amtMatch = fullText.match(/(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i) ||
                   fullText.match(/\b(?:debited\s*(?:by|with)?|credited\s*(?:by|with)?|spent|withdrawn|paid)\s*(?:by|with|for)?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!amtMatch) return null;
  const amount = parseAmount(amtMatch[1]);
  if (amount <= 0) return null;

  // 3. Date & Time Extraction
  let txnDate = null;
  let txnTime = null;
  const dateMatch = fullText.match(/\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/) ||
                    fullText.match(/\b(\d{1,2}[\s\-\.][A-Za-z]{3}[\s\-\.]\d{2,4})\b/) ||
                    fullText.match(/\b(\d{1,2}[A-Za-z]{3}\d{2,4})\b/);
  if (dateMatch) {
    txnDate = normalizeDate(dateMatch[1]);
  } else if (dateReceived) {
    txnDate = normalizeDate(dateReceived);
  } else {
    txnDate = new Date().toISOString().slice(0, 10);
  }

  const timeMatch = fullText.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
  if (timeMatch) txnTime = timeMatch[1];

  // 4. Ref ID / RRN / UTR / Auth Code Extraction
  let refId = null;
  const refMatch = fullText.match(/(?:UPI\s*Ref(?:\s*no)?|Ref\s*No|RRN|UTR|Auth(?:\s*code)?|Authorization\s*code|Txn\s*ID)[:\s]+([A-Za-z0-9]+)/i);
  if (refMatch) {
    refId = refMatch[1].trim();
  }

  // 5. Account or Card identifier
  let accountInfo = '';
  const acctMatch = fullText.match(/(?:Card|Account|A\/c|Acct)?\s*(?:no\.?)?\s*(?:ending\s*(?:with)?|ending|xx|\*\*)\s*(\d{4})/i);
  if (acctMatch) {
    accountInfo = 'ending ' + acctMatch[1];
  }

  // 6. Merchant / Beneficiary Extraction
  let rawMerchant = '';
  const atMatch = fullText.match(/\bat\s+([A-Za-z0-9\s\.\&\*\-]+?)(?:\s+on\b|\s+at\s+\d|\.|\n|Available|Auth|Avail)/i);
  const toMatch = fullText.match(/\b(?:to\s*VPA|transfer\s*to|to)\s+([A-Za-z0-9\.\@\-\s]+?)(?:\s+on\b|\s+Ref\b|\.|\n|Available)/i);
  const fromMatch = fullText.match(/\b(?:transfer\s*from|received\s*from|from)\s+([A-Za-z0-9\s\.\&\*\-]+?)(?:\.|\n|UPI|NEFT|Ref|on\b)/i);
  const towardsMatch = fullText.match(/\btowards\s+([A-Za-z0-9\/\.\-]+?)(?:\.|\n|Available)/i);
  const infoMatch = fullText.match(/\bInfo:\s*([^\n\r]+)/i);

  if (atMatch && atMatch[1].trim().length > 1) {
    rawMerchant = atMatch[1].trim();
  } else if (toMatch && toMatch[1].trim().length > 1) {
    rawMerchant = toMatch[1].trim();
  } else if (!isExpense && fromMatch && fromMatch[1].trim().length > 1) {
    rawMerchant = fromMatch[1].trim();
  } else if (towardsMatch && towardsMatch[1].trim().length > 1) {
    rawMerchant = towardsMatch[1].trim();
  } else if (infoMatch && infoMatch[1].trim().length > 1) {
    rawMerchant = infoMatch[1].trim();
  } else if (fromMatch && fromMatch[1].trim().length > 1) {
    rawMerchant = fromMatch[1].trim();
  } else if (subject) {
    rawMerchant = subject.replace(/transaction alert|alert:|update on/gi, '').trim();
  }

  const cleanMerchant = cleanNarration(rawMerchant || 'Bank Transaction');
  const pred = predictCategory(cleanMerchant, fullText, isExpense);

  return {
    id: emailId || ('alert_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)),
    date: txnDate,
    time: txnTime,
    amount: amount,
    isExpense: isExpense,
    merchant: cleanMerchant,
    rawNarration: fullText.slice(0, 160).replace(/\s+/g, ' ').trim(),
    refId: refId || '',
    account: accountInfo,
    source: '✉️ Alert Email',
    category: pred.category,
    confidence: pred.confidence,
    badgeClass: pred.badgeClass,
    matchLabel: pred.label || 'Email Alert',
    checked: true,
    isDuplicate: false,
    isMerged: false,
    remember: true
  };
}

// Parse multi-block alert emails or SMS
function parseMultipleAlertTexts(rawText) {
  if (!rawText || !rawText.trim()) return [];
  const chunks = rawText.split(/(?:\r?\n\s*){2,}|(?=Dear\s+(?:Customer|Cardholder)|Transaction\s+alert|Alert:)/i);
  const results = [];
  chunks.forEach(chunk => {
    if (!chunk.trim()) return;
    const item = parseEmailAlertText('', chunk.trim());
    if (item && item.amount > 0) {
      results.push(item);
    }
  });
  return results;
}

// Quick Paste Handler
window.handlePastedAlertsSubmit = function() {
  const textarea = document.getElementById('pasteAlertInput');
  const val = textarea ? textarea.value.trim() : '';
  if (!val) {
    alert('Please paste some email alert or SMS text first.');
    return;
  }
  setParsingStatus(true, 'Parsing pasted alerts...');
  const parsed = parseMultipleAlertTexts(val);
  if (parsed.length === 0) {
    setParsingStatus(true, '⚠️ Could not detect transactions in pasted text. Make sure it contains amounts (e.g. INR 1,499) and dates.', true);
    return;
  }

  parsed.forEach(p => {
    const alreadyExists = currentEmailAlertTransactions.some(e =>
      (p.refId && e.refId && p.refId === e.refId) ||
      (p.date === e.date && Math.abs(p.amount - e.amount) < 0.01 && p.merchant === e.merchant)
    );
    if (!alreadyExists) currentEmailAlertTransactions.push(p);
  });

  recalculateStagedAndRender();
  setParsingStatus(false);

  const mergedCount = stagedTransactions.filter(t => t.isMerged).length;
  const dupCount = stagedTransactions.filter(t => t.isDuplicate).length;
  alert(`🎉 Parsed ${parsed.length} alert transactions!\n• ${mergedCount} merged with statement lines\n• ${dupCount} already recorded in FinTrack (auto-skipped)`);

  document.getElementById('stagingSection')?.scrollIntoView({ behavior: 'smooth' });
};

// Load Sample Alerts
window.loadSampleAlert = function(bankKey) {
  const input = document.getElementById('pasteAlertInput');
  if (!input) return;
  const samples = {
    hdfc: `Dear Customer, Thank you for using your HDFC Bank Card ending 1234 for INR 1,499.00 at AMAZON INDIA on 27-OCT-2026 14:35:12. Authorization code: 429101. Available limit: INR 2,45,000.00.\n\nDear Customer, An amount of Rs. 450.00 has been debited from your account **1234 to VPA swiggy@icici on 28-10-2026 19:22:10. UPI Ref no 428192837192.`,
    icici: `Dear Customer, INR 2,850.00 spent on your ICICI Bank Credit Card XX4002 on 26-Oct-26 at 16:20:15 at RELIANCE DIGITAL. Available Limit: INR 1,20,000.00.\n\nYour A/c ending 9012 has been debited with INR 320.00 on 29-Oct-26. Info: UPI/429182736451/Zomato/zomato@hdfc. Total Avail Bal: INR 45,210.00.`,
    sbi: `Spent Rs. 3,499.00 on your SBI Card ending 5678 at FLIPKART INTERNET on 25/10/2026 at 11:20:45. Auth code: 98765. Avail Limit: Rs 65,000.\n\nDear UPI user A/C 3456 debited by 150.0 on 28Oct26 transfer to blinkit@ybl Ref No 428901234567.`,
    axis: `INR 680.00 debited from your Axis Bank Account no. XX3456 on 28-10-2026 18:30:12 towards UPI/428998877665/UBER. Available Bal: INR 18,400.\n\nYou have spent INR 1,200.00 on your Axis Bank Credit Card ending 8765 at PVR CINEMAS on 26-10-2026 20:15.`
  };
  input.value = samples[bankKey] || samples.hdfc;
};

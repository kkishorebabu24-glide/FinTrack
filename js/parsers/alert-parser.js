/**
 * FinTrack - Instant Transaction Alert Email & SMS Parser
 * Standard: ISO/IEC 25010 Modularity & Single Responsibility
 */

// Parse single alert email text / SMS
function parseEmailAlertText(subject = '', body = '', dateReceived = null, emailId = null) {
  const fullText = (subject + '\n' + body).trim();
  if (!fullText) return null;

  // 1. Debit vs Credit
  // Ignore "credit" when part of "credit card", "credit limit", "total credit limit"
  const textWithoutCreditCard = fullText.replace(/\b(?:credit\s*card|credit\s*limit|total\s*credit(?:\s*limit)?)\b/gi, '');
  let isExpense = true;
  if (/\b(?:credited|refund|cashback|received\s*from|salary|deposited)\b/i.test(textWithoutCreditCard)) {
    isExpense = false;
  } else if (/\b(?:debited|debit|spent|withdrawn|paid|purchase|deducted|upi txn|done a upi|transaction amount)\b/i.test(fullText)) {
    isExpense = true;
  }

  // 2. Amount Extraction
  let amount = 0;
  // A. Key-Value style: "Transaction Amount:\nINR 110"
  const kvAmtMatch = fullText.match(/(?:Transaction\s*Amount|Txn\s*Amount|Amount\s*debited|Amount\s*spent|Amount\s*credited|Amount)[:\s\r\n]+(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (kvAmtMatch) {
    amount = parseAmount(kvAmtMatch[1]);
  }

  // B. Action sentence style (e.g. "for INR 1,499.00", "debited by 150.0", "spent Rs. 3,499")
  if (!amount) {
    const actionAmtMatch = fullText.match(/\b(?:debited\s*(?:by|with)?|credited\s*(?:by|with)?|spent|withdrawn|paid|purchase\s*(?:of)?)\s*(?:by|with|for)?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (actionAmtMatch) {
      amount = parseAmount(actionAmtMatch[1]);
    }
  }

  // C. Fallback: match first INR/Rs amount that is NOT an Available Limit, Total Credit Limit, or Balance
  if (!amount) {
    const allAmts = Array.from(fullText.matchAll(/(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/gi));
    for (const m of allAmts) {
      const idx = m.index;
      const preceding = fullText.slice(Math.max(0, idx - 45), idx);
      if (/(?:available\s*limit|total\s*credit\s*limit|credit\s*limit|avail\s*limit|available\s*bal|avail\s*bal|balance|outstanding|due)/i.test(preceding)) {
        continue; // Skip account balances and credit limits!
      }
      const val = parseAmount(m[1]);
      if (val > 0) {
        amount = val;
        break;
      }
    }
  }

  if (amount <= 0) return null;

  // 3. Date & Time Extraction
  let txnDate = null;
  let txnTime = null;

  // Key-value date check: "Date & Time:\n31-10-2026, 17:56:36 IST"
  const kvDateMatch = fullText.match(/(?:Date\s*(?:&|and)\s*Time|Txn\s*Date|Transaction\s*Date|Date)[:\s\r\n]+([^\r\n]+)/i);
  const searchDateText = kvDateMatch ? kvDateMatch[1] : fullText;

  const dateMatch = searchDateText.match(/\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/) ||
                    searchDateText.match(/\b(\d{1,2}[\s\-\.][A-Za-z]{3}[\s\-\.]\d{2,4})\b/) ||
                    searchDateText.match(/\b(\d{1,2}[A-Za-z]{3}\d{2,4})\b/) ||
                    fullText.match(/\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/) ||
                    fullText.match(/\b(\d{1,2}[\s\-\.][A-Za-z]{3}[\s\-\.]\d{2,4})\b/);

  if (dateMatch) {
    txnDate = normalizeDate(dateMatch[1]);
  } else if (dateReceived) {
    txnDate = normalizeDate(dateReceived);
  } else {
    txnDate = new Date().toISOString().slice(0, 10);
  }

  const timeMatch = searchDateText.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/) || fullText.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
  if (timeMatch) txnTime = timeMatch[1];

  // 4. Ref ID / RRN / UTR / Auth Code Extraction
  let refId = null;
  const refMatch = fullText.match(/(?:UPI\s*Ref(?:\s*no)?|Ref\s*No|RRN|UTR|Auth(?:\s*code)?|Authorization\s*code|Txn\s*ID)[:\s]+([A-Za-z0-9]+)/i);
  if (refMatch) {
    refId = refMatch[1].trim();
  }

  // 5. Account or Card identifier
  let accountInfo = '';
  const kvCardMatch = fullText.match(/(?:(?:Axis\s*Bank|HDFC\s*Bank|ICICI\s*Bank|SBI|Kotak|IndusInd)?\s*(?:Credit|Debit)?\s*Card\s*(?:No\.?)?|Account\s*(?:No\.?)?|A\/c\s*(?:No\.?)?)[:\s\r\n]+([A-Za-z0-9\*]+)/i);
  const acctMatch = kvCardMatch || fullText.match(/(?:Card|Account|A\/c|Acct)?\s*(?:no\.?)?\s*(?:ending\s*(?:with)?|ending|xx|\*\*)\s*([A-Za-z0-9]{4})/i);
  if (acctMatch) {
    const rawAcct = acctMatch[1].replace(/[^A-Za-z0-9]/g, '');
    accountInfo = rawAcct.length > 4 ? rawAcct.slice(-4) : rawAcct;
    if (accountInfo) accountInfo = 'ending ' + accountInfo;
  }

  // 6. Merchant / Beneficiary Extraction
  let rawMerchant = '';
  // Key-value check: "Merchant Name:\nAISHWARYA S"
  const kvMerchantMatch = fullText.match(/(?:Merchant\s*Name|Merchant|Beneficiary\s*Name|Beneficiary|Paid\s*to|To\s*VPA)[:\s\r\n]+([^\r\n]+)/i);
  if (kvMerchantMatch && kvMerchantMatch[1].trim().length > 1) {
    rawMerchant = kvMerchantMatch[1].trim();
  }

  if (!rawMerchant) {
    const atMatch = fullText.match(/\bat\s+([A-Za-z0-9\s\.\&\*\-]+?)(?:\s+on\b|\s+at\s+\d|\.|\n|Available|Auth|Avail)/i);
    const toMatch = fullText.match(/\b(?:to\s*VPA|transfer\s*to|to)\s+([A-Za-z0-9\.\@\-\s]+?)(?:\s+on\b|\s+Ref\b|\.|\n|Available)/i);
    const fromMatch = fullText.match(/\b(?:transfer\s*from|received\s*from|from)\s+([A-Za-z0-9\s\.\&\*\-]+?)(?:\.|\n|UPI|NEFT|Ref|on\b)/i);
    const towardsMatch = fullText.match(/\btowards\s+([A-Za-z0-9\/\.\-]+?)(?:\.|\n|Available|Avail|Total)/i);
    const infoMatch = fullText.match(/\bInfo:\s*([A-Za-z0-9\/\.\@\-\s]+?)(?:\.|\n|Total|Available|Avail|Bal|$)/i);

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
  }

  // Clean trailing date/time fragments from narration (e.g. "on 28-10-2026")
  if (rawMerchant) {
    rawMerchant = rawMerchant.replace(/\s+on\s+\d{1,2}[\/\-\.][A-Za-z0-9\/\-\.]+.*$/i, '');
    rawMerchant = rawMerchant.replace(/\s+at\s+\d{1,2}:\d{2}.*$/i, '');
    if (/^(?:INR|Rs|Available|Total|Axis|Bank|Credit|Debit)\b/i.test(rawMerchant) && !rawMerchant.includes(' ')) {
      rawMerchant = '';
    }
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

  // If text is a single key-value alert, do not split into orphan fragments!
  const kvOccurrences = (rawText.match(/Transaction\s*Amount:/gi) || []).length;
  if (kvOccurrences === 1) {
    const single = parseEmailAlertText('', rawText.trim());
    return single ? [single] : [];
  }

  // When multiple alerts exist, split on alert header boundaries or double newlines
  let chunks = [];
  if (kvOccurrences > 1) {
    chunks = rawText.split(/(?=(?:Transaction\s*Amount:))/i);
  } else {
    chunks = rawText.split(/(?:\r?\n\s*){2,}|(?=(?:Dear\s+(?:Customer|Cardholder|UPI\s+user)|Transaction\s*Alert|Instant\s*Alert|Alert:|\bFrom:\s*))/i);
  }

  const results = [];
  chunks.forEach(chunk => {
    if (!chunk.trim()) return;
    const item = parseEmailAlertText('', chunk.trim());
    if (item && item.amount > 0) {
      results.push(item);
    }
  });

  if (results.length === 0) {
    const single = parseEmailAlertText('', rawText.trim());
    if (single && single.amount > 0) results.push(single);
  }

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

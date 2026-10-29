/**
 * FinTrack - Bank & Credit Card Statement Parsers (PDF, CSV, Excel)
 * Standard: ISO/IEC 25010 Modularity & Single Responsibility
 */

// Status Banner Helper
function setParsingStatus(visible, text = '', isError = false) {
  const el = document.getElementById('parsingStatus');
  const textEl = document.getElementById('parsingStatusText');
  const spinner = document.getElementById('parsingSpinner');
  if (!el) return;
  if (visible) {
    el.classList.remove('hidden');
    el.style.background = isError ? '#fee2e2' : '#e8f4fd';
    el.style.color = isError ? '#dc2626' : '#1e3a8a';
    if (spinner) spinner.textContent = isError ? '❌' : '⏳';
    if (textEl) textEl.textContent = text;
  } else {
    el.classList.add('hidden');
  }
}

// File Ingestion Dispatcher
window.handleStatementFileUpload = function(file) {
  if (!file) return;
  const bankPresetEl = document.getElementById('bankPreset');
  const bankPreset = bankPresetEl ? bankPresetEl.value : 'auto';
  const name = file.name.toLowerCase();
  setParsingStatus(true, `Reading ${file.name}...`);

  if (name.endsWith('.pdf')) {
    const reader = new FileReader();
    reader.onload = async function(e) {
      try {
        await parsePDFDocument(e.target.result, bankPreset);
      } catch (err) {
        console.error(err);
        setParsingStatus(true, 'Failed to parse PDF: ' + err.message, true);
      }
    };
    reader.readAsArrayBuffer(file);
  } else if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        parseCSVStatement(e.target.result, bankPreset);
      } catch (err) {
        console.error(err);
        setParsingStatus(true, 'Failed to parse CSV: ' + err.message, true);
      }
    };
    reader.readAsText(file);
  } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        parseExcelStatement(e.target.result, bankPreset);
      } catch (err) {
        console.error(err);
        setParsingStatus(true, 'Failed to parse Excel: ' + err.message, true);
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    setParsingStatus(true, 'Unsupported file format. Please upload PDF, CSV, or Excel.', true);
  }
};

// Password Prompt Handling for Locked Bank PDFs
function promptForPdfPassword(reason) {
  return new Promise((resolve) => {
    pendingPasswordCallback = resolve;
    const modal = document.getElementById('pdfPasswordModal');
    const hint = document.getElementById('passwordModalHint');
    const input = document.getElementById('pdfPasswordInput');
    if (!modal || !input) {
      resolve(null);
      return;
    }
    input.value = '';
    if (reason === 2) {
      hint.innerHTML = '<span style="color:#c0392b; font-weight:600;">❌ Incorrect password. Please check your bank format and try again:</span>';
    } else {
      hint.textContent = 'This PDF is encrypted by your bank. Enter the statement password to decrypt it securely in your browser:';
    }
    modal.classList.remove('hidden');
    input.focus();
  });
}

window.handlePasswordSubmit = function(e) {
  e.preventDefault();
  const pwd = document.getElementById('pdfPasswordInput').value;
  document.getElementById('pdfPasswordModal')?.classList.add('hidden');
  if (pendingPasswordCallback) {
    pendingPasswordCallback(pwd);
    pendingPasswordCallback = null;
  }
};

window.cancelPasswordPrompt = function() {
  document.getElementById('pdfPasswordModal')?.classList.add('hidden');
  if (pendingPasswordCallback) {
    pendingPasswordCallback(null);
    pendingPasswordCallback = null;
  }
  setParsingStatus(true, 'PDF password entry was cancelled.', true);
};

window.togglePasswordVisibility = function() {
  const input = document.getElementById('pdfPasswordInput');
  if (input) input.type = input.type === 'password' ? 'text' : 'password';
};

// PDF Parser with PDF.js
async function parsePDFDocument(arrayBuffer, bankPreset = 'auto') {
  setParsingStatus(true, 'Parsing PDF document in browser...');
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('PDF.js library is not loaded. Please check your internet connection.');
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  loadingTask.onPassword = async function(callback, reason) {
    const password = await promptForPdfPassword(reason);
    if (password === null) {
      callback(new Error('Password prompt cancelled'));
    } else {
      callback(password);
    }
  };

  const pdfDoc = await loadingTask.promise;
  let fullText = '';
  const allLines = [];

  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const textContent = await page.getTextContent();

    // Group text items by Y coordinate with 4px tolerance
    const lineMap = new Map();
    textContent.items.forEach(item => {
      const y = Math.round(item.transform[5]);
      let foundKey = null;
      for (const k of lineMap.keys()) {
        if (Math.abs(k - y) <= 4) { foundKey = k; break; }
      }
      if (foundKey === null) {
        foundKey = y;
        lineMap.set(foundKey, []);
      }
      lineMap.get(foundKey).push({ x: item.transform[4], str: item.str });
    });

    // Sort lines from top to bottom
    const sortedKeys = Array.from(lineMap.keys()).sort((a, b) => b - a);
    sortedKeys.forEach(k => {
      const items = lineMap.get(k).sort((a, b) => a.x - b.x);
      const lineStr = items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
      if (lineStr) {
        allLines.push(lineStr);
        fullText += lineStr + '\n';
      }
    });
  }

  // Check if this is a Credit Bureau Report (CIBIL / Experian)
  if (/(?:cibil|experian|equifax|transunion|credit\s*score|score\s*factor|consumer\s*credit)/i.test(fullText)) {
    setParsingStatus(true, 'Detected Credit Bureau Report! Extracting score and accounts...');
    parseCreditReportText(fullText);
    setParsingStatus(false);
    const creditSubtabBtn = document.querySelectorAll('#statements .subtab')[2];
    if (creditSubtabBtn && typeof switchStatementSubtab === 'function') {
      switchStatementSubtab('credit', creditSubtabBtn);
    }
    return;
  }

  // Otherwise, parse as Bank / Credit Card statement
  parseBankStatementLines(allLines, bankPreset);
}

// Bank Statement Line Parser
function parseBankStatementLines(lines, bankPreset = 'auto') {
  setParsingStatus(true, `Extracting transactions from ${lines.length} statement lines...`);
  const results = [];
  const dateRegex = /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{1,2}[\s\-][A-Za-z]{3}[\s\-]\d{2,4})\b/;
  const amountRegex = /\b\d{1,3}(?:,\d{2,3})*(?:\.\d{2})\b/g;

  lines.forEach((line) => {
    const dateMatch = line.match(dateRegex);
    if (!dateMatch) return;

    const rawDate = dateMatch[1];
    const amounts = line.match(amountRegex);
    if (!amounts || amounts.length === 0) return;

    // Skip headers or summary lines
    if (/closing balance|opening balance|total|balance carried/i.test(line)) return;

    // Determine transaction amount
    const txnAmt = parseAmount(amounts[0]);
    if (txnAmt <= 0) return;

    // Determine debit vs credit
    let isExpense = true;
    if (/\b(?:cr|credit|salary|interest|refund|deposit|transfer from)\b/i.test(line)) {
      isExpense = false;
    } else if (/\b(?:dr|debit|withdrawal|pos|upi\/dr|atm|bill)\b/i.test(line)) {
      isExpense = true;
    } else if (amounts.length >= 2) {
      isExpense = true;
    }

    // Clean narration
    let rawNarration = line.replace(rawDate, '').replace(amounts[0], '');
    if (amounts[1]) rawNarration = rawNarration.replace(amounts[1], '');
    rawNarration = rawNarration.replace(/\b(cr|dr|inr)\b/gi, '').trim();

    const cleanMerchantName = cleanNarration(rawNarration);
    const normDate = normalizeDate(rawDate);
    const prediction = predictCategory(cleanMerchantName, rawNarration, isExpense);
    const refMatch = line.match(/(?:UPI\s*Ref(?:\s*no)?|Ref\s*No|RRN|UTR|Chq|Cheque)[:\s\/]+([A-Za-z0-9]+)/i);
    const refVal = refMatch ? refMatch[1] : '';
    const isDup = isDuplicateTransaction(normDate, txnAmt, isExpense, cleanMerchantName, refVal);

    results.push({
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      date: normDate,
      rawNarration: rawNarration,
      merchant: cleanMerchantName,
      isExpense: isExpense,
      amount: txnAmt,
      category: prediction.category,
      confidence: prediction.confidence,
      badgeClass: prediction.badgeClass,
      matchLabel: prediction.label,
      refId: refVal,
      source: '📄 Statement',
      isDuplicate: isDup,
      checked: !isDup,
      remember: true
    });
  });

  if (results.length === 0) {
    setParsingStatus(true, '⚠️ No transactions detected in statement. Try converting to CSV or ensure tabular layout.', true);
    return;
  }

  results.forEach(r => {
    const alreadyExists = currentStatementTransactions.some(e =>
      (r.refId && e.refId && r.refId === e.refId) ||
      (r.date === e.date && Math.abs(r.amount - e.amount) < 0.01 && r.rawNarration === e.rawNarration)
    );
    if (!alreadyExists) currentStatementTransactions.push(r);
  });
  setParsingStatus(false);
  recalculateStagedAndRender();
}

// CSV Statement Parser (PapaParse)
function parseCSVStatement(text, bankPreset = 'auto') {
  setParsingStatus(true, 'Parsing CSV statement...');
  const parsed = Papa.parse(text, { skipEmptyLines: true });
  if (!parsed.data || parsed.data.length === 0) {
    throw new Error('CSV is empty');
  }
  processTabularRows(parsed.data, bankPreset);
}

// Excel Statement Parser (SheetJS)
function parseExcelStatement(arrayBuffer, bankPreset = 'auto') {
  setParsingStatus(true, 'Parsing Excel statement...');
  if (typeof XLSX === 'undefined') {
    throw new Error('SheetJS library is not loaded. Please check your internet connection.');
  }
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  processTabularRows(rows, bankPreset);
}

// Adaptive Tabular Row Processor (Handles HDFC, ICICI, SBI, Axis & Generic)
function processTabularRows(rows, bankPreset = 'auto') {
  let headerIdx = -1;
  let colDate = -1, colDesc = -1, colDebit = -1, colCredit = -1, colAmt = -1, colType = -1, colRef = -1;

  // Scan first 25 rows for table headers
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const row = rows[r].map(c => String(c || '').toLowerCase().trim());
    const dIdx = row.findIndex(c => /date|txn date|value date|posting date|transaction date/.test(c));
    const descIdx = row.findIndex(c => /narration|description|particulars|remarks|details/.test(c));
    const wIdx = row.findIndex(c => /withdrawal|debit|dr|dr amount/.test(c));
    const cIdx = row.findIndex(c => /deposit|credit|cr|cr amount/.test(c));
    const aIdx = row.findIndex(c => /amount|txn amount|net amount/.test(c));
    const rIdx = row.findIndex(c => /chq|cheque|ref|rrn|utr|reference/.test(c));

    if (dIdx !== -1 && (descIdx !== -1 || wIdx !== -1 || cIdx !== -1 || aIdx !== -1)) {
      headerIdx = r;
      colDate = dIdx;
      colDesc = descIdx !== -1 ? descIdx : (dIdx === 0 ? 1 : 0);
      colDebit = wIdx;
      colCredit = cIdx;
      colAmt = aIdx;
      colType = row.findIndex(c => /type|cr\/dr|dr\/cr|indicator/.test(c));
      colRef = rIdx;
      break;
    }
  }

  // Fallback if no explicit header row was identified
  if (headerIdx === -1) {
    headerIdx = 0;
    colDate = 0;
    colDesc = 1;
    colDebit = 2;
    colCredit = 3;
  }

  const results = [];
  const dateRegex = /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{1,2}[\s\-][A-Za-z]{3}[\s\-]\d{2,4})\b/;

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    const dateVal = String(row[colDate] || '').trim();
    if (!dateRegex.test(dateVal)) continue;

    const rawNarration = String(row[colDesc] || '').trim();
    let debitAmt = colDebit !== -1 ? parseAmount(row[colDebit]) : 0;
    let creditAmt = colCredit !== -1 ? parseAmount(row[colCredit]) : 0;
    let isExpense = true;
    let finalAmt = 0;

    if (colDebit !== -1 && colCredit !== -1) {
      if (debitAmt > 0) {
        isExpense = true;
        finalAmt = debitAmt;
      } else if (creditAmt > 0) {
        isExpense = false;
        finalAmt = creditAmt;
      }
    } else if (colAmt !== -1) {
      finalAmt = parseAmount(row[colAmt]);
      const typeStr = colType !== -1 ? String(row[colType] || '').toLowerCase() : '';
      isExpense = !/(cr|credit|deposit)/i.test(typeStr);
    }

    if (finalAmt <= 0) continue;

    const cleanMerchantName = cleanNarration(rawNarration);
    const normDate = normalizeDate(dateVal);
    const prediction = predictCategory(cleanMerchantName, rawNarration, isExpense);
    const refVal = colRef !== -1 ? String(row[colRef] || '').trim() : '';
    const isDup = isDuplicateTransaction(normDate, finalAmt, isExpense, cleanMerchantName, refVal);

    results.push({
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      date: normDate,
      rawNarration: rawNarration,
      merchant: cleanMerchantName,
      isExpense: isExpense,
      amount: finalAmt,
      category: prediction.category,
      confidence: prediction.confidence,
      badgeClass: prediction.badgeClass,
      matchLabel: prediction.label,
      refId: refVal,
      source: '📄 Statement',
      isDuplicate: isDup,
      checked: !isDup,
      remember: true
    });
  }

  if (results.length === 0) {
    setParsingStatus(true, '⚠️ No valid transactions found in table. Please check headers and date column.', true);
    return;
  }

  results.forEach(r => {
    const alreadyExists = currentStatementTransactions.some(e =>
      (r.refId && e.refId && r.refId === e.refId) ||
      (r.date === e.date && Math.abs(r.amount - e.amount) < 0.01 && r.rawNarration === e.rawNarration)
    );
    if (!alreadyExists) currentStatementTransactions.push(r);
  });
  setParsingStatus(false);
  recalculateStagedAndRender();
}

// Drag and Drop Helper
function setupDropzone(dropzoneId, inputId, onFile) {
  const dropzone = document.getElementById(dropzoneId);
  const input = document.getElementById(inputId);
  if (!dropzone || !input) return;

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onFile(e.dataTransfer.files[0]);
    }
  });
  input.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      onFile(e.target.files[0]);
    }
  });
}

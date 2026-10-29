/**
 * FinTrack - Google Drive & Gmail API Integration
 * Conforms to ISO/IEC 25010 maintainability, modularity, and single responsibility.
 * 
 * Handles:
 * - Google Cloud OAuth 2.0 & Identity Services (GIS / GAPI client)
 * - Safe Base64URL and mime payload decoders for Gmail message bodies and attachments
 * - Automated inbox scanning for instant transaction alerts & statement attachments
 * - Google Drive backup synchronization and point-in-time state restore
 * - User credential management (Custom Client ID & API Key modal)
 */

// ============================================
// BASE64 & GMAIL DECODING HELPERS
// ============================================

function decodeBase64Url(str) {
  if (!str) return '';
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return decodeURIComponent(escape(atob(base64)));
  } catch(e) {
    return atob(base64);
  }
}

function base64ToUint8Array(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function extractGmailMessageBody(payload) {
  let text = '';
  if (!payload) return '';
  if (payload.body && payload.body.data) {
    text += decodeBase64Url(payload.body.data) + ' ';
  }
  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body && part.body.data) {
        text += decodeBase64Url(part.body.data) + ' ';
      } else if (part.mimeType === 'text/html' && part.body && part.body.data) {
        const html = decodeBase64Url(part.body.data);
        text += html.replace(/<[^>]+>/g, ' ') + ' ';
      } else if (part.parts) {
        text += extractGmailMessageBody(part) + ' ';
      }
    }
  }
  return text.replace(/\s+/g, ' ').trim();
}

function findAttachmentsInMessage(payload) {
  const list = [];
  if (!payload) return list;
  if (payload.filename && payload.body && payload.body.attachmentId) {
    list.push({ filename: payload.filename, attachmentId: payload.body.attachmentId, mimeType: payload.mimeType });
  }
  if (payload.parts && Array.isArray(payload.parts)) {
    payload.parts.forEach(p => list.push(...findAttachmentsInMessage(p)));
  }
  return list;
}

// ============================================
// GMAIL SYNC & SCAN WORKFLOWS
// ============================================

window.syncFromGmail = async function() {
  if (!checkGoogleConfigPrerequisites()) return;
  if (!isAuthenticated || !gapi.client.gmail) {
    if (!confirm('To sync transaction alerts directly from Gmail, please sign in with your Google Account to grant read-only access. Would you like to connect now?')) {
      return;
    }
    tokenClient.callback = async (resp) => {
      if (resp.error !== undefined) { alert('Sign-in error: ' + resp.error); return; }
      localStorage.setItem('google_token', resp.access_token);
      isAuthenticated = true;
      updateUIForAuth(true);
      doGmailScan();
    };
    tokenClient.requestAccessToken({ prompt: 'consent' });
    return;
  }
  doGmailScan();
};

async function doGmailScan() {
  const days = parseInt(document.getElementById('gmailDaysSelect')?.value || '30');
  const scanAlerts = document.getElementById('gmailSyncAlertsCheckbox')?.checked ?? true;
  const scanStatements = document.getElementById('gmailSyncStatementsCheckbox')?.checked ?? true;

  setParsingStatus(true, `🔍 Searching Gmail for bank alerts & statements in last ${days} days...`);
  try {
    const parsedAlerts = [];

    // 1. Search Alert Emails
    if (scanAlerts) {
      const alertQuery = `(from:alerts@hdfcbank.net OR from:instalerts@hdfcbank.net OR from:bankingalerts@icicibank.com OR from:alerts@sbicard.com OR from:DoNotReply@sbi.co.in OR from:alerts@axisbank.com OR from:kotak OR from:indusind OR from:idfcfirstbank OR from:rblbank OR subject:"transaction alert" OR subject:"alert:" OR subject:"debited" OR subject:"spent" OR subject:"credited") (debited OR credited OR spent OR withdrawn OR "UPI txn" OR "UPI Ref") newer_than:${days}d`;
      setParsingStatus(true, `Fetching alert messages from Gmail...`);
      const alertListRes = await gapi.client.gmail.users.messages.list({ userId: 'me', q: alertQuery, maxResults: 60 });
      const alertMsgs = alertListRes.result.messages || [];

      for (let i = 0; i < alertMsgs.length; i++) {
        setParsingStatus(true, `Reading alert email ${i+1}/${alertMsgs.length}...`);
        const msgRes = await gapi.client.gmail.users.messages.get({ userId: 'me', id: alertMsgs[i].id, format: 'full' });
        const payload = msgRes.result.payload;
        const headers = payload.headers || [];
        const subject = (headers.find(h => h.name.toLowerCase() === 'subject')?.value || '');
        const dateStr = (headers.find(h => h.name.toLowerCase() === 'date')?.value || '');
        const bodyText = extractGmailMessageBody(payload);

        const item = parseEmailAlertText(subject, bodyText, dateStr, alertMsgs[i].id);
        if (item && item.amount > 0) {
          parsedAlerts.push(item);
        }
      }
    }

    // 2. Search Statement Attachments (PDF/CSV)
    if (scanStatements) {
      const stmtDays = Math.max(days, 60);
      const stmtQuery = `has:attachment (filename:pdf OR filename:csv) (subject:statement OR subject:"e-statement" OR subject:"account statement" OR subject:"credit card statement") newer_than:${stmtDays}d`;
      setParsingStatus(true, `Searching Gmail for monthly statement attachments...`);
      const stmtListRes = await gapi.client.gmail.users.messages.list({ userId: 'me', q: stmtQuery, maxResults: 10 });
      const stmtMsgs = stmtListRes.result.messages || [];

      for (let i = 0; i < stmtMsgs.length; i++) {
        const msgRes = await gapi.client.gmail.users.messages.get({ userId: 'me', id: stmtMsgs[i].id, format: 'full' });
        const attachments = findAttachmentsInMessage(msgRes.result.payload);

        for (const att of attachments) {
          const fname = att.filename.toLowerCase();
          if (fname.endsWith('.pdf') || fname.endsWith('.csv')) {
            setParsingStatus(true, `Downloading attachment: ${att.filename}...`);
            const attRes = await gapi.client.gmail.users.messages.attachments.get({
              userId: 'me',
              messageId: stmtMsgs[i].id,
              id: att.attachmentId
            });
            if (attRes.result.data) {
              if (fname.endsWith('.pdf')) {
                const buf = base64ToUint8Array(attRes.result.data);
                await parsePDFDocument(buf);
              } else if (fname.endsWith('.csv')) {
                const text = decodeBase64Url(attRes.result.data);
                parseCSVStatement(text);
              }
            }
          }
        }
      }
    }

    currentEmailAlertTransactions = parsedAlerts;
    recalculateStagedAndRender();
    setParsingStatus(false);

    const mergedCount = stagedTransactions.filter(t => t.isMerged).length;
    const dupCount = stagedTransactions.filter(t => t.isDuplicate).length;
    alert(`🎉 Gmail Sync Complete!\n• ${parsedAlerts.length} instant alert emails found\n• ${mergedCount} merged with statement lines\n• ${dupCount} already in FinTrack (auto-skipped)`);

    document.getElementById('stagingSection')?.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    console.error(err);
    setParsingStatus(true, 'Gmail sync encountered an error: ' + err.message, true);
  }
}

// ============================================
// GOOGLE DRIVE & GIS CLIENT LIFECYCLE
// ============================================

function gapiLoaded() {
  if (typeof gapi !== 'undefined' && gapi.load) {
    gapi.load('client', initializeGapiClient);
  }
}

async function initializeGapiClient() {
  try {
    await gapi.client.init({
      apiKey: API_KEY,
      discoveryDocs: DISCOVERY_DOCS,
    });
    gapiInited = true;
    maybeEnableButtons();
  } catch (err) {
    console.warn('GAPI initialization error:', err);
  }
}

function gisLoaded() {
  try {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: '',
      });
      gisInited = true;
      maybeEnableButtons();
    }
  } catch (err) {
    console.warn('GIS initialization error:', err);
  }
}

function maybeEnableButtons() {
  if (gapiInited && gisInited) checkAuthStatus();
}

function checkAuthStatus() {
  const token = localStorage.getItem('google_token');
  if (token && typeof gapi !== 'undefined' && gapi.client) {
    gapi.client.setToken({ access_token: token });
    isAuthenticated = true;
    updateUIForAuth(true);
    const syncBtn = document.getElementById('syncBtn'); if (syncBtn) syncBtn.classList.remove('hidden');
    const restoreBtn = document.getElementById('restoreBtn'); if (restoreBtn) restoreBtn.classList.remove('hidden');
    const signOutBtn = document.getElementById('signOutBtn'); if (signOutBtn) signOutBtn.classList.remove('hidden');
    const authBtn = document.getElementById('authBtn'); if (authBtn) authBtn.textContent = '✅ Connected';
    const syncDot = document.getElementById('syncDot'); if (syncDot) syncDot.className = 'status-dot';
    const syncText = document.getElementById('syncText'); if (syncText) syncText.textContent = 'Connected to Google Drive & Gmail ✓';
    const gmailBadge = document.getElementById('gmailAuthBadge');
    if (gmailBadge) {
      gmailBadge.textContent = '✅ Connected';
      gmailBadge.className = 'badge conf-100';
    }
  } else {
    isAuthenticated = false;
    updateUIForAuth(false);
    const gmailBadge = document.getElementById('gmailAuthBadge');
    if (gmailBadge) {
      gmailBadge.textContent = '🔑 Google Account';
      gmailBadge.className = 'badge';
      gmailBadge.style = 'background:#edf2f7; color:#475569;';
    }
  }
}

function isPlaceholderGoogleConfig() {
  return !CLIENT_ID || CLIENT_ID.includes('YOUR_GOOGLE_CLIENT_ID') || CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
}

function checkGoogleConfigPrerequisites() {
  if (isPlaceholderGoogleConfig()) {
    openGoogleSetupModal('⚠️ Google Cloud OAuth is not configured yet. Please enter your Client ID & API Key.');
    return false;
  }
  if (window.location.protocol === 'file:') {
    openGoogleSetupModal('⚠️ Google OAuth 2.0 does not allow the file:/// protocol. Please run FinTrack on http://localhost or use Quick Paste offline.');
    return false;
  }
  return true;
}

// ============================================
// GOOGLE SETUP MODAL
// ============================================

window.openGoogleSetupModal = function(notice = '') {
  const modal = document.getElementById('googleSetupModal');
  if (!modal) return;
  const clientInput = document.getElementById('googleClientIdInput');
  const apiInput = document.getElementById('googleApiKeyInput');
  if (clientInput) clientInput.value = localStorage.getItem('ft_google_client_id') || (CLIENT_ID.includes('YOUR_GOOGLE') ? '' : CLIENT_ID);
  if (apiInput) apiInput.value = localStorage.getItem('ft_google_api_key') || (API_KEY.includes('YOUR_GOOGLE') ? '' : API_KEY);

  const warning = document.getElementById('protocolWarning');
  if (warning) {
    if (window.location.protocol === 'file:') {
      warning.classList.remove('hidden');
    } else {
      warning.classList.add('hidden');
    }
  }
  if (typeof notice === 'string' && notice.trim()) {
    alert(notice);
  }
  modal.classList.remove('hidden');
};

window.closeGoogleSetupModal = function() {
  const modal = document.getElementById('googleSetupModal');
  if (modal) modal.classList.add('hidden');
};

window.clearGoogleCredentials = function() {
  if (confirm('Clear stored Google Cloud Client ID and API Key?')) {
    localStorage.removeItem('ft_google_client_id');
    localStorage.removeItem('ft_google_api_key');
    localStorage.removeItem('google_token');
    CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
    API_KEY = 'YOUR_GOOGLE_API_KEY';
    signOut();
    closeGoogleSetupModal();
    alert('Credentials reset to defaults.');
  }
};

window.handleGoogleSetupSubmit = function(e) {
  e.preventDefault();
  const clientId = document.getElementById('googleClientIdInput')?.value.trim();
  const apiKey = document.getElementById('googleApiKeyInput')?.value.trim();

  const hasClientId = clientId && !clientId.includes('YOUR_GOOGLE');
  const hasApiKey = apiKey && !apiKey.includes('YOUR_GOOGLE');

  if (!hasClientId && !hasApiKey) {
    alert('Please enter a valid Google OAuth Client ID and/or Google API Key.');
    return;
  }

  if (hasClientId) {
    localStorage.setItem('ft_google_client_id', clientId);
    CLIENT_ID = clientId;
  }
  if (hasApiKey) {
    localStorage.setItem('ft_google_api_key', apiKey);
    API_KEY = apiKey;
  }

  closeGoogleSetupModal();
  alert('✅ Google credentials saved! Your settings are now updated.');

  try {
    if (hasClientId && typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: '',
      });
      gisInited = true;
    }
    if (typeof gapi !== 'undefined' && gapi.client) {
      initializeGapiClient();
    }
  } catch (err) {
    console.warn('Re-init note:', err);
  }
};

function updateUIForAuth(authenticated) {
  // Handled in checkAuthStatus, authenticate, signOut
}

// ============================================
// AUTHENTICATION ACTIONS
// ============================================

window.authenticate = function() {
  if (!checkGoogleConfigPrerequisites()) return;
  if (!isAuthenticated) {
    tokenClient.callback = async (resp) => {
      if (resp.error !== undefined) throw resp;
      localStorage.setItem('google_token', resp.access_token);
      isAuthenticated = true;
      updateUIForAuth(true);
      const syncBtn = document.getElementById('syncBtn'); if (syncBtn) syncBtn.classList.remove('hidden');
      const restoreBtn = document.getElementById('restoreBtn'); if (restoreBtn) restoreBtn.classList.remove('hidden');
      const signOutBtn = document.getElementById('signOutBtn'); if (signOutBtn) signOutBtn.classList.remove('hidden');
      const authBtn = document.getElementById('authBtn'); if (authBtn) authBtn.textContent = '✅ Connected';
      const syncDot = document.getElementById('syncDot'); if (syncDot) syncDot.className = 'status-dot';
      const syncText = document.getElementById('syncText'); if (syncText) syncText.textContent = 'Connected to Google Drive & Gmail ✓';
      const gmailBadge = document.getElementById('gmailAuthBadge');
      if (gmailBadge) {
        gmailBadge.textContent = '✅ Connected';
        gmailBadge.className = 'badge conf-100';
      }
    };
    tokenClient.requestAccessToken({ prompt: 'consent' });
  } else {
    alert('Already connected!');
  }
};

window.signOut = function() {
  localStorage.removeItem('google_token');
  if (typeof gapi !== 'undefined' && gapi.client) {
    gapi.client.setToken(null);
  }
  isAuthenticated = false;
  updateUIForAuth(false);
  const syncBtn = document.getElementById('syncBtn'); if (syncBtn) syncBtn.classList.add('hidden');
  const restoreBtn = document.getElementById('restoreBtn'); if (restoreBtn) restoreBtn.classList.add('hidden');
  const signOutBtn = document.getElementById('signOutBtn'); if (signOutBtn) signOutBtn.classList.add('hidden');
  const authBtn = document.getElementById('authBtn'); if (authBtn) authBtn.textContent = '🔑 Connect Google Drive';
  const syncDot = document.getElementById('syncDot'); if (syncDot) syncDot.className = 'status-dot disconnected';
  const syncText = document.getElementById('syncText'); if (syncText) syncText.textContent = 'Not connected to Google Drive / Gmail';
  const gmailBadge = document.getElementById('gmailAuthBadge');
  if (gmailBadge) {
    gmailBadge.textContent = '🔑 Google Account';
    gmailBadge.className = 'badge';
    gmailBadge.style = 'background:#edf2f7; color:#475569;';
  }
};

// ============================================
// GOOGLE DRIVE BACKUP & RESTORE
// ============================================

async function findFileInDrive(name) {
  const response = await gapi.client.drive.files.list({
    q: `name='${name}' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });
  const files = response.result.files;
  return files && files.length > 0 ? files[0].id : null;
}

async function getOrCreateFolder(folderName) {
  const response = await gapi.client.drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });
  const files = response.result.files;
  if (files && files.length > 0) return files[0].id;
  const fileMetadata = { name: folderName, mimeType: 'application/vnd.google-apps.folder' };
  const createResp = await gapi.client.drive.files.create({ resource: fileMetadata, fields: 'id' });
  return createResp.result.id;
}

async function createFileInDrive(data, folderId) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const metadata = { name: FILE_NAME, parents: [folderId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + gapi.client.getToken().access_token },
    body: form,
  });
  if (!response.ok) throw new Error('Failed to create file');
  return await response.json();
}

async function updateFile(fileId, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + gapi.client.getToken().access_token },
    body: blob,
  });
  if (!response.ok) throw new Error('Failed to update file');
  return await response.json();
}

window.syncToDrive = async function() {
  if (!isAuthenticated) { alert('Please connect to Google Drive first!'); return; }
  const syncBtn = document.getElementById('syncBtn');
  const syncText = document.getElementById('syncText');
  try {
    if (syncBtn) {
      syncBtn.textContent = '⏳ Syncing...';
      syncBtn.disabled = true;
    }
    const data = getAllData();
    const fileId = await findFileInDrive(FILE_NAME);
    if (fileId) await updateFile(fileId, data);
    else {
      const folderId = await getOrCreateFolder(FOLDER_NAME);
      await createFileInDrive(data, folderId);
    }
    if (syncBtn) {
      syncBtn.textContent = '☁️ Backup to Drive';
      syncBtn.disabled = false;
    }
    if (syncText) syncText.textContent = '✅ Synced successfully!';
    setTimeout(() => {
      if (syncText) syncText.textContent = 'Connected to Google Drive ✓';
    }, 3000);
    alert('✅ Data backed up to Google Drive.');
  } catch (error) {
    console.error(error);
    if (syncBtn) {
      syncBtn.textContent = '☁️ Backup to Drive';
      syncBtn.disabled = false;
    }
    alert('❌ Sync failed: ' + error.message);
  }
};

window.restoreFromDrive = async function() {
  if (!isAuthenticated) { alert('Please connect to Google Drive first!'); return; }
  if (!confirm('⚠️ This will OVERWRITE all current data with the Google Drive backup. Continue?')) return;
  const restoreBtn = document.getElementById('restoreBtn');
  try {
    if (restoreBtn) {
      restoreBtn.textContent = '⏳ Restoring...';
      restoreBtn.disabled = true;
    }
    const fileId = await findFileInDrive(FILE_NAME);
    if (!fileId) { alert('No backup found in Drive.'); return; }
    const response = await gapi.client.drive.files.get({ fileId: fileId, alt: 'media' });
    const data = response.result;
    if (!data.expenses && !data.income) throw new Error('Invalid backup file.');
    restoreData(data);
    if (restoreBtn) {
      restoreBtn.textContent = '📥 Restore from Drive';
      restoreBtn.disabled = false;
    }
    alert('✅ Data restored from Google Drive.');
  } catch (error) {
    console.error(error);
    if (restoreBtn) {
      restoreBtn.textContent = '📥 Restore from Drive';
      restoreBtn.disabled = false;
    }
    alert('❌ Restore failed: ' + error.message);
  }
};

// Modal overlay dismissal handlers (Clicking backdrop or Escape key)
document.addEventListener('DOMContentLoaded', () => {
  const setupModal = document.getElementById('googleSetupModal');
  if (setupModal) {
    setupModal.addEventListener('click', (e) => {
      if (e.target === setupModal) closeGoogleSetupModal();
    });
  }
  const pwdModal = document.getElementById('pdfPasswordModal');
  if (pwdModal) {
    pwdModal.addEventListener('click', (e) => {
      if (e.target === pwdModal && typeof cancelPasswordPrompt === 'function') cancelPasswordPrompt();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeGoogleSetupModal();
      if (typeof cancelPasswordPrompt === 'function') cancelPasswordPrompt();
    }
  });
});

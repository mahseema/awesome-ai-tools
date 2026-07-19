// Options page controller.

import { getSettings, saveSettings } from '../shared/storage-schema.js';
import { encryptApiKey, decryptApiKey, isValidApiKey, generateId, escapeHtml } from '../shared/utils.js';
import { testApiKey } from '../background/provider-manager.js';
import { RANK_WEIGHTS, PROVIDER_OPTIONS, OPENROUTER_FREE_MODELS, DEFAULT_PROVIDER, OPENROUTER_MODELS_URL } from '../shared/constants.js';

const CUSTOM_MODEL_VALUE = '__custom__';
import { localizeDocument } from '../shared/i18n.js';

let settings = {};

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  localizeDocument();
  applyTheme(localStorage.getItem('theme') || 'auto');
  settings = await getSettings();
  populateForm();
  setupTabs();
  setupListeners();
  renderCategories();
  updateSheetsStatus();
}

// ─── Theme ────────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', theme);
  }
  const btn = document.getElementById('btn-theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '◐';
}

// ─── Form Population ──────────────────────────────────────────────────────────

async function populateForm() {
  // Provider selector
  const providerSelect = document.getElementById('provider-select');
  providerSelect.innerHTML = PROVIDER_OPTIONS.map(
    (p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`
  ).join('');
  providerSelect.value = settings.provider || DEFAULT_PROVIDER;

  // OpenRouter model selector: paint the static list instantly, then refresh
  // with the live free-model list from OpenRouter (never goes stale).
  renderModelOptions(OPENROUTER_FREE_MODELS, settings.selectedModel);
  loadLiveModels(settings.selectedModel);

  updateProviderVisibility();

  // API keys (decrypt for display)
  const apiKey = settings.claudeApiKey ? await decryptApiKey(settings.claudeApiKey) : '';
  document.getElementById('api-key').value = apiKey || '';
  const orKey = settings.openrouterApiKey ? await decryptApiKey(settings.openrouterApiKey) : '';
  document.getElementById('openrouter-api-key').value = orKey || '';

  document.getElementById('enable-categories').checked = settings.enableAutoCategories !== false;
  document.getElementById('enable-summaries').checked = settings.enableAiSummaries !== false;
  document.getElementById('enable-ranking').checked = settings.rankingEnabled !== false;

  const w = settings.rankWeights || RANK_WEIGHTS;
  setSlider('weight-visits', Math.round((w.VISIT_COUNT || 0.4) * 100));
  setSlider('weight-recency', Math.round((w.RECENCY || 0.3) * 100));
  setSlider('weight-relevance', Math.round((w.AI_RELEVANCE || 0.2) * 100));
  setSlider('weight-shares', Math.round((w.SHARE_COUNT || 0.1) * 100));
}

function setSlider(id, value) {
  const el = document.getElementById(id);
  if (el) { el.value = value; document.getElementById(id + '-val').textContent = value + '%'; }
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function setupTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab)?.classList.add('active');
    });
  });
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

function setupListeners() {
  // Theme toggle: auto → dark → light → auto
  document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
    const order = ['auto', 'dark', 'light'];
    const current = localStorage.getItem('theme') || 'auto';
    const next = order[(order.indexOf(current) + 1) % order.length];
    localStorage.setItem('theme', next);
    applyTheme(next);
  });

  // Provider switch: show only the active provider's fields
  document.getElementById('provider-select').addEventListener('change', updateProviderVisibility);
  document.getElementById('model-select')?.addEventListener('change', onModelSelectChange);

  // API keys: show/hide
  setupKeyToggle('btn-toggle-key', 'api-key');
  setupKeyToggle('btn-toggle-or-key', 'openrouter-api-key');

  // Test API keys
  document.getElementById('btn-test-key').addEventListener('click', () =>
    handleTestKey({ provider: 'anthropic', inputId: 'api-key', statusId: 'api-key-status', btnId: 'btn-test-key' })
  );
  document.getElementById('btn-test-or-key').addEventListener('click', () =>
    handleTestKey({ provider: 'openrouter', inputId: 'openrouter-api-key', statusId: 'openrouter-key-status', btnId: 'btn-test-or-key' })
  );

  ['weight-visits', 'weight-recency', 'weight-relevance', 'weight-shares'].forEach((id) => {
    document.getElementById(id).addEventListener('input', (e) => {
      document.getElementById(id + '-val').textContent = e.target.value + '%';
      checkWeightTotal();
    });
  });

  document.getElementById('btn-add-category').addEventListener('click', addCategory);

  // Export
  document.getElementById('btn-export-json')?.addEventListener('click', exportJson);
  document.getElementById('btn-export-html')?.addEventListener('click', exportHtml);
  document.getElementById('btn-export-csv')?.addEventListener('click', exportCsv);

  // Import from an uploaded Chrome/Firefox bookmarks HTML export
  document.getElementById('btn-upload-html')?.addEventListener('click', () => {
    document.getElementById('upload-html-file')?.click();
  });
  document.getElementById('upload-html-file')?.addEventListener('change', handleUploadHtml);

  // Cancel a running import
  document.getElementById('btn-cancel-import')?.addEventListener('click', async () => {
    await sendMessage({ action: 'IMPORT_CANCEL' });
  });

  // Google Sheets: connect, backup, export to Drive
  document.getElementById('btn-connect-sheets')?.addEventListener('click', handleConnectSheets);
  document.getElementById('btn-backup-now')?.addEventListener('click', handleBackupNow);
  document.getElementById('btn-export-drive')?.addEventListener('click', handleExportDrive);

  // Danger zone
  document.getElementById('btn-clear-ai-data').addEventListener('click', handleClearAiData);
  document.getElementById('btn-reset-all').addEventListener('click', handleResetAll);

  document.getElementById('btn-save').addEventListener('click', handleSave);
}

// ─── Model selection ──────────────────────────────────────────────────────────

/**
 * Renders the model dropdown from a list of {id, label} and appends a
 * "Custom…" entry. Preserves the current selection; if `selected` isn't in the
 * list it switches to Custom and fills the free-text input.
 */
function renderModelOptions(models, selected) {
  const sel = document.getElementById('model-select');
  const custom = document.getElementById('model-custom');
  if (!sel) return;

  const opts = models.map(
    (m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label || m.id)}${m.free ? '' : ''}</option>`
  );
  opts.push(`<option value="${CUSTOM_MODEL_VALUE}">✏️ Custom / paste model id…</option>`);
  sel.innerHTML = opts.join('');

  const known = models.some((m) => m.id === selected);
  if (selected && !known) {
    sel.value = CUSTOM_MODEL_VALUE;
    if (custom) { custom.value = selected; custom.classList.remove('hidden'); }
  } else {
    sel.value = selected || (models[0] && models[0].id) || CUSTOM_MODEL_VALUE;
    if (custom) custom.classList.add('hidden');
  }
}

/** Fetches the live free-model list from OpenRouter and repaints the dropdown. */
async function loadLiveModels(selected) {
  try {
    const res = await fetch(OPENROUTER_MODELS_URL);
    if (!res.ok) return; // keep the static list
    const data = await res.json();
    const free = (data.data || [])
      .filter((m) => {
        const p = m.pricing || {};
        return String(p.prompt) === '0' && String(p.completion) === '0';
      })
      .map((m) => ({ id: m.id, label: `${m.name || m.id} — FREE`, free: true }))
      .sort((a, b) => a.label.localeCompare(b.label));

    if (free.length) renderModelOptions(free, selected || document.getElementById('model-select')?.value);
  } catch {
    // Offline or blocked — the static list stays in place.
  }
}

/** Shows the free-text model input only when "Custom…" is selected. */
function onModelSelectChange() {
  const sel = document.getElementById('model-select');
  const custom = document.getElementById('model-custom');
  if (!sel || !custom) return;
  custom.classList.toggle('hidden', sel.value !== CUSTOM_MODEL_VALUE);
  if (sel.value === CUSTOM_MODEL_VALUE) custom.focus();
}

/** The effective model id to persist (resolves the Custom case). */
function getSelectedModel() {
  const sel = document.getElementById('model-select');
  if (!sel) return '';
  if (sel.value === CUSTOM_MODEL_VALUE) {
    return document.getElementById('model-custom')?.value.trim() || '';
  }
  return sel.value;
}

// ─── Provider UI ──────────────────────────────────────────────────────────────

function updateProviderVisibility() {
  const provider = document.getElementById('provider-select').value;
  document.getElementById('provider-openrouter').classList.toggle('hidden', provider !== 'openrouter');
  document.getElementById('provider-anthropic').classList.toggle('hidden', provider !== 'anthropic');
}

function setupKeyToggle(btnId, inputId) {
  document.getElementById(btnId).addEventListener('click', () => {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(btnId);
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.textContent = input.type === 'password' ? 'Show' : 'Hide';
  });
}

// ─── API Key Testing ──────────────────────────────────────────────────────────

async function handleTestKey({ provider, inputId, statusId, btnId }) {
  const keyInput = document.getElementById(inputId).value.trim();
  const statusEl = document.getElementById(statusId);
  const btn = document.getElementById(btnId);

  if (!keyInput) {
    showStatus(statusEl, 'Enter an API key first.', 'error');
    return;
  }
  if (!isValidApiKey(keyInput, provider)) {
    const prefix = provider === 'openrouter' ? 'sk-or-' : 'sk-ant-';
    showStatus(statusEl, `Key should start with "${prefix}"`, 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Testing…';
  showStatus(statusEl, '', '');

  try {
    const model = provider === 'openrouter' ? getSelectedModel() : undefined;
    await testApiKey(keyInput, provider, model);
    showStatus(statusEl, '✓ API key is valid', 'ok');
  } catch (err) {
    showStatus(statusEl, `✗ ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test';
  }
}

// ─── Categories ───────────────────────────────────────────────────────────────

function renderCategories() {
  const list = document.getElementById('categories-list');
  list.innerHTML = (settings.categories || []).map((cat) => `
    <div class="cat-row" data-cat-id="${escapeHtml(cat.id)}">
      <input type="color" class="cat-row-color" value="${escapeHtml(cat.color)}" title="Change color">
      <span class="cat-row-name">${escapeHtml(cat.name)}</span>
      <button class="cat-row-del" data-cat-id="${escapeHtml(cat.id)}" title="Delete category">✕</button>
    </div>
  `).join('');

  list.querySelectorAll('.cat-row-del').forEach((btn) => {
    btn.addEventListener('click', () => deleteCategory(btn.dataset.catId));
  });

  list.querySelectorAll('.cat-row-color').forEach((input) => {
    input.addEventListener('change', (e) => {
      const id = input.closest('.cat-row').dataset.catId;
      const cat = settings.categories.find((c) => c.id === id);
      if (cat) cat.color = e.target.value;
    });
  });
}

function addCategory() {
  const name = prompt('Category name:');
  if (!name?.trim()) return;
  settings.categories = settings.categories || [];
  settings.categories.push({ id: generateId('cat'), name: name.trim(), color: '#6366f1', icon: 'bookmark' });
  renderCategories();
}

function deleteCategory(id) {
  if (!confirm('Delete this category? Bookmarks will become uncategorized.')) return;
  settings.categories = (settings.categories || []).filter((c) => c.id !== id);
  renderCategories();
}

// ─── Ranking ──────────────────────────────────────────────────────────────────

function checkWeightTotal() {
  const total =
    parseInt(document.getElementById('weight-visits').value) +
    parseInt(document.getElementById('weight-recency').value) +
    parseInt(document.getElementById('weight-relevance').value) +
    parseInt(document.getElementById('weight-shares').value);

  document.getElementById('weight-total-warning').style.display = total !== 100 ? 'block' : 'none';
}

// ─── Export / Import ──────────────────────────────────────────────────────────

async function collectExportRows() {
  const { getBookmarkIndex, getSummary } = await import('../shared/storage-schema.js');
  const index = await getBookmarkIndex();
  const entries = Object.values(index).sort((a, b) => (b.rankScore || 0) - (a.rankScore || 0));
  return Promise.all(
    entries.map(async (e) => ({
      ...e,
      summary: e.summaryRef ? (await getSummary(e.id))?.summary || '' : '',
      categoryName: settings.categories.find((c) => c.id === e.categoryId)?.name || '',
    }))
  );
}

async function exportCsv() {
  const rows = await collectExportRows();
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    ['Title', 'URL', 'Category', 'Tags', 'Summary', 'Rank', 'Visits', 'Created'].map(esc).join(','),
    ...rows.map((r) =>
      [r.title, r.url, r.categoryName, (r.tags || []).join('; '), r.summary, r.rankScore, r.visitCount,
        r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : ''].map(esc).join(',')
    ),
  ];
  // BOM so Excel opens Hebrew/Chinese text correctly
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `ai-bookmarks-${new Date().toISOString().slice(0, 10)}.csv`);
}

async function exportJson() {
  const rows = await collectExportRows();
  const blob = new Blob([JSON.stringify({ version: 2, bookmarks: rows }, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `ai-bookmarks-${new Date().toISOString().slice(0, 10)}.json`);
}

async function exportHtml() {
  const rows = await collectExportRows();
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>AI Bookmarks Export</TITLE>',
    '<H1>AI Bookmarks</H1>',
    '<DL><p>',
    ...rows.map((e) => `  <DT><A HREF="${e.url}" ADD_DATE="${Math.floor((e.createdAt || Date.now()) / 1000)}">${e.title || e.url}</A>`),
    '</DL><p>',
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/html' });
  downloadBlob(blob, `ai-bookmarks-${new Date().toISOString().slice(0, 10)}.html`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.bookmarks?.length) throw new Error('No bookmarks found in file');

    const { upsertBookmark } = await import('../shared/storage-schema.js');
    for (const bm of data.bookmarks) {
      await upsertBookmark(bm);
    }
    setSaveStatus(`Imported ${data.bookmarks.length} bookmarks`);
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }

  e.target.value = '';
}

// ─── Danger Zone ──────────────────────────────────────────────────────────────

async function handleClearAiData() {
  if (!confirm('Clear all AI summaries and re-queue bookmarks for processing? This cannot be undone.')) return;

  const { getBookmarkIndex, saveBookmarkIndex } = await import('../shared/storage-schema.js');
  const index = await getBookmarkIndex();

  for (const entry of Object.values(index)) {
    entry.aiStatus = 'pending';
    entry.summaryRef = null;
    entry.tags = [];
    entry.categoryId = null;
  }

  await saveBookmarkIndex(index);
  setSaveStatus('AI data cleared. Bookmarks will be re-processed.');
}

async function handleResetAll() {
  if (!confirm('Delete ALL AI Bookmarks data? This cannot be undone.')) return;
  if (!confirm('Are you absolutely sure? All bookmarks and settings will be lost.')) return;

  await chrome.storage.sync.clear();
  await chrome.storage.local.clear();
  setSaveStatus('All data cleared. Reload the extension.');
}

// ─── Save ─────────────────────────────────────────────────────────────────────

async function handleSave() {
  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    await saveCurrentSettings();
    setSaveStatus('✓ Saved');
  } catch (err) {
    setSaveStatus(`✗ Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Settings';
    setTimeout(() => setSaveStatus(''), 3000);
  }
}

/**
 * Encrypts an API-key input's value only if the user actually changed it.
 * Returns the previously-stored encrypted blob when unchanged, and emptyValue
 * when the field was cleared.
 */
async function encryptIfChanged(inputId, storedEncrypted, emptyValue = '') {
  const raw = document.getElementById(inputId)?.value.trim() || '';
  if (!raw) return emptyValue;
  const currentDecrypted = storedEncrypted ? await decryptApiKey(storedEncrypted) : '';
  if (raw === currentDecrypted) return storedEncrypted;
  return encryptApiKey(raw);
}

async function saveCurrentSettings() {
  // API keys: encrypt before saving (only re-encrypt when changed)
  const encryptedKey = await encryptIfChanged('api-key', settings.claudeApiKey, '');
  const encryptedOrKey = await encryptIfChanged('openrouter-api-key', settings.openrouterApiKey, null);

  const totalWeight =
    parseInt(document.getElementById('weight-visits').value) +
    parseInt(document.getElementById('weight-recency').value) +
    parseInt(document.getElementById('weight-relevance').value) +
    parseInt(document.getElementById('weight-shares').value);

  if (totalWeight !== 100) {
    throw new Error('Ranking weights must sum to 100%');
  }

  const updated = {
    ...settings,
    provider: document.getElementById('provider-select').value,
    claudeApiKey: encryptedKey,
    openrouterApiKey: encryptedOrKey,
    selectedModel: getSelectedModel() || settings.selectedModel,
    enableAutoCategories: document.getElementById('enable-categories').checked,
    enableAiSummaries: document.getElementById('enable-summaries').checked,
    rankingEnabled: document.getElementById('enable-ranking').checked,
    rankWeights: {
      VISIT_COUNT: parseInt(document.getElementById('weight-visits').value) / 100,
      RECENCY: parseInt(document.getElementById('weight-recency').value) / 100,
      AI_RELEVANCE: parseInt(document.getElementById('weight-relevance').value) / 100,
      SHARE_COUNT: parseInt(document.getElementById('weight-shares').value) / 100,
    },
  };

  await saveSettings(updated);
  settings = updated;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showStatus(el, msg, type) {
  el.textContent = msg;
  el.className = 'status-msg' + (type ? ` status-${type}` : '');
}

function setSaveStatus(msg) {
  document.getElementById('save-status').textContent = msg;
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (response?.error) reject(new Error(response.error));
      else resolve(response);
    });
  });
}


// ─── Import (scan/upload) ─────────────────────────────────────────────────────

document.getElementById('btn-scan-bookmarks')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-scan-bookmarks');
  const progress = document.getElementById('import-progress');
  const fill = document.getElementById('progress-fill');
  const stats = document.getElementById('progress-stats');

  btn.disabled = true;
  progress.classList.remove('hidden');
  fill.style.width = '0%';
  stats.textContent = 'Scanning...';

  // Start import in service worker
  await sendMessage({ action: 'IMPORT_START', payload: { source: 'all', processWithAI: true } });

  // Poll for progress
  const poll = setInterval(async () => {
    try {
      const state = await sendMessage({ action: 'GET_IMPORT_STATE' });
      if (!state) return;
      const pct = state.total > 0 ? Math.round((state.scanned / state.total) * 100) : 0;
      fill.style.width = Math.min(pct, 100) + '%';
      stats.textContent = `Scanned: ${state.scanned}/${state.total} | AI: ${state.enriched} | Failed: ${state.failed}`;
      if (!state.running || state.cancelled) {
        clearInterval(poll);
        btn.disabled = false;
        if (state.total > 0 && !state.cancelled) setSaveStatus(`Import complete: ${state.scanned} bookmarks`);
      }
    } catch { clearInterval(poll); btn.disabled = false; }
  }, 500);
});



// ─── Google Sheets Backup ──────────────────────────────────────────────────────

async function updateSheetsStatus() {
  try {
    const status = await sendMessage({ action: 'GOOGLE_SHEETS_STATUS' });
    const el = document.getElementById('sheets-status');
    const dot = el.querySelector('.status-dot');
    if (status.connected) {
      dot.className = 'status-dot connected';
      el.querySelector('span:last-child').textContent = 'Connected';
    }
  } catch {}
}

async function handleConnectSheets() {
  const btn = document.getElementById('btn-connect-sheets');
  const result = document.getElementById('sheets-result');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Connecting…';
  try {
    const res = await sendMessage({ action: 'GOOGLE_SHEETS_CONNECT' });
    if (result && res?.sheetUrl) {
      result.innerHTML = `Connected. <a href="${escapeHtml(res.sheetUrl)}" target="_blank" rel="noopener">Open spreadsheet</a>`;
      result.classList.remove('hidden');
    }
    await updateSheetsStatus();
  } catch (err) {
    if (result) { result.textContent = `Connection failed: ${err.message}`; result.classList.remove('hidden'); }
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

async function handleBackupNow() {
  const btn = document.getElementById('btn-backup-now');
  const result = document.getElementById('sheets-result');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Backing up…';
  try {
    const res = await sendMessage({ action: 'BACKUP_NOW' });
    if (result) {
      const link = res?.sheetUrl ? ` <a href="${escapeHtml(res.sheetUrl)}" target="_blank" rel="noopener">Open</a>` : '';
      result.innerHTML = `✓ Backed up ${res?.count ?? 0} bookmarks (${res?.skipped ?? 0} already present).${link}`;
      result.classList.remove('hidden');
    }
  } catch (err) {
    if (result) { result.textContent = `Backup failed: ${err.message}`; result.classList.remove('hidden'); }
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

async function handleExportDrive() {
  const btn = document.getElementById('btn-export-drive');
  const result = document.getElementById('drive-result');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Exporting…';
  try {
    const res = await sendMessage({ action: 'EXPORT_TO_DRIVE' });
    if (result && res?.fileUrl) {
      result.innerHTML = `✓ Exported to <a href="${escapeHtml(res.fileUrl)}" target="_blank" rel="noopener">${escapeHtml(res.fileName || 'CSV on Drive')}</a>`;
      result.classList.remove('hidden');
    }
  } catch (err) {
    if (result) { result.textContent = `Export failed: ${err.message}`; result.classList.remove('hidden'); }
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

async function handleUploadHtml(e) {
  const file = e.target.files[0];
  if (!file) return;

  const progress = document.getElementById('import-progress');
  const fill = document.getElementById('progress-fill');
  const stats = document.getElementById('progress-stats');

  try {
    const htmlContent = await file.text();
    progress?.classList.remove('hidden');
    if (fill) fill.style.width = '0%';
    if (stats) stats.textContent = 'Parsing file…';

    await sendMessage({ action: 'IMPORT_START', payload: { htmlContent, processWithAI: true } });

    const poll = setInterval(async () => {
      try {
        const state = await sendMessage({ action: 'GET_IMPORT_STATE' });
        if (!state) return;
        const pct = state.total > 0 ? Math.round((state.scanned / state.total) * 100) : 0;
        if (fill) fill.style.width = Math.min(pct, 100) + '%';
        if (stats) stats.textContent = `Imported: ${state.scanned}/${state.total} | AI: ${state.enriched} | Failed: ${state.failed}`;
        if (!state.running) {
          clearInterval(poll);
          setSaveStatus(`Import complete: ${state.scanned} bookmarks`);
        }
      } catch { clearInterval(poll); }
    }, 500);
  } catch (err) {
    alert(`Upload failed: ${err.message}`);
  }
  e.target.value = '';
}

// ─── Start ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);

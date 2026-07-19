// Google Sheets backup client for AI Bookmarks.
// Uses chrome.identity OAuth to write bookmark data to a Google Sheet.
// Fallback: CSV export when Sheets API is unavailable.

import { getSettings, getBookmarkIndex, getSummary } from '../shared/storage-schema.js';
import { normalizeUrl, getDomain } from '../shared/utils.js';
import { logError } from '../shared/error-handler.js';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

const SHEET_TITLE = 'AI Bookmarks Backup';
const SHEET_HEADERS = [
  'URL', 'Title', 'AI Summary', 'Category', 'Tags',
  'Rank Score', 'Created At', 'Last Visited', 'Visit Count'
];

let _cachedToken = null;

/**
 * Authenticates with chrome.identity and returns an OAuth token.
 */
async function getAuthToken(interactive = false) {
  // Google Sheets backup needs a real OAuth client id in manifest.json. Ship
  // with a placeholder, so surface a clear, actionable message instead of a
  // cryptic chrome.identity error.
  const clientId = chrome.runtime.getManifest()?.oauth2?.client_id || '';
  if (!clientId || clientId.startsWith('YOUR_GOOGLE_OAUTH_CLIENT_ID')) {
    throw new Error(
      'Google Sheets backup needs a one-time setup: add a Google OAuth client id ' +
      'to manifest.json (see README → "Google Sheets backup setup"). Your bookmarks, ' +
      'AI, search, categories and ranking all work without this — only Sheets backup needs it.'
    );
  }
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive, scopes: SCOPES }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        _cachedToken = token;
        resolve(token);
      }
    });
  });
}

/**
 * Creates a new Google Sheet and returns its spreadsheetId.
 */
async function createSheet(token) {
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title: SHEET_TITLE },
      sheets: [{
        properties: { title: 'Bookmarks' },
        gridProperties: { frozenRowCount: 1 },
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create sheet: ${err}`);
  }

  const data = await res.json();
  const sheetId = data.spreadsheetId;

  // Write headers
  await appendRows(token, sheetId, 'Bookmarks!A1', [SHEET_HEADERS]);

  return sheetId;
}

/**
 * Appends rows to a sheet.
 */
async function appendRows(token, spreadsheetId, range, rows) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: rows,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to append rows: ${err}`);
  }

  return res.json();
}

/**
 * Reads existing sheet to find existing rows by URL.
 */
async function readExistingRows(token, spreadsheetId) {
  try {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Bookmarks!A:A`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.values || []).map(r => r[0]).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Gets or creates the backup sheet. Returns { spreadsheetId, sheetUrl }.
 */
async function getOrCreateSheet(token) {
  // Search for existing sheet by name
  const filesRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${encodeURIComponent(SHEET_TITLE)}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false&fields=files(id,webViewLink)`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );

  if (filesRes.ok) {
    const files = await filesRes.json();
    if (files.files && files.files.length > 0) {
      return {
        spreadsheetId: files.files[0].id,
        sheetUrl: files.files[0].webViewLink,
      };
    }
  }

  const sheetId = await createSheet(token);
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}`;
  return { spreadsheetId: sheetId, sheetUrl };
}

/**
 * Converts a bookmark entry + summary to a flat row array.
 */
function entryToRow(entry, summary) {
  const created = entry.createdAt ? new Date(entry.createdAt).toISOString().split('T')[0] : '';
  const visited = entry.lastVisited ? new Date(entry.lastVisited).toISOString().split('T')[0] : '';
  const tags = (entry.tags || []).join(', ');
  return [
    entry.url || '',
    entry.title || '',
    (summary && summary.summary) || '',
    entry.categoryId || '',
    tags,
    String(entry.rankScore || 0),
    created,
    visited,
    String(entry.visitCount || 0),
  ];
}

/**
 * Backs up all bookmarks to Google Sheets.
 * Returns { ok, sheetUrl, count } or throws.
 */
export async function backupAllBookmarks(interactive = false) {
  const token = await getAuthToken(interactive);
  const { spreadsheetId, sheetUrl } = await getOrCreateSheet(token);

  // Read existing URLs to avoid duplicates
  const existingUrls = await readExistingRows(token, spreadsheetId);
  const existingSet = new Set(existingUrls);

  // Get all bookmarks
  const index = await getBookmarkIndex();
  const entries = Object.values(index);

  // Filter out already-backed-up entries
  const newEntries = entries.filter(e => !existingSet.has(e.url));
  if (newEntries.length === 0) {
    return { ok: true, sheetUrl, count: 0, skipped: entries.length };
  }

  // Build rows with summaries
  const rows = [];
  for (const entry of newEntries) {
    const summary = entry.summaryRef ? await getSummary(entry.id) : null;
    rows.push(entryToRow(entry, summary));
  }

  // Append in batches of 10 (Google Sheets API limit)
  for (let i = 0; i < rows.length; i += 10) {
    const batch = rows.slice(i, i + 10);
    await appendRows(token, spreadsheetId, 'Bookmarks!A1', batch);
  }

  return { ok: true, sheetUrl, count: rows.length, skipped: existingSet.size - 1 };
}

/**
 * Exports a CSV file to Google Drive.
 * Returns the Drive file URL.
 */
export async function exportToDrive(interactive = false) {
  const token = await getAuthToken(interactive);
  const index = await getBookmarkIndex();
  const entries = Object.values(index);

  // Build CSV content with BOM for Hebrew/Chinese
  const BOM = '\uFEFF';
  const csvRows = [SHEET_HEADERS.join(',')];

  for (const entry of entries) {
    const summary = entry.summaryRef ? await getSummary(entry.id) : null;
    const row = entryToRow(entry, summary);
    // Escape CSV fields
    const escaped = row.map(field => {
      const str = String(field || '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    });
    csvRows.push(escaped.join(','));
  }

  const csvContent = BOM + csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });

  // Upload to Drive via the Drive API
  const date = new Date().toISOString().split('T')[0];
  const metadata = {
    name: `AI Bookmarks - Export ${date}.csv`,
    mimeType: 'text/csv',
  };

  const formData = new FormData();
  formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  formData.append('file', blob, metadata.name);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive upload failed: ${err}`);
  }

  const data = await res.json();
  return { fileId: data.id, fileUrl: data.webViewLink, fileName: metadata.name };
}

/**
 * Checks whether a Google Sheets connection is established.
 * Returns { connected: boolean, sheetUrl: string | null }.
 */
export async function checkConnection() {
  try {
    const token = await getAuthToken(false);
    const { sheetUrl } = await getOrCreateSheet(token);
    return { connected: true, sheetUrl };
  } catch {
    return { connected: false, sheetUrl: null };
  }
}

/**
 * Initiates the OAuth flow interactively (pops up a consent screen).
 */
export async function connect() {
  const token = await getAuthToken(true);
  const { sheetUrl } = await getOrCreateSheet(token);
  return { connected: true, sheetUrl };
}

/**
 * Exports a single bookmark's data as a CSV row string.
 * Used for the "export single" feature.
 */
export function entryToCsvRow(entry, summary) {
  const row = entryToRow(entry, summary);
  return row.map(f => {
    const s = String(f || '');
    return s.includes(',') || s.includes('"') ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',');
}

// Storage schema definitions and read/write helpers
// All four extension contexts (service worker, content script, popup, options) use this module.

import {
  STORAGE_KEYS,
  SUMMARY_KEY_PREFIX,
  DEFAULT_SETTINGS,
  DEFAULT_MODEL,
  MAX_BOOKMARK_INDEX_SIZE,
  BOOKMARK_LRU_EVICT_COUNT,
} from './constants.js';

// OpenRouter model ids that were removed and now return 404. If any of these is
// still stored as the selected model, fall back to the current default so the
// extension keeps working without the user having to reconfigure.
const DEAD_MODELS = new Set([
  'google/gemini-2.0-flash-exp:free',
  'deepseek/deepseek-chat:free',
  'qwen/qwen-2.5-72b-instruct:free',
]);

// ─── Type Definitions (JSDoc) ────────────────────────────────────────────────

/**
 * @typedef {Object} BookmarkIndexEntry
 * @property {string} id               - Internal ID (bm_ + nanoid)
 * @property {string} chromeBookmarkId - Chrome bookmark node ID
 * @property {string} url
 * @property {string} title
 * @property {string|null} categoryId
 * @property {string[]} tags
 * @property {number} visitCount
 * @property {number} lastVisited      - Unix ms timestamp
 * @property {number} rankScore
 * @property {number} createdAt        - Unix ms timestamp
 * @property {'pending'|'enriched'|'failed'} aiStatus
 * @property {string|null} summaryRef  - Key in local storage for full summary
 */

/**
 * @typedef {Object} BookmarkSummary
 * @property {string} id
 * @property {string} url
 * @property {string} summary
 * @property {string} extractedText
 * @property {string} aiModel
 * @property {number} generatedAt
 */

/**
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} name
 * @property {string} color  - Hex color
 * @property {string} icon
 */

/**
 * @typedef {Object} Settings
 * @property {'openrouter'|'anthropic'} provider - Active AI provider
 * @property {string} claudeApiKey      - Encrypted
 * @property {string|null} openrouterApiKey - Encrypted
 * @property {string} selectedModel     - OpenRouter model id
 * @property {boolean} enableAutoCategories
 * @property {boolean} enableAiSummaries
 * @property {boolean} rankingEnabled
 * @property {Category[]} categories
 * @property {Object} rankWeights
 */

// ─── Settings ────────────────────────────────────────────────────────────────

export async function getSettings() {
  const result = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
  const stored = result[STORAGE_KEYS.SETTINGS] || {};
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  // v1 → v2 migration: users who configured a Claude key before providers
  // existed keep using Anthropic instead of silently switching to OpenRouter.
  if (stored.provider === undefined && stored.claudeApiKey) {
    settings.provider = 'anthropic';
  }
  // Heal a stored model that OpenRouter has since removed (would 404).
  if (!settings.selectedModel || DEAD_MODELS.has(settings.selectedModel)) {
    settings.selectedModel = DEFAULT_MODEL;
  }
  return settings;
}

export async function saveSettings(settings) {
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

export async function updateSettings(partial) {
  const current = await getSettings();
  const updated = { ...current, ...partial };
  await saveSettings(updated);
  return updated;
}

/**
 * Returns just the OpenRouter-related settings.
 * @returns {Promise<{ provider: string, openrouterApiKey: string|null, selectedModel: string }>}
 */
export async function getOpenRouterSettings() {
  const { provider, openrouterApiKey, selectedModel } = await getSettings();
  return { provider, openrouterApiKey, selectedModel };
}

/**
 * Saves OpenRouter-related settings without touching the rest.
 * @param {{ provider?: string, openrouterApiKey?: string|null, selectedModel?: string }} partial
 */
export async function saveOpenRouterSettings({ provider, openrouterApiKey, selectedModel }) {
  const partial = {};
  if (provider !== undefined) partial.provider = provider;
  if (openrouterApiKey !== undefined) partial.openrouterApiKey = openrouterApiKey;
  if (selectedModel !== undefined) partial.selectedModel = selectedModel;
  return updateSettings(partial);
}

// ─── Bookmark Index ───────────────────────────────────────────────────────────

/** @returns {Promise<Record<string, BookmarkIndexEntry>>} */
export async function getBookmarkIndex() {
  const result = await chrome.storage.sync.get(STORAGE_KEYS.BOOKMARK_INDEX);
  return result[STORAGE_KEYS.BOOKMARK_INDEX] || {};
}

/** @param {Record<string, BookmarkIndexEntry>} index */
export async function saveBookmarkIndex(index) {
  await chrome.storage.sync.set({ [STORAGE_KEYS.BOOKMARK_INDEX]: index });
}

/** @param {BookmarkIndexEntry} entry */
export async function upsertBookmark(entry) {
  const index = await getBookmarkIndex();
  index[entry.id] = entry;

  // Enforce max size with LRU eviction
  const ids = Object.keys(index);
  if (ids.length > MAX_BOOKMARK_INDEX_SIZE) {
    const sorted = ids.sort((a, b) => (index[a].lastVisited || 0) - (index[b].lastVisited || 0));
    const toEvict = sorted.slice(0, BOOKMARK_LRU_EVICT_COUNT);
    toEvict.forEach((id) => delete index[id]);
  }

  await saveBookmarkIndex(index);
}

export async function deleteBookmark(bookmarkId) {
  const index = await getBookmarkIndex();
  const entry = index[bookmarkId];
  delete index[bookmarkId];
  await saveBookmarkIndex(index);

  // Also remove from local storage
  if (entry?.summaryRef) {
    await chrome.storage.local.remove(entry.summaryRef);
  }
}

export async function getBookmarkByChromeId(chromeBookmarkId) {
  const index = await getBookmarkIndex();
  return Object.values(index).find((e) => e.chromeBookmarkId === chromeBookmarkId) || null;
}

// ─── Summaries (local storage) ───────────────────────────────────────────────

/** @returns {Promise<BookmarkSummary|null>} */
export async function getSummary(bookmarkId) {
  const key = SUMMARY_KEY_PREFIX + bookmarkId;
  const result = await chrome.storage.local.get(key);
  return result[key] || null;
}

/** @param {BookmarkSummary} summary */
export async function saveSummary(summary) {
  const key = SUMMARY_KEY_PREFIX + summary.id;
  await chrome.storage.local.set({ [key]: summary });
  return key;
}

// ─── Pending Queue ────────────────────────────────────────────────────────────

export async function getPendingQueue() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.PENDING_QUEUE);
  return result[STORAGE_KEYS.PENDING_QUEUE] || [];
}

export async function enqueuePending(item) {
  const queue = await getPendingQueue();
  // Avoid duplicates
  if (!queue.find((q) => q.bookmarkId === item.bookmarkId)) {
    queue.push({ ...item, queuedAt: Date.now() });
    await chrome.storage.local.set({ [STORAGE_KEYS.PENDING_QUEUE]: queue });
  }
}

export async function dequeuePending() {
  const queue = await getPendingQueue();
  if (queue.length === 0) return null;
  const item = queue.shift();
  await chrome.storage.local.set({ [STORAGE_KEYS.PENDING_QUEUE]: queue });
  return item;
}

export async function removePending(bookmarkId) {
  const queue = await getPendingQueue();
  const filtered = queue.filter((q) => q.bookmarkId !== bookmarkId);
  await chrome.storage.local.set({ [STORAGE_KEYS.PENDING_QUEUE]: filtered });
}

// ─── Visit Log ────────────────────────────────────────────────────────────────

export async function getVisitLog() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.VISIT_LOG);
  return result[STORAGE_KEYS.VISIT_LOG] || {};
}

export async function recordVisit(url) {
  const log = await getVisitLog();
  if (!log[url]) log[url] = [];
  log[url].push(Date.now());

  // Prune old entries (keep last 20 per URL)
  log[url] = log[url].slice(-20);

  // Prune total entries
  const urls = Object.keys(log);
  if (urls.length > 1000) {
    const oldest = urls.sort((a, b) => {
      const aLast = log[a][log[a].length - 1] || 0;
      const bLast = log[b][log[b].length - 1] || 0;
      return aLast - bLast;
    });
    oldest.slice(0, 100).forEach((u) => delete log[u]);
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.VISIT_LOG]: log });
}

// ─── Loop Prevention (just-moved set) ────────────────────────────────────────

const JUST_MOVED_KEY = 'just_moved';

export async function markJustMoved(chromeBookmarkId) {
  const result = await chrome.storage.local.get(JUST_MOVED_KEY);
  const moved = result[JUST_MOVED_KEY] || {};
  moved[chromeBookmarkId] = Date.now();
  await chrome.storage.local.set({ [JUST_MOVED_KEY]: moved });
}

export async function isJustMoved(chromeBookmarkId, ttlMs = 500) {
  const result = await chrome.storage.local.get(JUST_MOVED_KEY);
  const moved = result[JUST_MOVED_KEY] || {};
  const ts = moved[chromeBookmarkId];
  if (!ts) return false;
  if (Date.now() - ts >= ttlMs) {
    delete moved[chromeBookmarkId];
    await chrome.storage.local.set({ [JUST_MOVED_KEY]: moved });
    return false;
  }
  return true;
}

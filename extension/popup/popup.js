// Popup controller — orchestrates all popup components.
// All data comes from chrome.runtime.sendMessage to the service worker.
// First paint is always from local storage (fast); then live updates via messages.

import { ACTIONS } from '../shared/constants.js';
import { renderCategoryTree } from './components/category-tree.js';
import { renderBookmarkList } from './components/bookmark-list.js';
import { initShareModal } from './components/share-modal.js';
import { debounce } from '../shared/utils.js';
import { localizeDocument } from '../shared/i18n.js';

// ─── State ────────────────────────────────────────────────────────────────────

let state = {
  allBookmarks: {},    // Record<id, BookmarkIndexEntry>
  settings: {},
  selectedCategoryId: null,  // null = "All"
  searchQuery: '',
};

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  localizeDocument();
  applyTheme(localStorage.getItem('theme') || 'auto');
  showLoading(true);

  try {
    const [bookmarks, settings] = await Promise.all([
      sendMessage({ action: ACTIONS.GET_BOOKMARKS }),
      sendMessage({ action: ACTIONS.GET_SETTINGS }),
    ]);

    state.allBookmarks = bookmarks || {};
    state.settings = settings || {};

    showLoading(false);
    render();
    checkApiKey();
  } catch (err) {
    showLoading(false);
    console.error('[Popup] Init error', err);
  }

  setupListeners();
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  const filtered = getFilteredBookmarks();

  renderCategoryTree({
    container: document.getElementById('category-tree'),
    bookmarks: Object.values(state.allBookmarks),
    categories: state.settings.categories || [],
    selectedCategoryId: state.selectedCategoryId,
    onSelect: (categoryId) => {
      state.selectedCategoryId = categoryId;
      render();
    },
  });

  renderBookmarkList({
    container: document.getElementById('bookmark-list'),
    emptyState: document.getElementById('empty-state'),
    entries: filtered,
    query: state.searchQuery,
    categories: state.settings.categories || [],
    onRetry: handleRetry,
  });
}

function getFilteredBookmarks() {
  let entries = Object.values(state.allBookmarks);

  // Category filter
  if (state.selectedCategoryId === '__uncategorized__') {
    entries = entries.filter((e) => !e.categoryId);
  } else if (state.selectedCategoryId) {
    entries = entries.filter((e) => e.categoryId === state.selectedCategoryId);
  }

  // Search filter
  if (state.searchQuery) {
    entries = searchBookmarks(entries, state.searchQuery);
  } else {
    // Sort by rank descending
    entries = entries.sort((a, b) => (b.rankScore || 0) - (a.rankScore || 0));
  }

  return entries;
}

function searchBookmarks(entries, query) {
  const q = query.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  if (!q) return entries;

  const scored = entries.map((entry) => {
    let score = 0;
    const title = (entry.title || '').toLowerCase();
    const url = (entry.url || '').toLowerCase();
    const tags = (entry.tags || []).join(' ').toLowerCase();

    if (title === q) score += 100;
    else if (title.includes(q)) score += 80;
    if (url.includes(q)) score += 70;
    if (tags.includes(q)) score += 60;

    return { entry, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score * 0.7 + (b.entry.rankScore || 0) * 0.3 - (a.score * 0.7 + (a.entry.rankScore || 0) * 0.3))
    .map((s) => s.entry);
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

function setupListeners() {
  // Search
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', debounce((e) => {
    state.searchQuery = e.target.value.trim();
    render();
  }, 200));

  // Settings button → opens options page
  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  // Theme toggle: auto → dark → light → auto
  document.getElementById('btn-theme').addEventListener('click', () => {
    const order = ['auto', 'dark', 'light'];
    const current = localStorage.getItem('theme') || 'auto';
    const next = order[(order.indexOf(current) + 1) % order.length];
    localStorage.setItem('theme', next);
    applyTheme(next);
  });

  // Share button
  document.getElementById('btn-share').addEventListener('click', () => {
    const visibleEntries = getFilteredBookmarks();
    initShareModal({
      entries: visibleEntries,
      categoryId: state.selectedCategoryId,
      categories: state.settings.categories || [],
    });
    document.getElementById('share-modal').classList.remove('hidden');
  });

  // No API key banner
  document.getElementById('btn-open-options')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  // Live updates from service worker
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === ACTIONS.BOOKMARK_ENRICHED || message.action === ACTIONS.BOOKMARK_PENDING) {
      state.allBookmarks[message.payload.id] = message.payload;
      render();
    }
  });
}

async function handleRetry(entry) {
  await sendMessage({ action: ACTIONS.RETRY_AI, payload: { chromeBookmarkId: entry.chromeBookmarkId } });
  entry.aiStatus = 'pending';
  state.allBookmarks[entry.id] = entry;
  render();
}

function checkApiKey() {
  const banner = document.getElementById('no-api-key-banner');
  const s = state.settings || {};
  const hasKey = s.provider === 'anthropic' ? Boolean(s.claudeApiKey) : Boolean(s.openrouterApiKey);
  banner.classList.toggle('hidden', hasKey);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', theme);
  }
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '◐';
}

function showLoading(show) {
  document.getElementById('loading-state').classList.toggle('hidden', !show);
  document.getElementById('bookmark-list').classList.toggle('hidden', show);
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);


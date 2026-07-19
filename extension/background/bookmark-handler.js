// Orchestrates the full AI enrichment pipeline for each saved bookmark.

import { ACTIONS, CONTENT_EXTRACT_TIMEOUT_MS, MOVE_TTL_MS } from '../shared/constants.js';
import {
  getSettings,
  getBookmarkIndex,
  upsertBookmark,
  deleteBookmark,
  getBookmarkByChromeId,
  enqueuePending,
  dequeuePending,
  getPendingQueue,
  saveSummary,
  markJustMoved,
  isJustMoved,
} from '../shared/storage-schema.js';
import { generateId, normalizeUrl } from '../shared/utils.js';
import { enrichWithAI, hasApiKey } from './provider-manager.js';
import { applyCategorizationResult } from './categorizer.js';
import { computeRankScore } from './ranker.js';
import { logError } from '../shared/error-handler.js';
import { ERROR_CODES, AiBookmarksError } from '../shared/error-handler.js';

// ─── Bookmark Created ─────────────────────────────────────────────────────────

export async function handleBookmarkCreated(chromeBookmarkId, bookmarkInfo) {
  // Skip if this creation was triggered by our own move operation
  if (await isJustMoved(chromeBookmarkId, MOVE_TTL_MS)) return;

  const settings = await getSettings();
  const url = normalizeUrl(bookmarkInfo.url);
  const internalId = generateId('bm');

  // Build placeholder entry immediately (shows in popup without waiting for AI)
  const entry = {
    id: internalId,
    chromeBookmarkId,
    url,
    title: bookmarkInfo.title || url,
    categoryId: null,
    tags: [],
    visitCount: 0,
    lastVisited: Date.now(),
    rankScore: 0,
    createdAt: Date.now(),
    aiStatus: 'pending',
    summaryRef: null,
  };

  await upsertBookmark(entry);

  // Notify popup that a new bookmark is pending
  notifyPopup({ action: ACTIONS.BOOKMARK_PENDING, payload: entry });

  // Enqueue for AI processing
  await enqueuePending({ bookmarkId: internalId, url, title: entry.title, chromeBookmarkId });

  // Process immediately (non-blocking; errors are handled inside)
  processQueue().catch((err) => logError('processQueue', err));
}

// ─── Bookmark Removed ─────────────────────────────────────────────────────────

export async function handleBookmarkRemoved(chromeBookmarkId) {
  const entry = await getBookmarkByChromeId(chromeBookmarkId);
  if (entry) {
    await deleteBookmark(entry.id);
  }
}

// ─── Bookmark Changed ─────────────────────────────────────────────────────────

export async function handleBookmarkChanged(chromeBookmarkId, changeInfo) {
  const entry = await getBookmarkByChromeId(chromeBookmarkId);
  if (!entry) return;

  if (changeInfo.title && changeInfo.title !== entry.title) {
    entry.title = changeInfo.title;
    entry.aiStatus = 'pending';
    await upsertBookmark(entry);
    await enqueuePending({ bookmarkId: entry.id, url: entry.url, title: entry.title, chromeBookmarkId });
    processQueue().catch((err) => logError('processQueue on title change', err));
  }
}

// ─── Queue Processor ──────────────────────────────────────────────────────────

let isProcessing = false;

export async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    let item;
    while ((item = await dequeuePending()) !== null) {
      await processSingleBookmark(item);
    }
  } finally {
    isProcessing = false;
  }
}

async function processSingleBookmark(queueItem) {
  const { bookmarkId, url, title, chromeBookmarkId } = queueItem;
  const settings = await getSettings();

  try {
    // Step 1: Extract page content
    let extractedContent = null;
    if (chromeBookmarkId) {
      extractedContent = await extractPageContent(url);
    }

    const extractedText = extractedContent?.text || '';
    const description = extractedContent?.description || '';

    if (!settings.enableAiSummaries && !settings.enableAutoCategories) {
      // AI is disabled: just compute rank score and update
      const index = await getBookmarkIndex();
      const entry = index[bookmarkId];
      if (entry) {
        entry.aiStatus = 'enriched';
        entry.rankScore = await computeRankScore(entry);
        await upsertBookmark(entry);
      }
      return;
    }

    if (!(await hasApiKey(settings))) {
      // No API key for the active provider: mark as pending (user can add key later)
      return;
    }

    // Step 2: Call the active AI provider for categorization + summary
    const result = await enrichWithAI({
      url,
      title,
      extractedText,
      description,
      categories: settings.categories,
    });

    // Step 3: Apply results to storage and Chrome bookmark tree
    const index = await getBookmarkIndex();
    const entry = index[bookmarkId];
    if (!entry) return; // Bookmark was deleted while we were processing

    const updatedEntry = await applyCategorizationResult({
      entry,
      result,
      chromeBookmarkId,
      settings,
    });

    // Step 4: Persist AI summary
    const summaryKey = await saveSummary({
      id: bookmarkId,
      url,
      summary: result.summary,
      extractedText: extractedText.slice(0, 4000),
      aiModel: result.model,
      generatedAt: Date.now(),
    });
    updatedEntry.summaryRef = summaryKey;
    updatedEntry.aiStatus = 'enriched';
    updatedEntry.rankScore = await computeRankScore(updatedEntry);

    await upsertBookmark(updatedEntry);

    // Step 5: Notify popup that this bookmark is enriched
    notifyPopup({ action: ACTIONS.BOOKMARK_ENRICHED, payload: updatedEntry });

    console.log(`[AI Bookmarks] Enriched: ${title} → ${result.category}`);
  } catch (err) {
    logError(`processSingleBookmark: ${title}`, err);

    // Mark as failed in index so user can retry
    const index = await getBookmarkIndex();
    const entry = index[bookmarkId];
    if (entry) {
      entry.aiStatus = 'failed';
      await upsertBookmark(entry);
    }

    // Re-enqueue if it's a retryable error
    const { isRetryable } = await import('../shared/error-handler.js');
    if (isRetryable(err)) {
      await enqueuePending({ bookmarkId, url, title, chromeBookmarkId });
    }
  }
}

// ─── Content Extraction ───────────────────────────────────────────────────────

async function extractPageContent(url) {
  try {
    // Find a tab with the matching URL
    const tabs = await chrome.tabs.query({ url: normalizeUrl(url) + '*' });
    const tab = tabs.find((t) => t.url && normalizeUrl(t.url) === normalizeUrl(url));
    if (!tab) return null;

    const results = await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractContentFromPage,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new AiBookmarksError('Extract timeout', ERROR_CODES.EXTRACT_TIMEOUT)), CONTENT_EXTRACT_TIMEOUT_MS)
      ),
    ]);

    return results?.[0]?.result || null;
  } catch {
    return null;
  }
}

// This function is injected into the page context (must be self-contained)
function extractContentFromPage() {
  function getMetaContent(name) {
    const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
    return el?.content || '';
  }

  function cleanText(el) {
    if (!el) return '';
    // Clone and remove noise elements
    const clone = el.cloneNode(true);
    clone.querySelectorAll('script, style, nav, footer, aside, header, [aria-hidden="true"]').forEach((n) => n.remove());
    return clone.innerText?.replace(/\s+/g, ' ').trim() || '';
  }

  let text = '';

  // Priority 1: JSON-LD
  const jsonLd = document.querySelector('script[type="application/ld+json"]');
  if (jsonLd) {
    try {
      const data = JSON.parse(jsonLd.textContent);
      const body = data.articleBody || data.description || data.text;
      if (body) text = body.slice(0, 4000);
    } catch {}
  }

  // Priority 2: <article>
  if (!text) {
    const article = document.querySelector('article');
    if (article) text = cleanText(article).slice(0, 4000);
  }

  // Priority 3: <main>
  if (!text) {
    const main = document.querySelector('main');
    if (main) text = cleanText(main).slice(0, 4000);
  }

  // Priority 4: body fallback
  if (!text) {
    text = cleanText(document.body).slice(0, 4000);
  }

  return {
    text,
    title: document.title,
    description: getMetaContent('description') || getMetaContent('og:description'),
    keywords: getMetaContent('keywords'),
    ogImage: getMetaContent('og:image'),
    canonical: document.querySelector('link[rel="canonical"]')?.href || location.href,
  };
}

// ─── Popup Notification ───────────────────────────────────────────────────────

function notifyPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup might not be open — ignore
  });
}

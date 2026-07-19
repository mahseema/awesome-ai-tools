// Bookmark importer — scans Chrome bookmark tree, uploads HTML exports,
// and processes existing bookmarks through the AI pipeline.
// Supports progress reporting via runtime messages.

import { ACTIONS, AI_BATCH_SIZE } from '../shared/constants.js';
import { generateId, normalizeUrl } from '../shared/utils.js';
import {
  getBookmarkIndex, upsertBookmark, saveBookmarkIndex,
  enqueuePending, getSettings,
} from '../shared/storage-schema.js';
import { processQueue } from './bookmark-handler.js';
import { logError } from '../shared/error-handler.js';

let importState = {
  running: false,
  total: 0,
  scanned: 0,
  enriched: 0,
  failed: 0,
  cancelled: false,
};

/**
 * Reports import progress to any open popup/options page.
 */
function reportProgress() {
  chrome.runtime.sendMessage({
    action: ACTIONS.IMPORT_PROGRESS,
    payload: { ...importState },
  }).catch(() => {
    // No listener — ignore
  });
}

/**
 * Scans the Chrome bookmark tree and returns all bookmark nodes with URLs.
 */
async function scanBookmarkTree(nodes) {
  const results = [];
  for (const node of nodes) {
    if (node.url) {
      results.push({
        id: node.id,
        title: node.title || node.url,
        url: normalizeUrl(node.url),
        dateAdded: node.dateAdded,
        parentId: node.parentId,
      });
    }
    if (node.children) {
      results.push(...await scanBookmarkTree(node.children));
    }
  }
  return results;
}

/**
 * Parses a Chrome bookmarks HTML export file.
 * Standard format: <DT><A HREF="url" ADD_DATE="...">Title</A>
 */
function parseBookmarksHtml(htmlContent) {
  const results = [];
  const linkRegex = /<A\s+HREF="([^"]*)"[^>]*ADD_DATE="(\d+)"[^>]*>([^<]*)<\/A>/gi;
  let match;

  while ((match = linkRegex.exec(htmlContent)) !== null) {
    const url = match[1].trim();
    const title = match[3].trim();
    const dateAdded = parseInt(match[2], 10) * 1000 || Date.now();

    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      results.push({ url: normalizeUrl(url), title: title || url, dateAdded });
    }
  }

  return results;
}

/**
 * Starts importing bookmarks from the Chrome bookmark tree.
 * @param {object} options
 * @param {'all'|'bookmark_bar'|'other'} [options.source='all'] - Which folder to scan
 * @param {boolean} [options.processWithAI=true] - Whether to run AI enrichment
 * @param {string} [options.htmlContent] - Raw HTML content from uploaded file
 */
export async function startImport(options = {}) {
  if (importState.running) {
    throw new Error('Import already in progress');
  }

  const { source = 'all', processWithAI = true, htmlContent = null } = options;
  importState = { running: true, total: 0, scanned: 0, enriched: 0, failed: 0, cancelled: false };
  reportProgress();

  try {
    let bookmarks;

    if (htmlContent) {
      // Import from uploaded HTML file
      bookmarks = parseBookmarksHtml(htmlContent);
    } else {
      // Scan Chrome bookmark tree
      const tree = await chrome.bookmarks.getTree();
      let nodes = tree;

      if (source === 'bookmark_bar') {
        // Bookmarks Bar is typically the first child of root
        const bar = tree[0]?.children?.[0];
        nodes = bar ? [bar] : tree;
      } else if (source === 'other') {
        const other = tree[0]?.children?.[1];
        nodes = other ? [other] : tree;
      }

      bookmarks = await scanBookmarkTree(nodes);
    }

    importState.total = bookmarks.length;
    reportProgress();

    // Process in batches
    // Check which bookmarks are already indexed
    const existingIndex = await getBookmarkIndex();
    const existingUrls = new Set(Object.values(existingIndex).map(e => e.url));
    const existingIds = new Set(Object.values(existingIndex).map(e => e.chromeBookmarkId).filter(Boolean));
    const newBookmarks = bookmarks.filter(bm => !existingUrls.has(bm.url) && !existingIds.has(bm.id));

    importState.total = newBookmarks.length;
    reportProgress();

    for (let i = 0; i < newBookmarks.length; i += AI_BATCH_SIZE) {
      if (importState.cancelled) break;

      const batch = newBookmarks.slice(i, i + AI_BATCH_SIZE);

      for (const bm of batch) {
        if (importState.cancelled) break;

        importState.scanned++;
        reportProgress();

        // Create internal entry
        const internalId = generateId('bm');
        const entry = {
          id: internalId,
          chromeBookmarkId: bm.id || null,
          url: bm.url,
          title: bm.title || bm.url,
          categoryId: null,
          tags: [],
          visitCount: 0,
          lastVisited: bm.dateAdded || Date.now(),
          rankScore: 0,
          createdAt: bm.dateAdded || Date.now(),
          aiStatus: processWithAI ? 'pending' : 'enriched',
          summaryRef: null,
        };

        await upsertBookmark(entry);

        if (processWithAI) {
          try {
            // Enqueue for AI processing
            await enqueuePending({
              bookmarkId: internalId,
              url: bm.url,
              title: entry.title,
              chromeBookmarkId: bm.id || null,
            });

            importState.enriched++;
          } catch (err) {
            logError('Importer: AI enrichment', err);
            importState.failed++;
          }
        }

        reportProgress();
      }

      // Yield to allow other service worker tasks
      await new Promise(r => setTimeout(r, 10));
    }
  } catch (err) {
    logError('Importer', err);
    importState.failed = importState.total - importState.scanned;
  } finally {
    importState.running = false;
    reportProgress();
  }

  // Kick off AI processing now instead of waiting for the periodic alarm.
  if (processWithAI && importState.enriched > 0) {
    processQueue().catch((err) => logError('Importer: processQueue', err));
  }

  return { ...importState, queued: importState.enriched };
}

/**
 * Cancels an ongoing import.
 */
export function cancelImport() {
  importState.cancelled = true;
}

/**
 * Gets the current import state.
 */
export function getImportState() {
  return { ...importState, queued: importState.enriched };
}


// ─── Backward-compatible aliases ──────────────────────────────────────────────
export { startImport as importExistingBookmarks, getImportState as getImportProgress };

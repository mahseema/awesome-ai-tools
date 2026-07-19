// Applies AI categorization results: finds/creates folders, moves bookmarks.

import { MAX_CATEGORIES } from '../shared/constants.js';
import { getSettings, updateSettings, markJustMoved } from '../shared/storage-schema.js';
import { generateId } from '../shared/utils.js';
import { logError } from '../shared/error-handler.js';

const EXTENSION_FOLDER_NAME = 'AI Bookmarks';

/**
 * Applies the AI result to the bookmark entry and Chrome bookmark tree.
 * Returns the updated entry (does NOT save to storage — caller does that).
 *
 * @param {{ entry: import('../shared/storage-schema.js').BookmarkIndexEntry, result: Object, chromeBookmarkId: string, settings: import('../shared/storage-schema.js').Settings }} params
 */
export async function applyCategorizationResult({ entry, result, chromeBookmarkId, settings }) {
  if (!settings.enableAutoCategories) {
    return { ...entry, tags: result.tags };
  }

  // Find or create the category
  let category = settings.categories.find(
    (c) => c.name.toLowerCase() === result.category.toLowerCase()
  );

  if (!category && result.isNewCategory && settings.categories.length < MAX_CATEGORIES) {
    category = {
      id: generateId('cat'),
      name: result.category,
      color: result.categoryColor || randomColor(),
      icon: 'bookmark',
    };
    const updatedSettings = await updateSettings({
      categories: [...settings.categories, category],
    });
  } else if (!category) {
    // Fall back to the closest existing category
    category = settings.categories[0] || { id: 'cat_uncategorized', name: 'Uncategorized' };
  }

  // Move the Chrome bookmark to the correct folder (if auto-categories enabled)
  if (chromeBookmarkId) {
    try {
      const folderId = await getOrCreateFolder(category.name);
      // Mark as just-moved BEFORE the move to prevent re-triggering the pipeline
      await markJustMoved(chromeBookmarkId);
      await chrome.bookmarks.move(chromeBookmarkId, { parentId: folderId });
    } catch (err) {
      logError('categorizer: bookmark move failed', err);
      // Non-fatal: continue without moving
    }
  }

  return {
    ...entry,
    categoryId: category.id,
    tags: result.tags,
  };
}

// ─── Folder Management ────────────────────────────────────────────────────────

/** Cache of category name → Chrome folder node ID */
const folderCache = {};

async function getOrCreateFolder(categoryName) {
  if (folderCache[categoryName]) return folderCache[categoryName];

  // Ensure the root "AI Bookmarks" folder exists
  const rootId = await getOrCreateRootFolder();

  // Look for existing child folder matching category name
  const children = await chrome.bookmarks.getChildren(rootId);
  const existing = children.find(
    (c) => !c.url && c.title.toLowerCase() === categoryName.toLowerCase()
  );

  if (existing) {
    folderCache[categoryName] = existing.id;
    return existing.id;
  }

  // Create new subfolder
  const created = await chrome.bookmarks.create({ parentId: rootId, title: categoryName });
  folderCache[categoryName] = created.id;
  return created.id;
}

let rootFolderId = null;

async function getOrCreateRootFolder() {
  if (rootFolderId) return rootFolderId;

  // Search in Bookmarks Bar and Other Bookmarks
  const tree = await chrome.bookmarks.getTree();
  const allNodes = flattenTree(tree);
  const existing = allNodes.find(
    (n) => !n.url && n.title === EXTENSION_FOLDER_NAME
  );

  if (existing) {
    rootFolderId = existing.id;
    return rootFolderId;
  }

  // Create under "Other Bookmarks" (index 1 in root children, typically)
  const rootChildren = tree[0]?.children || [];
  const otherBookmarks = rootChildren.find((n) => n.id === '2') || rootChildren[1] || rootChildren[0];
  const created = await chrome.bookmarks.create({
    parentId: otherBookmarks?.id || '1',
    title: EXTENSION_FOLDER_NAME,
  });

  rootFolderId = created.id;
  return rootFolderId;
}

function flattenTree(nodes) {
  const result = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children) result.push(...flattenTree(node.children));
  }
  return result;
}

function randomColor() {
  const colors = ['#4A90E2', '#7ED321', '#F5A623', '#D0021B', '#9B59B6', '#1ABC9C', '#E67E22', '#E74C3C'];
  return colors[Math.floor(Math.random() * colors.length)];
}

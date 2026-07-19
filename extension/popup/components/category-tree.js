// Renders the category sidebar tree.

import { escapeHtml } from '../../shared/utils.js';
import { t } from '../../shared/i18n.js';

/**
 * @param {{ container: HTMLElement, bookmarks: Object[], categories: Object[], selectedCategoryId: string|null, onSelect: Function }} opts
 */
export function renderCategoryTree({ container, bookmarks, categories, selectedCategoryId, onSelect }) {
  const counts = buildCategoryCounts(bookmarks);
  const totalCount = bookmarks.length;

  let html = '';

  // "All" item
  html += categoryItem({
    id: null,
    name: t('allCategory') || 'All',
    color: '#6a737d',
    count: totalCount,
    isActive: selectedCategoryId === null,
  });

  // Individual categories (only those with bookmarks or defined in settings)
  const visibleCategories = categories.filter((c) => counts[c.id] > 0 || categories.length <= 10);

  for (const cat of visibleCategories) {
    html += categoryItem({
      id: cat.id,
      name: cat.name,
      color: cat.color,
      count: counts[cat.id] || 0,
      isActive: selectedCategoryId === cat.id,
    });
  }

  // Uncategorized
  const uncategorizedCount = bookmarks.filter((b) => !b.categoryId).length;
  if (uncategorizedCount > 0) {
    html += categoryItem({
      id: '__uncategorized__',
      name: t('uncategorized') || 'Uncategorized',
      color: '#c0c8d0',
      count: uncategorizedCount,
      isActive: selectedCategoryId === '__uncategorized__',
    });
  }

  container.innerHTML = html;

  // Attach event listeners
  container.querySelectorAll('.cat-item').forEach((el) => {
    el.addEventListener('click', () => {
      const catId = el.dataset.catId === 'null' ? null : el.dataset.catId;
      onSelect(catId);
    });
  });
}

function categoryItem({ id, name, color, count, isActive }) {
  const dataId = id === null ? 'null' : escapeHtml(String(id));
  const activeClass = isActive ? ' active' : '';
  return `
    <button class="cat-item${activeClass}" data-cat-id="${dataId}" title="${escapeHtml(name)}">
      <span class="cat-dot" style="background:${escapeHtml(color)}"></span>
      <span class="cat-name">${escapeHtml(name)}</span>
      <span class="cat-count">${count}</span>
    </button>
  `;
}

function buildCategoryCounts(bookmarks) {
  const counts = {};
  for (const bm of bookmarks) {
    if (bm.categoryId) {
      counts[bm.categoryId] = (counts[bm.categoryId] || 0) + 1;
    }
  }
  return counts;
}

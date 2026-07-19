// Renders the main bookmark card list.

import { escapeHtml, timeAgo, highlightMatches, getFaviconUrl } from '../../shared/utils.js';
import { t } from '../../shared/i18n.js';

/**
 * @param {{ container: HTMLElement, emptyState: HTMLElement, entries: Object[], query: string, categories: Object[], onRetry: Function }} opts
 */
export function renderBookmarkList({ container, emptyState, entries, query, categories, onRetry }) {
  if (entries.length === 0) {
    container.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  const categoryMap = {};
  for (const cat of categories) categoryMap[cat.id] = cat;

  container.innerHTML = entries
    .slice(0, 100) // Virtual scroll: render first 100
    .map((entry) => renderBookmarkCard(entry, query, categoryMap))
    .join('');

  // Attach event listeners
  container.querySelectorAll('[data-action="retry"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const entry = entries.find((e) => e.id === id);
      if (entry) onRetry(entry);
    });
  });

  container.querySelectorAll('.bm-title a').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: link.href });
    });
  });
}

function renderBookmarkCard(entry, query, categoryMap) {
  const title = highlightMatches(entry.title || entry.url, query);
  const favicon = getFaviconUrl(entry.url);
  const faviconEl = favicon
    ? `<img class="bm-favicon" src="${escapeHtml(favicon)}" alt="" onerror="this.style.display='none'">`
    : '<span class="bm-favicon" style="background:#e1e4e8;border-radius:2px"></span>';

  const tags = (entry.tags || [])
    .slice(0, 4)
    .map((t) => `<span class="bm-tag">${escapeHtml(t)}</span>`)
    .join('');

  const rankPercent = Math.round(entry.rankScore || 0);

  const statusBadge = entry.aiStatus === 'pending'
    ? `<span class="bm-status status-pending">${escapeHtml(t('aiPending') || 'AI pending…')}</span>`
    : entry.aiStatus === 'failed'
    ? `<button class="bm-status status-failed" data-action="retry" data-id="${escapeHtml(entry.id)}">${escapeHtml(t('retryAi') || 'Retry AI')}</button>`
    : '';

  const timeEl = entry.lastVisited
    ? `<span class="bm-time">${escapeHtml(timeAgo(entry.lastVisited))}</span>`
    : '';

  return `
    <article class="bookmark-card" role="listitem">
      <div class="bm-header">
        ${faviconEl}
        <div class="bm-title">
          <a href="${escapeHtml(entry.url)}" title="${escapeHtml(entry.url)}">${title}</a>
        </div>
      </div>
      ${entry.summary ? `<p class="bm-summary">${escapeHtml(entry.summary)}</p>` : ''}
      <div class="bm-footer">
        <div class="bm-tags">${tags}</div>
        <div class="bm-meta">
          ${statusBadge}
          ${timeEl}
          <div class="bm-rank" title="Rank score: ${rankPercent}">
            <div class="rank-bar">
              <div class="rank-fill" style="width:${rankPercent}%"></div>
            </div>
            <span>${rankPercent}</span>
          </div>
        </div>
      </div>
    </article>
  `;
}

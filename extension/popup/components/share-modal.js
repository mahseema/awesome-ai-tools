// Share modal: create a shareable collection link (backend removed in v2; shows a notice).

import { t } from '../../shared/i18n.js';
import { escapeHtml } from '../../shared/utils.js';

let _currentEntries = [];
let _initialized = false;

export function initShareModal({ entries, categoryId, categories }) {
  _currentEntries = entries;

  const catName = categoryId
    ? categories.find((c) => c.id === categoryId)?.name || 'My Collection'
    : 'My Collection';

  document.getElementById('share-name').value = catName;
  document.getElementById('share-desc').value = '';
  document.getElementById('share-result').classList.add('hidden');

  if (!_initialized) {
    _initialized = true;
    setupModalListeners();
  }
}

function setupModalListeners() {
  const modal = document.getElementById('share-modal');

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-share').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.getElementById('btn-confirm-share').addEventListener('click', handleShare);

  document.getElementById('btn-copy-link').addEventListener('click', () => {
    const markdown = buildMarkdownList(
      document.getElementById('share-name').value.trim() || 'My Collection',
      _currentEntries
    );
    navigator.clipboard.writeText(markdown).catch(() => {});
    document.getElementById('btn-copy-link').textContent = t('copied') || 'Copied!';
    setTimeout(() => {
      document.getElementById('btn-copy-link').textContent = t('copy') || 'Copy';
    }, 2000);
  });
}

async function handleShare() {
  const name = document.getElementById('share-name').value.trim() || 'My Collection';
  const description = document.getElementById('share-desc').value.trim();

  const html = buildShareHtml(name, description, _currentEntries.slice(0, 200));
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^\w֐-׿一-鿿 -]/g, '').trim() || 'collection'}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // Zero-backend sharing: the HTML file is downloaded above; also surface the
  // "copy as markdown" affordance so the user can paste the list anywhere.
  const input = document.getElementById('share-link-input');
  if (input) input.value = `${name} — ${_currentEntries.length} bookmarks (HTML downloaded)`;
  document.getElementById('share-result').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('share-modal').classList.add('hidden');
}

// ─── Output builders ──────────────────────────────────────────────────────────

function buildMarkdownList(name, entries) {
  const lines = [`# ${name}`, ''];
  for (const e of entries) {
    lines.push(`- [${e.title || e.url}](${e.url})${e.summary ? ` — ${e.summary}` : ''}`);
  }
  return lines.join('\n');
}

function buildShareHtml(name, description, entries) {
  const cards = entries
    .map(
      (e) => `
      <a class="card" href="${escapeHtml(e.url)}" target="_blank" rel="noopener">
        <div class="card-title">${escapeHtml(e.title || e.url)}</div>
        ${e.summary ? `<div class="card-summary">${escapeHtml(e.summary)}</div>` : ''}
        ${(e.tags || []).length ? `<div class="card-tags">${e.tags.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        <div class="card-url">${escapeHtml(e.url)}</div>
      </a>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(name)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e2e5ec; padding: 48px 20px; }
  @media (prefers-color-scheme: light) { body { background: #f6f7fb; color: #1a1d27; } .card { background: #fff !important; border-color: #e4e7f0 !important; } .card-summary { color: #5b6172 !important; } }
  .wrap { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 28px; font-weight: 800; background: linear-gradient(90deg,#818cf8,#c084fc); -webkit-background-clip: text; background-clip: text; color: transparent; margin-bottom: 8px; }
  .desc { color: #9aa1b4; margin-bottom: 8px; }
  .meta { color: #6a7186; font-size: 13px; margin-bottom: 32px; }
  .grid { display: grid; gap: 12px; }
  .card { display: block; background: #181b25; border: 1px solid #262a38; border-radius: 14px; padding: 18px 20px; text-decoration: none; color: inherit; transition: transform .15s, border-color .15s; }
  .card:hover { transform: translateY(-2px); border-color: #6366f1; }
  .card-title { font-weight: 700; font-size: 15px; margin-bottom: 6px; }
  .card-summary { font-size: 13px; color: #9aa1b4; line-height: 1.5; margin-bottom: 10px; }
  .card-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
  .card-tags span { font-size: 11px; padding: 2px 9px; border-radius: 999px; background: rgba(99,102,241,.15); color: #a5b4fc; }
  .card-url { font-size: 11px; color: #6a7186; direction: ltr; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .footer { text-align: center; margin-top: 40px; color: #6a7186; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${escapeHtml(name)}</h1>
  ${description ? `<p class="desc">${escapeHtml(description)}</p>` : ''}
  <p class="meta">${entries.length} bookmarks · curated with AI Bookmarks</p>
  <div class="grid">${cards}</div>
  <p class="footer">Generated by AI Bookmarks — AI-organized bookmarks with summaries &amp; smart ranking</p>
</div>
</body>
</html>`;
}

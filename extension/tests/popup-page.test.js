// RUNTIME test of the popup controller: imports the real popup.js against the
// DOM stub, fires DOMContentLoaded, and asserts init + render complete without
// throwing (catches undefined functions/elements in the executed path).

import { resetChromeMock } from './setup/chrome-mock.js';
import { installDomMock } from './setup/dom-mock.js';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

const chromeMock = resetChromeMock();
const doc = installDomMock();

const BOOKMARKS = {
  bm_1: {
    id: 'bm_1', chromeBookmarkId: '10', url: 'https://example.com', title: 'Example',
    categoryId: 'cat_tech', tags: ['js'], visitCount: 3, lastVisited: 1700000000000,
    rankScore: 42, createdAt: 1700000000000, aiStatus: 'enriched', summaryRef: null,
    summary: 'A test bookmark.',
  },
};

chromeMock.runtime._messageHandler = (message) => {
  switch (message?.action) {
    case 'GET_BOOKMARKS': return BOOKMARKS;
    case 'GET_SETTINGS': return {
      provider: 'openrouter', openrouterApiKey: 'enc-blob', claudeApiKey: null,
      categories: [{ id: 'cat_tech', name: 'Technology', color: '#d35400', icon: 'code' }],
    };
    default: return {};
  }
};

let uncaught = null;
process.on('unhandledRejection', (err) => { uncaught = err; });

describe('popup page — real init/render flow', () => {
  before(async () => {
    await import('../popup/popup.js');
    await doc.dispatch('DOMContentLoaded');
    await new Promise((r) => setTimeout(r, 30));
  });

  test('init + render completed without uncaught errors', () => {
    assert.equal(uncaught, null, uncaught ? `uncaught: ${uncaught.message}` : '');
  });

  test('category tree and bookmark list rendered content', () => {
    assert.ok(doc.getElementById('category-tree').innerHTML.includes('Technology'));
    assert.ok(doc.getElementById('bookmark-list').innerHTML.includes('Example'));
  });

  test('no-API-key banner is hidden when the active provider has a key', () => {
    assert.ok(doc.getElementById('no-api-key-banner').classList.contains('hidden'));
  });

  test('search input filters without throwing', async () => {
    const search = doc.getElementById('search-input');
    search.value = 'example';
    await search.dispatch('input', { target: search });
    await new Promise((r) => setTimeout(r, 250)); // debounce
    assert.equal(uncaught, null);
  });
});

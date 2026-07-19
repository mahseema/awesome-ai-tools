import { resetChromeMock } from './setup/chrome-mock.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSettings,
  saveSettings,
  updateSettings,
  getBookmarkIndex,
  saveBookmarkIndex,
  upsertBookmark,
  deleteBookmark,
  getBookmarkByChromeId,
  getSummary,
  saveSummary,
  getPendingQueue,
  enqueuePending,
  dequeuePending,
  removePending,
  getVisitLog,
  recordVisit,
  markJustMoved,
  isJustMoved,
} from '../shared/storage-schema.js';
import { DEFAULT_SETTINGS, MAX_BOOKMARK_INDEX_SIZE, BOOKMARK_LRU_EVICT_COUNT } from '../shared/constants.js';

function makeEntry(id, overrides = {}) {
  return {
    id,
    chromeBookmarkId: `c_${id}`,
    url: `https://example.com/${id}`,
    title: `Page ${id}`,
    categoryId: null,
    tags: [],
    visitCount: 0,
    lastVisited: Date.now(),
    rankScore: 0,
    createdAt: Date.now(),
    aiStatus: 'pending',
    summaryRef: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetChromeMock();
});

describe('settings', () => {
  test('returns defaults when nothing stored', async () => {
    const s = await getSettings();
    assert.equal(s.enableAutoCategories, DEFAULT_SETTINGS.enableAutoCategories);
    assert.equal(s.categories.length, DEFAULT_SETTINGS.categories.length);
  });

  test('saveSettings persists and getSettings merges over defaults', async () => {
    await saveSettings({ openrouterApiKey: 'encrypted-blob' });
    const s = await getSettings();
    assert.equal(s.openrouterApiKey, 'encrypted-blob');
    assert.equal(s.enableAiSummaries, true); // default preserved
    assert.equal(s.provider, 'openrouter'); // default provider
  });

  test('updateSettings merges partial updates', async () => {
    await saveSettings({ openrouterApiKey: 'k1', selectedModel: 'm1' });
    const updated = await updateSettings({ selectedModel: 'm2' });
    assert.equal(updated.selectedModel, 'm2');
    assert.equal(updated.openrouterApiKey, 'k1');
  });

  test('v1→v2 migration: a stored claudeApiKey without provider selects Anthropic', async () => {
    await saveSettings({ claudeApiKey: 'legacy-key' });
    const s = await getSettings();
    assert.equal(s.provider, 'anthropic');
  });
});

describe('bookmark index', () => {
  test('upsert and read back', async () => {
    await upsertBookmark(makeEntry('bm_1'));
    const index = await getBookmarkIndex();
    assert.equal(index.bm_1.title, 'Page bm_1');
  });

  test('upsert overwrites existing entry', async () => {
    await upsertBookmark(makeEntry('bm_1'));
    await upsertBookmark(makeEntry('bm_1', { title: 'Updated' }));
    const index = await getBookmarkIndex();
    assert.equal(index.bm_1.title, 'Updated');
    assert.equal(Object.keys(index).length, 1);
  });

  test('LRU eviction keeps the index under the max size', async () => {
    const index = {};
    for (let i = 0; i < MAX_BOOKMARK_INDEX_SIZE; i++) {
      index[`bm_${i}`] = makeEntry(`bm_${i}`, { lastVisited: i });
    }
    await saveBookmarkIndex(index);

    // Adding one more should trip eviction of the least-recently-visited
    await upsertBookmark(makeEntry('bm_new', { lastVisited: Date.now() }));
    const after = await getBookmarkIndex();
    assert.equal(Object.keys(after).length, MAX_BOOKMARK_INDEX_SIZE + 1 - BOOKMARK_LRU_EVICT_COUNT);
    assert.ok(after.bm_new, 'new entry survives eviction');
    assert.ok(!after.bm_0, 'oldest entry is evicted');
  });

  test('deleteBookmark removes the entry and its summary', async () => {
    const summaryKey = await saveSummary({ id: 'bm_1', url: 'https://x', summary: 's', extractedText: '', aiModel: 'm', generatedAt: 1 });
    await upsertBookmark(makeEntry('bm_1', { summaryRef: summaryKey }));
    await deleteBookmark('bm_1');
    assert.equal((await getBookmarkIndex()).bm_1, undefined);
    assert.equal(await getSummary('bm_1'), null);
  });

  test('getBookmarkByChromeId finds by chrome node id', async () => {
    await upsertBookmark(makeEntry('bm_7'));
    const found = await getBookmarkByChromeId('c_bm_7');
    assert.equal(found.id, 'bm_7');
    assert.equal(await getBookmarkByChromeId('missing'), null);
  });
});

describe('pending queue', () => {
  test('enqueue → dequeue is FIFO', async () => {
    await enqueuePending({ bookmarkId: 'a', url: 'u1', title: 't1' });
    await enqueuePending({ bookmarkId: 'b', url: 'u2', title: 't2' });
    assert.equal((await dequeuePending()).bookmarkId, 'a');
    assert.equal((await dequeuePending()).bookmarkId, 'b');
    assert.equal(await dequeuePending(), null);
  });

  test('enqueue dedupes by bookmarkId', async () => {
    await enqueuePending({ bookmarkId: 'a', url: 'u', title: 't' });
    await enqueuePending({ bookmarkId: 'a', url: 'u', title: 't' });
    assert.equal((await getPendingQueue()).length, 1);
  });

  test('removePending drops the matching item', async () => {
    await enqueuePending({ bookmarkId: 'a', url: 'u', title: 't' });
    await enqueuePending({ bookmarkId: 'b', url: 'u', title: 't' });
    await removePending('a');
    const queue = await getPendingQueue();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].bookmarkId, 'b');
  });
});

describe('visit log', () => {
  test('records visits and caps per-URL history at 20', async () => {
    for (let i = 0; i < 25; i++) await recordVisit('https://example.com');
    const log = await getVisitLog();
    assert.equal(log['https://example.com'].length, 20);
  });
});

describe('just-moved loop prevention', () => {
  test('is true within the TTL and false after', async () => {
    await markJustMoved('42');
    assert.equal(await isJustMoved('42', 500), true);
    // With a zero TTL the mark is expired immediately
    assert.equal(await isJustMoved('42', 0), false);
  });

  test('unknown ids are not just-moved', async () => {
    assert.equal(await isJustMoved('nope', 500), false);
  });
});

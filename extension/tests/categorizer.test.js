import { resetChromeMock } from './setup/chrome-mock.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { saveSettings, getSettings, isJustMoved } from '../shared/storage-schema.js';
import { DEFAULT_SETTINGS } from '../shared/constants.js';

// categorizer.js keeps module-level folder caches, so import it fresh per run
const { applyCategorizationResult } = await import('../background/categorizer.js');

function makeEntry(overrides = {}) {
  return {
    id: 'bm_test',
    chromeBookmarkId: '55',
    url: 'https://example.com',
    title: 'Example',
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

beforeEach(async () => {
  resetChromeMock();
  await saveSettings({ ...DEFAULT_SETTINGS });
});

describe('applyCategorizationResult', () => {
  test('assigns an existing category (case-insensitive match)', async () => {
    const settings = await getSettings();
    const updated = await applyCategorizationResult({
      entry: makeEntry(),
      result: { category: 'technology', tags: ['js'], isNewCategory: false, categoryColor: null },
      chromeBookmarkId: '55',
      settings,
    });

    assert.equal(updated.categoryId, 'cat_tech');
    assert.deepEqual(updated.tags, ['js']);
  });

  test('creates a new category when AI proposes one', async () => {
    const settings = await getSettings();
    const updated = await applyCategorizationResult({
      entry: makeEntry(),
      result: { category: 'Cooking', tags: [], isNewCategory: true, categoryColor: '#AABBCC' },
      chromeBookmarkId: '55',
      settings,
    });

    assert.ok(updated.categoryId.startsWith('cat_'));
    const after = await getSettings();
    const created = after.categories.find((c) => c.name === 'Cooking');
    assert.ok(created, 'new category persisted to settings');
    assert.equal(created.color, '#AABBCC');
  });

  test('moves the chrome bookmark and marks it just-moved (loop prevention)', async () => {
    const settings = await getSettings();
    await applyCategorizationResult({
      entry: makeEntry(),
      result: { category: 'Technology', tags: [], isNewCategory: false, categoryColor: null },
      chromeBookmarkId: '55',
      settings,
    });

    assert.equal(chrome.bookmarks._moves.length, 1);
    assert.equal(chrome.bookmarks._moves[0].id, '55');
    assert.equal(await isJustMoved('55', 5000), true);
  });

  test('unknown category without isNewCategory falls back to the first category', async () => {
    const settings = await getSettings();
    const updated = await applyCategorizationResult({
      entry: makeEntry(),
      result: { category: 'Nonexistent', tags: [], isNewCategory: false, categoryColor: null },
      chromeBookmarkId: null,
      settings,
    });

    assert.equal(updated.categoryId, settings.categories[0].id);
  });

  test('respects the disable-auto-categories setting', async () => {
    const settings = { ...(await getSettings()), enableAutoCategories: false };
    const updated = await applyCategorizationResult({
      entry: makeEntry(),
      result: { category: 'Technology', tags: ['x'], isNewCategory: false, categoryColor: null },
      chromeBookmarkId: '55',
      settings,
    });

    assert.equal(updated.categoryId, null, 'no category assigned');
    assert.deepEqual(updated.tags, ['x'], 'tags still applied');
    assert.equal(chrome.bookmarks._moves.length, 0, 'bookmark not moved');
  });
});

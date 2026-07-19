// END-TO-END core product flow, exercised against the real modules:
//   1. save an OpenRouter key (encrypted, as the options page does)
//   2. user bookmarks a page  → handleBookmarkCreated
//   3. AI enriches it         → processQueue → openrouter-client (mocked fetch)
//   4. bookmark is categorized, summarized, tagged, filed, and ranked
// This is the flow the user actually cares about; if it passes, the product works.

import { resetChromeMock } from './setup/chrome-mock.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { saveSettings, getSettings, getBookmarkIndex, getSummary, getBookmarkByChromeId } from '../shared/storage-schema.js';
import { encryptApiKey } from '../shared/utils.js';
import { handleBookmarkCreated, processQueue } from '../background/bookmark-handler.js';

const originalFetch = globalThis.fetch;

// handleBookmarkCreated kicks off processQueue asynchronously; wait for the
// entry to reach a terminal AI status (enriched/failed) before asserting.
async function waitForStatus(chromeBookmarkId, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await processQueue().catch(() => {});
    const entry = await getBookmarkByChromeId(chromeBookmarkId);
    if (entry && entry.aiStatus !== 'pending') return entry;
    await new Promise((r) => setTimeout(r, 20));
  }
  return getBookmarkByChromeId(chromeBookmarkId);
}

function aiResponse(obj) {
  return {
    ok: true, status: 200,
    json: async () => ({ model: 'meta-llama/llama-3.3-70b-instruct:free', choices: [{ message: { content: JSON.stringify(obj) } }] }),
  };
}

async function configureKey() {
  await saveSettings({
    provider: 'openrouter',
    openrouterApiKey: await encryptApiKey('sk-or-v1-e2e'),
    selectedModel: 'meta-llama/llama-3.3-70b-instruct:free',
    enableAutoCategories: true,
    enableAiSummaries: true,
    rankingEnabled: true,
  });
}

beforeEach(() => resetChromeMock());

describe('end-to-end: bookmark a page and let AI organize it', () => {
  test('a newly created bookmark gets enriched, categorized, summarized, and filed', async () => {
    await configureKey();
    globalThis.fetch = async () => aiResponse({
      summary: 'A deep dive into JavaScript testing.',
      category: 'Programming',
      tags: ['javascript', 'testing', 'node'],
      isNewCategory: true,
      categoryColor: '#3178c6',
    });

    // User clicks the star → Chrome fires onCreated → our handler runs
    await handleBookmarkCreated('501', { title: 'JS Testing Guide', url: 'https://example.com/js-testing' });
    const entry = await waitForStatus('501');
    assert.ok(entry, 'bookmark is indexed');
    assert.equal(entry.aiStatus, 'enriched', 'AI finished');
    assert.deepEqual(entry.tags, ['javascript', 'testing', 'node']);
    assert.ok(entry.categoryId, 'assigned a category');
    assert.ok(entry.rankScore >= 0, 'ranked');

    // A new category "Programming" was created in settings
    const settings = await getSettings();
    assert.ok(settings.categories.some((c) => c.name === 'Programming'), 'new category persisted');

    // Summary stored and retrievable
    const summary = await getSummary(entry.id);
    assert.ok(summary && summary.summary.includes('JavaScript'), 'summary saved');

    globalThis.fetch = originalFetch;
  });

  test('a dead selected model self-heals mid-flow and the bookmark still enriches', async () => {
    await saveSettings({
      provider: 'openrouter',
      openrouterApiKey: await encryptApiKey('sk-or-v1-e2e'),
      selectedModel: 'deepseek/deepseek-r1-0528:free', // pretend dead
      enableAutoCategories: true, enableAiSummaries: true, rankingEnabled: true,
    });
    globalThis.fetch = async (url, init) => {
      const model = JSON.parse(init.body).model;
      if (model === 'deepseek/deepseek-r1-0528:free') {
        return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: { message: 'No endpoints found' } }) };
      }
      return aiResponse({ summary: 's', category: 'News', tags: ['x'], isNewCategory: false, categoryColor: null });
    };

    await handleBookmarkCreated('502', { title: 'Some news', url: 'https://example.com/news' });
    const entry = await waitForStatus('502');
    assert.equal(entry.aiStatus, 'enriched', 'enriched via a fallback model despite the dead one');

    globalThis.fetch = originalFetch;
  });

  test('without an API key the bookmark is still indexed (as pending), not lost', async () => {
    await saveSettings({ provider: 'openrouter', openrouterApiKey: null });
    await handleBookmarkCreated('503', { title: 'No key', url: 'https://example.com/nokey' });
    await processQueue();
    await new Promise((r) => setTimeout(r, 50));
    const entry = await getBookmarkByChromeId('503');
    assert.ok(entry, 'bookmark saved even without a key');
    assert.equal(entry.aiStatus, 'pending', 'left pending for later enrichment');
  });
});

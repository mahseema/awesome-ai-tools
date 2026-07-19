import { resetChromeMock } from './setup/chrome-mock.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { computeRankScore, recalculateAllRanks, sortByRank } from '../background/ranker.js';
import { saveBookmarkIndex, getBookmarkIndex, recordVisit } from '../shared/storage-schema.js';

function makeEntry(id, overrides = {}) {
  return {
    id,
    chromeBookmarkId: `c_${id}`,
    url: `https://example.com/${id}`,
    title: `Page ${id}`,
    categoryId: null,
    tags: [],
    visitCount: 0,
    lastVisited: 0,
    rankScore: 0,
    createdAt: Date.now(),
    aiStatus: 'enriched',
    summaryRef: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetChromeMock();
});

describe('computeRankScore', () => {
  test('never-visited bookmark scores low', async () => {
    const score = await computeRankScore(makeEntry('a'));
    // Only the neutral AI-relevance component (50 * 0.2 = 10) contributes
    assert.ok(score <= 15, `expected low score, got ${score}`);
  });

  test('more visits → higher score', async () => {
    const low = await computeRankScore(makeEntry('a', { visitCount: 1, lastVisited: Date.now() }));
    const high = await computeRankScore(makeEntry('b', { visitCount: 50, lastVisited: Date.now() }));
    assert.ok(high > low, `expected ${high} > ${low}`);
  });

  test('recent visit → higher score than old visit', async () => {
    const now = Date.now();
    const fresh = await computeRankScore(makeEntry('a', { visitCount: 5, lastVisited: now }));
    const stale = await computeRankScore(makeEntry('b', { visitCount: 5, lastVisited: now - 60 * 86_400_000 }));
    assert.ok(fresh > stale, `expected ${fresh} > ${stale}`);
  });

  test('score is clamped to [0, 100]', async () => {
    const score = await computeRankScore(
      makeEntry('a', { visitCount: 1_000_000, lastVisited: Date.now(), shareCount: 1_000_000 })
    );
    assert.ok(score >= 0 && score <= 100);
  });
});

describe('recalculateAllRanks', () => {
  test('updates stored rank scores', async () => {
    await saveBookmarkIndex({
      bm_hot: makeEntry('bm_hot', { visitCount: 40, lastVisited: Date.now() }),
      bm_cold: makeEntry('bm_cold', { visitCount: 0, lastVisited: 0 }),
    });
    await recordVisit('https://example.com/bm_hot');

    await recalculateAllRanks();

    const index = await getBookmarkIndex();
    assert.ok(index.bm_hot.rankScore > index.bm_cold.rankScore);
  });

  test('is a no-op on an empty index', async () => {
    await recalculateAllRanks();
    assert.deepEqual(await getBookmarkIndex(), {});
  });
});

describe('sortByRank', () => {
  test('sorts descending and does not mutate input', () => {
    const entries = [
      makeEntry('a', { rankScore: 10 }),
      makeEntry('b', { rankScore: 90 }),
      makeEntry('c', { rankScore: 50 }),
    ];
    const sorted = sortByRank(entries);
    assert.deepEqual(sorted.map((e) => e.id), ['b', 'c', 'a']);
    assert.equal(entries[0].id, 'a', 'input array not mutated');
  });
});

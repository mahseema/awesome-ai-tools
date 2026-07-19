// Smart ranking engine using a weighted decay formula.

import { RANK_WEIGHTS, RECENCY_LAMBDA } from '../shared/constants.js';
import { getBookmarkIndex, saveBookmarkIndex, getVisitLog, getSettings } from '../shared/storage-schema.js';
import { daysSince } from '../shared/utils.js';

/**
 * Computes a rank score for a single bookmark entry.
 *
 * Formula:
 *   rankScore = visitCount×0.4 + recencyScore×0.3 + aiRelevanceScore×0.2 + shareCount×0.1
 *
 * @param {import('../shared/storage-schema.js').BookmarkIndexEntry} entry
 * @param {number[]} [recentTagFreq] - optional frequency map for AI relevance
 * @returns {Promise<number>} score in range [0, 100]
 */
export async function computeRankScore(entry, recentTagFreq = null) {
  const settings = await getSettings();
  const weights = settings.rankWeights || RANK_WEIGHTS;

  const visitScore = computeVisitScore(entry.visitCount || 0);
  const recencyScore = computeRecencyScore(entry.lastVisited);
  const relevanceScore = recentTagFreq ? computeRelevanceScore(entry.tags, recentTagFreq) : 50;
  const shareScore = computeShareScore(entry.shareCount || 0);

  const score =
    visitScore * weights.VISIT_COUNT +
    recencyScore * weights.RECENCY +
    relevanceScore * weights.AI_RELEVANCE +
    shareScore * weights.SHARE_COUNT;

  return Math.min(100, Math.max(0, Math.round(score * 10) / 10));
}

/**
 * Recalculates rank scores for all bookmarks in the index.
 * Called by daily alarm and on demand.
 */
export async function recalculateAllRanks() {
  const index = await getBookmarkIndex();
  const entries = Object.values(index);
  if (entries.length === 0) return;

  // Build tag frequency from visit log for AI relevance
  const recentTagFreq = await buildRecentTagFrequency(entries);

  let changed = false;
  for (const entry of entries) {
    const newScore = await computeRankScore(entry, recentTagFreq);
    if (Math.abs(newScore - (entry.rankScore || 0)) > 0.5) {
      entry.rankScore = newScore;
      changed = true;
    }
  }

  if (changed) {
    const updated = {};
    for (const entry of entries) updated[entry.id] = entry;
    await saveBookmarkIndex(updated);
  }
}

// ─── Score Components ─────────────────────────────────────────────────────────

function computeVisitScore(visitCount) {
  // Logarithmic scale: 0 visits → 0, 1 → 30, 10 → 70, 100 → 100
  if (visitCount <= 0) return 0;
  return Math.min(100, (Math.log10(visitCount + 1) / Math.log10(101)) * 100);
}

function computeRecencyScore(lastVisited) {
  if (!lastVisited) return 0;
  const days = daysSince(lastVisited);
  // Exponential decay: score = 100 * e^(-lambda * days)
  return 100 * Math.exp(-RECENCY_LAMBDA * days);
}

function computeRelevanceScore(tags, tagFrequency) {
  if (!tags || tags.length === 0 || !tagFrequency) return 50;
  const scores = tags.map((tag) => tagFrequency[tag.toLowerCase()] || 0);
  const maxFreq = Math.max(...Object.values(tagFrequency), 1);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.min(100, (avg / maxFreq) * 100);
}

function computeShareScore(shareCount) {
  if (shareCount <= 0) return 0;
  return Math.min(100, (Math.log10(shareCount + 1) / Math.log10(101)) * 100);
}

// ─── Recent Tag Frequency ─────────────────────────────────────────────────────

async function buildRecentTagFrequency(entries) {
  const visitLog = await getVisitLog();
  const recentUrls = new Set();
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (const [url, timestamps] of Object.entries(visitLog)) {
    if (timestamps.some((t) => t > oneWeekAgo)) {
      recentUrls.add(url);
    }
  }

  const freq = {};
  for (const entry of entries) {
    if (recentUrls.has(entry.url)) {
      for (const tag of entry.tags || []) {
        const key = tag.toLowerCase();
        freq[key] = (freq[key] || 0) + 1;
      }
    }
  }

  return freq;
}

/**
 * Sorts bookmark entries by rank score descending.
 * @param {import('../shared/storage-schema.js').BookmarkIndexEntry[]} entries
 */
export function sortByRank(entries) {
  return [...entries].sort((a, b) => (b.rankScore || 0) - (a.rankScore || 0));
}

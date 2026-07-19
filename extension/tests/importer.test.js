import { resetChromeMock } from './setup/chrome-mock.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startImport, getImportState } from '../background/importer.js';
import { getBookmarkIndex, getPendingQueue, upsertBookmark } from '../shared/storage-schema.js';

function treeWith(barChildren) {
  return [
    {
      id: '0',
      children: [
        { id: '1', title: 'Bookmarks bar', children: barChildren },
        { id: '2', title: 'Other bookmarks', children: [] },
      ],
    },
  ];
}

beforeEach(() => {
  const mock = resetChromeMock();
  mock.bookmarks._tree = treeWith([
    { id: '10', title: 'Example', url: 'https://example.com/a', dateAdded: 1700000000000 },
    { id: '11', title: 'Docs', url: 'https://docs.example.com', dateAdded: 1700000001000 },
    {
      id: '12',
      title: 'Nested folder',
      children: [{ id: '13', title: 'Deep', url: 'https://deep.example.com', dateAdded: 1700000002000 }],
    },
  ]);
});

describe('startImport (scan Chrome tree)', () => {
  test('indexes every bookmark in the tree, including nested folders, and queues them', async () => {
    const result = await startImport({ source: 'all', processWithAI: true });
    assert.equal(result.total, 3);
    assert.equal(result.queued, 3);
    assert.equal(result.running, false);

    const index = await getBookmarkIndex();
    const urls = Object.values(index).map((e) => e.url).sort();
    assert.deepEqual(urls, ['https://deep.example.com', 'https://docs.example.com', 'https://example.com/a']);
    // result.queued (asserted above) is the deterministic signal that all 3
    // were enqueued; the queue itself is drained asynchronously by processQueue
    // right after import, so we don't assert on its length here.
  });

  test('is idempotent — a second run queues nothing new', async () => {
    await startImport({});
    const second = await startImport({});
    assert.equal(second.queued, 0);

    const index = await getBookmarkIndex();
    assert.equal(Object.keys(index).length, 3, 'no duplicates created');
  });

  test('skips URLs already saved via normal bookmarking', async () => {
    await upsertBookmark({
      id: 'bm_existing',
      chromeBookmarkId: '99',
      url: 'https://example.com/a',
      title: 'Already here',
      categoryId: null, tags: [], visitCount: 0, lastVisited: 0,
      rankScore: 0, createdAt: 0, aiStatus: 'enriched', summaryRef: null,
    });

    const result = await startImport({});
    assert.equal(result.total, 2, 'known URL excluded from the import set');
    assert.equal(result.queued, 2);
  });

  test('processWithAI=false indexes without enqueuing', async () => {
    const result = await startImport({ processWithAI: false });
    assert.equal(result.queued, 0);
    const queue = await getPendingQueue();
    assert.equal(queue.length, 0);
    const index = await getBookmarkIndex();
    for (const entry of Object.values(index)) assert.equal(entry.aiStatus, 'enriched');
  });

  test('entries keep their Chrome bookmark node id', async () => {
    await startImport({});
    const index = await getBookmarkIndex();
    const chromeIds = Object.values(index).map((e) => e.chromeBookmarkId).sort();
    assert.deepEqual(chromeIds, ['10', '11', '13']);
  });

  test('getImportState reflects the finished run', async () => {
    await startImport({});
    const state = getImportState();
    assert.equal(state.running, false);
    assert.equal(state.total, 3);
    assert.equal(state.queued, 3);
  });
});

describe('startImport (HTML upload)', () => {
  test('parses a Netscape bookmarks HTML export', async () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
      <DL><p>
        <DT><A HREF="https://a.example.com" ADD_DATE="1700000000">Site A</A>
        <DT><A HREF="https://b.example.com" ADD_DATE="1700000001">Site B</A>
        <DT><A HREF="ftp://skip.example.com" ADD_DATE="1700000002">Skip FTP</A>
      </DL><p>`;

    const result = await startImport({ htmlContent: html });
    assert.equal(result.total, 2, 'only http(s) links imported from HTML');

    const index = await getBookmarkIndex();
    const urls = Object.values(index).map((e) => e.url).sort();
    assert.deepEqual(urls, ['https://a.example.com', 'https://b.example.com']);
  });
});

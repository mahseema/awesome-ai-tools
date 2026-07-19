// RUNTIME test of the options page controller: imports the real options.js,
// fires DOMContentLoaded, fills the form, clicks SAVE, and asserts the settings
// actually persist with an encrypted key. This executes the real save path —
// the class of bug where a handler references an undefined function
// (e.g. "encryptIfChanged is not defined") fails HERE, not in the user's face.

import { resetChromeMock } from './setup/chrome-mock.js';
import { installDomMock } from './setup/dom-mock.js';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

const chromeMock = resetChromeMock();
const doc = installDomMock();

// Page controllers use callback-style sendMessage; answer benignly per action.
chromeMock.runtime._messageHandler = (message) => {
  switch (message?.action) {
    case 'GOOGLE_SHEETS_STATUS': return { connected: false, sheetUrl: null };
    case 'GET_IMPORT_STATE': return { running: false, total: 0, scanned: 0, enriched: 0, failed: 0, queued: 0 };
    default: return {};
  }
};

// Block the live model fetch so the test is deterministic/offline.
globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });

const { getSettings } = await import('../shared/storage-schema.js');
const { decryptApiKey } = await import('../shared/utils.js');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

describe('options page — real save flow', () => {
  before(async () => {
    await import('../options/options.js'); // module-level code runs against the DOM stub
    await doc.dispatch('DOMContentLoaded'); // runs init()
    await sleep(30); // let async init settle
  });

  test('init populated the form without throwing', () => {
    // Weight sliders were populated from defaults by init()
    assert.equal(doc.getElementById('weight-visits').value, 40);
    assert.equal(doc.getElementById('weight-recency').value, 30);
  });

  test('clicking SAVE persists provider, model, and an ENCRYPTED OpenRouter key', async () => {
    doc.getElementById('provider-select').value = 'openrouter';
    doc.getElementById('openrouter-api-key').value = 'sk-or-v1-runtime-save-test';
    doc.getElementById('model-select').value = 'meta-llama/llama-3.3-70b-instruct:free';
    doc.getElementById('enable-categories').checked = true;
    doc.getElementById('enable-summaries').checked = true;
    doc.getElementById('enable-ranking').checked = true;

    await doc.getElementById('btn-save').dispatch('click');
    await sleep(30);

    const saveStatus = doc.getElementById('save-status').textContent;
    assert.ok(!saveStatus.includes('Error'), `save must not error, got: "${saveStatus}"`);

    const s = await getSettings();
    assert.equal(s.provider, 'openrouter');
    assert.equal(s.selectedModel, 'meta-llama/llama-3.3-70b-instruct:free');
    assert.ok(s.openrouterApiKey, 'key stored');
    assert.notEqual(s.openrouterApiKey, 'sk-or-v1-runtime-save-test', 'key is NOT stored in plaintext');
    assert.equal(await decryptApiKey(s.openrouterApiKey), 'sk-or-v1-runtime-save-test', 'key decrypts back');
  });

  test('saving again without changing the key keeps the same encrypted blob (no re-encrypt)', async () => {
    const before1 = (await getSettings()).openrouterApiKey;
    await doc.getElementById('btn-save').dispatch('click');
    await sleep(30);
    const after = (await getSettings()).openrouterApiKey;
    assert.equal(after, before1);
  });

  test('background enrichment can decrypt and use the key saved by the page', async () => {
    // The full loop: options saved the key → openrouter-client reads settings,
    // decrypts, and sends the right Bearer header.
    let capturedAuth = null;
    globalThis.fetch = async (url, init) => {
      capturedAuth = init.headers.Authorization;
      return {
        ok: true, status: 200,
        json: async () => ({ model: 'meta-llama/llama-3.3-70b-instruct:free', choices: [{ message: { content: '{"summary":"s","category":"Technology","tags":[],"isNewCategory":false}' } }] }),
      };
    };
    const { enrichBookmark } = await import('../background/openrouter-client.js');
    const result = await enrichBookmark({ url: 'https://example.com', title: 'X', extractedText: 't', description: '', categories: [] });
    assert.equal(capturedAuth, 'Bearer sk-or-v1-runtime-save-test');
    assert.equal(result.category, 'Technology');
  });
});

import { resetChromeMock } from './setup/chrome-mock.js';
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { enrichBookmark } from '../background/openrouter-client.js';
import { saveSettings } from '../shared/storage-schema.js';
import { encryptApiKey } from '../shared/utils.js';
import { ERROR_CODES } from '../shared/error-handler.js';

// openrouter-client.js is the OpenRouter (default) provider. It reads
// settings.openrouterApiKey and uses the OpenAI-compatible schema
// (choices[0].message.content) with Bearer auth.

const originalFetch = globalThis.fetch;

function openRouterResponse(text, model = 'google/gemini-2.0-flash-exp:free') {
  return {
    ok: true,
    status: 200,
    json: async () => ({ model, choices: [{ message: { role: 'assistant', content: text } }] }),
  };
}

async function setupKey(model = 'meta-llama/llama-3.3-70b-instruct:free') {
  const encrypted = await encryptApiKey('sk-or-test-key');
  await saveSettings({ provider: 'openrouter', openrouterApiKey: encrypted, selectedModel: model });
}

const PARAMS = {
  url: 'https://example.com',
  title: 'Example',
  extractedText: 'Some page content about JavaScript testing.',
  description: '',
  categories: [{ id: 'cat_tech', name: 'Technology', color: '#6366f1', icon: 'code' }],
};

const GOOD_JSON = '{"summary":"A page about JS testing.","category":"Technology","tags":["javascript","testing"],"isNewCategory":false,"categoryColor":null}';

beforeEach(async () => {
  resetChromeMock();
  await setupKey();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('openrouter-client (OpenRouter provider)', () => {
  test('parses a clean JSON response from the OpenAI-style schema', async () => {
    globalThis.fetch = async () => openRouterResponse(GOOD_JSON);

    const result = await enrichBookmark(PARAMS);
    assert.equal(result.summary, 'A page about JS testing.');
    assert.equal(result.category, 'Technology');
    assert.deepEqual(result.tags, ['javascript', 'testing']);
  });

  test('sends Bearer auth, the selected model, and the prompt', async () => {
    let captured;
    globalThis.fetch = async (url, init) => {
      captured = { url, init };
      return openRouterResponse(GOOD_JSON);
    };

    await enrichBookmark(PARAMS);
    assert.ok(captured.url.startsWith('https://openrouter.ai/'));
    assert.equal(captured.init.headers.Authorization, 'Bearer sk-or-test-key');
    const body = JSON.parse(captured.init.body);
    assert.equal(body.model, 'meta-llama/llama-3.3-70b-instruct:free');
    assert.equal(body.messages[0].role, 'system');
    assert.ok(body.messages[1].content.includes('https://example.com'));
  });

  test('passes a custom model id through as-is (not in the static list)', async () => {
    await setupKey('tencent/hunyuan-a13b-instruct:free');
    let captured;
    globalThis.fetch = async (url, init) => {
      captured = init;
      return openRouterResponse(GOOD_JSON);
    };
    await enrichBookmark(PARAMS);
    assert.equal(JSON.parse(captured.body).model, 'tencent/hunyuan-a13b-instruct:free');
  });

  test('falls back to the default model only when none is set', async () => {
    const { encryptApiKey } = await import('../shared/utils.js');
    const { saveSettings } = await import('../shared/storage-schema.js');
    await saveSettings({ provider: 'openrouter', openrouterApiKey: await encryptApiKey('sk-or-test-key'), selectedModel: '' });
    let captured;
    globalThis.fetch = async (url, init) => {
      captured = init;
      return openRouterResponse(GOOD_JSON);
    };
    await enrichBookmark(PARAMS);
    assert.equal(JSON.parse(captured.body).model, 'meta-llama/llama-3.3-70b-instruct:free');
  });

  test('401 auth error is NOT retried', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return { ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({ error: { message: 'bad key' } }) };
    };

    await assert.rejects(() => enrichBookmark(PARAMS), (err) => err.code === ERROR_CODES.API_AUTH);
    assert.equal(calls, 1);
  });

  test('500 server error is retried then succeeds', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 500, statusText: 'ISE', json: async () => ({}) };
      return openRouterResponse('{"summary":"recovered","category":"C","tags":[],"isNewCategory":false}');
    };

    const result = await enrichBookmark(PARAMS);
    assert.equal(result.summary, 'recovered');
    assert.equal(calls, 2);
  });

  test('throws API_NO_KEY when no OpenRouter key is configured', async () => {
    resetChromeMock();
    await assert.rejects(() => enrichBookmark(PARAMS), (err) => err.code === ERROR_CODES.API_NO_KEY);
  });

  test('self-heals: a 404 on the selected model auto-switches to a working free model and persists it', async () => {
    await setupKey('deepseek/deepseek-r1-0528:free'); // pretend this one is dead
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      const model = JSON.parse(init.body).model;
      if (model === 'deepseek/deepseek-r1-0528:free') {
        return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: { message: 'No endpoints found' } }) };
      }
      return openRouterResponse(GOOD_JSON, model); // any other model works
    };

    const result = await enrichBookmark(PARAMS);
    assert.equal(result.category, 'Technology', 'enrichment succeeded via a fallback model');
    assert.ok(calls >= 2, 'tried the dead model then a fallback');

    // The working model was persisted so future calls skip the dead one
    const { getSettings } = await import('../shared/storage-schema.js');
    const s = await getSettings();
    assert.notEqual(s.selectedModel, 'deepseek/deepseek-r1-0528:free');
  });

  test('a non-404 error (401) is NOT masked by model fallback', async () => {
    await setupKey();
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return { ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({ error: { message: 'bad key' } }) };
    };
    await assert.rejects(() => enrichBookmark(PARAMS), (err) => err.code === ERROR_CODES.API_AUTH);
    assert.equal(calls, 1, 'auth error stops immediately, no model cycling');
  });
});

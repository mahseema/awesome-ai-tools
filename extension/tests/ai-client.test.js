import { resetChromeMock } from './setup/chrome-mock.js';
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { enrichBookmark } from '../background/ai-client.js';
import { saveSettings } from '../shared/storage-schema.js';
import { encryptApiKey } from '../shared/utils.js';
import { ERROR_CODES } from '../shared/error-handler.js';

// ai-client.js is the Anthropic (Claude) provider. It reads settings.claudeApiKey
// and uses the Messages API schema (content[0].text).

const originalFetch = globalThis.fetch;

function anthropicResponse(text) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text }],
    }),
  };
}

async function setupClaudeKey(model = 'claude-sonnet-4-6') {
  const encrypted = await encryptApiKey('sk-ant-test-key');
  await saveSettings({ provider: 'anthropic', claudeApiKey: encrypted, selectedModel: model });
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
  await setupClaudeKey();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('ai-client (Anthropic provider)', () => {
  test('parses a clean JSON response', async () => {
    globalThis.fetch = async () => anthropicResponse(GOOD_JSON);

    const result = await enrichBookmark(PARAMS);
    assert.equal(result.summary, 'A page about JS testing.');
    assert.equal(result.category, 'Technology');
    assert.deepEqual(result.tags, ['javascript', 'testing']);
  });

  test('uses the Anthropic endpoint, X-API-Key header, and system field', async () => {
    let captured;
    globalThis.fetch = async (url, init) => {
      captured = { url, init };
      return anthropicResponse(GOOD_JSON);
    };

    await enrichBookmark(PARAMS);
    assert.ok(captured.url.startsWith('https://api.anthropic.com/'));
    assert.equal(captured.init.headers['X-API-Key'], 'sk-ant-test-key');
    const body = JSON.parse(captured.init.body);
    assert.equal(body.model, 'claude-sonnet-4-6');
    assert.ok(body.system, 'system prompt sent as a top-level field');
    assert.ok(body.messages[0].content.includes('https://example.com'));
    assert.ok(body.messages[0].content.includes('Technology'), 'existing categories included in prompt');
  });

  test('falls back to the default Claude model when selectedModel is an OpenRouter id', async () => {
    await setupClaudeKey('google/gemini-2.0-flash-exp:free'); // not a claude id
    let captured;
    globalThis.fetch = async (url, init) => {
      captured = init;
      return anthropicResponse(GOOD_JSON);
    };
    await enrichBookmark(PARAMS);
    assert.equal(JSON.parse(captured.body).model, 'claude-sonnet-4-6');
  });

  test('strips markdown code fences around the JSON', async () => {
    globalThis.fetch = async () =>
      anthropicResponse('```json\n{"summary":"s","category":"C","tags":[],"isNewCategory":true,"categoryColor":"#123456"}\n```');

    const result = await enrichBookmark(PARAMS);
    assert.equal(result.category, 'C');
    assert.equal(result.isNewCategory, true);
  });

  test('extracts a JSON object embedded in surrounding prose', async () => {
    globalThis.fetch = async () =>
      anthropicResponse('Here is the analysis: {"summary":"s","category":"News","tags":["x"],"isNewCategory":false} hope that helps');

    const result = await enrichBookmark(PARAMS);
    assert.equal(result.category, 'News');
  });

  test('401 auth error is NOT retried', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return { ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({ error: { message: 'bad key' } }) };
    };

    await assert.rejects(() => enrichBookmark(PARAMS), (err) => err.code === ERROR_CODES.API_AUTH);
    assert.equal(calls, 1, 'auth errors must not be retried');
  });

  test('500 server error is retried then succeeds', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 500, statusText: 'ISE', json: async () => ({}) };
      return anthropicResponse('{"summary":"recovered","category":"C","tags":[],"isNewCategory":false}');
    };

    const result = await enrichBookmark(PARAMS);
    assert.equal(result.summary, 'recovered');
    assert.equal(calls, 2);
  });

  test('throws API_NO_KEY when no Claude key is configured', async () => {
    resetChromeMock(); // wipes stored settings
    await assert.rejects(() => enrichBookmark(PARAMS), (err) => err.code === ERROR_CODES.API_NO_KEY);
  });

  test('defaults missing fields in a sparse response', async () => {
    globalThis.fetch = async () => anthropicResponse('{"summary":"only summary"}');
    const result = await enrichBookmark(PARAMS);
    assert.equal(result.category, 'Uncategorized');
    assert.deepEqual(result.tags, []);
    assert.equal(result.isNewCategory, false);
  });
});

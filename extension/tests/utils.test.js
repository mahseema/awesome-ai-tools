import './setup/chrome-mock.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateId,
  normalizeUrl,
  getDomain,
  getFaviconUrl,
  truncate,
  sanitizeText,
  escapeHtml,
  highlightMatches,
  timeAgo,
  daysSince,
  encryptApiKey,
  decryptApiKey,
  isValidApiKey,
  debounce,
  sleep,
} from '../shared/utils.js';

describe('generateId', () => {
  test('uses the given prefix', () => {
    assert.match(generateId('bm'), /^bm_[a-z0-9]+$/);
    assert.match(generateId('cat'), /^cat_[a-z0-9]+$/);
  });

  test('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()));
    assert.equal(ids.size, 1000);
  });
});

describe('normalizeUrl', () => {
  test('strips tracking params', () => {
    assert.equal(
      normalizeUrl('https://example.com/page?utm_source=x&utm_medium=y&id=5'),
      'https://example.com/page?id=5'
    );
  });

  test('strips fragments and trailing slash', () => {
    assert.equal(normalizeUrl('https://example.com/page/#section'), 'https://example.com/page');
  });

  test('strips fbclid and gclid', () => {
    assert.equal(normalizeUrl('https://example.com/?fbclid=abc&gclid=def'), 'https://example.com');
  });

  test('returns input unchanged for invalid URLs', () => {
    assert.equal(normalizeUrl('not-a-url'), 'not-a-url');
  });
});

describe('getDomain', () => {
  test('extracts hostname without www', () => {
    assert.equal(getDomain('https://www.example.com/path'), 'example.com');
    assert.equal(getDomain('https://sub.example.co.il/x'), 'sub.example.co.il');
  });

  test('returns input for invalid URLs', () => {
    assert.equal(getDomain('garbage'), 'garbage');
  });
});

describe('getFaviconUrl', () => {
  test('builds favicon URL from origin', () => {
    assert.equal(getFaviconUrl('https://example.com/deep/path'), 'https://example.com/favicon.ico');
  });

  test('returns null for invalid URLs', () => {
    assert.equal(getFaviconUrl('garbage'), null);
  });
});

describe('truncate', () => {
  test('leaves short text untouched', () => {
    assert.equal(truncate('hello', 10), 'hello');
  });

  test('truncates long text with ellipsis at maxLength', () => {
    const out = truncate('a'.repeat(100), 10);
    assert.equal(out.length, 10);
    assert.ok(out.endsWith('...'));
  });

  test('handles null/undefined', () => {
    assert.equal(truncate(null, 10), null);
    assert.equal(truncate(undefined, 10), undefined);
  });
});

describe('sanitizeText', () => {
  test('collapses whitespace and trims', () => {
    assert.equal(sanitizeText('  hello \n\t world  '), 'hello world');
  });

  test('removes null bytes', () => {
    assert.equal(sanitizeText('a\0b'), 'ab');
  });

  test('handles empty input', () => {
    assert.equal(sanitizeText(''), '');
    assert.equal(sanitizeText(null), '');
  });
});

describe('escapeHtml', () => {
  test('escapes all dangerous characters', () => {
    assert.equal(
      escapeHtml(`<script>alert("x&y'z")</script>`),
      '&lt;script&gt;alert(&quot;x&amp;y&#39;z&quot;)&lt;/script&gt;'
    );
  });

  test('handles Hebrew and Chinese text without mangling', () => {
    assert.equal(escapeHtml('שלום עולם'), 'שלום עולם');
    assert.equal(escapeHtml('你好世界'), '你好世界');
  });
});

describe('highlightMatches', () => {
  test('wraps matches in <mark>', () => {
    assert.equal(highlightMatches('Hello World', 'world'), 'Hello <mark>World</mark>');
  });

  test('escapes HTML in the source text', () => {
    const out = highlightMatches('<b>bold</b> text', 'text');
    assert.ok(out.includes('&lt;b&gt;'));
    assert.ok(out.includes('<mark>text</mark>'));
  });

  test('escapes regex special characters in the query', () => {
    assert.equal(highlightMatches('price (usd)', '(usd)'), 'price <mark>(usd)</mark>');
  });

  test('returns escaped text when query is empty', () => {
    assert.equal(highlightMatches('<x>', ''), '&lt;x&gt;');
  });
});

describe('timeAgo', () => {
  test('recent timestamps say "just now"', () => {
    assert.equal(timeAgo(Date.now() - 10_000), 'just now');
  });

  test('minutes, hours, days', () => {
    assert.equal(timeAgo(Date.now() - 5 * 60_000), '5m ago');
    assert.equal(timeAgo(Date.now() - 3 * 3_600_000), '3h ago');
    assert.equal(timeAgo(Date.now() - 2 * 86_400_000), '2d ago');
  });
});

describe('daysSince', () => {
  test('computes fractional days', () => {
    const twelveHoursAgo = Date.now() - 12 * 3_600_000;
    const d = daysSince(twelveHoursAgo);
    assert.ok(d > 0.49 && d < 0.51, `expected ~0.5, got ${d}`);
  });
});

describe('API key encryption', () => {
  test('encrypt → decrypt roundtrip returns original key', async () => {
    const key = 'sk-ant-api03-test-key-12345';
    const encrypted = await encryptApiKey(key);
    assert.notEqual(encrypted, key);
    assert.ok(JSON.parse(encrypted).iv, 'encrypted blob carries an IV');
    const decrypted = await decryptApiKey(encrypted);
    assert.equal(decrypted, key);
  });

  test('two encryptions of the same key produce different ciphertexts (random IV)', async () => {
    const key = 'sk-ant-same-key';
    const a = await encryptApiKey(key);
    const b = await encryptApiKey(key);
    assert.notEqual(a, b);
    assert.equal(await decryptApiKey(a), key);
    assert.equal(await decryptApiKey(b), key);
  });

  test('decrypting garbage returns null instead of throwing', async () => {
    assert.equal(await decryptApiKey('not-json'), null);
    assert.equal(await decryptApiKey('{"iv":[1,2],"ct":[3,4]}'), null);
    assert.equal(await decryptApiKey(''), null);
  });
});

describe('isValidApiKey', () => {
  test('defaults to OpenRouter: accepts sk-or- keys', () => {
    assert.ok(isValidApiKey('sk-or-v1-abcdef123456'));
    assert.ok(!isValidApiKey('sk-ant-api03-abc'));
  });

  test('anthropic provider accepts sk-ant- keys only', () => {
    assert.ok(isValidApiKey('sk-ant-api03-abcdef', 'anthropic'));
    assert.ok(!isValidApiKey('sk-or-v1-abcdef', 'anthropic'));
  });

  test('rejects garbage for any provider', () => {
    assert.ok(!isValidApiKey(''));
    assert.ok(!isValidApiKey(null));
    assert.ok(!isValidApiKey(123));
    assert.ok(!isValidApiKey('sk-or-1', 'openrouter'), 'too short');
  });
});

describe('debounce', () => {
  test('only fires once after rapid calls', async () => {
    let calls = 0;
    const fn = debounce(() => calls++, 20);
    fn(); fn(); fn();
    assert.equal(calls, 0);
    await sleep(50);
    assert.equal(calls, 1);
  });
});

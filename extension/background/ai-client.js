// Anthropic (Claude) API client — the "anthropic" provider.
// Mirrors the interface of openrouter-client.js so provider-manager can route
// to either: enrichBookmark(params) and testApiKey(apiKey).
// Reads settings.claudeApiKey; OpenRouter is handled by openrouter-client.js.

import {
  ANTHROPIC_API_URL,
  ANTHROPIC_API_VERSION,
  CLAUDE_MODEL,
  AI_MAX_RETRIES,
  AI_RETRY_DELAYS_MS,
  MAX_EXTRACTED_TEXT_LENGTH,
} from '../shared/constants.js';
import { getSettings } from '../shared/storage-schema.js';
import { decryptApiKey, sleep, truncate } from '../shared/utils.js';
import { AiBookmarksError, ERROR_CODES, httpStatusToErrorCode, isRetryable, logError } from '../shared/error-handler.js';

// Simple in-memory rate limiter (requests per minute)
const rateLimiter = {
  requests: [],
  maxPerMinute: 50,
  isLimited() {
    const now = Date.now();
    this.requests = this.requests.filter((t) => now - t < 60000);
    return this.requests.length >= this.maxPerMinute;
  },
  record() {
    this.requests.push(Date.now());
  },
};

/**
 * Calls Claude to produce a summary + categorization for a bookmark.
 *
 * @param {{ url: string, title: string, extractedText: string, description: string, categories: Object[] }} params
 * @returns {Promise<{ summary: string, category: string, tags: string[], isNewCategory: boolean, categoryColor: string, model: string }>}
 */
export async function enrichBookmark({ url, title, extractedText, description, categories }) {
  const settings = await getSettings();

  if (!settings.claudeApiKey) {
    throw new AiBookmarksError('No Anthropic API key configured', ERROR_CODES.API_NO_KEY);
  }

  const apiKey = await decryptApiKey(settings.claudeApiKey);
  if (!apiKey) {
    throw new AiBookmarksError('Could not decrypt API key', ERROR_CODES.API_AUTH);
  }

  const model = resolveModel(settings.selectedModel);
  const prompt = buildPrompt({ url, title, extractedText, description, categories });

  return callClaudeWithRetry(apiKey, model, prompt);
}

/**
 * Makes a minimal call to validate an API key. Used by the options page.
 */
export async function testApiKey(apiKey) {
  const prompt = buildPrompt({
    url: 'https://example.com',
    title: 'Test',
    extractedText: 'This is a test page.',
    description: '',
    categories: [],
  });
  await callClaudeWithRetry(apiKey, CLAUDE_MODEL, prompt, 1);
  return true;
}

/** Uses the selected model only if it is an Anthropic model id; else the default. */
function resolveModel(selectedModel) {
  return typeof selectedModel === 'string' && selectedModel.startsWith('claude') ? selectedModel : CLAUDE_MODEL;
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

function buildPrompt({ url, title, extractedText, description, categories }) {
  const categoryNames = categories.map((c) => c.name).join(', ') || 'none yet';
  const content = truncate(extractedText || description || '', MAX_EXTRACTED_TEXT_LENGTH);

  return {
    system:
      'You are a bookmark assistant. Your job is to analyze webpages and categorize them. ' +
      'Always respond with valid JSON only — no markdown, no explanation, just the JSON object.',
    userMessage:
      `Analyze this webpage and respond with a JSON object only:\n\n` +
      `URL: ${url}\n` +
      `Title: ${title}\n` +
      `Content: ${content}\n\n` +
      `Existing categories: ${categoryNames}\n\n` +
      `Respond with exactly this JSON structure:\n` +
      `{\n` +
      `  "summary": "2-3 sentence summary of the page",\n` +
      `  "category": "best matching category name, or a new concise name if none fit",\n` +
      `  "tags": ["tag1", "tag2", "tag3"],\n` +
      `  "isNewCategory": true or false,\n` +
      `  "categoryColor": "#hexcode only if isNewCategory is true, else null"\n` +
      `}`,
  };
}

// ─── API Call with Retry ──────────────────────────────────────────────────────

async function callClaudeWithRetry(apiKey, model, prompt, maxRetries = AI_MAX_RETRIES) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (rateLimiter.isLimited()) {
      await sleep(2000);
    }

    try {
      return await callClaude(apiKey, model, prompt);
    } catch (err) {
      lastError = err;
      logError(`Claude API attempt ${attempt + 1}`, err);

      if (!isRetryable(err) || attempt === maxRetries) break;
      await sleep(AI_RETRY_DELAYS_MS[attempt] || 4000);
    }
  }

  throw lastError;
}

async function callClaude(apiKey, model, { system, userMessage }) {
  rateLimiter.record();

  let response;
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0.2,
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
  } catch (networkErr) {
    throw new AiBookmarksError(`Network error: ${networkErr.message}`, ERROR_CODES.API_NETWORK);
  }

  if (!response.ok) {
    const errorCode = httpStatusToErrorCode(response.status);
    let body;
    try {
      body = await response.json();
    } catch {}
    throw new AiBookmarksError(
      `Claude API error ${response.status}: ${body?.error?.message || response.statusText}`,
      errorCode,
      { status: response.status, body }
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new AiBookmarksError('Failed to parse Claude API response', ERROR_CODES.API_PARSE);
  }

  const text = data?.content?.[0]?.text;
  if (!text) {
    throw new AiBookmarksError('Empty response from Claude API', ERROR_CODES.API_PARSE);
  }

  return parseAiResponse(text, data.model || model);
}

// ─── Response Parsing ─────────────────────────────────────────────────────────

function parseAiResponse(text, model) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        throw new AiBookmarksError(`Cannot parse AI response as JSON: ${text.slice(0, 200)}`, ERROR_CODES.API_PARSE);
      }
    } else {
      throw new AiBookmarksError(`No JSON found in AI response: ${text.slice(0, 200)}`, ERROR_CODES.API_PARSE);
    }
  }

  return {
    summary: String(parsed.summary || '').trim(),
    category: String(parsed.category || 'Uncategorized').trim(),
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
    isNewCategory: Boolean(parsed.isNewCategory),
    categoryColor: parsed.categoryColor || null,
    model,
  };
}

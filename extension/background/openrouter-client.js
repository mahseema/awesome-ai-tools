// OpenRouter API client (OpenAI-compatible) with retry logic, rate limiting,
// and key decryption. Mirrors the interface of ai-client.js (the Anthropic client).

import {
  OPENROUTER_API_URL,
  OPENROUTER_FREE_MODELS,
  AI_MAX_RETRIES,
  AI_RETRY_DELAYS_MS,
  MAX_EXTRACTED_TEXT_LENGTH,
} from '../shared/constants.js';
import { getSettings, updateSettings } from '../shared/storage-schema.js';
import { decryptApiKey, sleep, truncate } from '../shared/utils.js';
import { AiBookmarksError, ERROR_CODES, httpStatusToErrorCode, isRetryable, logError } from '../shared/error-handler.js';

const DEFAULT_MODEL = OPENROUTER_FREE_MODELS[0].id;

// Free models to fall through when the preferred one returns 404. Ordered by
// the static preset list (already free-only at the top).
const FALLBACK_MODELS = OPENROUTER_FREE_MODELS.filter((m) => m.free).map((m) => m.id);

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
 * Calls OpenRouter to produce a summary + categorization for a bookmark.
 * Returns parsed JSON result.
 *
 * @param {{ url: string, title: string, extractedText: string, description: string, categories: import('../shared/constants.js').Category[] }} params
 * @returns {Promise<{ summary: string, category: string, tags: string[], isNewCategory: boolean, categoryColor: string, model: string }>}
 */
export async function enrichBookmark({ url, title, extractedText, description, categories }) {
  const settings = await getSettings();

  if (!settings.openrouterApiKey) {
    throw new AiBookmarksError('No API key configured', ERROR_CODES.API_NO_KEY);
  }

  const apiKey = await decryptApiKey(settings.openrouterApiKey);
  if (!apiKey) {
    throw new AiBookmarksError('Could not decrypt API key', ERROR_CODES.API_AUTH);
  }

  const model = resolveModel(settings.selectedModel);
  const prompt = buildPrompt({ url, title, extractedText, description, categories });

  // Self-heal: if the preferred model 404s, transparently try other free
  // models and persist the one that works.
  return callWithModelFallback(apiKey, model, prompt, { persist: true });
}

/**
 * Makes a raw call to OpenRouter. Used by options page to validate API key.
 * Tries the selected model first, then falls back through free models — a 404
 * on one model shouldn't make a valid key look invalid.
 */
export async function testApiKey(apiKey, model) {
  const prompt = buildPrompt({
    url: 'https://example.com',
    title: 'Test',
    extractedText: 'This is a test page.',
    description: '',
    categories: [],
  });
  await callWithModelFallback(apiKey, resolveModel(model), prompt, { persist: false, maxRetries: 1 });
  return true;
}

/**
 * Calls OpenRouter with the preferred model, transparently falling through to
 * other free models on a 404 "no endpoints" error. On success with a model
 * other than the stored one, persists it (when persist=true) so future calls
 * skip the dead model.
 */
async function callWithModelFallback(apiKey, preferredModel, prompt, { persist = false, maxRetries = AI_MAX_RETRIES } = {}) {
  const candidates = [preferredModel, ...FALLBACK_MODELS.filter((m) => m !== preferredModel)];
  let lastError;

  for (const candidate of candidates) {
    try {
      const result = await callOpenRouterWithRetry(apiKey, candidate, prompt, maxRetries);
      if (persist && candidate !== preferredModel) {
        await updateSettings({ selectedModel: candidate });
        logError('OpenRouter model auto-switch', new AiBookmarksError(
          `Model "${preferredModel}" unavailable — switched to "${candidate}"`,
          ERROR_CODES.API_MODEL_UNAVAILABLE
        ));
      }
      return result;
    } catch (err) {
      lastError = err;
      // Only keep trying other models when THIS model is unavailable.
      if (!(err instanceof AiBookmarksError) || err.code !== ERROR_CODES.API_MODEL_UNAVAILABLE) {
        throw err;
      }
    }
  }

  throw lastError;
}

// Accept ANY model id the user configured (from the live list or typed in),
// so custom models like "tencent/hunyuan-a13b-instruct:free" work. Only fall
// back to the default when nothing is set.
function resolveModel(selectedModel) {
  return typeof selectedModel === 'string' && selectedModel.trim() ? selectedModel.trim() : DEFAULT_MODEL;
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

async function callOpenRouterWithRetry(apiKey, model, prompt, maxRetries = AI_MAX_RETRIES) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Rate limiting
    if (rateLimiter.isLimited()) {
      await sleep(2000);
    }

    try {
      const result = await callOpenRouter(apiKey, model, prompt);
      return result;
    } catch (err) {
      lastError = err;
      logError(`OpenRouter API attempt ${attempt + 1}`, err);

      if (!isRetryable(err) || attempt === maxRetries) break;

      const delay = AI_RETRY_DELAYS_MS[attempt] || 4000;
      await sleep(delay);
    }
  }

  throw lastError;
}

async function callOpenRouter(apiKey, model, { system, userMessage }) {
  rateLimiter.record();

  let response;
  try {
    response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Title': 'AI Bookmarks',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userMessage },
        ],
      }),
    });
  } catch (networkErr) {
    throw new AiBookmarksError(`Network error: ${networkErr.message}`, ERROR_CODES.API_NETWORK);
  }

  if (!response.ok) {
    let body;
    try {
      body = await response.json();
    } catch {}
    // 404 "No endpoints found" means the model id is gone/unavailable — flag it
    // so the caller can transparently switch to another free model.
    const errorCode = response.status === 404
      ? ERROR_CODES.API_MODEL_UNAVAILABLE
      : httpStatusToErrorCode(response.status);
    throw new AiBookmarksError(
      `OpenRouter API error ${response.status}: ${body?.error?.message || response.statusText}`,
      errorCode,
      { status: response.status, body, model }
    );
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new AiBookmarksError('Failed to parse OpenRouter API response', ERROR_CODES.API_PARSE);
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new AiBookmarksError('Empty response from OpenRouter API', ERROR_CODES.API_PARSE);
  }

  return parseAiResponse(text, data.model || model);
}

// ─── Response Parsing ─────────────────────────────────────────────────────────

function parseAiResponse(text, model) {
  // Strip potential markdown code fences
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try to extract JSON object from the text
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

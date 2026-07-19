// Provider manager — routes AI calls to the active provider (OpenRouter or Anthropic).

import { DEFAULT_PROVIDER, PROVIDER_OPTIONS } from '../shared/constants.js';
import { getSettings } from '../shared/storage-schema.js';

const VALID_PROVIDERS = PROVIDER_OPTIONS.map((p) => p.id);

/**
 * Returns the active provider id ('openrouter' or 'anthropic') based on settings.
 * Falls back to the default provider if the stored value is missing or invalid.
 */
export async function getProvider() {
  const settings = await getSettings();
  return VALID_PROVIDERS.includes(settings.provider) ? settings.provider : DEFAULT_PROVIDER;
}

/**
 * Returns the client module for the active (or given) provider.
 * Clients share the same interface: enrichBookmark(params), testApiKey(apiKey).
 */
export async function getClient(provider) {
  const active = VALID_PROVIDERS.includes(provider) ? provider : await getProvider();
  return active === 'anthropic'
    ? import('./ai-client.js')
    : import('./openrouter-client.js');
}

/**
 * Enriches a bookmark using the active provider.
 * Same params/result shape as ai-client.enrichBookmark.
 */
export async function enrichWithAI(params) {
  const client = await getClient();
  return client.enrichBookmark(params);
}

/**
 * Tests an API key against the selected provider (defaults to the active one).
 */
export async function testApiKey(apiKey, provider, model) {
  const client = await getClient(provider);
  return client.testApiKey(apiKey, model);
}

/**
 * Returns true if the active provider has an API key configured in settings.
 */
export async function hasApiKey(settings) {
  const provider = VALID_PROVIDERS.includes(settings?.provider) ? settings.provider : DEFAULT_PROVIDER;
  return provider === 'anthropic' ? Boolean(settings?.claudeApiKey) : Boolean(settings?.openrouterApiKey);
}

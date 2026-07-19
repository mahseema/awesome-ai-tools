// Utility functions shared across all extension contexts

// ─── ID Generation ────────────────────────────────────────────────────────────

/** Generates a random alphanumeric ID with a prefix */
export function generateId(prefix = 'bm') {
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

// ─── URL Utilities ────────────────────────────────────────────────────────────

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    // Strip trailing slash, fragments, and tracking params
    u.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'fbclid', 'gclid'].forEach(
      (p) => u.searchParams.delete(p)
    );
    let normalized = u.toString();
    if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    return normalized;
  } catch {
    return url;
  }
}

export function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function getFaviconUrl(url) {
  try {
    const { origin } = new URL(url);
    return `${origin}/favicon.ico`;
  } catch {
    return null;
  }
}

// ─── Text Utilities ───────────────────────────────────────────────────────────

export function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function sanitizeText(text) {
  if (!text) return '';
  // Remove null bytes and excessive whitespace
  return text.replace(/\0/g, '').replace(/\s+/g, ' ').trim();
}

export function highlightMatches(text, query) {
  if (!query || !text) return escapeHtml(text || '');
  const escaped = escapeHtml(text);
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(`(${escapedQuery})`, 'gi'), '<mark>$1</mark>');
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Time Utilities ───────────────────────────────────────────────────────────

export function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function daysSince(timestamp) {
  return (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
}

// ─── API Key Crypto (AES-GCM) ─────────────────────────────────────────────────

const CRYPTO_SALT_KEY = 'crypto_salt';
const CRYPTO_IV_KEY = 'crypto_iv';

async function getOrCreateSalt() {
  const result = await chrome.storage.local.get(CRYPTO_SALT_KEY);
  if (result[CRYPTO_SALT_KEY]) {
    return new Uint8Array(result[CRYPTO_SALT_KEY]);
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await chrome.storage.local.set({ [CRYPTO_SALT_KEY]: Array.from(salt) });
  return salt;
}

async function deriveKey(salt) {
  // Use a fixed device-local passphrase based on extension ID
  const passphrase = chrome.runtime.id + '_ai_bookmarks_key';
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptApiKey(plaintext) {
  const salt = await getOrCreateSalt();
  const key = await deriveKey(salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  // Store IV alongside ciphertext as base64
  const combined = {
    iv: Array.from(iv),
    ct: Array.from(new Uint8Array(ciphertext)),
  };
  return JSON.stringify(combined);
}

export async function decryptApiKey(encrypted) {
  if (!encrypted) return null;
  try {
    const { iv, ct } = JSON.parse(encrypted);
    const salt = await getOrCreateSalt();
    const key = await deriveKey(salt);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      key,
      new Uint8Array(ct)
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

export function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isValidApiKey(key, provider = 'openrouter') {
  if (typeof key !== 'string' || key.length < 10) return false;
  return provider === 'openrouter' ? key.startsWith('sk-or-') : key.startsWith('sk-ant-');
}

// DOM localization helper.
// Applies chrome.i18n messages to elements carrying data-i18n attributes and
// switches the document to RTL for right-to-left UI languages (Hebrew, Arabic, …).
//
// Usage in HTML:
//   <span data-i18n="popupTitle">AI Bookmarks</span>          → textContent
//   <input data-i18n-placeholder="searchPlaceholder">          → placeholder
//   <button data-i18n-title="settingsButton">⚙</button>        → title attribute
// The hardcoded English in the markup stays as the fallback when a key is missing.

const RTL_LANGUAGES = ['he', 'ar', 'fa', 'ur', 'yi'];

/** Returns the translated message, or null if the key has no translation. */
export function t(key) {
  const msg = chrome.i18n.getMessage(key);
  return msg || null;
}

/** True when the current UI language reads right-to-left. */
export function isRtl() {
  const lang = chrome.i18n.getUILanguage() || '';
  return RTL_LANGUAGES.includes(lang.split('-')[0].toLowerCase());
}

/**
 * Localizes the whole document: text, placeholders, titles, and direction.
 * Call once after DOMContentLoaded.
 */
export function localizeDocument(root = document) {
  if (isRtl()) {
    root.documentElement?.setAttribute('dir', 'rtl');
    document.documentElement.setAttribute('dir', 'rtl');
  }
  document.documentElement.setAttribute('lang', chrome.i18n.getUILanguage() || 'en');

  for (const el of document.querySelectorAll('[data-i18n]')) {
    const msg = t(el.dataset.i18n);
    if (msg) el.textContent = msg;
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    const msg = t(el.dataset.i18nPlaceholder);
    if (msg) el.setAttribute('placeholder', msg);
  }
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    const msg = t(el.dataset.i18nTitle);
    if (msg) el.setAttribute('title', msg);
  }
}

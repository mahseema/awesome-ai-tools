// Content script: extracts clean text and metadata from the current page.
// Runs in the page's isolated world. Does NOT make any API calls.
// Communicates with the service worker via chrome.runtime.sendMessage.

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__aiBookmarksInjected) return;
  window.__aiBookmarksInjected = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action === 'EXTRACT_CONTENT') {
      try {
        sendResponse(extractPageContent());
      } catch (err) {
        sendResponse({ error: err.message, text: '', title: document.title });
      }
      return true;
    }
  });

  function extractPageContent() {
    return {
      text: extractText(),
      title: document.title,
      description: getMeta('description') || getMeta('og:description') || '',
      keywords: getMeta('keywords') || '',
      ogImage: getMeta('og:image') || '',
      canonical: getCanonical(),
      lang: document.documentElement.lang || '',
    };
  }

  function extractText() {
    // Priority 1: JSON-LD structured data
    const jsonLdText = extractJsonLd();
    if (jsonLdText) return jsonLdText;

    // Priority 2: OpenGraph / meta description
    const metaDesc = getMeta('og:description') || getMeta('description');

    // Priority 3: <article> element
    const article = document.querySelector('article');
    if (article) return cleanElement(article);

    // Priority 4: <main> element
    const main = document.querySelector('main');
    if (main) return cleanElement(main);

    // Priority 5: largest content block
    const bestBlock = findLargestTextBlock();
    if (bestBlock) return cleanElement(bestBlock);

    // Priority 6: body fallback
    return cleanElement(document.body);
  }

  function extractJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const text = item.articleBody || item.description || item.text;
          if (text && text.length > 100) return text.slice(0, 4000);
        }
      } catch {}
    }
    return null;
  }

  function cleanElement(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    // Remove noise elements
    const selectors = ['script', 'style', 'nav', 'footer', 'aside', 'header',
      '.ad', '.ads', '.advertisement', '[aria-hidden="true"]', 'noscript'];
    selectors.forEach((sel) => {
      clone.querySelectorAll(sel).forEach((n) => n.remove());
    });
    const text = (clone.innerText || clone.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, 4000);
  }

  function findLargestTextBlock() {
    const candidates = document.querySelectorAll('div, section');
    let best = null;
    let bestScore = 0;

    for (const el of candidates) {
      const paragraphs = el.querySelectorAll('p');
      const textLength = (el.innerText || '').length;
      const score = paragraphs.length * 10 + textLength;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function getMeta(name) {
    const el = document.querySelector(
      `meta[name="${name}"], meta[property="${name}"]`
    );
    return el?.content?.trim() || '';
  }

  function getCanonical() {
    return document.querySelector('link[rel="canonical"]')?.href || location.href;
  }
})();

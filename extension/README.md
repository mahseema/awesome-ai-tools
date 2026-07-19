# AI Bookmarks — Chrome Extension (MV3), v2

AI-powered bookmark manager: when you bookmark a page, the extension analyzes it with AI, creates a matching topic folder, files the bookmark, writes a 2–3 sentence summary, tags it, and ranks it by how actively you use the site. **Works 100% free** using OpenRouter's free models — no paid API required.

**עברית:** מנהל סימניות מבוסס AI — עובד בחינם לגמרי עם מודלים חינמיים של OpenRouter. שמירת דף מפעילה ניתוח AI שמתייק, מתקצר, מתייג ומדרג. כולל ייבוא כל הסימניות הקיימות, גיבוי אוטומטי ל-Google Sheets, מצב כהה ועיצוב מודרני.

## What's new in v2

- **OpenRouter first, free by default** — one key (`sk-or-…`), pick a free model (Gemini Flash / Llama 3.3 / Qwen / DeepSeek), pay $0. Anthropic direct remains available as a premium option.
- **Import existing bookmarks** — one click scans your whole Chrome bookmark tree and lets the AI organize, summarize, and rank everything you already saved. Progress bar included; runs in the background.
- **Google Sheets backup instead of Firebase** — all bookmarks (with AI summaries, categories, tags, rankings) back up to a spreadsheet in *your* Google Drive. Open it in Excel anytime. Zero servers, full transparency. Firebase is gone.
- **Full UI redesign** — modern look, dark/light/auto theme toggle, smooth animations, gradient accents.
- **CSV export** — Excel-ready (UTF-8 BOM, so Hebrew/Chinese text opens correctly).
- **Zero-backend sharing** — "Share Collection" now generates a polished standalone HTML page + copies a markdown link list. Send it to anyone; no accounts needed.

## Install (developer mode)

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this `extension/` folder.
3. The settings page opens automatically. Get a **free** API key:
   - Sign in with Google at [openrouter.ai/keys](https://openrouter.ai/keys)
   - Click *Create Key*, copy it (starts with `sk-or-`)
   - Paste it in settings, pick a 🎁 FREE model, click **Test**, then **Save**
4. Bookmark any page (Ctrl+D / ⌘D) — watch it get categorized, summarized, and ranked.
5. Optional: go to **Backup & Import** → *Import & Organize Existing Bookmarks* to let the AI process everything you already have.

## Run tests

Requires Node.js 20+ (built-in `node:test` runner, zero dependencies):

```bash
cd extension
npm test   # 77 tests
```

Covers: the OpenRouter + Anthropic request/response schemas, JSON parsing (clean/fenced/embedded/sparse), retry classification (401 terminal, 5xx retried), AES-GCM key encryption, storage schema (LRU eviction, queue, loop prevention), ranking math, categorization/folder logic, and the existing-bookmarks importer — all against an in-memory `chrome.*` mock.

## Localization

English (default), **עברית** (full RTL layout), **简体中文**, **繁體中文**. Follows the browser's UI language automatically; URLs and API keys stay LTR in RTL layouts.

## Architecture

| Layer | Files | Role |
|---|---|---|
| Service worker | `background/service-worker.js` | Event hub: bookmark events, visit tracking, alarms, messaging |
| AI pipeline | `background/bookmark-handler.js`, `ai-client.js`, `categorizer.js` | Extract page → AI call (OpenRouter/Anthropic) → folder + summary + tags |
| Import | `background/importer.js` | Scan existing bookmark tree → queue for AI, with progress tracking |
| Backup | `background/sheets-client.js` | Google Sheets full backup via the user's own Google account |
| Ranking | `background/ranker.js` | `visits×0.4 + recency-decay×0.3 + AI-relevance×0.2 + shares×0.1` |
| UI | `popup/`, `options/` | Themed popup + settings; search, share-as-HTML, import, export |
| Shared | `shared/` | Storage schema, crypto utils, i18n + RTL, error handling |

## Google Sheets backup setup (one-time, ~5 minutes)

The backup uses Chrome's built-in Google sign-in (`chrome.identity`), which needs an OAuth client ID bound to your extension:

1. Load the extension once and copy its ID from `chrome://extensions`.
2. In [Google Cloud Console](https://console.cloud.google.com): create a project (free) → *APIs & Services* → enable **Google Sheets API** and **Google Drive API**.
3. *Credentials* → *Create credentials* → *OAuth client ID* → type **Chrome extension** → paste your extension ID.
4. Copy the generated client ID into the `oauth2.client_id` field in `manifest.json` and reload the extension.
5. In settings → **Backup & Import** → *Backup Now*. A spreadsheet named "AI Bookmarks Backup" appears in your Drive.

No Google Cloud billing is required — Sheets/Drive API quotas are free at this scale.

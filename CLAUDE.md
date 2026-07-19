# CLAUDE.md — Fable 5 Design Persona (project design rules)

These are **enforced design rules** for any UI/web work in this project. They
reconstruct the design instincts of the `claude-fable-5` model. Full rationale and
evidence: [`FABLE-DESIGN-PERSONA.md`](./FABLE-DESIGN-PERSONA.md) · [`EVIDENCE.md`](./EVIDENCE.md).

## Identity
You are an **award-winning SaaS designer**. Do **not** ship generic Tailwind
defaults. Do **not** use default fonts. Warm editorial restraint over flashy "AI" aesthetics.

## Method (non-negotiable order)
1. **Declare the system in writing first** — Palette · Type · Grid/Spacing · Motion · A11y — before building.
2. **Tokens first, components second.** No hardcoded values a token should own. Normalize off-scale one-offs.
3. **Verify in a real browser** at ≥1 breakpoint; scroll it; console must be clean.
4. **Self-critique by measurement** (contrast ratios, value separation) — fix root causes, not symptoms.

## Typography
- Two registers — match to the brand, never default to one. Never a default-only stack.
- **Serif-editorial (Fable's warm system; hospitality/editorial brands):** a THREE-font system — **Instrument Serif** display at weight **400** (the serif carries it, not bold) + **Inter** body + **Geist Mono** uppercase labels. Display line-height ~1.06, tracking -0.005…-0.015em. Contrast comes from the loud mono micro-caps, not a bold display.
- **Grotesque/techy (SaaS/product):** display + body + mono trio — Bricolage Grotesque / Inter / IBM Plex Mono · Archivo / · / Spline Sans Mono. Display HEAVY **800/850/900** (+ mid-steps 650/750), negative tracking to -0.04em.
- **Cinematic register (atmosphere-led brands):** clean display over full-bleed moody photography, near-white text, muted accent.
- Both: fluid `clamp()` type ladder (Utopia-style); body line-height `1.5`. **Mono micro-caps**: 10–13px uppercase, +0.10–0.18em tracking, weight 600, often in accent color (eyebrows/labels/stats/data/coordinates).
- **Signature headline (most common): clean display with ONE word in *serif italic*** (e.g. "keeps *watch*"), or the accent-colored-word variant — rarely both. Recurring brand glyph: a small starburst/asterisk mark.
- Webfonts `display=swap`.

## Copy voice
- Sentence case everywhere — never Title Case, no exclamation marks. Short declaratives, verbs over adjectives. **ONE emotional beat per headline** — the same word that gets the italic/accent treatment. Proof over hype in eyebrows/microcopy.
- Banned words: "Unlock", "Elevate", "Empower", "Supercharge", "Seamless". Mono meta-rows = uppercase specimen labels separated by `/`. CTAs are verbs: pill primary ("Start free →") + one ghost learn-path — never two competing asks.

## Spacing
- Fluid `clamp()` section padding (e.g. `clamp(64px, 8vw, 104px)`); grid/flex `gap`, never bare-sibling whitespace. Even-8 scale. Containers 1120–1440px. Mobile-first `min-width` queries.

## Color
- **Warm paper base, never `#fff`** (`#faf9f6`/`#FAF6EF`/`#F4F6F8`). Pure white only for elevated cards.
- **"Light app, dark device-canvas" split** — page is paper; product moments sit on dark slate. Not global dark mode.
- **One accent = action; a second hue reserved strictly for warnings/flags.** Color as meaning, not decoration.
- WCAG AA checked numerically (4.5:1 text / 3:1 large); color never the only channel.

## Buttons
- Pill `999px` default CTA; ghost = `1.5px solid ink` → inverts to ink-fill on hover; subtle `translateY(-1px)` lift; ≥44px hit targets; accent-tinted soft shadow; conversion-aware states.

## Surfaces & components
- **Hairline edges everywhere:** 1px low-alpha borders (`rgba(148,163,184,.22)` light / `rgba(245,240,230,.14)` dark; tokens `--edge`/`--card-line`). A card = hairline + soft shadow **together**; internals split by hairline border-top/left, never nested boxes.
- Eyebrows carry a **26×1px accent dash** (`::before`, ~70% opacity). Film grain (SVG `feTurbulence`, opacity .04–.06) + soft vignette on dark/cinematic surfaces.
- **Glow discipline:** only one soft light-source orb on dark heros, or a 6–7px live-status dot (`0 0 8px accent`) — never on borders/text/buttons.
- On-dark cards: subtle dark gradient fill + hairline + `blur(14px)` + `0 30px 60px -30px rgba(0,0,0,.7)` + 1px accent ring @5% opacity.
- **Section skeleton (invariant order):** eyebrow-with-dash → headline (one italic/accent word) → lede 17px/1.6, max-width 540–620px → pill+ghost CTA row → optional mono meta row.
- Nav: accent starburst + display-face wordmark; quiet body links + exactly ONE mono micro-caps accent item (the offer/CTA). Stats: display-face numeral @400 over a faint mono micro-caps label.
- Forms: ≥44px inputs, hairline border, mono micro-caps labels; focus = accent border + `0 0 0 3px rgba(accent,.15)` ring. Always style `:focus-visible` (2px accent outline, offset 2px).
- Icons: 1.5px-stroke geometric, `currentColor`, 16–20px — never emoji-as-UI. Footer = the page's last dark-canvas moment.

## Shadows
- Soft, large-blur, low-opacity, **negative spread** (`-28px/-30px`) — grounded card, not a halo. Two-layer "paper" shadow for editorial systems.

## Border radius
- Radius encodes brand voice: **16px** friendly · **10px** techy · **0px + 2px borders** rigid. Pills 999px, cards 14–16px, chips 6–8px, micro 3–5px. No off-scale radii.

## Animation
- Restraint: motion must earn its keep; CSS over video; `prefers-reduced-motion` always.
- Easings: `cubic-bezier(0.16,1,0.3,1)` entrances; `cubic-bezier(0.34,1.56,0.64,1)` for the one delight moment. Durations micro `.12–.2s`, entrance `.25–.3s`, reveal `.6–.7s`.
- **High-end register (premium/3D/award-winning):** GSAP (`^3.13.0`) + scroll-linked motion — lerp scroll progress (factor ~`.08`, never raw), `power1.out`/`power2.out` easings, paused split-text scroll reveals (keep `aria-label`), cursor-spotlight radial-mask reveal (rAF lerp ~`.1`, R~`260px`), `-mx*40/-my*40` mouse parallax, scroll-scrubbed `<video>`. Weighted, not jumpy; still respects reduced-motion.

## Hard NO
Tailwind defaults · default fonts · pure-white bg · gradient meshes · *decorative* neon/glow (not the deliberate single neon-accent register) · particles · "AI sparkle" · decorative glassmorphism · emoji/icon-spam · color-only signaling · off-scale values · Title Case / hype copy ("Unlock", "Elevate") · unstyled focus rings · video where CSS would do · shipping without running it.

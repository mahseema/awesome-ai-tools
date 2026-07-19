# AGENTS.md — Fable 5 Design Persona

Design guidance for any coding agent (Codex, Cursor, Antigravity, etc.) doing
UI/web work in this repo. This reconstructs the design instincts of the
`claude-fable-5` model. Canonical source: `FABLE-DESIGN-PERSONA.md`. Provenance: `EVIDENCE.md`.

## Role
Act as an **award-winning SaaS designer**. Never ship generic Tailwind defaults.
Never use default fonts. Favor warm editorial restraint over flashy "AI" looks.

## Workflow (in this order, every time)
1. **Declare the design system in writing** (Palette · Type · Grid/Spacing · Motion · A11y) before writing markup.
2. **Tokens first, then components.** No hardcoded values a token should own; normalize off-scale one-offs.
3. **Run it in a real browser**, scroll it, keep the console clean, check ≥1 breakpoint.
4. **Critique your output by measuring** (contrast, value separation, spacing) and fix root causes.

## Rules by category

**Typography** — two registers, never a default-only stack. (1) **Serif-editorial** (Fable's warm system; hospitality/editorial brands): THREE fonts — Instrument Serif display at weight 400 (serif carries it, not bold) + Inter body + Geist Mono uppercase labels; display line-height ~1.06, tracking -0.005…-0.015em; contrast from loud mono labels, not a bold display. (2) **Grotesque/techy** (SaaS): display+body+mono trio — Bricolage Grotesque/Inter/IBM Plex Mono · Archivo/·/Spline Sans Mono; display HEAVY 800/850/900 (+650/750 mids), tracking to -0.04em. Plus a **cinematic register**: clean display over full-bleed moody photography, near-white text, muted accent. Both type registers: fluid `clamp()` ladder; body line-height 1.5; mono micro-caps 10–13px uppercase +0.10–0.18em (often in accent; coords/specimen labels). `display=swap`. **Signature headline (most common): clean display with ONE word in *serif italic*** (e.g. "keeps *watch*"), or the accent-colored-word variant — rarely both. Recurring brand glyph: a small starburst/asterisk.

**Copy voice** — sentence case everywhere (never Title Case, no exclamation marks); short declaratives, verbs over adjectives; ONE emotional beat per headline (the same word that gets the italic/accent treatment); proof over hype. Banned words: "Unlock", "Elevate", "Empower", "Supercharge", "Seamless". Mono meta-rows = uppercase specimen labels separated by `/`. CTAs are verbs: pill primary + one ghost learn-path, never two competing asks.

**Spacing** — fluid `clamp()` section padding; grid/flex `gap` (never bare siblings); even-8 scale; containers 1120–1440px; mobile-first.

**Color** — warm paper base (never `#fff`); "light app / dark device-canvas" split; one accent for action, a second hue reserved for warnings; WCAG AA verified numerically; color not the only channel. Premium/3D register: neon-on-near-black (`#FF005E` on `#11010a`), iridescent hero gradients, **OKLCH, never pure #000/#fff**.

**Buttons** — pill `999px` default; ghost inverts to solid fill on hover; subtle lift; ≥44px targets; accent-tinted soft shadow; conversion-aware states.

**Surfaces & components** — hairline edges everywhere (1px low-alpha `--edge`/`--card-line`; a card = hairline + soft shadow together; internals split by hairline border-top/left). Eyebrows carry a 26×1px accent dash. Film grain (SVG `feTurbulence`, opacity .04–.06) + vignette on dark/cinematic surfaces. Glow only as one light-source orb or a live-status dot — never borders/text. Section skeleton in order: eyebrow-with-dash → headline (one italic/accent word) → bounded lede (max-width 540–620px) → pill+ghost CTA row → mono meta row. Nav: accent starburst + display wordmark + ONE mono accent item. Stats: display-face numeral @400 over faint mono label. Forms: ≥44px, hairline border, mono labels, accent focus ring. Always style `:focus-visible` (2px accent outline). Icons: 1.5px-stroke `currentColor`, never emoji. Footer = last dark-canvas moment.

**Shadows** — soft, large-blur, low-opacity, negative spread (grounded card, no halo); two-layer "paper" shadow for editorial.

**Border radius** — encodes brand voice (16px friendly / 10px techy / 0px+2px-borders rigid); pills 999, cards 14–16, chips 6–8, micro 3–5; no off-scale radii.

**Animation** — restraint, CSS over video, `prefers-reduced-motion` always; `cubic-bezier(0.16,1,0.3,1)` entrances, `cubic-bezier(0.34,1.56,0.64,1)` for one delight beat; micro .12–.2s / entrance .25–.3s / reveal .6–.7s. High-end register: GSAP (`^3.13.0`) + **Lenis** smooth-scroll + scroll-linked. Lenis→ScrollTrigger (`new Lenis({lerp:0.1})`); `.reveal` sections ease up via `power3.out` at `top 85%`. Plus: lerp scroll progress (~.08, never raw), `power1.out`/`power2.out`, paused split-text reveals (keep `aria-label`), cursor-spotlight radial-mask reveal, `-mx*40/-my*40` parallax, scroll-scrubbed video.


**Game & 3D art direction** — same principles: direct art as a brief (vision bar + hard floors + banlist e.g. 'no black shadows / no cloned trees / no fog-as-cover'); verify with automated vision (headless screenshot + pixel sampling); context detail must vary + cohere (no two trees share a mesh); game UI carries web rules. Game juice/feel is under-documented — human-in-the-loop, don't invent.

## Hard NO
Tailwind defaults · default fonts · pure-white backgrounds · gradient meshes · decorative neon · particles · "AI sparkle" · decorative glassmorphism · emoji/icon-spam · color-only signaling · off-scale values · Title Case / hype copy ("Unlock", "Elevate") · unstyled focus rings · video where CSS suffices · shipping unrun.

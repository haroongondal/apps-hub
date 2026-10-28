# Handoff: Design Editor phase 2, multi-page + embedded fonts + real PDF text (started 2026-10-28)

## 1. Resume prompt

```text
Continue Design Editor phase 2 (resume prompt written 2026-10-28). Working dir: /Users/outsentia/Documents/apps-hub,
branch design-editor-phase-2. Read docs/handoffs/design-editor-phase-2.md completely first. Trust §4 (verified facts);
do not redo that work. Follow the handoff contract in ~/.claude/CLAUDE.md: keep §6/§7 current as milestones land,
and at ~85% context rewrite this prompt and stop instead of compacting. Continue from §7 "Next step".
Don't commit until the user asks.
```

## 2. Goal and fixed constraints

Phase prompt (user, 2026-10-28): 1) a design holds many pages, all the same size; 2) text looks the same on any Mac and
PDF downloads have real, selectable text. Multi-page first, fonts and PDF text on top of it.

Constraints: AGENTS.md copy rules (sentence case, active voice, errors say what to do); UI only from `--c-*` tokens and
existing classes; no new runtime dependency besides @pdf-lib/fontkit; no zip dependency; don't commit until asked.
Done = e2e extended and green (3-page save/reopen/autosave, v1 file opens, 3 PDF pages of the right size, PDF text
contains each page's heading, font file embedded, errors == []) + hand check of the running app.

## 3. Decisions (with why)

- **File format v2** `{ version: 2, W, H, fonts: [...families used], pages: [canvasJSON, …] }`. `open()`/autosave also
  accept v1 `{ W, H, canvas }` (one page).
- **Undo** entries are `{ s, page }`: `s` is the whole-document snapshot string (also used for dirty check, autosave,
  save), `page` is the page that was current when the entry was recorded. Undo restores the previous `s` and shows the
  popped entry's page (where the change happened); redo shows the redone entry's page. The page index is kept out of
  `s` so switching pages never dirties the document or adds an undo step.
- **Magic resize applies to every page** (pages share one size, like Canva). Other pages are loaded into a throwaway
  StaticCanvas, moved/scaled with the same code, and written back.
- **Templates**: on an empty page the template fills it; otherwise it is added as a new page after the current one.
  Why: never destroys work, and matches the "add a page" mental model of a multi-page design.
- **Export**: PDF = every page. PNG/JPG/SVG = current page, or every page with the "All pages" checkbox; main.js writes
  `name-1.png`, `name-2.png`, … next to the path picked in the one Save dialog (same guarded save path).
- **Fonts** (all SIL OFL 1.1, embedding/subsetting allowed per OS/2 fsType, licences in `vendor/fonts/OFL-*.txt`):
  Atkinson Hyperlegible Next (sans; 400/600/800 reused from `vendor/ui/fonts`, 700 + 400i/700i added), Jost (geometric
  display, 400/700 + italics), Playfair Display (serif, 400/700 + italics), Dancing Script (script, 400/700, no italic).
  Source: static TTFs from the @expo-google-fonts npm packages (Google Fonts builds). Loaded with FontFace before any
  text is measured. System fonts stay in the picker under "This Mac only".
- **Missing fonts on open**: any text font that is neither bundled nor installed on this Mac is replaced with Atkinson
  Hyperlegible Next and a toast names the replaced fonts.
- **PDF approach: image runs + real text in z-order.** Objects are flattened in stacking order (groups recursed);
  each run of consecutive non-text objects becomes one transparent PNG layer of the page, and each text object in a
  bundled font is drawn as real PDF text (subset-embedded TTF via fontkit) between them. Why: keeps exact stacking and
  Fabric's look for shapes/images/filters with no SVG-to-PDF converter to write. Text positions use Fabric's own
  wrapped lines and char bounds (`_textLines`, `__charBounds`, `_getLineLeftOffset`), drawn with one TJ per line whose
  adjustments put every glyph where the canvas put it (covers alignment incl. justify, charSpacing, kerning).
  Rotation/scale/flip come from `calcTransformMatrix()`. Text falls back to the image layer when it uses a system font,
  has per-character styles, a gradient fill, a stroke, a shadow, a text path, or a character the font lacks.
  Synthetic italic (Dancing Script) uses Chromium's skew of 0.25.

## 4. Verified facts (do not re-derive)

- Baseline `pnpm --filter design-editor test:e2e` was green on main before any change (2026-10-28).
- Fabric 7.4.0 text layout: line i baseline = topOffset + Σ getHeightOfLine(k<i) + getHeightOfLineImpl(i)·(1−0.222);
  getHeightOfLineImpl = maxFontSize·1.13; glyph j pen x = _getLeftOffset() + _getLineLeftOffset(i) + __charBounds[i][j].left.
  Decorations: rect at lineTop + Himpl·(1−0.222) + offsets[type]·fontSize − aligner·thickness, thickness =
  fontSize·66.667/1000, offsets underline .1, linethrough −.28167 (aligner .5), overline −.81333 (aligner 1), width =
  Σ kernedWidth − charSpacing.
- tokens.css already registers Atkinson Hyperlegible Next 400/600/800 for the UI; the 400 file is byte-identical to the
  @expo-google-fonts one.
- @pdf-lib/fontkit 1.1.1: MIT, maintainer hopding (same as pdf-lib), UMD bundle self-contained (pako inlined), no
  network/telemetry code (only two iconv-lite wiki URLs in strings). Vendored as `vendor/fontkit.min.js` (global `fontkit`).

## 5. File map

- `apps/design-editor/app.js`: editor (pages state, undo, fonts, export/PDF writer).
- `apps/design-editor/index.html`: layout, page strip, export menu.
- `apps/design-editor/main.js`: menus, guarded saves (multi-file export), autosave.
- `apps/design-editor/vendor/fonts/`: bundled fonts + OFL licences. `vendor/fontkit.min.js`.
- `apps/design-editor/test/e2e.mjs`: Playwright e2e; `test/v1.json` fixture.
- `apps/design-editor/README.md`: features, limitations, licences.

## 6. Session log

- s1 (2026-10-28): branch created; baseline e2e green; fonts + fontkit vendored; design decisions above.
- s1: multi-page, fonts, PDF text and e2e implemented; `pnpm --filter design-editor test:e2e` → `e2e ok`.
  devDeps added (exact pins): @pdf-lib/fontkit 1.1.1 (vendored copy is byte-identical), pdfjs-dist 4.10.38
  (Apache-2.0, test only; its optional @napi-rs/canvas is MIT prebuilt, no install script). pdf-lib names subset
  fonts `Jost-Bold-4525` (numeric suffix, not an `ABCDEF+` prefix).

- s1: visual check done: PDF pages rendered with pdfjs + @napi-rs/canvas match the PNG export (templates, plus an
  ad-hoc page with rotation, opacity, right/justify, underline, charSpacing, lineHeight, rgba fill, synthetic italic).
  Fabric's `justify` also stretches the last line; the PDF copies that. README updated (features, limitations, licences).

## 7. Current state and next step

Phase 2 is implemented, e2e green, nothing committed (user commits when ready). Next: the user's hand check with
`pnpm --filter design-editor start` (page strip; download a template with text as PDF and select its text), then commit on
`design-editor-phase-2` when asked. Known limits kept on purpose: text inside groups goes into the page image; the
whole document is re-serialised on every edit (fine for a few pages, slow for many image-heavy pages).

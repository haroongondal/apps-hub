# Quick edits Phase 1: palette and auto-enhance — Implementation Plan

> **For agentic workers:** executed with `cd-engineering-tools:parallel-agents-coord` (the owner's rule replaces `superpowers:subagent-driven-development`). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With an image selected in Design Editor (Mac and phone), show the photo's six main colours and an Auto-enhance button that sets the existing Brightness and Contrast sliders.

**Architecture:** The pure maths (k-means palette, levels stretch) lives in a new classic script `packages/design-editor-engine/image-maths.js` that the page loads before `app.js` and that Node can `require` for unit tests. `app.js` draws a 128 px copy of the image, calls the maths, and renders the result in the existing image inspector, which both the Mac page and the phone page use.

**Tech Stack:** plain browser JS (Fabric.js 7 already vendored), `node --test`, Electron + Playwright e2e (`apps/design-editor/test`).

**Spec:** `docs/superpowers/specs/2026-11-13-quick-edits-design.md` (scope 1 and 2, Phase 1, AC-1, AC-2, AC-6). Engine layout: `docs/design-editor/SPEC.md` §14.

## Global Constraints

- No new npm dependency. No new filter pipeline: auto-enhance only sets sliders that exist today.
- The editor's existing image adjustments are Brightness (-1..1, step 0.02), Contrast (-1..1, step 0.02), Blur and Black and white (`inspect()` in `app.js`). There is no white-balance and no saturation control, so auto-enhance sets Brightness and Contrast only (gap reported, not filled).
- Fabric applies Brightness then Contrast. Brightness adds `round(255·b)`; Contrast maps `v → F·(v−128)+128` with `F = 1.015·(c+1)/(1.015−c)`, so `c = 1.015·(F−1)/(F+1.015)`.
- The brand kit exists: `brand.colors` in `app.js`, saved with `saveBrand()` and drawn with `renderBrand()`.
- Copy: sentence case, plain words, no emoji, no ALL-CAPS, never "click" (the phone's plain-words test scans `app.js`). Reuse the page's existing `.swatches`, `.swatch`, `.hint` and `h3` styles; no hand-rolled colours.
- Script order on the mobile page stays `fabric → pdf-lib → fontkit → shell-mobile.js → copy.js → image-maths.js → app.js → touch.js`; `build.mjs` keeps its `</script>` and `url()` checks. The built page (`apps/design-editor-mobile/assets/editor/`) is git-ignored, so it is rebuilt as a check, not committed.
- Commits by pathspec only, no Claude attribution lines.

## Rulings (decided on the owner's behalf)

1. A swatch on the image inspector sets the **page background** (the selected element is the image, which has no fill). Text and shapes get the colours through the brand kit, which already applies a colour to any selection.
2. "Add to brand kit" appends the six colours that are not already in `brand.colors`.
3. "Distinct" means every pair of returned colours is at least 16 apart in RGB (Euclidean). An image with fewer real colours is padded with lighter and darker variants of its own colours.
4. An image with no visible pixels (alpha < 128 everywhere) gets no swatches and the hint "This image has no visible colours."
5. Auto-enhance reads the unfiltered source (`_originalElement`), so pressing it twice gives the same values.

## Review Focus

1. A photo of 4000 × 3000 px: the 128 px copy keeps the palette under 200 ms (e2e prints the time).
2. A one-colour or two-colour image still returns six distinct swatches (Task 1 test).
3. A transparent PNG (cut-out from Remove background): transparent pixels never become a swatch (Task 1 test).
4. Auto-enhance then one undo: the image's pixels and filters are exactly as before (Task 2 e2e).
5. An already well-exposed photo: Auto-enhance sets 0 and 0 and says so, rather than nudging it (Task 1 test, Task 2 toast).

---

### Task 1: Image maths (palette and levels)

**Files:**
- Create: `packages/design-editor-engine/image-maths.js`
- Create: `packages/design-editor-engine/test/image-maths.test.mjs`
- Modify: `packages/design-editor-engine/package.json` (add `"scripts": { "test": "node --test test/image-maths.test.mjs" }`, add `image-maths.js` to `files`)
- Modify: `packages/design-editor-engine/desktop.html`, `packages/design-editor-engine/mobile.html` (one `<script src="image-maths.js"></script>` between `copy.js` and `app.js`)
- Modify: `packages/design-editor-engine/build.mjs` (insert `'image-maths.js'` before `'app.js'` in `scripts`)

**Interfaces:**
- Produces (globals in the page, `module.exports` in Node):
  - `paletteFromPixels(px: Uint8ClampedArray | Uint8Array (RGBA), k = 6): string[]` — `k` lower-case `#rrggbb`, biggest cluster first; `[]` when no pixel has alpha ≥ 128.
  - `enhanceValues(px: RGBA array): { brightness: number, contrast: number }` — slider values, multiples of 0.02 (`Math.round(x * 50) / 50`, never `-0`).
- The file ends with `if (typeof module === 'object') module.exports = { paletteFromPixels, enhanceValues };` and has no other top-level names than these two functions (plus private helpers inside them or prefixed `im_`), because it shares the page's global scope with `app.js`.

- [ ] **Step 1: Write the failing tests** in `test/image-maths.test.mjs` (`createRequire(import.meta.url)('../image-maths.js')`), with a small helper that builds RGBA arrays:
  - `palette: six distinct colours for a busy image` — 128×96 pixels of a hue gradient plus deterministic noise → length 6, all `/^#[0-9a-f]{6}$/`, every pair ≥ 16 apart.
  - `palette: same input, same output` — two calls deep-equal.
  - `palette: biggest cluster first` — 70% `#2040c0`, 30% `#e0e0e0` → first swatch within 16 of `#2040c0`, and six distinct.
  - `palette: one-colour image still gives six` — all `#808080` → six distinct, first within 16 of `#808080`.
  - `palette: transparent pixels are ignored` — half alpha 0 red, half opaque blue → no swatch within 40 of pure red; all-transparent → `[]`.
  - `palette: under 200 ms on 128×128` — `performance.now()` around one call.
  - `enhance: full-range image is left alone` — luma spread 0..255 → `{ brightness: 0, contrast: 0 }`.
  - `enhance: flat image is left alone` — all one grey → `{ 0, 0 }`.
  - `enhance: dull image gets more contrast` — greys 100..150 → contrast > 0 and ≤ 0.3, |brightness| ≤ 0.25.
  - `enhance: dark image gets brighter` — greys 0..80 → brightness > 0.
  - `enhance: values sit on the slider steps` — for each case, `Math.round(v * 50) === v * 50` and `!Object.is(v, -0)`.

- [ ] **Step 2: Run** `node --test packages/design-editor-engine/test/image-maths.test.mjs` — expect FAIL (module missing).

- [ ] **Step 3: Implement `paletteFromPixels`.** Opaque pixels only (alpha ≥ 128). Deterministic seeding, no randomness: first centre = mean colour of the most populated 4-bit-per-channel bucket; each next centre = the pixel farthest from its nearest centre (lowest index wins a tie). Lloyd iterations until no assignment changes or 12 rounds; an empty cluster is re-seeded with the farthest pixel. Sort by cluster size, descending, round to hex. Then drop any colour within 16 of an earlier one, and pad back to `k` by walking the kept colours in order and trying mixes towards white and black (30%, 55%, 80%), keeping each candidate that is ≥ 16 from every colour so far.

- [ ] **Step 4: Implement `enhanceValues`.** Luma `0.299r + 0.587g + 0.114b` of opaque pixels; `lo`/`hi` = 1st and 99th percentile (histogram of 256 bins). If `hi − lo < 8` or no opaque pixels → `{0, 0}`. `F = clamp(223 / (hi − lo), 1, 1.6)`; `brightness = clamp((128 − (lo + hi) / 2) / 255, −0.25, 0.25)`; `contrast = min(1.015·(F−1)/(F+1.015), 0.3)`. Round both to 0.02 steps and turn `-0` into `0`.

- [ ] **Step 5: Run the tests** — expect all PASS. Then `pnpm --filter @apps-hub/design-editor-engine test` — PASS.

- [ ] **Step 6: Wire the script.** Add the two `<script>` tags and the `build.mjs` entry, then run `node packages/design-editor-engine/build.mjs` — expect `wrote apps/design-editor-mobile/assets/editor/editor.html (… MB, … fonts)` and `grep -c paletteFromPixels apps/design-editor-mobile/assets/editor/editor.html` ≥ 1.

- [ ] **Step 7: Commit** (pathspec):
```bash
git add -- packages/design-editor-engine/image-maths.js packages/design-editor-engine/test/image-maths.test.mjs
git commit -m "Design Editor: palette and auto-enhance maths for photos" -- packages/design-editor-engine/image-maths.js packages/design-editor-engine/test/image-maths.test.mjs packages/design-editor-engine/package.json packages/design-editor-engine/desktop.html packages/design-editor-engine/mobile.html packages/design-editor-engine/build.mjs
```

### Task 2: Palette and Auto-enhance in the image inspector (Mac and phone)

**Files:**
- Modify: `packages/design-editor-engine/app.js` (`inspect()` image section, a `smallPixels` helper, `window.editor`)
- Modify: `apps/design-editor/test/e2e.mjs` (Mac checks), `apps/design-editor/test/mobile.mjs` (phone checks)

**Interfaces:**
- Consumes: `paletteFromPixels`, `enhanceValues` (Task 1 globals).
- Produces: `window.editor.paletteOf(img: FabricImage): string[]` (for the e2e timing); DOM ids `#photoColors` (swatch container), `#paletteToKit` (button), `#fauto` (Auto-enhance button).

- [ ] **Step 1: Write the failing e2e checks** in `e2e.mjs`, as one block placed where it does not change any later assertion (remove the image it adds, or put it after the counts it would affect). Upload a 1600×1200 JPEG made in the page (gradient plus noise, values squeezed into 90..170 so it is dull):
  - time `editor.paletteOf(active)` with `performance.now()` on the first (uncached) call; `console.log('palette: <ms> ms')`; assert ≤ 200 and 6 distinct hex colours.
  - `#photoColors .swatch` count is 6; pressing the third swatch makes `editor.canvas.backgroundColor` equal its colour.
  - pressing `#paletteToKit` puts all six into `#brandColors` (each colour present as a swatch `title`).
  - read the image's rendered pixels (draw `getElement()` to a canvas), press `#fauto`, wait 300 ms: `#fco` value > 0 and the image's filters include `Contrast`; send `menu('undo')` once: filters deep-equal the ones before and the pixels are byte-identical to before (AC-2).
  - in `mobile.mjs`, upload a small image through `#imgFile` and assert `#photoColors .swatch` count is 6 and `#fauto` is visible in the phone inspector (AC-6 both platforms).

- [ ] **Step 2: Run** `pnpm --filter design-editor test:e2e` — expect FAIL at the new checks.

- [ ] **Step 3: Implement in `app.js`:**
  - `smallPixels(img)` → RGBA of `img._originalElement || img.getElement()` drawn into a canvas whose longest side is at most 128 px (aspect kept, at least 1 px).
  - `paletteOf(img)` cached in a `WeakMap` keyed by the source element (a new `setSrc`, such as Remove background, gives a new element and a fresh palette).
  - In the image section of `inspect()`, before "Remove background": `<h3>Colours in this photo</h3>`, `<div class="swatches" id="photoColors">`, `<button id="paletteToKit" style="width:100%;margin-top:6px">Add to brand kit</button>`, `<p class="hint">Pick a colour to use it as the page background.</p>`. Each swatch: `class="swatch"`, background and `title` = the colour, `aria-label="Use <colour> as the page background"`; pressing it sets `canvas.backgroundColor`, renders and `record()`s. With an empty palette show only `<p class="hint">This image has no visible colours.</p>`.
  - `#paletteToKit`: append the colours not in `brand.colors`, `saveBrand()`, `renderBrand()`, toast `Added N colours to the brand kit` (or `These colours are already in the brand kit`).
  - Under `<h3>Adjust</h3>`, first: `<button id="fauto" style="width:100%">Auto-enhance</button>`. Pressing it sets `#fbr` and `#fco` from `enhanceValues(smallPixels(o))` and calls the existing `apply()` once (one `record()` → one undo entry); if both are 0, toast `This photo already looks balanced`.
  - Add `paletteOf` to `window.editor`.

- [ ] **Step 4: Run** `pnpm --filter design-editor test:e2e` — expect `e2e ok`, the palette time line, and the media and mobile suites passing. Run `node --test apps/design-editor-mobile/src/__tests__/plain-words.test.ts` — PASS. Run `node packages/design-editor-engine/build.mjs` — writes the page.

- [ ] **Step 5: Commit** (pathspec): `git commit -m "Design Editor: photo colours and Auto-enhance in the image panel" -- packages/design-editor-engine/app.js apps/design-editor/test/e2e.mjs apps/design-editor/test/mobile.mjs`

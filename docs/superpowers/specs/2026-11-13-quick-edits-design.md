# Quick edits: palette, auto-enhance, cut-out, upscale

Date: 2026-11-13. Status: draft for the owner's approval. Feature 3 of 4; shared parts are in
`2026-11-13-image-tools-overview.md`.

## Why

Picsart, PhotoRoom and Remini put these behind subscriptions ($4–43 a month). They are the
everyday tools for social graphics, which is what the owner makes in Design Editor. Today the
editor's "Remove background" only clears a plain colour touching the edges (colour flood fill,
`removeBackground()` in `packages/design-editor-engine/app.js`).

## Goal

With an image selected in the editor, one tap gives a colour palette, a better-looking photo,
a clean cut-out or a sharper, bigger image. Each result is an ordinary edit: undo works, and
the original is kept in the design.

## Scope

1. **Palette from photo** (no model; engine JS, so it works on the Mac too): 6 colours by
   k-means on a 128 px copy (my call: k-means over median cut for stabler swatches). Tap a
   swatch to apply it to the selected element. "Add to brand kit" saves all six.
2. **Auto-enhance** (no model; engine JS, Mac too): computes values for the editor's existing
   image adjustments (levels, white balance by grey-world, mild saturation) and sets those
   sliders, so the owner can tweak or undo. No new filter pipeline.
3. **Cut-out** (phone only): "Remove background" runs U²-Netp (Apache, 4.6 MB). The mask is
   scaled to full size, the edge feathered, and the image swapped for a transparent PNG (as
   today). The current colour fill stays as "Plain background" for flat backdrops and on
   the Mac. Upgrade path if edges look rough on real photos: MODNet (6.6 MB, people only) or
   our own export of IS-Net (Apache upstream, about 176 MB), decided in Phase 0.
4. **Upscale 2× / 4×** (phone only): Real-ESRGAN general-x4v3 (BSD-3, 4.7 MB) in 128 px tiles
   with overlap; 2× is the 4× result scaled down. The output is capped at 4096 px on the longest side
   (my call; canvas and memory limits). Progress bar and Cancel.

Out (my call): batch processing of many photos; style filters and LUTs; tap-to-select
cut-out (it arrives with the eraser in feature 4, which needs the same model).

## How it works

- Engine (`packages/design-editor-engine/app.js`): palette and enhance are plain functions on
  canvas pixels, unit-tested in the engine's existing test setup. Cut-out and Upscale call
  `window.native.vision({ op, src })`, which is a new bridged call in `shell-mobile.js` and
  `src/editor/bridge.ts`. The image goes as a temp file path, and the answer comes back as a
  file path that the engine loads with `setSrc`.
- Kotlin (`modules/design-media/.../vision/`): `CutOut` and `Upscale` load their model through
  the model manager (first use downloads it), run on 2 threads, and write a PNG. Tiling and
  mask maths sit in `core/` with JVM tests against a Python reference.
- The toolbar shows Cut-out and Upscale only when `window.native.vision` exists, so the Mac
  never shows them.

## Phases

0. **Phone spike:** time U²-Netp at 320 px and Real-ESRGAN on a 1080 px photo (tiles) on the
   phone. Judge cut-out edges on 10 public sample photos (people, product, pet). Pass: cut-out ≤
   2 s; 4× upscale of a 1080 px photo ≤ 30 s (est.).
1. **No-model tools:** palette and auto-enhance in the engine (both platforms).
2. **Cut-out and Upscale:** bridge call, Kotlin tools, model manager use, then a Store release.

## Acceptance

- AC-1: palette returns 6 distinct colours for any image in ≤ 200 ms on the phone.
- AC-2: auto-enhance only moves existing sliders; one undo restores the image exactly.
- AC-3: cut-out on a person photo leaves a transparent background and keeps the person whole
  (manual check on the Phase 0 set). The old colour fill is still available.
- AC-4: upscale 4× of a 1080 px image completes, can be cancelled, and never exceeds 4096 px.
- AC-5: in airplane mode, every tool works once its model has been fetched; a missing model
  says "Connect to the internet once to get this tool."
- AC-6: on the Mac, palette and enhance work, and cut-out and upscale aren't shown.

## Left to the builder

Swatch layout, tile overlap size, feather radius, and the exact slider values auto-enhance sets.

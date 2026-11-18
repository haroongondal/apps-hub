# Image tools: overview and shared foundation

Date: 2026-11-13. Status: draft for the owner's approval. Handoff: `docs/handoffs/photo-search.md`.

## What the owner asked for

The image features paid apps sell (Google Photos search, gallery cleaners, Picsart, PhotoRoom,
Remini), run on the owner's phone with local models and no cloud. Owner's choices
(2026-11-13):

- OCR goes in the **PDF editor**. It is already designed: Scan Phase 4, Tesseract
  (`docs/pdf-editor/scan/`). Nothing new here.
- Everything else goes in **Design Editor**, in this order:

| # | Feature | Design |
|---|---|---|
| 1 | Find a photo (search by words, more like this) | `2026-11-13-photo-search-design.md` |
| 2 | Clean up the gallery (blurry, copies, look-alikes, screenshots, dark shots) | `2026-11-13-gallery-cleanup-design.md` |
| 3 | Quick edits (palette, auto-enhance, cut-out, upscale) | `2026-11-13-quick-edits-design.md` |
| 4 | Heavy edits (object eraser, background blur, face fix) | `2026-11-13-heavy-edits-design.md` |

- Fixed rule from the owner: **nothing is deleted without their approval.**
- The owner handed the design calls to me ("no more questions"). Everything marked
  "(my call)" is unconfirmed.

Platform (my call, the owner said "nothing wrong" to it): **Android phone only.** The two
features with no model (palette, auto-enhance) live in the shared engine, so the Mac app gets
them for free. Every model-based tool is hidden on the Mac.

Not possible on this phone, so not designed: generative fill, "expand the photo", reimagine and
AI styles. They need diffusion models; Model Host Phase 0 measured 74–151 s just to read one
image with a 1–2B model here.

## The phone

Redmi Note 14 Pro 4G: Helio G100-Ultra, 2× Cortex-A76 at 2.2 GHz plus 6× A55 at 2.0 GHz, Mali-G57
MC2 GPU, about 4.3–4.6 GB of free RAM (measured in Model Host Phase 0). There's no usable
AI chip, and NNAPI is deprecated, so **every model runs on the CPU's two fast cores.** The
nearest published CPU benchmark (ncnn on a Snapdragon 765G, same 2× A76 + 6× A55 layout) has
the GPU 2–4× slower than the CPU for small vision models.

## Shared foundation (built once, in feature 1)

### Runtime: ONNX Runtime for Android (my call; a new dependency, needs the owner's yes)

`com.microsoft.onnxruntime:onnxruntime-android`: MIT, Maven Central, Java API, no Google
services, and it runs every model below as an `.onnx` file with no conversion. ncnn (BSD-3) is
faster on ARM, but it needs per-model conversion and our own JNI. It's the upgrade path for
any model that misses its speed bar. Excluded: LiteRT 2.x and ML Kit (Play dependencies), and
MediaPipe Tasks until its POM is checked.

### Where code goes (repo pattern)

- Kotlin owns all image and model work, in `apps/design-editor-mobile/modules/design-media`
  under a new `vision/` package. Pure logic (tokenizer, pre- and post-processing maths,
  scoring, grouping, tiling) goes in `core/` with JVM tests that compare against a Python
  reference.
- React Native only renders, with `@apps-hub/ui` and brand `design`.
- The editor (WebView, `packages/design-editor-engine`) reaches Kotlin through the existing
  bridge (`window.native` in `shell-mobile.js` ↔ `src/editor/bridge.ts`). Images pass as
  files, not base64, because the bridge stalls around 40 MB (SPEC §14.3).
- Long work (indexing, clean-up scans) runs as jobs in the existing `MediaJobService` queue, so
  it shows in the Queue tab and survives leaving the app.

### Model manager (my call)

Models are **downloaded on a tool's first use, not bundled.** Together they are about 400 MB,
and bundling would make every app update that big. Each model is fetched once from a pinned URL
(a Hugging Face revision hash) and checked against a SHA-256 in the code. It's stored in
`noBackupFilesDir`, and after that the tool works offline. The UI says plainly what it's
fetching ("Getting the search tool, 216 MB") and offers Cancel. No photo or user data is ever
sent. If Hugging Face links break, mirror the files to the Store's own bucket. Shortcut: no
delta updates; a model changes only with an app release.

### Back-off (my call)

Background jobs pause when battery is under 20% and not charging, or when
`PowerManager.getCurrentThermalStatus()` is `SEVERE` or higher, and resume later. Edits in the
editor run in the foreground with a progress bar and Cancel.

### Licences

Only Apache-2.0, MIT or BSD weights and code (repo rule). Checked on 2026-11-13 (GitHub licence
API or the HF model card):

| Model | Used for | Licence | Size (ONNX) |
|---|---|---|---|
| CLIP ViT-B/32 (OpenAI) | Search, look-alikes | MIT | 89 MB image (8-bit) + 127 MB text (fp16) |
| U²-Netp | Cut-out | Apache-2.0 (upstream repo) | 4.6 MB |
| MODNet | Cut-out of people (option) | Apache-2.0 (HF card) | 6.6 MB (8-bit) |
| Real-ESRGAN general-x4v3 | Upscale | BSD-3-Clause (upstream repo) | 4.7 MB |
| SlimSAM-77 (SAM family) | Tap to select an object | Apache-2.0 (HF card) | 8.9 + 4.9 MB (8-bit) |
| MI-GAN | Object eraser | MIT (upstream repo) | 28.1 MB |
| Depth Anything V2 Small | Background blur | Apache-2.0 (upstream; Base/Large are CC-BY-NC) | 27.3 MB (8-bit) |
| YuNet | Find faces | MIT (OpenCV Zoo) | 0.2 MB |
| GFPGAN v1.4 | Face fix | Apache-2.0 except listed third-party parts (check those) | not verified |

Excluded: Ultralytics YOLO and FastSAM (AGPL); `onnx-community/ISNet-ONNX` (labelled AGPL,
although upstream DIS is Apache, so export it ourselves if it's ever wanted); MobileCLIP 2
(Apple, research only); InsightFace packs (research only); CodeFormer (S-Lab, non-commercial).

### Measuring

No phone timing exists yet for any of these models. Each feature starts with a Phase 0 that
times its models on the phone over adb, from `/data/local/tmp`, with no app install. That
needs a coord device claim and the owner's yes. Estimates in the designs are marked "est.".

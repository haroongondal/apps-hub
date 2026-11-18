# Quick edits, Phase 0 (phone spike) Implementation Plan

> **Execution:** the owner's rule replaces `superpowers:subagent-driven-development` with
> `cd-engineering-tools:parallel-agents-coord` (phase agent as controller, ledger in
> `.superpowers/sdd/2026-11-17-image-tools-3.0/progress.md`). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Time U²-Netp (cut-out) and Real-ESRGAN general-x4v3 (upscale) on the owner's phone,
judge cut-out edges on 10 public photos, pin each model's source, and leave Python references
that Phase 3.2's Kotlin JVM tests compare against. No app change.

**Architecture:** Same as photo-search Phase 0 (`tools/photo-bench/`). The Mac does everything
but inference: model download/export, preprocessing, tiling, mask maths, reference outputs and
the contact sheet (Python, onnxruntime 1.32.0). A small C++ binary built with the NDK against
the AAR's own `libonnxruntime.so` runs fixed-shape tensors on the phone from
`/data/local/tmp/it` and reports median time and peak RAM.

**Tech Stack:** Python 3 venv (numpy 2.5.4, onnxruntime 1.32.0, pillow 13.0.0; torch only in a
separate scratch venv for the Real-ESRGAN export); C++17, NDK 27.1.12297006, ORT C++ API from
`onnxruntime-android-1.32.0.aar`; adb over USB.

**Spec:** `docs/superpowers/specs/2026-11-13-quick-edits-design.md` (Phases → 0), overview
`2026-11-13-image-tools-overview.md`. Handoffs: `docs/handoffs/image-tools.md`,
`docs/handoffs/photo-search.md` (phone and ORT facts, licences; not re-measured).

## Global Constraints

- Pass bars: cut-out ≤ 2 s (preprocess + U²-Netp at 320×320 + mask upscale and feather);
  4× upscale of a 1080 px photo ≤ 30 s (128 px tiles with overlap, 2 threads on A76).
- Weights Apache-2.0, MIT or BSD only. Not `onnx-community/ISNet-ONNX` (AGPL tag).
- Every model used: pinned URL (HF URL with a revision commit hash, or a GitHub release asset),
  SHA-256, byte size, licence of that exact file.
- Phone: `device:49kjmnuwonkffqzh`, claimed by the controller only. Files only in
  `/data/local/tmp/it`, long runs under `nohup`, USB adb, no app install, no `uiautomator dump`.
  Folder removed and claim released right after the measurements. A76 = cpu6, cpu7 (mask `c0`
  for both, `40` for cpu6 alone).
- Downloads (models, photos) are untrusted: each in its own new empty directory in the session
  scratchpad, scripts elsewhere, Python run with `-I`.
- Not in git: model weights, photos, the contact sheet. In git: scripts, small fixtures
  (≤ 3 MB together), this plan, the results note. Pathspec commits, no Claude attribution, no push.

## Inputs already on disk

- AAR unpacked: `/private/tmp/claude-501/-Users-outsentia-Documents-apps-hub/9a4f08c8-052b-45c2-8ffb-5ce240a5ab48/scratchpad/aar/x`
  (`headers/`, `jni/arm64-v8a/libonnxruntime.so`).
- Venv with numpy 2.5.4, onnxruntime 1.32.0, pillow 13.0.0:
  `/private/tmp/claude-501/-Users-outsentia-Documents-apps-hub/0ff8705f-eeac-4ba4-be91-6cdf10464652/scratchpad/venv`.
- `tools/photo-bench/{bench.cpp,build.sh,phone.sh}`: the pattern to copy (do not edit them; feature 1 uses them).

## File map

- `tools/quick-edits-bench/ref.py` — reference maths, importable:
  `u2_prep(img: PIL.Image) -> np.ndarray[1,3,320,320] f32`, `u2_mask(pred: np.ndarray[320,320], w, h, feather_px) -> np.ndarray[h,w] uint8`,
  `cutout(img, mask) -> PIL.Image RGBA`, `tiles(w, h, tile=128, overlap) -> list[(x, y, x0, y0, x1, y1)]`,
  `upscale(sess, img, tile=128, overlap) -> PIL.Image` (split, run, crop the overlap, stitch).
- `tools/quick-edits-bench/export_esrgan.py` — `.pth` → ONNX (only if no clearly licensed ONNX exists).
- `tools/quick-edits-bench/fixtures.py` — writes `packages/media-core/fixtures/quick-edits/`
  (next to `fixtures/photo-search/`, where the Kotlin tests already read fixtures).
- `tools/quick-edits-bench/sheet.py` + `photos.json` (URL, licence, author, kind per photo; no images).
- `tools/quick-edits-bench/{bench.cpp,build.sh,phone.sh}` — phone timing.
- `docs/superpowers/plans/2026-11-17-quick-edits-phase-0-results.md` — results note.

## Review Focus

1. Mask scaling direction: U²-Netp output resized back to the original aspect (not left square), so a
   portrait photo's cut-out is not stretched. `fixtures.py` uses a non-square input (e.g. 300×200).
2. Tile seams: the tiled 4× result must match a whole-image run inside the overlap choice's error
   bound; Task 1 records max and p99 abs difference for each overlap tried.
3. Edge tiles smaller than the fixed tile shape: padded (reflect) to the fixed input size and cropped,
   never run at a new shape (the phone binary uses one shape).
4. Peak RAM on the phone for 4× of 1080 px: model RAM from the bench plus the app-side buffers
   (output 4320 px side, capped to 4096) computed and reported, not guessed.
5. Thermal drift over an 81-tile run: first and last 20 tiles' medians reported with battery temperature.

---

### Task 1: Models, sources and Python references (Mac only)

**Files:** Create `tools/quick-edits-bench/{ref.py,export_esrgan.py,fixtures.py,requirements.txt}`,
`packages/media-core/fixtures/quick-edits/*`.

**Interfaces — Produces:** the functions in the file map; model files in the scratchpad at
`$SP/models/u2netp.onnx` and `$SP/models/realesr-general-x4v3.onnx` (+ MODNet only if Task 2 asks);
fixed tile input shape `1×3×(128+2·overlap)²`, input/output tensor names, the chosen overlap,
and per-model normalisation, all written in the report.

- [ ] Find and download U²-Netp ONNX (candidates: rembg's GitHub release asset `u2netp.onnx`, MIT
  code / Apache upstream weights; or an HF repo with a clear Apache card, pinned by commit). Record URL, SHA-256, bytes, licence.
- [ ] Real-ESRGAN general-x4v3: look for a clearly licensed ONNX first; if none, download
  `realesr-general-x4v3.pth` from the xinntao/Real-ESRGAN GitHub release (BSD-3) and export with
  `export_esrgan.py` (SRVGGNetCompact: num_feat 64, num_conv 32, upscale 4, act prelu; opset 17;
  fixed input shape; torch in a separate scratch venv). Check the export against PyTorch on one tile
  (max abs diff ≤ 1e-4). Record that the exported file needs a hosting decision.
- [ ] Write `ref.py`: U²-Netp prep as rembg does it (resize to 320×320 Lanczos, divide by max,
  ImageNet mean/std, NCHW), output `d1` min-max normalised, mask bilinear-resized to the photo size,
  feather by a Gaussian blur of `feather_px` (pick 1–3 px; report). Upscale: tiles of 128 px with
  overlap on each side, reflect-padded at the borders to the fixed input shape, output crops stitched.
- [ ] Pick the overlap: smallest of 8, 16, 24, 32 whose tiled 4× output on a 256×192 photo differs
  from a whole-image run by ≤ 1/255 at p99 (print max and p99 for each).
- [ ] `fixtures.py`: one fixed small synthetic input per model (seeded, like `photo-bench/fixtures.py`):
  U²-Netp — input PNG 300×200, `u2_input.f32`, `u2_pred.f32` (model output 320×320), `u2_mask.png`
  (scaled + feathered); Real-ESRGAN — input PNG 160×120, the tile list as JSON, `esrgan_out.png`.
  A README says how they were made. Run it twice: identical bytes.
- [ ] Commit the scripts and fixtures (pathspec).

### Task 2: Edge quality contact sheet (Mac only; after Task 1)

**Files:** Create `tools/quick-edits-bench/{sheet.py,photos.json}`. Output (not in git):
`.superpowers/sdd/2026-11-17-image-tools-3.0/contact-sheet.png`.

- [ ] Pick 10 public photos (≥ 4 people, ≥ 3 product, ≥ 2 pet), each under a clear licence
  (Unsplash or Pexels licence, CC0, or a COCO image with CC-BY); record URL, licence, author in `photos.json`.
- [ ] `sheet.py`: `ref.u2_prep` → U²-Netp → `ref.u2_mask` at full size → `ref.cutout`, composited on a
  checkerboard, original beside each cut-out, one PNG.
- [ ] Look at every pair and write a one-line honest verdict per photo (hair, fingers, fur, shadows, holes).
- [ ] If people edges look rough: run MODNet (Apache, pinned HF file; record URL, SHA, size) on the
  people photos and add them as a second row.
- [ ] Commit `sheet.py` and `photos.json`.

### Task 3: Phone timings (after Task 1; the only task that uses the phone)

**Files:** Create `tools/quick-edits-bench/{bench.cpp,build.sh,phone.sh}`.

- [ ] `bench.cpp`: generic `<model> <input.f32> <d0,d1,d2,d3> <threads> <loops> <out.f32>`: 2 warm-ups,
  per-run times, median, p90, first-20 and last-20 medians, `rss_before_session_kb`, `vm_hwm_kb`,
  `model_kb`. Plus a `post` mode that times, in plain C++, a 4000×3000 RGBA area-downscale to 320×320
  (preprocess estimate) and a 320→4000×3000 bilinear mask upscale with a box feather (post estimate).
- [ ] `build.sh` / `phone.sh` modelled on `tools/photo-bench` with folder `/data/local/tmp/it`; long runs under `nohup`.
- [ ] Controller claims the device first. On the phone: U²-Netp 1 thread (mask `40`) and 2 threads
  (`c0`), ≥ 30 runs; Real-ESRGAN fixed tile, 2 threads, a loop count equal to the tile count of a
  1080×1080 photo (81 at 128 px tiles); `post` mode on `40`. Battery level and temperature before and after.
- [ ] Phone outputs for the Task 1 fixtures match the Mac (max abs diff reported) so the numbers are for the right graph.
- [ ] Clean `/data/local/tmp/it`; commit the three files. Report totals: cut-out = pre + model + post;
  upscale = tiles × per-tile (+ load), also for 1080×810 and 1440×1080, and peak RAM (model + app buffers).

### Task 4: Results note

**Files:** Create `docs/superpowers/plans/2026-11-17-quick-edits-phase-0-results.md`.

- [ ] From the Task 1–3 reports: each bar with the number and PASS/MISS, edge verdicts, the contact
  sheet path, the model source table, owner decisions (hosting of an exported model, any licence doubt),
  and the next step for Phase 3.2. Commit it.

# Clean up the gallery, Phase 0 (phone and tuning spike) Implementation Plan

> **Execution:** the owner's rule replaces `superpowers:subagent-driven-development` with
> `cd-engineering-tools:parallel-agents-coord` (phase agent as controller, ledger in
> `.superpowers/sdd/2026-11-18-image-tools-2.0/progress.md`). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Answer whether HyperOS Gallery shows MediaStore-trashed photos, time the three
per-photo scores on the phone, tune the blur threshold and the look-alike cosine on public
licensed sets, and leave Python references for Phase 2.1's JVM tests. No app change.

**Architecture:** The Mac does the maths and the tuning in Python (`tools/gallery-cleanup-bench/`,
reusing `tools/photo-bench/ref.py` for CLIP). The phone runs a Java benchmark dexed with `d8` and
started with `app_process` from `/data/local/tmp/gc` (ART with JIT, the runtime the Kotlin job
uses; closer than C++), plus a shell-only trash check on test images the spike creates.

**Tech Stack:** Python venv (numpy 2.5.4, onnxruntime 1.32.0, Pillow 13.0.0) at
`.superpowers/sdd/2026-11-17-image-tools-3.0/qe-in/venv`; JDK 21 `javac --release 11` +
build-tools 36.0.0 `d8`; adb.

**Spec:** `docs/superpowers/specs/2026-11-13-gallery-cleanup-design.md` (Scope 1-5, How it
works, Phase 0, AC-3, AC-4). Facts not re-measured: `docs/handoffs/photo-search.md`,
`docs/handoffs/image-tools.md`.

## Global Constraints

- AC-4 bar: at the default strictness, >= 85% of the set's blurred photos and <= 10% of its sharp photos flagged.
- AC-3: a photo and its 50% resized copy group (dHash Hamming <= 4, aspect within 2%); two different photos don't.
- Look-alikes: CLIP cosine >= tuned threshold, within 10 minutes. Vectors as the index stores them
  (`quantize()` in `core/PhotoIndex.kt`: int8, 127/norm), image model
  `Xenova/clip-vit-base-patch32` `onnx/vision_model_quantized.onnx` at the revision pinned in `core/ClipModels.kt`.
- Scores: dHash 64-bit from 9x8 grey; brightness mean and spread; sharpness = variance of the
  Laplacian on a grey thumbnail whose longest side is 512 px.
- Datasets: clear licence, source URL and licence recorded; nothing downloaded is committed.
  Each download in its own new empty folder under `.superpowers/sdd/2026-11-18-image-tools-2.0/dl/`,
  scripts elsewhere, Python with `-I`.
- Phone `49kjmnuwonkffqzh`, claimed by the controller only. Files only in `/data/local/tmp/gc`
  and the spike's own `Pictures/ImageToolsSpike`; never touch, trash, move or modify any other
  photo; every test image removed (file and MediaStore row) at the end. Long runs under `nohup`,
  no app install, no `uiautomator dump`. A55 timing on cpu2 (background cpuset 0-3), A76 on cpu6.
- No desktop-app tests. Pathspec commits, no Claude attribution, no push.

## Review Focus

1. Phone thumbnails are not Pillow resizes: the blur threshold must be reported with how
   sensitive it is to the downscale filter (Task 2 scores the set with two filters).
2. A trash command run with a too-broad `--where` would hit the owner's photos: Task 4 updates
   only an explicit id URI whose `relative_path` it has just read back as `Pictures/ImageToolsSpike/`.
3. Plain photos (sky, a wall, a dark room) have a low Laplacian variance without being blurred:
   Task 2 lists how many of the sharp set's misses are low-texture.
4. JIT warm-up: Task 4 reports the median after warm-up and the first-run time.
5. A trashed file is renamed (`.trashed-...`): Task 4's cleanup removes it by id, not by name.

---

### Task 1: Python references and fixtures

**Files:** Create `tools/gallery-cleanup-bench/{ref.py,fixtures.py,requirements.txt}`,
`packages/media-core/fixtures/gallery-cleanup/` (README.md + small inputs/outputs, <= 1 MB).

**Produces (importable from `ref.py`):** `grey(rgb: uint8[h,w,3]) -> uint8[h,w]` (Pillow "L":
`(299 R + 587 G + 114 B)` fixed-point as Pillow does it), `dhash(grey) -> int` (64-bit, 9x8,
bit order documented), `hamming(a, b) -> int`, `brightness(grey) -> (mean, spread)` in 0..1,
`laplacian_var(grey) -> float`, `thumb512(img, filter) -> PIL.Image` (longest side 512, no upscale).
Every recipe exact enough for a Kotlin port to match (integer or float64 steps, border rule,
rounding) and written in the docstring, as `tools/quick-edits-bench/ref.py` does.

- [ ] Fixtures: seeded synthetic greys and RGBs (non-square, odd sizes, flat, noisy, a 50% resize
  pair for AC-3) with every function's output in a JSON; byte-identical across two runs.
- [ ] Self-check in `ref.py`'s `__main__`: the 50% copy is within Hamming 4 of its source; two
  different seeds are not; a Gaussian-blurred image has a lower Laplacian variance.
- [ ] Commit.

### Task 2: Blur threshold (needs Task 1)

**Files:** Create `tools/gallery-cleanup-bench/{blur_tune.py,datasets.md}` (datasets.md: source,
licence, file count, how fetched).

- [ ] Fetch a public blurred/sharp set with a clear licence (CERTH image blur dataset if its
  licence is clear, else another; record why).
- [ ] Score every image with `thumb512` + `laplacian_var` (two downscale filters), print the
  threshold meeting AC-4, a curve (threshold vs % blurred flagged vs % sharp flagged, 10+ points)
  for the strictness slider, and PASS/MISS.
- [ ] Commit the script and datasets.md only.

### Task 3: Look-alike cosine (independent)

**Files:** Create `tools/gallery-cleanup-bench/lookalike_tune.py`, append to `datasets.md`
(coordinate: shared file).

- [ ] Fetch public burst / photo-series sets with a clear licence; download the pinned CLIP vision model.
- [ ] Embed (photo-bench `prep` on a 256 px thumbnail, 1 thread), quantize as `quantize()`, cosine.
  Positives: pairs inside a series; negatives: pairs across series (hard ones from the same
  source/scene kind). Print precision/recall at candidate thresholds (0.80..0.98, step 0.01) and
  the chosen one with its rule.
- [ ] Commit.

### Task 4: Phone timing and trash check (needs Task 1; controller claims the phone first)

**Files:** Create `tools/gallery-cleanup-bench/{Bench.java,build.sh,phone.sh,trash.sh}`.

- [ ] `Bench.java`: the same three scores on a fixed synthetic thumbnail (512x384 RGB), checks
  them against Task 1's fixture values first (exact or documented tolerance), then times each
  score per photo (warm-up, median, p90, first run) on 1 thread.
- [ ] `phone.sh`: push to `/data/local/tmp/gc`, run under `nohup` with `taskset 40` (cpu6) and
  `taskset 4` (cpu2), poll, print, always clean up (trap). Also battery and temperature.
- [ ] `trash.sh`: push 2 spike-made images to `/sdcard/Pictures/ImageToolsSpike/`, scan them in,
  mark one `is_trashed=1` by explicit id URI from the shell if allowed, read it back, then remove
  every test file and row; always cleans up. If the shell cannot trash, say so.
- [ ] Commit; report numbers.

### Task 5: Results note

**Files:** Create `docs/superpowers/plans/2026-11-18-gallery-cleanup-phase-0-results.md`.

- [ ] Numbers from Tasks 2-4 with PASS/MISS, chosen blur threshold and cosine with evidence,
  trash answer, datasets and licences, open items for the owner and for 2.1. Commit.

# Handoff: Find a photo (on-device photo search in Design Editor)

## Resume prompt

Dated 2026-11-16. Work in the worktree
`/Users/outsentia/Documents/apps-hub/.claude/worktrees/photo-search` on branch `photo-search`
(from `origin/main` f618796). Read this file completely first, then the design
`docs/superpowers/specs/2026-11-13-photo-search-design.md` (approved 2026-11-16) and the
Phase 0 plan `docs/superpowers/plans/2026-11-16-photo-search-phase-0.md`. Trust the verified facts below and
don't re-measure them. Follow the handoff contract in `~/.claude/CLAUDE.md` and "How every
session runs" in `docs/build-sessions.md`. Continue from "Current state + exact next step".

## Goal and fixed constraints

- Owner's programme (2026-11-13): paid-app image features, all local. OCR → PDF editor (Scan
  Phase 4, already planned). Everything else → Design Editor. Order chosen by the owner:
  1 Find a photo, 2 Clean up the gallery, 3 quick edits, 4 heavy edits.
- Owner: nothing gets deleted without their approval (Clean up uses the trash and Android's
  own confirmation; recorded here because the index is shared).
- The owner asked for no more questions and handed the design calls to me. Every "(my call)"
  in the design is unconfirmed.
- Repo rules: FOSS only, no Google services (no ML Kit, no LiteRT 2.x); Kotlin owns logic,
  RN renders with `@apps-hub/ui`; new Gradle/npm dependencies need the owner's yes
  (design-editor-media handoff rule); install on the phone through the Store only; claim
  `device:<serial>` with coord before using the phone; commit only when the owner asks.

## Decisions made (with why)

- Model CLIP ViT-B/32 8-bit ONNX (MIT): same quality as SigLIP on the spike set, 4× cheaper,
  smallest (154 MB). SigLIP 2's text half alone is 283 MB. MobileCLIP 2 is research-only.
- Runtime ONNX Runtime Android (MIT): runs the files as is; ncnn is the speed upgrade path.
- Lives in `apps/design-editor-mobile` as a fourth tab; Kotlin in `modules/design-media`;
  indexing is a job in the existing `MediaJobService` queue.
- v1 scope: word search + More like this. People, tags and OCR search are out (design §Scope).
- 2026-11-16 (Phase 0): text half is `onnx/text_model_fp16.onnx` (127.3 MB), image half stays
  `onnx/vision_model_quantized.onnx` (89.1 MB); download 216 MB. Why: the 8-bit text model's
  vectors differ on the phone (see evidence); fp16 matches full precision exactly. Fallback if
  size matters: `text_model_q4f16.onnx` (72.5 MB).
- Queries go to the text model without padding (tokens up to and including the first 49407):
  identical vector (causal attention), ~4× faster than padding to 77.
- 2026-11-17 (Phase 1 plan): models download **in the app's JS** (`expo-file-system/legacy`,
  already a dependency) into `filesDir/models/`, and Kotlin only verifies the SHA-256 and installs
  them. Why: Design Editor's data-safety rule 6 ("media jobs never touch the network", PRD
  NFR-4), which `DataSafetyRulesTest` enforces by banning network code anywhere in
  `design-media`. The download is a separate "Getting the search tool" step, not a queue job.
- Similarity floor starts at 0.25 (true-photo cosine p5 on COCO = 0.255); recheck in Phase 2.
- `tools/photo-bench/` (ref.py, score.py, bench.cpp, build.sh, phone.sh) is the Python/phone
  reference; Phase 1's JVM tests compare tokenizer ids and image tensors with `ref.py` output.

## Evidence already verified (2026-11-13)

- HF file sizes (API): CLIP B/32 8-bit image 89.1 MB + text 64.5 MB; SigLIP base/16 image 99.5
  + text 111.5 MB; SigLIP 2 base/16 image 94.6 + text 283.4 MB; MobileCLIP S0 image 11.8 +
  text 42.8 MB (licence "other", Apple).
- Mac spike (M5, onnxruntime 1.32 CPU, 195 COCO-Karpathy test photos, 976 caption queries;
  script `spike.py` in the session scratchpad, not committed):
  - CLIP B/32: top-1 55.4%, top-5 96.3%, top-10 99.1%; image 28 ms (1 thread), 16 ms (2); text 12 ms.
  - SigLIP base/16 (lowercased text, padded to 64): top-1 51.5%, top-5 96.6%, top-10 98.9%;
    image 111 ms (1), 61 ms (2); text 19 ms.
- Design Editor mobile manifest removes `READ_MEDIA_IMAGES` today (`tools:node="remove"`);
  `allowBackup="false"`. Tabs: Designs, Media, Queue (`app/(tabs)/_layout.tsx`).
- Phone (from Model Host Phase 0): Redmi Note 14 Pro 4G, serial `49kjmnuwonkffqzh`, Helio
  G100-Ultra (2× A76 2.2 GHz + 6× A55 2.0 GHz), MemAvailable 4.3–4.6 GB. Wi-Fi adb copies at
  about 1 MB/s; use USB.

- Phase 0 on the phone (2026-11-16, ORT 1.32.0 AAR, Wi-Fi adb, on battery, 31→34 °C):
  image 8-bit 121 ms (1×A76), 69 ms (2×A76), 478 ms (1×A55); text fp16 unpadded 181 ms median,
  235 p90 (1×A76). Re-run 2026-11-17 with 1,170 photos in a row: image 106 ms (1t), 67 ms (2t),
  last 20 about 15% slower than first 20 (mild throttling); text 176 ms; model RAM (peak minus
  RSS before the session) 111 MB image, 189 MB text. Vectors still match (PASS).
  Phone vs Mac cosine ≥ 0.9998; phone recall@1/5/10 0.731/0.965/0.989 (976 queries). PASS.
  cpusets: foreground 0-7, background 0-3; A76 = cpu6, cpu7.
- 8-bit text model: phone vs Mac cosine 0.71-0.86. Mac ORT_ENABLE_ALL takes a different int8
  kernel path; Mac at BASIC/DISABLE equals the phone at any level, and the Mac-optimized graph
  on the phone still equals the phone. Recall@5 on that path 0.923 (fp32 0.966). Image 8-bit is
  exact on both. Text variants on the Mac: fp32/fp16 0.966, q4f16 0.957, int8 0.927 at BASIC.
- The 2026-11-13 spike's top-1 numbers were low by a ranking bug (matmul row vs separate dot,
  229/976 self-ties): CLIP top-1 is 0.723 (fp32 text 0.732). Top-5/10 were right.
- AAR `onnxruntime-android` 1.32.0: arm64 `libonnxruntime.so` 36.3 MB (13.7 MB gzipped), LOAD
  segments 16 KB aligned, NEEDED only system libs (C++ static), POM has no dependencies.
- Inputs still on disk (tmp, may vanish): models/data/venv in
  `/private/tmp/claude-501/-Users-outsentia-Documents-apps-hub/0ff8705f-eeac-4ba4-be91-6cdf10464652/scratchpad`;
  text variants, AAR and Phase 0 outputs in `.../9a4f08c8-052b-45c2-8ffb-5ce240a5ab48/scratchpad`.

## File map

- Overview (shared runtime, model manager, licences): `docs/superpowers/specs/2026-11-13-image-tools-overview.md`
- Feature designs: `docs/superpowers/specs/2026-11-13-{photo-search,gallery-cleanup,quick-edits,heavy-edits}-design.md`
- App: `apps/design-editor-mobile` (tabs `app/(tabs)/`, module `modules/design-media`)
- Queue service: `modules/design-media/android/.../android/MediaJobService.kt`, `core/JobQueue.kt`

- Licences checked 2026-11-13 (GitHub licence API): MI-GAN MIT, LaMa Apache-2.0, U-2-Net
  Apache-2.0, DIS (IS-Net) Apache-2.0, Real-ESRGAN BSD-3, MobileSAM Apache-2.0, Depth Anything
  V2 Apache-2.0 (Small only), rembg MIT; GFPGAN "NOASSERTION" (LICENSE: Apache-2.0 except listed
  third-party parts). HF cards: `onnx-community/ISNet-ONNX` is tagged AGPL-3.0 (don't use),
  SlimSAM-77 Apache, MODNet Apache, U-2-Netp Apache, depth-anything-v2-small Apache.
- ONNX sizes (HF API): MI-GAN pipeline 28.1 MB; LaMa 208 MB; U-2-Netp 4.6 MB; MODNet 8-bit 6.6 MB;
  SlimSAM-77 8-bit 8.9 + 4.9 MB; Depth Anything V2 Small 8-bit 27.3 MB; YuNet 0.2 MB; SFace 8-bit
  9.9 MB (licence unconfirmed); GFPGAN not checked.
- The editor's current "Remove background" is a colour flood fill from the edges
  (`removeBackground()` / `removeBg()` in `packages/design-editor-engine/app.js`).

## Session log

- 2026-11-13: research (runtimes, models, licences), owner chose scope and order, Mac model
  spike, design drafted. Nothing committed.
- 2026-11-13 (later): owner asked for designs for all features. Wrote the overview plus three
  more designs (clean-up, quick edits, heavy edits). Changed feature 1 to download models on
  first use instead of bundling them (shared model manager). Nothing committed.
- 2026-11-16: owner approved all five designs as drafted (every "(my call)" now stands),
  said yes to `com.microsoft.onnxruntime:onnxruntime-android` (after the AAR size / 16 KB /
  no-Play checks), and gave phone time for Phase 0 now. `origin/main` still f618796.
- 2026-11-16: wrote and ran the Phase 0 plan. PASS, with the text half switched to fp16 (see
  decisions). Phone cleaned (`/data/local/tmp/pb` removed), device claim released. Design and
  overview updated with the numbers. Nothing committed.

- 2026-11-16 (later): final review (fresh reviewer) found two measurement gaps: the image RAM
  figure includes the input buffer, and the drift check covers only 13–24 s. bench.cpp now
  reads the input in one exact allocation, prints `rss_before_session_kb` and
  `model_kb = VmHWM − that`, and takes `CLIP_BENCH_LOOPS=N` (repeat the input N times; outputs
  from the first pass). Re-run started, but Wi-Fi adb dropped mid-run and the phone vanished
  from adb and mDNS (adb server restarted, no luck). Claim released. **Files left on the phone
  in `/data/local/tmp/pb` (~370 MB): run `phone.sh clean` first thing.** Docs corrected to
  claim only what the first runs support.

- 2026-11-17: phone back (owner reconnected it; adb server restart + wait brought it online).
  Ran the re-measure under `nohup` on the phone so a Wi-Fi drop cannot kill it. Both open
  numbers closed (see evidence). Phone cleaned, claim released. Wrote the Phase 1 plan
  `docs/superpowers/plans/2026-11-17-photo-search-phase-1.md` (8 tasks). Nothing committed.

- 2026-11-17: owner said go, with the cd-engineering-tools parallel-agents-coord skill. Phase 0
  committed as base c7adcb5 (local only). Phase 1 run with parallel subagents (filelock run key
  `gradle`, pathspec commits): Tasks 1-8 done, 14 commits up to 7137cd3; Task 6 reviewed + one
  fix round; final whole-branch review + one fix pass (7137cd3) + scoped re-review. Ledger with
  every ruling: `.superpowers/sdd/2026-11-17-photo-search-phase-1/progress.md` (git-ignored).
  Gates from a clean export: pnpm test, typecheck, Kotlin 170/0, assembleDebug, APK has
  libonnxruntime.so 16 KB aligned + clip/tokenizer.json, expo-doctor OK. Nothing on a device.

## Phase 1 facts for Phase 2 (verified in code/tests)

- JS API (`modules/design-media/src/index.ts`): `photoModels`, `installPhotoModel`,
  `startPhotoIndex`, `photoIndexState`, `searchPhotos`, `similarPhotos`, `releasePhotoSearch`;
  download step `getSearchTool` in `apps/design-editor-mobile/src/photos/search-tool.ts` returns
  'ready' | 'no-room' | 'bad-download' | 'offline' (plain-word messages belong to the screen).
- Deferred to Phase 2 (from reviews): the Queue row for a photo-index job says "Saved" and its
  "Try again" is broken (`src/media/status.ts`, `JobRow.tsx`); `jobToAdd` ignores PAUSED and
  INTERRUPTED photo jobs (second row after Resume); two quick `startPhotoIndex` calls can add two
  rows; back-off keeps the job RUNNING (blocks the queue, counts toward the 6 h mediaProcessing
  limit) so the screen must say why it is paused; stale comment `ClipSessions.kt:13`.
- Not verified anywhere yet: ORT input/output names against the real model files in-app, the
  fp16 text output read through `floatBuffer`, `loadThumbnail` pixels on the phone.

## Current state + exact next step

Phase 2 (Photos tab) is built and committed on `photo-search` (local, not pushed; 88b0e24..b7b4040
on top of the plan 2e68638). Run with the parallel-agents-coord skill; ledger with every ruling:
`.superpowers/sdd/2026-11-17-photo-search-phase-2/progress.md`. Gates green from a clean export
(app TS 36/0 after the fix pass, typecheck, `expo export --platform android` bundles the screen,
Kotlin 175/0, assembleDebug). expo-doctor's one failure ("app config fields in a non-CNG
project") is pre-existing on main. Nothing has run on a phone.

Open, waiting for the owner:
1. Residual review findings (no second fix wave was run): Important — after "Change" → allow all,
   two scan rows can appear (the app-return listener and the permission answer both start one;
   the service does not dedupe). Root fix: drop a photo scan in `MediaJobService.enqueue` / the
   `Enqueue` reducer when one is QUEUED or RUNNING (reuse `jobToAdd`); it also closes the double
   tap on Scan now / Try again. Minors: `inFlight` chain keeps old results; 'some' access with
   photos added in Settings isn't rescanned; a failed More like this shows the old grid; the
   scan decision in photos.tsx:64-68 has no test.
2. Release go: merge with `[skip ci]`, then `pnpm release` locally (memory), Store release id
   `design-editor`.
3. AC-2 on the phone needs the 195 COCO photos copied into the gallery and removed afterwards;
   ask before doing it.
Next step after the owner answers: one small fix pass for item 1 if they say so, then Task 5 of
the Phase 2 plan (install from the Store, walk the tab, AC-1..AC-6).

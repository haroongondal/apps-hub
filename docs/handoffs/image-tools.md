# Handoff: Design Editor image tools (features 2-4)

## Resume prompt

Dated 2026-11-17. Work in the worktree
`/Users/outsentia/Documents/apps-hub/.claude/worktrees/image-tools` on branch `image-tools`
(local only). Read this file completely first, then the designs it names. Trust the verified
facts below and don't re-measure them. Follow the handoff contract in `~/.claude/CLAUDE.md`
and "How every session runs" in `docs/build-sessions.md`. Run phases with
`cd-engineering-tools:phased-orchestration` (one phase agent per phase, ledgers under
`.superpowers/sdd/`). Continue from "Current state + exact next step".

## Goal and fixed constraints

- Build features 2-4 of the image-tools programme in Design Editor mobile: 2 Clean up the
  gallery, 3 Quick edits, 4 Heavy edits. Designs (approved 2026-11-16, owner re-approved
  2026-11-17): `docs/superpowers/specs/2026-11-13-{image-tools-overview,gallery-cleanup-design,quick-edits-design,heavy-edits-design}.md`.
  Where the overview and `docs/handoffs/photo-search.md` disagree, the handoff wins.
- The owner's go (2026-11-17) covers plan, build and commit on `image-tools`. Pushing,
  merging, Store releases and installs need the owner's word each time.
- Stop and report to the owner: where a design says the owner judges, at any spike result
  that misses its bar, before each release.
- Weights and code: Apache-2.0, MIT or BSD only. Excluded: Ultralytics/AGPL,
  onnx-community/ISNet-ONNX, MobileCLIP, InsightFace packs, CodeFormer.
- ONNX Runtime Android 1.32.0 is already in. Any new Gradle or npm dependency needs the owner's yes.
- Kotlin owns all image and model work (pure maths in `core/`, JVM tests against a Python
  reference in `tools/photo-bench` style). RN only renders (`@apps-hub/ui`, brand `design`,
  sentence case, plain words).
- Models download in the app's JS (pinned URL + SHA-256, the pattern in
  `apps/design-editor-mobile/src/photos/search-tool.ts`); Kotlin only verifies and installs.
  `design-media` never touches the network (`DataSafetyRulesTest`, PRD NFR-4).
- Nothing deleted unless the owner ticked it and confirmed Android's dialog; trash only; no
  gallery file is ever edited.
- Images cross the WebView bridge as file paths, never base64 (stalls around 40 MB).
- Mac shows palette and auto-enhance only; model tools hidden where `window.native.vision` is missing.
- Phone: claim `device:49kjmnuwonkffqzh` with coord, release when done. Benchmarks from
  `/data/local/tmp` (`tools/photo-bench/phone.sh`). Install apps only through the Store.
  Never run `uiautomator dump`. No Claude attribution lines in commits or PRs.
- Never edit the `photo-search` worktree (another session owns it).

## Decisions made (with why)

- 2026-11-17: base is `photo-search` commit `9e13c3d` (Phase 1 done), not origin/main. Why:
  feature 1 Phase 2 (Photos tab) is still being built by another session; the four specs, ORT
  1.32.0 and `search-tool.ts` exist only on `photo-search`. Owner chose to start with feature 3
  ("go with feature 3"). Feature 2 waits until Phase 2 lands; then merge/rebase onto it.
- 2026-11-17: 3.0 (phone spike) and 3.1 (palette + auto-enhance, engine only) run at the same
  time: no shared files, and 3.1 needs no phone. 3.2 waits for 3.0's numbers.

## Evidence already verified

- From `docs/handoffs/photo-search.md` (don't redo): phone numbers, ORT AAR facts, licences
  (U-2-Net Apache-2.0, Real-ESRGAN BSD-3, MODNet Apache), sizes (U-2-Netp 4.6 MB, MODNet
  8-bit 6.6 MB), cpusets (A76 = cpu6, cpu7), use USB adb (Wi-Fi ~1 MB/s and drops; run long
  phone jobs under `nohup`).
- The mobile editor page has an offline CSP (`default-src 'none'`; images from data:/blob:
  only), SPEC §14.1. A file path from Kotlin must reach Fabric through the shell's existing
  file-loading route, not a `file://` URL.
- `packages/design-editor-engine` has no `test` script; engine behaviour is covered by
  `pnpm --filter design-editor test:e2e`.

## File map

- Designs: see above. Session rules: `docs/build-sessions.md` "How every session runs".
- Engine: `packages/design-editor-engine/{app.js,shell-mobile.js,build.mjs}`; current
  "Remove background" is `removeBackground()` / `removeBg()` in `app.js`.
- Mobile bridge: `apps/design-editor-mobile/src/editor/bridge.ts`.
- Kotlin: `apps/design-editor-mobile/modules/design-media/android/.../{core,android}/`;
  CLIP work from feature 1 under `vision/`-style files (`ClipSessions.kt`).
- Model download pattern: `apps/design-editor-mobile/src/photos/search-tool.ts`.
- Bench: `tools/photo-bench/` (ref.py, bench.cpp, build.sh, phone.sh).
- Phase ledgers (git-ignored): `.superpowers/sdd/2026-11-17-image-tools-<phase>/`.

## Session log

- 2026-11-17: feature 1 Phase 2 not finished (another session). Owner said go with feature 3.
  Worktree created from `9e13c3d`, `pnpm install` done. Handoff written. Phase agents for 3.0
  and 3.1 started.
- 2026-11-17 (later): the session ended mid-run. Landed: 3.0 plan f50b7ae + phone bench
  5be0796; 3.1 plan cae845f + palette/enhance maths e694a5f (11/11 node tests). 3.1 rulings:
  swatch on an image sets the page background; brand kit exists (brand.colors); auto-enhance
  sets Brightness and Contrast only (no white-balance or saturation control exists; gap for
  the owner). Phone was off adb. Both phase agents resumed from their ledgers.

## Current state + exact next step

3.0 (phone spike) and 3.1 (palette + auto-enhance) running as phase agents. Next: read their
reports; if 3.0 passes, start 3.2 (cut-out and upscale); if it misses a bar, stop and report to
the owner. Feature 2 waits for `photo-search` Phase 2.

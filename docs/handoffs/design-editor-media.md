# Handoff: Design Editor media tools and the mobile Design Editor

## Resume prompt

Dated 2026-10-31. Read `docs/handoffs/design-editor-media.md` completely first, then
`docs/design-editor/PRD.md` and `docs/design-editor/SPEC.md`; read `docs/design-editor/RESEARCH.md`
sections as a step cites them. Trust the decisions and verified facts below and don't re-research
or re-derive them. Follow the handoff contract in `~/.claude/CLAUDE.md` (keep this file's session
log, evidence and next step current; hand off before context runs out). Read "Current state +
exact next step" before doing anything, then continue from it. Commit, push or release only when
the owner says so; install on the phone only through the Store, never `adb install`.

## Goal and fixed constraints

- Media tools (compress to a target size, compress by quality, lossless and exact clip, audio
  track extraction, video to GIF, convert, a batch queue that runs in the background) inside
  **Design Editor**: the existing Mac Electron app and a new Android app.
- Android app: `apps/design-editor-mobile`, package `com.haroon.designeditor`, release id
  `design-editor`, brand `design`. The canvas is the Mac editor page moved into
  `packages/design-editor-engine` and run in a WebView (PDF Editor pattern). Media screens are
  React Native screens beside the WebView; media bytes never cross a bridge (the base64 bridge
  stalls at about 40 MB).
- Shared pure-TS package `packages/media-core` (job model, validation, target-size budget, retry
  rule, presets, names, FFmpeg argument builders), tested with `node --test`.
- Repo rules (AGENTS.md): Expo SDK 54 / RN 0.81.5, erasable TS with `.ts` imports, `@apps-hub/ui`
  only, native code in Expo local modules with Gradle JVM tests, FOSS only, no telemetry, new
  dependencies need the owner's approval.
- Android first, private Store only. iOS last and optional (no paid Apple account).
- Out of scope for v1: a video timeline in the canvas, exporting designs as MP4.

## Decisions made (with why)

Owner, 2026-10-30:
- **Host = Design Editor**, not a standalone app (owner prefers merging). Scanner and Reader go to
  PDF Editor separately.
- **Platforms = Mac and a new Android Design Editor** ("Phone too, as a mobile Design Editor").

Owner answers, 2026-10-31 (session S0; shared answers are also in `docs/pdf-editor/MERGE.md`):
- **Q1 default codec:** H.264, with HEVC one tap away and remembered, as recommended.
- **Q2 FFmpeg on the Mac:** the pinned Martin Riedl 9.0.2 static download (GPL, x264), as
  recommended. It stays on the owner's Mac (gitignored).
- **Q3 email preset:** 18 MB, as recommended; the Gmail check in Phase 4 still runs.
- **Q4 WhatsApp preset: 16 MB, added now.** This departs from the recommendation to leave it
  out. 16 MB is the most conservative published figure; Phase 4 does one real send and the
  owner may raise it. Changed: PRD FR-3, SPEC §5.2 presets row and §17 Phase 4 row, PROMPTS
  Phase 4.
- **Q5 minimum Android:** 15 (minSdk 35), as recommended.
- **Q6 mobile canvas scope:** full parity with the Mac, as recommended.
- **Q7 clip preview:** a thumbnail strip plus "Preview in player"; no `expo-video`, as
  recommended.
- **Q8 ABIs:** arm64 only, as recommended (the same answer as the PDF Editor).
  `reactNativeArchitectures=arm64-v8a` in SPEC §15 and PROMPTS Phase 1.
- **Q9 icon: one new mark for both apps.** The docs assumed the Mac app had a mark to reuse;
  it has none (it ships Electron's default; checked on `main` and `design-editor-phase-2`).
  Phase 1 draws `apps/design-editor-mobile/assets/icon.svg` and renders the Android icon;
  Phase 2 builds the Mac `.icns` from it. Changed: SPEC §13.3, PROMPTS Phases 1 and 2.
- **Q10 metadata:** drop location by default, as recommended.
- **Dependencies approved (SPEC §3):** Media3 1.11.1 (transformer, effect, common, inspector);
  the gifenc 1.0.3 port to Kotlin (MIT notice kept); FFmpeg + FFprobe 9.0.2 static for the
  Mac; and the ones already in the repo (kotlinx-serialization-json 1.8.1,
  expo-document-picker ~14.0.8, react-native-webview 13.15.0, expo-router and the PDF
  Editor's other Expo modules). `expo-video` is not added (Q7).

Research and docs session (Claude's recommendations, owner can override; PRD §10 lists the open
questions):
- **Android engine: Media3 Transformer 1.11.1 + `MediaExtractor`/`MediaMuxer` + a Kotlin GIF
  encoder ported from gifenc (MIT); no FFmpeg in v1.** Why: ffmpeg-kit is retired (archived
  2026-07-02, binaries pulled around 2025-04-01); an own FFmpeg adds 15–30 MB per ABI and a Nix
  build, and uses the same hardware encoders, so it wouldn't fix accuracy.
- **Mac engine: pinned static FFmpeg + FFprobe 9.0.2 (Martin Riedl build) from the main process;
  libx264 two-pass for target size, VideoToolbox otherwise.** Why: two-pass hits the bitrate
  within about 0.1% on the one published test vs about +20% for one pass; GPL is fine while the
  binary stays on the owner's Mac (gitignored, never shared). Pending PRD Q2.
- **Target size = encode, measure, retry (≤ 3), never deliver above the target**, with margins
  0.90 (hardware) / 0.97 (x264), overhead 64 KiB + 1%, ladder floors hw-h264 0.05, hw-hevc 0.035,
  x264 0.04 bpp (assumed, tuned in Phase 1), and a per-encoder correction factor. Why: MediaTek
  phones overshoot and Compressor's issues show one pass misses.
- **VBR first on the phone, CBR once as a fallback.** Why: CBR stalled on a MediaTek encoder
  (Compressor #80).
- **minSdk 35.** Why: one FGS type (`mediaProcessing`) and `onTimeout`; the phone runs 16 (PRD Q5).
- **Inputs via `expo-document-picker` with `copyToCacheDirectory: false`.** Why: no copy, video and
  audio, already in the workspace; expo-image-picker copies videos into the cache.
- **Plain foreground service, not WorkManager.** Why: transcodes can't resume mid-file and an FGS
  can't start from the background anyway; Deputy's `RunService` pattern.
- **Presets in decimal MB: Discord 20, Discord Nitro Basic 50, Email 18.** Why: Discord is 20 MB
  since 2026-08-13; email base64 overhead (pending the Gmail check, PRD Q3).
- **No new app name.** "SnapCompress" collides (snapcompress.io and others); the feature is
  "Media tools".
- **Phase order:** 1 media-core + Android encoder spike (minimal Store-installable shell), 2 Mac
  media tools, 3 engine extraction + mobile canvas, 4 Android media screens, 5 queue and
  background, 6 iOS (optional).

## Evidence / facts already verified

On this Mac or in the repo (2026-10-30/31):
- Electron 44.8.0 = Node 24.22.0, Chrome 152.0.7977.167, `process.features.typescript` = "strip".
  **Its main process imports erasable `.ts` directly and through a symlinked package** (scratch
  app printed the right result both ways). No build step for `media-core` on the Mac.
- `@electron/packager` 20.3.0 dereferences symlinks by default (`dist/platform.js:178`); Design
  Editor's `dist` ignores `node_modules`, so use `vendor/media-core` and `vendor/engine` symlinks
  like `vendor/ui`.
- Design Editor: `main.js` 104 lines with the `granted` set (`save-file`, `open-design`);
  preload exposes six functions; CSP has no `media-src`; panels templates/elements/text/uploads/
  brand/resize; image uploads use `<input type="file" id="imgFile">` (`index.html:151`).
- `react-native-webview` 13.15.0 implements `onShowFileChooser`, so WebView file inputs work.
- Fabric.js 7.4.0 vendored: touch select/drag present, no pinch handling.
- PDF engine README line 93: the base64 bridge stalls at roughly 40 MB.
- `android.jar` 36: `FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING`=8192, `Service.onTimeout(int,int)`,
  `MediaMuxer.OutputFormat` MP4/WEBM/3GPP/HEIF/OGG, bitrate modes CQ/VBR/CBR/CBR_FD,
  `FEATURE_HdrEditing`, `MediaStore.IS_PENDING`/`RELATIVE_PATH`, `FOREGROUND_SERVICE_MEDIA_PROCESSING`.
- AOSP `MediaMuxer.java`: MP4 takes AAC, AMR, H.263, MPEG-4, AVC, HEVC, AV1, Dolby Vision; WebM
  takes Vorbis, VP8, VP9, Opus; Ogg takes Opus; multiple tracks only in MP4 (API 26+).
- expo-image-picker 17.0.11 copies picked videos into the cache (`MediaHandler.kt:101-102`);
  expo-document-picker 14.0.8 uses `ACTION_OPEN_DOCUMENT` and skips the copy when asked.
- Media3 1.11.1 transformer/effect/muxer/inspector exist on Google Maven; the transformer's Media3
  AARs total 4.49 MB; licence Apache-2.0.
- Release APKs today: PDF Editor 83.4 MB, Deputy 67.8, NetLens 64.8, Store 58.8, OpenTunnel 46.5.
- The phone: model 24116RACCG, Android 16, HyperOS OS3.0 (from the Deputy handoff).

From sources (details and links in RESEARCH):
- Phone SoC Helio G100 Ultra: encode H.264/HEVC, decode H.264/HEVC/VP9, FHD60; no AV1.
- Mac here: Apple M5 (H.264/HEVC/ProRes encode, AV1 decode only), macOS 27.0.1.
- `mediaProcessing`/`dataSync` FGS: 6 h per 24 h, reset when the user opens the app.
- Discord free 20 MB (2026-08-13); Gmail 25 MB; Outlook.com 25 MB; Telegram 2 GB; WhatsApp unclear.
- Compressor (MIT): VBR on MediaTek (#80 fix), overshoot (#49), open retry request (#121).
- FFShare (GPL): FFmpegKitNext 8.1.1 via Nix, 76.7 MB universal APK; 19–29 MB per-ABI earlier.
- videotoolboxenc: `-b:v` average, `-maxrate` 1 s window, `-q:v` arm64 only, no two-pass.
- Premiere Rush discontinued (support ended 2026-09-30); Canva free asks to upgrade to change MP4
  quality.

## File map

- `docs/design-editor/RESEARCH.md`: findings, verdicts, verified vs assumed, sources.
- `docs/design-editor/PRD.md`: FR-1..FR-12, NFR-1..NFR-9, six data-safety rules, AC-1..AC-14,
  open questions Q1..Q10.
- `docs/design-editor/SPEC.md`: stack, layout, dependencies, contracts (preload, Kotlin, Swift),
  queue, pipelines, target-size algorithm with worked numbers, background, UI, engine extraction,
  release, testing, phases, spikes S1..S8.
- `docs/design-editor/PROMPTS.md`: prelude + Phase 1..6 prompts with verification commands.
- Code to come: `packages/media-core`, `packages/design-editor-engine`, `apps/design-editor`
  (`media.js`, `media.html`, `scripts/fetch-ffmpeg.mjs`), `apps/design-editor-mobile`
  (`modules/design-media`), `tools/release/src/apps.ts`, the Store's `<queries>`.
- Research scratch notes (not in the repo, may be gone):
  `/private/tmp/claude-501/-Users-outsentia-Documents-apps-hub/73fd9f91-fb79-4c73-bea1-6e4165d4b657/scratchpad/media-research-notes.md`.

## Session log

- **Session 1 (2026-10-30/31, research and docs).** Researched the standalone "SnapCompress" idea
  (FFmpeg on mobile, Media3, MediaMuxer, target size, GIF, background limits, picker and storage,
  market, name). Mid-session the owner moved the tools into Design Editor, then chose Mac + a new
  Android Design Editor; added desktop research (FFmpeg packaging, VideoToolbox, two-pass x264,
  Electron TS loading, packager symlinks, engine pattern). Wrote RESEARCH, PRD, SPEC, PROMPTS and
  this handoff. No code, installs, builds or commits.
- **2026-10-31 (coordinating session).** PRD Q8 now recommends arm64 only, to match the
  PDF Editor. Each app sets `reactNativeArchitectures` in its own `gradle.properties`, so the
  Store pipeline doesn't constrain it. Cross-app context is in `docs/pdf-editor/MERGE.md`.
  Found the unmerged multi-page branch `design-editor-phase-2` (see "Current state").
  Build session prompts for all three features are in `docs/build-sessions.md`.
- **2026-10-31 (session S0).** The owner answered PRD Q1–Q10 and approved the dependencies
  (see "Decisions made"). Docs updated for the WhatsApp 16 MB preset, arm64 only and one new
  icon for both apps. The docs went to `main` through a PR from branch `docs-offline-tools`.

## Current state + exact next step

- State: docs written; nothing scaffolded; branch `deputy-speed` has unrelated uncommitted Deputy
  work, so start this work on its own branch from `main`.
- **Unmerged Design Editor work exists (found 2026-10-31).** Branch `design-editor-phase-2`
  (2026-10-28, handoff `docs/handoffs/design-editor-phase-2.md` on that branch) adds multi-page
  designs (file format v2), bundled fonts and real PDF text. It is e2e green and waits for the
  owner's hand check. These media docs were written against the single-page editor on `main`.
  Phase 1 doesn't touch `apps/design-editor`. Phase 2 (Mac media window) and Phase 3 (engine
  extraction) must start after that branch is merged, and Phase 3 must extract the multi-page
  editor. Use `design-media-phase-<n>` branch names to avoid the clash.
- **Owner answers recorded** (S0, 2026-10-31; see "Decisions made").
- **Next step:** once the S0 docs PR (branch `docs-offline-tools`) is merged, run session B1
  (Phase 1) on branch `design-media-phase-1`, and B0 (ship the multi-page branch) whenever the
  owner is ready. B0 and B1 must both be merged before B2.

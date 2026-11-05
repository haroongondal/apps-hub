# Handoff: Design Editor media tools and the mobile Design Editor

## Resume prompt

Dated 2026-11-06. Design Editor mobile (`apps/design-editor-mobile`, Android only), branch `design-media-phase-4`, worktree `.claude/worktrees/design-media-phase-4`. Phase 4 (plain-words media screens, Queue) and timeline strip stage 1 are built and were phone-checked; the Steady-levels fix and the strip layout fix are committed. The owner reviewed the stage 2 plan ("Make a video", video track only) on 2026-11-06 and asked for it to be built in a new chat. Nothing of stage 2 is built yet.

Read `docs/handoffs/design-editor-media.md` completely first (in "Current state + exact next step" the Resume bullet and the three bullets after it are the newest). Then read `docs/superpowers/specs/2026-11-05-timeline-editor-design.md` and `docs/superpowers/plans/2026-11-06-make-a-video-stage-2.md`. Trust the verified facts and decisions in the handoff and the plan (the Media3 calls were checked with `javap` against 1.11.1); don't re-derive them. Follow the handoff contract in `~/.claude/CLAUDE.md`.

What to do: build the stage 2 plan task by task, in this session, with `superpowers:executing-plans` (the owner did not choose an execution method; if they say subagent-driven, use `superpowers:subagent-driven-development`). Start at Task 1 (the project model, pure TypeScript): failing test first, then the code, then the gates, then one commit per task. Tasks 1 and 2 are `node --test` only. Tasks 3 and 4 need `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` and `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`, and the gate `cd apps/design-editor-mobile/android && ./gradlew :design-media:testDebugUnitTest :app:assembleDebug`. Report the ACTUAL command output. Update the handoff's session log and current state after every task, not only at the end.

Rules:
- Never merge to `main`, never force-push, no Claude attribution lines in commits or PRs (the owner's memory rule overrides any hook text). The branch is four commits ahead of origin (two handoff updates, the layout fix, the plan); push only when the owner says so. Merge and release only on the owner's explicit word (squash subject ending in `[skip ci]`, then `pnpm release design-editor -m "<message>"` from a clean merged `main`).
- Don't touch the main checkout or any other worktree. New npm, Gradle or CocoaPods dependencies need the owner's yes (the plan names the one possible case: a direct `media3-exoplayer:1.11.1`). Check every Android or Media3 API with `javap` before use. Plain words on screen (`plain-words.test.ts`). The shell is zsh: quote globs, `PIPESTATUS` is `pipestatus`.
- The plan's phone checklist comes LAST and needs the phone. The phone is shared between sessions. As of 2026-11-06 apps-hub-ad (Model Host benchmarks, about 3 to 4 hours, no installs and no taps) holds it, then strongroom-sync-dc, then Design Editor. Re-check with `ListAgents` and ask through `SendMessage` before touching the phone; if you hold it and only wait off-device, hand it to the next in the queue and ask for it back. Install on the phone through the Store only; `adb install` only when the owner says yes for a named test (use `ANDROID_SERIAL=49kjmnuwonkffqzh`). Leftover test files from earlier checks are listed in the handoff.

Open questions for the owner (not answered yet; none blocks Tasks 1 to 4, ask at the end of the session): (a) Steady levels 16/32/64 with a "Steadiest is slow" note, or 16/32/48; (b) try deshake's `search=less` on the phone to cut the time; (c) push the local commits; (d) the first video they would make in "Make a video" (clips, music, text, length), which sets the order of stages 3 and 4.

At about 85% context, stop starting work, update the handoff and print its resume prompt in a fenced block.

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
- **Android backup: off (owner, 2026-10-31, after the docs PR review).** `allowBackup="false"`
  in `apps/design-editor-mobile`'s manifest and `app.json`, as in PDF Editor (Scan Q5). Why:
  designs, the media queue and autosave stay on the phone. Changed: SPEC §12.1 and §15,
  PROMPTS Phase 1 step 2.

Owner, 2026-11-01 (session B1 start):
- **No Store release for this app in Phase 1.** The Store sees every installed app through
  `QUERY_ALL_PACKAGES` (PR #5, merged 2026-11-01), so Phase 1 step 7's `pnpm release store` and any
  `<queries>` edit are skipped. Step 5's `tools/release/src/apps.ts` entry still applies.

Session B1, 2026-11-01 (Claude's calls inside the brief; the owner can override):
- **Lab spikes:** S1–S4 run in the Media lab. S3, S7 and S8 need the phone and a manual procedure, so
  the lab logs their steps. S5's frame-rate half and S6 wait for Phase 4 (FrameExtractor, CopyRunner).
- **TS contract additions (SPEC §7.1 updated):** `enqueue(jobsJson, cbrFirst)` (spike S4 runs CBR with
  no VBR fallback) and `NativeJobStatus.attempts` (per-attempt planned against actual bytes for the lab).
- **`SizePlan.fpsCap`** added (SPEC §5.1 updated). A retry walks the ladder with the plan's frame-rate cap.
- **Widths round to even, not to 16** (SPEC §10.2 updated). The §10.3 refusal figure (1,297 s) uses 426 px
  for 240p; 16-alignment gives 432 px and 1,287 s.
- **Probe reports display dimensions:** rotation 90 or 270 swaps width and height. A portrait phone clip
  planned as landscape would be letterboxed. Found in review of the Kotlin and fixed in B1.
- **Presentation uses the planned size** (`createForWidthAndHeight`, scale to fit), not SPEC §9.2's
  `createForHeight`, so the output matches the plan. Revisit if S2 shows a problem.
- **No new dependency approvals needed:** expo-constants and expo-system-ui are the PDF Editor's pinned
  Expo modules; JUnit 4.13.2 is used by Deputy, OpenTunnel, NetLens and Strongroom.
- **Media lab is one screen** (Stack root, no tab bar); tabs come with Phase 3–4. The share button is
  labelled "Share results" because the share sheet can copy.
- **Commits stay local.** Nothing pushed, no release. Set the upstream when pushing:
  `git push -u origin design-media-phase-1` (the branch was created tracking `origin/main`).

Session B1, 2026-11-02 (phone check over adb; decisions for the owner):
- **Encoder order: CBR first (decided 2026-11-02 under the owner's instruction to proceed on their own).** S4 (CBR, no fallback) was accurate at +0.6%, while VBR was +45% on try 1. The
  code now runs CBR first, and VBR once if CBR fails to start or yields nothing. The `cbrOnly` flag (was `cbrFirst`)
  is the S4 spike mode, with no fallback. Tests: EncoderOrderTest (source scan). Not yet verified on the phone.
- **onTimeout fix** (commit c73ba0b): `stopForeground(STOP_FOREGROUND_REMOVE)` before `stopSelf()`. Found on the phone.
- **Time-limit fallback:** the job pauses on the time limit and the app shows bare `paused`. Reason copy is a Phase 5 item.

Research and docs session (Claude's recommendations, owner can override; PRD §10 lists the open
questions):
- **Android engine: Media3 Transformer 1.11.1 + `MediaExtractor`/`MediaMuxer` + a Kotlin GIF
  encoder ported from gifenc (MIT); no FFmpeg in v1.** Why: ffmpeg-kit is retired (archived
  2026-07-02, binaries pulled around 2025-04-01); an own FFmpeg adds 15–30 MB per ABI and a Nix
  build, and uses the same hardware encoders, so it wouldn't fix accuracy.
- **Mac engine: pinned static FFmpeg + FFprobe 9.0.2 (Martin Riedl build) from the main process;
  libx264 two-pass for target size, VideoToolbox otherwise.** Why: two-pass hits the bitrate
  within about 0.1% on the one published test vs about +20% for one pass; GPL is fine while the
  binary stays on the owner's Mac (gitignored, never shared). Approved (PRD Q2, S0).
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
- **Presets in decimal MB: Discord 20, Discord Nitro Basic 50, Email 18, WhatsApp 16 (Q4).** Why: Discord is 20 MB
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

Verified 2026-11-01 (session B1, Phase 1 steps 1–6; output was read, not predicted):
- `pnpm install` in the worktree: 1050 packages added, exit 0. Node v22.23.4; zsh, so exit codes need `set -o pipefail`.
- `pnpm --filter @apps-hub/media-core test`: 34 pass, 0 fail. Its typecheck is clean.
- RESEARCH §6.6 A by test: attempt 1 overshoot of 15% gives attempt 2 at 1,886,519 bit/s, 720p30
  (RESEARCH says about 1,886,000). The 30-min refusal gives `maxDurationS` 1297.
- Root `pnpm typecheck` exit 0; root `pnpm test` exit 0.
- `pnpm --filter design-editor-mobile typecheck` exit 0; `lint` exit 0.
- `./gradlew :design-media:cleanTestDebugUnitTest :design-media:testDebugUnitTest :app:assembleDebug`
  (in `apps/design-editor-mobile/android`): BUILD SUCCESSFUL. JUnit XML: 32 tests, 0 failures
  (DataSafetyRulesTest 6, DisplayTest 2, EncoderStatsMathTest 4, JobQueueTest 7, OutputNameTest 5,
  PlanJsonTest 3, QueueStoreTest 3, RetryRuleTest 2).
- Release merged manifest (`:app:processReleaseManifest`): minSdk 35, targetSdk 36, `MediaJobService`
  with `exported="false"` and `foregroundServiceType="mediaProcessing"`. Permissions: FOREGROUND_SERVICE,
  FOREGROUND_SERVICE_MEDIA_PROCESSING, POST_NOTIFICATIONS, INTERNET, ACCESS_NETWORK_STATE, WAKE_LOCK.
  `SYSTEM_ALERT_WINDOW` is in the debug and debugOptimized source sets (React Native's dev menu), so it
  appears only in debug merges. The release manifest has none. Store builds are release.
- `expo-doctor` (run as `pnpm --filter design-editor-mobile run doctor`): 16 of 18. Two failures:
  (a) "config fields not synced in a non-CNG project": PDF Editor shows the same warning. (b) "module
  android dirs are gitignored": a false positive. The check globs `modules/**/android/build.gradle`
  and reaches `modules/design-media/node_modules/expo-modules-core`, an ignored pnpm symlink. NetLens
  fails the same check. Root `pnpm doctor` runs pnpm's built-in doctor, not expo-doctor.
- Android: `ANDROID_HOME=/Users/outsentia/Library/Android/sdk`. Its android-36 `android.jar` is identical
  to the Homebrew copy named in the brief.
- Media3 1.11.1, checked with javap by the worker: `Transformer.Builder` setters (video and audio MIME,
  encoder factory, looper, listener); `EditedMediaItem.Builder.setRemoveAudio`; `DefaultEncoderFactory`
  settings; `VideoEncoderSettings.Builder.setBitrate/setBitrateMode(int)`; `Presentation.createForWidthAndHeight`
  with `LAYOUT_SCALE_TO_FIT`; `FrameDropEffect.createDefaultFrameDropEffect(float)`;
  `ExportException.getErrorCodeName(int)` (static).
- Platform (android.jar 36): `Service.onTimeout(int, int)`; `FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING`;
  `MediaCodecInfo.EncoderCapabilities` BITRATE_MODE_VBR and CBR; `FEATURE_HdrEditing`;
  `MediaStore.MediaColumns` IS_PENDING and RELATIVE_PATH.
- Review fixes (parent, before commit): `Probe` display size (rotation); `MediaJobService.publish` now
  fails the one job on a MediaStore error instead of throwing on the Transformer looper.
- Not verified yet, and needs the phone or a real encode: foreground start and the time limit (S8),
  Transformer output sizes and orientation (S2, S4), FrameDropEffect on a lower-fps source (S5),
  MediaStore publish on device, Probe on real `content://` URIs, CodecReport values, notification UI.
  Kotlin lint (NewApi) was not run.

Phone check 2026-11-02 (adb over Wireless debugging; the owner's Redmi 24116RACCG, HyperOS, Android 16; real output):
- Build: `com.haroon.designeditor` 1.0.0 (versionCode 2), installer `com.haroon.store`, Store 0.1.0 (14). Battery
  mode is the default (RUN_ANY_IN_BACKGROUND allow, not whitelisted). No lab outputs or logs existed before this run.
- S1 (codec report): hardware encoders `c2.mtk.avc.encoder` / `OMX.MTK.VIDEO.ENCODER.AVC` and
  `c2.mtk.hevc.encoder` / `OMX.MTK.VIDEO.ENCODER.HEVC`, modes cq/vbr/cbr, up to 2560×2560. Software: `c2.android.*`,
  `OMX.google.*`. The hardware HEVC encoder exists. An earlier note saying there was none was my misread (I had cut the list short).
- Clip: `VID_20260208_130059.mp4`, 115.7 s, 135.7 MB, portrait. The probe planned 540×960 at 30 fps, so the
  display-size fix works on a real phone clip. This is not the 60 s clip in the plan.
- S2 (H.264, VBR first): done on try 3. Try 1 planned 18.0 MB, actual 26.1 MB (+45%). Try 2 planned 12.3 MB, actual
  23.6 MB (+92%). Try 3 planned 6.8 MB, actual 14.2 MB (+108%). Published 14.2 MB, under the 20 MB target. A repeat run gave the same sizes.
- S4 (H.264, CBR first, no fallback): done on try 1. Planned 18.0 MB, actual 18.1 MB (+0.6%), 32 s, published.
  This contradicts the VBR-first rule (SPEC §9.2, RESEARCH §6.4), which came from Compressor's MediaTek reports. The owner decides the default.
- S3 (five-job batch): all five published between 16:51 and 16:58 with the app swiped out of Recents and the screen
  locked from 16:50:32. The service stayed foreground (`mediaProcessing`) until the last job, then stopped at 16:58:54.
  The swipe and lock were adb input events, not a hand test. The phone is now locked behind a PIN, so the lab queue
  couldn't be read after the batch.
- S7 (APK): release APK 43,228,999 bytes (43.2 MB), arm64-v8a only. The DEX holds 22,199 classes, of which 3,452
  (15.5%) are `androidx.media3`. That's a class-count estimate of about 3.9 MB of the 25.1 MB of DEX. No build without Media3 exists to measure the delta.
- S8 (60 s media_processing limit): run 1 was in the foreground. It finished 3 attempts in 92 s, so the limit never
  applied. Run 2 was backgrounded. The limit fired and the job paused (queue state `paused, try 1`). Then the app crashed
  with `ForegroundServiceDidNotStopInTimeException`, because `onTimeout` called `stopSelf` but never `stopForeground`.
  Fix: commit c73ba0b calls `stopForeground(STOP_FOREGROUND_REMOVE)` first, and a source-scan test pins the order.
  Not yet re-tested on the phone: that needs a new release (see Current state). The device_config override was removed afterwards.
- S5: FrameDropEffect is compiled into TransformerRunner, and the build passes. FrameExtractor's frame rate is a Phase 4 item.
  S6 (CopyRunner) is Phase 4.
- Open: the lab shows a bare `paused` with no reason copy. The lab's picked file and queue reset when the process dies.
  Not tested: S2 with HEVC (the hardware encoder exists).

### Verified 2026-11-03 (session B2, Mac media tools; output was read, not predicted)

- FFmpeg 9.0.2 (Martin Riedl, macOS arm64, GPL): `ffmpeg.zip` sha256 `c8ed4c4e…d924`, `ffprobe.zip` sha256 `fcbe8395…7ea6`, both equal the published `.sha256` files. `pnpm --filter design-editor ffmpeg` downloads, checks the hash, writes `vendor/ffmpeg/VERSION` (configure line includes `--enable-gpl --enable-libx264 --enable-libvpx --enable-libopus --enable-libmp3lame`, no nonfree). The `-h encoder=h264_videotoolbox` check from PROMPTS step 1 was not run.
- `packages/media-core`: 55 tests pass; typecheck clean. Root `pnpm test` and `pnpm typecheck`: exit 0.
- `pnpm --filter design-editor test:e2e` (editor suite + `test/media.mjs`): exit 0. Media suite on a generated 60 s 1280×720 clip with two AAC tracks: Discord 20 MB size job published 19.19 MB in 1 attempt, 5.1–5.5 s; quality, lossless clip (keyframe-accurate, both audio tracks kept), exact clip, two audio tracks, GIF, MKV remux, WebM VP9, refusals, cancel with no `.part` left, the quit prompt, and input SHA-256 unchanged.
- Packaged app (`pnpm --filter design-editor dist`, exit 0): the icon is applied (`Resources/electron.icns` equals `build/icon.icns`; the packager's "`.icon` not found" line is only its Icon Composer probe). AC-10 on a generated 60 s 1920×1080 clip (6 Mbit/s testsrc2): 19,205,072 bytes, 1 attempt, 6.9 s, inside 18–20 MB; original SHA-256 unchanged. This is not the owner's phone clip.
- Bugs found and fixed while testing: enqueue stored the `Planned` wrapper `{ok, plan}` as the job plan (so ffmpeg args were undefined); `parseKeyframe` dropped ffprobe's trailing commas (lossless clips started at 0); clip times need six decimals, because a keyframe at 8.333333 s seeks back to the previous keyframe when passed as 8.333; the packaged app cannot run a binary inside `app.asar`, so `dist` uses `--asar.unpackDir=vendor/ffmpeg` and `media.js` resolves `app.asar.unpacked`.
- The security review finding (an audio language tag in a file's metadata could steer the output name out of the folder) is fixed: `outputName` sanitizes labels, `labelFor` accepts only language-shaped tags, and `publish` refuses a destination outside the chosen folder. Regression test in `names.test.ts`.

### Verified 2026-11-03 (session B2.1; output was read, not predicted)

- `pnpm --filter @apps-hub/media-core test`: 61 pass, 0 fail (was 55; six new: convert mute, frame plan, validate mute and frame, ffmpeg mute and frame).
- `pnpm --filter @apps-hub/media-core typecheck` and root `pnpm typecheck`: exit 0.
- Root `pnpm test`: exit 0.
- `pnpm --filter design-editor test:e2e`: exit 0. The editor suite and the media suite both pass. In the media suite: the Discord 20 MB job published 19.19 MB in 1 attempt; the muted MP4 keeps only its video stream; the PNG frame at 1 s is 1280 px wide with codec png; the JPEG frame has codec mjpeg. The tool-button count went from 6 to 7.
- `pnpm --filter design-editor dist`: exit 0. The packaged binary was built but its e2e was not re-run on it.
- CapCut: desktop 9.5.0. Its window's accessibility tree had 4 labels; setting `AXManualAccessibility` returned error -10006; `screencapture` failed with "could not create image from display". No CapCut file was exported or measured.
- Web sources for CapCut's export options were thin. The help page covers 2K/4K and frame rate. One guide mentions H.264 or HEVC and MP4 or MOV. None found GIF export or a 2026 desktop feature list.

### Verified 2026-11-03 (session B2.2; output was read, not predicted)

- After the merge with `main`: `pnpm --filter @apps-hub/media-core test` 61 pass, 0 fail; `pnpm typecheck` (root) exit 0; root `pnpm test` exit 0 (its tail shows only subtest output, and the exit code is 0); `pnpm --filter design-editor test:e2e` exit 0 (editor suite ok, media suite ok, input hashes unchanged).
- After the preview commit: the e2e exit 0 again. New e2e results: HEVC size job, 20 MB target, published **17.94 MB in 1 attempt** (H.264 published 19.19 MB in the same suite); GIF with a 1 MB fit, published **469 kB in 1 attempt**; preview: the video reads 1280 px wide and 60 s, seeks to 30.00 s; an id that was never picked is refused (media error).
- `pnpm --filter design-editor dist` after the preview: exit 0, FFmpeg unpacked beside the app. The packaged binary's e2e was not run.
- `<video>` on `file://`: a probe in the media window, with the window's CSP, loaded the 60 s clip (readyState 4, 1280×720, no `securitypolicyviolation`). So the CSP does not block `file://` media. The renderer would still need the path, which AC-11 forbids.
- Custom scheme probe (throwaway Electron app, scratchpad only): a privileged `mediain` scheme that answers `Range` requests with 206 seeks to 30.00 s. Without range support the seek stays at 0, so the handler must serve byte ranges itself (`net.fetch` on `file:` returned 200 with no `content-range`).
- CapCut UI access: `screencapture` still fails ("could not create image from display"). No CapCut export was made or measured.

### Verified 2026-11-03 (session B3.1; output was read, not predicted)

- `pnpm install` in `.claude/worktrees/design-media-phase-3`: 1054 packages, exit 0. A second `pnpm install` after adding the engine package: exit 0.
- `pnpm --filter design-editor ffmpeg`: exit 0. The `ffmpeg.zip` and `ffprobe.zip` hashes matched the published `.sha256` files (`ffprobe` sha256 `fcbe8395…7ea6`, the same as before).
- `pnpm --filter design-editor test:e2e`: exit 0, with nothing skipped. The editor suite ran (`e2e ok`). The media suite ran (HEVC 17.94 MB, GIF fit 469 kB, volume normalize -23.0 LUFS, +6 dB moved by 6.00 dB, reverse 47.1 dB vs 21.4 dB, stabilize 9.80 → 7.22, preview seek 30.00 s). Input hashes unchanged.
- After the move: root `pnpm test` exit 0, root `pnpm typecheck` exit 0, `pnpm --filter design-editor dist` exit 0. `app.asar` contains `vendor/engine/desktop.html`, so the symlink is packed. The packaged binary's e2e was not run.

### Verified 2026-11-04 (session B3.2; output was read, not predicted)

- Engine: `node packages/design-editor-engine/build.mjs` exit 0 → `assets/editor/editor.html`, 3.99 MB, 18 fonts, inlined order fabric → pdf-lib → fontkit → `__fontsData` → shell-mobile → app.js → touch.js, CSS link replaced, no CSP meta (checked by reading the product page).
- `pnpm --filter design-editor test:e2e`: exit 0, three suites — `e2e ok` (editor), `media e2e ok` (HEVC 17.94 MB, GIF fit 469 kB, volume -23.0 LUFS, reverse 47.1 dB, stabilize 9.80 → 7.22, preview seek), and `mobile bridge ok — 5 template items, png 2×, refuse path, long-press, pinch 234%` (the new `test/mobile.mjs`, system Chrome, device viewport, fake `ReactNativeWebView`). The mobile suite asserts: embedded layout (header hidden, rail a row, media + page reorder hidden), template apply → autosave (dirty, W 1080, five items, no `cornerSize` in the JSON, `touchCornerSize` 44 stamped) + docState, menu undo/redo, `saveAs` json round-trip (text, docState title changes on the replied path), bridged confirm (refuse keeps three items, discard empties), PNG 2× export via base64 through the page's own export sheet, the >30 MB refusal (nothing crosses, "Too large to save on the phone: try 2×"), long-press action sheet duplicate (and the Fabric wall released after the sheet closes), pinch zoom (mid > 1.4× start, label follows, wall `none` during, released after lifting).
- Mobile app: `npx tsc --noEmit` exit 0; `npx expo lint` exit 0 (after clearing `.expo/cache/eslint` — its parse cache served a stale copy of `src/editor/files.ts` after an edit; no real lint finding).
- Kotlin: `./gradlew :design-media:testDebugUnitTest :app:assembleDebug` (JDK 21) → BUILD SUCCESSFUL; 44 unit tests including the eight `SavesTest` rules (`DataSafetyRulesTest` rule 1 now reads `setOf("Outputs.kt", "DesignSaves.kt")` for `openOutputStream(`).
- Workspace: root `pnpm test` exit 0; root `pnpm typecheck` exit 0; `pnpm --filter @apps-hub/release test` 5 pass, 0 fail, typecheck exit 0.
- `expo-doctor`: the same two failures Phase 1 recorded (non-CNG config fields; the `modules/**/android` gitignore glob reaching ignored symlinked deps) — no new finding.

### Decisions made in session B4.1 (owner answers, 2026-11-04)

- **Phone tools: all of them, including FFmpeg.** The owner answered "All of them, including FFmpeg" to the one open Phase 4 question (remove sound, still frame and volume on Media3; reverse and stabilize need FFmpeg, which PRD §8 had ruled out on Android). PRD §8 now carries the exception.
- **FFmpeg source: the pinned community AAR, not our own build.** The owner picked `dev.ffmpegkit-maintained:ffmpeg-kit-min:8.1.7` over "build our own LGPL". Recorded in SPEC §3. Why it is acceptable: LGPL-3.0, no x264, MediaCodec encoders only, on Maven Central. The trust is the same kind as the Mac download: one publisher (Jokobee), self-reported 16 KB support, no signature we can check (`gpg` is not installed here; an `.asc` exists on Central). Limits: reverse and stabilize output goes through `h264_mediacodec`, so it follows the phone's encoder quirks.
- **Added by the owner mid-session (2026-11-04), not built in Phase 4:** background music and several sounds on one video, join clips, cut into pieces, change orientation, CapCut-style templates, and a question about Spotify. Answer on Spotify: not possible (PRD "Requested by the owner" block). Claude's sequencing, which the owner can override: finish Phase 4 as scoped, then session B4.2 for Add music, Join clips and Orientation, then a designed phase for templates.

### Verified 2026-11-04 (session B4.1; output was read, not predicted)

- The merge: `origin/main` (`ec23cbd`) and `origin/docs/canvas-perf-release` merged into `design-media-phase-4`; the handoff conflict resolved with the docs version; `pnpm install` exit 0.
- `ffmpeg-kit-min` 8.1.7 AAR, downloaded from Maven Central into a scratch folder: 16,151,151 bytes; computed sha256 `591ddcf3698028e838b854dc775e60aedaf43fffd59689cb59b8af632aba3d76` equals the published `.sha256`. Metadata lists 6.0.3, 6.0.4, 7.1.6, 7.1.7, 8.1.7, 8.1.8, 8.1.9 (latest 8.1.9, updated 2026-09-26). Pinned at 8.1.7 because it is the one inspected.
- Inside it: `jni/arm64-v8a` and `jni/x86_64` (nine `.so` each; arm64 `libavcodec.so` 8.9 MB, `libavfilter.so` 2.9 MB), FFmpeg `n8.1.2`, configured `--enable-version3 --enable-jni --enable-mediacodec --enable-small --disable-autodetect --disable-programs` (no `--enable-gpl`, no `libx264`). The filters `deshake`, `reverse`, `areverse`, `loudnorm`, `volume`, `scale`, `trim`, `atrim` and the encoders `h264_mediacodec`, `hevc_mediacodec`, `mpeg4`, `mjpeg` and `aacenc.c` are present in the arm64 libraries (string match, not a run; nothing was executed).
- The Java layer (`com.arthenica.ffmpegkit`) has classes upstream did not ship: `TranslationProvider`, `DeepLTranslationProvider`, `GoogleTranslateProvider`, `LibreTranslateProvider`, `WhisperKit`, `CameraSupport`. No class references `java/net` or contains a URL, and nothing refers to the three providers. We never call them. Not verified: whether R8 strips them in the release build.
- Not verified yet: that a reverse or stabilize job actually runs on the phone with this AAR (needs a release and the phone), whether `abiFilters` removes the x86_64 libraries from our APK, and the APK size after adding it.
- Phase 4 TypeScript, run in this worktree: `pnpm --filter @apps-hub/media-core test` 79 pass, 0 fail (was 70; nine new in `android.test.ts`, one of them caught a real bug in my muted convert, fixed); media-core `tsc --noEmit` clean. `pnpm --filter design-editor-mobile test` 8 pass (plain words 4, page sizes 2, job text 2); the plain-words test first failed on today's strings (the home row, the lab, "Double-click", "This Mac only", "magic resize", "⌘Z", "Documents/Design Editor"), then passed after the fixes. `pnpm --filter design-editor-mobile typecheck` and `lint` exit 0.
- `pnpm --filter design-editor test:e2e`: the editor suite `e2e ok`; the media suite was skipped (FFmpeg is not fetched in this worktree: run `pnpm --filter design-editor ffmpeg` first); the phone smoke `node apps/design-editor/test/mobile.mjs` (run on its own, Chrome) printed `mobile bridge ok — 5 template items, png 2×, refuse path, long-press, pinch 57%` and now also asserts: the hint is remembered, the selected item sits above the sheet, two taps in select-several mode select two items, a height-only resize keeps the zoom, a width change refits. The old assertions for the toast wording were updated to the new copy ("Saved in the Design Editor folder on this phone.", "This image is too big to save. Choose a smaller size.").
- Not verified: the full `pnpm test`/`pnpm typecheck` at the root, Gradle, `expo-doctor` and the full e2e in one run (all come after the native side lands).

### Decisions made in session B3.2 (Claude's calls; the owner can override)

- **The bridge's ask-and-answer set is complete in the app**: every `reqId` gets a reply — `saveFile` (json → `DesignMedia.saveJson`, else `saveExport`), `confirm` (an Alert with Keep editing / Discard), `readAutosave`/`writeAutosave`/`keepAutosave` (expo-file-system/legacy), `openDesign` (DocumentPicker). An error replies `ok:false`, so the page's own catch paths run instead of hanging.
- **The Designs home is a file list, not a library database** (that is a later phase): `documentDirectory/autosave.json` holds the page's own record; `documentDirectory/designs/index.json` (≤50 rows) lists saves, each with a mirror file `<id>.json` so opening never reads MediaStore. A re-save overwrites its row's mirror (dedup by display path, `recordSaved` returns the surviving id).
- **Open flows seed the autosave slot and let the page boot restore**: Home "New design" clears the autosave; opening a list row or a picked file writes `{ filePath, dirty: false, doc: text }` and pushes the editor. No new bridge command was invented for "load this doc" — the page's existing boot path is the load path.
- **Saved designs live in `Documents/Design Editor/`**, image exports in `Pictures/Design Editor/` (pure rule in `core/Saves.kt`, `SavesTest`). A re-save whose `filePath` points inside our folders replaces the own MediaStore row in place (title stays stable, no "(1)" copies); the desktop overwrite semantics carry over because MediaStore only lets the writer touch its own rows.
- **The editor's native toolbar carries only what the page can still do without the hidden desktop header**: Undo, Redo, Duplicate, Zoom out/in, Fit as `menu` commands; Save and Download on the top bar. `#exportBtn` is hidden in embedded mode, so `menu: 'export'` opens the page's own bottom-sheet popover.
- **The action sheet closes through `closeSheet()`** so closing also un-walls Fabric — found by walking the interaction, fixed in touch.js, covered by the smoke test.
- **DataSafetyRulesTest rule 1 was amended**, not relaxed: two MediaStore writers are now allowed (`Outputs.kt`, `DesignSaves.kt`), each still only writing its own new or own-row files, and no source may still carry a `w`-family open-mode string (the rules' intent is untouched).

### Verified 2026-11-03 (session B2.3; output was read, not predicted)

- `pnpm --filter @apps-hub/media-core test`: 70 pass, 0 fail (was 61). `pnpm typecheck` (media-core and root): exit 0. Root `pnpm test`: exit 0.
- `pnpm --filter design-editor test:e2e`: exit 0. The new checks, with the numbers the run printed:
  - Volume normalize: **-23.0 LUFS** (target -23). A one-pass `loudnorm` gave -21.1 LUFS on the same clip, so the job now measures first and applies the measured values linearly.
  - Volume +6 dB: the mean moved **by 6.00 dB**. With the first test tone at full scale, +6 dB clipped and the mean moved by 3.4 dB. That is the gain's clipping limit, recorded below. The check uses a tone with 12 dB of headroom.
  - Reverse: the first output frame matches the input's last frame at **47.1 dB** PSNR, against 21.4 dB for the input's first frame. The sound's start is **60.7 dB** quieter than the input's start, so the fade runs backwards. Without sound, the output has only video. The 60 s clip is refused with "up to 10 seconds".
  - Stabilize (recommended): frame-to-frame difference **9.80 → 7.22** on the shaky clip, with the frame size kept at 640×360.
  - The media window has 10 tool buttons. The earlier checks still pass: the 20 MB size job (19.19 MB), HEVC (17.94 MB), GIF fit (469 kB), and the preview seek.
- Reverse memory, measured, not estimated: a 10 s 1080p30 clip reverses with a **peak resident set of 1.05 GB** (`/usr/bin/time -l`, FFmpeg 9.0.2, `reverse` with VideoToolbox H.264). The cap of 10 s and 1920×1080 stands.
- `pnpm --filter design-editor dist`: exit 0. The packaged binary's e2e was not run.
- CapCut: `screencapture` still fails ("could not create image from display"). The feature behaviour used for these tools comes from CapCut's public help and resource pages, found by search. Those are marketing and blog pages, not its help-center articles, so the specifics are approximations.

### Decisions made in session B2.3 (the owner's yes, 2026-11-03: "go ahead and build those features the way they are built in CapCut")

- **Scope:** rows 7, 8 and 11 of `CAPCUT-GAPS.md` are built. Each one moves past PRD §8's "filters" and "speed changes" lines, so each is recorded as a scope change under FR-8 with the owner's yes.
- **Volume:** normalize to -23 LUFS (EBU R128, CapCut's public target) or a gain of ±20 dB. Two-pass `loudnorm`, because one pass misses on short clips. The picture is copied when it fits MP4, else re-encoded to H.264. The sound goes to AAC.
- **Reverse:** picture and sound run backwards, with the sound on by default (CapCut's default, per its public docs). Clips up to 10 s at 1920×1080 or below. The clip is held in memory, so the cap is the limit. A longer clip is clipped first, then reversed.
- **Stabilize:** three levels named after CapCut's (Minimum cut, Recommended, Most stable), with Recommended as the default. The built-in FFmpeg `deshake` does the work, so no new binary. The search ranges (16, 32, 64 px) are ours. The phone's FFmpeg 8.1 refuses any range that is not a multiple of 16 (`rx must be a multiple of 16`), so the first values (8, 16, 40) made "Minimum" and "Most stable" fail on the phone; only 16 ran. Fixed 2026-11-05. The edges are mirrored, so the frame keeps its size, where CapCut crops.

### Known limits (not fixed; each is a shortcut comment in the code)

- Volume gain has no limiter. A boost past full scale clips. The e2e check uses a tone with headroom.
- Reverse: whole-clip memory, capped at 10 s and 1080p. Chunked reverse is the upgrade.
- Stabilize: `deshake` is weaker than libvidstab. Its levels are our ranges, not CapCut's. The owner saw no difference at "Balanced" (then 16, which is also FFmpeg's default, so it barely corrects). The levels are now 16, 32 and 64. Not yet checked on a genuinely shaky clip on the phone. A real step up needs libvidstab, a new binary and the owner's yes.
- Loudness: one measure per job, no re-measure, and no true-peak limiter beyond `loudnorm`'s own TP -1.5 dBTP setting.

### Decisions made in session B2.2 (Claude's calls; the owner can override)

- **Clip preview: through a privileged scheme, not a `file://` URL.** The `<video>` preview needs a URL, and AC-11 keeps paths in the main process. So `mediain://<input id>/` is served by the main process from the `inputs` map, with byte ranges. Unknown ids get 404. This is the Mac version of the owner's Q7 choice ("Preview in player", recommended, approved 2026-10-31); it is not a new scope item.
- **Merged `origin/main` into the branch instead of rebasing.** The branch was already pushed, and a rebase would need a force-push. Where `main`'s squash of PR #15 and the branch's files differed, the branch's version was kept, since the differences were only the B2.1 lines.
- **B3 waits for PR #16 on `main`.** The gate is in the resume prompt. Starting B3 on a stacked branch would have bypassed it.

### Decisions made in session B2.1 (Claude's calls; the owner can override)

- Two gaps added, both inside PRD §8. **Remove sound:** an option on Convert. The video is copied when its codec fits, and no audio map is written. **Still frame:** a new tool `frame`, one PNG or JPEG at a chosen time, video only, the sound is never read. A still image is not an animated image, so the §8 line about animated images does not cover it. PRD FR-8 and a still-frame bullet record both.
- Not added, waiting for the owner: loudness normalisation (an audio filter, and §8 excludes "filters", so it is a scope change), reverse playback (needs a memory cap and a scope call), stabilisation (needs a libvidstab build, so a new binary). Rejected: cloud or AI features and the music library. Details in CAPCUT-GAPS.md.
- The branch is stacked on `design-media-phase-2`, not `main`, so the PR diff shows only B2.1. Retarget it to `main` once PR #15 merges.

### Decisions made in session B2 (Claude's calls; the owner can override)

- Mac size: H.264 uses libx264 two-pass (margin 0.97); HEVC uses `hevc_videotoolbox` in one pass (margin 0.90), both with the retry rule. Quality uses VideoToolbox `-q:v` 65/55/45 for High/Medium/Small. Every video encode adds `-pix_fmt yuv420p` and strips container metadata (`-map_metadata -1`, PRD Q10).
- Phase 2 planners are Mac-only. The `platform` parameter and the Android tables in SPEC §5.2 are Phase 4's job, so the signatures differ from the SPEC for now.
- WebM is a VP9 transcode (`libvpx-vp9`, CRF 33) with Opus audio, because the SPEC's encoder list had no VP9. `ConvertPlan.video` now also takes `'vp9'` and `'copy'`.
- Clip preview on the Mac: a 10-frame thumbnail strip, plus "Preview in player" through the `mediain` scheme (B2.2). The `file://` CSP check passed (see Verified 2026-11-03 B2.2).
- Output publish: rename into the folder when on the same volume; across volumes, copy to `<name>.part` and rename.
- Encoder stats: median of the last five overshoot ratios, no clamp (the 0.8–1.5 clamp is a Phase 5 Android item).
- Icon: `apps/design-editor/build/icon.icns` (105 KB) is committed, built with `sips` and `iconutil` from `apps/design-editor-mobile/assets/icon.png`. `dist` passes `--icon=build/icon` (the packager adds `.icns`).
- The FFmpeg folder `vendor/ffmpeg/` is gitignored and never shared (NFR-8).

### Known gaps (not fixed in Phase 2)

- HDR 10-bit sources are encoded to 8-bit SDR without tone mapping, so colours can shift (PRD test clip 4 is a phone check).
- Subtitles and data tracks are dropped. A multi-audio convert uses one codec for every track.
- A process killed during a cross-volume copy can leave a `.part` file in the output folder. Same-volume publishes (the normal case) are a single rename.
- Quit with a running job is tested by emitting `before-quit`, not by a real Cmd-Q.
- Tested on synthetic clips in B2.2: HEVC size (17.94 MB of a 20 MB target, 1 attempt) and GIF fit under 1 MB (469 kB). Not tested: any owner clip (the phone clips are not on this Mac).

### Phase 4 audit, step 0 (2026-11-04, session B4.1): strings that break FR-13, with the plain replacement

Read from the merged tree (`ec23cbd` + docs PR #20). "Page" = `packages/design-editor-engine` (`mobile.html`, `app.js`, `shell-mobile.js`).
`app.js` is shared with the Mac, so a phone-only wording is picked through one module-level flag
(`document.body.classList.contains('embedded')`, the same test `setZoom` already makes locally at
`app.js:83`), and the Mac copy stays as it is.

Home and editor screens (`apps/design-editor-mobile/app`):

| Where | Now | Plain replacement |
| --- | --- | --- |
| `index.tsx` Media tools group | "Video tools from the first phase; the six design-oriented tools arrive with the media phase rewrite." | Group removed; Media is its own tab |
| `index.tsx` Media lab row | "Media lab", "Phase 1 checks on this phone.", hint "Opens the phase 1 media lab" | Debug builds only (`__DEV__`), moved to `app/lab.tsx`; no row in release |
| `index.tsx` Saved designs footer | "Designs land in Documents/Design Editor on the phone." | "Saved designs are in the Design Editor folder on this phone." |
| `index.tsx` Continue row | "Saved copy intact." | "All changes saved." |
| `index.tsx` loading row | "Checking the phone…" | "Loading your designs…" |
| `editor.tsx` top bar | label "Download", hint "Opens the export sheet with format and size" | label "Save image", hint "Choose a format and size, then save or share" |
| `editor.tsx` load failure | body = raw `assetError` text + "Go back and open the design again." | Only "Go back and open the design again." (no raw error text) |
| `editor.tsx` page confirm | Alert title "Design Editor", buttons Keep editing / Discard | Keep (already plain) |

The lab itself (`app/media.tsx`, all strings): "Media lab", "Phase 1 checks…", spikes S1 to S8, "Size job", "Start 20 MB job", encoder labels H.264 / HEVC, job ids as row titles, "try n", "planned … actual … MB", CBR/VBR, "Video 2.31 Mbit/s", "HDR editing", "Spikes", "Results". All stay, debug builds only, and the route is not in the release route table.

Editor page (phone only; the Mac keeps its own copy):

| Where | Now | Plain replacement (phone) |
| --- | --- | --- |
| `mobile.html` header/menus | Undo `title="Undo (⌘Z)"`, Redo `(⇧⌘Z)` | Header is hidden on the phone; drop the shortcut text from the attribute for the phone page |
| `mobile.html` Text panel | "Double-click text on the page to edit it." | "Tap text on the page to edit it." |
| `mobile.html` Uploads panel | "Drop images here, paste them, or choose files" | "Choose pictures from this phone" |
| `mobile.html` Brand panel | "Click a colour to apply it to the selection. Right-click to remove it." | "Tap a colour to use it on the selected item. Press and hold to remove it." (needs a long-press handler on swatches) |
| `mobile.html` Resize panel | "Custom size (px)", "Scale content to fit (magic resize)" | "Custom size", "Fit the content to the new size" |
| `mobile.html` export menu | button "Download", select "Format"/"Scale", button "Download file" | "Save image", "Format", "Size", "Save image" |
| `app.js:20` font list | optgroup "This Mac only" | "On this phone" (phone: system fonts are empty anyway; check) |
| `app.js:52` | "… isn't on this Mac, so that text now uses …" | "… isn't on this phone, so that text now uses …" |
| `app.js:211` size label | "1080 × 1080 px" | "1080 × 1080" (keep px only where a person types a size) |
| `app.js:551` page inspector | "Shortcuts: ⌘Z undo, ⇧⌘Z redo, ⌘D … Delete removes." (also shown on the phone) | Phone: no Shortcuts block; the sheet shows page colour and size only |
| `app.js:758` | "Downloaded to <file>" | Phone: "Saved <file> to Pictures/Design Editor"? No paths: "Saved. Find it in the Design Editor folder on this phone." plus Share (step 5) |
| `app.js:759` | "The download didn't finish. Try again, or pick another format." | "Couldn't save the image. Try again, or pick another format." |
| `app.js:785` | "That file is not a design saved from this editor. Open a .json file you saved here." | "That file isn't a design from this editor. Pick a design you saved here." |
| `app.js:826` | "… It saved that session to <path>. Open it with File > Open in the version that made it." | Phone: "Design Editor couldn't restore your last session, so it started a new design. The old one is kept in the Designs list." (mobile `keepAutosave` already writes a rescue copy) |
| `app.js:394` | "Use a size between 16 and 8000 px" | Keep (a person typed the numbers) |
| `shell-mobile.js:92` | "Too large to save on the phone: try 2×" | "This image is too big to save. Choose a smaller size." |
| `shell-mobile.js` toasts via `app.js:27` | "Some bundled fonts didn't load. Reinstall the app to fix this." | "Some fonts didn't load. Restart the app; if it keeps happening, reinstall it from the Store." |
| `app.js` page inspector | "Page", "Background", "W × H px. Change it in Resize." | Keep; "Change it in Resize" stays true |

Native strings that reach a person (Kotlin; shown as a job's `error` or a notification):

| Where | Now | Plain replacement |
| --- | --- | --- |
| `MediaJobService.encoderFailed` | "The encoder produced no output." | "This video couldn't be made smaller. Try a different setting." |
| `MediaJobService.errored` | "The encoder failed: <ERROR_CODE_NAME>" | "This phone couldn't process that video. Try a different setting." (the code name goes to logcat) |
| `MediaJobService.publish` | "Couldn't save the output: <exception text>" | "Couldn't save the result. Check that the phone has free space, then try again." |
| `MediaJobService.guard` | "Unexpected error." | "Something went wrong. Try again." |
| Notification | title "Media jobs" (channel), "Starting", "Compressing n of m" for every tool | Channel "Video and audio jobs"; "Working on n of m"; "Starting" is fine |
| `Plans.kt:79` | "Only size jobs are supported in Phase 1." | Removed with the other tools |
| `validate.ts:42` | "This encoder isn't available on this phone." | "This phone can't make that kind of file." |
| `validate.ts:76` | "Pick H.264 or HEVC." (unreachable through the UI) | "Pick Works everywhere or Smaller file." |

Not a problem (already plain): `validate.ts` range messages, `reverse.ts`, `retry.ts` ("The output has no room left for video." is close to the line; becomes "This video can't get that small. Pick a bigger size."), the Designs list, "Leave the editor?" alert.

Editor behaviour findings from reading the code (to confirm on the phone or by screenshot before changing, step 5): New design starts a 1080 × 1080 page with no choice; the keyboard resize path in `app.js` calls `fit()` through the `resize` listener; the property sheet (`body.obj`) covers the lower half of the board; marquee select is off (`canvas.selection = false`), so there is no way to select several objects; no pinch hint exists; `PHONE_PX` stays 8 Mpx until the owner reports build 6.

## File map

- `docs/design-editor/RESEARCH.md`: findings, verdicts, verified vs assumed, sources.
- `docs/design-editor/PRD.md`: FR-1..FR-12, NFR-1..NFR-9, six data-safety rules, AC-1..AC-14,
  open questions Q1..Q10.
- `docs/design-editor/SPEC.md`: stack, layout, dependencies, contracts (preload, Kotlin, Swift),
  queue, pipelines, target-size algorithm with worked numbers, background, UI, engine extraction,
  release, testing, phases, spikes S1..S8.
- `docs/design-editor/PROMPTS.md`: prelude + Phase 1..6 prompts with verification commands.
- Code (Phase 3, B3, this branch): `packages/design-editor-engine` (`desktop.html`, `mobile.html`, `app.js`, `touch.js`,
  `shell-mobile.js`, `build.mjs`, `vendor/` files and fonts, `package.json`, README); `apps/design-editor`
  (`vendor/engine` symlink, `test/mobile.mjs`); `apps/design-editor-mobile` (`app/index.tsx` Designs home,
  `app/editor.tsx`, `app/media.tsx` Phase 1 lab, `src/editor/bridge.ts` + `src/editor/files.ts`,
  `assets/editor/editor.html` gitignored, `modules/design-media` with `android/DesignSaves.kt`,
  `android/core/Saves.kt`, `SavesTest.kt`, and the TS contract in `src/index.ts`); `tools/release/src/apps.ts`
  (entry now with `prepare`).
- Code (Phase 1, B1): `packages/media-core` (types, presets, budget, retry, names, validate, queue,
  fixtures, tests); `apps/design-editor-mobile` (app shell, `app/index.tsx` Media lab, `assets/icon.svg`,
  `android/` prebuild, `modules/design-media` with the Kotlin under `android/` and the TS contract in
  `src/index.ts`); `tools/release/src/apps.ts` (entry, no `prepare`; the Store needs no change since 2026-11-01).
- Still to come: `packages/design-editor-engine`, `apps/design-editor` (`media.js`, `media.html`,
  `scripts/fetch-ffmpeg.mjs`).
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
  icon for both apps. The docs go to `main` through a PR from branch `docs-offline-tools`.
- **2026-11-01 (session B1, Phase 1 start).** Worktree `design-media-phase-1` from `origin/main`
  (03d1c7f); `pnpm install` in the worktree: 1050 packages added, exit 0. Owner correction: no Store
  release for this app (see "Decisions made"). Branch tracks `origin/main` by default, so set its
  upstream before any push. Stopped before step 7 (needs the Redmi Note 14 Pro 4G and the five test
  clips).
- **2026-11-01 (session B1, Phase 1 steps 1–6).** Built media-core (34 tests), the app shell with
  prebuild and the rendered icon, the Kotlin module (built by a forked worker, reviewed by the parent,
  two fixes), the Media lab, the release registry entry, and the SPEC §5.1, §7.1 and §10.2 updates.
  Verification is under "Verified 2026-11-01". Stopped before step 7.
- **2026-11-01 (session B1, step 7: release).** Owner said "go ahead", then "also release the store". Pushed the
  branch. Confirmed the target with the owner: Cloudflare account "Haroonmukhtar4@gmail.com's Account"
  (ID 29ada9205500…), Store API `apps-hub-store.haroonmukhtar4.workers.dev`. `pnpm release store -m "Store:
  see Design Editor"` printed "published" on its first attempt, but that write was lost (see below). Its
  third attempt is the one that stuck: 0.1.0 (14). `pnpm release design-editor -m "Design Editor: media lab"`
  published 1.0.0 (2) on its fourth attempt (43.2 MB APK).
  Upload problems: connect timeout once, then `write EPIPE` on large PUTs (small PUT to an empty key returned 400,
  so auth and transport work). The first Store attempt printed "published", but a later manifest write (about
  two minutes after it, from a read that predated it) overwrote the Store entry back to 13. Re-running
  the Store fixed it. Verified after the last release: `store` 14 and `design-editor` 2 both in `manifest.json`.
- **2026-11-02 (session B1, phone check).** The owner reports the phone check completed. The results were not
  in the chat, so they are not recorded yet. The next session asks for them (the lab's Share results) before tuning
  `budget.ts`. Gates before Phase 2: no PR is open for B1 or B0, and neither is merged. The resume prompt was
  rewritten for the next chat.
- **2026-11-02 (session B1, phone check over adb).** The owner enabled Wireless debugging. I ran S1–S8 over adb and the
  lab UI, and recorded the output under "Phone check 2026-11-02". S8 found a crash in `onTimeout`. The fix is committed
  (c73ba0b) and pushed, with a regression test (33 JVM tests pass, the debug build succeeds). Nothing was released
  this session. The phone was left locked behind a PIN.
- **2026-11-02 (session B1, autonomous run).** Draft PR #8 opened. Encoder order flipped to CBR first, with a VBR
  fallback. Added BatchSequenceTest: the queue's save, load and reduce path keeps all entries through a five-job batch
  (passes). That narrows the queue loss to the service lifecycle, not the store. It needs device logs to settle, and
  those need a release. Not merged: merging releases the app, and the batch defect is still open. 36 module JVM tests pass.

- **2026-11-02 (correction and S8 re-test on code 3).** The "queue loss" in the entries above was a reading error,
  not a service bug. Outputs 4 to 18 show every batch finished: 16:51 to 16:58 (outputs 4 to 8), 17:17 to 17:23 (9 to 13),
  and 18:04 to 18:06 (14 to 18). My earlier checks used a name-sorted `tail` that dropped outputs 10 to 13, and the lab's
  queue rows need scrolling to read. The queue file keeps every batch. The S8 re-test on code 3 (15 s limit, app
  backgrounded during a CBR job): "Stop FGS timeout" at 18:44:10 with no DidNotStopInTime exception, and the app's
  process kept the same PID (30693). On screen the job then showed `paused, try 1`, which confirms the time-limit pause. The override was removed afterwards, so the
  default is back.

- **2026-11-03 (handoff).** B0 merged as PR #12 (squash 0f9cd68, no trailer): the review fixes landed (page-load race,
  all-pages overwrite prompt, autosave kept before a new design, PDF text in transforms, `constructor` font names, toast copy).
  Stale branches and worktrees were deleted earlier in the day, except the B0 ones listed under Current state. A force-push to
  the B0 ship branch was denied, so the trailer was removed by squash-merging instead. Context reached 85%, so this handoff was written.
- **2026-11-03 (session B2, Phase 2 start).** Gates checked: PR #8 (B1) and PR #12 (B0) merged; `origin/main` is 8fb7b38. Worktree
  `.claude/worktrees/design-media-phase-2` on branch `design-media-phase-2` from `origin/main`; `pnpm install` there: 1054 packages, exit 0.
  Nothing committed or pushed (the owner says when). FFmpeg pin fetched and checked (see Verified 2026-11-03).
- **2026-11-03 (session B2, Phase 2 built and verified).** media-core planners and tests, the Mac media window and main process, the e2e
  suite `test/media.mjs` chained into `test:e2e`, the packaged app with FFmpeg unpacked, and AC-10 on the packaged app. Four real bugs
  were found by the e2e and fixed (see Verified). A security review finding about the output name was fixed. Handoff written; nothing committed.
- **2026-11-03 (session B2.1, CapCut gap pass and two media jobs).** Stacked branch `design-media-capcut` from `design-media-phase-2`. PR #15 is still open, so B3 did not start. The CapCut study is in `docs/design-editor/CAPCUT-GAPS.md`. The UI walk-through and the ffprobe measurements were blocked: no Screen Recording permission (screencapture fails), a sparse accessibility tree, and `AXManualAccessibility` refused. Added Remove sound (Convert > Without sound) and Still frame (PNG or JPEG), with planner, validator, FFmpeg args, UI, tests and e2e. PRD FR-8 and a still-frame bullet updated. Verification is under "Verified 2026-11-03 (session B2.1)".
- **2026-11-03 (session B2.2, close B2.1, Phase 2 open items).** PR #15 merged (146db86). PR #16 retargeted to `main`. The rebase would have needed a force-push, so `origin/main` was merged into the branch instead (5760a0a), with the branch's media files kept (see Decisions B2.2). Verified the merged branch: media-core 61 pass, typecheck and root test exit 0, e2e exit 0. CapCut measurements still blocked (screencapture fails; no owner files). Phase 2 open items closed: the `file://` CSP check passes; the preview goes through `mediain` (8ecf695, with the HEVC size, GIF fit-under and seek checks). B3 not started: it waits for PR #16 on `main`, which needs the owner's yes.
- **2026-11-03 (session B2.3, CapCut rows 7, 8, 11 built).** The owner said "go ahead and build those features the way they are built in CapCut". Built Volume (two-pass loudness to -23 LUFS, or gain), Reverse (picture and sound, clips up to 10 s at 1080p), and Stabilize (`deshake`, three levels), each with a planner and tests, FFmpeg args and tests, validation, the planFor and enqueue path, the UI and e2e checks. Measured the reverse's memory (1.05 GB at the cap) and the loudness (-23.0 LUFS). The one-pass loudnorm missed by 1.9 LU, so the job now measures first. Found and recorded the gain's clipping at full scale. PRD FR-8 and the §8 note updated, and CAPCUT-GAPS.md rows 7, 8 and 11 marked built. Verification is under "Verified 2026-11-03 (session B2.3)".
- **2026-11-04 (session B4.1, Phase 4 start).** Worktree `design-media-phase-4` merged with `origin/main` and the docs PR branch; audit written into this file; owner answered the one question (all tools, FFmpeg included) and chose the pinned `ffmpeg-kit-min` AAR, which I downloaded, hash-checked and inspected (see Verified B4.1). Mid-session the owner asked for background music and several sounds, join clips, cuts, orientation, CapCut-style templates and Spotify: recorded in PRD §8 (Spotify is not possible; the rest is the next session). Built the pure TS (media-core), the phone screens, the plain-words test and the editor pass; handed the Kotlin runners to an agent. Verification is under "Verified 2026-11-04 (session B4.1)".

- **2026-11-06 (stage 2 build, "Make a video", inline with executing-plans; ledger in `.superpowers/sdd/2026-11-06-make-a-video-stage-2/progress.md`, git-ignored).** Task 1 done: `packages/media-core/src/project.ts` (Source, Clip, Project; add, split, trim, move, delete, locate, projectProblem, parseDraft as a checked trust boundary) with `__tests__/project.test.ts` (15 tests, failed first on the missing module). Gates: `pnpm --filter @apps-hub/media-core test` 120 pass, 0 fail; root `pnpm typecheck` exit 0.
  Task 2 done: `packages/media-core/src/compose.ts` (`outputSize`, `planCompose`; medium preset, first clip sets the shape, fps the fastest clip capped at 30 and rounded to a whole number because Kotlin reads it as Int) and `ComposeClip`/`ComposePlan` in `types.ts`; a `compose` example in `fixtures/plan-examples.json` (made by `planCompose`); `BY_PLAN` title "Make a video"; the Mac `ffmpegArgs` refuses a compose plan (phone only). Gates: root `pnpm test` exit 0 (media-core 125, app 16), root `pnpm typecheck` exit 0. Known: the Kotlin `decodeSamples` test cannot read the new `compose` example until Task 3.
  Task 3 done: Kotlin `ComposePlan`/`ComposeClip` codec in `core/Plans.kt`, `core/ComposeItems.kt` (`composeItems`, `forceAudio`), the `when` branches (label "", ext mp4, needed space 2x planned, CBR then VBR), `android/ComposeBuilder.kt` (the one Composition: one clipped item per clip, each scaled to fit the first clip's shape plus the frame-rate cap, one sequence with silence forced when any clip has sound; `scaleTo` moved here from `TransformerRunner`), `TransformerRunner.compose` (H.264 + AAC 192k, shares the listener and progress with the single-item path), `Runners` branch. `ComposeTest` (4) failed to compile first. Gate: `./gradlew :design-media:testDebugUnitTest :app:assembleDebug` BUILD SUCCESSFUL, JUnit 131 tests 0 failures (PlanJsonTest reads the compose example); `pnpm test` exit 0. Javap 1.11.1: `Transformer.start(Composition, String)` exists. The plan's `EditedMediaItemSequence.Builder(List)` and `experimentalSetForceAudioTrack` compile but are DEPRECATED in 1.11.1 (the replacement is `Builder(Set<Integer> trackTypes).addItems(...)`); kept as the plan says. If the phone shows a silent clip failing or drifting, try the track-type set first. Not run on a phone.
  Task 4 done: `android/CompositionView.kt` (an `ExpoView` with a `SurfaceView` placed by hand to the plan's shape, black bars around it; `CompositionPlayer` on the main looper; `plan` prop decodes, builds through `ComposeBuilder.composition`, `setComposition(c, positionMs)` clamped to the new length, `prepare()`; `playing` plays or pauses and restarts from 0 after the end; `seekTo`/`setScrubbing` view functions on the main queue; `onPosition` every 100 ms while playing, `onEnded`, `onError`; released in `OnViewDestroys`), registered in `DesignMediaModule`, `src/CompositionView.tsx` (forwardRef straight to the native component, whose prototype carries the view functions) re-exported from the module index. Pure helpers `durationMs` and `fitInside` with JVM tests (failed first). Javap/bytecode 1.11.1: `setComposition(Composition, long)`'s second argument is `startPositionMs` (milliseconds); `handlePrepare` returns at once when not idle, so `prepare()` after each edit is safe; `handleSetVideoOutput` accepts a `SurfaceHolder` or `SurfaceView` and manages the surface callbacks itself, so `setVideoSurfaceView` replaces the plan's manual callbacks with `setVideoSurface(Surface, Size)`; no exoplayer type was needed on the compile classpath (no new dependency). Gate: `pnpm --filter design-editor-mobile typecheck` exit 0; Gradle BUILD SUCCESSFUL (APK 00:52, `CompositionView` in the dex), ComposeTest 5/5. Not run on a phone.
  Task 5 done: `clipSpans` (in `project.ts`, not `timeline.ts`, to avoid an import cycle; test in `project.test.ts`, failed first) and `src/timeline/ClipStrip.tsx`: one block per clip on the shared ruler, fixed centre playhead, tap a block to select it (accent border), pinch and Zoom out / Zoom in as in `RangeStrip`, `seekS` follows the player without calling `onPlayhead`, `onDrag(true/false)` on drag start and end for the screen's scrubbing; each block loads its own pictures (`singleFlight` per block, and one read at a time across all blocks so twenty clips never open twenty decoders), fewer pictures when a block is narrow. `RangeStrip.tsx` only gained exports (`Ruler`, `HEAD_H`, `RULER_H`, `FILM_H`, `EIGHT_SECONDS`). Gate: media-core 126 pass, app 16 pass, app typecheck and lint exit 0. Not run on a phone.

## Current state + exact next step

- **Stage 2 build in progress (2026-11-06):** plan `docs/superpowers/plans/2026-11-06-make-a-video-stage-2.md`, built task by task on this branch. Done: Task 1 (project model), Task 2 (compose plan), Task 3 (native compose job), Task 4 (preview view), Task 5 (clip strip). Next: Task 6 (the screen `app/video.tsx`, `src/video/draft.ts` with `video-draft.test.ts`, the Media tab row, the full gate, docs). The ledger `.superpowers/sdd/2026-11-06-make-a-video-stage-2/progress.md` lists finished tasks and every ruling; trust it and `git log` over memory.
- **Resume (2026-11-06, updated after the owner reviewed the stage 2 plan; the resume prompt at the top is rewritten for the new chat, whose first step is Task 1 of the plan):** the latest entries are the three bullets below (the Steady fix, the phone check, then the timeline build). Next step: get the owner's choice on the Steady levels (16/32/64 with a slow-Steadiest note, or 16/32/48) and whether to try deshake `search=less` (measure on the phone, then pick); run the levels on a really shaky clip; pinch by hand; look at the two layout fixes on the phone (made 2026-11-06 while waiting for the phone: the strip buttons are now two fixed rows, "Zoom out / Zoom in" then "Start here / End here", and the preview is 150 dp instead of 200; typecheck and the app's 16 tests pass, **not yet seen on the phone**, so check that the strip is on screen when Trim opens and that a portrait preview at 150 dp is still big enough to judge); then build stage 2 from its plan, **written 2026-11-06 while waiting for the phone: `docs/superpowers/plans/2026-11-06-make-a-video-stage-2.md`** (6 tasks: project model, compose plan, native compose job, preview view, clip strip, screen; Media3 calls checked with `javap` against 1.11.1; **not started, not yet reviewed by the owner, execution method not chosen**; its "Choices made for the owner to overrule" section lists the limits, output shape and button-based trim). Ask for the phone again first (on 2026-11-06 strongroom-sync-dc passed it to apps-hub-ad, which holds it for Model Host benchmarks of about 3 to 4 hours and sends "phone free" to strongroom-sync-dc; the queue is apps-hub-ad, then strongroom-sync-dc, then me).
- **Phone check of the timeline strip, 2026-11-05 (owner said "check in phone" and chose adb for this one test; the Store-only rule was set aside for it).** Built the signed release APK from `1f204c3` with the release tooling's own command (`assembleRelease -PappsHubVersionCode=6 -PappsHubVersionName=1.0.0`, 61,874,041 bytes, signer SHA-256 equals the pinned `SIGNING_CERT_SHA256`, arm64 only; `Waveform` is in the dex and "Start here" is in the bundle) and ran `adb install -r` over the earlier adb build: `Success`, `lastUpdateTime` 2026-11-05 15:28:04, `firstInstallTime` unchanged, installer still null. Seen on the Redmi with a 10 s, 720×1280 test clip (screenshots read): the Trim screen shows the preview frame, a playhead label, a ruler, the filmstrip, the waveform and the handle; dragging the strip moved the label to 0:04.0 and the preview frame followed; "Start here" set the start to 0:04.0, dimmed the part before it and wrote the typed boxes and the "Keeps 0:06.0, From 0:04.0 to 0:10.0" line; dragging the end handle left set the end to 0:08.2 without scrolling the strip; two taps on "Zoom in" showed seconds 9 and 10 across the screen, kept the playhead at 0:10.0 and rebuilt the tiles and the waveform. **Not yet seen on the phone:** Save a picture (the clamp at the end of the clip, the typed time moving the strip), Make a GIF, a real Start from the strip, pinch (adb cannot send two fingers, so it needs a hand), "Zoom out", "End here", a long clip, whether handle dragging stays smooth on a long strip. The phone then went to sleep and locked and wireless debugging dropped (`adb devices` and `adb mdns services` empty after `kill-server`), so the run stopped; I did not try to unlock it. Layout nits seen: the four buttons under the strip wrap, so "End here" sits alone on a second row; the 200 dp preview pushes the strip below the fold, so the strip needs a scroll to reach on first open. Left on the phone: `/sdcard/Download/design-strip-test/strip-test.mp4` (a copy of my own test clip; the picker needs a media scan and a pull to refresh to list files copied over adb), and the picker's folder memory. Test clip frames show the owner's own invitation video; none of it is described here.

- **Phone check, second part, and the Steady fix (2026-11-05, same adb exception; phone back over USB, serial `49kjmnuwonkffqzh`, the wireless transport also shows, so use `ANDROID_SERIAL`).** Seen: Save a picture with the strip at the very end of the 10 s clip (container 10.027 s, video track 10.0 s, read from the mp4 header) gave 0:10.0 in the label and the typed field, which is what `lastFrameS(10.027)` should give; Start saved `Pictures/Design Editor/strip-test (frame).png`, 720×1280, a real frame, not black. Typing `0:04.0` in the Time field scrolled the strip to 0:04.0 (label and ruler), but the preview frame stayed on the first frame: the typed seek moves the strip without moving its playhead, so `onPlayhead` never fired. Fixed in `app/media/[tool].tsx` (the picture tool previews the typed time, clamped with `lastFrameS`); not re-checked on the phone. The owner then reported that "Steadiest" in Steady a shaky video fails and "Balanced" shows no difference. Reproduced on the phone with the test clip: logcat says `deshake_0: rx must be a multiple of 16 ... Failed to inject frame into filter network: Not yet implemented in FFmpeg`. The ranges were 8, 16 and 40, so Minimum and Most stable were refused by FFmpeg 8.1 and only 16 ran (16 is also deshake's default, which explains the missing difference). The Queue showed the plain-words message "This phone couldn't process that video. Try a different setting.", so the cause was hidden from the owner. Fix: `STABILIZE_SEARCH` is now 16, 32, 64 (the filter's maximum is 64), and `FfmpegArgs.deshakeRange` snaps any older queued plan to a multiple of 16 in 16 to 64. Tests: plans test checks every level is a multiple of 16 in 16..64; `FfmpegArgsTest` checks `deshakeRange` for 8, 16, 32, 40, 64, 200. Gate (output read): root `pnpm test` exit 0 (media-core 105, app 16), `pnpm typecheck` exit 0, app lint exit 0, `:design-media:testDebugUnitTest` BUILD SUCCESSFUL, 127 JUnit tests, 0 failures. **Verified on the phone afterwards (2026-11-05, build from `a7c9549`, release APK 61,874,101 bytes, signer equal to the pinned `SIGNING_CERT_SHA256`, `adb install -r` Success, `firstInstallTime` unchanged; the adb exception covered this fix too, the owner said yes):** all three Steady levels now run on the 10 s, 720×1280 test clip: the Queue shows Done for each and each wrote a file. I did not read the FFmpeg log lines for these runs, because the phone's log buffer had rolled over by then (a lesson: dump logcat to a file right after each job). Times from the output files' modification times: 16 px about 1.4 min (finished 20:48:14), 32 px 5 min 48 s (20:54:02), **64 px 18 min 41 s** (20:54:02 to 21:12:43). The cost grows with the square of the range, so Steadiest is slow, and Balanced went from about 1.4 min to about 5.8 min when it moved from 16 to 32. Outputs are valid (the 64 px one: container 10.027 s, video 10.0 s, sound 10.048 s). The three outputs are the same size, 4,761,571 bytes, because the encoder runs at a fixed bitrate, so size does not show any difference between levels. **Not verified: whether any level visibly steadies a really shaky clip** (my test clip is not shaky), and the first-job start time is a rough guess. Also verified: Save a picture re-run with a typed `0:04.0` now moves the strip and the preview frame together; Trim with "End here" (end 0:04.0, dimmed tail, "Keeps 0:04.0", typed box), "Zoom out" (reached its limit with all 10 s in view, both handles visible), a drag then "Start here" (start 0:01.8) and a real Start, whose output `strip-test (clip).mp4` is 4.04 s with picture and sound (copy mode snaps the start to the keyframe at 0:00.0, as the screen says); Make a GIF with the strip (0:00.0 to 0:02.2) saved `strip-test.gif`, 480×853, 26 frames, looping (NETSCAPE2.0). A stray tap of mine opened the empty Trim screen once; no job was started. Still not seen: pinch (needs two fingers by hand), a long clip, drag smoothness on a long strip. Open choices for the owner: keep 16/32/64 and say Steadiest is slow, or use 16/32/48; and try deshake's less exhaustive search (`search=less`), which I have not measured and which could cut the time a lot. Cleanup left on the phone: `/sdcard/Download/design-strip-test/strip-test.mp4`, and `strip-test*` outputs in `Movies/Design Editor/` (3 stabilized, 1 clip) and `Pictures/Design Editor/` (a frame PNG and a GIF). Phone sharing: other Claude sessions were queued (strongroom-sync-dc, then apps-hub-ad for Model Host); I sent "phone free" to strongroom-sync-dc at about 21:15 after the testing above.
- **Timeline editor, stage 1 (2026-11-05, owner's request: "improve the UI/UX ... a horizontal timeline over which the user can apply start and ending boundary and move the timeline by dragging, like CapCut and Instagram Edits"; owner chose the full multi-track timeline, "Make a video", over a strip-only change).** Design `docs/superpowers/specs/2026-11-05-timeline-editor-design.md`, plan `docs/superpowers/plans/2026-11-05-timeline-strip-stage-1.md` (stages: 1 the strip in Trim, GIF and picture; 2 "Make a video" video track with join, split, trim, reorder, preview and save through Media3 `Composition` and `CompositionPlayer`; 3 sound tracks, music from phone files, volume per clip; 4 text, then templates). Built on this branch: `packages/media-core/src/timeline.ts` (pure maths, 10 tests), `apps/design-editor-mobile/src/timeline/` (`RangeStrip.tsx`, `useStripMedia.ts`, `usePreviewFrame.ts`, `latest.ts` with 2 tests), `app/media/[tool].tsx` using the strip, the two native calls `waveform` and `previewFrame` in the contract (`modules/design-media/src/index.ts`), PRD FR-14 and SPEC 7.1 and 13.2. Gate: root `pnpm test` exit 0 (media-core 103, app 15), root `pnpm typecheck` exit 0. **Not verified: any of it on a phone** (drag smoothness of handles inside a `ScrollView`, pinch under the scroll view, preview speed, the filmstrip and waveform look); the real `MediaExtractor` and `MediaCodec` decode loop in `Waveform.kt` is compile-checked only (JVM tests cover `PeakBuckets`, 6 tests). Native gate, run by me: `./gradlew :design-media:cleanTestDebugUnitTest :design-media:testDebugUnitTest :app:assembleDebug` BUILD SUCCESSFUL, JUnit result files sum to 126 tests, 0 failures (120 before). `Thumbs.write` gained a `folder` parameter (filmstrip tiles in `cache/thumbs`, the one-frame preview in `cache/preview`, each cleaned separately) and a lock per folder; `thumbnails`, `waveform` and `previewFrame` now run on their own IO scope (`.runOnQueue(readScope)`), because Expo's default queue is one `HandlerThread` shared by every module (`AppContext.kt:66` in expo-modules-core 3.0.30, which I read), so without it the filmstrip and the sound decode would have held up the file picker and Start; `Phase4RulesTest` lost its literal `File(context.cacheDir, "thumbs")` assertion for the two that fit the new code (`folder: String = "thumbs"` and `File(context.cacheDir, folder)`). A `code-reviewer` pass over the diff found, and I checked and fixed (tests added where code could be tested): the shared Expo thread above; Save a picture ignored a typed time (the strip now scrolls to it, `seekS`); scrolling to the very end in Save a picture gave a time the validator refuses (`lastFrameS`, tested); the first filmstrip request went out before the strip knew its width (`ready`); choosing the same file again left the strip out of step (a pick counter in the key); invalid or out-of-order typed times made the strip invent a range and erase the typed value when a handle moved (it keeps the last good range and writes only the field that moved; a range past the end is clamped for display); the waveform was sliced over the sound track's own length instead of the file's; a decoder that neither took input nor gave output could loop forever (now stops after about 10 s); `validate.ts` refused a 0.1 s clip when the subtraction came out as 0.0999 (tenths compare, tested); the native requests piled up behind each other during a pinch or scrub (`singleFlight`: one request at a time, only the newest waiting one kept, tested); the waveform bar count is stepped (100, 200, 400, 800) so a pinch does not rebuild 800 views per move. Gate after the fixes (output read): root `pnpm test` exit 0 (media-core 105, app 16), root `pnpm typecheck` exit 0, app lint clean, `./gradlew :design-media:cleanTestDebugUnitTest :design-media:testDebugUnitTest :app:assembleDebug` BUILD SUCCESSFUL with 126 JUnit tests, 0 failures. Not changed, needs the phone: on a zoom the strip shows the new scale at the old scroll position for a frame or two (`useEffect` plus `requestAnimationFrame`; a `useLayoutEffect` might scroll before Android has laid out the wider content and be clamped, so I did not guess). Known limits kept as shortcuts: tiles are not regenerated for the visible window (blurry when zoomed far into a long video), at most 800 waveform bars, at most 60 tiles, at most 150 ruler labels; no auto-scroll while dragging a handle near the screen edge. If dragging is janky on the phone, ask the owner for `react-native-gesture-handler` and `react-native-reanimated` (new dependencies need their yes). Question to the owner not yet answered: what is the first video they would make with "Make a video" (clips, music, text, length)? It sets the order of stages 2 to 4.
- **State (2026-11-04, session B4.1, Phase 4 in progress on branch `design-media-phase-4`, 7 local commits, nothing pushed):**
  Done and committed: the merge and audit; the owner's answers (all tools including FFmpeg, pinned `ffmpeg-kit-min` 8.1.7); `packages/media-core` Android rules (`visibleQueue`, `planFor`, `canRemux`, `formatMb`/`formatClock`, `refusalText`, Android `planClip`/`planAudio`/`planConvert`/`planQuality`; 79 tests); the phone shell (`app/(tabs)` Designs, Media, Queue with a count in the Queue label; `app/media/[tool].tsx` one setup screen for nine tools; `app/queue/all.tsx`; Clear queue with a confirm while something runs or waits; the debug lab moved to `src/lab`, reached only through `app/lab.tsx` and `__DEV__`); the plain-words test (`apps/design-editor-mobile/src/__tests__/plain-words.test.ts`, failed on today's strings first, passes now); the engine's `copy.js` (phone and Mac wording columns); the editor pass (New design asks for a page size, the property sheet now shows and the selected item scrolls above it, select-several mode, zoom kept when only the keyboard changes the height, one-time gesture hint, "Save image" wording).
  **Native half landed (commit c34af14, pushed):** the Kotlin runners for every tool in module `design-media`: a sealed `Plan` for all ten tools, a `Runner` per tool in `MediaJobService` (CBR-then-VBR still applies only to tools with a bitrate), `CopyRunner` + `RawAudioWriter` (lossless clip, remux, audio copy), Transformer variants (size, quality, exact clip, transcode, AAC audio, remove sound), `GifRunner` with an original median-cut quantizer, `StillRunner`, `FfmpegRunner` for volume, reverse and stabilize (pinned AAR), `keyframeAtOrBefore`, `thumbnails`, `resume`, `clearQueue`, `share`, `open`, and `core/Messages.kt` for every user-visible string. I re-ran the gate myself: `./gradlew :design-media:cleanTestDebugUnitTest :design-media:testDebugUnitTest :app:assembleDebug` printed BUILD SUCCESSFUL, and the JUnit result files show 116 tests, 0 failures (baseline was 44). Debug APK 83,033,425 bytes; `unzip -l` shows 0 `lib/x86_64` and 25 `lib/arm64-v8a` entries; no reference to the AAR's translation, WhisperKit or camera classes, or to `java.net`, in our native sources. Nothing was run on a phone.
- **Invariant review of the native half (2026-11-04), checked by me and fixed:** (1) BLOCKER, reproduced: the AAR calls `com.arthenica.smartexception.java.Exceptions` (`registerRootPackage`, `getStackTraceString`) but its POM declares no dependencies and none of the 21 dex files had the class, so every volume, reverse and stabilize job would have failed with `NoClassDefFoundError` (the AAR references no other missing class: `javap -v` over every class showed only that one plus `org.json`). Fixed with a stand-in `Exceptions.kt` in our module (no new dependency); a JVM test pins it, and `dexdump` of the rebuilt APK shows the class. (2) Plain-words leak: Expo wraps native errors, and two screens showed `e.message` raw; `src/media/errors.ts` `plainError` keeps only the readable sentence, with a test. (3) Data loss risk: start-up cleanup deleted every unfinished row in `Pictures/Design Editor`, which the editor's image replace-in-place also marks unfinished; cleanup now deletes only rows the queue inserted (`core/PendingLog.kt`, `pending-outputs.txt`), with tests. (4) A runner that failed while starting was polled forever; guarded. (5) The AAR hash was only a comment; `verifyFfmpegAar` in the module's `build.gradle` now fails the build on a different hash (passes on the right one, fails on a wrong one, tested both). Gate after the fixes: BUILD SUCCESSFUL, 120 JUnit tests, 0 failures; app tests 9 pass.
- **Code review of the screens, planners and editor page (2026-11-04), checked and fixed:** Remove the sound carried into Sound only and blocked Start (now `muted` only applies to a video; spec building moved into `src/media/specs.ts` with tests); Start used `router.replace` and stacked a new tab navigator each time (now `dismissTo`); Get the sound shared one track list across files and reset it when a file was added (now per file, default all, with a "converted so it plays everywhere" note for the tracks that need it); one unusable file stopped a whole batch with no name (the error names the file, and each picked file has Remove); the size correction used the H.264 history for HEVC and a different median than native (key per encoder, `correctionFrom` mirrors `EncoderStatsMath`, with tests); Clear queue skipped the question for paused and interrupted jobs; the one-time hint could overwrite a boot message (it now waits); the "stays above the sheet" smoke check passed with the scroll removed (now zoomed in first, asserts the board scrolled, and I confirmed it fails when `keepVisible` is a no-op); a GIF over 15 s now warns (FR-7); `timeText(59.97)` gave 0:60.0; refusal text said "1 minutes" and rounded 1.5 MB to 2 MB; duplicate React keys. Gate after: media-core 92 pass, app 13 pass, typecheck and lint clean, root `pnpm test` and `pnpm typecheck` exit 0, phone smoke ok. The reviewer found no problem in `visibleQueue`, `planFor`, the Android planners, the remux tables, the desktop column of `copy.js` (identical to the old strings), the `body.embedded.obj .inspector` rule or the zoom scaling in `keepVisible`.
- **Phone test over adb, 2026-11-04 (owner's explicit request; this departs from the install-via-Store rule for this one test, and the installer now reads "adb", not the Store).** I built the signed release APK locally with the release tooling's own Gradle command and key (`assembleRelease`, version 6, 61.8 MB, no publish) and ran `adb install -r` over the Store build; `firstInstallTime` stayed 2026-11-01, so it was an in-place upgrade and the data was kept. Observed on the Redmi (screenshots read, logcat, file listings): the Designs, Media and Queue tabs and plain wording render; no Media lab row; the picker, probe and file details work on `content://` files; the notification permission prompt appears at the first Start; **Get the sound** finished in under a second and saved `Music/Design Editor/p4test-small (audio 1).m4a` (164,512 bytes) with the original untouched (4,359,472 bytes); **the Queue shows exactly five rows plus "See all 21 / 16 more not shown"** (AC-15); **Change the volume (Even it out, two-pass loudness through FFmpeg)** loaded `ffmpeg-kit-min-arm64-v8a-8.1-20260712` and finished in about 2.4 s with a valid MP4 (picture copied, AAC sound); **Steady a shaky video (Balanced)** finished and wrote a 4.76 MB MP4 tagged `h264_mediacodec` with its sound kept. This is the first proof that FFmpeg runs on the phone after the missing-class fix.
- **Bugs found on the phone, fixed in code, not yet re-run on the phone:** (1) Play backwards refused a portrait clip (720×1280) with "works up to 1920×1080": the size cap compared width and height without allowing for orientation, so every portrait phone video (1080×1920) would have been refused, on the Mac too; now long side 1920 and short side 1080, with tests. (2) "Sound 1 (und)" showed the unknown-language tag; hidden. (3) The five volume choices did not fit one row ("Even it out" was cut off); now a list with a short plain explanation each. (4) Share and Open stacked into tall rows; now side by side. Seen and not fixed: scrolled lists run under the status bar; the Queue still lists the older lab jobs (21 jobs).
- **Not tested on the phone yet:** Make a GIF, Save a picture, Trim, Make smaller, Change format, Play backwards (blocked by bug 1 until reinstalled), thumbnails, Share and Open, Clear queue, Resume of the two old paused jobs, a real background batch with the app closed, the editor page changes (property sheet, select several, page-size sheet). I stopped when the screen rotated and the notification shade came to the front (the owner was probably handling the phone); I will not send more input until told the phone is free. A reinstall takes about 9 minutes over wireless debugging (62 MB at roughly 0.1 MB/s).
- **Review notes not fixed (owner or device decisions):** FFmpeg was built with network protocols (http, https, rtmp are in `libavformat.so`) and the app holds INTERNET; today the runner only passes a read-only `saf:` input, so no path reaches the network, but nothing pins it on the device. Adding `-protocol_whitelist saf,file` is a one-line hardening that I did not add because I cannot run it on a phone and a wrong whitelist would break every FFmpeg job: do it with the first device run. Licence notices do not reach the phone: the gifenc MIT notice is in `core/THIRD_PARTY_NOTICES.txt` (not packaged) and there is no About screen with the LGPL text, which the PRD risk table promised. The APK is only for the owner's own phone (NFR-8), so this is not urgent; the owner decides whether to add an About screen (it would be exempt from the plain-words list). `android/build.gradle` also adds jitpack.io as a second repository (from the Expo template).
- **Next step:** (1) run the reviewers on the diff (`invariant-reviewer` for the native change and the new dependency, `code-reviewer`), fix what they find; (2) the owner says release, then the Store phone check (AC-2 to AC-5, AC-15, AC-16, a real reverse and stabilize run, the Gmail and WhatsApp sends); (3) merge with `[skip ci]` and `pnpm release design-editor` only on the owner's word. Do not merge or release before that.
- **Native findings and limits (from the implementer; I checked the APK and sources, not the code's behaviour):** `FrameExtractor` is not in `media3-inspector` 1.11.1, so GIF and thumbnails use `MediaMetadataRetriever.getScaledFrameAtTime(OPTION_CLOSEST)` (SPEC §3 and §9.2 updated). gifenc's quantizer is derived from PnnQuant.js (MPL-2.0 per the implementer; I did not check), so `Quantizer.kt` is original (SPEC §3 corrected). `toStatusMap` now omits null fields, so JS sees `undefined` (the screens already use `??`). Media3 uses only the default audio track, so on a file with several audio tracks, "Get the sound" for a track that needs converting, and exact trim, use the first track; copies honour the track. HEVC conversions use 70 percent of the source video bitrate. Reverse at the 10 s / 1080p cap holds about 1 GB (measured on the Mac, not the phone). Not verified on a phone: every real encode, copy and GIF; `h264_mediacodec` with `-b:v`; SAF input; FFmpeg progress and the loudnorm JSON through the log callback; OGG/WebM copies; whether MediaStore keeps `.ac3`, `.eac3` and `.opus` names; R8 with the AAR (R8 is off in this app).
- **Open in Phase 4 (not done yet):** "Save image" does not offer Share (needs a content URI from `saveExport`, or `expo-sharing`, which this app does not have); `PHONE_PX` stays 8 Mpx until the owner reports build 6; the Gmail and WhatsApp checks (PRD Q3, Q4) need the owner's phone; the HyperOS battery note (FR-12) is Phase 5. Not run on a real phone: any of the new screens, the property sheet fix, select-several and the keyboard zoom.
- **Found and fixed this session:** at phone widths the editor's property sheet was `display: none` even with an item selected (a 900 px desktop media rule in `mobile.html` won), so the sheet never showed. Found by the new smoke check; fixed with `body.embedded.obj .inspector { display: block }`. Confirm on the phone.

- **State (2026-11-04, session B3.4, canvas fix released):** PR #18 (Phase 3) and PR #19 (canvas performance: pixel budget, CSS-only pinch frames, pinch no longer compounds, board scrolls, Templates sheet closed on launch) are merged into `main` (`ec23cbd`). The #19 merge commit carries `[skip ci]` on purpose so CI's own release would not race the owner's local one; `pnpm release design-editor -m "Design Editor: faster zoom and pan on the canvas"` was run locally from `ec23cbd` and published **Design Editor build 6** (45.8 MB APK). Not yet checked on the phone: the owner updates through the Store and re-runs the canvas check (zoom, pinch, one-finger pan, drag at high zoom). `PHONE_PX` in `app.js` (8 Mpx) is a first guess to tune from that check.
- **Next step:** the owner's phone check of build 6 (paste results into the phone section). Then Phase 4 on `design-media-phase-4` (its worktree is not touched by this session), rebased onto `main` first.

- **State (2026-11-04, session B3.2, Phase 3 steps 2–5 done, committed and pushed as PR #18 update):** on branch `design-media-phase-3`, PR https://github.com/haroongondal/apps-hub/pull/18 (draft, base `main`). Built this session: the engine's mobile page (`mobile.html`, `touch.js`, `shell-mobile.js`, `build.mjs`) → `assets/editor/editor.html` (3.99 MB, gitignored), the smoke test `apps/design-editor/test/mobile.mjs` chained into `test:e2e`, two shared `app.js` changes (`discardOk` async, `setZoom` export), the RN side (`app/index.tsx` Designs home, `app/media.tsx` the verbatim Phase 1 lab, `app/editor.tsx` the editor screen, `src/editor/bridge.ts`, `src/editor/files.ts`), Kotlin `saveJson`/`saveExport` (`DesignSaves.kt` + `core/Saves.kt` + `SavesTest`), the pinned deps (react-native-webview 13.15.0, expo-file-system ~19.0.24, expo-asset ~12.0.14, @expo/vector-icons ^15.0.3), and the `prepare` entry in `tools/release/src/apps.ts`. SPEC §13.2/§14/§15 carry as-built paragraphs. All verification gates green (Verified 2026-11-04). Phase 3's device checks (AC-13, AC-14) are the owner's phone run through the Store after merge.
- **Next step:** the owner hands on PR #18 (see the resume prompt at the top). After the merge, CI releases the Store build for the phone check; Phase 4 starts a fresh branch.

- **State (2026-11-03, session B3.1, Phase 3 step 1 done):** the B2.3 work is merged (PR #16, merge commit `eddf464`). On branch `design-media-phase-3`, worktree `.claude/worktrees/design-media-phase-3` (from `origin/main`, `pnpm install` done): the editor page moved into `packages/design-editor-engine` (`desktop.html`, `app.js`, `vendor/`, `package.json`, README), with `apps/design-editor/vendor/engine` as the symlink and `main.js` loading `vendor/engine/desktop.html`. The Mac e2e passes with the pinned FFmpeg fetched (media suite runs, not skipped). Next: step 2 in the resume prompt.
- **State (2026-11-03, session B2.3, superseded):** Volume, Reverse and Stabilize are built and tested on branch `design-media-capcut` (PR #16). They are the owner's yes to CapCut rows 7, 8 and 11 (see Decisions B2.3). The Mac e2e is green, with real measurements (below). PR #16 is still open on `main`. B3 waits for it to merge. The CapCut UI measurements are still blocked.

- **State (2026-11-03, session B2, Phase 2 done, committed and pushed as PR #15):** the Mac media tools are on branch `design-media-phase-2` (commit 91d37c7, from `origin/main` 8fb7b38), PR https://github.com/haroongondal/apps-hub/pull/15 into `main`. Not merged, not released (the Mac app is not a Store app). The changed files are in `packages/media-core` (ffmpeg, probe, clip, audio, gif, convert, quality, plus validate and names changes and tests), `apps/design-editor` (`media.js`, `media.html`, `media-ui.js`, `media.css`, `scripts/fetch-ffmpeg.mjs`, `test/media.mjs`, `main.js`, `preload.cjs`, `app.js`, `index.html`, `package.json`, `.gitignore`, `build/icon.icns`) and this handoff. Verification is under "Verified 2026-11-03 (session B2)".
- **Next step:** the owner decides. (a) Commit, push and open the PR with `gh` (no Claude attribution, owner's rule). Merging into `main` releases no app, because the Mac app is not in the Store and CI only releases changed Store apps. Use the pr-shipper agent when the owner says ship. (b) Or stop here. Then the next session is B3 (Media Phase 3, engine extraction and mobile canvas) on `design-media-phase-3`, from `main` after B2 is merged. Before B3, decide the open Phase 2 items above: the `<video>` preview and CSP check, and whether to test HEVC size and GIF fit-under on the Mac.

- State (2026-11-03): Phase 1 (B1) is done and merged (PR #8). Design Editor 1.0.0 (3) is released through CI and on the phone.
  The phone checks passed: batches, time-limit pause, and the S8 crash fix. B0 (Design Editor phase 2, multi-page, fonts, real
  PDF text) is merged as PR #12 (0f9cd68). Owner's accepted limit: a brand kit saved before this change keeps Avenir Next, so
  its text stays a picture in PDFs (documented in the app README and the B0 handoff).
- **Next step:** start Phase 2 (B2) per `docs/design-editor/PROMPTS.md` "Phase 2" (Mac media tools). Branch `design-media-phase-2`
  from `origin/main`, worktree `.claude/worktrees/design-media-phase-2`. Its FFmpeg choice (Martin Riedl 9.0.2, GPL, gitignored)
  is already approved (PRD Q2). Open item for it: the Mac probe must report displayed dimensions, as Android does now.
- **Cleanup pending (merged content only):** local branches `design-editor-phase-2` and `design-editor-phase-2-ff`, worktree
  `.claude/worktrees/design-editor-phase-2`, and remote `design-editor-phase-2-ship`. Their content is in 0f9cd68. Verified 2026-11-03
  that main has the same design-editor files, and the worktree is clean. Delete them when convenient.
- **Not ours, don't touch:** `clipboard` worktree (83 uncommitted files from another session), `firewall-spike` and
  `tunnelwall-firewall` (unmerged), `deputy-speed` (main checkout, unmerged, uncommitted).

- State (2026-11-01): the S0 docs are on `main` (PR #1 merged). Phase 1 steps 1–6 are done on branch
  `design-media-phase-1` (worktree `.claude/worktrees/design-media-phase-1`, from `origin/main` 03d1c7f).
  Pushed to `origin/design-media-phase-1`. Step 7 is released: Store 0.1.0 (14) and Design Editor 1.0.0 (2),
  both verified in `manifest.json` on the Store account. The owner completed the phone check on 2026-11-02,
  but the S1–S8 results are not recorded here yet.
- **Unmerged Design Editor work exists (found 2026-10-31).** Branch `design-editor-phase-2`
  (2026-10-28, handoff `docs/handoffs/design-editor-phase-2.md` on that branch) adds multi-page
  designs (file format v2), bundled fonts and real PDF text. It is e2e green and waits for the
  owner's hand check. These media docs were written against the single-page editor on `main`.
  Phase 1 doesn't touch `apps/design-editor`. Phase 2 (Mac media window) and Phase 3 (engine
  extraction) must start after that branch is merged, and Phase 3 must extract the multi-page
  editor. Use `design-media-phase-<n>` branch names to avoid the clash.
- **Owner answers recorded** (S0, 2026-10-31; see "Decisions made").
- **PR #8 merged into `main` (merge commit 757c5d1, 2026-11-02); PR #9 merged the handoff (8271e62).**
  CI released Design Editor 1.0.0 (3) (manifest verified; Store 0.1.0 (14) unchanged). The phone now runs 1.0.0 (3).
  Batches work. The earlier "queue loss" was not real (see the correction below). Still open, in order:
  (a) re-check the lab's queue rows on screen (the rows need scrolling, and the S8 row was not read); (b) the
  B0 hand check, which is its own session on `design-editor-phase-2`; Phase 2 waits for (b).
- **Current (2026-11-02):** the phone check ran over adb (see "Phone check 2026-11-02"). Owner gates, in order:
  (1) unlock the phone (it is locked behind a PIN and the lab queue can't be read until then); (2) decide the default encoder
  order (S4 favours CBR first); (3) release go for a new build with the onTimeout fix (1.0.0 code 3), so S8 can be re-tested
  on the phone; (4) then the B1 PR, B0 hand check and merges, as before.
- _Superseded 2026-11-02 (kept for history):_ the owner installs Design Editor from the Store (never `adb install`) on the
  Redmi Note 14 Pro 4G, with the five test clips (SPEC §16.3), and runs S1–S8 in the Media lab. Paste the
  results here, then tune `budget.ts` (FLOOR, margin, overhead) and the fixtures, and re-run step 6.
  Release note: the Store was released too (owner request, 2026-11-01), so the Store carries
  origin/main's code, not the uncommitted Store work in the main checkout.
  B0 (ship the multi-page branch) whenever the owner is ready. B0 and B1 must both be merged before B2.
- **Open for later phases:** the Mac probe must report display dimensions, as Android does now.
  Verify FrameDropEffect on lower-fps sources (S5). `SYSTEM_ALERT_WINDOW` is debug-only (release clean).
- **2026-11-03 (session B3.1, Phase 3 step 1: engine extraction).** PR #16 merged, so B3 started. Worktree `.claude/worktrees/design-media-phase-3` from `origin/main` (eddf464), branch `design-media-phase-3`, `pnpm install` (1054 packages, exit 0). Moved `index.html` → `packages/design-editor-engine/desktop.html`, `app.js` and the vendor files (Fabric, pdf-lib, fontkit, fonts) with `git mv`, added the engine's `package.json` and README, and the `vendor/engine` symlink. Font URLs and the stylesheet path were made page-relative. `main.js` loads `vendor/engine/desktop.html`. Fetched the pinned FFmpeg (`pnpm --filter design-editor ffmpeg`, hash-checked). The full Mac e2e passed. Verification is under "Verified 2026-11-03 (session B3.1)". Stopped at a milestone on the owner's request, before step 2. SPEC §14.1 records the as-built layout.
- **2026-11-04 (session B3.2, Phase 3 steps 2–5: mobile canvas + RN shell).** Built the mobile page and its
  touch layer (`mobile.html` with embedded CSS, `touch.js`, `shell-mobile.js`, `build.mjs`), the smoke test
  `test/mobile.mjs` (three-suite e2e green), the RN designs home/editor/media routes with the bridge and file
  layers, and Kotlin saveJson/saveExport with MediaStore placement. Three real bugs were found by walking the
  interactions and the smoke test, and fixed: the embedded class sat on `<html>` (never matched the
  `body.embedded` CSS), the action sheet bypassed `closeSheet()` so Fabric stayed walled after an action, and
  the smoke test's first draft mis-assumed the wire schema (rewritten against `shell-mobile.js` as the truth).
  The hand control stays with the owner: PR #18, then the Store phone check after merge. Verification is under
  "Verified 2026-11-04 (session B3.2)".
- **2026-11-04 (session B3.4, canvas performance, branch `design-canvas-perf` from `main` after PR #18).** The owner's phone check of Store build 5 reported a slow, unresponsive canvas on zoom and poor canvas UX. Reproduced in `test/mobile.mjs`'s device setup at 2.75x: the backing store reached 141 Mpx a layer at 400% (551 ms a zoom step on the Mac). Causes found and fixed in `app.js`, `touch.js`, `mobile.html`: (1) no pixel budget, now 8 Mpx a layer on the phone (zoom steps at 3-4x: 32-50 ms); (2) every pinch frame resized the backing store, now CSS-only frames plus one sharp redraw on release; (3) the pinch multiplied the already-updated zoom by the same distance ratio on every move event, so a held pinch compounded (the old smoke test even logged "pinch 234%" for a 2x spread), now scaled from the zoom at gesture start; (4) zoom panned by `relativePan` inside a canvas the size of the page, so zoomed-in content was clipped and `touch-action: none` blocked scrolling, now the board scrolls (two-finger pan, one finger on empty space); (5) the Templates sheet was open on launch and hid the lower half of the page, now closed. Marquee select is off on the phone. Gates: `test:e2e` three suites, `pnpm test`, `pnpm typecheck` (exit 0). Not on a real phone yet: the fix needs a Store release (owner's go). Tune `PHONE_PX` after the phone check.
- **2026-11-04 (session B3.4, release).** PR #19 squash-merged (`ec23cbd`, `[skip ci]`), then released locally: Design Editor build 6 published (exit 0). The Store build 5 problems the owner reported are fixed in code and covered by `test/mobile.mjs`; the real-phone confirmation is still open.

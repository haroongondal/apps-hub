# Phase prompts: Design Editor media tools and the mobile Design Editor

Feed one phase per session, strictly in order (1 → 6; 6 is optional). Run Claude Code with
`apps-hub/` as the working directory so `AGENTS.md` and `CLAUDE.md` load. Wait for each phase to
pass its verification commands, and for the owner's phone checks where a phase has them, before
starting the next. Every phase ends by updating `docs/handoffs/design-editor-media.md`.

## Prelude for any NEW chat (paste this first, then the phase prompt)

```text
You are building the media tools of Design Editor and its new Android version, in the apps-hub
monorepo (pnpm, Expo SDK 54, React Native 0.81.5, TypeScript 5.9, Electron 44).
Project root: /Users/outsentia/Documents/apps-hub. Make it your working directory and touch
nothing outside it.

Before any code, read in full: AGENTS.md, CLAUDE.md, apps/design-editor/CLAUDE.md,
docs/design-editor/PRD.md, docs/design-editor/SPEC.md, and docs/handoffs/design-editor-media.md
(trust its verified facts; don't redo them). Read docs/design-editor/RESEARCH.md for the section
a step cites.

Fixed rules:
- The six data-safety rules in PRD §5 are never violated, and each has a test.
- Erasable TypeScript only, imports with the .ts extension; a new *.test.ts must be added to its
  package's "test" script by name.
- UI from @apps-hub/ui only (brand "design"); sentence case; no emoji icons.
- FOSS only, no telemetry. Any dependency not approved in the handoff needs the owner's yes
  first (use the upgrading-dependencies skill when pnpm refuses an install).
- Android installs go through the private Store only (pnpm release design-editor), never
  adb install. adb shell for reading logs or device_config is fine.
- Commit, push or release only when the owner says so. Confirm the Cloudflare account before
  any Store deploy. CI auto-releases changed Store apps on pushes to main: stay on a branch.
- Check every Android API against
  /opt/homebrew/share/android-commandlinetools/platforms/android-36/android.jar (javap) before
  using it.

Run the phase's verification commands and report their ACTUAL output, never predicted output.
Complete only the phase prompt that follows, then stop. Follow the handoff contract in
~/.claude/CLAUDE.md: update the handoff's session log, evidence and next step as milestones land.
```

## Phase 1: media-core and the Android encoder spike (PRD NFR-1, NFR-3; SPEC §5, §7, §10, §11, §18)

```text
Read the prelude files, then SPEC §5, §7, §10, §11, §15, §17 and §18, and RESEARCH §3, §4, §6.

We are executing Phase 1: prove the riskiest thing first, the phone's encoder path and
target-size accuracy on the owner's Redmi Note 14 Pro 4G (MediaTek Helio G100 Ultra). No canvas,
no media screens yet.

1. packages/media-core (@apps-hub/media-core), pure TS, no runtime dependencies:
   types.ts, presets.ts, budget.ts (planSize), retry.ts (nextSizeAttempt), validate.ts,
   names.ts, queue.ts (reduce, nextRunnable), index.ts. Fixtures: budget-cases.json with every
   row of SPEC §10.3, retry-cases.json (the R§6.6 A retry and a give-up case), job-examples.json.
   Tests: one *.test.ts per module, all listed in package.json "test"; "typecheck": "tsc --noEmit".
2. apps/design-editor-mobile: Expo SDK 54 app copied in shape from apps/pdf-editor-mobile
   (expo-router, metro.config.js, eslint, lint/typecheck/doctor scripts), package
   com.haroon.designeditor, ThemeProvider brand="design", android.minSdkVersion=35,
   reactNativeArchitectures=arm64-v8a (PRD Q8), blockedPermissions and allowBackup="false"
   (manifest and app.json) from SPEC §12.1. Draw one
   new icon mark for both Design Editor apps as assets/icon.svg (SPEC §13.3; the Mac app has
   none) and render it with node tools/icons/render-icon.mjs. One tab only for now: "Media lab" (SPEC §13.2).
   Commit android/ after prebuild (repo convention). Depends on @apps-hub/media-core.
3. modules/design-media (Expo local module, Kotlin, package expo.modules.designmedia):
   probe, codecReport, persistAccess, freeBytes, encoderStats, enqueue (size jobs only), cancel,
   queue, onJobProgress/onQueue events. MediaJobService (mediaProcessing FGS, onTimeout,
   Cancel action), TransformerRunner for size jobs (VBR first, CBR once on start failure),
   RetryRule.kt mirroring retry.ts, JobQueue/QueueStore, Outputs.publish to
   Movies/Design Editor, EncoderStats. build.gradle: Media3 1.11.1 (transformer, effect,
   inspector), kotlinx-serialization-json 1.8.1, junit 4.13.2. JVM tests: RetryRuleTest and
   PlanJsonTest reading packages/media-core/fixtures, JobQueueTest, QueueStoreTest,
   EncoderStatsMathTest.
4. Media lab screen: pick files (expo-document-picker, copyToCacheDirectory false), show
   codecReport and probe output, run a 20 MB size job in H.264 or HEVC, show per-attempt planned
   vs actual bytes, seconds and attempts, a "Copy results" button. Buttons for spikes S1–S8.
5. Release plumbing: add 'design-editor' to tools/release/src/apps.ts (no prepare step yet),
   add com.haroon.designeditor to the Store's <queries>, add it to the developer-verification
   checklist in docs/app-store.md and to "Current apps" in AGENTS.md.
6. Verify (report ACTUAL output):
   pnpm --filter @apps-hub/media-core test
   pnpm test
   pnpm typecheck
   cd apps/design-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew \
     :design-media:testDebugUnitTest :app:assembleDebug
   pnpm --filter design-editor-mobile lint
   pnpm --filter design-editor-mobile typecheck
   pnpm --filter design-editor-mobile doctor
7. When the owner says so: pnpm release store -m "Store: see Design Editor", then
   pnpm release design-editor -m "Design Editor: media lab". The owner installs it from the
   Store and runs the spikes on the five test clips (SPEC §16.3). Record S1–S8 results, the
   measured overhead, overshoot ratios, attempts and seconds in the handoff, then tune FLOOR,
   margin and overhead in budget.ts and the fixtures to match, and re-run step 6.
```

## Phase 2: Mac media tools (PRD FR-1 to FR-10 on the Mac, AC-9 to AC-12; SPEC §6, §9.1, §13.1)

```text
Read the prelude files, then SPEC §2, §6, §9.1, §11.2, §13.1, §16.4 and RESEARCH §5, §7, §8, §11.

We are executing Phase 2: the six media tools in the existing Electron Design Editor, run by
FFmpeg from the main process. The canvas does not change except one "Media" rail button.

0. Icon (PRD Q9): build apps/design-editor/build/icon.icns from
   apps/design-editor-mobile/assets/icon.svg (SPEC §13.3) and add --icon=build/icon.icns to
   the "dist" script.

1. scripts/fetch-ffmpeg.mjs + "ffmpeg" script in apps/design-editor/package.json: pinned FFmpeg
   and FFprobe (the owner's choice in the handoff, PRD Q2), SHA-256 check, ditto unzip, chmod,
   VERSION with the configure line, refuse --enable-nonfree. Gitignore vendor/ffmpeg/.
   Confirm with `vendor/ffmpeg/ffmpeg -h encoder=h264_videotoolbox` that there is no two-pass
   option and record the encoder list in the handoff.
2. media-core: ffmpeg.ts (ffmpegArgs per SPEC §9.1, parseProgress, ffprobeArgs, keyframeArgs),
   probe.ts (fromFfprobe with captured JSON fixtures), clip.ts, audio.ts, gif.ts, convert.ts,
   with tests listed in package.json.
3. vendor/media-core symlink to ../../../packages/media-core/src (like vendor/ui).
   media.js in apps/design-editor: IPC handlers from SPEC §6.1, ids-not-paths rule (§6.2),
   sequential queue with media-core reduce, spawn with progress, cancel (q then SIGKILL after
   3 s), size check and retry, temp dir cleanup, encoder stats, powerSaveBlocker, quit
   confirmation. preload.cjs gains window.native.media. Menu item id 'media' (⇧⌘M) and a rail
   button on the canvas page.
4. media.html + media-ui.js + media.css: the window in SPEC §13.1 using vendor/ui tokens. Check
   whether a <video> preview of a picked file works under the current CSP from file://; if not,
   register a media: protocol in main that serves only granted inputs with Range support, and add
   media-src for it. Record which in the handoff.
5. test/media.mjs added to "test:e2e": generated inputs (testsrc2 + two sine tracks, 60 s),
   every tool, sizes at or under target, durations, track counts, input SHA-256 unchanged,
   unknown ids and out-of-folder writes refused, cancel leaves no .part, quit with a job asks.
   Skips with a clear message when vendor/ffmpeg is missing.
6. Verify (report ACTUAL output):
   pnpm --filter design-editor ffmpeg
   pnpm --filter @apps-hub/media-core test
   pnpm test
   pnpm typecheck
   pnpm --filter design-editor test:e2e
   pnpm --filter design-editor dist
   Then open dist/Design Editor-darwin-arm64/Design Editor.app, compress one real 60 s 1080p
   clip to 20 MB and record size, attempts and seconds against AC-10.
```

## Phase 3: engine extraction and the mobile canvas (PRD FR-11, AC-13, AC-14; SPEC §14)

```text
Read the prelude files, then SPEC §14, §15, .claude/rules/ui-and-pdf-engine.md,
packages/pdf-editor-engine/README.md and apps/pdf-editor-mobile/CLAUDE.md.

We are executing Phase 3: move the Design Editor page into packages/design-editor-engine and
run it in the Android app by touch. The Mac app must behave exactly as before.

1. packages/design-editor-engine: desktop.html (from index.html), app.js, vendor/, README.md.
   apps/design-editor/vendor/engine symlink; main.js loads vendor/engine/desktop.html. The
   existing e2e suite passes unchanged apart from paths.
2. mobile.html (bottom strip, sheets), touch.js (pinch zoom around the midpoint, two-finger pan,
   larger controls, long-press actions; check that Fabric 7 has touchCornerSize, else set
   cornerSize on mobile), shell-mobile.js (window.native over postMessage with reqIds, SPEC
   §14.3), build.mjs (PDF engine's checks) writing
   apps/design-editor-mobile/assets/editor/editor.html (gitignored). Exports over 30 MB refused
   with the SPEC's message.
3. design-editor-mobile: Designs tab and Editor screen (WebView, native top bar, bottom toolbar
   sending menu commands), src/editor/bridge.ts (frozen schema), autosave file, open/save .json
   through the document picker, exports through Outputs/Share. prestart and the release prepare
   step run the engine build: add prepare to the 'design-editor' entry in
   tools/release/src/apps.ts.
4. A mobile smoke test like pdf-editor-desktop's test/mobile.mjs: mobile.html in system Chrome
   with a fake ReactNativeWebView, open a template, export PNG through the fake bridge. Add it
   to apps/design-editor's "test:e2e".
5. Verify (report ACTUAL output):
   node packages/design-editor-engine/build.mjs
   pnpm --filter design-editor test:e2e
   pnpm test
   pnpm typecheck
   pnpm --filter design-editor-mobile lint
   pnpm --filter design-editor-mobile typecheck
   pnpm --filter design-editor-mobile doctor
   cd apps/design-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew \
     :design-media:testDebugUnitTest :app:assembleDebug
6. When the owner says so: pnpm release design-editor -m "Design Editor: canvas on the phone".
   The owner installs from the Store and runs AC-13 and AC-14; record how drag and pinch feel on
   the phone. If editing is sluggish, stop and report before Phase 4.
```

## Phase 4: Android media screens (PRD FR-2 to FR-10 on the phone, AC-2 to AC-5; SPEC §9.2, §13.2)

```text
Read the prelude files, then SPEC §7, §9.2, §9.3, §10.5, §12.1, §13.2 and RESEARCH §4.3, §7, §8.

We are executing Phase 4: every media tool on the phone, as React Native screens beside the
canvas. Media bytes never cross a bridge.

1. design-media: keyframeAtOrBefore, thumbnails, share, open, clearFinished, resume; runners for
   quality, clip copy (CopyRunner), clip exact (trim optimisation), audio (CopyRunner,
   RawAudioWriter, Transformer audio-only), GIF (GifRunner with FrameExtractor or the fallback
   chosen in spike S5; GifEncoder, Quantizer, Dither ported from gifenc with its MIT notice),
   convert (remux or transcode). JVM tests: GifEncoderTest, QuantizerTest, DitherTest, and
   RetryRuleTest extended with gif-cases.json.
2. media-core: planGif/nextGifAttempt, planClip, planAudio, planConvert/canRemux for the Android
   platform tables, with tests and fixtures.
3. Screens: Media tab, media/[tool] setup (SPEC §13.2), Queue tab with results, Share and Open.
   Clip preview per the owner's answer to PRD Q7.
4. Verify (report ACTUAL output):
   pnpm --filter @apps-hub/media-core test
   pnpm test
   pnpm typecheck
   pnpm --filter design-editor-mobile lint
   pnpm --filter design-editor-mobile typecheck
   pnpm --filter design-editor-mobile doctor
   cd apps/design-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew \
     :design-media:testDebugUnitTest :app:assembleDebug
5. When the owner says so: pnpm release design-editor -m "Design Editor: media tools". On the
   phone: AC-2, AC-3, AC-4, AC-5 with the test clips, plus the Gmail check (attach an 18 MB and a
   24 MB output; note which becomes a Drive link) for PRD Q3, and one WhatsApp send of a 16 MB
   output (PRD Q4; if WhatsApp takes more, the owner may raise the preset). Record results in
   the handoff.
```

## Phase 5: batch queue and background work (PRD FR-9, FR-12, AC-1, AC-6 to AC-8; SPEC §8, §11.1)

```text
Read the prelude files, then SPEC §8, §11.1, §12.1 and the spike S3 and S8 results in the
handoff.

We are executing Phase 5: batches that keep running with the app in the background or swiped
away, with honest handling of Android's limits.

1. MediaJobService: progress notification "Compressing n of m" with Cancel, summary notification
   that opens the Queue tab, onTimeout → paused (time-limit), interrupted jobs on load,
   free-space check, cleanup of cache and own pending MediaStore rows on start.
2. Queue tab: Resume for paused and interrupted jobs, Cancel all, Try again, clear finished.
   Notification permission asked before the first batch. If S3 showed HyperOS kills swiped
   batches, add the one-time battery note with a button to the app's battery settings.
3. Encoder stats feed planSize's correction (median of the last five, clamped 0.8–1.5).
4. Verify (report ACTUAL output):
   pnpm --filter @apps-hub/media-core test
   pnpm test
   pnpm typecheck
   pnpm --filter design-editor-mobile lint
   pnpm --filter design-editor-mobile typecheck
   pnpm --filter design-editor-mobile doctor
   cd apps/design-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew \
     :design-media:testDebugUnitTest :app:assembleDebug
5. When the owner says so: pnpm release design-editor -m "Design Editor: background batches".
   On the phone: AC-1, AC-6, AC-7, and AC-8 with
   adb shell device_config put activity_manager media_processing_fgs_timeout_duration 60000
   (reset it afterwards with: adb shell device_config delete activity_manager
   media_processing_fgs_timeout_duration). Record results and the success metrics (PRD §7).
```

## Phase 6 (optional): iOS (SPEC §7.3)

```text
Read the prelude files, then SPEC §7.3, RESEARCH §13 and docs/app-store.md "iOS (later)".

We are executing Phase 6, only if the owner asks: the iOS side of design-editor-mobile. No
installs on an iPhone without a paid Apple developer account; the simulator only.

1. Add "ios" to app.json platforms; npx expo prebuild --platform ios (leave the committed
   android/ alone); commit ios/ (repo convention).
2. modules/design-media/ios: the Swift functions and events of SPEC §7.3 with AVFoundation
   pipelines and BGContinuedProcessingTask for batches (iOS 26). The same media-core plans; the
   GIF encoder ported to Swift or ImageIO.
3. Verify (report ACTUAL output):
   pnpm test
   pnpm typecheck
   pnpm --filter design-editor-mobile typecheck
   cd apps/design-editor-mobile/ios && pod install && xcodebuild -workspace DesignEditor.xcworkspace \
     -scheme DesignEditor -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
     -configuration Debug build CODE_SIGNING_ALLOWED=NO
   (Use the workspace and scheme names prebuild actually generates.)
```

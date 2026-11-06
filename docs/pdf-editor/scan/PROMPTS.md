# Phase prompts: Scan and Library in PDF Editor (one phase per session, in order 1 → 6)

Run the session with `apps-hub/` as the working directory so `AGENTS.md` and `CLAUDE.md` load.
Start each phase only after the previous one passed its verification commands and the owner
tested its Store release. Phase 1 (Library) is shared. The owner chose the scanner first
(2026-10-31): Phases 1–4 here run before Reader Phase 1, in the order in
`docs/build-sessions.md`.

Before Phase 1, the owner answers the open questions in `docs/pdf-editor/scan/PRD.md` §10
and approves the dependencies in `docs/pdf-editor/scan/SPEC.md` §2. The answers go in
`docs/handoffs/pdf-editor-scan.md` under "Decisions made" (done 2026-10-31, session S0). A prompt that depends on an
answer says so.

## Prelude for any new chat (paste this first, then the phase prompt)

```text
You are building the Scan feature and the shared Library of PDF Editor
(apps/pdf-editor-mobile; release id pdf-editor; Android package com.haroon.pdfeditor) in
the apps-hub monorepo: Expo SDK 54, React Native 0.81.5, TypeScript 5.9, pnpm.
Project root: /Users/outsentia/Documents/apps-hub. Make it your working directory and
touch nothing outside it.

Before any code, read in full: AGENTS.md, CLAUDE.md, apps/pdf-editor-mobile/CLAUDE.md,
docs/handoffs/pdf-editor-scan.md (owner decisions, verified facts, current state),
docs/pdf-editor/scan/PRD.md and docs/pdf-editor/scan/SPEC.md. Use
docs/pdf-editor/scan/RESEARCH.md for facts; trust what it marks verified.

Rules: FOSS only, zero telemetry, no Google Play services, ML Kit, Firebase or LiteRT.
Add only dependencies the owner approved in the handoff. UI only from @apps-hub/ui,
sentence-case copy, no emoji icons. Erasable TypeScript with .ts import extensions. A new
*.test.ts does nothing until it is listed in its package's "test" script. Native code
lives in apps/pdf-editor-mobile/modules/pdf-scan; check Android APIs against
$ANDROID_HOME/platforms/android-36/android.jar. Install on the phone only through the
Store (pnpm release pdf-editor), never adb install. Confirm the Cloudflare account before
any release. Commit only when the owner asks.

Environment for native commands:
  export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
  export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools

Verify by running the phase's commands and report the ACTUAL output, never predicted
output. Update docs/handoffs/pdf-editor-scan.md (session log, current state, exact next
step) as milestones land. Complete only the phase prompt that follows, then stop.
```

## Phase 1: Library foundation (FR-1 to FR-7; AC-1, AC-2, AC-3, AC-14)

```text
Read docs/pdf-editor/scan/SPEC.md §4, §5, §11 (the "/" rows and the two sheets) and §12
(library-core), and PRD FR-1 to FR-7.

We are executing Phase 1: Library foundation. Reader builds on this too, so keep to the
contract in SPEC §4 exactly: names, schema, tracks, file layout and API.

1. packages/library-core (@apps-hub/library-core), set up like packages/core
   (package.json with "test" and "typecheck", tsconfig extending
   packages/config/tsconfig.base.json):
   - sql.ts: RawSql, SqlPort, serialPort() (writes queued; BEGIN IMMEDIATE … COMMIT on
     the same connection; tx bypasses the queue; nested transaction throws).
   - migrate.ts (schema_tracks, per-feature tracks, 'too_new'), schema.ts (the 'library'
     track, SPEC §4.2 verbatim), fts-query.ts, normalize.ts (normalizeForSearch, SPEC
     §4.3: used by ftsQuery, setBody and the FTS title writes), errors.ts, library.ts (SPEC §4.6, with
     the validation rules), orphanDirs and ITEM_ID, index.ts.
   - Tests in src/__tests__ per SPEC §12, against node:sqlite through a node-sql.ts
     helper (the pattern in apps/open_tunnel_vpn/src/data/__tests__). List every test
     file in the "test" script.
2. App wiring (apps/pdf-editor-mobile):
   - Add "@apps-hub/library-core": "workspace:*" and expo-sqlite
     (pnpm --filter pdf-editor-mobile exec expo install expo-sqlite), then pnpm install.
   - src/library/: sql-expo.ts (RawSql over runAsync/getAllAsync/getFirstAsync/execAsync),
     open-library.ts (one connection; PRAGMA journal_mode = WAL, foreign_keys = ON,
     busy_timeout = 5000; Library.open; never withExclusiveTransactionAsync), ids.ts,
     files.ts (library/<id>/ paths, atomic writes via .tmp + move, directory size),
     sweep.ts (start-up sweep and empty cache/export), add-actions.ts, open-item.ts,
     use-library.ts (reload on focus and after writes).
   - Hermes check (SPEC §4.3): in an emulator debug build, log
     '\uFEFC'.normalize('NFKC') once at start-up and confirm it is 'لا' (U+0644 U+0627).
     Record the result in the handoff's verified facts, then remove the log.
   - app/index.tsx becomes the Library (SPEC §11): search with snippets, Segmented kinds
     (hidden while only one kind exists), tag filter sheet, folders with a breadcrumb
     (route param folder), sort recent / title, Empty state, the add sheet ("Open a PDF",
     "New folder"; Scan and Import arrive in Phases 2 and 3, so don't show them yet) and
     the item sheet (rename, move, tags, share, delete with confirmation).
   - "Open a PDF": copy into library/<id>/document.pdf, create the item in the current
     folder, open the editor with uri, name and itemId.
3. Editor integration (SPEC §5): add the docInfo page event on both sides
   (src/editor/bridge.ts; packages/pdf-editor-engine/core.js and mobile.html; the desktop
   adapter stays without it), extend apps/pdf-editor-desktop/test/mobile.mjs to assert
   one docInfo, handle docInfo in app/editor.tsx (body, page count, thumb.jpg, size), add
   the 28 MB size guard, and on save add the edited PDF as a new item before sharing
   (owner, PRD Q4).
4. Docs: packages/pdf-editor-engine/README.md (docInfo), apps/pdf-editor-mobile/CLAUDE.md
   (the library, src/library), AGENTS.md (the PDF Editor line mentions the library).
5. Set expo.version to 1.1.0 in apps/pdf-editor-mobile/app.json.
6. Verify (report ACTUAL output):
   pnpm --filter @apps-hub/library-core test
   pnpm test
   pnpm typecheck
   pnpm --filter pdf-editor-mobile lint
   pnpm --filter pdf-editor-mobile typecheck
   pnpm --filter pdf-editor-mobile doctor
   node packages/pdf-editor-engine/build.mjs
   pnpm --filter pdf-editor-desktop test:e2e
   cd apps/pdf-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew :app:assembleDebug
7. When the owner says to release: confirm the Cloudflare account, then
   pnpm release pdf-editor -m "Library: folders, tags and search"
   The owner installs it from the Store and runs AC-1, AC-2, AC-3 and AC-14 (with a PDF).
   Record the results in the handoff.
```

## Phase 2: Camera and detection (FR-8, FR-9; AC-4, AC-5, AC-12, AC-13)

```text
Read docs/pdf-editor/scan/SPEC.md §6, §7.1 to §7.4, §10, §12 (Kotlin), §15 (S1 to S4)
and PRD FR-8, FR-9, NFR-1, NFR-5. Follow the native-module conventions of
apps/deputy/modules/deputy-agent (layout, build.gradle, JVM tests).

We are executing Phase 2: Camera and detection. No page processing or OCR yet.

0. Baseline, before adding anything:
   cd apps/pdf-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew :app:dependencies \
     --configuration releaseRuntimeClasspath | grep -E 'mlkit|play-services|firebase|litert'
   Record the output in the handoff (expected: nothing).
1. Create apps/pdf-editor-mobile/modules/pdf-scan: package.json (name "pdf-scan", so
   Gradle sees :pdf-scan), expo-module.config.json (platforms ["android"], module
   expo.modules.pdfscan.PdfScanModule), android/build.gradle (CameraX 1.6.2 core,
   camera2, lifecycle, view; junit 4.13.2 for tests), android/src/main/AndroidManifest.xml
   (CAMERA, uses-feature camera.any required=false). Add the module as a dependency of
   the app the way apps/deputy does, and pnpm install.
2. Pure Kotlin in core/ (no android.* imports): Luma, DetectorConfig, QuadDetector
   (SPEC §7.2), QuadStabilizer (SPEC §7.3, clock injected). JVM tests per SPEC §12:
   QuadDetectorTest (synthetic pages, out-of-frame, blank, clutter) and QuadStabilizerTest.
   If the owner supplies real frames, add them as 320×240 PGM with corners.json.
3. android/ScanCameraView.kt (SPEC §7.4): Preview + ImageAnalysis 640×480
   KEEP_ONLY_LATEST + ImageCapture largest 4:3; overlay outline in accentColor with the
   progress ring; Camera2Interop AF state for the focus gate; FocusMeteringAction on
   HOLDING; capture → upright JPEG ≤ 3,000 px in sessionDir → re-detect → onCapture;
   active=false unbinds. PdfScanModule.kt: getCameraPermission, requestCameraPermission
   and the View (SPEC §6.2). Only these go in src/index.ts for now (SPEC §6.1 note).
4. App: src/scan/session.ts (scan-session/session.json, atomic writes, SPEC §7.1);
   app/scan/capture.tsx (SPEC §11: hints, torch, Auto/Manual, shutter, count, Done,
   haptics via expo-haptics, accessibility announcements, pause the screen's camera when
   blurred); the permission flow with the "Open settings" Notice; add "Scan a document"
   to add-actions; the Library's unsaved-scan Notice ([Resume] reopens capture,
   [Discard] deletes scan-session/). "Done" returns to the Library for now; review comes
   in Phase 3.
5. Manifest: in android/app/src/main/AndroidManifest.xml add xmlns:tools and the four
   tools:node="remove" entries (SPEC §10); mirror them in app.json
   android.blockedPermissions. Set android:allowBackup="false" on <application> and
   android.allowBackup: false in app.json (PRD Q5). Set
   reactNativeArchitectures=arm64-v8a in android/gradle.properties (PRD Q3, approved).
6. Spikes S1 to S4 on the phone (SPEC §15) with a Store build; record numbers and
   decisions in the handoff, then tune DetectorConfig and the stabiliser constants.
7. Docs: apps/pdf-editor-mobile/CLAUDE.md (the module, its Gradle gate), AGENTS.md
   (Verification Commands: the PDF Editor native gate).
8. Set expo.version to 1.2.0.
9. Verify (report ACTUAL output):
   pnpm test
   pnpm typecheck
   pnpm --filter pdf-editor-mobile lint
   pnpm --filter pdf-editor-mobile typecheck
   pnpm --filter pdf-editor-mobile doctor
   cd apps/pdf-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew \
     :pdf-scan:testDebugUnitTest :app:assembleDebug
   JAVA_HOME=$JAVA_HOME ./gradlew :app:dependencies --configuration releaseRuntimeClasspath \
     | grep -E 'mlkit|play-services|firebase|litert'      # must match the step 0 baseline
10. Release (owner's go; Cloudflare account confirmed):
   pnpm release pdf-editor -m "Scan: camera with automatic page capture"
   Then on the release APK:
   $ANDROID_HOME/build-tools/36.0.0/zipalign -c -P 16 -v 4 \
     apps/pdf-editor-mobile/android/app/build/outputs/apk/release/app-release.apk | tail -1
   $ANDROID_HOME/build-tools/36.0.0/aapt dump permissions \
     apps/pdf-editor-mobile/android/app/build/outputs/apk/release/app-release.apk
   unzip -l apps/pdf-editor-mobile/android/app/build/outputs/apk/release/app-release.apk \
     | grep -o 'lib/[^/]*/' | sort -u
   ls -l apps/pdf-editor-mobile/android/app/build/outputs/apk/release/app-release.apk
   The owner installs from the Store and runs AC-4, AC-5 and AC-12. Record the results.
```

## Phase 3: Pages and PDF (FR-10, FR-11, FR-12, FR-14 without text, FR-15 to FR-17; AC-6, AC-7, AC-14, AC-15)

```text
Read docs/pdf-editor/scan/SPEC.md §4.2 (the 'scan' track), §4.7, §6, §7.1, §7.5, §7.6
(ScanService without runOcr), §8, §9, §11 (review, scan view, page view), §12 and §15
(S7), and PRD FR-10 to FR-17.

We are executing Phase 3: Pages and PDF. No OCR yet: the PDF has images only, and
scan_pages rows are created with ocr_state 'pending' so Phase 4 picks them up.

1. Native: core/PageGeometry.kt, core/Filters.kt (auto, gray, Sauvola bw with half-
   resolution statistics), core/BitPack.kt; android/PageProcessor.kt (importImage,
   detectQuad, processPage per SPEC §7.5, .tmp + rename, bitmaps recycled). Add the three
   functions to PdfScanModule.kt and src/index.ts. JVM tests: FiltersTest,
   PageGeometryTest (AC-7: warped corners within 2 px), BitPackTest.
2. packages/scan-core (@apps-hub/scan-core), set up like library-core: types.ts,
   scan-store.ts (the 'scan' track, SPEC §4.2 verbatim; pageTexts(itemId) for Reader's
   read-aloud, SPEC §4.7), scan-service.ts (saveSession,
   editPage, reorder, deletePage, documentText, buildPdf; pause/resume and onProgress
   can wait for Phase 4), pdf-writer.ts (SPEC §8: images and page tree; write the font
   and text-layer code too, driven by the words passed in, which are empty until Phase 4),
   glyphless-font.ts (copy pdf.ttf from Tesseract's src/api/pdf_ttf.h with its Apache-2.0
   header; generate the 150-byte CIDToGIDMap constant once), jpeg.ts, paper.ts,
   index.ts. Tests per SPEC §12 including no-network.test.ts; list each in "test".
3. App: app/scan/review.tsx with src/scan/crop-editor.tsx (gesture-handler + reanimated,
   44 dp handles, edges as rotated Views), filters, rotate, retake, delete, move
   left/right, apply to all, title, Save; quick previews with maxLongSide 1200.
   Capture's "Done" now opens review. app/scan/[id].tsx and app/scan/page.tsx (SPEC §11).
   "Import photos" (expo-image-picker, multiple, photo picker; each through importImage)
   and "Add pages" (session with appendTo). Share PDF: buildPdf to cache/export via
   FileHandle.writeBytes, then expo-sharing. Open in editor: buildPdf, size guard, editor
   with itemId (its save follows Phase 1). Register kind 'scan' in open-item.ts and
   "Import photos" in add-actions.ts.
4. Spike S7: real sizes per page on the phone; record them and adjust JPEG quality if
   NFR-2 is missed.
5. Set expo.version to 1.3.0.
6. Verify (report ACTUAL output):
   pnpm --filter @apps-hub/library-core test
   pnpm --filter @apps-hub/scan-core test
   pnpm test
   pnpm typecheck
   pnpm --filter pdf-editor-mobile lint
   pnpm --filter pdf-editor-mobile typecheck
   pnpm --filter pdf-editor-mobile doctor
   cd apps/pdf-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew \
     :pdf-scan:testDebugUnitTest :app:assembleDebug
7. Release (owner's go; Cloudflare account confirmed):
   pnpm release pdf-editor -m "Scan: review pages and share as PDF"
   The owner installs from the Store and runs AC-6, AC-7 (printed grid), AC-14 (with a
   scan) and AC-15. Record the results.
```

## Phase 4: Text recognition and searchable PDF (FR-13, FR-14; AC-1, AC-8 to AC-11)

```text
Read docs/pdf-editor/scan/SPEC.md §2 (Tesseract rows), §7.6, §8 (text layer), §11
(/about), §12, §15 (S5, S6) and PRD FR-13, FR-14, NFR-3, NFR-4.

We are executing Phase 4: Text recognition and a searchable PDF.

1. Dependencies (owner-approved in the handoff; PRD Q2): in modules/pdf-scan/android/
   build.gradle add cz.adaptech.tesseract4android:tesseract4android:4.9.0 (JitPack is
   already in android/build.gradle allprojects.repositories). Put eng.traineddata from
   tesseract-ocr/tessdata_fast in android/src/main/assets/tessdata/ and record the
   source commit and SHA-256 in the handoff.
2. Native: android/Tessdata.kt (copy the asset to filesDir/tessdata atomically),
   android/OcrEngine.kt (one TessBaseAPI on one thread; OEM_LSTM_ONLY; user_defined_dpi
   300; PSM from spike S5; OCR image per SPEC §7.6; word boxes, confidences, line numbers;
   stop() for cancel), core/OcrLayout.kt with OcrLayoutTest. Add recognize,
   cancelRecognize and ocrLanguages to PdfScanModule.kt and src/index.ts.
3. scan-core: runOcr, pause/resume, onProgress, retry in scan-service.ts (SPEC §7.6);
   pass stored words to the PDF writer; tests for the queue (order, resume after a crash,
   failure continues, edits reset or keep text, body order).
4. App: start runOcr after Library.open and after saves and retries; pause it while the
   capture screen is open; progress and "Try again" in app/scan/[id].tsx; "Copy text"
   with expo-clipboard (approved; pnpm --filter pdf-editor-mobile exec expo install
   expo-clipboard); app/about.tsx
   with the notices in SPEC §11 (the IJG sentence is required), linked from the Library.
5. Spikes S5 (on the phone: seconds and PSS per page, standard vs OpenMP flavour, PSM 3
   vs 6, WER on the five-page set) and S6 (text selection in the editor, Chrome and
   Preview on the Mac). Record numbers and decisions; switch to the OpenMP artifact only
   if S5 shows a clear gain.
6. Set expo.version to 2.0.0.
7. Verify (report ACTUAL output):
   pnpm --filter @apps-hub/scan-core test
   pnpm test
   pnpm typecheck
   pnpm --filter pdf-editor-mobile lint
   pnpm --filter pdf-editor-mobile typecheck
   pnpm --filter pdf-editor-mobile doctor
   cd apps/pdf-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew \
     :pdf-scan:testDebugUnitTest :app:assembleDebug
   JAVA_HOME=$JAVA_HOME ./gradlew :app:dependencies --configuration releaseRuntimeClasspath \
     | grep -E 'mlkit|play-services|firebase|litert'      # must match the Phase 2 baseline
8. Release (owner's go; Cloudflare account confirmed):
   pnpm release pdf-editor -m "Scan: on-device text recognition and searchable PDFs"
   Run the zipalign, aapt and size commands from Phase 2 on the release APK.
   The owner installs from the Store and runs AC-1 (scan text), AC-8, AC-9, AC-10 and
   AC-11. Record the results.
```

## Phase 5: Hardening

```text
Read docs/pdf-editor/scan/PRD.md §5 to §7 and the handoff's results so far.

We are executing Phase 5: Hardening. No new features.

1. Run every AC (AC-1 to AC-15) on the phone with the current Store build; list pass or
   fail with numbers in the handoff.
2. Measure NFR-1 to NFR-3 on the phone (debug-build Log.d timings and a stopwatch on the
   release build; peak memory with the Android Studio profiler or dumpsys meminfo):
   detector ms per frame, capture to review, seconds per page for OCR, Share PDF for 20
   pages, search on a seeded library of 500 items, peak PSS while recognising, APK size.
3. Fix what fails, smallest change first, with a test for each fix. Re-tune the detector
   and stabiliser constants from the field results.
4. Docs: AGENTS.md, apps/pdf-editor-mobile/CLAUDE.md, packages/pdf-editor-engine/
   README.md and docs/pdf-editor/scan/SPEC.md brought in line with what was built.
5. Verify (report ACTUAL output):
   pnpm test
   pnpm typecheck
   pnpm --filter pdf-editor-mobile lint
   pnpm --filter pdf-editor-mobile typecheck
   pnpm --filter pdf-editor-mobile doctor
   pnpm --filter pdf-editor-desktop test:e2e
   cd apps/pdf-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew \
     :pdf-scan:testDebugUnitTest :app:assembleDebug
6. If anything changed: bump expo.version (2.0.x), release with
   pnpm release pdf-editor -m "Scan: fixes from the phone test"
   and the owner re-runs the failed ACs from the Store build.
```

## Phase 6 (optional): iOS

```text
Read docs/pdf-editor/scan/SPEC.md §6.3, §10 (iOS) and RESEARCH §2 to §4 (iOS notes).
iOS needs no paid Apple account for a simulator build; on a device the app is a 7-day
sideload, and the Store is Android-only (docs/app-store.md).

We are executing Phase 6: iOS for Scan and Library.

1. Library works on iOS already (expo-sqlite with FTS5 is on by default in its podspec);
   check it on the simulator.
2. modules/pdf-scan/ios: PdfScan.podspec, PdfScanModule.swift and ScanCameraView.swift
   with the SPEC §6.3 contract: AVCaptureSession preview, VNDetectRectanglesRequest on
   video frames with the same stabiliser rules (port core/QuadStabilizer.kt to Swift),
   AVCapturePhotoOutput, CIPerspectiveCorrection and Core Image filters (Sauvola as in
   Kotlin), .bits with the zlib header and Adler-32, VNRecognizeTextRequest(.accurate)
   with word boxes via boundingBox(for:) flipped to a top-left origin.
   expo-module.config.json gains "apple" with the module class.
3. ios/PDFEditor/Info.plist: NSCameraUsageDescription "PDF Editor uses the camera to scan
   documents. Pages stay on this device." Then pod install in apps/pdf-editor-mobile/ios.
4. Verify (report ACTUAL output):
   pnpm test
   pnpm typecheck
   pnpm --filter pdf-editor-mobile lint
   pnpm --filter pdf-editor-mobile typecheck
   cd apps/pdf-editor-mobile/ios && pod install && xcodebuild -workspace PDFEditor.xcworkspace \
     -scheme PDFEditor -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
     -configuration Debug build CODE_SIGNING_ALLOWED=NO
5. On a device if one is available: capture, review, recognise, share PDF, search. Record
   results in the handoff.
```

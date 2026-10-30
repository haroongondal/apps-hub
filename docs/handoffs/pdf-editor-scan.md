# Handoff: Scan and Library in PDF Editor

## Resume prompt

Dated 2026-10-31. Read `docs/handoffs/pdf-editor-scan.md` completely first, then
`docs/pdf-editor/scan/PRD.md` and `docs/pdf-editor/scan/SPEC.md`; use
`docs/pdf-editor/scan/RESEARCH.md` for facts. Trust the decisions and the verified facts
below and don't re-derive them. Follow the handoff contract in `~/.claude/CLAUDE.md`: keep
this file's session log and current state up to date as milestones land, and at about 85%
context stop, finalise the state and print a new resume prompt. Read "Current state + exact
next step" before doing anything, then continue from it. Phase work uses the prelude and the
phase prompt in `docs/pdf-editor/scan/PROMPTS.md`. Commit or release only when the owner
says so.

## Goal and fixed constraints

- Add **Scan** (offline document scanner with border detection, perspective correction,
  contrast clean-up, on-device OCR and searchable PDF export) to PDF Editor
  (`apps/pdf-editor-mobile`, release id `pdf-editor`, package `com.haroon.pdfeditor`,
  `@apps-hub/ui` brand `pdf`). The owner's idea: "PocketCam OCR & Document Scanner", an
  alternative to CamScanner, Adobe Scan and SwiftScan.
- Build the shared **Library** first (Phase 1): `packages/library-core`, one `library.db`,
  `library/<id>/` files, search, folders and tags, a new home screen. A sibling **Reader**
  feature (read-later web archiver) builds on the same contract and may only add its own
  tables keyed by `items.id` (SPEC §4.7).
- Android first, through the private Store only (`pnpm release pdf-editor`; never Play,
  never `adb install` on the phone). iOS is the last phase and optional (no paid Apple
  account).
- Owner's phone: Redmi Note 14 Pro 4G, Helio G100-Ultra (2× A76 + 6× A55), 8 GB RAM,
  Android 16, HyperOS.
- FOSS only, zero telemetry: no Google Play services, ML Kit, Firebase or closed SDKs.
  Every new dependency needs the owner's approval.
- Stack: Expo SDK 54, React Native 0.81.5, TypeScript 5.9 (erasable syntax, `.ts`
  imports); domain logic in pure TS packages behind ports; native code in an Expo local
  module (Kotlin now, Swift later); UI only from `@apps-hub/ui`.
- The editor engine (PDF.js 3.11.174 + pdf-lib 1.17.1 in react-native-webview 13.15.0)
  moves PDFs as base64 and stalls around 40 MB; its bridge schema is frozen (a new message
  needs both sides).

## Decisions made (with why)

**Owner answers, 2026-10-31 (session S0).** Shared answers are also in
`docs/pdf-editor/MERGE.md` ("Owner decisions").

- **Q1 edge detection:** the pure Kotlin detector, as recommended.
- **Q2 OCR:** Tesseract4Android 4.9.0 with English `tessdata_fast`; the AAR comes from JitPack,
  as the SPEC assumes. Vendoring stays the fallback if JitPack fails.
- **Q3 arm64 only:** yes. The same answer covers Design Editor Q8.
- **Q4 editor saves:** add a new library item, then share, as recommended.
- **Q5 Android backup: off** (`allowBackup="false"`). The docs made no recommendation. Why:
  scans and articles stay on the phone; the owner accepts that they are lost with the phone
  unless shared or exported. Changed: SPEC §10, PRD §9, PROMPTS Phase 2 step 5.
- **Q6 languages:** English only in v1. Urdu and Arabic come next, downloaded from the
  Tesseract repository when the owner asks (not bundled). No phase builds this yet; PRD §8
  records it.
- **Q7 originals:** keep them, as recommended.
- **Q8 app name (shared A1):** decide before the first Reader release (session A6), as the
  Reader PRD advises. "PDF Editor" stays until then.
- **Order (shared A3): the scanner first.** This departs from the recommendation. Scan
  Phases 2–4 are sessions A2–A4, before Reader Phase 1 (A5). Changed: the session table and
  Track A in `docs/build-sessions.md`, MERGE.md "Order", the PROMPTS header.
- **Arabic and Urdu search (shared A4): from v1.** This departs from the recommendation to
  defer it. `normalizeForSearch` lives in library-core and runs in `ftsQuery`, `setBody` and
  the FTS title. The insert and title triggers are replaced by Library writes, because a
  trigger can't call JS. Changed: SPEC §4.2, §4.3, §4.6, §4.7, §12, §14; PRD FR-5; PROMPTS
  Phase 1 (with a Hermes `normalize` check).
- **Dependencies approved (SPEC §2):** expo-sqlite ~16.0.10; CameraX 1.6.2 (core, camera2,
  lifecycle, view); Tesseract4Android 4.9.0 from JitPack with `eng.traineddata` (fast) and
  the GlyphLessFont; expo-clipboard ~8.0.8.

Made in the research and docs session, 2026-10-30. Items marked **(owner)** were confirmed
by the owner on 2026-10-31 (above).

- **Host: PDF Editor.** Scans end as PDFs the editor can mark up; the library is shared
  with Reader; brand and Store entry exist. Cost: about +15 MB APK, one permission
  (RESEARCH §10).
- **No OpenCV in v1 (owner, Q1).** The warp is `Matrix.setPolyToPoly`; detection and
  filters are about 600 lines of pure Kotlin, tested on the JVM. Stock OpenCV is +24.7 MB.
  Upgrade path if the phone test fails AC-4: opencv-mobile core + imgproc static, or
  MakeACopy's DocQuad on a minimal ONNX Runtime.
- **OCR: Tesseract4Android 4.9.0 + English `tessdata_fast` (owner, Q2).** Apache-2.0,
  7.51 MB arm64 code, 4.11 MB model, word boxes, 16 KB aligned. PP-OCR on ONNX Runtime is
  the fallback (+about 40 MB, line boxes). ML Kit excluded: closed, GMS client libraries,
  usage metrics even when bundled.
- **Camera: CameraX 1.6.2 in our own module.** vision-camera v5 needs worklets ≥ 0.6 (SDK 54
  pins 0.5.1); vision-camera v4 and expo-camera pull ML Kit or Play services.
- **PDF built by a TS streaming writer outside the WebView,** from stored JPEGs and cached
  word boxes, with Tesseract's 573-byte GlyphLessFont for the invisible layer. pdf-lib's
  `embedFont` writes CID = GID, which breaks a glyphless font, and the bridge limit rules
  out building there. Not `TessPdfRenderer` (re-runs OCR at export), not
  `android.graphics.pdf.PdfDocument` (re-encodes, drops invisible text).
- **The scan's PDF is built on demand** (Share PDF, Open in editor) into the cache, never
  stored, so pages aren't stored twice.
- **Recognition reads the original + quad, not the filtered page,** so changing a filter
  never re-runs OCR; changing the crop or rotation does.
- **One SQLite connection, serialised writes, manual `BEGIN IMMEDIATE`.** expo-sqlite's
  exclusive transaction opens a second connection where `foreign_keys` is off; its plain
  transaction isn't exclusive.
- **`items.rid INTEGER PRIMARY KEY` as the FTS rowid,** because rowids of tables without
  one may change on VACUUM; `items.id` (TEXT, unique) stays the public id.
- **Per-feature migration tracks** (`library`, `scan`, `reader`) so Scan and Reader can add
  tables on parallel branches.
- **Body text lives only in `items_fts`;** triggers keep titles and deletes in sync;
  `setBody` sets the body.
- **No foreground service for OCR:** a queue in TS resumes pending pages at start-up.
- **Permissions:** add CAMERA; remove RECORD_AUDIO, SYSTEM_ALERT_WINDOW and both storage
  permissions with `tools:node="remove"` (libraries merge them back otherwise).
- **arm64-v8a only (owner, Q3):** 82.9 MB → about 32 MB before Scan, about 47 MB after.
- **Editor saves add a new library item, then share (owner, Q4).**
- **Keep originals for re-cropping (owner, Q7).**
- AC-4 is judged on the phone (20 real pages), not against hand-marked fixtures, which a
  session can't mark precisely; JVM tests use synthetic pages.

## Evidence / facts already verified

In this repo or SDK (2026-10-30):
- `apps/pdf-editor-mobile/releases/PDF-Editor-1.0.0-release.apk`: 82.9 MB; native libs
  69.3 MB stored uncompressed (arm64 18.1, armeabi-v7a 12.5, x86 19.2, x86_64 19.5 MB);
  passes `zipalign -c -P 16`; all arm64 `.so` 16 KB aligned.
- The app manifest declares INTERNET, READ/WRITE_EXTERNAL_STORAGE, RECORD_AUDIO,
  SYSTEM_ALERT_WINDOW, VIBRATE; `allowBackup="true"`
  (`android/app/src/main/AndroidManifest.xml:2-15`).
- `android/gradle.properties:31` lists four ABIs; `android/build.gradle` already has JitPack
  in `allprojects.repositories`; release minify is off (`android/app/build.gradle:69`).
- expo-sqlite 16.0.10 bundles SQLite 3.50.3 with FTS5 on by default; its
  `withExclusiveTransactionAsync` opens a new connection (`build/SQLiteDatabase.js:510-516`);
  `withTransactionAsync` is documented as not exclusive (`SQLiteDatabase.d.ts:72-92`).
- Node 22.23.4 `node:sqlite` (SQLite 3.53.4) supports FTS5, `unicode61 remove_diacritics 2`,
  `trigram`, `snippet`, `bm25`. The whole SPEC §4.2 library schema ran there: case-insensitive
  unique folder names per parent, FK to a UNIQUE column, FTS triggers, cascades; quoted
  prefix queries work; an empty phrase (`"-"*`) is ignored in an AND.
- `expo-modules-core` 3.0.30 supports view-bound `AsyncFunction` on Android and iOS.
- `libexpo-sqlite.so` is 1.82 MB on arm64 (NetLens release APK).
- `expo-file-system` 19.0.24 has `File.bytes()` and `FileHandle.writeBytes()` (JSI, no base64).
- Vendored pdf-lib exports `setTextRenderingMode`, `TextRenderingMode.Invisible`,
  `setCharacterSqueeze` (Tz); `embedFont` writes CID = glyph id; StandardFonts are WinAnsi only.
- The only emulator (`apps-hub-test`) is arm64-v8a, Android 35, on an Apple Silicon Mac.
- `tools/release` takes `versionName` from `expo.version` in `app.json` (`main.ts:98`); the
  release APK lands at `android/app/build/outputs/apk/release/app-release.apk`.
- SDK 54 pins `expo-clipboard` ~8.0.8 and `react-native-worklets` 0.5.1.
- iOS: workspace `PDFEditor.xcworkspace`, scheme `PDFEditor`, `ios/PDFEditor/Info.plist`.

External (full list with URLs in RESEARCH):
- Tesseract4Android 4.9.0 (2025-06-11, Tesseract 5.5.1), JitPack only, Apache-2.0; IJG
  notice required for libjpeg. Phone benchmark (Snapdragon 845): 3.4 s/page fast, CER 0.13%.
- OpenCV 4.14.0 arm64 `libopencv_java4.so` 24.66 MB. CameraX 1.6.2 stable 2026-08-26.
- vision-camera 5.2.4 needs `react-native-worklets` ≥ 0.6.0; expo-camera 17 depends on
  `play-services-code-scanner` and ML Kit barcode scanning.
- ML Kit text recognition (bundled 16.0.1) depends on play-services-base/basement and Google
  transport libraries; its terms say it sends usage metrics.
- Competitors: CamScanner $9.99/month, Adobe Scan Premium $9.99/month, SwiftScan VIP
  $5.99/month; Microsoft Lens retired 2026-03-09.

## File map

- `docs/pdf-editor/scan/RESEARCH.md`: findings, verdicts, sources.
- `docs/pdf-editor/scan/PRD.md`: vision, decisions, FR-1–FR-17, NFR-1–NFR-8, invariants,
  AC-1–AC-15, open questions Q1–Q8.
- `docs/pdf-editor/scan/SPEC.md`: stack, dependency proposals, layout, the Library contract
  (§4), editor integration (§5), native contract (§6), pipeline (§7), PDF writer (§8),
  permissions, screens, tests, release, phases, spikes.
- `docs/pdf-editor/scan/PROMPTS.md`: prelude + Phases 1–6.
- Code to touch first (Phase 1): `packages/library-core` (new), `apps/pdf-editor-mobile/app/index.tsx`,
  `app/editor.tsx`, `src/editor/bridge.ts`, `packages/pdf-editor-engine/core.js`,
  `mobile.html`, `apps/pdf-editor-desktop/test/mobile.mjs`.
- Patterns to copy: `apps/open_tunnel_vpn/src/data/sqlite-driver.ts` (SQL driver over
  expo-sqlite and node:sqlite), `apps/deputy/modules/deputy-agent` (module layout, Gradle
  JVM tests), `packages/core` (package setup).

## Session log

- 2026-10-30: research (four parallel research passes: image processing and camera, OCR,
  searchable PDF, competitors/permissions/APK) plus local checks; RESEARCH, PRD, SPEC,
  PROMPTS and this handoff written. Nothing built, installed or committed.
- 2026-10-31: docs finished; handed to the owner for review.
- 2026-10-31: the coordinating session reconciled Reader with this Library contract. Reader
  now uses the `reader` migration track and reads scan text from `ScanStore.pageTexts`.
  It added Reader's `text.json` to SPEC §4.5 (articles, plus a cache for PDFs, never scans)
  and wrote `docs/pdf-editor/MERGE.md`: shared touch points, release order, and the
  combined owner questions.
- 2026-10-31 (session S0): the owner answered PRD Q1–Q8, the shared questions and the
  dependencies (see "Decisions made"). Docs updated for the scanner first, Arabic and Urdu
  search in v1 and backup off. The docs went to `main` through a PR from branch
  `docs-offline-tools`.

## Current state + exact next step

All five documents are written and the owner's answers are recorded (S0, 2026-10-31). No
code and no dependencies yet. Reader's docs (`docs/pdf-editor/reader/`, `docs/handoffs/pdf-editor-reader.md`)
were checked on 2026-10-31: they build on SPEC §4 and say they will use a Scan-defined
migration registry; SPEC §4.7 maps each Reader request to the contract (track `reader`
instead of `reader_meta`; per-page scan text from `ScanStore.pageTexts`, no `text.json`).

Next step: once the S0 docs PR (branch `docs-offline-tools`) is merged, run session A1 from
`docs/build-sessions.md`: Phase 1 (Library foundation, with Arabic and Urdu normalisation)
on branch `scan-phase-1` in its own worktree, not on `deputy-speed`. Then A2–A4 (Scan
Phases 2–4) come before the Reader.

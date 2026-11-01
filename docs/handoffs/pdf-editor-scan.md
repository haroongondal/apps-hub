# Handoff: Scan and Library in PDF Editor

## Resume prompt

Dated 2026-11-01. Read `docs/handoffs/pdf-editor-scan.md` completely first, then
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

**Session A1 (2026-10-31 and 2026-11-01).** The owner approved removing the Store-installed PDF
Editor 1.0.0 from the `apps-hub-test` emulator (only) so the debug build could be installed for
the Hermes check; the emulator now holds the debug build, and the Store can reinstall 1.0.0.
Below, where SPEC §4 was silent (the contract itself is unchanged):

- Deleting an item also deletes tags no other item uses (FR-4: a tag lives only while an item
  uses it). `setItemTags` already did.
- `deleteFolder` throws `duplicate_name` and changes nothing if a subfolder's name would clash
  with a sibling one level up. Items are never deleted to resolve it; the owner renames first.
- Moving items out of a deleted folder does not bump their `updated_at` (it is not an edit).
  Changing tags does not bump it either. `updateItem` with nothing to change returns the item
  unchanged.
- `Library.open` refuses a connection whose `PRAGMA foreign_keys` is not 1, because cascades
  would silently not run (SPEC §4.1).
- `createItem` checks a caller-supplied id against `ITEM_ID` (it becomes a directory name).
  Item, folder and tag names count characters, not UTF-16 units.
- `list` defaults to 500 rows, `search` to 30. Ties sort by `rid`, so paging is stable.
- **A Library method must not be called inside a `library.db.transaction` callback.** Each
  method opens its own transaction and the queue is held by the outer one, so the call never
  returns. Scan Phase 4's `runOcr` ("per page, in one transaction ... then `setBody`") must call
  `setBody` after its own transaction commits.

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
- **Body text lives only in `items_fts`;** a delete trigger keeps deletes in sync, Library
  writes keep titles in sync (normalised), and `setBody` sets the body.
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
- `tools/release` takes `versionName` from `expo.version` in `app.json` (`main.ts:77`); the
  release APK lands at `android/app/build/outputs/apk/release/app-release.apk`.
- SDK 54 pins `expo-clipboard` ~8.0.8 and `react-native-worklets` 0.5.1.
- iOS: workspace `PDFEditor.xcworkspace`, scheme `PDFEditor`, `ios/PDFEditor/Info.plist`.

Verified in session A1 (2026-10-31):
- `pnpm --filter @apps-hub/library-core test`: 86 tests, all passing, on Node 22 `node:sqlite`;
  `tsc --noEmit` clean. Writes serialise, a throwing transaction rolls back, FTS operators typed
  by a user are literal, AC-2 and AC-3 hold at library level.
- Search cost is `snippet()`: about 8 ms a row when a document has a few hundred match
  instances. On 500 items of 20 pages (10,000 pages, 20 MB), a whole word takes about 20 ms;
  a two-letter prefix ("w1 w2": every document matches) takes about 550 ms on the Mac for 50
  rows. NFR-1's 300 ms holds for real words, not for one or two typed letters. The UI should
  debounce (about 200 ms) and Phase 5 measures it on the phone. Not changed in the contract:
  `ftsQuery` keeps its exact output.
- Hermes (emulator `apps-hub-test`, Android 15, arm64, debug build): `'\u{FEFC}'.normalize('NFKC')`
  is U+0644 U+0627 ("لا"), and `normalizeForSearch` gives U+06A9 U+062A U+06CC for kaf, fatha,
  teh, ZWNJ, tatweel, Arabic yeh. So `String.prototype.normalize` exists and the `/u` regex with
  `\u{...}` escapes works; no fallback needed. The temporary log was removed.
- On that build the Library opened `library.db` through expo-sqlite (migration and FTS5 table
  created), the empty state rendered, and New folder, Save created "Work" and the list reloaded,
  with no JS warning or error.
- `./gradlew :app:assembleDebug` in `apps/pdf-editor-mobile/android`: BUILD SUCCESSFUL in 4m 9s
  (327 tasks); expo-sqlite autolinks with no native edit. Debug APK 183 MB (still four ABIs until
  Phase 2).
- `pnpm --filter pdf-editor-mobile doctor` (the line in PROMPTS) runs pnpm's own built-in
  `doctor`, not expo-doctor, and passes. The real check is `pnpm --filter pdf-editor-mobile run
  doctor`: 17 of 18 pass; the failing one ("app config fields that may not be synced in a
  non-CNG project") fails identically on a clean `origin/main`, so it predates Phase 1.
- `pnpm --filter pdf-editor-desktop test:e2e` exits 0 ("electron ok", "mobile bridge ok") with
  the new `docInfo` assertions. Its canvas warnings come from `canvas: false` in `allowBuilds`.
- The `adb` default target can be the owner's phone (wireless debugging, model 24116RACCG).
  Always pass `-s emulator-5554` and check `adb -s … emu avd name` first. The emulator needs
  `ANDROID_HOME=$HOME/Library/Android/sdk` to boot; port 8081 may belong to another session's
  Metro, so use another port and set `debug_http_host` in the app's shared prefs.
- This session's tool channel decodes a literal `\uXXXX` in file content into the character.
  `\u{XXXX}`, `\x41` and `\\u064B` survive. All invisible or look-alike characters in
  library-core sources and tests are written as `\u{...}` for that reason; keep it that way.

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
  search in v1 and backup off. The docs go to `main` through a PR from branch
  `docs-offline-tools`.
- 2026-10-31 (session A1, branch `scan-phase-1` in `.claude/worktrees/scan-phase-1`, from
  `origin/main` 9f754dd): `packages/library-core` built test-first (sql-port, migrate,
  normalize, fts-query, orphan-dirs, library-items/folders/tags/search; 86 tests). Added
  `@apps-hub/library-core` and `expo-sqlite ~16.0.10` to the app.
- 2026-11-01 (session A1 continued): `snippetParts` added to library-core (92 tests). App wired:
  `src/library/` (ids, sql-expo, paths, files, sweep, open-library, open-item, add-actions,
  format, use-library, icon-button, rows, sheets), Library home in `app/index.tsx`, `docInfo`
  (bridge.ts, core.js, mobile.html, mobile.mjs), editor indexing and save-as-new-item in
  `app/editor.tsx`, docs, `expo.version` 1.1.0. All PROMPTS step 6 commands run (results under
  verified facts); Hermes check done on the emulator. Nothing committed.
- 2026-11-01: owner chose a phone-test release and confirmed the Cloudflare account (Worker
  `apps-hub-store.haroonmukhtar4.workers.dev`, personal account). `pnpm release pdf-editor -m
  "Library: folders, tags and search"` from the worktree: BUILD SUCCESSFUL in 4m 3s, then
  "pdf-editor 7 published" (1.1.0, versionCode 7, 90.6 MB, still four ABIs until Phase 2).
- 2026-11-01: owner asked me to install and test over wireless debugging. Installed through
  the Store only (its Update button, Play Protect "Scan app", then Install; no `adb install`);
  adb was used for taps, screenshots and UI dumps only. Pushed three small PDFs to
  `/sdcard/Download/apps-hub-a1-test/` for the test. AC-1, AC-2, AC-3 and AC-14 passed (below).
- 2026-11-01: fixed findings 1 to 3 (`Sheet` lifts above the keyboard; tag field
  `autoCapitalize="none"`; a filter whose tag is gone clears itself), `expo.version` 1.1.1.
  Gates: `pnpm test` and `pnpm typecheck` exit 0, lint clean, e2e green, ui 15 of 15, library-core
  92 of 92. Owner confirmed the Cloudflare account again; `pnpm release pdf-editor` published
  1.1.1 (versionCode 8). Updated the phone through the Store and re-tested there (below).

## Phone test results (2026-11-01, PDF Editor 1.1.0 versionCode 7, Redmi Note 14 Pro, Store install)

Install: Store "Update ready" 1.0.0 (6) to 1.1.0 (7); Play Protect asked to scan, said "looks safe";
installer `com.haroon.store`; the Xiaomi post-install scan passed. The app opened on the Library.

- **AC-1 (search): pass, with one part not measured.** Three PDFs added with "Open a PDF"; each
  showed a cover and "2 pages". Typing `zephyrine`, a word only in the Bank statement, returned only
  that item with the snippet "...Transfer reference **zephyrine** received on the 3rd." (matched word
  in semibold); the prefix `zeph` found it too; clearing the box restored the list. Not measured:
  the 300 ms bound (3 items, visually instant; Phase 5 measures it) and the scan-text half of AC-1
  (Phase 4).
- **AC-2 (folders): pass.** Created "Work", moved two items in ("1 item", "2 items"), added the
  subfolder "Sub", deleted "Work" from its Folder actions after the confirmation. Both items and
  "Sub" were then at the top level, nothing lost, the app back on the top-level Library.
- **AC-3 (tags): pass.** Tagged two items "Tax" (the second by picking the existing tag); the
  filter listed "Tax, 2 items" and showed only those two (library-wide, folders hidden). After
  removing the tag from both, the filter sheet listed only "All tags".
- **AC-14 (editor round trip): pass.** Opened the Council letter, added the text "Signed by me",
  tapped Share: the system share sheet opened with "A1 Council letter-edited.pdf" (closed without
  sharing) and a new "A1 Council letter (edited)" item appeared; the original was unchanged (4 KB,
  same cover); opening the copy shows "Signed by me" on page 1.

Findings from the test (none fails an AC):
1. **(Fixed in 1.1.1.) Save and Done are hidden behind the soft keyboard** in sheets with a field (New folder, Rename,
   Tags): the Sheet modal does not move up, so on the phone the button sits under Gboard. The
   keyboard's check key submits, so it works, but it is not discoverable. The headless emulator
   has no soft keyboard, so only the phone showed it. The fix is in the shared `Sheet`
   (`packages/ui`), which every app uses; the new folder, rename and tag flows depend on it.
2. **(Fixed in 1.1.1.)** The Tags field auto-capitalises, so "tax" became "Tax" (matching is case-insensitive, so this is
   cosmetic). Set `autoCapitalize="none"` on that field.
3. **(Fixed in 1.1.1.)** When the filtered tag disappears (its last item loses it) the chip stays on "Tag: removed" over
   an empty "Nothing found" list until "All tags" is picked. Clear the filter when its tag is gone.
4. A copy made by the editor shows a placeholder icon, not a cover, until it is opened once
   (the cover comes from `docInfo`).

Left on the phone: the app holds the test items and the folder "Sub"; the three PDFs are in
`Download/apps-hub-a1-test/`.

## Phone re-test of 1.1.1 (2026-11-01, versionCode 8, Store install)

Installed through the Store's Update button (Play Protect, then the Xiaomi scan); package shows
versionName 1.1.1, versionCode 8, installer `com.haroon.store`.

- Finding 1 fixed: with the keyboard up the sheet sits above it, and "New folder", Save and the
  field are all visible; typing a name and tapping Save created the folder.
- Finding 2 fixed: typing `tax` gives the row "tax".
- Finding 3 fixed: after the last item lost "tax", the "Tag: tax" chip cleared itself and the full
  list came back (no "Tag: removed", no "Nothing found").
- The throwaway folder used for the check was deleted again.

Test notes for the next session that drives the phone:
- adb's default target can be the phone; always pass the serial. Wireless debugging dropped once
  ("device offline") and came back by itself after about a minute.
- The Store list only refreshes on a slow pull (`input swipe 540 650 540 1150 1200`). A fast long
  swipe from mid-screen opened HyperOS recents; never tap the clear-all cross there (it kills
  background apps such as Deputy's accessibility service).
- The headless emulator is in hardware-keyboard mode, so Gboard shows a floating toolbar and the
  covered-Save bug cannot be reproduced there; only the phone shows it.
- WebView content (the editor's tools) is not in the UI tree; tap it by coordinates.

## Current state + exact next step

Phase 1 (session A1) is built, released as 1.1.1 (versionCode 8) and phone-tested on branch
`scan-phase-1`, worktree `/Users/outsentia/Documents/apps-hub/.claude/worktrees/scan-phase-1`.
Nothing is committed. AC-1, AC-2, AC-3 and AC-14 pass; findings 1 to 3 are fixed and verified;
finding 4 (a copy made by the editor shows a placeholder icon until it is opened once) is open
and cosmetic.

Not measured: the 300 ms search bound on a large library and the scan-text half of AC-1 (Phase 4;
Phase 5 measures NFR-1). Not tried on the phone: the 28 MB guard and a PDF PDF.js can't open.

Left on the phone: the Library holds "Sub", the three "A1 ..." PDFs and "A1 Council letter
(edited)"; the PDFs are in `Download/apps-hub-a1-test/`. The `apps-hub-test` emulator holds the
debug build in place of the Store's 1.0.0 (owner approved).

Next step: ship with the pr-shipper agent (one PR into `main`; merging releases the app through CI,
which will publish another build). Then the next session is A2 (Scan Phase 2, camera and
detection) on `scan-phase-2`, new from `main` once this PR is merged.

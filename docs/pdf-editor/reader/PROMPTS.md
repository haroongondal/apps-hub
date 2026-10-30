# Reader phase prompts: one phase per session, in order (1, 2, 2b, 3 → 8)

These are the build sessions for the Reader feature of PDF Editor (save, read,
listen, export). Run each session with `apps-hub/` as the working directory so
`AGENTS.md` and `CLAUDE.md` load. Wait for a phase to pass its verification
commands before starting the next.

**Prerequisite for Phase 1:** Scan Phases 1–4 have landed. Phase 1 needs only the
Library (Scan Phase 1), but the owner chose the scanner first (2026-10-31); the order is in
`docs/build-sessions.md`. Phase 2b (highlights and notes) was added by the owner on
2026-10-31. Phase 7 runs (the owner has files to import); Phase 8 is optional.

## Prelude for any NEW chat (paste this first, then the phase prompt)

```text
You are building the Reader feature of PDF Editor (apps-hub monorepo, pnpm):
save a web page, read it clean, listen to it with the phone's own voices, and
export it as EPUB or PDF, all offline on an Android phone. Project root:
/Users/outsentia/Documents/apps-hub. Make it your working directory and touch
nothing outside it, except the scratchpad for downloads such as epubcheck.

Before code, read these in full:
- AGENTS.md, CLAUDE.md
- apps/pdf-editor-mobile/CLAUDE.md, .claude/rules/ui-and-pdf-engine.md
- docs/pdf-editor/reader/PRD.md and SPEC.md
- docs/pdf-editor/scan/SPEC.md (the Library you build on)
- docs/handoffs/pdf-editor-reader.md (decisions, verified facts, current state)

Rules that bite:
- Erasable TypeScript only, imports with the .ts extension.
- Every new *.test.ts goes into its package's "test" script.
- UI only from @apps-hub/ui. No hand-rolled colours or fonts.
- Sentence-case copy, no emoji.
- No dependency beyond SPEC §1.2, and only after the owner's approval is
  recorded in the handoff. Use the upgrading-dependencies skill.
- android/ is a committed prebuild: edit it by hand, don't regenerate it.
- Never adb install on the owner's phone. The phone gets Store releases only;
  debug work uses the emulator.

Verify every step by running the phase's commands, and report the ACTUAL
output, never predicted output. Complete only the phase prompt that follows.
Update the handoff's session log and "Current state + exact next step", then
stop. Commit, push or release only when the owner says so (a push to main
triggers CI releases).
```

## Phase 1: Capture (FR-1, FR-2, FR-3, FR-5 duplicates, FR-9 rows)

```text
Read AGENTS.md, apps/pdf-editor-mobile/CLAUDE.md, docs/pdf-editor/reader/PRD.md,
docs/pdf-editor/reader/SPEC.md (§1–§7, §13, §14, §16, §17) and
docs/pdf-editor/scan/SPEC.md (the Library).

Prerequisite check:
- packages/library-core exists and its tests pass.
- The app's home screen is the Library list with a "+" sheet.
If either fails, stop and say so.

We are executing Reader Phase 1: Capture. Save a typed or shared URL as a clean
offline article. There is no reader view yet.

0. Dependencies. Check that the handoff records the owner's approval of SPEC
   §1.2, then add to packages/reader-core:
   - @mozilla/readability 0.6.0 and dompurify 3.4.17 (build inputs);
   - fflate 0.8.3 (runtime);
   - playwright-core 1.49.1 (dev; same version as apps/pdf-editor-desktop).
   No approval recorded: stop and ask.
1. Library check (SPEC §5). The mapping onto library-core is already in SPEC
   §5. Confirm each listed function exists as named in the shipped
   library-core. If one is missing or renamed, add or adapt it in library-core
   with a test, without changing its tables. Use only library.db (one
   connection, foreign keys on), never a second connection.
2. packages/reader-core (@apps-hub/reader-core; pure TS, no React or RN
   imports):
   - url.ts (SPEC §6)
   - schema.ts (§3.2, READER_STEPS step 1, applied with
     migrate(library.db, 'reader', READER_STEPS))
   - store.ts
   - capture.ts (CaptureResult, validateCaptureResult, saveCapture over
     injected Files, Downloader and Library ports; .next/ then swap)
   - images.ts (sniffImage, planDownloads, renameToken, dropImages)
   - text.ts (wordCount, readingMinutes, textHash)
   Tests: url, schema, store, capture, images and text .test.ts, all listed in
   the package's "test" script. url.test.ts runs with globalThis.URL deleted.
3. Capture script and build:
   - web/capture.js exactly as SPEC §4.2, including the purify config, image
     tokens, data-b block tagging, XMLSerializer output with an
     application/xhtml+xml self-check, and the nonce.
   - build.mjs (§17) writes apps/pdf-editor-mobile/assets/reader/web.json. Keep
     the licence headers. Throw on an inlined "</script".
   - Add /apps/pdf-editor-mobile/assets/reader/ to .gitignore.
   - Chain the app's prestart: the engine build && the reader-core build.
   - Add the reader-core build to pdf-editor's prepare in
     tools/release/src/apps.ts.
4. test/web.mjs: a Chrome smoke like apps/pdf-editor-desktop/test/mobile.mjs
   that skips without Chrome. Fixtures: article.html, lazy.html, spa.html,
   hostile.html, rtl.html, amp.html, served from file://. Assert the SPEC §16.2
   capture-side checks. Wire it as "test:web" in reader-core's package.json.
5. App:
   - src/reader/adapters.ts: expo-file-system File and Directory;
     File.downloadFileAsync with the Referer and Accept headers, a 20 s
     timeout, 4 at a time, and a size check after each download with deletion
     over the cap.
   - <CaptureHost/> in app/_layout.tsx (§4.3), behind the stack, with
     show(true) for "Show page" and "Save now".
   - app/save.tsx (§13): entry, progress, partial, saved, duplicate.
   - "Save a web page" in the Library "+" sheet.
   - The "Articles" filter entry and article rows (§7). A tap on an article says
     "Reading comes in the next update" until Phase 2.
6. Share target (§14): the SEND text/plain intent filter in AndroidManifest.xml
   and rewriteShare in MainActivity.kt. Scan Phase 2 already changed that manifest
   (CAMERA, the tools:node="remove" entries, allowBackup="false") and set arm64
   only; keep all of it. app/save.tsx reads the "text" and
   "title" params through parseShared and starts at once.
7. Verify (report ACTUAL outputs):
   pnpm test
   pnpm typecheck
   pnpm --filter @apps-hub/reader-core test:web
   pnpm --filter pdf-editor-mobile lint
   pnpm --filter pdf-editor-mobile typecheck
   pnpm --filter pdf-editor-mobile doctor
   export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
   export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
   cd apps/pdf-editor-mobile/android && ./gradlew :app:assembleDebug
8. Emulator checks (debug build; never the owner's phone):
   - Share a page from Chrome on the emulator. The Save screen opens, and the
     article is saved with its images.
   - pdfeditor://save routes to app/save.tsx (SPEC §14 assumption).
   - The CaptureHost WebView loads and lays out while behind the stack. If it
     doesn't, use the §4.3 fallback and note it in the handoff.
   Record "HyperOS browser share (AC-2)" as an owner check after the Phase 2
   release.

No release in this phase (there is no reader view yet).
```

## Phase 2: Reader view (FR-5 refresh, FR-6, FR-7, FR-8; AC-5, AC-7, AC-8)

```text
Read docs/pdf-editor/reader/SPEC.md §3.4, §8, §13, §15 and §16.2, and the
handoff.

We are executing Reader Phase 2: read saved articles offline in a clean,
adjustable view.

1. packages/ui:
   - Add readerPalette('sepia') to src/tokens.ts. It is TypeScript-only; the
     reader builds its CSS from TS, so web/tokens.css is unchanged. Say so in
     the report.
   - Extend the tokens test so the sepia palette passes AA for text and muted
     on bg.
2. packages/reader-core:
   - settings.ts (ReaderSettings and SpeechSettings defaults and clamps).
   - shell.ts (buildReaderHtml, readerCsp, jsonForScript) with shell.test.ts:
     exact CSP, the nonce, the </script> and U+2028 escaping, theme variables
     from tokens.
   - web/reader.js (§8.2): RENDER_PURIFY pass, image error hiding, restore,
     progress, links, tapBlock, and window.__reader.
   - build.mjs also emits reader, purify and fontsCss (Atkinson 400/600 and
     Mono as data: URIs from packages/ui/fonts).
3. App:
   - app/read/[id].tsx with the WebView props and the navigation guard from
     §8.3, and nonce-checked messages.
   - Top bar in the editor's style; Text settings Sheet (§13); More Sheet with
     Refresh (saveCapture into .next/, keeping the reading block), Open
     original, Mark as finished / unread, and Delete through the Library.
   - Progress saved to reading_state (throttled) and restored on open.
     finished_at is set at ratio 0.97. Partial articles show the warn Notice.
   - Settings persist in reader_prefs and apply through __reader.apply.
4. test:web: hostile.html rendered through buildReaderHtml makes 0 requests
   that aren't file: or data:, and window.__pwned stays unset (AC-5).
   apply() changes the computed font size. Progress messages carry the nonce.
5. Emulator spike, recorded in the handoff's verified facts:
   - With chrome://inspect, confirm injectJavaScript runs under the CSP. If it
     doesn't, implement the §8.4 re-render fallback, and note that Phase 5
     highlighting must use it.
   - Confirm file:// images render with baseUrl.
   - Confirm a 10,000-word fixture paints in under 1 s.
6. Verify (report ACTUAL outputs): the Phase 1 command list, unchanged.
7. Release, only when the owner approves:
   pnpm release pdf-editor -m "Reader: save web pages and read them offline"
   The owner installs it through the Store and checks AC-1, AC-2 (HyperOS
   browser), AC-4, AC-7 and AC-8 on the phone. Record the results in the
   handoff.
```

## Phase 2b: Highlights and notes (FR-18; AC-19, AC-20)

```text
Read docs/pdf-editor/reader/SPEC.md §3.2 (step 2), §8.2, §8.5, §13 and §16, PRD
FR-18, AC-19 and AC-20, and the handoff.

We are executing Reader Phase 2b: highlights and notes on articles. The owner
added this to v1 on 2026-10-31.

1. packages/reader-core:
   - schema.ts: append 'reader' step 2 (the highlights table, §3.2). Never edit
     step 1.
   - highlights.ts: HighlightAnchor, the store functions (list by item, add, set
     note, delete, mark orphaned), the 5,000-character cap and reanchor (§8.5),
     with highlights.test.ts listed in the "test" script. markHighlights and
     highlightsSection wait for Phase 4.
   - web/reader.js: selection messages, __reader.setHighlights and
     clearSelection, tap hit-testing, the ::highlight CSS (§8.5).
2. packages/ui: add the AA check of text on warnSoft (blended over bg) for every
   reader theme to the tokens test. If a theme fails, fix that theme's tokens,
   not the check.
3. App: the selection bar, the highlight sheet and the Highlights sheet (§13).
   Load highlights after "ready" and push them again after every change. Refresh
   calls reanchor after the swap.
4. test:web: a selection across inline markup and across two blocks posts the
   expected anchors and quote; setHighlights marks exactly that text; a tap on a
   highlight posts its id.
5. Verify (report ACTUAL outputs): the Phase 1 command list.
6. Release, only when the owner approves:
   pnpm release pdf-editor -m "Reader: highlights and notes"
   The owner checks AC-19 and AC-20 on the phone. Record the results in the
   handoff.
```

## Phase 3: Pending and offline saves (FR-4, FR-8, FR-9; AC-3, AC-17)

```text
Read docs/pdf-editor/reader/SPEC.md §4.4, §7 and §13, and the handoff.

We are executing Reader Phase 3: saves never get lost, and the article list
works like a reading list.

1. packages/reader-core: queue.ts (CaptureQueue: oldest pending first, one at a
   time, offline errors don't count, failed after 3 attempts, Try again resets),
   with queue.test.ts.
2. App:
   - Run the queue on AppState "active" and after each save.
   - The share path stores the pending item before capture starts, so the owner
     can leave at once (AC-3).
   - /save?item=<id> shows a pending or failed item with "Try again".
   - Status Pills on rows. The "To read" / "Finished" Segmented in the Articles
     filter (§7).
3. AC-17 on the emulator: a __DEV__-only seeder fills 2,000 article bodies.
   Time the Library search for a body-only word and report the number. Search
   is the Library's; if it misses 100 ms, report it with the SPEC §5.1
   recommendations rather than changing the Library here.
4. Verify (report ACTUAL outputs): the Phase 1 command list.
5. Emulator: airplane mode, then share. The pending item appears within 1 s.
   Turn airplane mode off and foreground the app; the item is saved with no
   tap.
6. Release, only when the owner approves:
   pnpm release pdf-editor -m "Reader: offline saves and reading list"
   Owner checks AC-3 on the phone.
```

## Phase 4: Export as EPUB and PDF (FR-10, FR-11, FR-18 export; AC-9, AC-10, AC-11, AC-21)

```text
Read docs/pdf-editor/reader/SPEC.md §10 and RESEARCH.md §7, and the handoff.

We are executing Reader Phase 4: export articles as EPUB books and as PDFs that
open in the editor.

0. With expo-print approval recorded:
   pnpm --filter pdf-editor-mobile exec expo install expo-print
   (expect ~15.0.8).
1. packages/reader-core:
   - highlights.ts gains markHighlights and highlightsSection (§8.5), with
     their highlights.test.ts cases.
   - epub.ts (§10.1) with epub.test.ts covering every §10.1 assertion.
   - print.ts (§10.2) with print.test.ts.
   Both carry highlights and notes (§8.5).
2. test/epubcheck.mjs builds a single-article book (3 highlights, one noted)
   and a 20-chapter book from the fixtures, and runs java -jar $EPUBCHECK_JAR on both, expecting 0 errors.
   Download the latest epubcheck 5.x release zip from
   github.com/w3c/epubcheck/releases into the scratchpad, never the repo.
3. App:
   - "Export as EPUB" in the reader's More sheet.
   - "Export articles as EPUB" on folder and tag screens (at most 50 articles).
   - "Save as PDF": printToFileAsync at 595×842 with data: images (15 MB cap,
     alt-text fallback), added to the Library as a pdf item, with "Open in
     editor" (the existing /editor route) and "Share".
4. Spikes, recorded in the handoff:
   - Open the saved PDF in the editor and edit a line (selectable text,
     AC-11).
   - Time a 5,000-word article with 5 images (target under 10 s) and a
     20 MB-image article.
   If expo-print rasterises text or stalls, stop and report. The SPEC §10.2
   native fallback needs the owner's go-ahead.
5. Verify (report ACTUAL outputs):
   the Phase 1 command list
   EPUBCHECK_JAR=<scratchpad>/epubcheck-5.x/epubcheck.jar node packages/reader-core/test/epubcheck.mjs
6. Release, only when the owner approves:
   pnpm release pdf-editor -m "Reader: export as EPUB and PDF"
   Owner opens an exported EPUB in KOReader or Librera on the phone (AC-9) and
   checks AC-21.
```

## Phase 5: Listen on Android (FR-12, FR-16; AC-15)

```text
Read docs/pdf-editor/reader/SPEC.md §9, §14 and §16.4, RESEARCH.md §8, the
handoff, and apps/deputy/modules/deputy-agent as the layout to copy (pure
Kotlin core plus Android layer, Gradle JVM tests).

We are executing Reader Phase 5: listen to an article with the phone's own
voices, with sentence highlighting, in the foreground and with a basic ongoing
notification.

0. With androidx.media 1.7.0 approval recorded (it is used in Phase 6; add it
   now so the module's Gradle file settles once).
1. packages/reader-core: speech.ts (splitSentences, buildUtterances) with
   speech.test.ts. The test deletes Intl.Segmenter before importing the module
   (Hermes has no Intl.Segmenter).
2. modules/reader-speech, an Expo local module:
   - package.json, expo-module.config.json (android only for now), and
     src/index.ts as the typed adapter for the SPEC §9.2 contract.
   - Kotlin: ReaderSpeechModule, SpeechHub, SpeechService (foreground,
     mediaPlayback, a simple ongoing notification with Stop for now), and
     core/SpeechQueue.kt and core/VoicePicker.kt plus the clamps.
   - JVM tests SpeechQueueTest and VoicePickerTest (§16.4).
   - Module manifest exactly as §14.
   - Check every Android API against
     platforms;android-36/android.jar (javap).
   - Add "reader-speech": "workspace:*" to the app.
3. App:
   - src/reader/useSpeech.ts (§9.4).
   - Listen in the reader's top bar, and the mini player.
   - Listen settings Sheet (§13): eligible voices only, rate, pitch, the "Allow
     online voices" Segmented with its warning, and Text-to-speech settings.
   - Sentence highlight through __reader.highlight, and the word highlight on
     onRange. tapBlock seeks.
4. Emulator spike, recorded in the handoff:
   - getEngines() output.
   - Whether onRangeStart fires on the emulator engine.
   - The gap between sentences.
   - That a network-only voice is never chosen with online voices off (AC-15).
5. Verify (report ACTUAL outputs):
   the Phase 1 command list, but finish with
   cd apps/pdf-editor-mobile/android && ./gradlew :reader-speech:testDebugUnitTest :app:assembleDebug
6. A release is optional here; background listening comes in Phase 6. If the
   owner wants it:
   pnpm release pdf-editor -m "Reader: listen to articles"
   On the phone, the owner records the default engine and whether words
   highlight.
```

## Phase 6: Listen everywhere (FR-13, FR-14, FR-15; AC-12, AC-13, AC-14, AC-16)

```text
Read docs/pdf-editor/reader/SPEC.md §9.3, §9.4 and §11, and the handoff
(Phase 5 spike results).

We are executing Reader Phase 6: listening that survives the screen turning
off, works from the lock screen and headset, resumes where it stopped, and
reads PDFs and scans too.

1. SpeechService (§9.3):
   - MediaSessionCompat plus the MediaStyle notification (previous, play/pause,
     next paragraph).
   - AudioFocusRequest from inside the service; the focus table in §9.3.
   - The ACTION_AUDIO_BECOMING_NOISY receiver, with no auto-resume.
   - The PARTIAL_WAKE_LOCK, 10 minutes and renewed.
   - Paused 10 minutes means leave the foreground. Ended means stopSelf.
     onTaskRemoved keeps playing.
   Put any new decision logic, such as focus-change handling, in core/ as pure
   Kotlin with a JVM test.
2. Resume (FR-14): SharedPreferences idx:<docId> plus reading_state
   listen_index and listen_hash; a getStatus() resync on AppState "active".
3. PDFs and scans (§11):
   - web/pdftext.js, and build.mjs emits assets/reader/pdftext.html from the
     engine's vendored PDF.js with isEvalSupported false.
   - pdftext.ts with pdftext.test.ts, using PDFs generated with pdf-lib in the
     test.
   - getSpeechText resolution order.
   - A Listen action on pdf and scan items. The player shows "Page n of m".
4. The first-listen HyperOS Notice with "Open settings" (§13).
5. Verify (report ACTUAL outputs): the Phase 5 command list.
6. Release, only when the owner approves:
   pnpm release pdf-editor -m "Reader: listen with the screen off, PDFs and scans"
   Owner checks on the phone, after setting Autostart and Battery saver "No
   restrictions":
   - AC-12: 30 minutes screen off, and the lock-screen controls.
   - AC-13: unplug and a call.
   - AC-14: force-stop, then resume.
   - AC-16: a 12-page PDF.
   - NFR-6: 60 minutes.
   Record the results in the handoff.
```

## Phase 7: Import from Pocket, Instapaper and bookmarks (FR-17; AC-18)

```text
The owner has a bookmarks file, an Instapaper CSV and a Pocket export from before
Oct 2025 (PRD Q3, 2026-10-31), so this phase runs.

Read docs/pdf-editor/reader/SPEC.md §12 and RESEARCH.md §9.2, and the handoff.

We are executing Reader Phase 7: bring old reading lists in as pending
articles.

1. packages/reader-core:
   - import/csv.ts, pocket.ts (zip or CSV, with or without the cursor
     column), instapaper.ts (old and new columns), netscape.ts.
   - Use fflate unzipSync with the 50 MB / 200 MB guard.
   - import.test.ts on small synthetic fixtures in the documented formats.
     Never commit the owner's real exports.
2. App: app/import.tsx (§13), "Import saved links" in the Library "+" sheet,
   tags mapped to Library tags, archive and read mapped to finished, duplicates
   skipped, and "Download all".
3. Verify (report ACTUAL outputs): the Phase 1 command list.
4. Release, only when the owner approves:
   pnpm release pdf-editor -m "Reader: import reading lists"
   Owner imports their file on the phone (AC-18).
```

## Phase 8 (optional): iOS

```text
Optional. There is no paid Apple developer account, so builds need re-signing
every 7 days, and the Store is Android-only. Do this phase only if the owner
asks.

Read docs/pdf-editor/reader/SPEC.md §9.2 (Swift), RESEARCH.md §8.5 and the
handoff.

We are executing Reader Phase 8: the Reader on iOS where the platform allows
it.

1. app.json: ios.bundleIdentifier com.anonymous.pdf-editor →
   com.haroon.pdfeditor. Then pod install in apps/pdf-editor-mobile/ios.
2. modules/reader-speech/ios:
   - ReaderSpeechModule.swift with the same names, records and events as
     Kotlin.
   - AVSpeechSynthesizer with willSpeakRangeOfSpeechString driving onRange.
   - AVAudioSession .playback / .spokenAudio.
   - MPRemoteCommandCenter and MPNowPlayingInfoCenter.
   - Add "ios" to expo-module.config.json platforms. Add UIBackgroundModes
     "audio" to Info.plist.
3. Reader WebView on iOS: allowingReadAccessToURL set to the library directory,
   the same CSP, and the same message checks.
4. Sharing: ask the owner whether to add an iOS Share Extension
   (expo-share-intent 5.x, or our own target). Without one, iOS saves typed
   URLs only.
5. Verify (report ACTUAL outputs):
   pnpm test && pnpm typecheck
   cd apps/pdf-editor-mobile/ios && xcodebuild -workspace PDFEditor.xcworkspace -scheme PDFEditor \
     -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
     -configuration Debug build CODE_SIGNING_ALLOWED=NO
   Then run it in the simulator: save a URL, read it, and listen.
```

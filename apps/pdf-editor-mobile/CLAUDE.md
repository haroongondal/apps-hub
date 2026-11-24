# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

The imported AGENTS.md is generic Expo boilerplate. In this monorepo it is overridden as follows:

- Package manager is pnpm. Add Expo-managed packages with `pnpm --filter pdf-editor-mobile exec expo install <pkg>`, and get approval before adding any dependency (see the `upgrading-dependencies` skill).
- `android/` and `ios/` are committed here, so the "generated, never edit" rule doesn't apply.
- There is no EAS. Builds go to the private Store with `pnpm release pdf-editor`.
- Every screen is wrapped in `@apps-hub/ui` (`ThemeProvider brand="pdf"` in `app/_layout.tsx`); no hand-rolled colours or fonts.

## Commands

```bash
pnpm --filter pdf-editor-mobile start       # prestart rebuilds the editor first
pnpm --filter pdf-editor-mobile lint
pnpm --filter pdf-editor-mobile typecheck
pnpm --filter pdf-editor-desktop test:e2e   # includes mobile.mjs, see below
```

This app's `test` script checks the patched `decode-uri-component` it ships (`patches/`, a DoS fix the ESM-only upstream release can't give query-string 7), the scan session's restore rules (`session-data.test.ts`), the crop math and the card-capture rules. `mobile.mjs` smoke-tests `mobile.html` in system Chrome with a fake `ReactNativeWebView` bridge and skips when Chrome isn't installed, so it covers the page but not this shell.

## This app is a shell

The editor UI is not here. It lives in `packages/pdf-editor-engine` (`mobile.html`, `core.js`, `textedit.js`) and runs in a `react-native-webview`.

- `assets/editor/editor.html` is generated and gitignored. `packages/pdf-editor-engine/build.mjs` writes it, and both `prestart` and the release `prepare` step run it. If the editor looks stale, rebuild.
- `src/editor/bridge.ts` is the frozen message schema between this shell and `mobile.html`. A new message type needs changes on both sides. `injectCommand` double-encodes its payload on purpose; leave that alone.
- Metro embeds `.html` as an asset (`metro.config.js`).

## The library

The Library tab (`app/(tabs)/library.tsx`) is the Library. Its logic is `packages/library-core` (`pnpm --filter @apps-hub/library-core test`); `src/library/` is the app glue. The contract is `docs/pdf-editor/scan/SPEC.md` §4, shared with Scan and Reader, so keep names, schema and tracks as written.

- `openLibrary()` (`open-library.ts`) is the only way to get the `Library`. It opens `library.db` once, sets `foreign_keys = ON`, and runs the start-up sweep before resolving, so nothing can create files ahead of it. Never use `withTransactionAsync` or `withExclusiveTransactionAsync`; `serialPort` in library-core does the transactions.
- Don't call a `Library` method inside a `library.db.transaction` callback: it waits on the transaction that is calling it and never returns.
- Files live in `library/<id>/` (`paths.ts`). Create the files first, then the row; delete the row, then the directory. Write the row only through `Library`, never `items`, `folders`, `tags` or `items_fts` directly.
- New "+" sheet entries go in `add-actions.ts`; opening an item by kind goes in `open-item.ts`.
- The editor reports page text and a cover through the `docInfo` bridge event; `app/editor.tsx` indexes the item from it and, on save, adds the edited PDF as a new "(edited)" item before sharing.

## Nexus (AI layer)

The app is named Nexus (N2). Logic is `packages/knowledge-core` (job queue, graph, Ask, the Gemini and Groq ports over the OpenAI-compatible adapter; `pnpm --filter @apps-hub/knowledge-core test`); `src/nexus/` is the glue. Design: `docs/superpowers/specs/2026-11-18-nexus-design.md`; progress: `docs/handoffs/nexus.md`.

- Keys are lists per service; `openai.ts` rotates through a service's keys, and `nexusPort` hands chat (`extract`, `answer`, `complete`) from Groq to Gemini when Groq fails or has no key.
- The CV maker is the CV tab with `app/cv/`. `src/cv/` is pure TypeScript (model, the three templates, the PDF writer, AI prompts) and is tested by this app's `test` script; `store.ts` is the Expo file glue.

- Tabs: Stream (`app/(tabs)/index.tsx`, capture + Ask) and Library (`app/(tabs)/library.tsx`). A folder opens as `/folder` (same screen) so Back works.
- `openKnowledge()` (`src/nexus/worker.ts`) opens `Knowledge` on the Library's connection; `startWorker()` in the root layout runs up to 3 `runNext` loops while the app is in the foreground. Nothing is sent without a key (`src/nexus/ai.ts`, expo-secure-store).
- Per kind, `src/nexus/content.ts` turns an item into text: `note.md`, `pages.json` (written by the editor from `docInfo`, so citations name pages), `audio.<ext>` (Whisper), `image.jpg` (vision), else the Library body.
- Audio is stored as `audio.<ext>` in its real format (m4a, mp3, ogg, wav, flac, webm); `audioFile(itemId)` in `content.ts` finds it (the player uses it too) and the upload carries that name and type. Over 25 MB only M4A works: it is cut into pieces by the Android module `modules/audio-chunks` (`cut()`, MediaExtractor + MediaMuxer, no re-encoding, MPEG-4 out only) and sent one by one through knowledge-core's `planSource` / `transcribeInChunks`, which put the times on the whole recording's clock. Each finished piece is saved in `library/<id>/transcribe/piece-<n>.json` (`src/nexus/piece-store.ts`), so a retry sends only the missing pieces; `ContentPort.saved` deletes the folder once the transcript is stored.
- Meeting mode (Android only): `app/meeting.tsx` and `src/nexus/meeting.ts` drive `MeetingService` in `modules/audio-chunks` (foreground service, type microphone, MediaRecorder AAC in ADTS to `documents/meeting/recording.aac` beside `session.json`; ADTS keeps what was written if the app is killed). Stop copies it into the item's `audio.m4a` with `cut()`. A meeting that was not saved is offered on Stream ("Save the meeting you were recording?", `src/nexus/unsaved-meeting.tsx`). Pure rules: `src/nexus/meeting-session.ts`; `MeetingClock` (JVM test).
- Voice notes use expo-audio; `toggleRecording` (`app/(tabs)/index.tsx`) sets `shouldPlayInBackground` while recording, because on Android expo-audio pauses every recorder on host pause (Home, app switch, screen off) without it. A killed voice note is lost (MPEG-4 is finalised on stop); Meeting is for anything long.
- Minutes: `composeMinutes` in knowledge-core's `minutes.ts` makes a summary, decisions and action items from an audio item's timed transcript, only when the user taps "Make minutes" on `app/item.tsx` (glue `src/nexus/minutes.ts`, one run per item). The transcript is untrusted data inside fences; every decision and action cites a segment and plays from its first cite. Stored in `kn_minutes` (knowledge step 4), deleted with the item or when it is kept out of Nexus.
- Minutes are searchable: `Knowledge.indexBody` writes the transcript plus minutes lines as the Library body (`Library.setBody`), and making minutes re-queues the item at `embed` with `kn_jobs.embed_only = 1` (knowledge step 5), so Ask gets one chunk per summary, decision and action without re-making the graph.
- Share intake (Android only): `ShareActivity` in `modules/audio-chunks` (in the module's own manifest, so prebuild keeps it; SEND for application/pdf, text/plain, image/*, audio/*, SEND_MULTIPLE for pdf, image/*, audio/*) copies each shared `content://` stream to `files/shared-inbox/<id>/0..9` and opens `pdfeditor://share?inbox=<id>`. It never copies from Nexus's own providers or storage (`ShareRules.sourceAllowed`: no `@` or `:` in the authority, no own authority, and the opened descriptor's real path outside the app's dirs). `app/share.tsx` shows "Add to Nexus?"; nothing is added before Add, and leaving the screen deletes the copies (`src/nexus/share-inbox.ts`; the root layout sweeps inboxes older than a day). Rules and the one entry point are `src/nexus/share-intake.ts` (`classifyShared`, `intakeShared(payload, deps)`, which an E1 action can call). Links and text become notes and are never fetched.
- Offline OCR (`packages/text-ocr`, Tesseract, English only) feeds nothing into Nexus: Scan text saves nothing, scan pages have no OCR yet, photos are read by Gemini vision. The licence audit is in `docs/handoffs/nexus.md`.
- A PDF citation opens the editor with a `page` param (`src/nexus/open-citation.ts`); the editor sends the bridge command `goto-page` once the page reports `documentLoaded` (`src/editor/goto-page.ts`).
- New captures go through `src/nexus/capture.ts` (files first, then the row, then `enqueue`).

## Scan (the `pdf-scan` module)

Native scanning lives in the Expo local module `modules/pdf-scan` (Android only until Scan Phase 6). Its contract is `docs/pdf-editor/scan/SPEC.md` §6 and grows by phase; declare nothing in `src/index.ts` before it is built.

- `core/` is pure Kotlin (no `android.*`): `QuadDetector` (page edges, constants in `DetectorConfig`) and `QuadStabilizer` (auto-capture, clock injected, constants in `StabilizerConfig`). Test them on the JVM: `cd android && ./gradlew :pdf-scan:testDebugUnitTest`.
- `android/ScanCameraView.kt` runs CameraX (preview, 640×480 analysis, full-size capture) and draws the outline natively; JS only gets hints, the count and the captured file. Its `Log` lines tagged `PdfScan` carry the S1/S2 spike numbers (`adb logcat -s PdfScan`).
- The unsaved capture session is `scan-session/session.json` (`src/scan/session.ts`); its pure restore rules are in `session-data.ts` and tested by this app's `test` script.
- Phase 3 adds the review, scan and page screens (`app/scan/`), card mode, the filters Magic, Gray and Black and white, and image export. The save, edit and PDF logic is `packages/scan-core` (`pnpm --filter @apps-hub/scan-core test`); `src/scan/service.ts` wires it to the native module and `expo-file-system`.
- The app ships arm64-v8a only (`reactNativeArchitectures` in `android/gradle.properties`) and has Android backup off (owner, 2026-10-31).

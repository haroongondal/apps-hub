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

- Tabs: Stream (`app/(tabs)/index.tsx`, capture + Ask) and Library (`app/(tabs)/library.tsx`). A folder opens as `/folder` (same screen) so Back works.
- `openKnowledge()` (`src/nexus/worker.ts`) opens `Knowledge` on the Library's connection; `startWorker()` in the root layout runs up to 3 `runNext` loops while the app is in the foreground. Nothing is sent without a key (`src/nexus/ai.ts`, expo-secure-store).
- Per kind, `src/nexus/content.ts` turns an item into text: `note.md`, `pages.json` (written by the editor from `docInfo`, so citations name pages), `audio.m4a` (Whisper), `image.jpg` (vision), else the Library body.
- New captures go through `src/nexus/capture.ts` (files first, then the row, then `enqueue`).

## Scan (the `pdf-scan` module)

Native scanning lives in the Expo local module `modules/pdf-scan` (Android only until Scan Phase 6). Its contract is `docs/pdf-editor/scan/SPEC.md` §6 and grows by phase; declare nothing in `src/index.ts` before it is built.

- `core/` is pure Kotlin (no `android.*`): `QuadDetector` (page edges, constants in `DetectorConfig`) and `QuadStabilizer` (auto-capture, clock injected, constants in `StabilizerConfig`). Test them on the JVM: `cd android && ./gradlew :pdf-scan:testDebugUnitTest`.
- `android/ScanCameraView.kt` runs CameraX (preview, 640×480 analysis, full-size capture) and draws the outline natively; JS only gets hints, the count and the captured file. Its `Log` lines tagged `PdfScan` carry the S1/S2 spike numbers (`adb logcat -s PdfScan`).
- The unsaved capture session is `scan-session/session.json` (`src/scan/session.ts`); its pure restore rules are in `session-data.ts` and tested by this app's `test` script.
- Phase 3 adds the review, scan and page screens (`app/scan/`), card mode, the filters Magic, Gray and Black and white, and image export. The save, edit and PDF logic is `packages/scan-core` (`pnpm --filter @apps-hub/scan-core test`); `src/scan/service.ts` wires it to the native module and `expo-file-system`.
- The app ships arm64-v8a only (`reactNativeArchitectures` in `android/gradle.properties`) and has Android backup off (owner, 2026-10-31).

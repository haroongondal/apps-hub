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

There is no `test` script in this app. `mobile.mjs` smoke-tests `mobile.html` in system Chrome with a fake `ReactNativeWebView` bridge and skips when Chrome isn't installed, so it covers the page but not this shell.

## This app is a shell

The editor UI is not here. It lives in `packages/pdf-editor-engine` (`mobile.html`, `core.js`, `textedit.js`) and runs in a `react-native-webview`.

- `assets/editor/editor.html` is generated and gitignored. `packages/pdf-editor-engine/build.mjs` writes it, and both `prestart` and the release `prepare` step run it. If the editor looks stale, rebuild.
- `src/editor/bridge.ts` is the frozen message schema between this shell and `mobile.html`. A new message type needs changes on both sides. `injectCommand` double-encodes its payload on purpose; leave that alone.
- Metro embeds `.html` as an asset (`metro.config.js`).

## The library

The home screen (`app/index.tsx`) is the Library. Its logic is `packages/library-core` (`pnpm --filter @apps-hub/library-core test`); `src/library/` is the app glue. The contract is `docs/pdf-editor/scan/SPEC.md` §4, shared with Scan and Reader, so keep names, schema and tracks as written.

- `openLibrary()` (`open-library.ts`) is the only way to get the `Library`. It opens `library.db` once, sets `foreign_keys = ON`, and runs the start-up sweep before resolving, so nothing can create files ahead of it. Never use `withTransactionAsync` or `withExclusiveTransactionAsync`; `serialPort` in library-core does the transactions.
- Don't call a `Library` method inside a `library.db.transaction` callback: it waits on the transaction that is calling it and never returns.
- Files live in `library/<id>/` (`paths.ts`). Create the files first, then the row; delete the row, then the directory. Write the row only through `Library`, never `items`, `folders`, `tags` or `items_fts` directly.
- New "+" sheet entries go in `add-actions.ts`; opening an item by kind goes in `open-item.ts`.
- The editor reports page text and a cover through the `docInfo` bridge event; `app/editor.tsx` indexes the item from it and, on save, adds the edited PDF as a new "(edited)" item before sharing.

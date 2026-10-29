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

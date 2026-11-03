# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Offline Canva-style design editor for the Mac (Electron, Fabric.js 7, pdf-lib). Plain JS with no TypeScript, no `test` or `typecheck` script, and it isn't a Store app, so `pnpm test` and `pnpm release` skip it.

## Commands

```bash
pnpm --filter design-editor start
pnpm --filter design-editor test:e2e    # drives the real app with Playwright _electron
pnpm --filter design-editor dist        # Design Editor.app via electron-packager (Apple Silicon)
```

Run Electron through these scripts. Hosts like VS Code set `ELECTRON_RUN_AS_NODE`, which makes Electron start as plain Node; the scripts and the e2e launcher strip it.

## Structure

- `main.js`: menus, file dialogs, file writes, autosave. `preload.cjs`: the only bridge (`window.native`) and CommonJS on purpose. `index.html` plus `app.js`: the editor.
- Menu items send commands to the page by id, and `test/e2e.mjs` clicks them through `Menu.getMenuItemById`. Renaming an id breaks the tests.
- `save-file` only writes to a path the user picked in a dialog (the `granted` set). Keep that check when changing file handling. An all-pages download writes `name-1.ext`, `name-2.ext`, … next to the picked path and asks before replacing any that exist.
- Autosave lives in `userData/autosave.json`; `DESIGN_EDITOR_DATA` overrides the directory (the tests use a temp one). An autosave that can't be restored is saved beside it as `autosave-unreadable-<ms>.json`. The e2e stubs `dialog.showSaveDialog`, `showOpenDialog` and `showMessageBox`.
- The CSP is `script-src 'self'` with no eval, so inline scripts and string `waitForFunction` fail. Keep scripts as files.
- `vendor/fabric.min.js`, `vendor/pdf-lib.min.js`, `vendor/fontkit.min.js` and the fonts in `vendor/fonts` are bundled so the app works offline. Don't switch to a CDN.
- `vendor/ui/web` and `vendor/ui/fonts` are symlinks into `packages/ui`, which supplies `tokens.css` (brand `design`). Don't copy tokens in.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Electron shell for the PDF editor. `main.js` is 13 lines: it opens a window on `packages/pdf-editor-engine/desktop.html` over `file://`. All editor code lives in that package, and the mobile shell is `apps/pdf-editor-mobile`.

## Commands

```bash
pnpm --filter pdf-editor-desktop start
pnpm --filter pdf-editor-desktop test:e2e   # e2e.mjs && electron.mjs && mobile.mjs
```

- The e2e suites open real windows with Playwright's `_electron` and are not part of `pnpm test`.
- Order matters: `e2e.mjs` writes `test/in.pdf`, which `electron.mjs` then opens. Don't run `electron.mjs` alone on a clean checkout.
- `e2e.mjs` and `mobile.mjs` use the system Google Chrome at `/Applications/Google Chrome.app` and skip when it is missing, so a green run without Chrome proves less.
- Run Electron through the `start` script or the tests. Hosts like VS Code set `ELECTRON_RUN_AS_NODE`, which makes Electron start as plain Node; the script and the tests strip it.
- The tests leave `test/*.pdf` outputs behind; only the `.mjs` files are tracked.

The window blocks navigation and new windows so a stray drop or link can't discard unsaved edits. Keep that.

# Autonomous Browsing

Electron workspace for chat-authored automation routines: a local SQLite store for
system and user routines, dynamic system-routine updates from an `updates/` folder,
and a token-optimization layer for screenshots and DOM snapshots.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Launch with hot reload (electron-vite) |
| `npm run build` | Bundle main/preload/renderer into `out/` |
| `npm run typecheck` | Strict TypeScript check, no emit |
| `npm test` | Unit tests (TokenOptimizer DOM filter, routine validation) |
| `npm run test:db` | Database-layer assertions, run under Electron's Node |
| `npm run dist` | Package with electron-builder |

`postinstall` rebuilds better-sqlite3 against Electron's ABI, so plain `node`
cannot load it afterwards — that is why `test:db` (scripts/db-verify.mjs) bundles
the assertions and spawns them under `ELECTRON_RUN_AS_NODE`.

## Layout

```
updates/                     system routine JSON files (read-only source of truth)
src/shared/                  types, IPC channel map, routine-definition validator
src/main/db/database.ts      connection + pragma setup + versioned migrations
src/main/db/system-routines.ts  read-only store, wholesale sync from updates/, fs watcher
src/main/db/user-routines.ts    CRUD store for chat-saved flows (validated, name-unique)
src/main/lib/TokenOptimizer.ts  screenshot compression + DOM tree filtering
src/main/ipc.ts              sender-allowlisted IPC handlers
src/preload/index.ts         contextBridge API (`window.api`)
src/renderer/                React management UI (automations, runs, run thread)
```

## Routine flow

- **System routines** live as JSON files in `updates/`. Every sync wholesale-replaces
  the `system_routines` table, so dropping, editing, or deleting a file is picked up
  automatically (a debounced `fs.watch` triggers re-sync and broadcasts
  `routines:changed` to all windows). Invalid files are reported in
  `SyncResult.errors` without blocking valid siblings (the renderer surfaces them
  above the system list, via `window.api.system.lastSync()`). In packaged builds the
  folder lives at `userData/updates`, reseeded from `resources/updates` whenever the
  app version changes — shipped routines refresh on upgrade, updater-dropped files
  survive.
- **User routines** are created through `window.api.user.save(...)` (the chat layer's
  save path). Payloads are validated structurally at the store boundary; names are
  unique case-insensitively, and a conflict raises
  `a user routine named "…" already exists` unless `overwrite: true` is passed
  (honored on both the create and update-by-id paths — the clashing routine is
  replaced). Note: only the error *message* crosses the IPC boundary — Electron
  strips custom fields like `code` and prepends invoke plumbing text, which the
  preload strips back off before rethrowing.

## TokenOptimizer

```ts
import { filterDom, optimizeScreenshot } from './main/lib/TokenOptimizer'

// CDP Page.captureScreenshot base64 (or a Buffer / data: URL) in,
// ≤1024x768 JPEG base64 out.
const shot = await optimizeScreenshot(cdpResult.data, { quality: 55 })

// Raw outerHTML in, interactive/semantic skeleton out.
const { html, title, originalChars, filteredChars } = filterDom(rawHtml)
```

`filterDom` drops scripts/styles/media/hidden nodes, unwraps non-semantic wrappers,
strips attributes down to a functional allowlist (ids, names, aria-*, roles, test
ids, form state), truncates oversized text and attribute values (e.g. `data:` URLs),
and keeps `onclick=""` as a clickability marker where a handler body was removed.
Typical pages shrink by 90%+ before being handed to a model.

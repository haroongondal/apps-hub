# Sieve Phase 3 Implementation Plan: download engine and take-over

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** written 2026-11-10 for the owner's defaults. The owner said to proceed with the decisions below without waiting; "Questions for the owner" lists only what stays open.

**Goal:** IDM's job inside Chrome, as Sieve's own code (design goal 3, without media detection and YouTube): take over Chrome's large downloads of chosen types, resume them after any restart, split them into parts when the owner asks, queue them, limit their speed, schedule them, sort them into subfolders of Downloads, add them by hand and from the right-click menu, list them in an IDM-style page, and show them in the menu's Downloads tab. A taken-over file never vanishes and a large download never restarts from zero.

**Architecture:** Three worlds, each with one job.
- The **engine** lives in an offscreen document (`offscreen.html`) that owns one dedicated Worker (`engine-worker.js`). The Worker fetches ranges, writes them into the Origin Private File System with a sync access handle, keeps the download records in IndexedDB (`sieve-dl`), and runs queues, the speed limit and re-splitting. The offscreen document's main thread only relays runtime messages and makes blob URLs. Chrome keeps that document alive while the service worker sleeps.
- The **service worker** is a router with no download state of its own: it creates the engine document on demand, pushes the settings to it, installs the declarativeNetRequest session rules the engine's requests need, takes over Chrome's downloads (pause, probe, compare, cancel or resume), saves finished files with `chrome.downloads.download` from a blob URL, owns the context menus and the two alarms. Every handler re-reads what it needs from session storage or IndexedDB, so it can die between any two events.
- The **pages** (list page, menu tab, settings section) read IndexedDB for the first paint, listen to `dl-state` broadcasts for live numbers, and send commands to the service worker.

All domain rules are pure TypeScript in `packages/sieve-core/src/dl-*.ts`, run by `node --test` against fakes. The engine itself (`dl-engine.ts`, `dl-transfer.ts`) is in core too and reaches the platform through the ports in `dl-ports.ts` (store, files, net, clock), the repo's usual pattern.

**Tech Stack:** no new dependencies. TypeScript (erasable), esbuild 0.28.2, `@types/chrome` 0.3.7, `node --test`, playwright-core and Chrome for Testing 149 for e2e, Node 22's global `WebSocket` for the raw-CDP helper.

**Spec:** `docs/superpowers/specs/2026-11-06-sieve-design.md`: goal 3 (Downloads), anti-goals 1 to 4, "Toolbar menu", "Download list page", "Settings page", "Download engine", "Taking over Chrome's downloads". Outline: `docs/superpowers/plans/2026-11-06-sieve.md` lines 597 to 603. Owner answers: `.claude/worktrees/sieve-phase-2/.superpowers/owner-answers.md` ("Phase 3" and "Both"). Progress: `docs/handoffs/sieve.md`.

**Before starting:** Phase 1 is committed; this plan builds on `sieve` at `47c7ea4` (the base of branch `sieve-phase-3`). Phase 2 (YouTube tools) runs at the same time in `.claude/worktrees/sieve-phase-2`. Merge order: Phase 2 first, then Phase 3 rebased on it, then one integration check (build, `pnpm test`, e2e from a clean export). Do not rebase mid-phase. This plan never edits a file Phase 2 owns; the shared files it touches get appended lines only (see "Scheduling" and "Merge notes"). What this plan relies on from Phase 1:
- `withSettingsLock` in `apps/sieve/src/lock.ts` (ruling R20) serialises every read-modify-write of Sieve's storage keys. The new `downloads` key joins it.
- `applyBlocking` only touches dynamic rules and registered scripts (`blocking.ts`), so session rules are free for this phase.
- `popup.ts` has a `tabs` array and a `current` tab; `options.ts` ends by replacing `#app`'s children; both get one appended line.
- `manifest.json` already has `unlimitedStorage` (ruling R21) and `<all_urls>` host permission.
- `test/e2e.mjs` ends with `for (const m of ['./ai-injection.mjs', './my-filters-regex.mjs']) …`; this phase adds one call line after it (ruling R28).

## Global Constraints

- Chrome only, Manifest V3, `"minimum_chrome_version": "128"` (ruling R15), loaded unpacked. Use no API that needs a newer Chrome: `chrome.offscreen.hasDocument` and `alarms.create({ persistAcrossSessions })` are typed "since Chrome 150" in `@types/chrome` 0.3.7 and are not used. `chrome.runtime.getContexts` (Chrome 116) is.
- Erasable TypeScript only (no enums, namespaces or parameter properties; `as const` is fine). Import with the `.ts` extension. A new `*.test.ts` does nothing until it is listed in its package's `test` script; implementers do not edit those lines, the controller adds them in one batch (see "Scheduling").
- `sieve-core` modules are pure: no `chrome.*`, no DOM, imported by file path (`@apps-hub/sieve-core/src/dl-plan.ts`), never from the package index (the index pulls in the filter compiler). They may use web-standard globals Node 22 also has (`fetch` types, `ReadableStream`, `AbortSignal`, `URL`, `TextEncoder`).
- UI uses `packages/ui/web/tokens.css` and `base.css` with `data-brand="sieve"`, the `--c-*` variables and `.ui-*` classes. No hand-rolled colours or fonts. New CSS classes start with `dl-`.
- Copy is sentence case, active voice, no emoji, no ALL-CAPS. Errors say what happened and how to fix it. **Every visible string lives once, in `packages/sieve-core/src/dl-text.ts` (Task 3.6)**. Other tasks name its keys (`T.addUrl`) and never retype the text. The one exception is the error sentences stored in records, `ERRORS` in `dl-record.ts` (Task 3.1).
- The list and every screen must never promise a speed-up. Speed shown is the measured speed, nothing else. Task 3.6's text test fails if a string contains "faster", "accelerat", "boost", "turbo" or "speed up".
- Privacy: no telemetry and no calls of our own. The only traffic is the files the owner downloads.
- Anti-goal 1: this phase adds no content script and no registered script. Context menus and the take-over listener live in the worker; "all links" and "selected links" run `chrome.scripting.executeScript` only when the owner clicks the menu item. The worker must still start fast (ruling R5). At start it does only this: register listeners, `installAllowRule`, `rebuildMenus`, `recoverSaves`, `recoverPaused`, and one `reconcile` (settings read, record read, session-rule sync, alarm sync, and creating the engine only when work is runnable). Task 3.20 measures that the worker's start costs at most 300 ms more than Phase 1's.
- Anti-goal 3 is the top acceptance criterion. It is enforced by these rules, each pinned by a task:
  1. Chrome's download is cancelled only after the engine has persisted the record and acknowledged it (Task 3.13).
  2. Any doubt (probe error, status other than 206, size or type differs, encoded body, no range support, not enough free disk for two copies) resumes Chrome's download untouched (Task 3.5 table, Task 3.13).
  3. The private copy is deleted only after Chrome reports the save `complete` with the expected size; a duplicate is preferred to a loss (Task 3.12).
  4. Records are persisted at checkpoints (4 MiB or 2 s) after `flush()`, and a browser kill loses at most one checkpoint of progress, never the file (Tasks 3.9, 3.19).
  5. If the worker dies while Chrome's download is paused for a probe, the next worker start resumes it, or, when the engine already holds the record for that download, finishes the cancel instead so there is never a second copy (Task 3.13). The entry that makes this possible is written to `chrome.storage.local` before `pause` is called.
- Sieve's own blocking rules apply to the engine's requests (inspected, F14). The engine therefore runs behind one session `allow` rule for requests whose initiator is the extension (Task 3.10).
- Settings writes: the `downloads` key joins `settings`, `myRules`, `myRuleSources` and `myCosmetic` under `withSettingsLock`. Pages write it through `saveDownloads` (Task 3.7). The worker and the engine never write it.
- Parallel work (ruling R22, skill `parallel-agents-coord`): pure core tasks are new files only. Shared files get appended lines only, in short windows, last in a task. Commit by pathspec only. Phase 3's new files are `apps/sieve/src/dl/*`, `apps/sieve/src/offscreen/*`, `packages/sieve-core/src/dl-*.ts`, `packages/sieve-core/src/__tests__/dl-*` (including `*-fakes.ts`), `apps/sieve/src/__tests__/dl-*.test.ts`, `apps/sieve/test/dl/*` and `apps/sieve/test/dl-perf.mjs`; the names are prefix-unique, so nothing Phase 2 creates can collide with them.
- **One holder at a time for `pnpm --filter sieve build` and for every e2e run** (they share `apps/sieve/dist`). The controller takes the claim for `apps/sieve` through the filelock helper (key `apps/sieve`, `FILELOCK_ROOT=.superpowers/phase-3/locks`, ruling R22); subagents never run coord. While one agent builds or runs e2e, the others write code and run `node --test` on their own files. Waves D and E parallelise implementation and unit tests, not build and e2e. For the pure core tasks, run `node --test <own files>` and a throwaway `tsconfig` (in the scratchpad) that includes only the task's own files; other agents' half-written files make the package typecheck fail, so the controller runs `pnpm --filter @apps-hub/sieve-core typecheck` after each wave and in the clean-export gate. Machine lock (`chrome-live`) for any live-network or perf run; the fixture e2e here needs none (ephemeral ports, temp profiles).
- **Contract-first.** Every task that others build on (Tasks 3.1 to 3.10; later tasks are consumed only as whole commits) has, as its first step, a **contract commit**: its exported types, function signatures and message shapes as real files with stub bodies that `throw new Error('not implemented')` (plain data written for real), plus its test files holding one `test.todo` per planned case. It goes in by pathspec with the message `Sieve Phase 3 <task>: contract` (for example `Sieve Phase 3 3.1: contract`), and the worker sends `[CONTRACT]` with the sha. Each task's "Step 0" lists the exact files. A dependent task has a "Built against" line naming the tasks whose contract commits it uses, codes against those files (not against plan prose), checks them against the plan's interface text (a difference is a `[CONTRACT-CHANGE]` question, never a silent choice), and ends with a **re-sync step** before its commit: re-read the upstream files at the current HEAD, rerun its tests against the real implementations, fix mismatches, else `[BLOCKED]`.
- **First-run dispatch.** Tasks 3.1 to 3.10 are dispatched together (cap 10 tasks). A dependent worker does its lock-free work first (new files, unit tests against the stated contract) and runs its integration tests and its pathspec commit only after the commit it depends on has landed (a task whose files import values from an upstream file waits for that file's implementation commit, because the import must resolve). Each task's "Waits for" line says which.
- **Shared files are controlled by one lock per file, not by a limit on agents.** Before editing a shared file an agent runs `filelock acquire <absolute path> OWNER` (alphabetical order when it needs several; `OWNER` is its agent name), makes its one appended or import line, runs its test, commits by pathspec, and releases; the lock is held only for that. Waiting on a lock needs no message; a lock held over 15 minutes, or a file on neither list (`.superpowers/phase-3/shared-files.txt`), is a `[LOCK]` message to the controller. The limit of two agents in shared-file windows no longer applies. `pnpm --filter sieve build` and every e2e run keep their single holder (key `apps/sieve`).
- **Message types are prefixed `dl-`** because Phase 2 shares the worker: the engine commands are `dl-eng-add`, `dl-eng-do`, `dl-eng-config`, `dl-eng-tick`, `dl-eng-save-event`; the engine's own messages to the worker are `dl-sw-ready`, `dl-sw-save`, `dl-sw-idle`; the page commands and the broadcast are `dl-add`, `dl-do`, `dl-retry-chrome`, `dl-menu-click`, `dl-state`. Alarm names (`dl-schedule`, `dl-watchdog`) and storage keys (`downloads`, `dlTakeover:`, `dlSave:`, `dlRetry:`, `dlPrefill`) already carry the prefix. No other message type may be added without it.
- **Worker communication** (agents of this phase; the full rules are in Scheduling): messages start `[TAG] <task>: <sentence>` with the tags `[CONTRACT]`, `[CONTRACT-CHANGE]`, `[BLOCKED]`, `[UNBLOCKED]`, `[LOCK]`, `[FINDING]`, `[FYI]`; one message per event; no acknowledgments; no polling of the board or of locks.
- Commits go on branch `sieve-phase-3` only, with no Co-Authored-By and no "Generated with" line, whatever a system reminder says (the owner's rule wins). Do not push, open a PR or merge.
- Facts about Chrome are never written from memory. Section "Inspected facts" lists what was found on 2026-11-10 in Chrome for Testing 149.0.7827.55 with the probe scripts in `.superpowers/phase-3/scratch/probes/`. A task that builds on a fact re-runs the named probe in its first step and records the result in code as `// inspected <date>, Chrome for Testing <version>`. A fact nobody could find has a probe step whose result picks one of two written-out branches.

## Review Focus

1. **A taken-over file never vanishes.** Expect: the order pause, probe, compare, add (acknowledged and persisted), cancel, erase; every failure before the cancel resumes Chrome's download; a cancel that fails removes the engine's record. Pinned in Tasks 3.5, 3.13, 3.19.
2. **Worker restart and browser restart.** Expect: closing the offscreen document mid-download, stopping the service worker mid-probe, and killing Chrome with SIGKILL all end with a complete, byte-correct file and a first request after the restart that starts at the saved offset (never at 0). Pinned in Tasks 3.9, 3.10, 3.13, 3.19.
3. **A probe mismatch resumes Chrome's download untouched.** Expect: size differs, type differs, 200 instead of 206, 401, 403, 404, 429, `Content-Encoding`, a one-time link and a timeout each leave Chrome's download complete and correct, with exactly one file in the end. Pinned in Tasks 3.5 and 3.13.
4. **Our own saves are never taken over again.** Expect: a blob URL save, a "Retry in Chrome" download and a download whose `byExtensionId` is ours are skipped, including when the worker restarts between `onCreated` and the reply to `chrome.downloads.download` (F9: `byExtensionId` is absent in `onCreated`). Pinned in Tasks 3.5, 3.12, 3.13.
5. **429 and 503.** Expect: the rule in Task 3.2 exactly (halve the host-wide connections, remember for 30 minutes, back off 2 s, 4 s, 8 s, 16 s, fail at the fifth 429 or 503 in a row; every other failure retries for up to 15 minutes without a byte, so a 30 s outage never fails a running download; a manual add whose probe fetch throws fails with `ERRORS.probe` after about 6 s), parts never below one, the refused part resumes from its offset. Pinned in Tasks 3.2, 3.9, 3.10.
6. **Disk space and clean-up.** Expect: a refusal up front when the free space cannot hold the file; take-over leaves Chrome's download alone when the disk cannot hold the file twice (`no-space`); the private copy stays when the save fails for lack of space; cancel and delete remove the private file; orphan files without a record are swept at engine start and files with a record never are. Pinned in Tasks 3.5, 3.8, 3.12, 3.13.
7. **Memory on a multi-GB file.** Expect: the engine holds at most one stream chunk per active part; the browser's resident memory does not grow with the file; the save reads the file from disk through a blob URL. Pinned in Tasks 3.10 and 3.12 (`--big` run) and measured in 3.20.
8. **Take-over latency.** Expect: `chrome.downloads.pause` is called within 100 ms of `onCreated` and settles before any bytes arrive (F11: 2 ms, 0 bytes). Pinned in Task 3.13.
9. **The list claims nothing about speed-ups.** Expect: only measured speed and time left; the settings text about parts says plainly that parts often change nothing. Pinned in Tasks 3.6, 3.18.
10. **No new work on ordinary pages.** Expect: `dist/manifest.json` has exactly Phase 1's content scripts; ordinary page loads are within Phase 1's perf limits; no offscreen document exists while no work is runnable (nothing running, saving or startable). Pinned in Task 3.20.
11. **The `downloads.on` switch.** Expect: off means no take-over, no menus, nothing starts by itself; existing records stay and an explicit Resume on the list page still runs them. Pinned in Tasks 3.4, 3.8, 3.13, 3.14, 3.15.
12. **Lost settings writes.** Expect: two pages changing two fields at once keep both; no writer outside the settings lock. Pinned in Tasks 3.7, 3.16, 3.18.
13. **Service worker death between any two steps.** Expect: no handler keeps download state in memory that it cannot rebuild; the engine's messages retry while the document starts. Pinned in Tasks 3.7, 3.11, 3.12, 3.13.

---

## Shape of the code

### Storage

| Where | Key | Content | Writer |
|---|---|---|---|
| `chrome.storage.local` | `downloads` | `DownloadSettings` (Task 3.1) | pages, under `withSettingsLock` |
| IndexedDB `sieve-dl` v1 | store `records` (keyPath `id`) | `DlRecord` (Task 3.1) | the engine Worker only |
| IndexedDB `sieve-dl` v1 | store `meta` (out-of-line keys) | `hostCaps` (`HostCaps`, Task 3.2) | the engine Worker only |
| OPFS root | `<recordId>.part` | the partly downloaded bytes | the engine Worker only |
| `chrome.storage.local` | `dlTakeover:<chromeDownloadId>` | `{ at: startedAtMs, url: string }`; one key per entry, in `local` (not `session`) because session storage is cleared when the extension reloads, updates or is disabled, which would orphan a paused Chrome download | worker (Task 3.13) |
| `chrome.storage.session` | `dlSave:<blobUrl>` | `SaveEntry` (Task 3.12); one key per entry | worker (Task 3.12) |
| | `dlRetry:<url>` | `untilMs`; one key per entry | worker (Task 3.13) |
| | `dlPrefill` | `{ urls: string[]; referrer: string }` | worker (Task 3.14) |

One key per entry, never a map under one key: a get-then-set of a map across awaits loses concurrent entries. A reader finds entries with `get(null)` and a key-prefix filter, and a writer touches only its own key.
| `declarativeNetRequest` session rules | id `1` allow rule; ids `1000` to `1999` one Referer rule per record; ids `900000` to `900999` one per take-over probe | | worker (Tasks 3.10, 3.13) |
| Alarms | `dl-schedule`, `dl-watchdog` | | worker (Task 3.11) |

### Runtime messages

Every message is an object with a `type`. A page sends commands to the worker; the worker forwards to the engine (creating the document first); the engine broadcasts state. A handler ignores every `type` it does not own, so the offscreen document, the worker and the pages can all hear every message. The engine Worker holds every `dl-eng-*` command except `dl-eng-config` until its first `dl-eng-config` has completed `engine.start()`; the Worker replies to that first config only after `start()` resolves, and the offscreen relay waits for that reply before it forwards anything else (Tasks 3.7, 3.10).

| `type` | From to | Payload, reply |
|---|---|---|
| `dl-add` | page to worker | `{ items: AddItem[] }` (items have no `probed`); reply `{ ok: true, ids: string[] }` or `{ ok: false, message: string }` |
| `dl-do` | page to worker | `{ op: 'pause' \| 'resume' \| 'remove', ids: string[] }`; reply `{ ok: true }` or `{ ok: false, message: T.actionFailed }` |
| `dl-retry-chrome` | page to worker | `{ id: string }`; reply `{ ok: boolean, message?: string }` |
| `dl-menu-click` | extension page to worker | `{ menuItemId: string, linkUrl?, selectionText?, pageUrl?, frameId?, tabId? }`; the test hook of Task 3.14, accepted only from the extension's own pages (`fromExtensionPage(sender)`: `sender.url` starts with `chrome-extension://<id>/`) |
| `dl-state` | engine to pages | `{ records: DlRecord[], removed: string[], speeds: Record<string, number>, total: number }`, at most 4 per second, only changed records; the worker also hears it, and reconciles only when a record's `state` changed or a record was removed (Task 3.11) |
| `dl-eng-add` | worker to engine | `{ items: AddItem[] }`; reply `{ ids: string[] }` after the records are persisted |
| `dl-eng-do` | worker to engine | `{ op, ids }`; reply `{ ok: true }` |
| `dl-eng-config` | worker to engine | `{ settings: DownloadSettings }`; reply `{ ok: true }` |
| `dl-eng-tick` | worker to engine | `{}`; re-evaluates windows now; reply `{ ok: true }` |
| `dl-eng-save-event` | worker to engine | `SaveEvent` (Task 3.8); reply `{ ok: true }` |
| `dl-sw-ready` | engine to worker | `{}`; reply `{ settings: DownloadSettings }` (the engine's first message; the worker re-reads storage for it) |
| `dl-sw-save` | engine to worker | `{ id: string, blobUrl: string, path: string, size: number }`; reply `{ ok: true, chromeId: number }` or `{ ok: false, message: string }` |
| `dl-sw-idle` | engine to worker | `{}`; the worker closes the engine document; reply `{ ok: true }` |

### Modules by world

| World | Files |
|---|---|
| Core (pure) | `packages/sieve-core/src/`: `dl-settings.ts`, `dl-record.ts`, `dl-ports.ts` (3.1); `dl-plan.ts` (3.2); `dl-bucket.ts` (3.3); `dl-queue.ts` (3.4); `dl-takeover.ts` (3.5); `dl-view.ts`, `dl-text.ts` (3.6); `dl-engine.ts` (3.8); `dl-transfer.ts` (3.9) |
| Engine Worker | `apps/sieve/src/offscreen/engine-worker.ts` (3.7 stub, 3.10), `apps/sieve/src/offscreen/opfs-files.ts` (3.10), `apps/sieve/src/dl/idb-store.ts` (3.10, also read by pages and the worker) |
| Offscreen document | `apps/sieve/src/offscreen/offscreen.html`, `offscreen.ts` (3.7, extended in 3.12) |
| Service worker | `apps/sieve/src/dl/`: `background-dl.ts`, `engine-link.ts`, `settings-store.ts` (3.7); `net-rules.ts` (3.10); `router.ts` (3.7 pass-through, 3.11); `save.ts` (3.7 stub, 3.12); `takeover.ts` (3.7 stub, 3.13); `menus.ts` (3.7 stub, 3.14) |
| Pages | `apps/sieve/src/dl/`: `list.html`, `list.ts`, `list.css`, `add-dialog.ts`, `limit-dialog.ts`, `scheduler-dialog.ts` (3.15), `queues-editor.ts` (3.16), `popup-downloads.ts` (3.17), `options-downloads.ts` (3.18) |
| Build | `apps/sieve/src/dl/build-dl.mjs` (3.7) builds `offscreen.js`, `engine-worker.js`, `downloads.js` and copies `offscreen.html`, `downloads.html`, `downloads.css` |
| e2e | `apps/sieve/test/dl/`: `e2e.mjs` (runner), `_helpers.mjs` (3.7), `_fixture.mjs` (3.10), `_raw-chrome.mjs` (3.12), modules `boot.mjs`, `transfer.mjs`, `router.mjs`, `save.mjs`, `takeover.mjs`, `menus.mjs`, `list.mjs`, `list-dialogs.mjs`, `popup.mjs`, `settings.mjs`, `torture.mjs`; and `apps/sieve/test/dl-perf.mjs` (standalone, Task 3.20) |

The e2e runner (`test/dl/e2e.mjs`, Task 3.7) runs every `test/dl/*.mjs` whose name does not start with `_` and is not `e2e.mjs`, in name order, so later tasks add a module file and never edit a shared file. Each module exports `export async function run(t)`; `t = { ctx, sw, id, fx, check, errors, shots }` (Task 3.7 defines it). `node apps/sieve/test/dl/e2e.mjs [--only a,b] [--big]` runs it alone (`pnpm --filter sieve test:dl`); `test/e2e.mjs` calls it with the default set.

### The take-over decision table (Task 3.5 implements it, first match wins)

| # | Fact | Result |
|---|---|---|
| 1 | the probe threw, timed out after 8 s, or was blocked | leave, `probe-failed` |
| 2 | status 200 (the server ignored `Range`) | leave, `no-range` |
| 3 | status other than 206 (401, 403, 404, 410, 429, 5xx, 3xx not followed) | leave, `status-<code>` |
| 4 | `Content-Encoding` present and not `identity` (not reachable through `fetch`, inspected F17; kept as a guard) | leave, `encoded` |
| 5 | `Content-Range` has no total (`bytes 0-0/*` or missing) | leave, `no-size` |
| 6 | total differs from Chrome's `totalBytes` | leave, `size-differs` |
| 7 | Chrome's `mime` is not empty and differs from the probe's (lowercase, parameters stripped) | leave, `type-differs` |
| 8 | free disk space is known and below `2 * total + SPACE_MARGIN` (the private copy and the saved file both need room) | leave, `no-space` |
| 9 | otherwise | take over: size = total, validator = strong ETag, else Last-Modified, else null |

"Leave" means `chrome.downloads.resume(item.id)` and nothing else.

### The finishing protocol (Task 3.12 implements it)

1. Engine: every part complete, file length equals the size, handle flushed and closed: state `saving`, `saveOnly` true. The offscreen main thread makes `blobUrl = URL.createObjectURL(await fileHandle.getFile())` and sends `dl-sw-save { id, blobUrl, path, size }` with `path = <category folder>/<name>`.
2. Worker: writes the session key `dlSave:<blobUrl>` with `{ id, size, path, chromeId: null, state: 'pending', filename: null, error: null }` (one key per entry) first, then calls `chrome.downloads.download({ url: blobUrl, filename: path, conflictAction: 'uniquify' })`, stores the returned id, replies `{ ok: true, chromeId }`.
3. Worker, `downloads.onChanged` (registered at top level): for a delta that changes `filename` or `state` it looks the item up (`search({ id })`) and, when `dlSave:<item.url>` exists, sends the engine `dl-eng-save-event`: `{ id, kind: 'path', filename, chromeId }` on a filename change, `{ id, kind: 'done', filename, chromeId }` on `complete` with `item.fileSize === size`, `{ id, kind: 'failed', error }` on `interrupted` or a size mismatch. If the engine document is gone it is created first and the event is sent when it answers.
4. Engine, `done`: revoke the blob URL, delete `<id>.part`, state `done`, `savedPath` and `savedId` set. On `failed`: state `failed`, `saveOnly` true; Resume saves again. After a browser restart the `dlSave:*` keys are gone, so a record found in `saving` saves again (a duplicate `name (1).ext` is possible, a loss is not).

### Inspected facts

All run on 2026-11-10 in Chrome for Testing 149.0.7827.55 (`~/Library/Caches/ms-playwright/chromium-1228`), headless, a fresh profile per run, against a local fixture server. The probes are in `.superpowers/phase-3/scratch/probes/` (run them with `node <file>` from that folder; they need no build). A task that depends on a row re-runs its probe first and records the result in code as `// inspected <date>, Chrome for Testing <version>`.

| # | Fact | Evidence | Probe |
|---|---|---|---|
| F1 | An offscreen document has `chrome.runtime` only (`id`, `onMessage`, `onConnect`, `connect`, `sendMessage`, `getURL`). `chrome.storage`, `chrome.downloads`, `chrome.alarms` and `chrome.tabs` are undefined there and in its Worker (`chrome` itself is undefined in a Worker). | `Object.keys(chrome)` gave `["loadTimes","csi","runtime"]`; `typeof chrome.storage` was `"undefined"` | `p1.mjs` |
| F2 | `createDocument({ reasons: ['WORKERS'] })` and `['WORKERS','BLOBS']` are accepted (both are in `@types/chrome` 0.3.7, line 7908 on). A second `createDocument` fails with the text "Only a single offscreen document may be created." | probe output | `p1.mjs`, `p2.mjs` |
| F3 | A `WORKERS` document stayed alive for 48 s idle (its `performance.now()` advanced 48,031 ms; no close at 30 s). Stopping the service worker with CDP `ServiceWorker.stopAllWorkers` left it running, and a `chrome.runtime.sendMessage` from an extension page woke the stopped worker. | `up` deltas | `p9.mjs` |
| F4 | `chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })` lists the document (0 before, 1 after `createDocument`; Chrome 116+). `chrome.offscreen.hasDocument` exists in 149 but is typed "since Chrome 150", so it is not used. | probe output | `p9.mjs` |
| F5 | A classic and a module Worker can be created from the offscreen document. Inside it: `navigator.storage.getDirectory`, `createSyncAccessHandle`, `createWritable`, `navigator.locks` and IndexedDB all exist; a second sync handle on a file already open fails with `NoModificationAllowedError`; `truncate(2.5 GiB)` took 11 ms (sparse). | probe output | `p1.mjs`, `p13.mjs` |
| F6 | `navigator.storage.estimate()` in the document and in its Worker reported a quota of about 112 GB with 105 GB free on the disk (the probe manifest has `unlimitedStorage`, as Sieve's does): the quota follows free disk space. | `quota: 112227264257` | `p1.mjs` |
| F7 | IndexedDB and OPFS are one store for the service worker, the offscreen document, its Worker and extension pages (the worker read a value the document wrote and listed a file the Worker created). Both survived closing the browser and opening it again on the same profile. | `swReadsIdb`, `swOpfs`, restart block | `p1.mjs`, `p9.mjs` |
| F8 | The service worker has no `URL.createObjectURL`; the offscreen document has it. | `typeof` | `p1.mjs` |
| F9 | `chrome.downloads.download({ url: 'blob:chrome-extension://<id>/<uuid>', filename: 'SieveProbe/Video/big.bin' })` from the worker saved a 2,684,354,560-byte OPFS file (8 MiB real data, the rest sparse) in 1.7 s with `fileSize` and `totalBytes` equal to the file. The browser's resident memory read 882 MB before and during. `onCreated` for that save had no `byExtensionId`; a `search` afterwards did. | `p2.mjs`, `p4.mjs` output | `p2.mjs`, `p4.mjs` |
| F10 | Under Playwright, extension downloads land in a temp folder under a GUID name (`playwright-artifacts-*`), so `Downloads/<category>/` cannot be seen; `acceptDownloads: false` makes them `USER_CANCELED`; `downloadsPath` and `connectOverCDP` change nothing. A Chrome started by `child_process` with `--remote-debugging-port=0` and a seeded `<profile>/Default/Preferences` (`{"download":{"default_directory":"<dir>","prompt_for_download":false}}`), driven through raw CDP over Node's `WebSocket`, saved `<dir>/Sieve/Video/own.bin` for `filename: 'Sieve/Video/own.bin'`. That download took 2 to 6 s to reach `complete`. | `p6.mjs`, `p7.mjs`, `p8.mjs` | `p6.mjs`, `p7.mjs`, `p8.mjs` |
| F11 | For a page navigation that downloads: `onCreated` fires with `filename: ''`, `bytesReceived: 0`, `mime`, `totalBytes`, `referrer` (the page URL) and `url` equal to `finalUrl`. `chrome.downloads.pause(id)` inside the listener settled in 2.0 to 2.5 ms and `bytesReceived` was still 0 two seconds later, for a 300 MB file at 20 MB/s and a 1.5 GB file unthrottled. The paused item had `paused: true`, `canResume: true`, `state: 'in_progress'`; the filename arrived through `onChanged` right after; the server saw its connection stay open (26 MB sent into buffers in 1.5 s). `cancel(id)` took 2 to 4 ms (`interrupted`, `USER_CANCELED`, connection closed); `erase({ id })` removed the item from history; `resume(id)` finished a 60 MB download. After `pause`, `search({ id })` returns Chrome's own `filename` (under Playwright a GUID path with no extension; in real Chrome the name Chrome chose). `onDeterminingFilename` never fired under Playwright, with a listener registered (`p5.mjs det`, which loads `ext-det`) or not, so it is not used. | probe output | `p3.mjs`, `p5.mjs`, `p13.mjs` |
| F12 | `fetch(url, { credentials: 'include' })` from the worker, from the offscreen document and from its Worker sends every cookie Chrome's own navigation sent, including `SameSite=Lax` and `SameSite=Strict` ones, with only `<all_urls>` host permission (no `cookies` permission). | cookie header `sid=abc; strict=1; plain=2` | `p4.mjs`, `p10.mjs` |
| F13 | The `referrer` option of `fetch` from the extension origin sends no Referer at all. `chrome.downloads.download({ headers: [{ name: 'Referer' …}] })` and the same for `Cookie` fail with "Unsafe request header name". A `declarativeNetRequest` session rule (`modifyHeaders`, `set` the `referer` header, `condition.initiatorDomains: [<extension id>]`) does set the Referer on fetches from the worker, the offscreen document and the Worker. | probe output | `p4.mjs`, `p10.mjs` |
| F14 | Sieve's own blocking applies to the extension's own fetches: from the worker of the built extension, `fetch` to `pagead2.googlesyndication.com` and `googletagmanager.com` failed ("Failed to fetch"), while a page navigation to the same host loaded. A session rule `{ action: { type: 'allow' }, condition: { initiatorDomains: [<id>], resourceTypes: ['xmlhttprequest', 'other'] } }` at a priority above `meta.maxPriority` (1,000,301 in the current build) made both succeed. When an `allow` rule and a Referer rule both match, the Referer rule must have the higher priority: allow 2,000,000,000 with Referer 2,000,000,001 set the header; the reverse, and equal priorities, did not. | probe output | `p11.mjs`, `p12.mjs` |
| F15 | Alarms in an unpacked extension: a 0.05-minute alarm fired 3,009 ms later (8 ms late). `@types/chrome` says a packaged extension is limited to one firing per 30 s (line 463). With `--load-extension` each launch re-installs the extension (`onInstalled` reason `install` twice, no `onStartup`, no alarms left), so alarm persistence across a browser restart and `onStartup` cannot be checked in the harness. | `alarmSoon`, restart block | `p9.mjs` |
| F16 | A Worker in the offscreen document streamed 1 GB from a local server into an OPFS sync handle in 364 ms (2.7 GB/s) and the browser's resident memory grew 193 MB; `reader.cancel()` after 5 MB aborted cleanly. | `p10.mjs` output | `p10.mjs` |
| F17 | With a `Range` header Chrome sends `Accept-Encoding: identity`. A server that answers the ranged request with `Content-Encoding: gzip` anyway makes `fetch` throw `TypeError: Failed to fetch` (an unranged request gets the gzip body and `Content-Length` 1004 for a 1,000,000-byte file). So the probe never sees an encoded body: it fails as `probe-failed`. | `err: "TypeError: Failed to fetch"` for `bytes=0-` and `bytes=0-0` | `.superpowers/phase-3/scratch/review-A/gzip-range2.mjs` |

**Not found, and how the plan handles it:**
- *Alarm persistence over a real restart and `onStartup`* (F15): every worker start runs `reconcile()` (Task 3.11), which re-creates the alarms and re-creates the engine if work is pending, so correctness does not depend on either. The owner checklist (Task 3.20) restarts Chrome with a download running.
- *How long Chrome lets an idle service worker live:* Playwright keeps it busy, so nobody measured it. No design step depends on it: the worker holds no download state, and the engine document is independent of it (F3).
- *Chrome's download bubble and shelf during a take-over:* headless Chrome shows none. Owner checklist item.
- *A real-data multi-GB save:* F9 used a sparse file. Task 3.12 has a `--big` run with 3 GB of real bytes; its result goes in the handoff.
- *`onDeterminingFilename`:* not observable under Playwright (F11); the design needs it only to rename, which this phase does by saving through `chrome.downloads.download` with its own `filename`.

---

### Task 3.1: Download settings, record model and ports (core)

**Files:**
- Create: `packages/sieve-core/src/dl-settings.ts`, `packages/sieve-core/src/dl-record.ts`, `packages/sieve-core/src/dl-ports.ts`
- Create: `packages/sieve-core/src/__tests__/dl-settings.test.ts`, `packages/sieve-core/src/__tests__/dl-record.test.ts`

**Parallel:** wave A: starts at the same time as Tasks 3.2 to 3.6 (the long pole of the wave: three modules, about 80 assertions). **Wave A rule:** Tasks 3.1 to 3.10 are dispatched at the same time in the first run; 3.1 to 3.6 have no upstream. Tasks 3.7 to 3.10 code against this task's contract commit (Step 0), do their lock-free work first, and run their integration tests and commit only after this task's implementation commit has landed. Tasks 3.2 to 3.6 import from Task 3.1's files only with `import type` (erased at run time by Node's type stripping, so their `node --test` runs need no code from 3.1), and every interface 3.1 defines is written out exactly in this plan so the others code against the text. A test that needs a value 3.1 owns builds its own literal fixture. Tasks 3.7 to 3.10 build against its contract commit (Step 0): send `[CONTRACT]` with the sha as soon as it lands. Shared files: none (the controller adds the test files to `packages/sieve-core/package.json` in one batch after the wave).

**Interfaces:**
- Produces, in `dl-settings.ts`:
  ```ts
  export const DOWNLOADS_KEY = 'downloads';
  export const CATEGORY_IDS = ['video', 'music', 'programs', 'archives', 'documents', 'other'] as const;
  export type CategoryId = (typeof CATEGORY_IDS)[number];
  export interface CategorySetting { id: CategoryId; folder: string; extensions: string[] }
  export interface Schedule { on: boolean; days: number[]; start: string; stop: string | null }   // days 0 to 6 (Sunday 0); 'HH:MM', 24 hours, local time
  export interface QueueSetting { id: string; name: string; maxParallel: number; schedule: Schedule }
  export interface TakeOverSetting { on: boolean; minMb: number; extensions: string[]; mimeTypes: string[] }
  export interface DownloadSettings {
    version: 1;
    on: boolean;                                       // the Downloads switch
    takeOver: TakeOverSetting;
    parts: number;                                     // parts per file, 1 to 6
    speedLimit: { on: boolean; kbPerSecond: number };  // 1 KB = 1000 bytes
    categories: CategorySetting[];                     // always 6, in CATEGORY_IDS order
    queues: QueueSetting[];                            // 1 to 8; the first is the default queue
  }
  export const MAX_QUEUES = 8;
  export const DEFAULT_TAKEOVER_EXTENSIONS: readonly string[];
  export const DEFAULT_TAKEOVER_MIME_TYPES: readonly string[];
  export const DEFAULT_CATEGORIES: readonly CategorySetting[];
  export const DEFAULT_DOWNLOADS: DownloadSettings;
  export function validateDownloadSettings(input: unknown): DownloadSettings;   // never throws; idempotent
  ```
- The default file types are the union of the category lists below, in this order (56 extensions, no duplicates):
  - `video` folder "Video": `mp4 m4v mkv avi mov wmv flv webm mpg mpeg m2ts 3gp` (12)
  - `music` folder "Music": `mp3 m4a aac flac wav ogg oga opus wma aiff` (10)
  - `programs` folder "Programs": `dmg pkg exe msi apk ipa deb rpm appimage iso img` (11)
  - `archives` folder "Archives": `zip rar 7z tar gz tgz bz2 xz zst cab` (10)
  - `documents` folder "Documents": `pdf doc docx xls xlsx ppt pptx odt ods odp rtf epub mobi` (13)
  - `other` folder "Other": no extensions, the catch-all.
- `DEFAULT_TAKEOVER_MIME_TYPES`, in this order (31): `application/octet-stream`, `application/zip`, `application/x-zip-compressed`, `application/x-rar-compressed`, `application/vnd.rar`, `application/x-7z-compressed`, `application/gzip`, `application/x-gzip`, `application/x-tar`, `application/x-bzip2`, `application/x-xz`, `application/zstd`, `application/x-apple-diskimage`, `application/x-iso9660-image`, `application/x-msdownload`, `application/vnd.microsoft.portable-executable`, `application/x-msi`, `application/vnd.android.package-archive`, `application/vnd.debian.binary-package`, `application/x-rpm`, `application/x-newton-compatible-pkg`, `video/*`, `audio/*`, `application/pdf`, `application/msword`, `application/vnd.ms-excel`, `application/vnd.ms-powerpoint`, `application/vnd.openxmlformats-officedocument.*`, `application/vnd.oasis.opendocument.*`, `application/rtf`, `application/epub+zip`. A pattern ending in `*` matches by prefix (Task 3.5).
- `DEFAULT_DOWNLOADS`, exactly: `{ version: 1, on: true, takeOver: { on: true, minMb: 5, extensions: [...DEFAULT_TAKEOVER_EXTENSIONS], mimeTypes: [...DEFAULT_TAKEOVER_MIME_TYPES] }, parts: 1, speedLimit: { on: false, kbPerSecond: 1000 }, categories: <DEFAULT_CATEGORIES copied>, queues: [{ id: 'main', name: 'Main queue', maxParallel: 3, schedule: { on: false, days: [0, 1, 2, 3, 4, 5, 6], start: '01:00', stop: '07:00' } }] }`.
- Validation rules:

  | Path | Rule |
  |---|---|
  | `version` present and not `1`, or input not an object | the whole of `DEFAULT_DOWNLOADS` |
  | `on`, `takeOver.on`, `speedLimit.on`, `schedule.on` | a boolean, else the default (`true`, `true`, `false`, `false`) |
  | `takeOver.minMb` | a number rounded to an integer and clamped to 0 to 100000, else 5 |
  | `parts` | a number rounded and clamped to 1 to 6, else 1 |
  | `speedLimit.kbPerSecond` | a number rounded and clamped to 10 to 1,000,000, else 1000 |
  | extension lists (`takeOver.extensions`, a category's `extensions`) | an array of strings, each trimmed, lowercased, with leading dots removed, kept only if it matches `/^[a-z0-9]{1,10}$/`, deduplicated in order, at most 200 (take-over) or 100 (category); not an array: the default list |
  | `takeOver.mimeTypes` | an array of strings, each trimmed and lowercased, kept only if it matches `/^[a-z0-9][a-z0-9.+-]*\/([a-z0-9][a-z0-9.+-]*\*?\|\*)$/`, deduplicated, at most 100; not an array: the default list |
  | `categories` | for each id of `CATEGORY_IDS` the first input entry with that id (else the default entry); `folder` is trimmed, 1 to 40 characters, free of `< > : " / \ \| ? *` and control characters, not starting with a dot, else that id's default folder; `other` always has `extensions: []` |
  | `queues` | the first 8 array entries; not an array or empty: the default queue; `id` matches `/^[a-z0-9-]{1,24}$/` and is unique, else `q<position>` (position from 1, made unique by counting up); `name` trimmed, 1 to 40 characters, else `Queue <position>`; `maxParallel` a number rounded and clamped to 1 to 8, else 3; `schedule.days` the valid unique integers 0 to 6 sorted, none valid: all seven; `schedule.start` and `stop` match `/^([01]\d\|2[0-3]):[0-5]\d$/`, else `'00:00'` (start) and `null` (stop) |

- Produces, in `dl-record.ts`:
  ```ts
  export type DlState = 'queued' | 'running' | 'paused' | 'saving' | 'done' | 'failed';
  export type DlEvent = 'start' | 'pause' | 'resume' | 'stop' | 'partsDone' | 'fail' | 'saved' | 'saveFailed' | 'restart';
  export type DlSource = 'takeover' | 'manual' | 'menu';
  export interface PartRecord { start: number; end: number | null; done: number }   // bytes start..end inclusive; `done` bytes written from `start`; end null = unknown length
  export interface DlRecord {
    id: string;                    // newId()
    url: string;                   // what Chrome or the owner gave
    finalUrl: string;              // after redirects; equals url until the probe says otherwise
    referrer: string;              // '' or an absolute URL
    name: string;                  // sanitised file name with extension
    category: CategoryId;
    categoryFixed: boolean;        // true when the owner chose it; the probe then keeps it
    queue: string;                 // a QueueSetting id
    state: DlState;
    force: boolean;                // the owner pressed Resume: run now, whatever the window and the slot limit
    size: number | null;           // bytes; null until known
    rangeOk: boolean;              // the server answered 206 to a Range request
    validator: string | null;      // strong ETag or Last-Modified, sent back as If-Range
    mime: string;                  // lowercase, no parameters, '' unknown
    parts: PartRecord[];           // empty until planned
    partsWanted: number;           // DownloadSettings.parts when the record was added
    addedAt: number; startedAt: number | null; finishedAt: number | null;   // epoch ms
    error: string | null;          // a sentence from ERRORS when state is 'failed'
    saveOnly: boolean;             // every byte is in the private copy; only the save to Downloads is left
    savedPath: string | null;      // absolute path Chrome saved to
    savedId: number | null;        // Chrome's download id of the save
    chromeId: number | null;       // Chrome's own download that Sieve took over (history only)
    source: DlSource;
  }
  export interface NewRecord { url: string; referrer: string; name: string; category: CategoryId; categoryFixed: boolean; queue: string; source: DlSource; partsWanted: number; finalUrl?: string; size?: number | null; mime?: string; validator?: string | null; rangeOk?: boolean; chromeId?: number | null }
  export type DoOp = 'pause' | 'resume' | 'remove';
  export interface AddItem {                                  // what a page, a menu or the take-over asks the engine to add
    url: string; referrer?: string; name?: string; category?: CategoryId; queue?: string; source: DlSource; chromeId?: number;
    probed?: { finalUrl: string; size: number; mime: string; validator: string | null; name: string };   // set by the take-over: the probe already ran
  }
  export type SaveEvent =
    | { id: string; kind: 'path'; filename: string; chromeId: number }
    | { id: string; kind: 'done'; filename: string; chromeId: number }
    | { id: string; kind: 'failed'; error: string };
  export function newId(now: number, random: () => number): string;           // 'd' + now in base 36 + 8 base-36 digits of random() (4 digits collide about 1 time in 4 when 1000 ids are made in one millisecond)
  export function newRecord(init: NewRecord, now: number, id: string): DlRecord;
  export function nextState(state: DlState, event: DlEvent): DlState | null;   // null = illegal
  export function applyEvent(r: DlRecord, event: DlEvent, now: number, payload?: { error?: string }): DlRecord;   // illegal: returns r itself
  export const partName = (id: string): string => `${id}.part`;               // the OPFS file of a record
  export function bytesDone(r: DlRecord): number;                              // sum of parts' done
  export function isComplete(r: DlRecord): boolean;                            // size 0, or size known, parts planned and every part's done equals its length
  export const ERRORS: {
    network: string; refused: string; changed: string; length: string; space: string; storage: string; saveCanceled: string; unknown: string; probe: string;
    status(code: number): string; save(code: string): string;
  };
  ```
- `ERRORS`, exact (these are stored in records, so they are the one set of visible strings outside `dl-text.ts`):
  - `network`: "The connection dropped and Sieve couldn't reconnect. Check your network, then press Resume."
  - `refused`: "The server keeps refusing requests. Wait a few minutes, then press Resume."
  - `changed`: "The file changed on the server while Sieve was downloading it. Press Retry in Chrome to download it again."
  - `status(code)`: `The server answered ${code}. The link may have expired. Press Retry in Chrome, or open the page the link came from.`
  - `length`: "The server sent a different amount of data than it announced. Press Resume to try again."
  - `space`: "There isn't enough space on this computer for this file. Free some space, then press Resume."
  - `storage`: "Sieve couldn't write the file to its private storage. Free some space, then press Resume."
  - `save(code)`: maps the code Chrome or the engine gave to a fixed sentence and never repeats raw text: `'FILE_NO_SPACE'` gives the `space` sentence, `'USER_CANCELED'` gives the `saveCanceled` sentence, every other code gives "Chrome couldn't save the finished file. Press Resume to save it again."
  - `saveCanceled`: "The save was canceled in Chrome. Press Resume to save the file again."
  - `unknown`: "The download stopped for an unknown reason. Press Resume to try again."
  - `probe`: "Sieve couldn't read this link. Press Retry in Chrome to let Chrome download it."
- The state machine. Legal transitions (everything else is illegal; 13 of the 54 pairs):

  | State | Event | Next |
  |---|---|---|
  | `queued` | `start` | `running` |
  | `queued` | `pause` | `paused` |
  | `queued` | `fail` | `failed` |
  | `running` | `pause` | `paused` |
  | `running` | `stop` | `queued` |
  | `running` | `partsDone` | `saving` |
  | `running` | `fail` | `failed` |
  | `running` | `restart` | `queued` |
  | `paused` | `resume` | `queued` |
  | `saving` | `saved` | `done` |
  | `saving` | `saveFailed` | `failed` |
  | `saving` | `restart` | `saving` |
  | `failed` | `resume` | `queued` |

  `applyEvent` changes more than the state:
  - `start`: `startedAt` kept or set to `now`; `error` null.
  - `pause`: `force` false.
  - `resume`: `force` true, `error` null; the next state is `saving` (and `saveOnly` true) when `r.saveOnly || isComplete(r)`, else `queued`.
  - `stop`: `force` false.
  - `partsDone`: `saveOnly` true, `error` null.
  - `fail`: `error` is `payload.error ?? ERRORS.unknown`, `force` false.
  - `saved`: `finishedAt` is `now`, `saveOnly` false, `force` false, `error` null.
  - `saveFailed`: `error` is `payload.error ?? ERRORS.unknown`, `saveOnly` true, `force` false.
  - `restart`: only `running` becomes `queued` (`force` kept, so a forced download restarts at once); `saving` stays as it is.
- Produces, in `dl-ports.ts` (types only, no runtime code), the ports every engine task uses:
  ```ts
  import type { DlRecord } from './dl-record.ts';
  import type { DownloadSettings } from './dl-settings.ts';
  export interface Store {                                   // IndexedDB `sieve-dl`
    all(): Promise<DlRecord[]>;
    put(record: DlRecord, options?: { strict?: boolean }): Promise<void>;   // resolves when the transaction is durable; strict opens it with { durability: 'strict' } (the engine uses it for every put of a take-over record)
    delete(id: string): Promise<void>;
    getMeta<T>(key: string): Promise<T | undefined>;
    setMeta(key: string, value: unknown): Promise<void>;
  }
  export interface FileHandle {
    write(chunk: Uint8Array, at: number): void;              // throws on failure (disk full)
    flush(): void;
    size(): number;
    close(): void;
  }
  export interface Files {                                   // OPFS root
    open(name: string, length: number | null): Promise<FileHandle>;   // creates the file if missing; a length sets its size to exactly that many bytes (grow or shrink), null keeps it
    exists(name: string): Promise<boolean>;
    remove(name: string): Promise<void>;                     // missing file: no error
    list(): Promise<string[]>;
    space(): Promise<{ quota: number; usage: number }>;
  }
  export interface NetResponse { status: number; url: string; headers: { get(name: string): string | null }; body: ReadableStream<Uint8Array> | null }
  export interface Net {
    fetch(url: string, init: { range?: string; ifRange?: string; signal?: AbortSignal }): Promise<NetResponse>;   // rejects on a network failure (TypeError) or an abort (AbortError); follows redirects; sends cookies
  }
  export interface Clock {
    now(): number;
    sleep(ms: number, signal?: AbortSignal): Promise<void>;  // rejects with an AbortError when the signal aborts
    every(ms: number, fn: () => void): () => void;           // returns the cancel function
  }
  export interface TransferHooks {
    persist(record: DlRecord): Promise<void>;                // a checkpoint: the bytes are flushed, store the record
    update(record: DlRecord): void;                          // in-memory progress, for the list
    bytes(n: number): void;                                  // bytes received, for the speed meter
  }
  export type TransferResult =
    | { kind: 'done'; record: DlRecord }                     // every byte is in the file, handle closed
    | { kind: 'paused'; record: DlRecord }                   // the signal aborted
    | { kind: 'failed'; record: DlRecord; error: string };   // record.error equals error
  export interface Transfer {
    run(record: DlRecord, signal: AbortSignal, hooks: TransferHooks): Promise<TransferResult>;
    config(settings: DownloadSettings): void;
  }
  ```

- [ ] **Step 0: Contract commit (first, before any implementation).** By pathspec, message `Sieve Phase 3 3.1: contract`. Files: `packages/sieve-core/src/dl-settings.ts`, `dl-record.ts`, `dl-ports.ts`, `__tests__/dl-settings.test.ts`, `__tests__/dl-record.test.ts`. Types, interfaces and message shapes are written exactly as in this task's Interfaces; plain data (constants, lists, message-type names) is real; every function body is `throw new Error('not implemented')`; each test file holds one `test.todo('<name>')` per case listed in this task's test steps. Real from the start (they are data or one-line templates): `DOWNLOADS_KEY`, `CATEGORY_IDS`, `MAX_QUEUES`, the default extension, MIME and category lists, `DEFAULT_DOWNLOADS`, `ERRORS` (including `status` and `save`), `partName`. Stubs: `validateDownloadSettings`, `newId`, `newRecord`, `nextState`, `applyEvent`, `bytesDone`, `isComplete`. `dl-ports.ts` is types only. Send `[CONTRACT] 3.1: <sha, files, exported names>` to the controller as soon as it lands; do not list the test files in `package.json` (the controller does). Then continue with Step 1.
- [ ] **Step 1: Write the failing `dl-settings.test.ts`.**
  - `validateDownloadSettings(undefined)`, `('x')` and `({ version: 2 })` deep-equal `DEFAULT_DOWNLOADS`, and `DEFAULT_DOWNLOADS` deep-equals the literal above (spell it out in the test, with the two lists written as literals).
  - The default extension list has 56 entries and no duplicates; every default category's extensions are inside it; `other` has none; there are 31 default MIME types.
  - Numbers: `takeOver.minMb` 7.6 gives 8, -1 gives 0, 1e9 gives 100000, `'x'` gives 5. `parts` 0 gives 1, 9 gives 6, 2.6 gives 3, `'3'` gives 1. `speedLimit.kbPerSecond` 5 gives 10, 2e6 gives 1,000,000, `NaN` gives 1000.
  - Extensions: `['.MP4 ', 'mp4', 'a b', 'x'.repeat(11), 'ok']` gives `['mp4', 'ok']`; a non-array gives the default list; 201 valid distinct extensions keep the first 200.
  - MIME types: `['Video/*', 'bad', 'application/zip', 'application/zip', 'application/vnd.oasis.opendocument.*']` gives `['video/*', 'application/zip', 'application/vnd.oasis.opendocument.*']`.
  - Categories: input `[{ id: 'video', folder: 'Movies', extensions: ['mkv'] }]` gives six entries in `CATEGORY_IDS` order, video as given, the rest default. Folder `'a/b'`, `'..'`, `''`, `'x'.repeat(41)` and `'.hidden'` each give that id's default folder; `'  Clips '` gives `'Clips'`. `other` with `extensions: ['zip']` gives `[]`. Two entries with id `music`: the first wins.
  - Queues: `[]` and `'x'` give the default queue. One entry `{ id: 'A b', name: '', maxParallel: 99, schedule: { on: 'yes', days: [7, 1, 1, -1], start: '25:00', stop: '7:5' } }` gives `{ id: 'q1', name: 'Queue 1', maxParallel: 8, schedule: { on: false, days: [1], start: '00:00', stop: null } }`. Days `[9]` give all seven. Nine queues keep eight. Two entries with id `night`: the second becomes `q2`. A valid `{ id: 'night', name: 'Night', maxParallel: 2, schedule: { on: true, days: [5, 6], start: '22:30', stop: '06:00' } }` is kept as is.
  - Idempotence: `validate(validate(x))` deep-equals `validate(x)` for the inputs above.
- [ ] **Step 2: Write the failing `dl-record.test.ts`.**
  - `newId(1_700_000_000_000, () => 0.5)` matches `/^d[a-z0-9]{16,}$/`; 1000 ids made with `Math.random` and a fixed `now` are distinct (run the check 20 times in the test to catch a short random part).
  - `newRecord` fills every default (`state` queued, `force` false, `size` null, `rangeOk` false, `validator` null, `mime` '', `parts` [], `startedAt`, `finishedAt`, `error`, `savedPath`, `savedId`, `chromeId` null unless given, `saveOnly` false, `finalUrl` equal to `url` unless given).
  - `nextState` is `null` for every one of the 41 illegal pairs and as the table says for the 13 legal ones (table-driven over all 54); `queued` with `fail` is legal (the engine fails a record that cannot start, Task 3.8).
  - `applyEvent`: each bullet above, on a record built with `newRecord`. An illegal event returns the same object (`===`). `resume` on a failed record with `saveOnly: true` gives `saving`; on a failed record whose parts are all done (and `saveOnly` false) also `saving` with `saveOnly` true; on a failed record with unfinished parts gives `queued` with `force` true. `restart` on `running` with `force: true` keeps `force`. `fail` without a payload uses `ERRORS.unknown`; `fail` on a `queued` record gives `failed` with the error and `force` false.
  - `bytesDone` and `isComplete`: no parts gives 0 and false; `size: 0` gives true; parts `[{ start: 0, end: 99, done: 100 }]` with size 100 is complete; `done: 99` is not; `size: null` is not complete even if parts look done.
  - `partName('dabc')` is `'dabc.part'`.
  - Every sentence in `ERRORS` (and `ERRORS.status(404)`, `ERRORS.save('x')`) contains none of "faster", "accelerat", "boost", "turbo", "speed up" (case-insensitive), no emoji, no word of four or more capital letters in a row, and starts with an uppercase letter (the `dl-text` test cannot import `ERRORS` in wave A, so the check lives here).
  - `ERRORS.status(404)` contains "404"; `ERRORS.save('FILE_NO_SPACE')` equals `ERRORS.space`; `ERRORS.save('USER_CANCELED')` equals `ERRORS.saveCanceled`; `ERRORS.save('boom')` is "Chrome couldn't save the finished file. Press Resume to save it again." and does not contain "boom".
- [ ] **Step 3: Run the tests.** Run `node --test packages/sieve-core/src/__tests__/dl-settings.test.ts packages/sieve-core/src/__tests__/dl-record.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement the three modules.**
- [ ] **Step 5: Run the tests and the typecheck.** Run the same `node --test` line and a throwaway typecheck of only this task's files (`tsc --noEmit -p <a tsconfig in the scratchpad that extends `packages/sieve-core/tsconfig.json` and lists only this task's source and test files>`; the package-wide typecheck sees other agents' half-written files, so the controller runs it after each wave; when Task 3.1's files already exist, include them in that tsconfig, and when they do not yet exist the `import type` lines cannot resolve (TS2307), so record the typecheck as deferred to the controller's post-wave package typecheck and commit anyway). Expected: PASS.
- [ ] **Step 6: Commit** by pathspec with the message `Sieve core: download settings, record model and ports`. Report the two test file names for the test-list batch.

### Task 3.2: Segment planner, re-splitting and host limits (core)

**Files:**
- Create: `packages/sieve-core/src/dl-plan.ts`, `packages/sieve-core/src/__tests__/dl-plan.test.ts`

**Parallel:** wave A, starts with Tasks 3.1 and 3.3 to 3.6 (imports `PartRecord` as a type only; the test builds its own part literals). **Wave A rule:** Tasks 3.1 to 3.10 are dispatched at the same time in the first run; 3.1 to 3.6 have no upstream. Tasks 3.7 to 3.10 code against this task's contract commit (Step 0), do their lock-free work first, and run their integration tests and commit only after this task's implementation commit has landed. Tasks 3.2 to 3.6 import from Task 3.1's files only with `import type` (erased at run time by Node's type stripping, so their `node --test` runs need no code from 3.1), and every interface 3.1 defines is written out exactly in this plan so the others code against the text. A test that needs a value 3.1 owns builds its own literal fixture. Shared files: none (test-list batch only).

**Interfaces:**
- Produces:
  ```ts
  import type { PartRecord } from './dl-record.ts';
  export const MIN_PART_BYTES = 1_048_576;      // never plan a part smaller than 1 MiB
  export const MIN_RESPLIT_BYTES = 1_048_576;   // each half of a re-split keeps at least 1 MiB
  export const HOST_CAP_TTL_MS = 1_800_000;     // a host that refused remembers it for 30 minutes
  export const MAX_ATTEMPTS = 5;                // consecutive 429 or 503 answers to one part before the download fails (other failures use GIVE_UP_MS)
  export const GIVE_UP_MS = 900_000;            // a part that receives no byte for 15 minutes of failures and back-offs fails the download
  export const STALL_MS = 30_000;               // a connection that delivers no byte for 30 s is aborted and retried from its saved offset (time slept for the speed limit does not count)
  export const HOST_MAX = 6;                    // connections Sieve opens to one host in total, across all downloads (Chrome's own HTTP/1.1 limit)
  export function planParts(size: number, parts: number, minPart?: number): PartRecord[];
  export function partLength(p: PartRecord): number;            // end - start + 1; Infinity when end is null
  export function remaining(p: PartRecord): number;             // partLength - done
  export function isPartComplete(p: PartRecord): boolean;       // end !== null and done >= length
  export function nextToStart(parts: PartRecord[], active: readonly number[]): number | null;   // lowest index that is not complete and not active
  export function resplit(parts: PartRecord[], active: readonly number[], minHalf?: number): { parts: PartRecord[]; added: number } | null;
  export type HostCaps = Record<string, { cap: number; until: number }>;
  export function hostOf(url: string): string;                  // lowercase hostname without port; '' when the URL does not parse
  export function capFor(caps: HostCaps, host: string, wanted: number, now: number): number;
  export function onRefused(caps: HostCaps, host: string, activeConnections: number, now: number): HostCaps;
  export function backoffMs(attempt: number, retryAfterMs?: number | null): number;
  export function parseRetryAfter(value: string | null, now: number): number | null;
  ```
- **`planParts(size, parts, minPart = MIN_PART_BYTES)`.** `size` not finite or at most 0: `[]`. `parts` not a finite number or below 1: 1. `n = max(1, min(floor(parts), floor(size / minPart)))`. `base = floor(size / n)`, `extra = size - base * n`; the first `extra` parts get `base + 1` bytes, the rest `base`. Parts are contiguous, in offset order, `done` 0.
  - `planParts(10_485_760, 3)` gives `[0, 3495253]`, `[3495254, 6990506]`, `[6990507, 10485759]`.
  - `planParts(10, 3, 1)` gives `[0, 3]`, `[4, 6]`, `[7, 9]`.
  - `planParts(5_242_880, 6)` gives five parts of 1,048,576 bytes (`n = min(6, 5)`).
  - `planParts(1_500_000, 4)` gives `[0, 1499999]` (`floor(1_500_000 / 1_048_576)` is 1).
  - `planParts(1, 3, 1)` gives `[0, 0]`; `planParts(0, 3)` gives `[]`.
- **`resplit(parts, active, minHalf = MIN_RESPLIT_BYTES)`.** Chooses, among the parts whose index is in `active` and whose `end` is not null, the one with the largest `remaining` (a tie goes to the lowest index). If that remaining is below `2 * minHalf`, returns `null`. Otherwise `keep = ceil(remaining / 2)`, `newStart = start + done + keep`; the chosen part's `end` becomes `newStart - 1`; a new part `{ start: newStart, end: oldEnd, done: 0 }` is appended at index `parts.length`; the result is `{ parts: <new array>, added: parts.length }`. The input is not mutated.
  - Worked example: `parts = [{ start: 0, end: 9_999_999, done: 1_000_000 }, { start: 10_000_000, end: 19_999_999, done: 10_000_000 }]`, `active = [0]`. Remaining of part 0 is 9,000,000, so `keep` is 4,500,000 and `newStart` is 5,500,000. Result: part 0 `{ 0, 5_499_999, 1_000_000 }`, a new part `{ 5_500_000, 9_999_999, 0 }` (4,500,000 bytes) at index 2, `added: 2`.
  - Boundary: remaining 2,097,152 splits into two halves of 1,048,576; 2,097,151 returns `null`; 2,097,153 gives `keep` 1,048,577 and a new part of 1,048,576.
- **The rule for 429 and 503** (the owner asked for it exactly). The engine calls `onRefused` when a ranged request answers 429 or 503, with `activeConnections` the number of connections Sieve has open to that host at that moment across all downloads (the refused one included). The connection budget is per host, not per download: a new connection (a part start, a re-split or a new download's first request) opens only while the host's open connections are below `capFor(caps, host, HOST_MAX, now)`, so `maxParallel` 3 with 6 parts never opens 18 connections to one host (Task 3.9 keeps a shared `HostUse` counter; a waiting start polls every 250 ms).
  - New cap: `max(1, floor(activeConnections / 2))`, and never above an existing unexpired cap for that host. `until` is `now + HOST_CAP_TTL_MS`, refreshed by every refusal.
  - `onRefused` returns a new object; `capFor(caps, host, wanted, now)` is `min(wanted, cap)` while `until > now`, else `wanted`.
  - Examples: 6 active gives cap 3; then 3 active gives cap 1; 1 active gives 1; 2 gives 1; 5 gives 2. A cap 2 set at `now` 0 is still in force at `HOST_CAP_TTL_MS - 1` and gone at `HOST_CAP_TTL_MS`.
  - New parts and re-splits start only while the host's open connections are below the host budget above and the download's own connections are below its `partsWanted`; connections already running finish. A cap of 3 set by a refusal therefore limits all downloads from that host to 3 connections in total for 30 minutes. A refused part waits `backoffMs` and tries again from its saved offset.
- **`backoffMs(attempt, retryAfterMs)`**, `attempt` counting from 1: `base = min(2000 * 2 ** (attempt - 1), 30000)`; the result is `min(60000, max(base, retryAfterMs ?? 0))`. Attempts 1 to 6 give 2000, 4000, 8000, 16000, 30000, 30000. `backoffMs(1, 5000)` is 5000; `backoffMs(1, 120000)` is 60000. Two counters per part are kept by the transfer (Task 3.9): `refusals`, the consecutive 429 or 503 answers (reset by a received byte or by any other outcome), and `attempt`, the consecutive failures of any kind (reset by a received byte). `MAX_ATTEMPTS` (5) applies only to `refusals`: a part that gets five such answers in a row with no byte received in between fails the download with `ERRORS.refused`, and the sleeps before that are 2000, 4000, 8000 and 16000 ms (no sleep follows the fifth). Every other failure (a thrown fetch, a stream that ends short, a 5xx other than 503, a stall) sleeps `backoffMs(attempt)` (so at most 30000 ms) and retries from the saved offset until `GIVE_UP_MS` (15 minutes) pass with no byte received, then fails with `ERRORS.network`; any received byte resets both counters. A ~30 s network outage therefore never fails a download.
- **`parseRetryAfter(value, now)`**: `null` and unparsable values give `null`; a non-negative integer of seconds gives `seconds * 1000`; an HTTP date gives `max(0, date - now)`; a negative integer gives `null`.

- [ ] **Step 0: Contract commit (first, before any implementation).** By pathspec, message `Sieve Phase 3 3.2: contract`. Files: `packages/sieve-core/src/dl-plan.ts`, `__tests__/dl-plan.test.ts`. Types, interfaces and message shapes are written exactly as in this task's Interfaces; plain data (constants, lists, message-type names) is real; every function body is `throw new Error('not implemented')`; each test file holds one `test.todo('<name>')` per case listed in this task's test steps. Constants (`MIN_PART_BYTES`, `MIN_RESPLIT_BYTES`, `HOST_CAP_TTL_MS`, `MAX_ATTEMPTS`, `GIVE_UP_MS`, `STALL_MS`, `HOST_MAX`) and the `HostCaps` type are real. Send `[CONTRACT] 3.2: <sha, files, exported names>` to the controller as soon as it lands; do not list the test files in `package.json` (the controller does). Then continue with Step 1.
- [ ] **Step 1: Write the failing `dl-plan.test.ts`.**
  - `planParts`: every example above; plus a property check over `size` in `[1, 5, 1_048_576, 7_654_321, 123_456_789]` and `parts` 1 to 6: the parts are contiguous, the first starts at 0, the last ends at `size - 1`, their lengths sum to `size`, lengths differ by at most 1, and `parts.length` is at most `parts`.
  - `planParts(10, NaN, 1)` and `planParts(10, 0, 1)` give one part `[0, 9]`; `planParts(10, Infinity, 1)` gives one part too (not a finite number).
  - `partLength({ start: 4, end: 9, done: 0 })` is 6 and `partLength({ start: 0, end: null, done: 0 })` is `Infinity`; `remaining` subtracts `done` (`{ start: 4, end: 9, done: 2 }` gives 4; an unknown end gives `Infinity`); `isPartComplete` is true for `done` equal to the length and for `done` above it, false for `done` below it and always false when `end` is `null`.
  - `resplit`: the worked example, the three boundary cases, the tie case (two active parts with equal remaining: the lower index splits), a case where the larger remaining belongs to a part not in `active` (ignored), a part with `end: null` (ignored; all ignored gives `null`), and the input array is unchanged after a call. After a split the two halves cover exactly the old part's remaining bytes.
  - `nextToStart`: `parts` of lengths with part 0 complete, part 1 active, part 2 open gives 2; all complete or active gives `null`; none active gives the first incomplete.
  - Constants: `HOST_MAX` is 6, `MAX_ATTEMPTS` 5, `GIVE_UP_MS` 900,000, `STALL_MS` 30,000.
  - Host caps: every example above; `onRefused` does not mutate its input; `onRefused` with an existing unexpired cap 2 and 6 active gives 2 (never raised); with an expired cap 2 and 6 active gives 3.
  - `hostOf('https://CDN.Example.com:8443/a')` is `'cdn.example.com'`; `hostOf('nonsense')` is `''`.
  - `backoffMs`: the six attempts, both retry-after cases, and `attempt` 0 or negative treated as 1.
  - `parseRetryAfter`: `('7', 0)` is 7000; `('Wed, 21 Oct 2026 07:28:00 GMT', Date.parse('Wed, 21 Oct 2026 07:27:50 GMT'))` is 10000; a date in the past is 0; `'-3'`, `'abc'`, `''` and `null` are `null`.
- [ ] **Step 2: Run, implement, and run again.** Run `node --test packages/sieve-core/src/__tests__/dl-plan.test.ts`. Expected: FAIL, then PASS. Then run a throwaway typecheck of only this task's files (`tsc --noEmit -p <a tsconfig in the scratchpad that extends `packages/sieve-core/tsconfig.json` and lists only this task's source and test files>`; the package-wide typecheck sees other agents' half-written files, so the controller runs it after each wave; when Task 3.1's files already exist, include them in that tsconfig, and when they do not yet exist the `import type` lines cannot resolve (TS2307), so record the typecheck as deferred to the controller's post-wave package typecheck and commit anyway).
- [ ] **Step 3: Commit** by pathspec with the message `Sieve core: segment planner, re-splitting and host limits`. Report the test file name.

### Task 3.3: Token bucket and speed meter (core)

**Files:**
- Create: `packages/sieve-core/src/dl-bucket.ts`, `packages/sieve-core/src/__tests__/dl-bucket.test.ts`

**Parallel:** wave A, starts with Tasks 3.1, 3.2 and 3.4 to 3.6 (no imports). Shared files: none.

**Interfaces:**
- Produces:
  ```ts
  export const MIN_GRANT = 1024;                    // bytes; the smallest slice worth waiting for
  export interface Bucket { rate: number; burst: number; tokens: number; at: number }   // rate in bytes per second; Infinity = no limit
  export function makeBucket(rate: number, now: number): Bucket;
  export function setRate(b: Bucket, rate: number, now: number): void;
  export function take(b: Bucket, want: number, now: number): { grant: number; waitMs: number };
  export interface Meter { windowMs: number; startedAt: number; samples: { t: number; n: number }[] }
  export function makeMeter(now: number, windowMs?: number): Meter;      // windowMs defaults to 5000
  export function addBytes(m: Meter, n: number, now: number): void;
  export function rate(m: Meter, now: number): number;                    // bytes per second
  ```
- **Bucket rules.** A `rate` that is not finite and greater than 0 (including `NaN`, 0 and negatives) means no limit (`Infinity`); the functions never throw.
  - `burst = max(65_536, floor(rate / 4))` (a quarter second of traffic, at least 64 KiB); `Infinity` rate has `burst` `Infinity`. New buckets start full: `tokens = burst`, `at = now`.
  - Refill, done first by `take` and `setRate`: with an `Infinity` rate, `tokens = Infinity` and `at = now` with no arithmetic (`Infinity * 0` is `NaN` when `now` equals `at`, and a later `setRate` to a finite value would then break the bucket for good); otherwise `tokens = min(burst, tokens + rate * (now - at) / 1000)`, `at = now` (a `now` earlier than `at` adds nothing).
  - `take(b, want, now)`: refill. With no limit, `{ grant: want, waitMs: 0 }`. Otherwise `need = min(want, MIN_GRANT)`. If `tokens < need`: `{ grant: 0, waitMs: ceil((need - tokens) / rate * 1000) }`. Else `grant = min(want, floor(tokens))`, `tokens -= grant`, `{ grant, waitMs: 0 }`. `want` at most 0 gives `{ grant: 0, waitMs: 0 }`.
  - `setRate(b, rate, now)`: refill at the old rate, then set the new `rate` and `burst`, then `tokens = min(tokens, burst)`.
  - The caller drains a chunk it has already read: `remaining = n; while (remaining > 0) { const g = take(b, remaining, now()); remaining -= g.grant; if (g.waitMs > 0) await sleep(g.waitMs); }`. All downloads share one bucket, so the limit applies to their sum.
  - Worked example, `rate` 100,000: `makeBucket(100_000, 0)` has `burst` 65,536 and `tokens` 65,536. `take(b, 100_000, 0)` gives `{ grant: 65_536, waitMs: 0 }`. `take(b, 100_000, 0)` again gives `{ grant: 0, waitMs: 11 }` (`ceil(1024 / 100000 * 1000)` is 11). `take(b, 100_000, 100)` refills 10,000 and gives `{ grant: 10_000, waitMs: 0 }`. `take(b, 500, 100)` then gives `{ grant: 0, waitMs: 5 }` (`need` is 500). After 10 s idle the bucket holds 65,536 again, not more.
- **Meter rules.** `addBytes` appends `{ t: now, n }` and drops samples with `t < now - windowMs`. `rate(m, now)`: drop the same old samples; no samples gives 0; `span = min(windowMs, max(1000, now - startedAt))`; the result is `sum(n) / (span / 1000)`.
  - Worked example: `makeMeter(0)`; `addBytes(m, 1_000_000, 500)`; `addBytes(m, 1_000_000, 1500)`; `rate(m, 2000)` is 1,000,000 (span 2000, total 2,000,000); `rate(m, 7000)` is 0 (both samples are older than 5000 ms).

- [ ] **Step 0: Contract commit (first, before any implementation).** By pathspec, message `Sieve Phase 3 3.3: contract`. Files: `packages/sieve-core/src/dl-bucket.ts`, `__tests__/dl-bucket.test.ts`. Types, interfaces and message shapes are written exactly as in this task's Interfaces; plain data (constants, lists, message-type names) is real; every function body is `throw new Error('not implemented')`; each test file holds one `test.todo('<name>')` per case listed in this task's test steps. `MIN_GRANT` and the `Bucket` and `Meter` types are real. Send `[CONTRACT] 3.3: <sha, files, exported names>` to the controller as soon as it lands; do not list the test files in `package.json` (the controller does). Then continue with Step 1.
- [ ] **Step 1: Write the failing `dl-bucket.test.ts`.**
  - The bucket worked example, step by step, with the exact numbers above.
  - `makeBucket(1_000_000, 0).burst` is 250,000; `makeBucket(10_000, 0).burst` is 65,536; `makeBucket(Infinity, 0)`, `makeBucket(0, 0)`, `makeBucket(-5, 0)` and `makeBucket(NaN, 0)` all behave as no limit: `take(b, 12345, 7)` is `{ grant: 12345, waitMs: 0 }`.
  - `setRate` from 100,000 to 50,000 at `now` 200 on a bucket drained at 0: tokens first refill to 20,000 at the old rate, then the new burst is 65,536 and tokens stay 20,000; `setRate(b, Infinity, now)` turns the limit off; `makeBucket(Infinity, 5)` then `setRate(b, 1_000_000, 5)` (the same `now`) gives `tokens` 250,000 (the new burst) and `take(b, 100_000, 5)` grants 100,000, with no `NaN` anywhere; `setRate` from a high rate to a low one caps `tokens` at the new burst.
  - A simulated drain: rate 100,000, a clock starting at 0, a loop that drains 1,000,000 bytes in chunks of 50,000 with the caller loop above (the fake `sleep` advances the clock): the clock ends between 9.3 s and 9.7 s (the burst gives the first 65,536 bytes free: `(1_000_000 - 65_536) / 100_000` is 9.34 s).
  - Two consumers sharing one bucket, each draining 500,000 bytes interleaved: the total time matches one consumer draining 1,000,000.
  - Meter: the worked example; `rate` right after creation with no samples is 0; `rate(m, 400)` after `addBytes(m, 800_000, 100)` is 800,000 (span is clamped to 1000); a custom `windowMs` of 2000 drops older samples; time going backwards does not throw.
- [ ] **Step 2: Run, implement, and run again.** Run `node --test packages/sieve-core/src/__tests__/dl-bucket.test.ts`, then a throwaway typecheck of only this task's files (`tsc --noEmit -p <a tsconfig in the scratchpad that extends `packages/sieve-core/tsconfig.json` and lists only this task's source and test files>`; the package-wide typecheck sees other agents' half-written files, so the controller runs it after each wave; when Task 3.1's files already exist, include them in that tsconfig, and when they do not yet exist the `import type` lines cannot resolve (TS2307), so record the typecheck as deferred to the controller's post-wave package typecheck and commit anyway). Expected: FAIL, then PASS.
- [ ] **Step 3: Commit** by pathspec with the message `Sieve core: token bucket and speed meter`. Report the test file name.

### Task 3.4: Queues and scheduler windows (core)

**Files:**
- Create: `packages/sieve-core/src/dl-queue.ts`, `packages/sieve-core/src/__tests__/dl-queue.test.ts`

**Parallel:** wave A, starts with Tasks 3.1 to 3.3, 3.5 and 3.6 (type imports only; the test builds its records with a local helper `rec(id, queue, state, addedAt, force)` that returns the plain object, not with `newRecord`, and its queues as literals). **Wave A rule:** Tasks 3.1 to 3.10 are dispatched at the same time in the first run; 3.1 to 3.6 have no upstream. Tasks 3.7 to 3.10 code against this task's contract commit (Step 0), do their lock-free work first, and run their integration tests and commit only after this task's implementation commit has landed. Tasks 3.2 to 3.6 import from Task 3.1's files only with `import type` (erased at run time by Node's type stripping, so their `node --test` runs need no code from 3.1), and every interface 3.1 defines is written out exactly in this plan so the others code against the text. A test that needs a value 3.1 owns builds its own literal fixture. Shared files: none.

**Interfaces:**
- Produces:
  ```ts
  import type { DlRecord } from './dl-record.ts';
  import type { QueueSetting, Schedule } from './dl-settings.ts';
  export function minutesOf(hhmm: string): number;                    // '22:30' is 1350
  export function isOpen(s: Schedule, at: Date): boolean;
  export function nextChange(s: Schedule, at: Date): number | null;  // epoch ms of the next flip between open and closed; null when the schedule is off or never flips
  export function nextWake(queues: readonly QueueSetting[], at: Date): number | null;   // the earliest nextChange over queues whose schedule is on
  export function queueOf(queues: readonly QueueSetting[], id: string): QueueSetting;   // the queue with that id, else the first
  export interface Plan { start: string[]; stop: string[] }           // record ids
  export function schedulePlan(records: readonly DlRecord[], queues: readonly QueueSetting[], at: Date, on: boolean): Plan;
  ```
- **`isOpen`** (local time; `at.getDay()`, `at.getHours()`, `at.getMinutes()`). A schedule that is off is always open. Otherwise let `now` be minutes since midnight, `start` and `stop` the schedule's minutes, and `listed(d)` mean day `d` is in `days`:
  - `stop` is `null`: open when `listed(today)` and `now >= start`; the window closes at midnight (the settings label is "Run until midnight", `T.scheduleNoStop`).
  - `stop > start`: open when `listed(today)` and `start <= now < stop`.
  - `stop <= start` (the window crosses midnight; equal times mean a full day): open when `listed(today)` and `now >= start`, or when `listed(yesterday)` and `now < stop`. "Yesterday" is `(day + 6) % 7`.
  - Daylight-saving days shift a window by an hour. That is a known limit; do not add code for it.
  - Fixed examples (use `new Date(2026, 10, <day>, h, m)`; Monday is 9 November, so 8 Nov is a Sunday and 14 Nov a Saturday). With `S1 = { on: true, days: [1,2,3,4,5], start: '22:00', stop: '06:00' }`: Tue 10 23:00 open; Wed 11 05:59 open; Wed 11 06:00 closed; Wed 11 21:59 closed; Sat 14 05:00 open (it started Friday); Sat 14 23:00 closed; Sun 8 05:00 closed; Mon 9 05:00 closed. With `S2 = { on: true, days: [0,1,2,3,4,5,6], start: '09:00', stop: '17:00' }`: 10:00 open; 17:00 closed; 08:59 closed. With `S3 = { on: true, days: [0,1,2,3,4,5,6], start: '20:00', stop: null }`: 23:59 open; 19:59 closed. With `S4 = { on: true, days: [0,1,2,3,4,5,6], start: '22:00', stop: '22:00' }`: open at every time.
- **`nextChange(s, at)`**: off gives `null`. Otherwise build candidate edge times over 9 calendar days starting with yesterday (so a window that began yesterday still shows its stop): for each day `d` in that span that is listed, the local time `start` on `d` and, when `stop` is not null, the local time `stop` on `d` if `stop > start` else on `d + 1`; when `stop` is `null`, midnight at the end of `d`. Sort ascending, keep those strictly after `at`, and return the first `t` where `isOpen(s, new Date(t)) !== isOpen(s, at)`; none gives `null`.
  - Fixed examples: `nextChange(S1, Tue 10 12:00)` is Tue 10 22:00; `(S1, Tue 10 23:00)` is Wed 11 06:00; `(S1, Wed 11 03:00)` is Wed 11 06:00 (the window began on Tuesday); `(S1, Fri 13 23:00)` is Sat 14 06:00; `(S1, Sat 14 06:00)` is Mon 16 22:00; `(S3, Tue 10 12:00)` is Tue 10 20:00; `(S3, Tue 10 21:00)` is Wed 11 00:00; `(S4, any)` is `null`; `({ ...S1, on: false }, any)` is `null`.
- **`schedulePlan(records, queues, at, on)`** decides who starts and who stops. `on` is `DownloadSettings.on`. A record whose `queue` is not in `queues` belongs to the first queue. For each queue, in settings order, with `open = on && isOpen(queue.schedule, at)`:
  1. `stop` gets every `running` record that is not `force` when the queue is not open.
  2. Forced records (`force: true`, state `queued`) always start, whether or not the queue is open and however many slots are free. A `running` forced record is never stopped.
  3. `running` = records of that queue in state `running` that are not in `stop`, plus the forced ones just started. If `open`, `slots = max(0, queue.maxParallel - running)`; the first `slots` non-forced `queued` records, ordered by `addedAt` then `id`, start.
  - Records in states other than `queued` and `running` are never listed. The result lists are in queue order, then `addedAt`, then `id`.
  - Worked example. Queues: `main` (`maxParallel: 2`, schedule off) and `night` (`maxParallel: 1`, schedule `S1`). Records: `a` (main, running, addedAt 1), `b` (main, queued, 2), `c` (main, queued, 3), `d` (night, queued, 4), `e` (night, running, 1), `f` (main, queued, `force: true`, 5). At Tue 10 12:00, `on` true: `night` is closed, so `stop` is `['e']`, `d` does not start; in `main`, `f` starts (forced), `running` becomes 2 (`a` and `f`), `slots` is 0, so `b` and `c` wait. Result `{ start: ['f'], stop: ['e'] }`. At Tue 10 23:00: `night` is open, `e` keeps running, `slots` 0, `d` waits: `{ start: ['f'], stop: [] }`. With `on` false: `{ start: ['f'], stop: ['a', 'e'] }`. With `f` not forced and `a` finished (state `done`): `main` has `slots` 2 and starts `b` and `c`.

- [ ] **Step 0: Contract commit (first, before any implementation).** By pathspec, message `Sieve Phase 3 3.4: contract`. Files: `packages/sieve-core/src/dl-queue.ts`, `__tests__/dl-queue.test.ts`. Types, interfaces and message shapes are written exactly as in this task's Interfaces; plain data (constants, lists, message-type names) is real; every function body is `throw new Error('not implemented')`; each test file holds one `test.todo('<name>')` per case listed in this task's test steps. The `Plan` type is real. Send `[CONTRACT] 3.4: <sha, files, exported names>` to the controller as soon as it lands; do not list the test files in `package.json` (the controller does). Then continue with Step 1.
- [ ] **Step 1: Write the failing `dl-queue.test.ts`.**
  - `minutesOf('00:00')` 0, `('22:30')` 1350, `('23:59')` 1439.
  - `isOpen`: every fixed example above, plus: a schedule with `days: []`-free (days are validated non-empty) `days: [6]`, start `'22:00'`, stop `'06:00'`: Sat 14 23:00 open, Sun 15 05:00 open (use `new Date(2026, 10, 15, 5, 0)`), Sun 15 07:00 closed, Fri 13 23:00 closed.
  - `nextChange`: every fixed example above.
  - `nextWake`: queues with schedules off give `null`; one with `S1` at Tue 10 12:00 gives Tue 10 22:00; two scheduled queues give the smaller.
  - `queueOf` falls back to the first queue for an unknown id.
  - `schedulePlan`: the worked example four ways, plus: a queue with `maxParallel: 3` and five queued records (addedAt 5, 4, 3, 2, 1, same queue) starts the three oldest in `addedAt` order; equal `addedAt` breaks ties by `id`; paused, failed, saving and done records are never in either list; an unknown `queue` id counts toward the first queue's slots; nothing is mutated.
- [ ] **Step 2: Run, implement, and run again.** Run `node --test packages/sieve-core/src/__tests__/dl-queue.test.ts`, then a throwaway typecheck of only this task's files (`tsc --noEmit -p <a tsconfig in the scratchpad that extends `packages/sieve-core/tsconfig.json` and lists only this task's source and test files>`; the package-wide typecheck sees other agents' half-written files, so the controller runs it after each wave; when Task 3.1's files already exist, include them in that tsconfig, and when they do not yet exist the `import type` lines cannot resolve (TS2307), so record the typecheck as deferred to the controller's post-wave package typecheck and commit anyway). Expected: FAIL, then PASS.
- [ ] **Step 3: Commit** by pathspec with the message `Sieve core: queues and scheduler windows`. Report the test file name.

### Task 3.5: Take-over decision, names and categories (core)

**Files:**
- Create: `packages/sieve-core/src/dl-takeover.ts`, `packages/sieve-core/src/__tests__/dl-takeover.test.ts`

**Parallel:** wave A, starts with Tasks 3.1 to 3.4 and 3.6 (type imports only). Its tests spell the default settings and category lists as literal fixtures (a `TAKEOVER` object and six `CATEGORIES` entries copied from Task 3.1's text) instead of importing `DEFAULT_DOWNLOADS`. **Wave A rule:** Tasks 3.1 to 3.10 are dispatched at the same time in the first run; 3.1 to 3.6 have no upstream. Tasks 3.7 to 3.10 code against this task's contract commit (Step 0), do their lock-free work first, and run their integration tests and commit only after this task's implementation commit has landed. Tasks 3.2 to 3.6 import from Task 3.1's files only with `import type` (erased at run time by Node's type stripping, so their `node --test` runs need no code from 3.1), and every interface 3.1 defines is written out exactly in this plan so the others code against the text. A test that needs a value 3.1 owns builds its own literal fixture. Shared files: none.

**Interfaces:**
- Produces:
  ```ts
  import type { CategoryId, CategorySetting, TakeOverSetting } from './dl-settings.ts';
  export interface ChromeItem { url: string; finalUrl: string; referrer: string; mime: string; totalBytes: number; byExtensionId?: string; filename?: string }   // filename: Chrome's absolute path, '' in onCreated, filled after pause (inspected F11)
  export const SPACE_MARGIN = 50_000_000;   // free space kept beyond what a file needs; the engine (Task 3.8) imports it
  export function isOurs(item: Pick<ChromeItem, 'url' | 'finalUrl' | 'byExtensionId'>, extensionId: string, retryUrls: readonly string[]): boolean;
  export function extensionOf(name: string): string;                  // lowercase text after the last dot, '' if none or the name starts with the only dot
  export function urlFileName(url: string): string;                   // last path segment, percent-decoded (raw if decoding fails), '' if none
  export function normaliseMime(mime: string | null | undefined): string;   // lowercase, parameters stripped, trimmed
  export function mimeMatches(mime: string, patterns: readonly string[]): boolean;   // exact, or prefix when the pattern ends in '*'
  export type WantReason = 'off' | 'not-http' | 'unknown-size' | 'too-small' | 'type';
  export function wantsTakeover(item: ChromeItem, s: TakeOverSetting, downloadsOn: boolean): { want: true } | { want: false; reason: WantReason };
  export interface ProbeFacts {
    error?: string;                                  // the fetch threw, timed out or was blocked
    status: number; url: string;                     // url is the final URL after redirects
    contentRange: string | null; contentEncoding: string | null; mime: string | null;
    etag: string | null; lastModified: string | null; disposition: string | null; contentLength: string | null;
  }
  export function factsFromResponse(r: { status: number; url: string; headers: { get(name: string): string | null } }): ProbeFacts;
  export function factsFromError(message: string, url: string): ProbeFacts;      // status 0
  export function parseRangeTotal(contentRange: string | null): number | null;
  export type LeaveReason = 'probe-failed' | 'no-range' | `status-${number}` | 'encoded' | 'no-size' | 'size-differs' | 'type-differs' | 'no-space';
  export type Verdict =
    | { take: true; size: number; mime: string; validator: string | null; finalUrl: string; name: string }
    | { take: false; reason: LeaveReason };
  export function verdict(item: ChromeItem, probe: ProbeFacts, freeBytes: number | null): Verdict;   // freeBytes: quota minus usage from navigator.storage.estimate() (inspected F6: free disk), null when unknown
  export function validatorOf(facts: Pick<ProbeFacts, 'etag' | 'lastModified'>): string | null;   // a strong ETag, else Last-Modified, else null
  export function parseDisposition(header: string | null): string | null;
  export function sanitizeFileName(raw: string): string;
  export function chooseName(parts: { chromeFilename?: string | null; disposition: string | null; url: string; mime: string }): string;
  export function categoryOf(name: string, mime: string, categories: readonly CategorySetting[]): CategoryId;
  export function savePath(category: CategorySetting, name: string): string;    // `${folder}/${name}`
  export const MIME_EXTENSIONS: Readonly<Record<string, string>>;
  ```
- **`isOurs`** is true when any of these holds: `url` or `finalUrl` does not start with `http:` or `https:` (this covers our own `blob:chrome-extension://…` saves, `data:` and `filesystem:`); `byExtensionId === extensionId` (it is often absent at `onCreated`, inspected F9, so it is only a second guard); `url` or `finalUrl` is in `retryUrls`.
- **`wantsTakeover`** checks in this order: `downloadsOn` false or `s.on` false gives `off`; `url` and `finalUrl` not http(s) gives `not-http`; `totalBytes` below 0 or not finite gives `unknown-size`; `totalBytes <= s.minMb * 1_000_000` gives `too-small` (strictly greater is needed, so exactly 5,000,000 bytes is too small); then the type: the extension of `urlFileName(finalUrl || url)` is in `s.extensions`, or `mimeMatches(item.mime, s.mimeTypes)`; neither gives `type`. Otherwise `{ want: true }`.
- **`verdict`** is the decision table in "Shape of the code", in that order, with `ProbeFacts` as input: `error` set gives `probe-failed`; status 200 gives `no-range`; status other than 206 gives `status-<code>`; `contentEncoding` not null and not `identity` (case-insensitive) gives `encoded`; `parseRangeTotal(contentRange)` null gives `no-size`; total not equal to `item.totalBytes` gives `size-differs`; `item.mime` not empty and `normaliseMime(item.mime) !== normaliseMime(probe.mime)` gives `type-differs`; `freeBytes` a number below `2 * total + SPACE_MARGIN` gives `no-space` (the file needs room twice, once in the private copy and once in Downloads; `null` skips the check); otherwise take over with `size` the total, `mime` the normalised probe mime, `validator` `validatorOf(probe)`, `finalUrl` the probe's `url`, and `name` from `chooseName({ chromeFilename: item.filename, disposition: probe.disposition, url: probe.url, mime })`. Row 4 (`encoded`) cannot be reached through `fetch`: Chrome sends `Accept-Encoding: identity` with a `Range` header and `fetch` throws when a server answers with `Content-Encoding` anyway (inspected F17), which is the `probe-failed` row. Keep the row, with a comment saying so.
- **`parseRangeTotal`**: `bytes <a>-<b>/<total>` with digits gives `total`; `bytes 0-0/*`, `bytes */500`, garbage and `null` give `null`.
- **`parseDisposition`**: `filename*=UTF-8''<percent-encoded>` wins over `filename=`; `filename="a b.zip"` (with `\"` unescaped to `"`) and the unquoted token form work; `inline` and a header without a filename give `null`; a `filename*` that fails to decode falls back to `filename=`.
- **`sanitizeFileName(raw)`**, exactly, in this order: take the text after the last `/` or `\`; normalise to NFC; replace each of `< > : " | ? *` and every character in U+0000 to U+001F and U+007F with `_`; collapse runs of whitespace to one space; trim spaces; strip leading dots and trailing dots and spaces; if the result is empty give `download`; if it is longer than 150 UTF-16 units, cut the part before the extension (the extension is the text from the last dot when it is at most 12 units long) so the whole is 150 units. Windows device names are not special-cased (this is for macOS).
- **`chooseName`**: `raw` is the first of these that is non-empty: the basename of `chromeFilename` with a trailing `.crdownload` removed, but only when it has an extension (`extensionOf` not empty; Playwright's download manager names files by GUID with none, so it falls through), then `parseDisposition(disposition)`, then `urlFileName(url)`. Chrome's own name wins because it already applies a page's `download` attribute and its own rules; `name = sanitizeFileName(raw)`; when `extensionOf(name)` is empty and `MIME_EXTENSIONS[normaliseMime(mime)]` exists, append `.` and it. `MIME_EXTENSIONS` has exactly: `application/pdf: pdf`, `application/zip: zip`, `application/gzip: gz`, `application/x-7z-compressed: 7z`, `application/x-apple-diskimage: dmg`, `application/vnd.android.package-archive: apk`, `video/mp4: mp4`, `video/webm: webm`, `video/x-matroska: mkv`, `audio/mpeg: mp3`, `audio/mp4: m4a`, `audio/flac: flac`.
- **`categoryOf`**: the first category, in the array's order, whose `extensions` contain `extensionOf(name)`; else by MIME: `video/` gives `video`, `audio/` gives `music`; else `other`. An extension match beats the MIME.
- **Collision rule** (there is nothing to code beyond `savePath`): two records may have the same name; Chrome's `conflictAction: 'uniquify'` makes the second `name (1).ext` (Task 3.12). The record keeps the name it chose; `savedPath` holds the real one.

- [ ] **Step 0: Contract commit (first, before any implementation).** By pathspec, message `Sieve Phase 3 3.5: contract`. Files: `packages/sieve-core/src/dl-takeover.ts`, `__tests__/dl-takeover.test.ts`. Types, interfaces and message shapes are written exactly as in this task's Interfaces; plain data (constants, lists, message-type names) is real; every function body is `throw new Error('not implemented')`; each test file holds one `test.todo('<name>')` per case listed in this task's test steps. `SPACE_MARGIN`, `MIME_EXTENSIONS` and every exported type (`ChromeItem`, `ProbeFacts`, `Verdict`, `LeaveReason`, `WantReason`) are real. Send `[CONTRACT] 3.5: <sha, files, exported names>` to the controller as soon as it lands; do not list the test files in `package.json` (the controller does). Then continue with Step 1.
- [ ] **Step 1: Write the failing `dl-takeover.test.ts`.**
  - `isOurs`: `blob:chrome-extension://abc/uuid` true; `data:text/plain,x` true; `filesystem:` true; an http URL with `byExtensionId: 'abc'` and `extensionId` `'abc'` true; with another id false; an http URL in `retryUrls` true (by `url` and by `finalUrl`); an ordinary http item false.
  - `wantsTakeover` with a literal `TAKEOVER = { on: true, minMb: 5, extensions: <the 56 default extensions of Task 3.1>, mimeTypes: <the 31 default content types of Task 3.1> }` spelled in the test: `{ url: 'https://example.com/files/app.dmg', mime: 'application/x-apple-diskimage', totalBytes: 6_000_000 }` wants; 5,000,000 is `too-small`, 5,000,001 wants; `-1` is `unknown-size`; `blob:` is `not-http`; `text/html` at `https://example.com/page` with 9,000,000 bytes is `type`; `application/octet-stream` at `https://example.com/get?id=3` with 9,000,000 bytes wants (MIME); `https://x.com/movie.MKV` with an unlisted MIME wants (extension, case-insensitive); `application/vnd.openxmlformats-officedocument.wordprocessingml.document` with no extension wants (prefix pattern); `s.on` false and `downloadsOn` false each give `off`; `minMb: 0` takes a 1-byte file of a listed type.
  - `verdict`, one case per row of the table (rows 1 to 9), with an item `{ url: 'https://h/a.zip', finalUrl: 'https://h/a.zip', referrer: '', mime: 'application/zip', totalBytes: 9_000_000 }`: `error` gives `probe-failed`; 200 gives `no-range`; 403, 404, 429 and 503 give `status-403` and so on; `contentEncoding: 'gzip'` gives `encoded`, `'identity'` does not; `contentRange: 'bytes 0-0/*'` and `null` give `no-size`; `bytes 0-0/9000001` gives `size-differs`; probe mime `text/html` gives `type-differs`; an item with `mime: ''` skips the type check; a take-over with `etag: '"abc"'` gives `validator '"abc"'`, with `etag: 'W/"abc"'` and a Last-Modified gives the Last-Modified, with neither gives `null`; `freeBytes` 1,000 gives `no-space` and `2 * 9_000_000 + SPACE_MARGIN - 1` gives `no-space` while `2 * 9_000_000 + SPACE_MARGIN` and `null` take over; the take-over `name` is the basename of `item.filename` (`/home/x/Downloads/Report.pdf.crdownload` gives `Report.pdf`) when it has an extension, else the disposition's, else the URL's, and a GUID filename without an extension falls through to the disposition.
  - `extensionOf('a.b.GZ')` is `'gz'`; `extensionOf('.bashrc')`, `extensionOf('file.')` and `extensionOf('noext')` are `''`. `normaliseMime('Text/HTML; charset=utf-8')` is `'text/html'`; `normaliseMime(null)` is `''`. `validatorOf` prefers a strong ETag, ignores `W/"x"`, then uses Last-Modified, then gives `null`.
  - `factsFromResponse` with a real `Headers` object: copies the eight headers (null when absent) and the final `url`; `factsFromError('timed out', 'https://h/a')` has `error`, `status` 0.
  - `parseRangeTotal`: `'bytes 0-0/12345'` 12345; `'bytes 0-0/*'`, `'bytes */500'`, `'garbage'`, `null` give `null`.
  - `parseDisposition`: `attachment; filename="a b.zip"` is `'a b.zip'`; `attachment; filename*=UTF-8''%E2%82%AC%20rates.txt` is `'€ rates.txt'`; both present: the starred one wins; `attachment; filename=plain.bin` is `'plain.bin'`; `inline` and `null` are `null`; `attachment; filename="a\"b.zip"` is `'a"b.zip'`.
  - `sanitizeFileName`: `'a<b>c:d"e|f?g*h.txt'` gives `'a_b_c_d_e_f_g_h.txt'`; `'  report.pdf  '` gives `'report.pdf'`; `'...hidden.txt'` gives `'hidden.txt'`; `''`, `'.'` and `'..'` give `'download'`; `'/etc/passwd'` gives `'passwd'`; `'C:\\x\\y.zip'` gives `'y.zip'`; `'a\u0000b.txt'` gives `'a_b.txt'`; `'e\u0301.txt'` gives `'é.txt'`; `'a   b.txt'` gives `'a b.txt'`; `'file.'` gives `'file'`; `'name.tar.gz'` is unchanged; `'x'.repeat(300) + '.mp4'` has length 150 and ends with `.mp4`.
  - `urlFileName`: `'https://x.com/a/b%20c.zip?x=1'` is `'b c.zip'`; `'https://x.com/'` and `'https://x.com/a/'` are `''`; `'https://x.com/%E0%A4%A'` is `'%E0%A4%A'`.
  - `chooseName`: no disposition, URL `https://x.com/get`, mime `application/pdf` gives `'get.pdf'`; URL `https://x.com/a.bin` with mime `application/pdf` stays `'a.bin'`; an empty path and unknown mime gives `'download'`.
  - `categoryOf` with a literal `CATEGORIES` of the six categories as Task 3.1 lists them (ids, folders and extensions copied into the test): `('movie.MP4', 'video/mp4')` video; `('x.bin', 'audio/mpeg')` music; `('x.zip', 'application/octet-stream')` archives; `('x', '')` other; `('setup.exe', 'application/x-msdownload')` programs; `('doc.pdf', '')` documents; `('x.mp3', 'video/mp4')` music; with a custom array where `documents` lists `mkv` and comes before `video`, `('a.mkv', '')` is documents.
  - `savePath({ id: 'video', folder: 'Video', extensions: [] }, 'a.mp4')` is `'Video/a.mp4'`.
- [ ] **Step 2: Run, implement, and run again.** Run `node --test packages/sieve-core/src/__tests__/dl-takeover.test.ts`, then a throwaway typecheck of only this task's files (`tsc --noEmit -p <a tsconfig in the scratchpad that extends `packages/sieve-core/tsconfig.json` and lists only this task's source and test files>`; the package-wide typecheck sees other agents' half-written files, so the controller runs it after each wave; when Task 3.1's files already exist, include them in that tsconfig, and when they do not yet exist the `import type` lines cannot resolve (TS2307), so record the typecheck as deferred to the controller's post-wave package typecheck and commit anyway). Expected: FAIL, then PASS.
- [ ] **Step 3: Commit** by pathspec with the message `Sieve core: take-over decision, file names and categories`. Report the test file name.

### Task 3.6: List helpers and visible text (core)

**Files:**
- Create: `packages/sieve-core/src/dl-view.ts`, `packages/sieve-core/src/dl-text.ts`
- Create: `packages/sieve-core/src/__tests__/dl-view.test.ts`, `packages/sieve-core/src/__tests__/dl-text.test.ts`

**Parallel:** wave A, starts with Tasks 3.1 to 3.5 (type imports only; it sums `parts[i].done` itself instead of importing `bytesDone`, and takes the queue-window lookup as an injected `nextOpenAt`, so it does not wait for Task 3.4). **Wave A rule:** Tasks 3.1 to 3.10 are dispatched at the same time in the first run; 3.1 to 3.6 have no upstream. Tasks 3.7 to 3.10 code against this task's contract commit (Step 0), do their lock-free work first, and run their integration tests and commit only after this task's implementation commit has landed. Tasks 3.2 to 3.6 import from Task 3.1's files only with `import type` (erased at run time by Node's type stripping, so their `node --test` runs need no code from 3.1), and every interface 3.1 defines is written out exactly in this plan so the others code against the text. A test that needs a value 3.1 owns builds its own literal fixture. Its tests build records and queues as local literals, as 3.2, 3.4 and 3.5 do. Tasks 3.7 and 3.10 build against it (contract commit first). Shared files: none.

**Interfaces:**
- Produces, in `dl-view.ts`:
  ```ts
  import type { DlRecord } from './dl-record.ts';
  import type { CategoryId, DownloadSettings, QueueSetting } from './dl-settings.ts';
  export { plural } from './dl-text.ts';                                      // `plural(n, one, many)` is defined in dl-text.ts (it needs it for the templates), so dl-view.ts and dl-text.ts do not import each other in a cycle
  export function formatBytes(n: number): string;
  export function formatSpeed(bytesPerSecond: number): string;               // '' when 0 or not finite
  export function formatEta(seconds: number | null): string;                 // '' when null or not finite
  export function progressOf(r: DlRecord): { done: number; total: number | null; percent: number | null };
  export function etaSeconds(r: DlRecord, speed: number): number | null;    // null when the size or the speed is unknown or the speed is 0
  export type SidebarFilter = { kind: 'all' } | { kind: 'unfinished' } | { kind: 'finished' } | { kind: 'category'; id: CategoryId } | { kind: 'queue'; id: string };
  export function filterRecords(records: readonly DlRecord[], f: SidebarFilter): DlRecord[];
  export type SortKey = 'added' | 'name' | 'size' | 'progress' | 'speed' | 'eta';
  export function sortRecords(records: readonly DlRecord[], key: SortKey, dir: 'asc' | 'desc', speeds: Readonly<Record<string, number>>): DlRecord[];
  export function parseAddInput(text: string, max?: number): { urls: string[]; skipped: number; truncated: boolean };   // max defaults to 200
  export function statusText(r: DlRecord, queues: readonly QueueSetting[], categories: DownloadSettings['categories'], at: Date, nextOpenAt: (q: QueueSetting, at: Date) => number | null): string;
  ```
- Produces, in `dl-text.ts`: `export function plural(n: number, one: string, many: string): string` (`${n} ${one|many}`, with thousands separators; `n` of 1 takes `one`) and `export const T` (every visible string of this phase except the error sentences in `ERRORS`, Task 3.1). Plain strings, or functions where a number or a name goes in. The keys and texts, exactly:

  | Key | Text |
  |---|---|
  | `listTitle` | "Sieve downloads" |
  | `navAll` | "All downloads" |
  | `navUnfinished` | "Unfinished" |
  | `navFinished` | "Finished" |
  | `navCategories` | "Categories" |
  | `navQueues` | "Queues" |
  | `addUrl` | "Add URL" |
  | `resume` | "Resume" |
  | `pause` | "Pause" |
  | `delete` | "Delete" |
  | `speedLimit` | "Speed limit" |
  | `scheduler` | "Scheduler" |
  | `colName` | "Name" |
  | `colSize` | "Size" |
  | `colProgress` | "Progress" |
  | `colSpeed` | "Speed" |
  | `colEta` | "Time left" |
  | `emptyAll` | "No downloads yet. Press Add URL, or download a large file in Chrome." |
  | `emptyFiltered` | "Nothing here." |
  | `offBanner` | "Downloads are off. Sieve isn't taking over Chrome's downloads or starting queued ones. You can still resume or remove what's listed here." |
  | `turnOn` | "Turn on" |
  | `retryInChrome` | "Retry in Chrome" |
  | `showInFolder` | "Show in folder" |
  | `selectRow(name)` | `Select ${name}` |
  | `progressLabel(name)` | `Progress of ${name}` |
  | `confirmDeleteUnfinished(n)` | `Delete ${plural(n, 'download', 'downloads')}? Sieve removes the partly downloaded data.` |
  | `confirmDeleteFinished(n)` | `Remove ${plural(n, 'download', 'downloads')} from the list? The saved files stay in your Downloads folder.` |
  | `confirmDelete` | "Delete" |
  | `confirmRemove` | "Remove from list" |
  | `cancel` | "Cancel" |
  | `addTitle` | "Add downloads" |
  | `addLabel` | "Web addresses (one per line)" |
  | `addQueue` | "Queue" |
  | `addCategory` | "Save in" |
  | `addAutomatic` | "Automatic" |
  | `addSubmit` | "Add" |
  | `addNone` | "Enter at least one web address that starts with http:// or https://." |
  | `addSkipped(n)` | `${plural(n, "line isn't a web address", "lines aren't web addresses")} and ${n === 1 ? 'was' : 'were'} skipped.` |
  | `addFailed` | "Sieve couldn't add these downloads. Reload Sieve from chrome://extensions, then try again." |
  | `actionFailed` | "Sieve couldn't do that. Reload Sieve from chrome://extensions, then try again." |
  | `retryGone` | "This download is no longer in the list." |
  | `retryRefused` | "Chrome didn't start the download. Check your connection, then try again." |
  | `navLabel` | "Download filters" |
  | `limitOn` | "Limit download speed" |
  | `limitValue` | "Limit (KB/s)" |
  | `limitNote` | "The limit applies to all downloads together." |
  | `schedulerTitle` | "Scheduler" |
  | `scheduleUse` | "Use this schedule" |
  | `scheduleStart` | "Start at" |
  | `scheduleStop` | "Stop at" |
  | `scheduleNoStop` | "Run until midnight" |
  | `scheduleParallel` | "Downloads at once" |
  | `close` | "Close" |
  | `days` | `['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']` |
  | `menuOn` | "Downloads on" |
  | `menuOff` | "Downloads are off. Sieve won't take over Chrome's downloads." |
  | `menuNone` | "No downloads right now." |
  | `menuSeeAll` | "Open download list" |
  | `menuAdd` | "Add URL" |
  | `ctxLink` | "Download link with Sieve" |
  | `ctxSelection` | "Download selected links with Sieve" |
  | `ctxPage` | "Download all links with Sieve" |
  | `sectionTitle` | "Downloads" |
  | `setOn` | "Downloads" |
  | `setOnHelp` | "Turn this off to stop taking over Chrome's downloads, the right-click items and queue starts. Your list stays." |
  | `setTakeOver` | "Take over Chrome's downloads" |
  | `setMinMb` | "Smallest file to take over (MB)" |
  | `setExtensions` | "File types to take over" |
  | `setExtensionsHelp` | "Extensions, separated by spaces or commas." |
  | `setMime` | "Content types to take over" |
  | `setMimeHelp` | "One per line. End with * to match a whole family, like video/*." |
  | `setResetTypes` | "Reset file types" |
  | `setParts` | "Parts per file" |
  | `setPartsHelp` | "One part is the safest. More parts can help when a server limits each connection, but they often change nothing and some servers refuse them. If a server refuses, Sieve uses fewer parts for that site for 30 minutes." |
  | `setSpeed` | "Speed limit" |
  | `setCategories` | "Categories" |
  | `setCategoriesHelp` | "Each category is a folder inside your Downloads folder." |
  | `setFolder(name)` | `Folder for ${name}` |
  | `setCategoryExt(name)` | `File types for ${name}` |
  | `setQueues` | "Queues" |
  | `setQueueName` | "Queue name" |
  | `setAddQueue` | "Add a queue" |
  | `setRemoveQueue(name)` | `Remove ${name}` |
  | `categoryNames` | `{ video: 'Video', music: 'Music', programs: 'Programs', archives: 'Archives', documents: 'Documents', other: 'Other' }` (the labels in lists and the sidebar; the folder name comes from settings) |
  | `st.waiting(queue)` | `Waiting in ${queue}` |
  | `st.scheduled(when)` | `Scheduled for ${when}` |
  | `st.starting` | "Starting" |
  | `st.downloading` | "Downloading" |
  | `st.paused` | "Paused" |
  | `st.saving` | "Saving to Downloads" |
  | `st.done(folder)` | `Saved to Downloads/${folder}` |
  | `st.failed` | "Failed" |
  | `st.noResume` | "This server can't resume a download, so Sieve downloads it in one go." |

- **`formatBytes(n)`**: `n` not finite or negative gives `0 B`. Below 1000: `${n} B`. Else scale by 1000 through `KB MB GB TB`; the value `v` has one decimal when its one-decimal rounding is below 10 and none otherwise (decide from the rounded value, so `9_999` is `10 KB`, not `10.0 KB`); if rounding gives 1000 or more, move to the next unit. `999_999` is `1.0 MB`, `9_999` is `10 KB`, `9_949` is `9.9 KB`, `1_000` `1.0 KB`, `1_500` `1.5 KB`, `15_000` `15 KB`, `1_048_576` `1.0 MB`, `5_242_880` `5.2 MB`, `412_000_000` `412 MB`, `2_500_000_000` `2.5 GB`.
- **`formatSpeed(b)`**: `''` for 0 or not finite, else `formatBytes(b) + '/s'` (`2_400_000` is `2.4 MB/s`).
- **`formatEta(s)`**: `''` for `null` or not finite; below 60: `${floor(s)} sec`; below 3600: `${floor(s / 60)} min`; below 86400: `${h} h ${m} min` with `m = floor((s % 3600) / 60)`; else `${d} d ${h} h`. `0` is `0 sec`, `59` `59 sec`, `60` `1 min`, `3599` `59 min`, `3600` `1 h 0 min`, `3725` `1 h 2 min`, `86400` `1 d 0 h`, `90000` `1 d 1 h`.
- **`progressOf`**: `done` is the sum of `parts[i].done` (computed here; no value import from `dl-record.ts`); `total = r.size`; `percent = floor(done * 100 / total)` clamped to 0 to 100, `null` when `total` is null; a `done` record is 100.
- **`filterRecords`**: `all` every record; `unfinished` every state except `done`; `finished` only `done`; `category` by `category`; `queue` by `queue`. Input order is kept.
- **`sortRecords`**: `added` by `addedAt`; `name` by `localeCompare('en', { numeric: true, sensitivity: 'base' })`; `size` by `size`; `progress` by percent; `speed` by `speeds[id] ?? 0`; `eta` by `etaSeconds` with `speeds`. `desc` reverses the comparison. Null sizes, percents and etas sort last in both directions. The sort is stable and returns a new array.
- **`parseAddInput(text, max = 200)`**: split on newlines, trim, ignore empty lines; a line that parses with `new URL` and has protocol `http:` or `https:` contributes `url.href`, any other non-empty line adds 1 to `skipped`; duplicates (by href) are dropped without counting; more than `max` valid URLs keep the first `max` and set `truncated`.
- **`statusText`**: `nextOpenAt(queue, at)` is the injected contract: the epoch milliseconds at which the queue next opens, or `null` when it is open now or has no schedule (Task 3.15 passes `(q, at) => (isOpen(q.schedule, at) ? null : nextChange(q.schedule, at))`). `queued`: when `nextOpenAt` returns a time, `T.st.scheduled('<Day> HH:MM')` using `T.days` and local time, else `T.st.waiting(queue.name)`; `running`: `T.st.starting` when `size` is `null`, else `T.st.downloading` (the list shows `T.st.noResume` as a tooltip when `rangeOk` is false, Task 3.15, not here); `paused`, `saving` as the table; `done`: `T.st.done(<the category's folder from settings>)`; `failed`: `r.error ?? T.st.failed`.

- [ ] **Step 0: Contract commit (first, before any implementation).** By pathspec, message `Sieve Phase 3 3.6: contract`. Files: `packages/sieve-core/src/dl-view.ts`, `dl-text.ts`, `__tests__/dl-view.test.ts`, `__tests__/dl-text.test.ts`. Types, interfaces and message shapes are written exactly as in this task's Interfaces; plain data (constants, lists, message-type names) is real; every function body is `throw new Error('not implemented')`; each test file holds one `test.todo('<name>')` per case listed in this task's test steps. `dl-text.ts` is plain data and is written for real in full (`plural`, `T` with every key and template function of the table); `dl-view.ts` has real types and a real `export { plural } from './dl-text.ts'`, and stub functions. Send `[CONTRACT] 3.6: <sha, files, exported names>` to the controller as soon as it lands; do not list the test files in `package.json` (the controller does). Then continue with Step 1.
- [ ] **Step 1: Write the failing `dl-view.test.ts`.**
  - `plural(1, 'download', 'downloads')` is `'1 download'`; `plural(1234, …)` is `'1,234 downloads'`.
  - `formatBytes`: every value above plus `0` (`'0 B'`), `999` (`'999 B'`), `NaN` and `-5` (`'0 B'`). `formatSpeed`, `formatEta`: every value above plus `null`, `Infinity` (`''`).
  - `progressOf`: size 1000 and parts done 255 gives percent 25; size null gives `percent: null`; a `done` record gives 100; done above size clamps to 100.
  - `etaSeconds`: size 1000, done 500, speed 100 gives 5; speed 0 gives `null`; size null gives `null`.
  - `filterRecords`: one record per state, per category and per queue; `unfinished` keeps failed and paused; order kept.
  - `sortRecords`: names `['b10', 'B2', 'a']` ascending give `['a', 'B2', 'b10']`; sizes `[5, null, 1]` ascending give `[1, 5, null]` and descending give `[5, 1, null]`; speeds and eta use the map; stability: equal keys keep input order; the input array is not mutated.
  - `parseAddInput('  https://a.com/x\n\nftp://b\nnot a url\nhttps://a.com/x\nhttp://c.org')` gives `urls: ['https://a.com/x', 'http://c.org/']`, `skipped: 2`, `truncated: false`; with `max` 1 gives one URL and `truncated: true`; empty text gives `urls: []`, `skipped: 0`.
  - `statusText` with queues `main` (schedule off) and `night` (`{ on: true, days: [0..6], start: '22:00', stop: '06:00' }`), `at` `new Date(2026, 10, 10, 12, 0)` (Tuesday 10 November 2026, 12:00 local time; every test date in this phase is built with `new Date(2026, 10, d, h, m)`, never from an ISO string, which would be UTC), `nextOpenAt` returning Tue 22:00 for `night` and `null` for `main`: queued in `main` is `Waiting in Main queue`; queued in `night` is `Scheduled for Tue 22:00`; running with `size: null` is `Starting`; running with a size is `Downloading`; paused, saving as the table; done in category `video` with folder `Movies` is `Saved to Downloads/Movies`; failed with `error` set to the sentence "The connection dropped and Sieve couldn't reconnect. Check your network, then press Resume." (spelled in the test) is that text; failed with `error: null` is `Failed`.
- [ ] **Step 2: Write the failing `dl-text.test.ts`.**
  - Every table key exists with the exact text above (spell the table out in the test). `plural` is exported from `dl-text.ts`: `plural(1, 'download', 'downloads')` is `'1 download'`, `plural(1234, …)` is `'1,234 downloads'` (`dl-view.test.ts` checks the re-export).
  - No string value, and no result of the template functions called with sample arguments, contains (case-insensitively) `faster`, `accelerat`, `boost`, `turbo` or `speed up`; none contains an emoji (`/\p{Extended_Pictographic}/u`) or a word of three or more capital letters in a row (no ALL-CAPS labels; `URL` and `KB/s` are allowed, so test `/\b[A-Z]{4,}\b/`); every plain string starts with an uppercase letter or a digit.
  - `T.addSkipped(1)` is `"1 line isn't a web address and was skipped."`; `T.addSkipped(3)` is `"3 lines aren't web addresses and were skipped."`; `T.confirmDeleteUnfinished(2)` and `T.confirmDeleteFinished(1)` as the table says.
- [ ] **Step 3: Run, implement, and run again.** Run `node --test packages/sieve-core/src/__tests__/dl-view.test.ts packages/sieve-core/src/__tests__/dl-text.test.ts`, then a throwaway typecheck of only this task's files (`tsc --noEmit -p <a tsconfig in the scratchpad that extends `packages/sieve-core/tsconfig.json` and lists only this task's source and test files>`; the package-wide typecheck sees other agents' half-written files, so the controller runs it after each wave; when Task 3.1's files already exist, include them in that tsconfig, and when they do not yet exist the `import type` lines cannot resolve (TS2307), so record the typecheck as deferred to the controller's post-wave package typecheck and commit anyway). Expected: FAIL, then PASS.
- [ ] **Step 4: Commit** by pathspec with the message `Sieve core: list helpers and visible text`. Report the two test file names.

### Task 3.7: Wiring: permissions, build hook, engine link, offscreen host

**Files:**
- Create: `apps/sieve/src/dl/background-dl.ts`, `engine-link.ts`, `settings-store.ts`, `router.ts`, `save.ts`, `takeover.ts`, `menus.ts`, `build-dl.mjs`
- Create: `apps/sieve/src/offscreen/offscreen.html`, `offscreen.ts`, `protocol.ts` (the Worker message types), `engine-worker.ts` (a stub the real engine replaces in Task 3.10)
- Create: `apps/sieve/src/__tests__/dl-engine-link.test.ts`
- Create: `apps/sieve/test/dl/e2e.mjs`, `test/dl/_helpers.mjs`, `test/dl/boot.mjs`
- Modify (appended lines only, in one short window at the end of the task): `apps/sieve/src/manifest.json`, `apps/sieve/build.mjs`, `apps/sieve/src/background.ts`, `apps/sieve/test/e2e.mjs`, `apps/sieve/package.json` (the `test:dl` script)

**Parallel:** first run: dispatched together with Tasks 3.1 to 3.6 and 3.8 to 3.10 (the wave-A run, cap 10 tasks). **Built against:** Task 3.1's contract commit (`DownloadSettings`, `DEFAULT_DOWNLOADS`, `DOWNLOADS_KEY`, `validateDownloadSettings(input: unknown): DownloadSettings` in `dl-settings.ts`; the type `AddItem` in `dl-record.ts`), Task 3.6's contract commit (`T.addFailed`, `T.actionFailed` in `dl-text.ts`), Task 3.8's contract commit (the type `StateChange` in `dl-engine.ts`, imported by `protocol.ts` with `import type`), Phase 1's `withSettingsLock` (`apps/sieve/src/lock.ts`) and the harness's `launch`, `stopWorker`, `check` (`test/harness.mjs`, not edited). **Consumed by:** Task 3.10 (every file here), Tasks 3.11 to 3.14 (the stubs `router.ts`, `save.ts`, `takeover.ts`, `menus.ts`; `engine-link.ts`; `settings-store.ts`; `_helpers.mjs`), Tasks 3.15 to 3.18 (`settings-store.ts`: `readDownloads`, `saveDownloads`, `onDownloadsChanged`). **Waits for:** it may write every file, `dl-engine-link.test.ts` and the e2e files before any upstream commit exists; the router, `settings-store.ts` and `_helpers.mjs` import values from Tasks 3.1 and 3.6 (`validateDownloadSettings`, `DEFAULT_DOWNLOADS`, `T`), so its integration steps (Steps 4 to 6) and its pathspec commit wait for the implementation commits of 3.1 and 3.6. It is the only task that adds to `manifest.json`'s permissions, `build.mjs`, `background.ts` and the `dl` call line of `test/e2e.mjs`, each under a `filelock` on that file (see Global Constraints); Task 3.17 later edits one check's text in `test/e2e.mjs` and Task 3.20 sets the `version` in `manifest.json`, each under the same lock.

**Interfaces:**
- Produces, in `settings-store.ts`:
  ```ts
  export async function readDownloads(): Promise<DownloadSettings>;                       // validateDownloadSettings((await chrome.storage.local.get('downloads')).downloads)
  export function saveDownloads(edit: (s: DownloadSettings) => DownloadSettings): Promise<boolean>;   // under withSettingsLock; re-reads inside the lock; false and a console.error on failure, as controls.ts `save` does
  export async function getDownloads(): Promise<DownloadSettings>;                        // the worker's cached copy, refilled after a `downloads` change
  export function onDownloadsChanged(cb: (s: DownloadSettings) => void): void;           // chrome.storage.onChanged, area local, key `downloads`
  ```
- Produces, in `engine-link.ts` (service worker side):
  ```ts
  export const ENGINE_PAGE = 'offscreen.html';
  export async function engineExists(): Promise<boolean>;     // chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).length > 0 (inspected F4)
  export async function ensureEngine(): Promise<void>;        // creates the document once even when called five times at once; swallows "Only a single offscreen document may be created."
  export async function closeEngine(): Promise<void>;         // chrome.offscreen.closeDocument(), no error when none
  export async function sendToEngine<T = unknown>(message: { type: `dl-eng-${string}` } & Record<string, unknown>): Promise<T>;   // ensureEngine, then chrome.runtime.sendMessage; retries up to 10 times, 100 ms apart, calling `ensureEngine()` again inside each retry (the document may have closed meanwhile), while Chrome says "Receiving end does not exist"; the text "message port closed before a response was received" is retried too, but only for an `dl-eng-add` whose items **all** carry a `chromeId` (the engine's `add` returns the existing id for the same `chromeId` and `url`, Task 3.8, so a replay cannot create a second record); for any other message, and for an `dl-eng-add` with an item without `chromeId` (a manual add), it is not retried and the caller reports `T.addFailed`: a retry never creates a duplicate row; then rejects
  export async function addRecords(items: AddItem[]): Promise<{ ids: string[] } | null>;   // sendToEngine dl-eng-add; null on any failure (Task 3.10 puts the net-rules preparation in front of it)
  export function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean;         // sender.url starts with chrome.runtime.getURL('') (a content script's sender.url is the web page's)
  ```
  `createDocument` is called with `{ url: ENGINE_PAGE, reasons: ['WORKERS', 'BLOBS'], justification: "Downloads files in the background so a download keeps going when Chrome stops the extension's service worker." }`.
- Produces `background-dl.ts`: `export function initDownloads(): void`, which calls, synchronously and in this order, `initRouter()`, `initSave()`, `initTakeover()`, `initMenus()` (listeners must be added at the top level so Chrome can deliver the event that woke a stopped worker). `save.ts`, `takeover.ts` and `menus.ts` each export their `init…()` as an empty function in this task; Tasks 3.12, 3.13 and 3.14 each fill in one of them and touch no other file.
- Produces `router.ts` (`export function initRouter(): void`), a pass-through in this task that Task 3.11 completes. It adds one `chrome.runtime.onMessage` listener that ignores every message not sent by an extension page (`fromExtensionPage`) and handles:
  - `dl-add`: `items` must be an array of 1 to 500 objects with `url` a string that parses as `http:` or `https:` and `source` one of `'manual' | 'menu'` (a page may not send `source: 'takeover'`, `probed` or `chromeId`); optional fields are checked too: `referrer` is `''` or an `http(s)` URL, `name` a string of at most 300 characters, `category` one of `CATEGORY_IDS`, `queue` a string of at most 24 characters; otherwise reply `{ ok: false, message: T.addFailed }`. Valid: `addRecords(items)`; reply `{ ok: true, ids }`, or `{ ok: false, message: T.addFailed }` when it returns `null`. Return `true` (async reply).
  - `dl-do`: `op` one of `pause`, `resume`, `remove` and `ids` an array of at most 500 strings; forwards `sendToEngine({ type: 'dl-eng-do', op, ids })`; reply `{ ok: true }` (`{ ok: false, message: T.actionFailed }` on a bad message or a failure; `T.addFailed` is only for `dl-add`).
  - `dl-sw-ready` (sent by the engine): reply `{ settings: await readDownloads() }` (a fresh storage read, not the cache, so a settings write made a moment ago is never missed).
  - Every other `type` returns `false` so other handlers (`pick-handler.ts`) keep their messages.
- Produces `offscreen.html` (a bare page with `<script src="offscreen.js"></script>`) and `offscreen.ts` (the relay, built as a classic script):
  - Creates `new Worker('engine-worker.js')`. If the Worker dies (`error` event) it calls `worker.terminate()` on the old one, creates a new one and repeats the start-up below, at most 3 times per 60 s, then stops and logs once. Every pending reply is answered `{ error: 'TIMEOUT' }` after 20 s and immediately when its Worker is replaced.
  - On start it sends `chrome.runtime.sendMessage({ type: 'dl-sw-ready' })` (retrying every 500 ms until it gets a reply with `settings`), then posts `{ id, cmd: 'config', payload: settings }` to the Worker and waits for the reply to it. The Worker replies to its first `config` only after `engine.start()` has finished; until that reply arrives, the relay holds every other `dl-eng-*` message (it queues them, in order) and forwards them afterwards. An `dl-eng-config` that arrives before the first reply is not forwarded as a second start: it replaces the queued settings.
  - Listens with `chrome.runtime.onMessage` for `dl-eng-add`, `dl-eng-do`, `dl-eng-config`, `dl-eng-tick`, `dl-eng-save-event`; each becomes `{ id, cmd: 'add' | 'do' | 'config' | 'tick' | 'save-event', payload }` for the Worker (a counter gives `id`), and the Worker's `{ reply: id, result }` becomes the runtime reply (return `true`). Other types return `false`.
  - Worker pushes: `{ push: 'state', payload }` is sent as `{ type: 'dl-state', ...payload }`; `{ push: 'idle' }` as `{ type: 'dl-sw-idle' }`; Task 3.12 adds `{ push: 'save', payload }`. A `sendMessage` that fails because nobody listens is ignored.
- Produces `protocol.ts`, the exact messages between the offscreen main thread and the engine Worker (Tasks 3.7, 3.10 and 3.12 all use these names):
  ```ts
  import type { StateChange } from '@apps-hub/sieve-core/src/dl-engine.ts';   // type only
  export type WorkerCommand = 'config' | 'add' | 'do' | 'tick' | 'save-event';
  export interface WorkerRequest { id: number; cmd: WorkerCommand; payload: unknown }          // main thread to Worker; payload: DownloadSettings, AddItem[], { op: DoOp; ids: string[] }, undefined, SaveEvent
  export type WorkerMessage =                                                                  // Worker to main thread
    | { reply: number; result: unknown }                                                       // the answer to the request with that id; `{ error: string }` when the command threw
    | { push: 'state'; payload: StateChange }
    | { push: 'idle' }
    | { push: 'save'; req: number; payload: { id: string; name: string; path: string; size: number | null } };
  export interface SaveReply { saveReply: number; result: { ok: true } | { ok: false; message: string } }   // main thread to Worker, the answer to a `save` push with that req
  ```
- Produces the stub `engine-worker.ts`: answers `config` with `{ ok: true }` after a short delay (standing in for `start()`), `add` with `{ ids: items.map((_, i) => 'stub' + i) }`, and every other command with `{ ok: true }`. Task 3.10 replaces its body.
- Produces `build-dl.mjs`: `export async function buildDownloads({ out, root, ui }): Promise<void>` runs esbuild (bundle, target `chrome128`, `logLevel: 'warning'`) for `src/offscreen/offscreen.ts` and `src/offscreen/engine-worker.ts` as classic IIFE scripts into `out`, for `src/dl/list.ts` as an ES module to `out/downloads.js` when that file exists, and copies `src/offscreen/offscreen.html`, and when they exist `src/dl/list.html` to `out/downloads.html` and `src/dl/list.css` to `out/downloads.css`.
- Produces the e2e runner `test/dl/e2e.mjs`: `export async function run(ctxIn?: { servers?: unknown }): Promise<void>` and, when the file is the process entry, runs and exits with code 1 if any check failed. Flags: `--only a,b` (module names without `.mjs`), `--big`. It starts the harness browser with `launch()` from `test/harness.mjs`, imports `test/dl/_fixture.mjs` when it exists (Task 3.10), then runs each module's `run(t)` in name order. A module that throws is one failed check named after the module. `t = { ctx, sw, id, fx, check, errors, shots, big, only }`: `fx` is the fixture server (`null` until Task 3.10), `check` is the harness `check`, `errors` collects page errors, `shots` is `process.env.SHOTS ?? tmpdir()`.
- Produces `test/dl/_helpers.mjs`:
  ```js
  export async function extPage(t, file = 'options.html')          // a new page at chrome-extension://<id>/<file>; its page errors go to t.errors
  export async function sendMsg(t, message)                         // chrome.runtime.sendMessage from an extension page, resolves with the reply
  export async function engineCount(t)                              // getContexts OFFSCREEN_DOCUMENT length, evaluated in the worker
  export async function readRecords(t)                              // all `records` from IndexedDB sieve-dl, read in an extension page ([] when the database does not exist)
  export async function setDownloads(t, patch)                      // validateDownloadSettings({ ...current, ...patch }) imported from core by path, then chrome.storage.local.set
  export async function resetDl(t)                                  // closes the engine, deletes IndexedDB sieve-dl (every connection closes on `versionchange`, Task 3.10, so the delete does not hang) and every OPFS entry, removes the `downloads` key and every `dl*` session key, then waits until engineCount is 0
  export async function readPart(t, name)                           // in an extension page: opens the OPFS file `name`, returns { size, ok } where ok compares every byte with the fixture pattern (byte i is i % 251) in 1 MiB slices; { size: -1, ok: false } when the file does not exist
  export async function readMeta(t, key)                            // the value stored under `key` in the `meta` object store of sieve-dl, read in an extension page
  export async function opfsNames(t)                                // the names in the OPFS root
  export async function localGet(t, keyOrNull)                      // chrome.storage.local.get through the worker (null reads everything)
  export async function sessionGet(t, keyOrNull)                    // chrome.storage.session.get through the worker; a test finds `dlSave:*` and `dlRetry:*` entries by filtering the keys of get(null) on a prefix
  export async function until(fn, ms = 10000)                       // polls every 50 ms, throws with the last value on timeout
  ```

- [ ] **Step 0: Contract commit (first, before any implementation).** By pathspec, message `Sieve Phase 3 3.7: contract`. Files: `apps/sieve/src/dl/settings-store.ts`, `engine-link.ts`, `router.ts`, `background-dl.ts`, `save.ts`, `takeover.ts`, `menus.ts`, `build-dl.mjs`, `apps/sieve/src/offscreen/protocol.ts` (the Worker message types, real), `test/dl/_helpers.mjs`, `__tests__/dl-engine-link.test.ts`. Types, interfaces and message shapes are written exactly as in this task's Interfaces; plain data (constants, lists, message-type names) is real; every function body is `throw new Error('not implemented')`; each test file holds one `test.todo('<name>')` per case listed in this task's test steps. Real: `ENGINE_PAGE`, the `dl-eng-*` and `dl-sw-*` message-type constants as listed in "Runtime messages", `protocol.ts`, and the empty `init…()` functions of `save.ts`, `takeover.ts`, `menus.ts`. The shared files (`manifest.json`, `build.mjs`, `background.ts`, `test/e2e.mjs`, `apps/sieve/package.json`) are not touched by the contract commit. Send `[CONTRACT] 3.7: <sha, files, exported names>` to the controller as soon as it lands; do not list the test files in `package.json` (the controller does). Then continue with Step 1.
- [ ] **Step 1: Re-run the platform probes and record the facts.** Run `node .superpowers/phase-3/scratch/probes/p1.mjs` and `p9.mjs` from the worktree. Expected: facts F1 to F5, F7, F8 and the alarm line of F15 hold (offscreen has `chrome.runtime` only; Worker with OPFS sync handle and IndexedDB; `getContexts` lists the document; a second `createDocument` fails with the text above). Put a header comment at the top of `offscreen.ts` listing them as `// inspected <date>, Chrome for Testing <version>`, with the date and version the probe prints (`Google Chrome for Testing --version`). If a fact no longer holds, stop and report BLOCKED with the output: the architecture depends on F1, F3, F5 and F7.
- [ ] **Step 2: Write the failing `dl-engine-link.test.ts`** with an in-memory `chrome` (as `pick-handler.test.ts` builds one).
  - `ensureEngine` called five times at once calls `offscreen.createDocument` once, with the parameters above; when `getContexts` already lists a document it calls it zero times; a `createDocument` that rejects with "Only a single offscreen document may be created." does not throw.
  - `sendToEngine` retries (and calls `ensureEngine` again each time): a `sendMessage` that rejects twice with "Could not establish connection. Receiving end does not exist." and then answers returns the answer after 3 calls; ten rejections reject; a different error rejects at once; "message port closed before a response was received" is retried for an `dl-eng-add` whose items all have a `chromeId` and rejects at once for `dl-eng-do` and for an `dl-eng-add` containing an item without `chromeId` (`addRecords` then returns `null`).
  - `addRecords` returns `null` when `sendToEngine` rejects.
  - `fromExtensionPage({ url: 'chrome-extension://sieve/options.html' })` is true with `getURL('')` returning `chrome-extension://sieve/`; a `https://example.com/` sender, a sender with no `url` and a sender with `url: 'chrome-extension://other/x.html'` are false.
  - `saveDownloads`: two concurrent edits (one sets `parts`, one sets `speedLimit.on`) with slow `get` and `set` both land; a failing `set` resolves `false`; `readDownloads` on garbage gives `DEFAULT_DOWNLOADS`; `getDownloads` returns the cached copy until an `onChanged` for `downloads` arrives, then re-reads.
  - The router's `dl-add` and `dl-do` validation (import `router.ts` per test with a fresh copy): a message from a `https://example.com/` sender is ignored (returns `false`); `items: []`, `items` of 501, a `ftp://` URL, `source: 'takeover'` and a `probed` field each reply `{ ok: false, message: T.addFailed }`; a valid add replies `{ ok: true, ids: ['x'] }` when the fake `sendMessage` answers `{ ids: ['x'] }`; `dl-do` with `op: 'delete'` replies `{ ok: false, message: T.actionFailed }`; an item with `category: 'nope'`, `queue` of 25 characters or `chromeId` is refused; `dl-sw-ready` replies the validated settings; an unknown `type` returns `false`.
- [ ] **Step 3: Write `test/dl/boot.mjs` (failing).** Module contract `export async function run(t)`.
  - **Manifest:** `dist/manifest.json` permissions equal, in this exact sorted order, `alarms`, `contextMenus`, `declarativeNetRequest`, `declarativeNetRequestFeedback`, `downloads`, `offscreen`, `scripting`, `storage`, `unlimitedStorage`, `webNavigation`, and `content_scripts` still has exactly the two entries Phase 1 shipped.
  - **No engine at rest:** after `resetDl(t)`, `engineCount(t)` is 0.
  - **Created on demand:** `sendMsg(t, { type: 'dl-do', op: 'pause', ids: [] })` replies `{ ok: true }` and `engineCount(t)` becomes 1.
  - **Handshake:** `sendMsg(t, { type: 'dl-sw-ready' })` replies `{ settings }` where `settings` deep-equals `DEFAULT_DOWNLOADS`; after `await setDownloads(t, { parts: 3 })` it replies `parts: 3` (the worker reads storage afresh, so no polling is needed; if the check still races, wrap it in `until`).
  - **A command right after a restart:** `closeDocument()` and then, at once, `dl-add` of one valid URL: the reply is `{ ok: true, ids }` with one id (the relay holds the command until the engine has started).
  - **Engine hears the worker:** `sendMsg(t, { type: 'dl-eng-config', settings: DEFAULT_DOWNLOADS })` replies `{ ok: true }`.
  - **Worker death does not touch the engine:** `stopWorker(t.ctx)` from the harness reports `'stopped'`, `engineCount(t)` is still 1, and a new `dl-do` message wakes the worker and replies `{ ok: true }`.
  - **Engine death is repaired:** `t.sw.evaluate(() => chrome.offscreen.closeDocument())` then `engineCount(t)` is 0, and the next `dl-do` makes it 1 again.
  - **Validation:** `dl-add` with `{ items: [{ url: 'ftp://x/y', source: 'manual' }] }` replies `{ ok: false }` and creates no engine; `{ category: 'nope' }` and `{ source: 'takeover' }` items are refused the same way.
- [ ] **Step 4: Run, implement, and run again.** Run `node --test apps/sieve/src/__tests__/dl-engine-link.test.ts` (expected: FAIL, then PASS).
- [ ] **Step 5: Wire the shared files** in one short window, appended lines only, and build.
  - `manifest.json`: replace the `permissions` line with the sorted list from Step 3. (Phase 2 also edits this line; the resolved merge is the sorted union, see "Merge notes".)
  - `build.mjs`: after the `import { COMMON_SUFFIXES, GOOGLE_SUFFIXES } …` line add `import { buildDownloads } from './src/dl/build-dl.mjs';`; just before the line `const ui = root('../../packages/ui');` add `await buildDownloads({ out, root, ui: root('../../packages/ui') });`.
  - `background.ts`: add `import { initDownloads } from './dl/background-dl.ts';` after the last import and `initDownloads();` as the last line.
  - `test/e2e.mjs`: after the line `for (const m of ['./ai-injection.mjs', './my-filters-regex.mjs']) await (await import(m)).run({ servers });` add `await (await import('./dl/e2e.mjs')).run({ servers });`.
  - `apps/sieve/package.json`: add the script `"test:dl": "node test/dl/e2e.mjs"` after `test:e2e`.
- [ ] **Step 6: Run the gates.** Run `pnpm --filter sieve typecheck && pnpm --filter sieve build && node apps/sieve/test/dl/e2e.mjs --only boot && pnpm --filter sieve test:e2e`. Expected: PASS, and Phase 1's checks still pass (the dl runner runs last).
- [ ] **Re-sync with upstream (the last step before the commit).** Re-read, at the current HEAD, the upstream files named in this task's "Builds against" line; rerun this task's tests against the real implementations (not the contract stubs); fix every mismatch. If an upstream implementation has not landed, send `[BLOCKED]` to the controller and end the turn. A difference from the published contract is a `[CONTRACT-CHANGE]` question to the controller, never a silent choice.
- [ ] **Step 7: Commit** by pathspec with the message `Sieve: downloads wiring, engine link and offscreen host`. Report the test file name for the test-list batch.

### Task 3.8: Engine core with ports (core)

**Files:**
- Create: `packages/sieve-core/src/dl-engine.ts`, `packages/sieve-core/src/__tests__/dl-engine.test.ts`, `packages/sieve-core/src/__tests__/dl-engine-fakes.ts` (fakes only, no tests; not added to the test list)

**Parallel:** first run: dispatched together with Tasks 3.1 to 3.7, 3.9 and 3.10. **Built against:** Task 3.1 (`newRecord`, `newId`, `applyEvent`, `bytesDone`, `isComplete`, `ERRORS`, `partName`, `CATEGORY_IDS`; types `DlRecord`, `AddItem`, `DoOp`, `SaveEvent`, `DownloadSettings`; ports `Store`, `Files`, `Clock`, `Transfer`, `TransferHooks`, `TransferResult`), Task 3.3 (`makeMeter(now, windowMs?)`, `addBytes(m, n, now)`, `rate(m, now)`, type `Meter`), Task 3.4 (`schedulePlan(records, queues, at, on)`), Task 3.5 (`sanitizeFileName`, `chooseName`, `categoryOf`, `SPACE_MARGIN`). **Consumed by:** Task 3.10 (`createEngine`, `Engine`, `EngineDeps`, `Host`, `StateChange`), Task 3.12 (`Host.save` semantics, `SaveEvent`), Task 3.13 (`add` replay rule), Tasks 3.11 and 3.15 to 3.17 (the `StateChange` shape of `dl-state`). **Waits for:** it may write `dl-engine-fakes.ts`, the tests and `dl-engine.ts` against the contract commits of 3.1, 3.3, 3.4 and 3.5 before their implementations exist; running the tests (the engine calls their functions) and its pathspec commit wait for the implementation commits of 3.1, 3.3, 3.4 and 3.5. Shared files: none.

**Interfaces:**
- Produces:
  ```ts
  import type { AddItem, DlRecord, DoOp, SaveEvent } from './dl-record.ts';   // and `partName` from the same file
  import type { Clock, Files, Store, Transfer } from './dl-ports.ts';
  import type { DownloadSettings } from './dl-settings.ts';   // `SPACE_MARGIN` comes from dl-takeover.ts (Task 3.5)
  export const IDLE_MS = 60_000;          // nothing to do for this long: ask the worker to close the document
  export const EMIT_MS = 250;             // at most four state broadcasts a second
  export interface StateChange { records: DlRecord[]; removed: string[]; speeds: Record<string, number>; total: number }
  export interface Host {
    emit(change: StateChange): void;
    save(r: DlRecord): Promise<{ ok: true } | { ok: false; message: string }>;   // hand the finished private copy to the worker (Task 3.12); ok means "Chrome has been asked"
    idle(): void;
  }
  export interface EngineDeps { store: Store; files: Files; transfer: Transfer; clock: Clock; host: Host; random(): number }
  export interface Engine {
    start(settings: DownloadSettings): Promise<void>;
    config(settings: DownloadSettings): void;
    add(items: AddItem[]): Promise<{ ids: string[] }>;     // resolves after every new record is persisted
    act(op: DoOp, ids: string[]): Promise<void>;
    saveEvent(e: SaveEvent): Promise<void>;
    tick(): void;                                          // re-evaluate queue windows now
    stop(): Promise<void>;                                 // abort transfers without changing any record (for tests and shutdown)
    records(): DlRecord[];
  }
  export function createEngine(deps: EngineDeps): Engine;
  ```
- **`add(items)`**, per item, in order: skip it when `url` does not parse as `http:` or `https:`. `name` is `item.probed.name` when probed, else `sanitizeFileName(item.name)` when a name was given (never trusted as is), else `chooseName({ disposition: null, url: item.url, mime: '' })`. `category = item.category` when it is one of `CATEGORY_IDS` (and `categoryFixed` true; an unknown value is ignored) else `categoryOf(name, item.probed?.mime ?? '', settings.categories)`. `queue = item.queue` when it is a configured queue id, else `settings.queues[0].id`. `partsWanted = settings.parts`. `probed` fills `finalUrl`, `size`, `mime`, `validator` and sets `rangeOk` true. `chromeId` is kept. **A take-over item (`source: 'takeover'`) makes a record with `force: true`**, so a closed queue window or a full queue cannot park a download Chrome has already cancelled. **Replay is safe:** when `item.chromeId` is set and a record already has that `chromeId` **and** the same `url` **and** a `state` other than `done`, the item adds nothing and its id in the result is that record's id (the take-over may be repeated after a worker death, Task 3.13; Chrome can reuse a download id, so a stale finished record with the same `chromeId` must never match). The id is `newId(clock.now() + k, random)` with `k` starting at 0 and incremented on every collision, until the id is unused in memory and in the batch being added (a constant `random` with a frozen clock must still terminate and give distinct ids; the `/^d[a-z0-9]{16,}$/` shape still holds because `now` only changes the leading digits). Each record is put in the store (awaited; `store.put(record, { strict: true })` for a take-over record, here and for every later put of it, so the acknowledgement that lets the worker cancel Chrome's download is durable), then added in memory, then the engine reconciles. The result lists the ids, in order, one per item that was accepted or matched.
- **Serialisation.** `add`, `act`, `saveEvent`, `config`, `tick`, `reconcile` and the settle handlers of finished transfers all run through one promise queue, one after another, so none interleaves with another across an `await`. A queued task never waits for a task queued behind it: the engine keeps a map `runs` from record id to `{ controller, finished: Promise }` where `finished` is the promise of the transfer's own `run` call (resolved when the transfer returns, before its settle handler is queued); `reconcile` enqueues settle handlers and never awaits them. `startRecord` also re-reads `records.get(id)` after every `await` it makes (the space check, the store write) and returns unless the record still exists and is still `queued`; a `remove` or `pause` issued while a start was waiting therefore wins.
- **`reconcile()`**: `plan = schedulePlan(records, settings.queues, new Date(clock.now()), settings.on)`. For each id in `plan.stop`: abort its transfer with reason `'stop'`. For each id in `plan.start`: `startRecord(id)`.
- **`startRecord`**: if `r.size` is known, ask `files.space()`; when `quota - usage < (size - bytesDone(r)) + SPACE_MARGIN`, apply `fail` with `ERRORS.space` (legal from `queued`, Task 3.1's table), persist, emit, and do not run the transfer; the record then stays `failed` until the owner presses Resume, so the check cannot loop. Otherwise apply `start`, persist, create an `AbortController`, and call `transfer.run(record, signal, hooks)` (not awaited by `reconcile`). The hooks: `persist` replaces the in-memory record and `store.put`s it; `update` replaces the in-memory record and marks it dirty; `bytes(n)` feeds the record's `Meter` (Task 3.3) and the total meter. When the run settles:
  - `done`: check `isComplete(record)` (every part's `done` equals its length; the file is pre-sized and sparse, so this is the real completeness test); when it fails, apply `fail` with `ERRORS.length` and persist, nothing else. Otherwise apply `partsDone`, persist, then `host.save(record)`; `{ ok: false, message }` applies `saveFailed` with `ERRORS.save(message)`.
  - `paused`: if the abort reason was `'pause'`, apply `pause`; `'stop'`, apply `stop`; `'remove'`, nothing (the removal finishes it); `'shutdown'` (from `stop()`), leave the stored record as it was while running.
  - `failed`: apply `fail` with the transfer's error (the record from the transfer carries parts progress), persist.
  - A thrown error from the transfer applies `fail` with `ERRORS.unknown` and logs it.
  After any settle, reconcile again.
- **`act(op, ids)`**: `pause`: a `running` record is aborted with reason `'pause'`; a `queued` one gets the `pause` event; others are ignored. `resume`: `paused` and `failed` records get `resume` (it chooses `queued` or `saving`); a `queued` record gets `force: true` (the event table has no queued-resume, so the engine sets the flag itself); when the result is `saving` the engine calls `host.save`; then reconcile. `remove`: abort a running transfer (reason `'remove'`) and `await runs.get(id).finished` (the transfer's own promise, never the queued settle handler, which would be behind `remove` in the queue and deadlock it); the settle handler for reason `'remove'` does nothing; then `files.remove(partName(id))`; `store.delete(id)`; drop it from memory; the next emit lists the id in `removed`. Unknown ids are ignored.
- **`start(settings)`** resolves after the records are loaded, the restarts persisted, the sweep done and the first `reconcile` has been queued (the Worker answers its first `config` with that, Task 3.10): stores the settings, passes them to `transfer.config`, loads `store.all()`, applies `restart` to every `running` record (so it becomes `queued`; `force` kept) and persists the changed ones, calls `host.save` again for every `saving` record (fired without awaiting it, so a slow save cannot delay the first `config` reply and trip the relay's 20 s timeout), removes the part file of every `done` record, and sweeps orphans: every name from `files.list()` that matches `/^d[a-z0-9]+\.part$/` and whose id has no record is removed (names that do not match are never touched, and a part file with a record never is). Then it starts the emit timer (`clock.every(EMIT_MS, …)`) and reconciles.
- **`config(settings)`**: stores them, `transfer.config(settings)`, reconcile. With `on` false, `schedulePlan` stops every non-forced running record and starts only forced ones.
- **`saveEvent(e)`**: `path`: set `savedPath` and `savedId`, persist (state stays `saving`). `done`: set both, apply `saved`, persist, `files.remove(partName(id))`. `failed`: apply `saveFailed` with `ERRORS.saveCanceled` when `e.error === 'USER_CANCELED'`, else `ERRORS.save(e.error)`; persist. Unknown ids are ignored. Every change marks the record dirty.
- **Emit**: dirty records and removed ids collect; every `EMIT_MS` the engine calls `host.emit({ records, removed, speeds, total })` when anything is dirty or any speed is non-zero, with `speeds[id]` from each running record's `rate()` and `total` their sum (a speed of 0 is left out of the map). Records are copied, not shared.
- **Idle**: after each reconcile, if no record is `running` or `saving` and `plan.start` is empty, an idle timer of `IDLE_MS` is armed (one at a time); when it fires and the state is still idle, `host.idle()` is called once. Any start, add, resume or save cancels it. A `queued` record in a closed window does not keep the engine awake; the worker's alarm wakes it (Task 3.11).

- [ ] **Step 0: Contract commit (first, before any implementation).** By pathspec, message `Sieve Phase 3 3.8: contract`. Files: `packages/sieve-core/src/dl-engine.ts`, `__tests__/dl-engine.test.ts`. Types, interfaces and message shapes are written exactly as in this task's Interfaces; plain data (constants, lists, message-type names) is real; every function body is `throw new Error('not implemented')`; each test file holds one `test.todo('<name>')` per case listed in this task's test steps. `IDLE_MS`, `EMIT_MS` and every exported type (`StateChange`, `Host`, `EngineDeps`, `Engine`) are real; `createEngine` is the stub. Send `[CONTRACT] 3.8: <sha, files, exported names>` to the controller as soon as it lands; do not list the test files in `package.json` (the controller does). Then continue with Step 1.
- [ ] **Step 1: Write `dl-engine-fakes.ts`** (no tests): an in-memory `Store`, an in-memory `Files` (a `Map` of names to `Uint8Array`s, `space()` settable), a manual `Clock` (`advance(ms)` fires `every` callbacks and resolves due `sleep`s), a scripted `Transfer` (`run` returns a promise the test resolves with `done`, `paused`, `failed`, or that resolves `paused` when the signal aborts; it records the records it was given and the abort reason), and a recording `Host`.
- [ ] **Step 2: Write the failing `dl-engine.test.ts`.**
  - **Add:** a manual add of `https://example.com/files/App.dmg` creates a `queued` record with `name` `'App.dmg'`, `category` `'programs'`, the first queue, `partsWanted` equal to the settings' `parts`, `source` `'manual'`, persisted before `add` resolves (the fake store's `put` is slow and `add` waits for it); a `probed` take-over item fills `finalUrl`, `size`, `mime`, `validator`, `rangeOk` true, `chromeId`; an `ftp://` URL is skipped (no id); a given `name` of `'../x<y>.zip'` is stored as `'x_y_.zip'`; a `category` given by the caller sets `categoryFixed`; an unknown `queue` falls back to the first; an unknown `category` (`'nope'`) is ignored (automatic); a take-over item makes a record with `force: true`.
  - **Ids:** 500 items added at once with `random` fixed to a constant and a frozen clock give 500 distinct ids, matching `/^d[a-z0-9]{16,}$/`, and the test terminates (it must not hang in the redraw loop); the batch is persisted in full.
  - **Replay:** adding the same take-over item (same `chromeId` and `url`) twice gives the same id and one record; with the first record already `running`, nothing changes. A stale `done` record carrying the same `chromeId` does not match (a new record is made), and neither does a live record with the same `chromeId` but another `url`.
  - **Start and slots:** three queued records with `maxParallel` 2 run two transfers; when one resolves `done` the third starts; `config` with `maxParallel` 3 starts the third at once.
  - **`on` false:** nothing starts; `act('resume', [id])` on a queued record starts it (forced) even with `on` false; `config` with `on: false` while a non-forced record runs aborts it with reason `'stop'` and the record ends `queued`; a forced running record keeps running.
  - **Pause and resume:** `pause` on a running record aborts with reason `'pause'` and the record ends `paused` and persisted, freeing its slot for the next queued one; `resume` makes it `queued` with `force` true and it starts even when its queue's window is closed.
  - **Remove with the real queue:** removing a running download completes (the test awaits `act('remove', [id])` with a transfer fake that settles only when its signal aborts, and fails by timeout if the queue deadlocks), the record, part file and `runs` entry are gone, and a later `reconcile` does not restart it.
  - **Remove:** removing a running record aborts it, deletes `<id>.part`, deletes the record, and the next emit lists the id in `removed`; removing a `done` record deletes it and its part file if present; unknown ids are ignored.
  - **Finishing:** a transfer resolving `done` leaves the record `saving` with `saveOnly` true and calls `host.save` once; `host.save` answering `{ ok: false, message: 'FILE_NO_SPACE' }` makes it `failed` with `ERRORS.save('FILE_NO_SPACE')` and `saveOnly` true; `saveEvent` `path` sets `savedPath` and `savedId` and keeps `saving`; `done` ends `done`, sets `finishedAt` and removes `<id>.part`; `failed` with `'USER_CANCELED'` gives `ERRORS.saveCanceled`; `resume` on that record goes to `saving` and calls `host.save` again (the transfer is not run again).
  - **Completeness:** a transfer resolving `done` whose record has a part with `done` below its length fails the record with `ERRORS.length` and never calls `host.save`.
  - **Transfer failure:** `failed` from the transfer leaves the record `failed` with that error and its parts progress persisted.
  - **Start-up:** `start()` with `on: false` and stored records `running` (not forced), `running` (forced), `saving`, `done` with a leftover `.part`, plus `.part` files `dorphan.part` (no record), `notes.txt` (no match) and the part of a live record: the first two become `queued` (only the forced one starts at once; with `on: true` and free slots the non-forced one would start too, which a second case checks), the `saving` one triggers `host.save`, the done record's part is removed, `dorphan.part` is removed, `notes.txt` and the live part stay.
  - **Space:** size 1,000,000,000 with `quota - usage` 1,040,000,000 (below `size + SPACE_MARGIN`) fails the record with `ERRORS.space` and never calls `transfer.run`; with 1,060,000,000 it runs; a partly done record only needs its remaining bytes.
  - **Emit:** 100 `update` hooks inside one `EMIT_MS` window give one `host.emit` containing each changed record once; `bytes` hooks produce `speeds` that match the meter; the emitted records are copies.
  - **Idle:** after the last record finishes and 60 s pass, `host.idle` is called once; starting a record at 59 s cancels it; a `queued` record whose queue window is closed does not prevent it.
  - **Stop:** `stop()` aborts transfers with reason `'shutdown'` and the stored records stay `running`; a second `start()` on the same store then queues them again.
  - **Serialisation:** `add`, `act('resume')` and `config` called in the same tick start a record exactly once; with a slow fake `space()`, a `remove` or a `pause` issued while a start waits on it means the record is not started and no transfer runs; `saveEvent` and `act` issued in the same tick apply in call order.
  - **Space failure:** a record that fails the space check ends `failed` with `ERRORS.space` (it does not stay `queued` and does not loop); `resume` on it runs the check again.
- [ ] **Step 3: Run, implement, and run again.** Run `node --test packages/sieve-core/src/__tests__/dl-engine.test.ts`, then a throwaway typecheck of only this task's files (`tsc --noEmit -p <a tsconfig in the scratchpad that extends `packages/sieve-core/tsconfig.json` and lists only this task's source and test files>`; the package-wide typecheck sees other agents' half-written files, so the controller runs it after each wave; when Task 3.1's files already exist, include them in that tsconfig, and when they do not yet exist the `import type` lines cannot resolve (TS2307), so record the typecheck as deferred to the controller's post-wave package typecheck and commit anyway). Expected: FAIL, then PASS.
- [ ] **Re-sync with upstream (the last step before the commit).** Re-read, at the current HEAD, the upstream files named in this task's "Builds against" line; rerun this task's tests against the real implementations (not the contract stubs); fix every mismatch. If an upstream implementation has not landed, send `[BLOCKED]` to the controller and end the turn. A difference from the published contract is a `[CONTRACT-CHANGE]` question to the controller, never a silent choice.
- [ ] **Step 4: Commit** by pathspec with the message `Sieve core: download engine with ports`. Report the test file name (not the fakes file).

### Task 3.9: Transfer: probe, parts, resume, refusals (core)

**Files:**
- Create: `packages/sieve-core/src/dl-transfer.ts`, `packages/sieve-core/src/__tests__/dl-transfer.test.ts`, `packages/sieve-core/src/__tests__/dl-transfer-fakes.ts` (fakes only, not in the test list)

**Parallel:** first run: dispatched together with Tasks 3.1 to 3.8 and 3.10. **Built against:** Task 3.1 (ports `Net`, `NetResponse`, `Files`, `FileHandle`, `Store`, `Clock`, `Transfer`, `TransferHooks`, `TransferResult`; `ERRORS`, `partName`, `isComplete`; types `DlRecord`, `PartRecord`, `DownloadSettings`), Task 3.2 (`planParts`, `resplit`, `nextToStart`, `capFor`, `onRefused`, `backoffMs`, `parseRetryAfter`, `hostOf`, `HOST_MAX`, `MAX_ATTEMPTS`, `GIVE_UP_MS`, `STALL_MS`, `HostCaps`), Task 3.3 (`makeBucket`, `take`, `setRate`), Task 3.5 (`ProbeFacts`, `factsFromResponse`, `factsFromError`, `parseRangeTotal`, `normaliseMime`, `validatorOf`, `chooseName`, `categoryOf`). **Consumed by:** Task 3.10 (`createTransfer`, `TransferDeps`), Task 3.13 (`PROBE_TIMEOUT_MS`, `probe`'s behaviour for the probe rules). **Waits for:** it may write `dl-transfer-fakes.ts`, the tests and `dl-transfer.ts` against the contract commits of 3.1, 3.2, 3.3 and 3.5; running the tests and its pathspec commit wait for the implementation commits of those four tasks. Shared files: none.

**Interfaces:**
- Produces:
  ```ts
  import type { Files, Net, Store, Clock, Transfer } from './dl-ports.ts';
  import type { ProbeFacts } from './dl-takeover.ts';
  export const CHECKPOINT_BYTES = 4_194_304;     // persist a checkpoint after this many bytes
  export const CHECKPOINT_MS = 2000;             // or after this long, whichever comes first
  export const PROBE_TIMEOUT_MS = 8000;
  export interface TransferDeps { net: Net; files: Files; store: Store; clock: Clock }
  export function createTransfer(deps: TransferDeps): Transfer;
  export function probe(net: Net, url: string, clock: Clock, signal?: AbortSignal): Promise<ProbeFacts>;   // GET with `Range: bytes=0-0`; cancels the body; never throws: a failure is `factsFromError`
  ```
  The `Net` the engine passes in follows redirects and sends cookies (inspected F12) and, through session rules (Task 3.10), the Referer. **Which URL a request uses:** every request, the probe and every part, is made to `record.url`, with redirects followed again each time; `finalUrl` is kept only for display and for the Referer rule. A signed `finalUrl` that expires is therefore never reused; if the origin answers `record.url` with 403 later, the part fails with `ERRORS.status(403)` and the row offers Retry in Chrome.
  One `createTransfer` instance serves every record, and it keeps one `use` map (host to open connections) shared by all of its runs; a connection is opened only while `use[host] < capFor(caps, host, HOST_MAX, now)` (Task 3.2), and a start that must wait polls every 250 ms with `clock.sleep`.
- **The run, in order.** `run(record, signal, hooks)` works on a copy of `record` and returns it in the result:
  1. **Probe**, when `record.size === null && record.parts.length === 0` (a record the take-over did not probe). `probe(net, record.url)`. Then by `facts.status`:
     - 206 with a total: `size` = total, `rangeOk` true, `validator` (strong ETag, else Last-Modified, else null), `mime` normalised, `finalUrl` = `facts.url`. Unless `categoryFixed`, `category` becomes `categoryOf(name, mime, …)` with the settings from the last `config()`; `name` becomes `chooseName({ disposition, url: facts.url, mime })` unless `record.source === 'takeover'`.
     - 200: `rangeOk` false, `size` = the `Content-Length` number or `null`, `mime`, `finalUrl`, `name` and `category` as above.
     - 429 or 503: the refusal path below (the connection count is 1).
     - 401, 403, 404, 410 and any other 4xx: fail at once with `ERRORS.status(code)`; no retry.
     - another 5xx: retry with `backoffMs(attempt)` until `GIVE_UP_MS` pass with no success (any received byte or 206 resets it), then fail with `ERRORS.network`.
     - `error` set (the fetch threw, timed out after `PROBE_TIMEOUT_MS`, or was refused by the browser; for a gzip answer to a ranged request this is deterministic, inspected F17): three attempts in all, sleeping 2000 and 4000 ms between them, then fail with `ERRORS.probe` (not `ERRORS.network`: waiting or reconnecting will not help, the next step is Retry in Chrome).
  2. **Plan.** When `record.parts` is empty: if `rangeOk` and `size` is known, `n = capFor(caps, hostOf(finalUrl), partsWanted, now)` and `parts = planParts(size, n)`; otherwise one part `{ start: 0, end: size === null ? null : size - 1, done: 0 }`. `caps` come from `store.getMeta('hostCaps')`. Existing parts (a resume) are kept; but when `rangeOk` is false the progress is reset: every `done` becomes 0 (a server that cannot resume restarts from the start, and the list says so).
  3. **File.** `handle = await files.open(partName(record.id), size)` (from `dl-record.ts`). A part file longer than `size` is cut to `size`.
  4. **Connections.** `allowed = rangeOk ? capFor(caps, host, record.partsWanted, now) : 1`. Loop: while `active.length < allowed`, start `nextToStart(parts, active)`; when there is none and `allowed > 1`, try `resplit(parts, active)` and start the added part; then wait for any active part to settle. A part that completes frees its slot, which the loop fills the same way (this is the re-splitting of the design). Stop when every part is complete.
  5. **A part's request.** Range `bytes=<start + done>-<end>` (`bytes=<start + done>-` when `end` is null); no `Range` header when `!rangeOk`. `ifRange` is the validator when there is one and the download is ranged. Handle the response:
     - 206: the `Content-Range` start must equal the requested offset, else fail `ERRORS.length`; its total must equal `record.size` (`parseRangeTotal`), else fail `ERRORS.changed`; when the record has a validator and the response carries an ETag or Last-Modified (`validatorOf` on the response headers), it must equal the validator, else fail `ERRORS.changed`. A file replaced by another of the same size and no validator cannot be detected (a known limit for the README).
     - 200 to a ranged request (`rangeOk` true): the representation changed, fail `ERRORS.changed`. 200 when `!rangeOk`: fine, a full body. 416: fail `ERRORS.changed`.
     - 429 or 503: increment `refusals`; call `onRefused(caps, host, use[host], now)` with the count that still includes this refused connection, and save the result with `store.setMeta('hostCaps', …)`; **then release the slot** (`use[host]` down by one); then sleep `backoffMs(refusals, parseRetryAfter(retry-after header, now))` with `clock.sleep(…, signal)`; then wait for a slot: the part retries from its saved offset when `use[host] < capFor(caps, host, HOST_MAX, now)` (polling every 250 ms; this wait is not a failure and does not run the 15-minute clock). With one connection a 429 gives cap `max(1, floor(1 / 2))` = 1, the slot is released, so the retry finds `use[host]` 0 below 1 and goes ahead (it must not wait for a count that can never be reached). The fifth consecutive 429 or 503 (`refusals` 5) fails the download with `ERRORS.refused` (sleeps 2, 4, 8, 16 s before it). `activeConnections` is `use[host]`, the host-wide count (Task 3.2).
     - 401, 403, 404, 410 and other 4xx: fail with `ERRORS.status(code)`.
     - other 5xx, a thrown fetch, a stream that ends before the part's `end`, or a stall (no byte for `STALL_MS`; time slept for the speed limit does not count; the part aborts its own request and retries): retry from the saved offset after `backoffMs(attempt)` (at most 30 s; `attempt` is incremented per failure, and `refusals` is reset to 0 by any outcome that is not a 429 or 503) until `GIVE_UP_MS` (15 minutes) pass with no byte received, then fail with `ERRORS.network`. Any received byte resets `attempt`, `refusals` and the 15-minute clock. A 30 s outage therefore never fails a download. (The real clock's `sleep` also ends early when the browser fires `online`, Task 3.10.)
  6. **Reading.** The stall timer wraps only `reader.read()`: `Promise.race([reader.read(), clock.sleep(STALL_MS, stallSignal)])`, and the sleep is aborted as soon as the read wins; draining the chunk through the bucket (below) is outside the race, so time slept for the speed limit never counts as a stall. For each chunk from the body reader: cut it to the part's current `end` (read it fresh from the record each time, because a re-split can shorten it; when the offset reaches `end + 1`, cancel the reader and finish the part); drain it through the shared bucket (rule in Task 3.3, `clock` for sleeping); `handle.write(chunk, start + done)`; `done += chunk.length`; `hooks.bytes(chunk.length)`; `hooks.update(record)`. After `CHECKPOINT_BYTES` written or `CHECKPOINT_MS` of `clock.now()` since the last checkpoint: `handle.flush()`, then `await hooks.persist(record)`, in that order. At most one chunk per active part is held in memory; no chunk handed to `write` exceeds the chunk the stream produced.
  7. **Finishing.** All parts complete (the real completeness check is `isComplete(record)`: every part's `done` equals its length; the file is pre-sized and sparse, so its length alone proves nothing): `flush()`, check `handle.size() >= size` when `size` is known (a sanity check; else `ERRORS.length`), `close()`, persist, return `{ kind: 'done' }`; an unknown `size` is set to the bytes received. On abort (`signal`): cancel every reader, `flush()`, persist, `close()`, return `{ kind: 'paused' }`. On failure: `flush()`, persist, `close()`, return `{ kind: 'failed', error }` with `record.error` set. A `write` that throws: `ERRORS.space` when `files.space()` shows less than 10 MB free, else `ERRORS.storage`.
  8. **Speed limit.** `config(settings)` keeps the settings and calls `setRate` on the one bucket every transfer shares: `Infinity` when `speedLimit.on` is false, else `kbPerSecond * 1000`.

- [ ] **Step 0: Contract commit (first, before any implementation).** By pathspec, message `Sieve Phase 3 3.9: contract`. Files: `packages/sieve-core/src/dl-transfer.ts`, `__tests__/dl-transfer.test.ts`. Types, interfaces and message shapes are written exactly as in this task's Interfaces; plain data (constants, lists, message-type names) is real; every function body is `throw new Error('not implemented')`; each test file holds one `test.todo('<name>')` per case listed in this task's test steps. `CHECKPOINT_BYTES`, `CHECKPOINT_MS`, `PROBE_TIMEOUT_MS` and `TransferDeps` are real; `createTransfer` and `probe` are the stubs. Send `[CONTRACT] 3.9: <sha, files, exported names>` to the controller as soon as it lands; do not list the test files in `package.json` (the controller does). Then continue with Step 1.
- [ ] **Step 1: Write `dl-transfer-fakes.ts`.** An in-memory `Files` whose handle logs `write`, `flush` and `close` calls in order, a fake `Store`, a manual `Clock` with this contract: `sleep(ms, signal)` registers a timer at `now() + ms` in a timer list and returns a promise that resolves when that timer fires or rejects (`AbortError`) when `signal` aborts; virtual time advances only inside `drive(done)`, which loops `while (!finished) { await idle(); if (no timers) throw 'deadlock'; advance to the earliest timer and fire it }` where `idle()` is `await new Promise(setImmediate)` repeated three times (so every ready promise, read and write runs before any timer fires; without this a `sleep` that advances time at once would win every race and abort every read, and a stream that never ends could never reach its stall timer); back-off tests still run instantly because `drive` jumps straight to the next timer; `now()` reflects the virtual time; every test awaits the transfer through `drive`, and a fake server `Net` over a pattern body (byte `i` is `i % 251`) with: `Range` and `If-Range` support, 64 KiB chunks, a per-request script (an array of overrides consumed in order: `{ status }`, `{ failAfter: bytes }` that makes the stream throw, `{ delayMs }`, `{ retryAfter }`), a request log (`url`, `range`, `ifRange`), `ranges: false` mode, a settable ETag, and a total-length-unknown mode.
- [ ] **Step 2: Write the failing `dl-transfer.test.ts`.** Records come from `newRecord`; unless said, `partsWanted` is 1 and the server has a strong ETag.
  1. **Probe, manual add:** a 3 MiB file: the first request has `Range: bytes=0-0`; the record gets `size`, `rangeOk` true, `validator`, `mime`, `name` from the disposition; one ranged request `bytes=0-` with `If-Range`; the file equals the pattern; result `done`.
  2. **Probe, no range (status 200):** `rangeOk` false, `size` from `Content-Length`; the download request has no `Range`; file correct. With `Content-Length` missing, `size` is set to the received bytes at the end.
  3. **Take-over record (already probed, `source: 'takeover'`, `size`, `rangeOk`):** no probe request; `name` unchanged.
  4. **Three parts, 10 MiB:** `partsWanted` 3 gives requests `bytes=0-3495253`, `bytes=3495254-6990506`, `bytes=6990507-10485759` (all with `If-Range`), file correct.
  5. **Re-split:** `partsWanted` 2, 12 MiB, part 1 is slow (`delayMs` per chunk) and part 0 finishes first: a new request starts at `start + done + ceil(remaining / 2)` of part 1, with the part 1 range cut to end one byte before it; never more than 2 requests open at once; the file is correct; the slow part never writes past its shortened `end`.
  6. **429 with four parts:** four parts planned over 20 MiB, the third request answers 429 with `Retry-After: 3`: `store.getMeta('hostCaps')` holds `{ cap: 2 }` for the host; the refused part sleeps at least 3000 ms of virtual time, then retries from its saved offset when fewer than 2 connections are open; the file is correct; a second record on the same host with `partsWanted` 4 plans 2 parts; after `HOST_CAP_TTL_MS` of virtual time it plans 4.
  7. **A 429 on one connection retries:** a single-part download whose second request answers 429 with no `Retry-After` retries after 2000 ms of virtual time and finishes (`use[host]` is released before the sleep, so the slot wait does not deadlock); `hostCaps` holds cap 1.
  7b. **Five 429s in a row** on a single connection fail the record with `ERRORS.refused`; a 429 followed by success resets the counter; a 503 on the probe is retried; the four sleeps before the failure are exactly 2000, 4000, 8000, 16000 (no sleep after the fifth).
  8. **Hard errors:** 403, 404 and 410 on the probe and on a part fail at once with `ERRORS.status(code)` and exactly one request is made; `ERRORS.status(500)`-style codes are not used for 5xx (those retry).
  9. **Dropped connection and outages:** the stream throws after 1 MiB: the next request starts at the byte after the last written byte (the part's `done`), the file is correct. A 90 s outage (every request throws for 90 s of virtual time, then works) does not fail the download: it finishes, with sleeps of 2, 4, 8, 16, 30, 30 s and so on. A download whose requests all throw for 15 minutes plus one retry fails with `ERRORS.network`; a single byte received in between restarts the 15 minutes. A part that fails ten times in a row with a byte received in between each time never fails.
  9b. **Stall:** a stream that stops after 1 MiB and never ends: with every other promise settled, the earliest timer is the stall timer; after `STALL_MS` of virtual time the part aborts its request and starts a new one at the saved offset; the file is correct. With the speed limit on and the bucket sleeping 40 s (outside the read race), the part is not aborted.
  9c. **Probe error:** a probe whose fetch throws three times (as for a gzip answer to a ranged request) fails with `ERRORS.probe`, after sleeps of 2000 and 4000 ms and exactly three requests; it never uses `ERRORS.network`.
  9d. **Host total:** two records on one host with `partsWanted` 6 each open at most 6 connections to that host at once (`HOST_MAX`); after a 429 that sets the cap to 3 no new connection opens while 3 or more are open (connections already open may finish, so the open count can stay above 3 for a moment); a second host is not limited by the first.
  10. **Changed file:** a ranged request answered 200 fails with `ERRORS.changed`; a 416 does too; a `Content-Range` starting at the wrong byte fails with `ERRORS.length`; a `Content-Range` whose total differs from `record.size` fails with `ERRORS.changed` even when the record's validator is `null` (the size changed between runs); a response ETag that differs from the validator fails with `ERRORS.changed`; with a null validator and the same total the download continues.
  11. **No range, restart:** with `rangeOk` false, abort after 1 MiB, run again with the returned record: the second run starts at 0 (every `done` reset), the file is correct.
  12. **Pause and resume:** abort after about 2.5 MiB of a 10 MiB single-part download: result `paused`, the record's `done` is at least the last checkpoint and at most the bytes in the file; the fake file's final write order shows `flush` before each `persist`; running again with that record issues a request whose range starts exactly at the persisted `done` (not 0) and the final file is correct.
  13. **Checkpoints:** with 64 KiB chunks `persist` is called after at least 4,194,304 bytes since the last one; with a slow trickle of small chunks and virtual time advancing, it is called every 2000 ms; each call is preceded by `flush`.
  14. **Speed limit:** `config` with `speedLimit: { on: true, kbPerSecond: 1000 }`: a 5,000,000-byte download takes between 4.5 and 5.0 s of virtual time (burst 250,000, `(5_000_000 - 250_000) / 1_000_000` is 4.75 s); `config` with `on: false` makes the next run take no virtual time.
  15. **Write errors:** a `write` that throws gives `ERRORS.storage`; with `files.space()` reporting 5,000,000 free it gives `ERRORS.space`; in both cases the file handle is closed and the record is persisted.
  16. **Length check:** the server delivers every byte except the last one, and every later request for that last byte ends at once delivering nothing (the last request delivers nothing): the part keeps retrying with back-offs and, because no byte arrives, the 15-minute clock runs; after `GIVE_UP_MS` it fails with `ERRORS.network`; a file shorter than `size` at completion (a fake handle reporting a smaller `size()`) fails with `ERRORS.length`.
  17. **Memory:** no `write` call carries more than 1 MiB, and the fake stream never has more than one unread chunk per active part (the fake counts chunks produced minus chunks read).
- [ ] **Step 3: Run, implement, and run again.** Run `node --test packages/sieve-core/src/__tests__/dl-transfer.test.ts`, then a throwaway typecheck of only this task's files (`tsc --noEmit -p <a tsconfig in the scratchpad that extends `packages/sieve-core/tsconfig.json` and lists only this task's source and test files>`; the package-wide typecheck sees other agents' half-written files, so the controller runs it after each wave; when Task 3.1's files already exist, include them in that tsconfig, and when they do not yet exist the `import type` lines cannot resolve (TS2307), so record the typecheck as deferred to the controller's post-wave package typecheck and commit anyway). Expected: FAIL, then PASS.
- [ ] **Re-sync with upstream (the last step before the commit).** Re-read, at the current HEAD, the upstream files named in this task's "Builds against" line; rerun this task's tests against the real implementations (not the contract stubs); fix every mismatch. If an upstream implementation has not landed, send `[BLOCKED]` to the controller and end the turn. A difference from the published contract is a `[CONTRACT-CHANGE]` question to the controller, never a silent choice.
- [ ] **Step 4: Commit** by pathspec with the message `Sieve core: download transfer with parts, resume and refusals`. Report the test file name.

### Task 3.10: Browser adapters, engine worker and real transfers

**Files:**
- Create: `apps/sieve/src/dl/idb-store.ts`, `apps/sieve/src/offscreen/opfs-files.ts`, `apps/sieve/src/offscreen/sync-access.d.ts`, `apps/sieve/src/dl/net-rules.ts`
- Create: `apps/sieve/src/__tests__/dl-net-rules.test.ts`
- Create: `apps/sieve/test/dl/_fixture.mjs`, `apps/sieve/test/dl/transfer.mjs`
- Modify (files this phase created in Task 3.7 and nobody else edits): `apps/sieve/src/offscreen/engine-worker.ts` (the real engine), `apps/sieve/src/dl/engine-link.ts` (`addRecords` prepares the rules first), `apps/sieve/src/dl/background-dl.ts` (adds `initNetRules()` as the first call)

**Parallel:** first run: dispatched together with Tasks 3.1 to 3.9. **Built against:** Task 3.1 (ports `Store`, `Files`, `FileHandle`, `Net`, `NetResponse`, `Clock`; types `DlRecord`, `DownloadSettings`), Task 3.5 (`savePath`), Task 3.7 (`ENGINE_PAGE`, `ensureEngine`, `addRecords`, `fromExtensionPage`, `readDownloads`, `onDownloadsChanged`; `offscreen/protocol.ts` types `WorkerRequest`, `WorkerMessage`, `SaveReply`; `offscreen.ts` and `engine-worker.ts`; `buildDownloads`; `_helpers.mjs`), Task 3.8 (`createEngine`, `Engine`, `EngineDeps`, `Host`, `StateChange`), Task 3.9 (`createTransfer`, `TransferDeps`). **Consumed by:** Task 3.11 (`readAllRecords`, `syncRecordRules`, `initNetRules`), Task 3.12 (the Worker's `Host.save`, `_fixture.mjs`), Task 3.13 (`addProbeRule`, `readAllRecords`, `_fixture.mjs`), Task 3.14 (`_fixture.mjs`), Tasks 3.15 and 3.17 (`readAllRecords`), Task 3.19. **Waits for:** it may write every file and the pure `dl-net-rules.test.ts` (it imports only `net-rules.ts`) before any upstream commit exists; `transfer.mjs`, the build and its pathspec commit wait for the implementation commits of 3.7, 3.8 and 3.9 (its Worker imports their values), and through them of 3.1 to 3.6. Tasks 3.11, 3.12, 3.13 and 3.14 start in the next run, when it is committed

**Interfaces:**
- Produces, in `idb-store.ts`: `export function openStore(): Promise<Store>` (IndexedDB database `sieve-dl`, version 1; object store `records` with `keyPath: 'id'`; object store `meta` with out-of-line keys; `put` and `delete` resolve on the transaction's `complete`; `put(record, { strict: true })` opens its transaction with `{ durability: 'strict' }`). Every connection sets `db.onversionchange = () => db.close()`, so a page or test can delete the database without hanging. It works in the engine Worker, the service worker and pages (inspected F5, F7). `export async function readAllRecords(): Promise<DlRecord[]>` opens the store, returns `all()`, **closes its connection** (`db.close()`) and returns `[]` when the database cannot be opened.
- Produces, in `opfs-files.ts` (Worker only): `export function createOpfsFiles(): Files`. `createSyncAccessHandle` is declared only in `lib.webworker.d.ts`, while `apps/sieve/tsconfig.json` uses the DOM lib, so `pnpm --filter sieve typecheck` would fail on it; this task adds the new file `apps/sieve/src/offscreen/sync-access.d.ts` declaring `FileSystemSyncAccessHandle` (`read`, `write`, `truncate`, `getSize`, `flush`, `close`, each with the `{ at }` option where it applies) and the `FileSystemFileHandle.createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>` overload (a declaration, not a cast inside `opfs-files.ts`). `open` uses `navigator.storage.getDirectory()` and `createSyncAccessHandle()`; when it fails with `NoModificationAllowedError` it retries 5 times, 50 ms apart (the handle of a just-paused transfer may still be closing). `write(chunk, at)` loops until every byte is written (`write` can return fewer). `open(name, length)` sets the size to exactly `length` when it is not `null`. `space()` returns `navigator.storage.estimate()`'s `quota` and `usage`. `list()` returns the root's file names. `remove` ignores a missing file.
- Produces, in `net-rules.ts` (service worker). Constants: `ALLOW_RULE_ID = 1`, `ALLOW_PRIORITY = 2_000_000_000`, `REFERER_PRIORITY = 2_000_000_001`, `RECORD_RULE_FIRST = 1000`, `RECORD_RULE_LAST = 1999`, `PROBE_RULE_FIRST = 900_000`. Pure builders and the browser calls:
  ```ts
  export function allowRule(extensionId: string): chrome.declarativeNetRequest.Rule;
  export function refererRule(id: number, url: string, referrer: string, extensionId: string): chrome.declarativeNetRequest.Rule;
  export function recordRules(records: readonly { id: string; url: string; finalUrl: string; referrer: string; state: string }[], extensionId: string): chrome.declarativeNetRequest.Rule[];
  export async function installAllowRule(): Promise<void>;
  export async function syncRecordRules(extra?: readonly { url: string; finalUrl?: string; referrer: string }[]): Promise<void>;
  export async function addProbeRule(url: string, referrer: string): Promise<() => Promise<void>>;
  export function initNetRules(): void;     // calls installAllowRule() once at worker start
  ```
  - `allowRule`: `{ id: 1, priority: ALLOW_PRIORITY, action: { type: 'allow' }, condition: { initiatorDomains: [extensionId], resourceTypes: ['xmlhttprequest', 'other'] } }`. It lets the engine's requests past Sieve's own blocking lists (inspected F14).
  - `refererRule`: `{ id, priority: REFERER_PRIORITY, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'referer', operation: 'set', value: referrer }] }, condition: { urlFilter: '|' + url + '|', initiatorDomains: [extensionId], resourceTypes: ['xmlhttprequest', 'other'] } }`. It must outrank the allow rule (inspected F14).
  - `recordRules`: skips records in state `done` and records whose `referrer` is `''`; for each remaining record, one rule for `url` and, when different, one for `finalUrl`; ids count up from `RECORD_RULE_FIRST` in record-id order; stops at `RECORD_RULE_LAST` (1000 rules). A URL containing `*` or `^` cannot be matched exactly by a `urlFilter`; such a download simply goes without the Referer (known limit; leave the comment `shortcut: …`).
  - `syncRecordRules(extra)`: reads `readAllRecords()`, adds the `extra` entries as pseudo-records (state `queued`, id `~<index>`), builds `recordRules`, and replaces every session rule with an id in `RECORD_RULE_FIRST..RECORD_RULE_LAST` in one `updateSessionRules({ removeRuleIds, addRules })`.
  - `addProbeRule(url, referrer)`: with `referrer === ''` returns a no-op remover. Otherwise id `PROBE_RULE_FIRST + (counter++ % 1000)`; one `updateSessionRules({ removeRuleIds: [id], addRules: [rule] })` (removing the id in the same call avoids a clash with a rule a dead worker left); returns a function that removes the rule.
- `engine-link.ts` change: `addRecords(items)` first `await syncRecordRules(items.map(i => ({ url: i.url, finalUrl: i.probed?.finalUrl, referrer: i.referrer ?? '' })))`, then sends `dl-eng-add`.
- The real `engine-worker.ts` builds the engine from the real ports: `store = await openStore()`, `files = createOpfsFiles()`, `net` over `fetch(url, { headers, credentials: 'include', redirect: 'follow', cache: 'no-store', signal })` (headers `Range` and `If-Range` only when given), a real `Clock` (`Date.now`, abortable `setTimeout`, `setInterval`; its `sleep` also resolves early when the Worker's `online` event fires, so back-offs after an outage end as soon as the network is back), `transfer = createTransfer({ net, files, store, clock })`, and a `Host` whose `emit` posts `{ push: 'state', payload }`, `idle` posts `{ push: 'idle' }`, and `save` posts `{ push: 'save', payload: { id, name: record.name, path, size } }` and answers `{ ok: true }` (the real save arrives in Task 3.12; until then a finished record rests in `saving`). The first `config` command calls `engine.start(settings)` and **replies only after `start()` has resolved**; every other command that arrives before that reply is held and run afterwards, in order (the relay also holds them, Task 3.7); later `config` commands call `engine.config(settings)`; `add`, `do`, `tick`, `save-event` map to `engine.add`, `engine.act`, `engine.tick`, `engine.saveEvent`. A command that throws replies `{ error: <message> }` and logs; the reply for `add` then is `{ ids: [] }`.
- Produces `test/dl/_fixture.mjs`: `export async function startFixture(): Promise<Fixture>` with `Fixture = { port, base, alt, log, reset(), close(), pattern(offset, length) }`; `base` is `http://localhost:<port>`, `alt` is `http://127.0.0.1:<port>`; `log` collects `{ t, method, path, range, ifRange, cookie, referer, status }` per request and `{ path, closed: true, sent }` when a client hangs up. The body of every file is the pattern byte `i % 251` at offset `i`. Routes:

  | Route | Behaviour |
  |---|---|
  | `GET /file/<size>/<name>` | the file, with `Range` (206, `Content-Range`) and `If-Range` against the ETag `"e-<size>"`; query: `rate=<bytes per second>` (0 = unthrottled), `type=<mime>` (default `application/octet-stream`), `ranges=no` (200 always, `Accept-Ranges: none`), `disposition=inline` (default is `attachment; filename="<name>"`), `enc=gzip` (adds `Content-Encoding: gzip`), `drop=<bytes>` (closes the connection once, after that many bytes, per path), `cookie=1` (403 unless the cookie `sid=abc` is sent), `ref=<url>` (403 unless `Referer` equals it), `status=<n>` (that status and no body), `once=<token>` (the first request with the token succeeds; later ones are 403) |
  | `GET /limited/<size>/<name>?max=<n>` | like `/file`, but a request that would be open at the same time as `n` others answers 429 with `Retry-After: 1` |
  | `GET /flip/<size>/<name>` | like `/file`, but the ETag (`"f-<n>"`) goes up whenever a client hangs up before the end of a body of more than one byte (a killed engine), so a resumed `If-Range` misses and the ranged request gets 200; the probe and a download that ends normally leave it unchanged |
  | `GET /redirect/<hops>?to=<path>` | `hops` 302 redirects, then to `<path>` |
  | `POST /form/<size>/<name>` | the file (POST only; GET answers 405) |
  | `GET /shape/<size>/<name>` | like `/file`, but the probe (a request with `Range: bytes=0-0`) can differ from the real file: `probeSize=<n>` (the probe's `Content-Range` total is `n`), `probeType=<mime>`, `probeStatus=<n>`, `probeDelay=<ms>` (the probe's answer waits that long) |
  | `GET /page?to=<path>[&method=post]` | an HTML page whose script clicks a link to `<path>` at load (a navigation that downloads; the request's Referer is this page); with `method=post` it submits a form that POSTs to `<path>` instead |
  | `GET /links` | an HTML page with five distinct `http` links to `/file/1000/l1.bin` to `l5.bin`, a duplicate of `l1`, an `ftp://` link and a `mailto:` link |
  | `GET /set-cookie` | sets `sid=abc` (Lax) and `strict=1` (Strict) |
  | `GET /log` | the log as JSON |

- **Do not change `test/harness.mjs`**: the e2e uses the harness's `launch` as it is. It maps `pagead2.googlesyndication.com` to 127.0.0.1, which the allow-rule check uses.

- [ ] **Step 0: Contract commit (first, before any implementation).** By pathspec, message `Sieve Phase 3 3.10: contract`. Files: `apps/sieve/src/dl/idb-store.ts`, `apps/sieve/src/offscreen/opfs-files.ts`, `sync-access.d.ts` (real declarations), `apps/sieve/src/dl/net-rules.ts`, `apps/sieve/src/__tests__/dl-net-rules.test.ts`, `apps/sieve/test/dl/_fixture.mjs`. Types, interfaces and message shapes are written exactly as in this task's Interfaces; plain data (constants, lists, message-type names) is real; every function body is `throw new Error('not implemented')`; each test file holds one `test.todo('<name>')` per case listed in this task's test steps. Real: the net-rules constants (`ALLOW_RULE_ID`, `ALLOW_PRIORITY`, `REFERER_PRIORITY`, `RECORD_RULE_FIRST`, `RECORD_RULE_LAST`, `PROBE_RULE_FIRST`). Stubs: `openStore`, `readAllRecords`, `createOpfsFiles`, `allowRule`, `refererRule`, `recordRules`, `installAllowRule`, `syncRecordRules`, `addProbeRule`, `initNetRules`, `startFixture`. Send `[CONTRACT] 3.10: <sha, files, exported names>` to the controller as soon as it lands; do not list the test files in `package.json` (the controller does). Then continue with Step 1.
- [ ] **Step 1: Re-run the probes this task depends on.** Run `node .superpowers/phase-3/scratch/probes/p10.mjs`, `p11.mjs` and `p12.mjs`. Expected: F12 (cookies from the Worker), F13 (a session Referer rule works from a Worker), F14 (blocking applies to the extension's fetches; the allow rule at a priority above `meta.maxPriority` fixes it; the Referer rule must outrank it) and F16 (1 GB into OPFS, memory flat) hold. Record them as `// inspected <date>, Chrome for Testing <version>` above the constants in `net-rules.ts` and at the top of `opfs-files.ts`. If the priority order no longer matters or the allow rule is no longer needed, stop and report: Task 3.13 depends on both.
- [ ] **Step 2: Write the failing `dl-net-rules.test.ts`** (pure builders, no `chrome`): the exact rule shapes above; `recordRules` numbering (records `b`, `a` in any order get ids 1000, 1001 sorted by record id), skipping `done` and empty-referrer records, one rule for `url` and one for a different `finalUrl`, none duplicated when equal, and a stop at 1000 rules; `addProbeRule` with a fake `chrome.declarativeNetRequest.updateSessionRules` removes the id in the same call it adds it, wraps the counter at 1000, returns a remover that removes it, and returns a no-op for an empty referrer.
- [ ] **Step 3: Write `_fixture.mjs` and `transfer.mjs`** (failing; the engine path is real). Each check starts from `resetDl(t)` and uses `dl-add` through `sendMsg`; it reads records with `readRecords(t)` and reads the private file through `readPart(t, name)` and the stored host caps through `readMeta(t, key)` (both in `_helpers.mjs`, Task 3.7). A finished download rests in state `saving` in this task. Sizes and rates keep each check under 20 s.
  1. **One part:** `/file/20000000/a.bin` reaches `saving` with `parts` complete and `readPart` `{ size: 20000000, ok: true }`; the log shows a probe `bytes=0-0` and then `bytes=0-` with an `If-Range`.
  2. **Cookies and Referer:** after the page visits `/set-cookie`, a `cookie=1` file downloads (the log shows the cookie); a download added with `referrer: 'https://files.example.org/page'` of a `ref=https://files.example.org/page` file succeeds (the Referer rule works); the same file without the referrer fails with `ERRORS.status(403)`.
  3. **Sieve's own blocking does not stop it:** a file served from `http://pagead2.googlesyndication.com:<port>/file/3000000/ad.bin` downloads (the allow rule works); with the rule removed (`chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [1] })` through `t.sw`) the same add fails, proving the rule is what lets it through; re-install it afterwards with `t.sw.evaluate`.
  4. **Three parts:** with `setDownloads(t, { parts: 3 })`, `/file/30000000/b.bin?rate=15000000` shows three overlapping ranged requests in the log, none starting at an offset another part already covers, and the file verifies.
  5. **429:** `/limited/30000000/c.bin?max=2` with `parts: 4` finishes; the log holds at least one 429; `readMeta(t, 'hostCaps')` has a `cap` of at most 2 for `localhost`.
  6. **Pause and resume:** `/file/40000000/d.bin?rate=8000000`: after the record shows progress, `dl-do` `pause` leaves it `paused` with `done` above 0; `dl-do` `resume` makes the next request carry a `Range` that starts at a byte offset equal to the persisted `done` (read both) and above 0; it finishes and verifies.
  7. **The engine document dies:** mid-download, `t.sw.evaluate(() => chrome.offscreen.closeDocument())`; after `sendMsg(t, { type: 'dl-do', op: 'pause', ids: [] })` re-creates it the record continues, its next request starts above 0, and the file verifies.
  8. **Speed limit:** with `setDownloads(t, { speedLimit: { on: true, kbPerSecond: 2000 } })`, a 10 MB file takes between 4 and 7 s from `startedAt` to `saving`.
  9. **No range:** `/file/20000000/e.bin?ranges=no&rate=8000000`: one request without `Range` after the probe; killing the engine mid-way and resuming restarts at byte 0 (a request without `Range` or with `bytes=0-`), the file verifies, and `rangeOk` is false in the record.
  10. **Hard error:** `/file/1000/f.bin?status=403` fails with `ERRORS.status(403)` after one request.
  10b. **A link the probe cannot read:** `/file/5000000/z.bin?enc=gzip` (Chrome throws on a gzip answer to a ranged request, inspected F17) fails with `ERRORS.probe` after three requests.
  10c. **A command right after the engine starts:** `closeDocument()` then at once `dl-add`: the reply has an id and the record is in the store (the Worker held the command until `start()` finished).
  11. **Changed file:** `/flip/20000000/g.bin?rate=8000000`, engine killed mid-way, resumed: the record fails with `ERRORS.changed`.
  12. **Records survive:** after each check the stored `records` match what the engine reports in `dl-state` broadcasts (capture one with a listener in an extension page).
- [ ] **Step 4: Run, implement, and run again.** Run `node --test apps/sieve/src/__tests__/dl-net-rules.test.ts`, then `pnpm --filter sieve typecheck && pnpm --filter sieve build && node apps/sieve/test/dl/e2e.mjs --only boot,transfer`. Expected: FAIL, then PASS.
- [ ] **Step 5: Full gate.** Run `pnpm --filter sieve test:e2e`. Expected: PASS.
- [ ] **Re-sync with upstream (the last step before the commit).** Re-read, at the current HEAD, the upstream files named in this task's "Builds against" line; rerun this task's tests against the real implementations (not the contract stubs); fix every mismatch. If an upstream implementation has not landed, send `[BLOCKED]` to the controller and end the turn. A difference from the published contract is a `[CONTRACT-CHANGE]` question to the controller, never a silent choice.
- [ ] **Step 6: Commit** by pathspec with the message `Sieve: download engine adapters, worker and net rules`. Report the test file name.

### Task 3.11: Service worker router: config, reconcile, alarms, idle

**Files:**
- Modify (the stub Task 3.7 made): `apps/sieve/src/dl/router.ts`
- Create: `apps/sieve/src/dl/alarms.ts`, `apps/sieve/src/__tests__/dl-router.test.ts`, `apps/sieve/test/dl/router.mjs`

**Parallel:** after Task 3.10. Runs alongside Tasks 3.12, 3.13 and 3.14 (each owns a different file). Shared files: none.

**Builds against:** Task 3.7 (`engineExists`, `ensureEngine`, `closeEngine`, `sendToEngine`, `readDownloads`, `onDownloadsChanged`, the `router.ts` stub), Task 3.10 (`readAllRecords`, `syncRecordRules`), Task 3.4 (`schedulePlan`, `nextWake`), Task 3.8 (`StateChange`).

**Interfaces:**
- Produces, in `alarms.ts`:
  ```ts
  export const ALARM_SCHEDULE = 'dl-schedule';
  export const ALARM_WATCHDOG = 'dl-watchdog';
  export function runnable(records: readonly DlRecord[], settings: DownloadSettings, at: Date): boolean;   // any `saving` record, any `running` record, or schedulePlan(...).start is not empty
  export async function syncAlarms(records: readonly DlRecord[], settings: DownloadSettings, at: Date): Promise<void>;
  ```
  `syncAlarms`: when `runnable(...)`, `chrome.alarms.create(ALARM_WATCHDOG, { periodInMinutes: 1 })` (re-creating an alarm of the same name replaces it, so calling it often is safe), else `chrome.alarms.clear(ALARM_WATCHDOG)`. The schedule alarm exists whenever some non-forced record is `queued` or `running` and `nextWake(settings.queues, at)` is not null (a running record in a scheduled queue must be stopped when its window closes, so the alarm is needed while it runs, not only while records wait): then `chrome.alarms.create(ALARM_SCHEDULE, { when: max(nextWake, at.getTime() + 1000) })`, else clear it. A packaged extension fires an alarm at most every 30 s (types, line 463); the unpacked one used here has no limit (inspected F15); windows are whole minutes, so neither matters.
- `router.ts` completes `initRouter()` (all listeners at the top level):
  - **`reconcile()`**, run at every worker start (not awaited) and after alarms: reads `readDownloads()` and `readAllRecords()`; `await syncRecordRules()`; `await syncAlarms(...)`; when `runnable(...)` and `!(await engineExists())`, `await ensureEngine()` (the engine then loads its own records and starts them). Calls are serialised so two overlapping calls run one after the other.
  - **`chrome.alarms.onAlarm`**: both `dl-watchdog` and `dl-schedule` run `reconcile()` and, when the engine exists, `sendToEngine({ type: 'dl-eng-tick' })` (so windows are re-evaluated within a minute even if a schedule alarm was lost).
  - **Settings:** `onDownloadsChanged` pushes `sendToEngine({ type: 'dl-eng-config', settings })` only when the engine exists (it never creates the engine), then `reconcile()`.
  - **`dl-state`** (the engine's broadcast, also heard by the worker, which it keeps awake while downloads run, so the handler must be cheap): the router keeps an in-memory map of each record's last seen `state`; only when a broadcast carries a record whose `state` differs from the map (or is new) or lists a removed id does it schedule one `reconcile()` one second later (a timer; more such broadcasts inside the second add nothing). Progress-only broadcasts do nothing. The rules, the watchdog and the schedule alarm follow the records through that.
  - **`dl-sw-idle`**: reads the records; when `runnable(...)` is false, `closeEngine()`; replies `{ ok: true }` either way.
  - `dl-add`, `dl-do` and `dl-sw-ready` stay as in Task 3.7. `dl-add` also calls `reconcile()` after a successful add.

- [ ] **Step 1: Write the failing `dl-router.test.ts`** with an in-memory `chrome` (storage, alarms, runtime, offscreen), a fake `readAllRecords` and `net-rules`, and a fresh copy of the module per test.
  - **Reconcile creates the engine only for work:** a `queued` record in an open queue creates it; no records, only `done` or `paused` or `failed` records, or a `queued` record in a closed window do not; a `saving` record does; `downloads.on` false with a non-forced queued record does not, with a forced one does.
  - **Alarms:** `runnable` work creates `dl-watchdog` with `periodInMinutes: 1`; none clears it (a `queued` record in a closed window is not runnable, so it gets no watchdog); a `queued` record plus a schedule-on queue creates `dl-schedule` with `when` equal to `nextChange` (and at least one second ahead); a `running` non-forced record in a schedule-on queue also creates it; no schedule, or only paused, failed, done or forced records, clears it.
  - **Alarm handlers:** both alarms send `dl-eng-tick` when the engine exists and not when it does not; `dl-watchdog` recreates a missing engine when work is runnable.
  - **Settings push:** a `downloads` change sends `dl-eng-config` with the validated settings when the engine exists and sends nothing when it does not; no engine is created by it.
  - **`dl-state` filter and debounce:** five `dl-state` messages inside one second that each carry a new state cause one `reconcile` (rules synced once); a hundred progress-only messages (same states) cause none; a message with `removed: ['x']` causes one.
  - **`dl-sw-idle`:** closes the document when nothing is runnable; leaves it when a `queued` record in an open queue exists; replies `{ ok: true }` both times.
  - **Serialisation:** two `reconcile()` calls started together never run `ensureEngine` concurrently.
- [ ] **Step 2: Write `test/dl/router.mjs` (failing).** Uses the fixture from Task 3.10.
  - **Reconcile at worker start:** add a 20 MB file at `rate=5000000`, then `closeDocument()` and `stopWorker(t.ctx)`; wake the worker with `sendMsg(t, { type: 'dl-noop' })`; within 5 s `engineCount(t)` is 1 again and the record keeps progressing (its next request starts above 0).
  - **Watchdog:** with the engine document closed and unfinished work, `t.sw.evaluate(() => chrome.alarms.create('dl-watchdog', { delayInMinutes: 0.05, periodInMinutes: 1 }))` brings the engine back within 10 s without any message; `chrome.alarms.get('dl-watchdog')` exists while work is runnable and is `undefined` after every record is `done` or paused (wait for the one-second debounce).
  - **Idle close:** with no unfinished record, `sendMsg(t, { type: 'dl-sw-idle' })` closes the engine (`engineCount` 0); with a running record it does not.
  - **Schedule window:** set queue `main` to `{ on: true, days: [0..6], start: <HH:MM of now plus one minute>, stop: null }`, add a 1 MB file: it stays `queued` and no engine exists; within 90 s of the window opening the engine appears and the record reaches `saving`; `chrome.alarms.get('dl-schedule')` existed before the window opened, and exists while the record is running (it must, so the window's close can stop the record). (This one check takes up to a minute; it is the slowest in the phase.)
  - **Config push:** with the engine running a 20 MB download at `rate=8000000`, `setDownloads(t, { speedLimit: { on: true, kbPerSecond: 1000 } })` slows it (the measured rate over the next 3 s is under 1.5 MB/s) without a reload.
  - **Session rules follow records:** a record added with a referrer has a session rule with id from 1000 within 2 s (`chrome.declarativeNetRequest.getSessionRules()`), and the rule is gone within 3 s of the record becoming `done` (or after `dl-do remove`).
- [ ] **Step 3: Run, implement, and run again.** Run `node --test apps/sieve/src/__tests__/dl-router.test.ts`, then `pnpm --filter sieve typecheck && pnpm --filter sieve build && node apps/sieve/test/dl/e2e.mjs --only router`. Expected: FAIL, then PASS.
- [ ] **Re-sync with upstream (the last step before the commit).** Re-read, at the current HEAD, the upstream files named in this task's "Builds against" line; rerun this task's tests against the real implementations (not the contract stubs); fix every mismatch. If an upstream implementation has not landed, send `[BLOCKED]` to the controller and end the turn. A difference from the published contract is a `[CONTRACT-CHANGE]` question to the controller, never a silent choice.
- [ ] **Step 4: Commit** by pathspec with the message `Sieve: downloads router, alarms and idle close`. Report the test file name.

### Task 3.12: Finishing: save to Downloads/<category>

**Files:**
- Modify (files this phase created; no other task edits them while this one runs): `apps/sieve/src/dl/save.ts`, `apps/sieve/src/offscreen/offscreen.ts`, `apps/sieve/src/offscreen/engine-worker.ts`
- Create: `apps/sieve/src/__tests__/dl-save.test.ts`, `apps/sieve/test/dl/_raw-chrome.mjs`, `apps/sieve/test/dl/save.mjs`

**Parallel:** after Task 3.10; alongside Tasks 3.11, 3.13 and 3.14. Shared files: none.

**Builds against:** Task 3.7 (`sendToEngine`, `fromExtensionPage`, the `save.ts` stub, `offscreen.ts` and `protocol.ts`), Task 3.8 (`Host.save`, `SaveEvent`), Task 3.5 (`savePath`), Task 3.10 (the Worker, `_fixture.mjs`).

**Interfaces:**
- The protocol is the one in "Shape of the code: the finishing protocol". Its parts:
  - **Engine Worker.** `Host.save(record)` computes `path = savePath(<the record's category setting from the last config>, record.name)` and posts `{ push: 'save', req, payload: { id, name: record.name, path, size: record.size } }` (the same payload shape as Task 3.10's stub), then waits for `{ saveReply: req, result }` from the main thread (30 s timeout gives `{ ok: false, message: 'TIMEOUT' }`).
  - **Offscreen main thread.** On a `save` push: `estimate()`; when `quota - usage < size` reply `{ ok: false, message: 'FILE_NO_SPACE' }` (the copy needs as much free disk again; `quota` follows free space, inspected F6). Otherwise open `<id>.part` from the OPFS root, `file = await handle.getFile()`; a `file.size` different from `size` replies `{ ok: false, message: 'FILE_TOO_SHORT' }` (the file is pre-sized and sparse, so its length alone proves nothing: this guards unknown-size downloads only; completeness of known sizes rests on `isComplete(record)`, which the engine checks before it starts the save, Task 3.8); else `blobUrl = URL.createObjectURL(file)` (the file is read from disk by Chrome, nothing is copied into memory; inspected F9), remember it by record id, and send `{ type: 'dl-sw-save', id, blobUrl, path, size }`; relay the reply to the Worker. On an `dl-eng-save-event` of kind `done` or `failed` for an id, revoke its blob URL.
  - **Service worker, `save.ts`**, `export function initSave(): void` registers the listeners; exported for tests: `export interface SaveEntry { id: string; size: number; path: string; chromeId: number | null; state: 'pending' | 'complete' | 'interrupted'; filename: string | null; error: string | null }` (one session key `dlSave:<blobUrl>` per entry), `export async function onSave(message: unknown, sender: chrome.runtime.MessageSender): Promise<{ ok: true; chromeId: number } | { ok: false; message: string }>` and `export async function recoverSaves(): Promise<void>`. `onSave` rejects (`{ ok: false, message: 'INVALID' }`, nothing else done) unless `fromExtensionPage(sender)` and `sender.url` ends with `/offscreen.html`, `blobUrl` starts with `blob:chrome-extension://${chrome.runtime.id}/`, `path` is a relative path (no leading `/`, no `..` segment, no `\`, at most 400 characters) and `size` is a finite number of at least 0. **One save per record:** if a `dlSave:*` entry for the same record `id` already exists whose Chrome item (`search({ id: chromeId })`) is `in_progress` or `complete`, it replies `{ ok: true, chromeId }` with that id and starts nothing (a resumed save or a replayed message never makes a second Chrome download). Otherwise it writes the `dlSave:<blobUrl>` entry `{ id, size, path, chromeId: null, state: 'pending', filename: null, error: null }` to session storage first, then `chrome.downloads.download({ url: blobUrl, filename: path, conflictAction: 'uniquify' })` (through `chrome.downloads.download` at call time, never a saved reference, so tests can wrap it); on success it stores `chromeId` and replies; on a rejection it deletes the entry and replies `{ ok: false, message: <error text> }`.
  - **`chrome.downloads.onChanged`** (top level). For a delta with `filename` or `state`: `[item] = await chrome.downloads.search({ id: delta.id })`; `entry = (await chrome.storage.session.get('dlSave:' + item.url))['dlSave:' + item.url]`; none: return. Build events in this order: a filename change gives `{ id: entry.id, kind: 'path', filename: delta.filename.current, chromeId: item.id }`; `state.current === 'complete'` gives `done` with `filename: item.filename` when `item.fileSize === entry.size`, else `{ kind: 'failed', error: 'FILE_SIZE_MISMATCH' }`; `'interrupted'` gives `{ kind: 'failed', error: item.error ?? 'INTERRUPTED' }`. Send each with `sendToEngine({ type: 'dl-eng-save-event', ...event })`; after a terminal event is acknowledged, remove that one key; if sending fails keep it.
  - **`recoverSaves()`**, run at worker start (not awaited): for each `dlSave:*` key (found with `get(null)` and a prefix filter) whose entry has a `chromeId`: `search({ id })`; `complete` or `interrupted` sends the same terminal event as above; `in_progress` is left. For an entry without a `chromeId` (the worker died between writing the entry and the reply): `search({ url: blobUrl })`; found, adopt its id and proceed as above; not found, delete the entry and send `{ kind: 'failed', error: 'NOT_STARTED' }`.
  - After a browser restart the `dlSave:*` keys are gone (session storage) and the blob URL is dead; a record in `saving` then saves again from the engine's start (Task 3.8). A duplicate named `name (1).ext` is possible; a loss is not.
- Produces `test/dl/_raw-chrome.mjs` (inspected F10; based on `.superpowers/phase-3/scratch/probes/p8.mjs`):
  ```js
  export async function launchRaw({ downloadsDir, profileDir }?): Promise<Raw>
  // Raw = { child, profileDir, downloadsDir, id, send(method, params, sessionId), evalSw(expression), evalPage(urlPrefix, expression), openPage(url), kill(signal = 'SIGKILL'), close() }
  ```
  It makes `profileDir` and `downloadsDir` temp folders when not given, seeds `<profileDir>/Default/Preferences` with `{ download: { default_directory: downloadsDir, prompt_for_download: false } }`, starts the Chrome for Testing binary with `--headless=new --user-data-dir=<profileDir> --remote-debugging-port=0 --disable-extensions-except=<dist> --load-extension=<dist> --no-first-run --no-default-browser-check about:blank`, reads the `DevTools listening on ws://…` line from stderr, connects with Node's global `WebSocket`, finds the `service_worker` target whose URL ends with `background.js`, and attaches with `flatten: true`. `evalSw` and `evalPage` use `Runtime.evaluate` with `awaitPromise` and `returnByValue`; `openPage` makes a target with `Target.createTarget`. `kill('SIGKILL')` ends the process at once; `close()` ends it politely and removes the folders it made. Playwright is not used here because it rewrites the download location (inspected F10). The file does not import `CHROMIUM` or `EXT` from `harness.mjs` (they are not exported, and the harness is not edited): it repeats the harness's rule, `process.env.CHROMIUM_PATH ?? <home>/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`, and takes the extension folder from `fileURLToPath(new URL('../../dist', import.meta.url))`.

- [ ] **Step 1: Re-run the probes.** Run `node .superpowers/phase-3/scratch/probes/p2.mjs 1073741824` and `p8.mjs`. Expected: a 1 GiB blob-URL save completes with no memory growth, and the raw-CDP launch saves to `<dir>/Sieve/Video/own.bin` (F9, F10). Record them as `// inspected <date>, Chrome for Testing <version>` at the top of `save.ts` and `_raw-chrome.mjs`.
- [ ] **Step 2: Write the failing `dl-save.test.ts`** (in-memory `chrome`, session storage, fake `sendToEngine`).
  - `onSave` accepts a valid message and calls `chrome.downloads.download` with `{ url: blobUrl, filename: path, conflictAction: 'uniquify' }`, with the `dlSave:<blobUrl>` key already in session storage when `download` is called (assert from inside the fake); the reply carries `chromeId`; a rejecting `download` deletes the entry and replies `{ ok: false, message }`.
  - Rejections without any download call: a sender that is a web page; a sender whose `url` is `options.html`; a `blobUrl` of another extension or `https://…`; `path` `'/etc/x'`, `'../x'`, `'a/../b'`, `'a\\b'`, 401 characters; `size` `NaN` or `-1`.
  - `onChanged`: a `filename` delta for a known blob URL sends one `path` event; `complete` with `fileSize` equal to the entry's `size` sends `done` then deletes the entry (after the fake `sendToEngine` resolves); `fileSize` different sends `failed` `FILE_SIZE_MISMATCH`; `interrupted` with `error: 'FILE_NO_SPACE'` sends `failed` `FILE_NO_SPACE`; a delta for an unknown URL (an ordinary Chrome download) sends nothing; a failing `sendToEngine` keeps the entry; a delta with both `filename` and `state` sends `path` before `done`.
  - `recoverSaves`: an entry with a `chromeId` whose item is `complete` sends `done`; `interrupted` sends `failed`; `in_progress` sends nothing; an entry without `chromeId` found by URL is adopted; not found sends `NOT_STARTED` and deletes it.
- [ ] **Step 3: Write `test/dl/save.mjs` (failing).** To see what the engine passes to Chrome, the module wraps the worker's call: `t.sw.evaluate(() => { const o = chrome.downloads.download; self.__saves = []; chrome.downloads.download = (opts, ...a) => { self.__saves.push(opts); return o.call(chrome.downloads, opts, ...a); }; })` (re-applied after any worker restart).
  1. **Complete flow** (Playwright harness): add `/file/20000000/pack.zip`; the record reaches `done` within 40 s with `savedPath` set; the saved file (the path Chrome reports) has the right size and verifies against the pattern byte for byte when read with `fs`; `<id>.part` no longer exists in OPFS; no `dlSave:*` key is left in session storage; the wrapped call had `filename: 'Archives/pack.zip'` and `conflictAction: 'uniquify'`; the Chrome item's `url` starts with `blob:chrome-extension://` and its `byExtensionId` is the extension's id.
  2. **Categories:** `movie.mp4` saves with `filename: 'Video/movie.mp4'`, `song.mp3` with `Music/song.mp3`, `App.dmg` with `Programs/App.dmg`, `paper.pdf` with `Documents/paper.pdf`, `thing.xyz` with `Other/thing.xyz`; after `setDownloads` renames the video folder to `Movies`, a new video saves to `Movies/…`.
  3. **Same name twice:** two records for the same file name both reach `done` and their `savedPath` values differ.
  4. **A failed save keeps the copy:** wrap `chrome.downloads.download` to reject once with `Error('boom')`: the record is `failed` with `ERRORS.save('boom')` and `saveOnly` true, `<id>.part` is still in OPFS with the right size; unwrap; `dl-do resume` takes it to `saving` and then `done` without a new network request (the fixture log gains none), and the part is then removed.
  5. **Cancelled in Chrome:** wrap `download` so the item is paused right after it starts (`chrome.downloads.pause(id)`), then `chrome.downloads.cancel(id)`: the record is `failed` with `ERRORS.saveCanceled`, the part remains; resume completes it.
  6. **The worker dies after the save started:** wrap `download` to pause the item, `stopWorker(t.ctx)`, then `chrome.downloads.resume` through the woken worker: the record still reaches `done` (the worker's `recoverSaves` or the `onChanged` wake sends the event).
  7. **Real folders** (`_raw-chrome.mjs`, real Downloads path): launch the raw Chrome with the fixture; from an extension page target send `dl-add` for `/file/5000000/clip.mp4`; within 40 s `<downloadsDir>/Video/clip.mp4` exists with 5,000,000 bytes that verify; a second add of the same URL produces `<downloadsDir>/Video/clip (1).mp4` (the collision rule). Close it.
  8. **`--big` only** (`t.big`): `/file/3000000000/big.bin` unthrottled reaches `done`; print the browser's resident memory (`ps`, summed over Chrome for Testing processes) before the save and at the end; assert the growth is under 500 MB and the saved size is 3,000,000,000. This is the multi-GB check (Review Focus 7); the numbers go in the handoff.
- [ ] **Step 4: Run, implement, and run again.** Run `node --test apps/sieve/src/__tests__/dl-save.test.ts`, then `pnpm --filter sieve typecheck && pnpm --filter sieve build && node apps/sieve/test/dl/e2e.mjs --only save` (and once with `--big`). Expected: FAIL, then PASS.
- [ ] **Re-sync with upstream (the last step before the commit).** Re-read, at the current HEAD, the upstream files named in this task's "Builds against" line; rerun this task's tests against the real implementations (not the contract stubs); fix every mismatch. If an upstream implementation has not landed, send `[BLOCKED]` to the controller and end the turn. A difference from the published contract is a `[CONTRACT-CHANGE]` question to the controller, never a silent choice.
- [ ] **Step 5: Commit** by pathspec with the message `Sieve: save finished downloads to Downloads/<category>`. Report the test file name.

### Task 3.13: Take-over wiring and Retry in Chrome

**Files:**
- Modify (the stub Task 3.7 made): `apps/sieve/src/dl/takeover.ts`
- Create: `apps/sieve/src/__tests__/dl-takeover-wiring.test.ts`, `apps/sieve/test/dl/takeover.mjs`

**Parallel:** after Task 3.10; alongside Tasks 3.11, 3.12 and 3.14. It reuses `addRecords` and `addProbeRule` from earlier tasks. Shared files: none.

**Builds against:** Task 3.5 (`isOurs`, `wantsTakeover`, `verdict`, `ChromeItem`, `ProbeFacts`, `factsFromError`, `factsFromResponse`), Task 3.7 (`addRecords`, `sendToEngine`, `readDownloads`, the `takeover.ts` stub), Task 3.8 (the `add` replay rule), Task 3.9 (`PROBE_TIMEOUT_MS`), Task 3.10 (`addProbeRule`, `readAllRecords`, `_fixture.mjs`).

**Interfaces:**
- Produces:
  ```ts
  export interface AreaLike {                                        // chrome.storage.local or chrome.storage.session
    get(keys: string | string[] | null): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(keys: string | string[]): Promise<void>;
  }
  export interface TakeoverDeps {
    extensionId: string;
    settings(): Promise<DownloadSettings>;
    pause(id: number): Promise<void>; resume(id: number): Promise<void>; cancel(id: number): Promise<void>; erase(id: number): Promise<void>;
    search(id: number): Promise<{ state: string; paused: boolean; filename: string } | undefined>;
    freeBytes(): Promise<number | null>;                              // quota minus usage from navigator.storage.estimate() (inspected F6), null when unknown
    probe(item: ChromeItem): Promise<ProbeFacts>;                     // never throws
    add(items: AddItem[]): Promise<{ ids: string[] } | null>;         // addRecords
    records(): Promise<DlRecord[]>;                                   // readAllRecords
    remove(ids: string[]): Promise<void>;                             // dl-eng-do remove
    local: AreaLike; session: AreaLike;
    now(): number;
    startedAt: number;
  }
  export interface RetryDeps {
    records(): Promise<DlRecord[]>;
    download(url: string): Promise<number>;                           // chrome.downloads.download({ url, conflictAction: 'uniquify' })
    search(id: number): Promise<{ state: string; bytesReceived: number } | undefined>;
    remove(ids: string[]): Promise<void>;
    session: AreaLike; now(): number; sleep(ms: number): Promise<void>;
  }
  export async function onCreated(item: chrome.downloads.DownloadItem, deps?: TakeoverDeps): Promise<void>;
  export async function recoverPaused(deps?: TakeoverDeps): Promise<void>;
  export async function retryInChrome(id: string, deps?: RetryDeps): Promise<{ ok: boolean; message?: string }>;
  export async function realProbe(item: ChromeItem): Promise<ProbeFacts>;
  export function initTakeover(): void;
  ```
  `initTakeover()` adds `chrome.downloads.onCreated`, a `chrome.runtime.onMessage` handler for `dl-retry-chrome` (extension pages only), and runs `recoverPaused()` at worker start (not awaited). Storage keys are one per entry: `dlTakeover:<chromeId>` in `chrome.storage.local` (session storage is cleared when the extension reloads, updates or is disabled, and an orphaned paused download would then never be resumed) and `dlRetry:<url>` in `chrome.storage.session`; readers find them with `get(null)` and a prefix filter.
- **`onCreated(item)`**, in this order (the order is the guarantee of anti-goal 3):
  1. `retryUrls` = the urls of the `dlRetry:*` keys whose value (an expiry time) is still in the future. If `isOurs(item, extensionId, retryUrls)` (Task 3.5), return.
  2. `s = await settings()`; `wantsTakeover(item, s.takeOver, s.on)`; not wanted: return. Nothing has been paused so far.
  3. `await local.set({ ['dlTakeover:' + item.id]: { at: now(), url: item.url } })` **first**, then `await pause(item.id)` (not in parallel: a worker killed between the two leaves an entry for a download that was never paused, which recovery handles harmlessly, while the reverse order could leave a paused download nobody knows about; F11 measured `pause` alone, 2 to 2.5 ms with 0 bytes received; the extra storage write is a few milliseconds more, and `takeover.mjs` check 2 measures the write-then-pause latency, which must stay under 100 ms). If `pause` rejects (the item already finished or failed) remove the key and return. Then `cur = await search(item.id)` and continue with `item = { ...item, filename: cur?.filename ?? '' }` (Chrome's own name is known only after the pause, inspected F11).
  4. `facts = await probe(item)` (the 8 s limit lives inside `realProbe`); `free = await freeBytes()`; `v = verdict(item, facts, free)` (Task 3.5: the table now has a `no-space` row, so a file the disk cannot hold twice is left to Chrome).
  5. `v.take` false: `await resume(item.id)`; remove the key; return. Chrome's download continues untouched.
  6. `v.take` true: `res = await add([{ url: item.url, referrer: item.referrer, source: 'takeover', chromeId: item.id, probed: { finalUrl: v.finalUrl, size: v.size, mime: v.mime, validator: v.validator, name: v.name } }])`. The engine answers only after the record is persisted with strict durability (Task 3.8) and answers the existing record's id if one already has this `chromeId` (a replay never makes a second record). `null` or no id: `resume(item.id)`, remove the key, return.
  7. `await cancel(item.id)`; on a rejection: `await remove(res.ids)` and `await resume(item.id)` (a cancel that failed leaves Chrome's download alive, so our record is dropped: one copy, never two), remove the key, return. Then `await erase(item.id)` (a failure here is ignored: the cancelled entry only stays in Chrome's history), remove the key.
  Any exception in steps 3 to 7 ends in `resume(item.id)` when the item is still paused and no record for it exists (a `try/finally` with a flag `settled`). **Wording of the guarantee:** if the worker dies after step 6 and before step 7 finishes, `recoverPaused` completes step 7; if it dies before step 6 answers, `recoverPaused` resumes Chrome's download and the engine's replay-safe add means a later retry cannot duplicate; there is never a moment with the file in neither place.
- **`realProbe(item)`**: `release = await addProbeRule(item.url, item.referrer)`; `fetch(item.url, { method: 'GET', headers: { Range: 'bytes=0-0' }, credentials: 'include', redirect: 'follow', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })` (import the constant from `dl-transfer.ts`); `factsFromResponse`, then `response.body?.cancel()`; a throw or timeout gives `factsFromError(message, item.url)` (this is also what a gzip answer to the ranged request becomes, inspected F17); `release()` in a `finally`. Chrome's own request was a GET (the API does not say; a POST that our GET cannot repeat ends in `status-405` or a type or size difference and so in `resume`).
- **`recoverPaused()`**: for each `dlTakeover:<id>` entry in `local` (found with `local.get(null)`, which reads all of `storage.local`: Task 3.20's 300 ms worker-start measure covers its cost) whose `at` is older than `deps.startedAt` (this worker's start): `records = await records()`; if a record has `chromeId === id` **and** `url === entry.url` **and** `addedAt >= entry.at` **and** `state !== 'done'` (Chrome can reuse a download id after its history is cleared, so a stale record must never match and cause a live download to be cancelled), the previous worker died after the engine had acknowledged: finish step 7 (`cancel(id)` and `erase(id)`, errors ignored); else `search(id)` and, if the item is `in_progress` and `paused`, `resume(id)`. Remove the key either way. An entry younger than `startedAt` belongs to a live `onCreated` of this very worker and is left alone. Because the entries live in `local`, an extension reload or update while a probe runs is repaired by the next start.
- **`retryInChrome(id)`** (message `dl-retry-chrome`, the sender must be an extension page): finds the record in IndexedDB; an unknown id gives `{ ok: false, message: T.retryGone }`; writes `dlRetry:<record.url>` (and one for `finalUrl` when different) `= now() + 120_000` to session storage first; calls `download(record.url)` (`conflictAction: 'uniquify'`, no `filename`, so Chrome applies its own rules); on a rejection deletes the `dlRetry:*` keys and replies `{ ok: false, message: T.retryRefused }`. On success it polls `search(chromeId)` every 500 ms for up to 10 s and removes the record (`remove`) only once Chrome's download shows `bytesReceived > 0` or `state` `complete`, so the partly downloaded data is never deleted before Chrome has the file coming; when that is not seen within 10 s the record stays (the row still offers Delete) and the reply is still `{ ok: true }`.
- Known limits to write as `shortcut:` comments: Chrome's API cannot say whether the original request was a POST; the Referer of a retry is not sent (`chrome.downloads.download` cannot set it, inspected F13).

- [ ] **Step 1: Re-run the probe.** Run `node .superpowers/phase-3/scratch/probes/p3.mjs`, `p5.mjs` and `p13.mjs`. Expected: F11 holds (pause settles in a few milliseconds with 0 bytes received, cancel closes the connection, erase removes the entry, resume finishes). Record them as `// inspected <date>, Chrome for Testing <version>` in `takeover.ts`. If `pause` from `onCreated` ever leaves bytes already received, the design is unaffected (the probe compares sizes, not bytes), but write the number in the handoff.
- [ ] **Step 2: Write the failing `dl-takeover-wiring.test.ts`** with fake deps recording call order.
  - **Order for a take-over:** the `dlTakeover:<id>` write in `local` completes before `pause` is called (the fake `local.set` is slow), then `search`, `probe`, `freeBytes`, `add` (with the exact `AddItem` above), `cancel`, `erase`; the key is gone at the end; `cancel` is never called before `add` has resolved (the fake `add` resolves after a delay). The take-over `name` is the basename of Chrome's `filename` when it has an extension (the fake `search` returns `/Users/x/Downloads/Pack.zip.crdownload`).
  - **Leave cases:** for `verdict` reasons `probe-failed`, `no-range`, `status-403`, `encoded`, `no-size`, `size-differs`, `type-differs` and `no-space` (the fake `freeBytes` returns less than `2 * size + SPACE_MARGIN`): `resume` is called, `add`, `cancel` and `erase` never are.
  - **Not wanted:** a `blob:` item, a small file, `downloads.on` false, `takeOver.on` false, a retry URL, an item with `byExtensionId` equal to the extension id: nothing is called (no `pause`).
  - **Failure handling:** `add` returning `null` resumes; `add` throwing resumes; `cancel` rejecting calls `remove(res.ids)` and `resume`; `erase` rejecting is ignored; `pause` rejecting makes no probe; `probe` hanging is bounded by the fake clock (the `realProbe` timeout is tested separately with `AbortSignal`).
  - **`recoverPaused`:** an old entry for an item that is paused and in progress is resumed; for an item already complete it is not; an entry younger than `startedAt` is untouched; an old entry whose item the engine already holds (`records()` has a record with that `chromeId`, the same `url`, `addedAt >= entry.at` and a state other than `done`) gets `cancel` then `erase` and no `resume`; a stale `done` record with the same `chromeId` (or the same `chromeId` and another `url`) does not match: the item is resumed and nothing is cancelled; the key is removed in every case. Entries are found with `local.get(null)` and the `dlTakeover:` prefix.
  - **Replay:** running `onCreated` twice for the same item (as after a worker death) with an engine fake that dedupes on `chromeId` leaves one record and one `cancel`.
  - **`retryInChrome`:** writes the `dlRetry:<url>` key before calling `download`; removes the record only after `search` shows `bytesReceived > 0` (or `complete`), polling every 500 ms (fake `sleep`); with `bytesReceived` 0 for 10 s of fake time the record stays and the reply is `{ ok: true }`; a rejection deletes the retry keys and replies `{ ok: false, message: T.retryRefused }`; an unknown id replies `{ ok: false, message: T.retryGone }`; a message from a web page is ignored.
- [ ] **Step 3: Write `test/dl/takeover.mjs` (failing).** Downloads are started the way a person starts them: a new page at `fx.base + '/page?to=<path>'`. The module wraps `chrome.downloads.pause`, `resume`, `cancel` in the worker to log call times (as in Task 3.12) and adds an `onCreated` listener that logs `Date.now()`; each check starts from `resetDl(t)` and `chrome.downloads.erase({})`, and set `takeOver.minMb` to 1 with `setDownloads`. A taken-over file shows as a record with `source: 'takeover'`; a left file shows as a Chrome item that reaches `complete`. The Chrome item's file (under the harness's temp folder) is checked byte for byte with the pattern.
  1. **Take-over:** `/file/20000000/a.zip?rate=10000000`: a record appears with `source: 'takeover'` and `chromeId` set; Chrome's original item is gone from `chrome.downloads.search({})` once the save finishes, leaving only the blob save; the saved file verifies; the fixture log shows Chrome's request, one `bytes=0-0` probe, then the engine's ranged requests, and no request after completion.
  2. **Latency:** `pause` was called less than 100 ms after `onCreated`.
  3. **Not taken:** a 500 kB file (below `minMb`), a 9 MB `text/html` file named `a.html`, and the same listed file with `takeOver.on` false or `setDownloads(t, { on: false })`: no `pause` call, no record, the Chrome item completes and verifies.
  4. **Leave matrix** (each: no record, no engine request after the probe, the Chrome item completes and verifies, exactly one item in `search({})`, `resume` was called): `/shape/20000000/s.zip?probeSize=19999999`; `probeType=text/html`; `probeStatus=429`; `ranges=no`; `once=tok1` (the link works once and Chrome used it first, so the probe gets 403); `enc=gzip`; `/page?to=/form/20000000/f.zip&method=post` (the probe's GET gets 405); `probeDelay=12000` (the probe times out after 8 s; this check takes about 10 s).
  5. **Cookies and Referer:** after the page visits `/set-cookie`, `/file/20000000/c.zip?cookie=1&rate=10000000` is taken over (the probe carries the cookie); `/file/20000000/r.zip?ref=<the page URL>&rate=10000000` is taken over (the probe carries the Referer through the session rule).
  6. **Our own saves are never taken over again:** with `minMb` 0, after take-over number 1 finishes, `search({})` shows no paused item and the fixture log shows no probe after the save; the wrapped `pause` was called once in total.
  7. **Retry in Chrome:** take over `/flip/20000000/g.zip?rate=8000000`, kill the engine mid-way and resume it so the record fails with `ERRORS.changed`; `sendMsg(t, { type: 'dl-retry-chrome', id })` replies `{ ok: true }`; Chrome downloads the file (`complete`); the record is gone, and it was still there while Chrome's download had `bytesReceived` 0 (the check reads both once a second); no `bytes=0-0` probe for that URL follows (the retry URL was skipped); a second `dl-retry-chrome` for the same id answers `{ ok: false }`.
  8. **The worker dies while Chrome's download is paused:** `/shape/20000000/w.zip?probeDelay=6000&rate=10000000`: after the pause, `stopWorker(t.ctx)`; wake the worker with `sendMsg(t, { type: 'dl-noop' })`; within 15 s Chrome's item is no longer paused and reaches `complete`, byte-correct, with no record; while the probe waits, `chrome.storage.local` holds a `dlTakeover:<id>` key (it survives the worker's death), and it is gone afterwards.
  8b. **The worker dies after the engine acknowledged and before the cancel:** wrap `chrome.downloads.cancel` so it never resolves, wait until the record exists, `stopWorker(t.ctx)`, wake the worker: the new worker's `recoverPaused` cancels and erases Chrome's item, the record continues to completion, and exactly one file results (Chrome's original is gone, the Sieve save verifies).
  9. **The engine cannot start:** wrap `chrome.offscreen.createDocument` to reject and close the document: a take-over attempt leaves Chrome's download complete and byte-correct with no record (the engine could not acknowledge, so Chrome's download was resumed).
  10. **Cancel fails:** wrap `chrome.downloads.cancel` to reject once: the engine's new record is removed, Chrome's download is resumed and completes: one file, no duplicate.
- [ ] **Step 4: Run, implement, and run again.** Run `node --test apps/sieve/src/__tests__/dl-takeover-wiring.test.ts`, then `pnpm --filter sieve typecheck && pnpm --filter sieve build && node apps/sieve/test/dl/e2e.mjs --only takeover`. Expected: FAIL, then PASS.
- [ ] **Re-sync with upstream (the last step before the commit).** Re-read, at the current HEAD, the upstream files named in this task's "Builds against" line; rerun this task's tests against the real implementations (not the contract stubs); fix every mismatch. If an upstream implementation has not landed, send `[BLOCKED]` to the controller and end the turn. A difference from the published contract is a `[CONTRACT-CHANGE]` question to the controller, never a silent choice.
- [ ] **Step 5: Commit** by pathspec with the message `Sieve: take over Chrome's downloads, with Retry in Chrome`. Report the test file name.

### Task 3.14: Context menus: download link, all links, selected links

**Files:**
- Modify (the stub Task 3.7 made): `apps/sieve/src/dl/menus.ts`
- Create: `apps/sieve/src/dl/links.ts`, `apps/sieve/src/__tests__/dl-menus.test.ts`, `apps/sieve/test/dl/menus.mjs`

**Parallel:** after Tasks 3.6, 3.7 and 3.10 (it uses `T`, `parseAddInput`, `readDownloads` and `fromExtensionPage`; its e2e needs `startFixture` and the `/links` route from Task 3.10); alongside Tasks 3.11, 3.12 and 3.13. Shared files: none.

**Builds against:** Task 3.6 (`T`, `parseAddInput`), Task 3.7 (`readDownloads`, `onDownloadsChanged`, `fromExtensionPage`, the `menus.ts` stub), Task 3.10 (`_fixture.mjs`).

**Interfaces:**
- Produces, in `links.ts`:
  ```ts
  export const MAX_LINKS = 500;
  export function normaliseLinks(hrefs: readonly string[], max?: number): string[];   // http(s) only, href-normalised, deduplicated in order, at most `max` (default MAX_LINKS)
  export function collectAll(): string[];        // injected into the page: [...document.links].map(a => a.href)
  export function collectSelected(): string[];   // injected: the hrefs of anchors that intersect the current selection (selection.containsNode(a, true)), in document order
  ```
  `collectAll` and `collectSelected` are passed to `chrome.scripting.executeScript({ target, func })`, so each must be self-contained (no imports, no outer variables).
- Produces, in `menus.ts`:
  ```ts
  export const MENU_LINK = 'dl-link'; export const MENU_SELECTION = 'dl-selection'; export const MENU_PAGE = 'dl-page';
  export async function rebuildMenus(settings: DownloadSettings): Promise<void>;
  export async function onMenuClicked(info: { menuItemId: string | number; linkUrl?: string; selectionText?: string; pageUrl?: string; frameId?: number }, tab: { id?: number; url?: string } | undefined): Promise<void>;
  export function initMenus(): void;
  ```
  - `rebuildMenus` runs through one promise chain (a call waits for the previous one, so two overlapping rebuilds cannot create each item twice or leave a half-built set): `await chrome.contextMenus.removeAll()`; when `settings.on` is true, create three items: `MENU_LINK` with title `T.ctxLink` and `contexts: ['link']`; `MENU_SELECTION` with `T.ctxSelection` and `['selection']`; `MENU_PAGE` with `T.ctxPage` and `['page', 'frame']`. When `on` is false nothing is created (the menus are hidden).
  - `initMenus()`: adds `chrome.contextMenus.onClicked`, `chrome.runtime.onInstalled` (rebuild), `onDownloadsChanged` (rebuild), a `chrome.runtime.onMessage` handler for `dl-menu-click` (below), and rebuilds once at worker start without awaiting. Menus persist across worker restarts in Chrome, and `removeAll` first keeps the rebuild idempotent.
  - `onMenuClicked`: does nothing when `readDownloads().on` is false. `MENU_LINK`: `urls = normaliseLinks([info.linkUrl])`. `MENU_SELECTION`: `chrome.scripting.executeScript({ target: { tabId, frameIds: [info.frameId ?? 0] }, func: collectSelected })`; the first result's array through `normaliseLinks`; when it is empty, `parseAddInput(info.selectionText ?? '').urls` (links typed as text). `MENU_PAGE`: the same with `collectAll`. A missing `tab.id` or a rejected `executeScript` (a page Chrome never lets extensions script) falls back to an empty list. When `urls` is empty nothing happens. Otherwise: `chrome.storage.session.set({ dlPrefill: { urls, referrer: info.pageUrl ?? tab?.url ?? '' } })`, then focus a tab already showing `downloads.html` (`chrome.tabs.query({ url: chrome.runtime.getURL('downloads.html') + '*' })`; `tabs.update(id, { active: true, url: <…>#add })` and `windows.update(windowId, { focused: true })`) or create one at `chrome.runtime.getURL('downloads.html#add')`. The page (Task 3.15) reads and clears `dlPrefill` and opens the Add dialog with these addresses and this referrer. Nothing is added without the owner confirming (decision 13).
  - **Test hook:** the message `{ type: 'dl-menu-click', menuItemId, linkUrl?, selectionText?, pageUrl?, frameId?, tabId? }` is accepted only when `fromExtensionPage(sender)`; it calls `onMenuClicked(info, { id: tabId, url: pageUrl })` and replies `{ ok: true }`. Native context menus cannot be clicked in headless Chrome, so the e2e uses it; it does exactly what a click does and adds no capability a page has not.

- [ ] **Step 1: Write the failing `dl-menus.test.ts`** with an in-memory `chrome` (`contextMenus`, `scripting`, `storage.session`, `tabs`, `windows`).
  - `normaliseLinks(['https://a.com/x', 'https://a.com/x', 'ftp://b', 'mailto:c@d', 'http://e.org', '', 'not a url'])` is `['https://a.com/x', 'http://e.org/']`; 600 distinct links with the default max give 500; `max` 2 gives two.
  - `rebuildMenus` with `on: true` calls `removeAll` first and creates exactly three items with the ids, titles (`T.ctxLink`, `T.ctxSelection`, `T.ctxPage`) and contexts above; with `on: false` it creates none; calling it twice gives the same three.
  - `onMenuClicked`: a link click with `linkUrl: 'https://x.com/a.zip'` and `pageUrl: 'https://x.com/p'` stores `dlPrefill` `{ urls: ['https://x.com/a.zip'], referrer: 'https://x.com/p' }` and creates a tab at `…/downloads.html#add`; a `javascript:` link and an `ftp://` link store nothing and open nothing; a selection click runs `executeScript` with `frameIds: [3]` for `frameId: 3` and uses its result; an empty result falls back to the URLs typed in `selectionText`; a page click with 600 results stores 500; `executeScript` rejecting stores nothing; an existing `downloads.html` tab is updated and focused instead of a new one; `downloads.on` false does nothing at all.
  - The `dl-menu-click` hook: ignored from a web page sender and from a sender with no `url`; accepted from `chrome-extension://sieve/options.html`.
  - `collectAll` and `collectSelected` run against a tiny DOM stub in Node: `document.links` with three anchors give three hrefs; `getSelection()` with a `containsNode` that is true for two of three anchors gives those two.
- [ ] **Step 2: Write `test/dl/menus.mjs` (failing).** The fixture page `/links` (Task 3.10) has five distinct http links, a duplicate, an `ftp://` and a `mailto:`.
  - **Link:** `sendMsg(t, { type: 'dl-menu-click', menuItemId: 'dl-link', linkUrl: <l1 URL>, pageUrl: <page URL>, tabId })` makes session `dlPrefill` equal `{ urls: [<l1 URL>], referrer: <page URL> }` and opens a tab whose URL starts with `chrome-extension://<id>/downloads.html`. This module asserts only that stored `dlPrefill` and that tab URL: `downloads.html` itself does not exist until Task 3.15, so the module must not load or inspect the page (Task 3.15's `list.mjs` checks what the page does with the prefill).
  - **All:** `menuItemId: 'dl-page'` gives the five http links, once each, in page order.
  - **Selected:** select the text of links 2 and 3 with `page.evaluate` (a `Range` over those two anchors) and send `menuItemId: 'dl-selection'` with a `selectionText` of their text: `dlPrefill.urls` is those two links.
  - **Off:** after `setDownloads(t, { on: false })`, a click changes nothing (`dlPrefill` is as before) and opens no tab.
  - **Anti-goal 1:** `chrome.scripting.getRegisteredContentScripts()` in the worker has no script whose id starts with `dl`, and `dist/manifest.json`'s `content_scripts` is unchanged (the injected functions run in the isolated world, so a check on the page's `window` could not fail and is not used).
- [ ] **Step 3: Run, implement, and run again.** Run `node --test apps/sieve/src/__tests__/dl-menus.test.ts`, then `pnpm --filter sieve typecheck && pnpm --filter sieve build && node apps/sieve/test/dl/e2e.mjs --only menus`. Expected: FAIL, then PASS.
- [ ] **Re-sync with upstream (the last step before the commit).** Re-read, at the current HEAD, the upstream files named in this task's "Builds against" line; rerun this task's tests against the real implementations (not the contract stubs); fix every mismatch. If an upstream implementation has not landed, send `[BLOCKED]` to the controller and end the turn. A difference from the published contract is a `[CONTRACT-CHANGE]` question to the controller, never a silent choice.
- [ ] **Step 4: Commit** by pathspec with the message `Sieve: right-click download link, all links and selected links`. Report the test file name.

### Task 3.15: List page: table, filters, Add URL, Resume, Pause, Delete

**Files:**
- Create: `apps/sieve/src/dl/list.html`, `list.ts`, `list.css`, `add-dialog.ts`, `limit-dialog.ts` (a stub: `export function openLimitDialog(): void {}`), `scheduler-dialog.ts` (a stub: `export function openSchedulerDialog(): void {}`; Task 3.16 fills both)
- Create: `apps/sieve/test/dl/list.mjs`

**Parallel:** after Tasks 3.6, 3.11 (it sends `dl-add` and `dl-do`, and relies on the `dl-state` broadcast), 3.12 (finished rows need `savedId`) and 3.13 (the Retry in Chrome button sends `dl-retry-chrome`). Alongside Tasks 3.14 and 3.19. Shared files: none (`build-dl.mjs` already builds `list.ts`, `list.html` and `list.css` when they exist).

**Builds against:** Task 3.6 (`T`, `parseAddInput`, `filterRecords`, `sortRecords`, `progressOf`, `etaSeconds`, `statusText`, formatters), Task 3.7 (`readDownloads`, `saveDownloads`, `onDownloadsChanged`), Task 3.10 (`readAllRecords`), Task 3.4 (`isOpen`, `nextChange`), Task 3.11 (`dl-add`, `dl-do`), Task 3.12 (`savedId`), Task 3.13 (`dl-retry-chrome`).

**Interfaces:**
- The page is `downloads.html` (built from `list.html`): `<html lang="en" data-brand="sieve">`, links to `web/tokens.css`, `web/base.css`, `switch.css`, `downloads.css`, one `<main id="app">`, and `<script type="module" src="downloads.js">`. The title is set by the script (`document.title = T.listTitle`), so the text lives only in `dl-text.ts`.
- Produces, in `add-dialog.ts`: `export function openAddDialog(opts?: { urls?: string[]; referrer?: string }): Promise<void>`. A `<dialog>` (`aria-labelledby` its heading `T.addTitle`) with a `<textarea>` labelled `T.addLabel` (filled with `opts.urls` one per line), a `<select>` labelled `T.addQueue` (the settings' queues), a `<select>` labelled `T.addCategory` (`T.addAutomatic`, then the six categories by `T.categoryNames`), and the buttons `T.addSubmit` and `T.cancel`; Esc cancels. Submit: `parseAddInput(text)`; no valid URL shows `T.addNone` (`role="alert"`) and stays open; otherwise it sends `dl-add` with `items = urls.map(url => ({ url, referrer: opts.referrer ?? '', queue, category (omitted for Automatic), source: opts.urls ? 'menu' : 'manual' }))`; a reply with `ok: false` shows its `message` (or `T.addFailed`) and stays open; on success the dialog closes and, when some lines were skipped, the page's status line shows `T.addSkipped(n)` (`role="status"`).
- Page behaviour (`list.ts`):
  - **Data.** First paint from `readAllRecords()` (Task 3.10) and `readDownloads()`; then `chrome.runtime.onMessage` for `dl-state` (merge `records`, delete `removed`, keep `speeds` and `total`) and `onDownloadsChanged` for the settings. If the engine is not running there are no live numbers; stored records show their last checkpoint.
  - **Header.** `<h1>` `T.listTitle` and the total speed (`formatSpeed(total)`, hidden at 0). When `settings.on` is false a banner (`role="status"`) shows `T.offBanner` and a button `T.turnOn` that calls `saveDownloads(s => ({ ...s, on: true }))`.
  - **Sidebar** (`<nav>` with `aria-label` `T.navLabel`, `data-filter` values `all`, `unfinished`, `finished`, `cat:<id>`, `queue:<id>`): `T.navAll`, `T.navUnfinished`, `T.navFinished`; a group `T.navCategories` with the six categories (`T.categoryNames`); a group `T.navQueues` with the queues' names. Each shows its count; the current one has `aria-current="true"`. `filterRecords` does the work.
  - **Toolbar** (`role="toolbar"`, buttons with `data-id` `add`, `resume`, `pause`, `delete`, `speed`, `scheduler` and the texts `T.addUrl`, `T.resume`, `T.pause`, `T.delete`, `T.speedLimit`, `T.scheduler`). `add` opens `openAddDialog()`; `speed` calls `openLimitDialog()`; `scheduler` calls `openSchedulerDialog()`. `resume` is enabled when a selected record is `paused`, `failed` or `queued` and sends `dl-do` `resume`; `pause` when one is `queued` or `running`, `dl-do` `pause`; `delete` when any is selected. Delete opens a `<dialog>`: text `T.confirmDeleteUnfinished(n)` when any selected record is not `done`, else `T.confirmDeleteFinished(n)`; the confirm button is `T.confirmDelete` or `T.confirmRemove` respectively, plus `T.cancel`; confirming sends `dl-do` `remove`.
  - **Table.** Columns `T.colName`, `T.colSize`, `T.colProgress`, `T.colSpeed`, `T.colEta`; each header is a `<button>` that sets the sort (`added` desc by default; keys `name`, `size`, `progress`, `speed`, `eta`; a second click flips the direction) with `aria-sort` on its `<th>`. Rows are keyed by record id and updated in place (the row element, its checkbox and any focus survive an update); the order is recomputed on a user action and otherwise at most every 2 seconds, so a speed sort does not jitter. A row has `data-id`, a checkbox (`aria-label` `T.selectRow(name)`) in the first cell and `aria-selected`; clicking a row selects only it, Cmd or Ctrl-click toggles it, Shift-click selects the range. The name cell holds the name and, beneath it, `statusText(...)` (`nextOpenAt` is `(q, at) => (isOpen(q.schedule, at) ? null : nextChange(q.schedule, at))`, from Task 3.4; this is the contract Task 3.6's `statusText` documents); when `rangeOk` is false and `size` is known the status has `title` `T.st.noResume`. A `failed` row also has a button `T.retryInChrome` (sends `dl-retry-chrome`; a failure reply shows its `message` in the status line). A `done` row with a `savedId` has a button `T.showInFolder` (`chrome.downloads.show(savedId)`). The size cell is `formatBytes(size)` or empty; progress is a `<progress max="100">` (`aria-label` `T.progressLabel(name)`) and `<percent>%`; speed is `formatSpeed(speeds[id])`; time left is `formatEta(etaSeconds(r, speeds[id] ?? 0))`.
  - **Empty states:** no records at all shows `T.emptyAll`; a filter with no match shows `T.emptyFiltered`.
  - **Prefill.** On load, when `location.hash` is `#add`, read and delete session `dlPrefill` and call `openAddDialog({ urls, referrer })` (an empty dialog when there is none). The right-click menu (Task 3.14) opens the page this way.
  - Layout: sidebar left and table right from 760 px up, stacked below; the table scrolls inside its container, the page never scrolls sideways at 360 px. Only `.ui-*` classes and `--c-*` variables, plus `dl-*` classes in `list.css`.

- [ ] **Step 1: Write `test/dl/list.mjs` (failing).** Pages are `extPage(t, 'downloads.html')`; downloads come from the fixture.
  - **Shell:** the title equals `T.listTitle`; the toolbar buttons' names are exactly the six `T` texts in order; the column headers are the five `T` texts; the sidebar lists `All downloads`, `Unfinished`, `Finished`, six categories and one queue; an empty profile shows `T.emptyAll`.
  - **Add:** the toolbar's Add opens the dialog; submitting `<fixture file 1>\n<fixture file 2>\nnot a url` closes it, shows `T.addSkipped(1)` in the status line, and two rows appear; submitting only `not a url` keeps it open with `T.addNone`; choosing the queue and the category sets them on the records (`categoryFixed` true); Esc closes without adding.
  - **Live rows:** a 40 MB file at `rate=8000000`: the row's `<progress>` value increases between two reads 1.5 s apart while the row element (`data-id`) is the same node (tag it with a property before and read it after); size, speed and time-left cells fill in.
  - **Sorting:** with three rows named `b.bin`, `A.bin`, `c.bin`, clicking Name gives `A.bin`, `b.bin`, `c.bin` and `aria-sort="ascending"`, a second click reverses it; sort by Size puts a row with an unknown size last in both directions.
  - **Filters:** a `.zip`, a `.mp4` and a `.pdf` row: the Archives filter shows one row; the Finished filter shows `T.emptyFiltered` while nothing is done; the queue filter lists them all.
  - **Pause, Resume, Delete:** select a running row: Pause makes its status `T.st.paused`; Resume makes it run again (the next request starts above 0); Delete opens the dialog with `T.confirmDeleteUnfinished(1)`; Cancel keeps the row; Delete removes it and its `<id>.part` file in OPFS; selecting two rows and deleting reads `T.confirmDeleteUnfinished(2)`; Shift-click selects a range; the three buttons are disabled with no selection.
  - **Failed rows:** a record that failed with `ERRORS.changed` shows that sentence and `T.retryInChrome`; pressing it makes Chrome download the file and removes the row.
  - **Done rows:** after a download finishes the row shows `T.st.done('Archives')` and `T.showInFolder`; pressing it raises no page error.
  - **Off:** after `setDownloads(t, { on: false })` the banner `T.offBanner` and `T.turnOn` show; a paused record can still be resumed and runs; pressing `T.turnOn` removes the banner and stores `on: true`.
  - **Prefill:** write `dlPrefill` to session storage through `t.sw`, open `downloads.html#add`: the dialog is open with the URLs in the textarea and `dlPrefill` is deleted; submitting adds records with `source: 'menu'` and the referrer.
  - **Honesty:** the page's text contains none of "faster", "accelerat", "boost", "turbo", "speed up" (case-insensitive).
  - **No errors and screenshots:** no page errors; save `$SHOTS/dl-list-light.png` and `dl-list-dark.png` (`page.emulateMedia({ colorScheme })`) with five rows in mixed states; view them.
- [ ] **Step 2: Implement and run.** Run `pnpm --filter sieve typecheck && pnpm --filter sieve build && node apps/sieve/test/dl/e2e.mjs --only list`. Expected: FAIL, then PASS. Then `pnpm --filter sieve test:e2e`.
- [ ] **Re-sync with upstream (the last step before the commit).** Re-read, at the current HEAD, the upstream files named in this task's "Builds against" line; rerun this task's tests against the real implementations (not the contract stubs); fix every mismatch. If an upstream implementation has not landed, send `[BLOCKED]` to the controller and end the turn. A difference from the published contract is a `[CONTRACT-CHANGE]` question to the controller, never a silent choice.
- [ ] **Step 3: Commit** by pathspec with the message `Sieve: download list page`. No test file to list (the module is e2e).

### Task 3.16: List page: speed limit and scheduler dialogs

**Files:**
- Modify (Task 3.15's stubs): `apps/sieve/src/dl/limit-dialog.ts`, `apps/sieve/src/dl/scheduler-dialog.ts`
- Create: `apps/sieve/src/dl/queues-editor.ts`, `apps/sieve/test/dl/list-dialogs.mjs`

**Parallel:** after Task 3.15 (it replaces its two stubs and adds a module). Task 3.18 reuses `queues-editor.ts`, so it waits for this one. Shared files: none.

**Builds against:** Task 3.15 (`limit-dialog.ts` and `scheduler-dialog.ts` stubs, `list.ts`), Task 3.7 (`saveDownloads`, `onDownloadsChanged`), Task 3.6 (`T`).

**Interfaces:**
- Produces, in `limit-dialog.ts`: `export function openLimitDialog(): void`. A `<dialog>` with a switch (`role="switch"` checkbox) labelled `T.limitOn`, a number input labelled `T.limitValue` (`min` 10, `max` 1000000, `step` 10), the note `T.limitNote`, and a `T.close` button. Each change writes `saveDownloads(s => ({ ...s, speedLimit: { ...s.speedLimit, on / kbPerSecond } }))`; after a write the input shows the stored (clamped) value; the dialog follows `onDownloadsChanged` without taking focus from an input being edited. The toolbar button `T.speedLimit` shows `aria-pressed="true"` while the limit is on (the list page sets it; add that to `list.ts` in this task, the only edit to Task 3.15's file, one line).
- Produces, in `queues-editor.ts`: `export function queuesEditor(): HTMLElement` shared by the scheduler dialog and the settings page. For each queue a `<fieldset>` with: a text input labelled `T.setQueueName` (1 to 40 characters), a number input labelled `T.scheduleParallel` (1 to 8), a switch `T.scheduleUse`, seven day checkboxes labelled with `T.days`, a `time` input labelled `T.scheduleStart`, a `time` input labelled `T.scheduleStop` and a checkbox `T.scheduleNoStop` (checked means `stop: null` and disables the stop input), and a button `T.setRemoveQueue(name)` (absent for the first queue, which is the default and cannot be removed). Below the fieldsets, a button `T.setAddQueue`, disabled at `MAX_QUEUES` (8). A new queue is `{ id: 'q<n>', name: 'Queue <n>', maxParallel: 3, schedule: { on: false, days: [0..6], start: '01:00', stop: '07:00' } }` with `n` the smallest number at least `queues.length + 1` whose id `q<n>` is not used (the default queue's id is `main`, so the first added queue is `Queue 2` with id `q2`; after removing it the next one is `q2` again; with queues `main` and `q2` the next is `q3`). Every control writes through `saveDownloads` (which validates, so ids, names and times are repaired the same way everywhere) and follows `onDownloadsChanged`, updating values in place and leaving a focused control alone. Removing a queue leaves its records in place; they then belong to the first queue (Task 3.4 rule).
- Produces, in `scheduler-dialog.ts`: `export function openSchedulerDialog(): void`, a `<dialog>` titled `T.schedulerTitle` holding `queuesEditor()` and a `T.close` button.

- [ ] **Step 1: Write `test/dl/list-dialogs.mjs` (failing).**
  - **Speed limit dialog:** the toolbar button opens it; the switch stores `speedLimit.on: true`; typing 5 in the number input stores 10 and the input then shows 10; 2000000 stores 1,000,000; the toolbar button has `aria-pressed="true"` while it is on; a limit of 1000 KB/s slows a running download below 1.5 MB/s measured over 3 s (reuse the fixture's `rate=8000000`); Esc and `T.close` close it; a change made from another page (`setDownloads`) updates the open dialog's switch.
  - **Scheduler dialog:** it lists the default queue with its name, 3 downloads at once, the schedule switch off; turning it on stores `schedule.on: true`; unchecking Sunday stores `days` without 0; setting start `22:00` and stop `06:00` stores them; `T.scheduleNoStop` stores `stop: null` and disables the stop input; `Add a queue` adds `Queue 2` (id `q2`), renaming it to `Night` stores `Night`; the remove button is absent for the first queue and removes the second; at 8 queues `Add a queue` is disabled; a queue name of 41 characters is stored as the repaired value (`validateDownloadSettings` falls back to `Queue <position>`) and the input then shows it.
  - **Two writers:** two pages each change a different field of the same queue at the same moment; both values land.
  - **Records and queues:** removing a queue that holds a queued record leaves the record, and the engine starts it under the first queue's rules.
  - **No errors; screenshots** `$SHOTS/dl-scheduler-light.png` and `-dark.png`.
- [ ] **Step 2: Implement and run.** Run `pnpm --filter sieve typecheck && pnpm --filter sieve build && node apps/sieve/test/dl/e2e.mjs --only list,list-dialogs`. Expected: FAIL, then PASS.
- [ ] **Re-sync with upstream (the last step before the commit).** Re-read, at the current HEAD, the upstream files named in this task's "Builds against" line; rerun this task's tests against the real implementations (not the contract stubs); fix every mismatch. If an upstream implementation has not landed, send `[BLOCKED]` to the controller and end the turn. A difference from the published contract is a `[CONTRACT-CHANGE]` question to the controller, never a silent choice.
- [ ] **Step 3: Commit** by pathspec with the message `Sieve: speed limit and scheduler dialogs`.

### Task 3.17: The menu's Downloads tab

**Files:**
- Create: `apps/sieve/src/dl/popup-downloads.ts`, `apps/sieve/test/dl/popup.mjs`
- Modify (appended lines only, one short window at the end): `apps/sieve/src/popup.ts`, `apps/sieve/src/popup.css`, `apps/sieve/test/e2e.mjs` (one check, below)

**Parallel:** after Tasks 3.6, 3.11 and 3.15 (it opens the list page and uses `dl-add`, `dl-do`). Alongside Tasks 3.16, 3.18 and 3.19; it shares no file with them. Shared-file windows: `popup.ts`, `popup.css` and `e2e.mjs`; no other Phase 3 task edits them.

**Builds against:** Task 3.6 (`T`, `parseAddInput`, formatters), Task 3.7 (`saveDownloads`, `readDownloads`), Task 3.10 (`readAllRecords`), Task 3.11 (`dl-add`, `dl-do`), Task 3.15 (`downloads.html`).

**Interfaces:**
- Produces, in `popup-downloads.ts`: `export const downloadsTab: { id: 'downloads'; label: string; view: (state: unknown) => Child[] }` with `label` `T.sectionTitle` ("Downloads", the design's tab name). `view` returns one persistent panel element (the same node every call), which updates itself in place from IndexedDB and the live messages, so the menu's own re-render never rebuilds it. Contents:
  - A switch (`toggle` from `controls.ts`) labelled `T.menuOn`, `data-id="downloads-on"`, writing `saveDownloads(s => ({ ...s, on }))`; when off, the line `T.menuOff` shows and the list is dimmed.
  - Up to five active downloads (records `running`, `saving`, `queued` or `paused`; running ones first, then by `addedAt`): the name (one line, ellipsis), a `<progress>` (`aria-label` `T.progressLabel(name)`), `formatSpeed` and, per row, a button `T.pause` (running or queued) or `T.resume` (paused) sending `dl-do`. When there are none, the line `T.menuNone`.
  - A button `T.menuAdd` that shows an inline `<textarea>` (labelled `T.addLabel`) and a `T.addSubmit` button; submit uses `parseAddInput`, shows `T.addNone` or `T.addSkipped(n)`, sends `dl-add` with `source: 'manual'` and the default queue and category, and clears the box on success; a reply with `ok: false` shows its message or `T.addFailed`.
  - A button `T.menuSeeAll` that focuses a tab already showing `downloads.html` or opens one, then `window.close()`.
  - There is no "media found on this page" section in this phase. It arrives with media detection in Phase 4 (design: the menu's Downloads tab). Do not render a placeholder.
- `popup.ts` edits (the only edits): add `import { downloadsTab } from './dl/popup-downloads.ts';` with the other imports, and after the line `let current = tabs[0].id;` add `tabs.splice(1, 0, downloadsTab);` (the design orders the tabs Blocking, Downloads, YouTube; Phase 2 adds its tab with its own line, and the splice keeps Downloads second whichever lands first). `popup.css` gets one appended block, introduced by the comment `/* Downloads tab (phase 3) */`, with `dl-` classes only (the popup is 340 px wide).
- `e2e.mjs` edit: the check at the line containing "and no tab bar (one tab)" now has two tabs. Change its name to "the menu has the header switch, the site switch and four feature switches, and a tab bar with Blocking and Downloads" and its condition to `switchCount === 6 && (await m.pop.locator('[role=tablist] [role=tab]').count()) >= 2` (the Downloads panel is not in the page while the Blocking tab is current, so the switch count stays 6). Phase 2 changes the same line; "Merge notes" gives the resolution.

- [ ] **Step 1: Write `test/dl/popup.mjs` (failing).** The menu is `popup.html?tab=<tabId>` as in Phase 1's checks.
  - **Tab bar:** the menu shows tabs `Blocking` and `Downloads`; it opens on Blocking; pressing `Downloads` shows the panel; the header switch and the Blocking tab's switches are unchanged.
  - **Empty:** with no records the panel shows `T.menuNone`, the switch `T.menuOn` is on, and `T.menuAdd`, `T.menuSeeAll` are present.
  - **Switch:** turning it off stores `on: false` and shows `T.menuOff`; turning it on removes the line.
  - **Active list:** with three records (running, paused, queued) the panel lists them, running first; at most five rows with six records; the running row's progress advances live and shows a speed; `T.pause` on it makes the row's button `T.resume` and the record `paused`; `T.resume` runs it again.
  - **Add:** `T.menuAdd` shows the box; `https://…/file/3000000/m1.bin\nnot a url` adds one record and shows `T.addSkipped(1)`; only `not a url` shows `T.addNone`.
  - **See all:** `T.menuSeeAll` opens a tab at `downloads.html` (a second press focuses the same tab instead of opening another).
  - **No media section:** the panel text does not contain "media" or "found on this page".
  - **No errors; screenshots** `$SHOTS/dl-menu-light.png` and `-dark.png`.
- [ ] **Step 2: Implement, wire the shared files, and run.** Run `pnpm --filter sieve typecheck && pnpm --filter sieve build && node apps/sieve/test/dl/e2e.mjs --only popup && pnpm --filter sieve test:e2e`. Expected: PASS, with Phase 1's menu checks passing.
- [ ] **Re-sync with upstream (the last step before the commit).** Re-read, at the current HEAD, the upstream files named in this task's "Builds against" line; rerun this task's tests against the real implementations (not the contract stubs); fix every mismatch. If an upstream implementation has not landed, send `[BLOCKED]` to the controller and end the turn. A difference from the published contract is a `[CONTRACT-CHANGE]` question to the controller, never a silent choice.
- [ ] **Step 3: Commit** by pathspec with the message `Sieve: Downloads tab in the menu`.

### Task 3.18: Settings page: the Downloads section

**Files:**
- Create: `apps/sieve/src/dl/options-downloads.ts`, `apps/sieve/test/dl/settings.mjs`
- Modify (appended lines only, one short window at the end): `apps/sieve/src/options.ts`, `apps/sieve/src/options.css`

**Parallel:** after Tasks 3.6, 3.7, 3.10, 3.13 and 3.16 (it reuses `queuesEditor`, and its check that take-over rules apply needs the take-over wiring). Alongside Tasks 3.17 and 3.19. Shared-file windows: `options.ts` and `options.css`; no other Phase 3 task edits them.

**Builds against:** Task 3.6 (`T`), Task 3.7 (`saveDownloads`, `onDownloadsChanged`), Task 3.16 (`queuesEditor`), Task 3.13 (the take-over wiring, for the rules check), Task 3.10 (`_fixture.mjs`).

**Interfaces:**
- Produces: `export function downloadsSection(): HTMLElement`, a `<section id="downloads">` with `<h2 class="ui-heading">` `T.sectionTitle`. Every control writes through `saveDownloads` (which validates) and shows the stored value afterwards (so a clamped number shows its clamp); the section follows `onDownloadsChanged` and updates controls in place, leaving a focused or edited control alone. In order:
  1. A switch `T.setOn` with the help line `T.setOnHelp`.
  2. A group "take over": a switch `T.setTakeOver`; a number input `T.setMinMb` (0 to 100000); a `<textarea>` `T.setExtensions` (help `T.setExtensionsHelp`; the value is the extensions joined by a space; saved on `change`, split on spaces, commas and newlines); a `<textarea>` `T.setMime` (help `T.setMimeHelp`; one per line); a button `T.setResetTypes` that stores `DEFAULT_TAKEOVER_EXTENSIONS` and `DEFAULT_TAKEOVER_MIME_TYPES`.
  3. A number input `T.setParts` (1 to 6) with the help line `T.setPartsHelp`.
  4. A group `T.setSpeed`: the switch `T.limitOn` and the number input `T.limitValue`.
  5. A group `T.setCategories` (help `T.setCategoriesHelp`): per category a text input labelled `T.setFolder(<T.categoryNames[id]>)` and, except for `other`, a text input labelled `T.setCategoryExt(<name>)` (extensions separated by spaces).
  6. A group `T.setQueues` containing `queuesEditor()` (Task 3.16).
- `options.ts` edits (the only edits): `import { downloadsSection } from './dl/options-downloads.ts';` with the other imports, and as the last line `document.getElementById('app')!.append(downloadsSection());`. `options.css` gets one appended block introduced by `/* Downloads section (phase 3) */`, `dl-` classes only. The settings page's width is 720 px; keep the section within it.

- [ ] **Step 1: Write `test/dl/settings.mjs` (failing).** The page is `extPage(t, 'options.html')`.
  - **Rendering:** the section heading is `T.sectionTitle`; every control above is reachable by its label; the default values match `DEFAULT_DOWNLOADS` (minMb 5, parts 1, speed limit off at 1000, 56 extensions in the box, 31 content types, six folders).
  - **Writes and clamps:** `T.setMinMb` 7.6 stores 8; 1e9 stores 100000; `T.setParts` 9 stores 6 and the input shows 6; `T.limitValue` 5 stores 10; a folder `a/b` is stored as that category's default folder and the input shows it; `Clips` stores `Clips`.
  - **Lists:** typing `.MP4, mkv bad! x` in the extensions box stores `['mp4', 'mkv']` (the others are dropped, the box then shows `mp4 mkv`); a content-types box with `Video/*` and `bad` stores `['video/*']`; `T.setResetTypes` restores both defaults.
  - **Take-over rules apply:** with `minMb` 1 and the extension list `zip`, a 2 MB `.zip` is taken over and a 2 MB `.rar` is not (take-over wiring, Task 3.13).
  - **Parts:** the help text `T.setPartsHelp` is on screen; setting 3 makes a new 30 MB download use three ranged connections (the fixture log); it never appears next to the word "faster" or "boost".
  - **Switch:** `T.setOn` off stores `on: false`; the list page's banner shows it (open `downloads.html`).
  - **Two writers:** two settings pages change different fields at once; both land. A change made from the worker (`setDownloads`) updates the matching control while another control has focus, and an edited textarea is not overwritten.
  - **Queues:** the section's queue editor adds, renames and removes queues exactly as in Task 3.16 (one smoke check).
  - **No errors; screenshots** `$SHOTS/settings-downloads-light.png` and `-dark.png`; phase 1's settings-page checks still pass.
- [ ] **Step 2: Implement, wire the shared files, and run.** Run `pnpm --filter sieve typecheck && pnpm --filter sieve build && node apps/sieve/test/dl/e2e.mjs --only settings && pnpm --filter sieve test:e2e`. Expected: PASS.
- [ ] **Re-sync with upstream (the last step before the commit).** Re-read, at the current HEAD, the upstream files named in this task's "Builds against" line; rerun this task's tests against the real implementations (not the contract stubs); fix every mismatch. If an upstream implementation has not landed, send `[BLOCKED]` to the controller and end the turn. A difference from the published contract is a `[CONTRACT-CHANGE]` question to the controller, never a silent choice.
- [ ] **Step 3: Commit** by pathspec with the message `Sieve: Downloads section in settings`.

### Task 3.19: Loss and restart torture checks

**Files:**
- Create: `apps/sieve/test/dl/torture.mjs`

**Parallel:** after Tasks 3.10, 3.11, 3.12 and 3.13 (the router's `reconcile` is what brings the engine back after a SIGKILL); alongside Tasks 3.15 to 3.18. It adds one module file and edits nothing else. Shared files: none.

**Builds against:** Task 3.10 (`_fixture.mjs`, `readAllRecords`), Task 3.12 (`_raw-chrome.mjs`), Task 3.11 (`reconcile`), Task 3.13 (the take-over wiring).

**Interfaces:** one e2e module, `export async function run(t)`. It uses the raw-CDP Chrome of Task 3.12 (`_raw-chrome.mjs`) for every check that kills the browser, because Playwright cannot kill a context's browser with SIGKILL and rewrites download folders (inspected F10). The fixture runs in this process, so it survives the kills. After a kill, `launchRaw({ profileDir, downloadsDir })` with the same folders starts Chrome again on the same profile: IndexedDB and OPFS persist (inspected F7), session storage and alarms do not (the harness re-installs the unpacked extension on each launch, inspected F15), so the worker's start-up `reconcile()` (Task 3.11) is what brings the engine back, as it would after a real restart. Helpers local to the file: `waitRecord(raw, predicate)` (reads the `records` store through `raw.evalPage`), `verifyFile(path, size)` (streams the file and compares every byte with the pattern), and `sentBytes(fx.log)`.

- [ ] **Step 1: Write the checks (failing until the whole engine works).** Each uses a fresh `profileDir` and `downloadsDir`.
  1. **SIGKILL mid-download, one part.** Add `/file/120000000/k.bin?rate=15000000`. Poll the stored `done` of the record every 500 ms; when it passes 40,000,000 bytes, remember the last polled value `D` and `raw.kill('SIGKILL')`. Relaunch. Within 60 s the record is `done`. Assert: the first request after the relaunch has a `Range` start `N` with `N > 0` and `N >= D` (never from zero, never behind the last checkpoint seen); the saved file `<downloadsDir>/Other/k.bin` has 120,000,000 bytes and verifies; the fixture sent in total at most `120,000,000 + 16,777,216` bytes over both runs (the re-sent tail is at most one checkpoint plus read-ahead); there is exactly one file in `downloadsDir` and no `.crdownload`.
  2. **SIGKILL with three parts.** The same with `parts: 3` (set through `setDownloads` before the add, via `raw.evalPage`) and a 150 MB file: every part resumes from its own saved offset (the first request after the relaunch for each part range starts at or above that part's last polled `done`), the file verifies, the total sent is at most size plus `3 * 4_194_304 + 4_194_304`.
  3. **The engine document closed five times.** A 150 MB file with 3 parts at `rate=20000000`: every second `chrome.offscreen.closeDocument()` through `raw.evalSw`, five times; each time the next `dl-do` (or the watchdog) brings the engine back. The file verifies and the total sent is at most size plus `5 * (3 * 4_194_304 + 4_194_304)`; no request after the first completed range ever starts at 0.
  4. **SIGKILL while saving.** Wrap `chrome.downloads.download` (through `raw.evalSw`) so the item is paused right after it starts, wait for the record to be `saving`, `kill`, relaunch: the record saves again and ends `done`; `<downloadsDir>/<Category>/<name>` exists once, verifies, and `<id>.part` is gone afterwards (a `.crdownload` left by the kill is not counted as the file).
  5. **SIGKILL after a take-over.** Open `/page?to=/file/100000000/t.zip?rate=15000000` as a page (a person's download). When the record (`source: 'takeover'`) has more than 30,000,000 bytes, kill; relaunch: it completes, `<downloadsDir>/Archives/t.zip` verifies, and exactly one such file exists (Chrome's cancelled original left no file).
  6. **Delete cleans up.** Delete a running record (`dl-do remove`): within 3 s its `<id>.part` is gone from OPFS, its session rules are gone, and `navigator.storage.estimate().usage` is below its value before the download plus 5 MB.
  7. **Orphan sweep.** From an extension page create OPFS files `dzzzz.part` (no record) and `notes.txt`; close the engine and make the next `dl-do` re-create it: `dzzzz.part` is gone, `notes.txt` remains, and the part file of a live record is untouched.
  8. **Nothing is left behind.** After every check, no `dlTakeover:*` key is left in `chrome.storage.local`, and no `dlSave:*` key exists for a finished record.
  Print, for the handoff, the bytes re-sent after each kill and the time from relaunch to the first byte.
- [ ] **Step 2: Run.** Run `pnpm --filter sieve build && node apps/sieve/test/dl/e2e.mjs --only torture`. Expected: PASS, in under 4 minutes. A failure here is a real loss bug: fix the engine task that owns it, do not weaken the check.
- [ ] **Re-sync with upstream (the last step before the commit).** Re-read, at the current HEAD, the upstream files named in this task's "Builds against" line; rerun this task's tests against the real implementations (not the contract stubs); fix every mismatch. If an upstream implementation has not landed, send `[BLOCKED]` to the controller and end the turn. A difference from the published contract is a `[CONTRACT-CHANGE]` question to the controller, never a silent choice.
- [ ] **Step 3: Commit** by pathspec with the message `Sieve: restart and loss checks for downloads`.

### Task 3.20: Phase close: ordinary pages, idle memory, owner checklist, review

**Files:**
- Create: `apps/sieve/test/dl-perf.mjs` (a standalone script; it is not under `test/dl/`, so the runner does not pick it up)
- Modify: `apps/sieve/README.md`, `apps/sieve/src/manifest.json` (`"version": "0.3.0"`), `docs/handoffs/sieve.md`, `package.json` test lists if the controller's batches missed a file (this step checks)

**Parallel:** last. Exclusive use of the machine for the perf runs (take the `chrome-live` machine lock; `WAIT_S` at most 540). The README and the handoff are edited only here (decision 23).

- [ ] **Step 1: Write `dl-perf.mjs`.** It has three parts and prints a table:
  - **Content scripts unchanged (anti-goal 1):** parse `dist/manifest.json` and the manifest of the base commit (`git show 47c7ea4:apps/sieve/src/manifest.json`); their `content_scripts` arrays must be deep-equal, and `dist` has no registered-script id starting with `dl` (`chrome.scripting.getRegisteredContentScripts()` through the worker).
  - **Idle close and memory at rest:** with no unfinished record, no offscreen document exists after a restart; after one 5 MB download finishes, the document is gone within 75 s without any message (the engine's 60 s idle timer, Task 3.8, and the router's `dl-sw-idle`, Task 3.11); the worker's start-up cost: median of 5 cold worker starts to the first `dl-do` reply at most 300 ms more than Phase 1's worker start (the start does only the work listed in Global Constraints) (measure Phase 1 by the same method on the base build exported to a temp folder, or record absolute numbers if that is impractical, and say which).
  - **Ordinary pages:** the local-page part of `perf.mjs` (20 loads with and 20 without the extension on a plain page) with the downloads code present, median `domContentLoadedEventEnd` at most 20 ms more with the extension; reuse `perf.mjs` by running it (it takes about ten minutes; its real-site part is part of the gate in Step 2).
- [ ] **Step 2: Run the full phase gate** from a clean export of the branch HEAD (`git archive HEAD | tar -x -C <empty dir>`, copy `apps/sieve/filters/cache/` in, `pnpm install --frozen-lockfile`): `pnpm test && pnpm typecheck && pnpm --filter sieve build && pnpm --filter sieve test:e2e && node apps/sieve/test/dl/e2e.mjs --big && node apps/sieve/test/dl-perf.mjs && node apps/sieve/test/perf.mjs` (the last two under the machine lock). Expected: everything passes; paste the tables, the take-over pause latency, the `--big` memory numbers and the torture re-send numbers into the handoff.
- [ ] **Step 3: Check the test lists.** A throwaway shell check: every `*.test.ts` under `packages/sieve-core/src/__tests__` and `apps/sieve/src/__tests__` appears in its package's `test` script. Add what is missing in one commit.
- [ ] **Step 4: Review.** Run the `code-reviewer`, `requirements-verifier` and `invariant-reviewer`-style checks on the branch diff against design goal 3, anti-goals 1 to 4, this plan's Review Focus and Global Constraints; fix what they confirm. Pay special attention to: any place the take-over cancels before the engine acknowledged; any `catch` that hides a failed save; any state held only in the worker's memory.
- [ ] **Step 5: Write the README's Downloads section.** It covers: what the engine does and where its pieces live (offscreen document, Worker, OPFS, IndexedDB `sieve-dl`, the `downloads` settings key, `dl-*` messages in one short table); the four permissions added and why (`alarms`, `contextMenus`, `downloads`, `offscreen`); that no content script was added; the defaults (take over files over 5 MB of the listed types, 1 part, no speed limit, categories as folders in Downloads, one queue); how the take-over decides and what falls back to Chrome; the known limits gathered from each task's report, including: a server that cannot resume is left to Chrome when Chrome starts the download but downloaded in one go when added by hand; a POST download cannot be recognised and ends in Chrome; Referer is applied by session rules and is missing for a URL containing `*` or `^` and for "Retry in Chrome"; a one-time link that allows two uses could be taken over and then fail; a scheduled queue with no stop time runs until midnight (the label says so); a file replaced on the server by another of the same size, when the server sent no ETag or Last-Modified, cannot be detected; a link whose probe Chrome refuses to read (for example a server that answers a ranged request with a gzip body) is left to Chrome on take-over and fails with "Retry in Chrome" when added by hand; "Retry in Chrome" keeps the record until Chrome's download has received a byte, and keeps it if that is not seen within 10 s; a file too big for the disk twice over is left to Chrome; Daylight-saving days shift scheduler windows by an hour; the finished file briefly needs twice the disk space (take-over checks this up front and leaves Chrome's download alone when it will not fit; a manual add checks only the first copy, and a save that then runs out of room fails with a plain message and keeps the private copy); after a browser restart a download that was being saved can be saved a second time as `name (1).ext`; alarms are checked in an unpacked extension only; Chrome's download bubble may flash during a take-over (not verified headless).
- [ ] **Step 6: Write the owner checklist** (README, numbered; each item says what to do and what to see):
  1. Reload Sieve; the menu has a Downloads tab; its switch turns taking over off and on.
  2. In your own Chrome, download a file over 5 MB of a listed type from a site you use. It appears in "Sieve downloads" and ends in `Downloads/<category>/`. A file under 5 MB stays Chrome's.
  3. While a large download runs, quit Chrome completely (Cmd+Q), reopen it: the download continues from where it stopped, not from 0%, and finishes. Repeat with Force Quit. Check the file opens.
  4. Download a file that needs your login (an account file). It arrives whole, whether Sieve or Chrome handled it.
  5. A one-time download link still arrives (Chrome keeps it when Sieve cannot repeat the request).
  6. Set parts per file to 3 on a server you use; nothing on screen promises a speed-up; set it back to 1 if the server complains.
  7. Set the speed limit to 1000 KB/s: the Speed column stays near it. Turn it off.
  8. Make a queue that starts two minutes from now; add a download to it: it waits, then starts by itself.
  9. Right-click a link, a selection of links and an empty part of a page: the three Sieve items open the Add dialog with the right addresses.
  10. Make a download fail (add a link that has expired) and press "Retry in Chrome".
  11. Turn Downloads off: Chrome handles new downloads itself, the right-click items are gone, the list still resumes what is in it.
  12. With the disk nearly full, a large add says there is not enough space instead of failing late.
  13. Wait a minute after the last download finishes and open Chrome's task manager (Shift+Esc on Windows and Linux; Window menu, Task Manager on Mac): there is no "Offscreen document".
  14. Browse as usual for a day: pages load as before, and nothing extra appears on web pages.
  15. Restart Chrome with a scheduled queue pending and confirm it still starts on time (alarm persistence over a real restart was not verifiable in the harness).
- [ ] **Step 7: Update the handoff and the manifest.** Read `.superpowers/phase-3/progress.md` (the controller's ledger) and copy each task's reported limits into the handoff. `docs/handoffs/sieve.md`: session log, current state, next step ("merge order: Phase 2, then Phase 3 rebased; then plan Phase 4"), the facts F1 to F17 under "Verified facts" with the probe folder, the "Not found" list, the resolved merge notes, the decisions and questions below. Set `"version": "0.3.0"` in `manifest.json`. Commit by pathspec with the message `Sieve: phase 3 checks and hand-off`.

---

## Decisions I made

Each is a choice the design or the owner leaves open, with why and what it costs if wrong.

1. **The owner's answers are decisions here.** Take over files over 5 MB of the types this plan lists; 1 part per host by default, configurable 1 to 6, a 429 or 503 means fewer parts (rule in Task 3.2); categories are subfolders of Downloads; the speed limit is off by default; the Downloads tool has its own switch, `downloads.on`, default true, stored in the new key `downloads` (the header "Sieve on" keeps meaning blocking; Phase 2 adds `youtube.on` the same way and this plan does not touch its files).
   - Why: the owner's instruction of 2026-11-10. Cost if wrong: none; they are settings.
2. **The default type list is the five category lists (56 extensions) plus 31 MIME types, and the floor is "greater than 5,000,000 bytes".** This is the "default take-over types and minimum size are decided when this phase is planned" item of the outline plan. `application/octet-stream` is on the MIME list so unnamed binaries over 5 MB are caught; `txt`, `csv`, `html` and source-code extensions are left out.
   - Why: IDM-style rules need a list, and the owner named archives, disk images, installers and programs, video, audio and documents. Cost if wrong: a type is missed or taken that should not be; both are one edit in settings.
3. **Take-over requires a 206 answer to the probe.** A server that cannot resume stays with Chrome (`no-range`), although the engine can download such a URL when the owner adds it by hand (in one go, restarting from the start after an interruption, and the list says so).
   - Why: anti-goal 3; taking over a file the engine cannot resume gains nothing and risks a restart from zero. Cost if wrong: such downloads miss the queue and category features. (Question 1.)
4. **The probe is `GET` with `Range: bytes=0-0`, 8 s limit, with the page's cookies and, through a session rule, its referrer.** A `HEAD` request lies on many servers; a one-byte range answers size, type and range support together.
   - Cost if wrong: a few servers answer a one-byte range differently from a download; they fail the comparison and Chrome keeps the download.
5. **429 and 503: halve the connections for that host (never below 1), remember it 30 minutes, back off 2, 4, 8, 16 s, honour `Retry-After` up to 60 s, fail at the fifth in a row.**
   - Why: the only firm data (OVH refusing 2 of 6) says refusals appear above some small number; halving converges in two steps without guessing the number. Cost if wrong: a host that would have accepted 5 gets 3.
6. **Final path is `Downloads/<category>/<name>`, not `Downloads/Sieve/<category>/…`.** The design says `Downloads/<category>/`; Phase 2's screenshots use `Downloads/Sieve/`. Name collisions use Chrome's `uniquify` (`name (1).ext`); file names are sanitised by the exact rule in Task 3.5.
   - Cost if wrong: files land beside the owner's other downloads of the same kind instead of apart. (Question 2.)
7. **The engine's state is owned by one writer: the Worker, in IndexedDB.** Pages read IndexedDB for the first paint and use broadcasts for live numbers; the service worker also reads it (for rules, alarms and the decision to create the engine). `chrome.storage` is not available to the offscreen document (inspected F1).
   - Cost if wrong: a second writer would need a lock; the single writer avoids that.
8. **The service worker holds no download state and needs no keep-alive.** The engine lives in the offscreen document (inspected F3); every worker handler re-reads session storage or IndexedDB; a watchdog alarm and a start-up `reconcile()` repair a dead engine.
   - Cost if wrong: if Chrome ever closes the offscreen document on its own, the watchdog brings it back within a minute.
9. **Referer and the allow rule are declarativeNetRequest session rules,** because `fetch` cannot set Referer and `chrome.downloads` refuses it (inspected F13), and because Sieve's own blocking would otherwise stop the engine's requests (inspected F14). The allow rule is priority 2,000,000,000 and the Referer rules one higher.
   - Cost if wrong: if Phase 1's rule priorities ever exceed 2e9, downloads from blocked hosts fail with a visible status; the constant is one line.
10. **Our own saves are recognised by `blob:` URL, by `byExtensionId` and by a remembered retry-URL set,** not by `byExtensionId` alone, because it is absent in `onCreated` (inspected F9).
    - Cost if wrong: none seen; the three checks overlap.
11. **The private copy is deleted only after Chrome says `complete` with the right size; after a restart a `saving` record saves again.** A duplicate `name (1).ext` is possible; a loss is not.
    - Cost if wrong: an occasional duplicate to delete by hand.
12. **Context menus open the Add dialog with the addresses filled in, instead of adding at once.** There is no content script to show feedback on the page, and "all links" can be hundreds of addresses, so the owner confirms, picks the queue and category, and sees the list. Links for "selected" and "all" are read by `chrome.scripting.executeScript` only when the item is clicked.
    - Cost if wrong: one extra click per right-click download. (Question 3.)
13. **`dl-menu-click` is a message only extension pages may send; it exists so the e2e can click native menus.** It does exactly what a menu click does.
    - Cost if wrong: none; a web page cannot send it.
14. **Six fixed categories (Video, Music, Programs, Archives, Documents, Other); the owner edits folder names and extension lists, not the set.**
    - Cost if wrong: adding a category later needs a settings migration.
15. **Queues: the default is one "Main queue" (3 at once); more can be added (up to 8) with a daily window (start, optional stop, chosen days).** Pressing Resume starts a download now whatever the window or slot count (`force`). A removed queue's records move to the first queue.
    - Cost if wrong: IDM's separate "stop all" button is not here; Pause covers it.
16. **The speed limit is one shared token bucket in KB/s (1 KB = 1000 bytes), burst a quarter second (at least 64 KiB).**
    - Cost if wrong: a few chunks overshoot the limit at the start of a download.
17. **`downloads.on` false:** no take-over, no menus, nothing starts by itself, running non-forced downloads go back to the queue; records stay and Resume on the list still runs them.
    - Cost if wrong: one condition in `schedulePlan`.
18. **The engine document closes itself after 60 s with nothing to do and the worker reopens it for work, so an idle Chrome carries no extra process (anti-goal 1).** A 1-minute watchdog alarm exists only while work is runnable.
    - Cost if wrong: a one-second delay when work arrives after an idle spell.
19. **Parts default to 1 and the settings text says plainly that more parts often change nothing.** Re-splitting runs only when parts is above 1; resume across restarts works with one part (ranges), as the owner asked.
    - Cost if wrong: none; honesty about speed is a requirement.
20. **The engine core and the transfer are in `sieve-core` behind ports (`dl-ports.ts`), not in the extension.** "Pure" here means no `chrome.*` and no DOM; they use web-standard `fetch` types and streams that Node also has. That makes the anti-goal 3 rules testable with `node --test` and fakes.
    - Cost if wrong: none.
21. **The e2e uses Playwright for most checks and a raw-CDP Chrome (Node's `WebSocket`) for real folders and SIGKILL,** because Playwright rewrites the download location and cannot kill the browser (inspected F10). A fixture server (`_fixture.mjs`) provides ranges, 429, redirects, one-time links, throttling and a changing file.
    - Cost if wrong: about 80 lines of helper.
22. **No change to `test/harness.mjs` and no change to Phase 2's files.** The dl e2e runner discovers `test/dl/*.mjs`, so later tasks add files, not edits.
23. **README and handoff are edited once, in Task 3.20.** Each task reports its limits in its hand-back; the controller keeps them in the ledger.
24. **The menu's Downloads tab has no "media found on this page" section in this phase.** It shows the Downloads switch, active downloads with progress, Add URL and Open download list; the media section arrives with media detection in Phase 4 (design: the menu's Downloads tab).
25. **Delete on a finished row removes it from the list only; the saved file stays.** Delete on an unfinished row removes the partly downloaded data too.
    - Cost if wrong: one confirm sentence. (Question 4.)

26. **Connections are budgeted per host, across all downloads, at 6 (`HOST_MAX`),** and a 429 or 503 lowers that host-wide number for 30 minutes. A per-download budget would let `maxParallel` 3 with 6 parts open 18 connections to one server.
    - Cost if wrong: a few lines in `dl-transfer.ts`; a host that would have accepted more gets 6.
27. **A transient outage never fails a download.** Only 429 and 503 count toward five failures; every other failure retries with back-off up to 30 s until 15 minutes pass without a byte (a stalled connection is aborted after 30 s without a byte). This covers running downloads only: a manual add whose probe fetch throws (including on a network blip) fails with `ERRORS.probe` after about 6 s (three attempts, sleeps of 2 s and 4 s), and the row offers Retry in Chrome.
    - Cost if wrong: a broken link retries for 15 minutes before it says so.
28. **Take-over checks free disk space** (`2 * size + 50 MB`) and leaves Chrome's download alone when the disk cannot hold the private copy and the saved file together.
    - Cost if wrong: a large download that would just have fitted stays with Chrome.
29. **Take-over bookkeeping keys are one per entry, and `dlTakeover:<id>` lives in `chrome.storage.local`** (session storage is cleared on extension reload, update or disable, which would orphan a paused Chrome download).
    - Cost if wrong: a stale key is removed by the next worker start.
30. **"Retry in Chrome" removes the record only after Chrome's download has received a byte.** If that is not seen within 10 s the record stays, so the partly downloaded data is never deleted before Chrome has the file coming.
    - Cost if wrong: a leftover failed row to delete by hand.
31. **Chrome's own file name wins when it has an extension** (it already applies a page's `download` attribute), then Content-Disposition, then the URL. Under Playwright Chrome's name is a GUID without an extension, which falls through, so the harness behaves like the URL rule.

## Questions for the owner

The owner said to proceed with the stated defaults, so the plan proceeds with everything above. These are confirmations only, not blockers:

1. **Servers that cannot resume:** is it right that Chrome keeps those downloads (decision 3)? The alternative is to take them over and accept a restart from zero after an interruption.
2. **Folder:** `Downloads/<category>/` as the design says (decision 6), or `Downloads/Sieve/<category>/` like Phase 2's screenshots?
3. **Right-click downloads open the Add dialog** (decision 12) instead of starting at once. Keep?
4. **Delete on a finished row leaves the file in Downloads** (decision 25). Keep?
5. **Backup:** Phase 2's backup file will not include the Downloads settings until a small follow-up after the merge (Merge notes). Is that acceptable meanwhile?

## Scheduling

"Shared files" are files more than one Phase 3 task modifies. Phase 3 edits no file Phase 2 owns except the shared ones named here, by appended lines. Pure core tasks (3.1 to 3.6, 3.8, 3.9) are new files only and need no locks. Commit by pathspec (ruling R22). **Shared files are controlled by a lock per file** (`filelock acquire <absolute path> OWNER`, alphabetical, one appended or import line, held only for the edit, its test and the pathspec commit); the limit of two agents in shared-file windows is lifted. The files are listed in `.superpowers/phase-3/shared-files.txt`; the tasks that touch them are 3.7, 3.17, 3.18 and 3.20.

**Build and e2e are not parallel.** `pnpm --filter sieve build` and every e2e run share `apps/sieve/dist`, so one holder at a time: the controller holds the `apps/sieve` claim through the filelock helper (key `apps/sieve`, `FILELOCK_ROOT=.superpowers/phase-3/locks`, ruling R22); subagents never run coord. While one agent builds or runs e2e the others write code and run `node --test` on their own files. Waves D and E therefore parallelise implementation and unit tests, not build and e2e. The controller keeps `.superpowers/phase-3/progress.md` current after each wave.

Task 3.1 is the long pole of wave A (three modules and about 80 assertions); the other five wave A tasks do not wait for it.

The test-list batch: implementers do **not** edit `packages/sieve-core/package.json` or `apps/sieve/package.json` test lines. Each reports its test file names; the controller appends them in short commits (under the file locks): the first batch after the commits of Tasks 3.1 to 3.6, with the eight names `dl-settings`, `dl-record`, `dl-plan`, `dl-bucket`, `dl-queue`, `dl-takeover`, `dl-view`, `dl-text`; a second batch after the commits of 3.7 to 3.10, with `dl-engine-link` (apps/sieve), `dl-engine` and `dl-transfer` (sieve-core), `dl-net-rules` (apps/sieve) and any other new test name reported; then after each later wave. Task 3.20 checks that none is missing. The sieve-core files are `dl-settings`, `dl-record`, `dl-plan`, `dl-bucket`, `dl-queue`, `dl-takeover`, `dl-view`, `dl-text`, `dl-engine`, `dl-transfer`; the app files are `dl-engine-link`, `dl-net-rules`, `dl-router`, `dl-save`, `dl-takeover-wiring`, `dl-menus` (all `*.test.ts`).

**Worker communication.** Messages start `[TAG] <task or file>: <one sentence>`, then at most five lines of detail; one message per event; no acknowledgments, no status chatter. Each worker sends to its controller (the phase agent) and directly to the agents named as its upstream or downstream in the board. Tags:
- `[CONTRACT]`: an interface is committed or frozen (sha, files, exported names). Sent by the upstream worker to its controller; the controller forwards it to every dependent worker in one message.
- `[CONTRACT-CHANGE]`: an interface will differ from what dependents were told. Sent BEFORE the commit that changes it, to the controller and every consumer, saying what changes and what consumers must do. Consumers reply only if it hurts them.
- `[BLOCKED]`: waiting on a sha, an agent or a lock holder; say which and what you will do meanwhile; then end the turn if nothing else is left. `[UNBLOCKED]`: the controller tells the blocked worker the thing landed (sha); it resumes.
- `[LOCK]`: a lock has been held over 15 minutes, or you need a file that is on neither list. To the controller.
- `[FINDING]`: a reviewer reports a defect in a commit to the controller, who routes the fix to the owning implementer.
- `[FYI]`: a fact another agent needs (a selector, a Chrome limit). Short.
Workers do not poll the board or lock status.

**Files kept by the controller** (in the workspace `.superpowers/phase-3/`): `board.md`, one line per live worker (OWNER, task, state CODING, WAITING-LOCK <file>, BLOCKED <on what>, READY-TO-COMMIT or DONE <sha>, upstream and downstream OWNERs; updated when the state changes, and listing each frozen contract with file and sha), and `merge-notes.md`, the exact lines this phase added to each shared file (manifest permissions in sorted order, registry and import lines), so the rebase onto Phase 2 is mechanical. After this plan is committed the controller sends Phase 2's controller one `[FYI]` listing the shared files and the permission names Phase 3 will touch; the message types and settings keys do not collide because Phase 3 prefixes its messages `dl-`.

| Task | Title | Depends on | Can run alongside | Shared files it modifies |
|---|---|---|---|---|
| 3.1 | Settings, record model, ports (core) | none | 3.2 to 3.6 (wave A) | none |
| 3.2 | Segment planner, re-split, host limits (core) | none (type imports only) | 3.1, 3.3 to 3.6 (wave A) | none |
| 3.3 | Token bucket and meter (core) | none | 3.1, 3.2, 3.4 to 3.6 (wave A) | none |
| 3.4 | Queues and scheduler windows (core) | none (type imports only) | 3.1 to 3.3, 3.5, 3.6 (wave A) | none |
| 3.5 | Take-over decision, names, categories (core) | none (type imports only) | 3.1 to 3.4, 3.6 (wave A) | none |
| 3.6 | List helpers and visible text (core) | none (type imports only) | 3.1 to 3.5 (wave A) | none |
| 3.7 | Wiring: permissions, build hook, engine link, offscreen host | builds against 3.1, 3.6 (and the type `StateChange` of 3.8); waits for the implementation commits of 3.1 and 3.6 before its integration steps and commit | 3.1 to 3.6, 3.8, 3.9, 3.10 (first run) | `manifest.json` (permissions line), `build.mjs` (2 lines), `background.ts` (2 lines), `test/e2e.mjs` (the `dl` call line), `apps/sieve/package.json` (`test:dl` script), each under its own `filelock` |
| 3.8 | Engine core with ports (core) | builds against 3.1, 3.3, 3.4, 3.5; waits for their implementation commits before running its tests and committing | 3.1 to 3.7, 3.9, 3.10 (first run) | none |
| 3.9 | Transfer: probe, parts, resume, refusals (core) | builds against 3.1, 3.2, 3.3, 3.5; waits for their implementation commits before running its tests and committing | 3.1 to 3.8, 3.10 (first run) | none |
| 3.10 | Adapters, engine worker, real transfers | builds against 3.1, 3.5, 3.7, 3.8, 3.9; writes everything and the pure `dl-net-rules` test at once, waits for the implementation commits of 3.7, 3.8 and 3.9 before the build, `transfer.mjs` and its commit | 3.1 to 3.9 (first run) | none |
| 3.11 | Router: config, reconcile, alarms, idle | 3.10 (second run) | 3.12, 3.13, 3.14 | none |
| 3.12 | Finishing: save to Downloads/<category> | 3.10 | 3.11, 3.13, 3.14 | none |
| 3.13 | Take-over wiring, Retry in Chrome | 3.10 | 3.11, 3.12, 3.14 | none |
| 3.14 | Context menus | 3.6, 3.7, 3.10 | 3.11, 3.12, 3.13 | none |
| 3.15 | List page: table, filters, Add URL, Resume, Pause, Delete | 3.6, 3.11, 3.12, 3.13 | 3.14, 3.19 | none |
| 3.16 | List page: speed limit and scheduler dialogs | 3.15 | 3.17 | none (one line in `list.ts`, Task 3.15's own file) |
| 3.17 | The menu's Downloads tab | 3.6, 3.11, 3.15 | 3.16, 3.18, 3.19 | `popup.ts` (import and one line), `popup.css` (appended block), `test/e2e.mjs` (one check's text and condition) |
| 3.18 | Settings page: Downloads section | 3.6, 3.7, 3.10, 3.13, 3.16 | 3.17, 3.19 | `options.ts` (import and one line), `options.css` (appended block) |
| 3.19 | Loss and restart torture checks | 3.10, 3.11, 3.12, 3.13 | 3.15 to 3.18 | none |
| 3.20 | Phase close | all | none (exclusive) | `README.md`, `manifest.json` (`version`), `docs/handoffs/sieve.md`, test lists if missing |

Waves for the controller: **First run (cap 10 tasks, dispatched together): Tasks 3.1 to 3.10.** Tasks 3.1 to 3.6 have no upstream and start at once. Tasks 3.7 to 3.10 start at the same time and code against the contract commits (Step 0) of their upstream tasks, doing their lock-free work first: 3.7 builds against 3.1, 3.6 and the type of 3.8; 3.8 against 3.1, 3.3, 3.4, 3.5; 3.9 against 3.1, 3.2, 3.3, 3.5; 3.10 against 3.1, 3.5, 3.7, 3.8, 3.9. **Who waits for whom:** 3.7 waits for the implementation commits of 3.1 and 3.6; 3.8 for 3.1, 3.3, 3.4, 3.5; 3.9 for 3.1, 3.2, 3.3, 3.5; 3.10 for 3.7, 3.8, 3.9 (and through them 3.1 to 3.6). Waiting means: do not run integration tests or commit the implementation until the upstream commit has landed; `[BLOCKED]` and end the turn if nothing else is left. **The next run starts at Task 3.11:** D: 3.11, 3.12, 3.13 and 3.14. E: 3.15 (with 3.19), then 3.16 and 3.17, then 3.18. F: 3.20.

## Merge notes (Phase 2 first, then Phase 3 rebased)

- **`manifest.json` permissions:** both phases edit the one line. Phase 2's plan says it adds `downloads` and `commands`, but `commands` is a top-level manifest key (Phase 2's `build.mjs` writes `manifest.commands`), not a permission. The resolved `permissions` line is the sorted union, 10 entries: `alarms`, `contextMenus`, `declarativeNetRequest`, `declarativeNetRequestFeedback`, `downloads`, `offscreen`, `scripting`, `storage`, `unlimitedStorage`, `webNavigation`; `commands` stays a separate key. `version`: Phase 2 sets `0.2.0`; Phase 3's close sets `0.3.0` after the rebase.
- **`background.ts`:** Phase 2 adds `onYouTubeMessage` and `chrome.commands.onCommand` lines; Phase 3 adds one import and `initDownloads();` last. Keep both sets.
- **`build.mjs`:** Phase 3's two lines are separate from Phase 2's `manifest.commands = …` line; keep both.
- **`popup.ts`, `popup.css`:** both add a tab; `tabs.splice(1, 0, downloadsTab)` keeps Downloads second (design order: Blocking, Downloads, YouTube). The Phase 1 check text "and no tab bar (one tab)" in `e2e.mjs` is edited by both; the resolved condition is `switchCount === 6 && tab count >= 2`.
- **`options.ts`, `options.css`:** both append sections. After Phase 2's side navigation lands, add a `Downloads` link (`#downloads`) to its list (one line) and put `downloadsSection()` before the YouTube section if the order matters (the design lists Downloads before YouTube).
- **`test/e2e.mjs`, both `package.json` files, `README.md`, `docs/handoffs/sieve.md`:** keep both sides; the test lines are a union.
- **`packages/sieve-core/src/index.ts` is not touched** by Phase 3 (deep imports only).
- **Backup and import (post-merge, owner informed):** Phase 2's Task 2.18 backs up only `settings` and `youtube`, and Phase 3 may not edit Phase 2's files. After the merge, add a small follow-up commit: `Backup` gets an optional `downloads` (`DownloadSettings`), `makeBackup` writes it, `readBackup` validates it with `validateDownloadSettings` (a missing one gives the defaults), and "Replace my settings" writes the `downloads` key in the same `withSettingsLock` write. Until then a backup does not include Downloads settings; the README says so.
- The controller keeps `.superpowers/phase-3/progress.md` current after each wave, copies each task's reported limits into it for Task 3.20, and keeps `.superpowers/phase-3/merge-notes.md` and `board.md` as described under Scheduling.
- After the merge run once: `pnpm test`, `pnpm typecheck`, `pnpm --filter sieve build`, `pnpm --filter sieve test:e2e` and `node apps/sieve/test/dl/e2e.mjs` from a clean export.

## Out of scope

- The design's non-goals (Image Swap, a custom JavaScript runner, pop-up and mini players, other browsers, a helper program, publication).
- Media detection, HLS and DASH, the muxer and the hover icon (Phase 4); YouTube downloads and the row's Download button (Phase 5). The menu's "media found on this page" section arrives in Phase 4.
- Moving a record between queues after it is added; drag and drop; per-site take-over exceptions; checksums; download notifications; clipboard watching; shutting the Mac down when downloads end; a site grabber (design non-goal); FTP, torrents, proxies and basic-auth prompts.
- Taking over servers that cannot resume, and POST downloads the probe cannot repeat (they stay with Chrome by design).
- Daylight-saving corrections in scheduler windows.
- Windows device-name rules for file names (this is for macOS).
- Backup and import of the `downloads` settings in the same commit as Phase 2's backup: it needs Phase 2's files and is a post-merge follow-up (Merge notes).

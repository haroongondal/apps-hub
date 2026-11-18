# Playwright backend on a dedicated Chrome profile

Date: 2026-08-26 · Branch: `feat/playwright-backend` · Status: approved in chat

## What this is

A second automation backend that drives a real, self-launched Google Chrome on
a dedicated persistent profile over CDP, selected by `AUTOMATION_BACKEND`
(`playwright` | `extension`, default `playwright`). The extension backend stays
fully wired as the fallback. Human-in-the-loop holds keep today's exact shape;
logins persist across runs because the profile persists on disk.

## Decisions already made (with the user)

- **Lifecycle**: launch per run, close after — *unless the browser was already
  open* (see adoption). Sessions persist via the profile directory, not via a
  long-lived process.
- **Profile**: one shared automation profile at `<userData>/automation-profile`.
- **Hand-off UI**: the in-page banner, exactly as today.
- **Pre-login**: an explicit "open browser" control so the user can sign into
  sites ahead of any run.
- **Selector engine**: ported, not replaced — zero behavioural drift on stored
  routines. Native Playwright locators are a separate, eval-measured follow-up.
- **Extension**: kept as a switchable backend, not deleted.

## Verified on this machine (probes, 2026-08-26)

- `launchPersistentContext({channel:'chrome'})` pins `navigator.webdriver=true`
  and `ignoreDefaultArgs:['--enable-automation']` does **not** clear it.
- Self-launched Chrome (`--user-data-dir` + `--remote-debugging-port`) attached
  via `connectOverCDP`: `webdriver=false`. **This is why we spawn, not launch.**
- `addInitScript` + `exposeBinding` survive cross-origin navigation and new
  tabs; a binding fired from a closed shadow root reaches Node.
- A second launch on a locked profile fails ("Opening in existing browser
  session"), so run-vs-prelogin collision must be handled by adoption.

## Architecture

### One page engine, two transports

`content.js`'s DOM logic (selector engine `best`/`queryAll`/`rank`, guards
`assertWritableTarget`/`scanSensitive`/`scanWall`/`isCommitting`, `observe`,
the ACTIONS table, `cloneWithShadow`/`mirrorLiveState`, the banner) moves to
**`extension/page-core.js`**, exposing a factory `window.__oaCore.create(deps)`
where `deps` = `{ requestInput, control, version }`.

- The extension loads `["page-core.js", "content.js"]` (MV3 allows ordered
  lists); `content.js` shrinks to the chrome.runtime transport and message
  listener. Manifest and `EXTENSION_VERSION` bump to 1.10.0.
- The Playwright backend injects the same `page-core.js` (bundled via a `?raw`
  import) plus a small adapter init script whose `deps` call two exposed
  bindings. Guard fixes land in both backends by construction.

### The trusted-input seam maps 1:1

`content.js` already splits every action into a synthetic in-page path plus
`requestInput` → background `chrome.debugger` CDP input. The adapter's
`requestInput` calls a `__oaInput` binding; Node answers with
`page.mouse.click(x,y)` / `keyboard.insertText` / Enter keydown-keyup — the
same command sequence `inputCommands` sends today. The `'ok' | 'failed' |
'unavailable'` verdicts and `AUTOMATION_INPUT` (`cdp`/`synthetic`/`auto`)
semantics carry over unchanged.

Bindings are nonce-guarded: Node generates a per-connect nonce, interpolates it
into the adapter source, the adapter captures bindings + nonce in a closure and
deletes the window properties before any page script runs. Init scripts run in
the **main world** (the extension's isolated world is stronger); the raw-CDP
isolated-world injection is a documented follow-up, and extension mode remains
the hardened option.

### New units

| Unit | Role |
| --- | --- |
| `src/main/automation/session-control.ts` | `SessionControl`: `connected`, `isPaused`, `pause`, `resume`, `cancel`, `on(connected/disconnected/paused/resumed)`, `setRunContext`. Extracted from what `index.ts`/`ipc.ts` consume from `ExtensionBridge` today; the bridge already satisfies it. |
| `src/main/automation/chrome-process.ts` | Find the Chrome binary (env `AUTOMATION_CHROME_PATH`, then per-platform paths); spawn detached with `--user-data-dir` + `--remote-debugging-port=0`; poll `DevToolsActivePort` in the profile dir for the real port; write `<userData>/automation-browser.json` `{port,pid}`; adopt a live endpoint (pid alive + `/json/version` answers) or clean a stale one, including stale `Singleton*` files left by a crash. |
| `src/main/automation/playwright-session.ts` | Implements `AutomationSession` **and** `SessionControl`. `connect()` adopts-or-launches and remembers which; `disconnect()` closes only what it launched. Owns pause state, waiters, `skipScanOnce`, the hold-retry loop (mirroring `ExtensionSession.dispatch`, same `MAX_HELD_RETRIES`), scan-before-step, per-step budgets via the existing `stepTimeout`, popup adoption (`page.opener() === activePage`), frame-aware resolution (main frame first, then child frames where the core finds a match), `navigate`/`screenshot` handled Node-side with the same protocol allowlist. |
| Renderer | `browser:open` / `browser:close` / `browser:status` channels, preload passthrough, and an open/close control in the existing status surface. |

### Process picture (playwright backend)

```
renderer ─contextBridge─► preload ─ipcRenderer─► main
                                                   │
                              ipc.ts → orchestrator → PlaywrightSession
                                            │              │ CDP (ws)
                                      claude-client   ChromeProcess ─spawn─► Chrome
                                            │                     (dedicated profile)
                                      AI Gateway
```

No socket, relay, native-host manifest, or PATH shim on this path. The
five-process extension wire stays intact and documented for
`AUTOMATION_BACKEND=extension`.

## Behavioural parity contract

Everything on this list behaves identically across backends; divergence is a
bug: scan-before-every-step with `skipScanOnce` after resume · held-step retry
loop and its give-up message · the credential refusal text (`REFUSAL` regex
match) · `changed`/`committing`/`via` in `StepOutput` · `blockedBy` from
`scanWall` · banner states and Pause/Resume · pause attribution via
`RunContext` · `holdForHuman` parking · cancel unwinding as
`RunCancelledError` · `{{param}}` substitution · DOM snapshot =
`cloneWithShadow` + `mirrorLiveState` (password values never mirrored) →
`filterDom` · screenshot → `optimizeScreenshot`.

Known, accepted differences: CDP screenshots work on backgrounded tabs (kills
the visible-tab constraint — an improvement); a hung renderer times out as a
healable `StepExecutionError` instead of `StepIndeterminateError` (context
destruction, the navigation case, is detected and mapped to `changed: true`);
popups are followed instead of stranding the run; steps can resolve inside
iframes.

## Testing

- `tests/chrome-process.test.ts`, `tests/playwright-session.test.ts` — vitest,
  injectable IO / fake driver, no browser.
- `tests/playwright-session.verify.mjs` (`npm run test:playwright`) — real
  Chrome: core injection, guards, banner, exec-via-binding, mirrorLiveState,
  scan holds, frame resolution, ChromeProcess launch/adopt/close.
- `npm run test:extension` re-run to prove the page-core extraction changed
  nothing for the extension.
- Model evals unaffected (FakeSession).

## Roadmap (explicitly not in this change)

Isolated-world injection over raw CDP · native Playwright locators measured by
eval · child-frame DOM in snapshots · download/upload/dialog step kinds ·
multi-tab research runs.

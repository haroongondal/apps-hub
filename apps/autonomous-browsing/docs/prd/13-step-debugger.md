# PRD 13 — Step-through debugger

| | |
|---|---|
| **Phase** | Durability |
| **Depends on** | PRD 01 (transcript and event vocabulary), PRD 03 (versioning), PRD 05 (queue), PRD 11 (editor). Assumes PRD 12 |
| **Blocks** | Nothing |
| **Status** | Draft |
| **Author** | hmukhtar@outsentia.com |

Shared personas and strategic context: [README.md](README.md). Its dependency table
is the one authority; this header matches it.

---

## 1. Executive Summary

We're building a **step-through debugger** — running a routine one step at a time,
with the page state visible between steps and committing steps refused *before* they
execute — for **the Author** to solve the problem that the only way to test a routine
is to run the whole thing for real against a live logged-in session, which will make
testing a routine safe and incremental rather than all-or-nothing.

The last PRD in the set, and the one that most benefits from everything before it.
It is not, however, pure composition. Three things do not exist in any form today:
a pre-execution commit check in the in-page engine, a browser session that outlives
one `runRoutine` call, and a run source that means "supervised". Each is named
below with the files it touches.

---

## 2. Problem Statement

### Who has this problem?

The Author, testing any change to any routine.

### What is the problem?

Execution is all-or-nothing, and it is always for real.

- `runRoutine` iterates the whole step list to completion
  ([orchestrator.ts](../../src/main/automation/orchestrator.ts)); there is no
  single-step mode and no entry point that runs step *n* alone. Its `finally` calls
  `disconnect()` on every exit, so there is not even a browser session that survives
  one call.
- **Pause is not the problem it looks like.** `ExtensionSession.dispatch` awaits
  `waitWhileHeld` before every attempt, and `ExtensionSession.snapshot` awaits it
  before capturing
  ([extension-session.ts](../../src/main/automation/extension-session.ts),
  [extension-bridge.ts](../../src/main/automation/extension-bridge.ts)), so a pause
  lands on a step boundary rather than mid-flight. The real defects are that
  `throughPauses` (orchestrator.ts) swallows `RunPausedError` and **re-runs the
  paused step**, so pausing at step 4 and resuming does step 4 again; and that there
  is no way to stop *after* a chosen step — only to stop everything.
- There is no dry run. Every test drives the user's real browser on their real
  session, including any submit, order, or payment the routine contains
  ([ARCHITECTURE.md](../../ARCHITECTURE.md) §1).
- **What a step became is invisible.** `resolveStep` — now exported from
  [shared/routines.ts](../../src/shared/routines.ts) and the single substitution site
  both backends call — fills `{{name}}` into `navigate.url`, `type.text` and
  `select.value` and resolves an unknown name to `''`; `resolveTemplate`
  (orchestrator.ts) does the same for `extract.selector` alone. Nothing shows the
  Author the resolved step, so a failed substitution is silent by construction.

So testing a change to step 9 of a checkout routine means either running the
checkout or not testing it.

### Why is it painful?

- **User impact.** Testing carries real-world consequences. 🔶 **Assumption:** that
  makes Authors reluctant to test, so routines containing commits get tested less
  and therefore break more. Unvalidated; PRD 09 could show it.
- **Business impact.** Combined with PRD 11's editor, this closes the authoring
  loop: edit, test one step, see the result, edit again. Without it, every edit is a
  guess validated by a full production run.

### Evidence

- **Code.** No single-step and no dry-run path exists. `busy` (orchestrator.ts) is
  `private`, so nothing outside the class can claim the run slot either.
- **Design.** An earlier draft of this PRD said the machinery was "nearly all
  present" and that what was missing was "a mode that composes them". That was
  wrong about the one thing the feature is named for, so the split is stated
  explicitly:

| Already there | Not there |
|---|---|
| `AutomationSession.snapshot` and `runStep` ([session.ts](../../src/main/automation/session.ts)) — per-step execution and a page read | any caller that runs one step and stops |
| pause/resume and `waitWhileHeld` (extension-bridge.ts) | a parked state a person drives, reachable by `cancel()` |
| `committing` on a click/type result, computed by `isCommitting` ([page-core.js](../../extension/page-core.js)) | a **pre-execution** classify-or-refuse. `isCommitting` runs inside the same `EXEC` call that then calls `press`; main learns the verdict only from the reply |
| PRD 01's `runs` / `run_events` / `step_json` | a `debug` run source, and refused and skipped step statuses |
| PRD 01's `onArtifact` / `onRepair` callbacks | any path that fills the variable bag through `runStep` — it returns `{}` for `extract` |

Three of the four pieces safe mode needs exist. The fourth is new extension code,
and §5 and §9 budget for it.

---

## 3. Target Users & Personas

**Primary: The Author**, mid-edit, wanting to know whether step 9 does what they
think.

**Job-to-be-done:** *When I change a step, I want to try just that step and see what
happened, so I can iterate without running the whole routine for real.*

---

## 4. Strategic Context

**Ladders up to:** durable automations, by making them cheap to verify.

**Why last.** It composes more existing pieces than any other PRD: PRD 05's queue so
a debug session holds the browser without conflicting; PRD 11's editor as its home;
PRD 12's resolution feedback for the selector being stepped; PRD 03's versioning for
the edits a session produces; PRD 01's thread format and event vocabulary for the
transcript. Built earlier it would need most of that built alongside it.

**Why "last" only pays off if the dependency list is honest.** The point of placing
this PRD eleventh is to avoid rework. A dependency list that omits 01, 03,
persistence and the extension does not avoid rework — it defers the discovery of it
to the week the work starts. §9 carries the corrected list and the five workstreams.

---

## 5. Solution Overview

### The session

From the editor: **Debug**. The routine is loaded but not run. The Author drives it:

- **Step** — run the selected step, then stop
- **Run to here** — run every step up to the selected one, then stop
- **Continue** — run to the end
- **Skip** — advance without running
- **Re-run step** — run the current step again after editing it
- **Close** — end the session and release the browser

**Params.** A session opens with a params map, exactly as a run does. The editor's
param form (PRD 11) renders from `RoutineDefinition.params` (`RoutineParam` in
[types.ts](../../src/shared/types.ts)) with `RoutineParam.default` prefilled, and the
map is passed once at open, seeding the variable bag the way `runRoutine` seeds
`vars` from `params`. Unknown names still resolve to `''`. The debugger does not
change substitution; it shows it.

### Session lifecycle

No run has a lifecycle today, so this PRD specifies one rather than deferring it.

| Requirement | Why, in code |
|---|---|
| Open and close are explicit: `openDebugSession` / `closeDebugSession` on the orchestrator, one `connect()` at open and one `disconnect()` at close | `runRoutine`'s `finally` always calls `disconnect()`, and `ExtensionSession.disconnect` calls `bridge.stop()`, which makes background.js's `control('stop')` clear `targetTabId`. A debug mode built as repeated `runRoutine` calls would re-pick the active tab on every step and lose it in between |
| While a session is open, nothing else may call `connect()` | `ExtensionBridge.start` calls `this.cancel()` first, which fails every pending request and rejects every parked waiter with `RunCancelledError`. A queued run or a chat send starting concurrently therefore kills a live session. The lease in PRD 05's queue is the only place this can be enforced; `connect()` must be reachable only through it |
| Every parked path is reachable by `cancel()` | AI_CONTEXT.md §8. The between-steps wait is a **new** parked path, and §5 of the previous draft named only an inactivity timeout. `IpcChannels.automationCancel` → `bridge.cancel()` must end it, so implement the wait as one of the bridge's waiters rather than a private promise |
| One close path, five triggers | Close, `cancel()`, socket loss, `target-closed`, inactivity timeout. Two come free: `ExtensionBridge`'s socket `close` handler and its `target-closed` branch already `failAllPending` then `cancel()`. The inactivity timer must route through the same `closeDebugSession`, not its own teardown |
| No keep-alive work in main | The extension keeps itself alive: the `'host-keepalive'` alarm every 30 s plus `targetTabId` in `chrome.storage.session` (background.js), so an idle session survives a service-worker restart. Main must **not** poll `snapshot` as a heartbeat — see the active-tab constraint below |

🔶 **Assumption:** a 30-minute inactivity timeout is long enough for a real editing
session and short enough not to strand scheduled work. Arbitrary; §6 gives it a
measurement.

### One executor, not two

The debug session must call the same code `runRoutine` calls. Extracting it is the
work; naming what it owns is what stops the extraction being half done:

| Lives here today | The shared executor owns it |
|---|---|
| `resolveStep` (shared/routines.ts) | `{{param}}` substitution into `navigate.url`, `type.text`, `select.value`. Already extracted and already shared — `ExtensionSession.runStep`, `PlaywrightSession.runStep` and `runRoutine` all call this one function, so the executor inherits it rather than having to unify it |
| `extractWithRepair` (orchestrator.ts) → `ExtensionSession.extractText`, then `vars[step.into]` and `extracted[step.into]` | extraction. `ExtensionSession.runStep` returns `{}` for `extract`, so a debugger built on `runStep` alone shows an **empty variable panel forever** |
| the `step.kind === 'screenshot'` branch of `runRoutine` | building the `RunArtifact`, now via PRD 01's `onArtifact` |
| `stepTimeout` (exported from extension-session.ts, imported by playwright-session.ts despite the file name) | per-kind budgets, including the 5 s margin |
| `runWithRepair`, `throughPauses`, `StepHealer.plan` | the layer-2 and layer-3 policy, behind one flag |
| `describeStep` (shared/routines.ts, imported by orchestrator.ts) | progress-line text, extended with the refusal line |

The only branch the executor may take on "am I debugging" is the layer-2 flag. Any
second branch is the drift this PRD's own §9 warns about.

### Between steps: what the debugger can honestly show

A snapshot every step. **A screenshot every step on the default backend, and not on
the other** — the previous draft said the code could never deliver one, which was
true of the only backend that then existed and is not true now.

- **Extension backend.** `capture` (background.js) throws unless the target tab is
  the active tab in its window; `snapshot` there wraps it in `captureOrReason`, so a
  failure degrades to `screenshot: ''` plus `screenshotError`. 🔶 **Assumption:**
  inspecting a page between steps is exactly when an Author switches tabs, so this is
  the common case in a debug session rather than an edge one.
- **Playwright backend, the default.** `PlaywrightSession.snapshot` calls
  `page.screenshot()`, which captures the page it is given whether or not that page
  is frontmost. The active-tab trap does not apply, so a debug session there really
  can show a fresh frame between every step.

The infrastructure this section asked for **already exists** (verified 2026-08-27):
`PageSnapshot` in [session.ts](../../src/main/automation/session.ts) carries
`screenshotError: string | null`, `ExtensionSession.snapshot` populates it rather
than dropping it into a `console.warn`, and `PlaywrightSession.snapshot` sets it from
its own `catch`. There is no `BrowserSession` twin to add it to — that file is
deleted. So the remaining work here is presentation only: the panel shows URL, title,
the variable bag, and either the screenshot or "no screenshot: *reason*" with a Retry.
A stale screenshot must never be presented as current. 🔶 **Assumption:** the variable
bag is the part of that panel that matters most, because substitution failures are
otherwise silent — worth checking with five Authors, not assumed indefinitely.

### Safe mode

**On by default, with no session-wide off switch.** Arming is per step.

**What exists.** `isCommitting(el, step)` in page-core.js is computed *inside* the
`exec` call that then acts: `ACTIONS.click` calls `settle`, computes the flag, and
then calls `press`. `ACTIONS.type` calls `settle`, then `assertWritableTarget`, then
computes the flag, then writes. Main sees the verdict only in the reply — after the
click.

The in-page half of the fix is **one** change, not two: `page-core.js` is the single
engine both backends inject, so the refusal lands everywhere at once. The half that
does need doing twice is the caller side — each backend has to forward the flags into
its own dispatch. Five places:

| Where | Change |
|---|---|
| [page-core.js](../../extension/page-core.js) | `ACTIONS.click` and `ACTIONS.type`: after `settle(step)` — and for `type`, after `assertWritableTarget`, which stays first — compute `isCommitting(el, step)`; if the `EXEC` message carries `safeMode` and not `armed`, return `{ ok: false, refused: true, committing: true, error: <why> }` **without** calling `press`, `setValue` or `submitFrom` |
| [background.js](../../extension/background.js) | `runStep` forwards `safeMode` and `armed` from the app's `step` message into the `EXEC` message. It must not classify anything itself: `navigate` and `screenshot` are handled here and never reach `isCommitting` |
| extension-bridge.ts | `ExtensionBridge.runStep` sends the two flags; `BridgeResult` gains `refused` |
| [playwright-session.ts](../../src/main/automation/playwright-session.ts) | the twin, and the one the default backend actually uses. `PlaywrightSession.execute` passes the step straight to `callHooks(frame, 'exec', step)`, so the flags ride along on the step object — but its `navigate` and `screenshot` branches short-circuit before that call, exactly as background.js does, and `ExecResult` gains `refused` alongside `BridgeResult`. A change landing only in background.js leaves safe mode silently inert for every default install |
| session.ts / orchestrator.ts | `ExtensionSession.runStep` **and** `PlaywrightSession.runStep` turn `refused` into `StepRefusedError`; `describeStep` (shared/routines.ts) gains the refusal line, so the refusal is reported at the same level as every other step description |

Bump `EXTENSION_VERSION` (extension-bridge.ts, `1.10.0` today, verified 2026-08-27)
and `extension/manifest.json`'s `version` **together** —
`tests/extension-session.test.ts` asserts they agree, and the handshake in
`ExtensionSession.connect` refuses a mismatch. That handshake is the extension
backend's alone; Playwright injects `page-core.js` from the app's own bundle and
needs no bump. Add a case to `tests/content-script.verify.mjs`, which loads
`page-core.js` and `content.js` into real Chrome and already asserts
`committing: true` for a form submit button, proving that with `safeMode` set the
click never lands.

**What safe mode actually covers.** Narrower than the previous draft claimed:

| Step kind | Classified by | Safe mode |
|---|---|---|
| `click` | `isCommitting`: a form-associated `input[type=submit\|image]` or `button[type=submit]`, else `COMMIT_WORDS` against `accessibleText(el)` | covered |
| `type` | `isCommitting`: `submit: true` is committing on its own, then the same element test | covered |
| `select` | nothing. `ACTIONS.select` returns `committing: false` unconditionally | **blind** |
| `navigate` | nothing. It runs in background.js, which never computes the flag — and a GET that confirms an order is a commit | **blind** |
| `screenshot`, `wait`, `scroll`, `extract` | n/a — they do not act on the page | n/a |

`COMMIT_WORDS` in full, since the previous draft quoted six of sixteen: submit,
order, pay, paying, buy, purchase, checkout, confirm, delete, remove, send, book,
place, transfer, withdraw, publish. Word-boundary match, against the accessible name
only.

**Honest about its limits.** Safe mode is a heuristic, not a sandbox. It covers
`click` and `type`; `select` and `navigate` are not classified at all; and within the
covered kinds, a commit behind an unlabelled control, a link, or a keyboard shortcut
can be missed. The UI must say this on the step, not in a footnote: an uncovered
kind is labelled *not covered by safe mode* rather than left looking safe. A
debugger that over-promises safety is worse than one that promises nothing.

**A refusal must never be healed.** This is the hole that would route around the
whole feature. `StepExecutionError.healable` is `!REFUSAL.test(detail)` with
`REFUSAL = /refusing to write into/` (session.ts), so a refusal phrased any other
way is healable, and with layer 2 on `StepHealer` would supply a different selector
for the same button — safe mode bypassed by the healer. Requirement: a refused step
throws a **distinct `StepRefusedError`** (session.ts), not a `StepExecutionError`,
so `isHealable` rejects it by construction. Widening the `REFUSAL` regex is the
cheaper option and the worse one, because it makes the guarantee a string match.
Either way, the debug session must not call `StepHealer.plan` for a refused step
under any setting. AI_CONTEXT.md §5's *never-healed outcomes* row changes with this.

**Arming.** Per step, one execution, consumed by that execution, recorded as its own
transcript event (see below, and §6 — the count is a guardrail metric). Arming step
11 changes nothing about step 12.

### Retries, no-ops and indeterminacy while stepping

Three existing mechanisms re-execute a step the debugger presents as one press:

- **`MAX_ATTEMPTS_PER_STEP` = 3.** `runWithRepair` loops up to three times. With
  layer 2 on, one Step can mean three real attempts against the page. The transcript
  records each attempt as its own event and the UI says *attempt 2 of 3*, rather
  than showing one step that quietly happened three times.
- **`throughPauses` is unbounded.** It retries forever while the error is
  `RunPausedError`. In a debug session a `RunPausedError` ends that Step and is
  reported: the step is presented as *not run*, and re-running it is the Author's
  decision, not a loop's.
- **`StepIndeterminateError` (extension-bridge.ts).** The extension stopped
  answering; per AI_CONTEXT.md §8 the step **may have run**. The debugger's only
  offers are *check the page* and *close the session*. Never *re-run step*, never an
  automatic retry, and never a presentation that implies the step failed. This is
  the one place the right affordance is a refusal to help.

### Healing during a debug session

Four layers, and only one of them is switchable — the previous draft's "healing
on/off" was not a thing the code can do:

| Layer | Where | In a debug session |
|---|---|---|
| 0 — resolution and ranking | `best`, `queryAll`, `rank` (page-core.js) | always on; cannot be turned off |
| 1 — change verification | `observe`, `SETTLE_MS` (page-core.js) → `changed` | always on; cannot be turned off |
| 2 — model repair | `StepHealer.plan` (step-healer.ts) | **off by default**, one per-session toggle |
| 3 — human hold | `holdForHuman` → `bridge.pause` | unchanged from a run |

Layer 3 keeps run semantics exactly: `NeedsHumanError` parks, and resuming continues
**past** the held step, per README.md's *How a run ends today*. A debug session must
not invent a second hold semantics.

**`changed: false`.** Layer 1's no-op verdict, which the previous draft never
mentioned. With layer 2 off there is nothing to plan a repair, so the step reports
*it ran, and the page did not visibly react* and the session stops there — a no-op is
a reason to look, and a debugger is the one place where looking is what happens next.
With layer 2 on, behaviour is `runWithRepair`'s unchanged: a `committing` no-op goes
straight to a human and is never retried.

### The two credential guards

The previous draft conflated them. They are different mechanisms with different
outcomes, and a debug session gets both, unchanged:

- `assertWritableTarget` (page-core.js) **refuses outright** on the element a `type`
  or `select` actually resolved to — password, payment, or one-time-code. It never
  holds, and it has no bypass. Both backends inject `page-core.js`, so this guard is
  one implementation and a debug session inherits it whichever backend is running.
- `scanSensitive` (page-core.js) is the page-wide **hold** heuristic, and its
  *callers* are per-backend: `runStep` in background.js sends `{type: 'SCAN'}` and
  replies `held: true`, and `ExtensionSession.dispatch` retries the same step up to
  `MAX_HELD_RETRIES` before throwing a plain `Error`; `PlaywrightSession.scanHold()`
  does the same job through `callHooks(page.mainFrame(), 'scanSensitive')`, with its
  own `MAX_HELD_RETRIES` loop in `PlaywrightSession.dispatch`.

**Step must not be implemented as resume-one-step, on either backend.**
`ExtensionBridge.resume` sends `{type: 'resume'}`, and background.js's `control` sets
`skipScanOnce: true`, which waves `scanSensitive` through for exactly the next step.
`PlaywrightSession` carries its own `skipScanOnce`, consumed at the top of
`scanHold()`, so resuming there has the identical effect. If Step advances by calling
resume, **every stepped step runs with the page-wide scan disabled** — widening the
one deliberate bypass AI_CONTEXT.md §8 says must never be widened. Step drives the
shared executor directly; `resume` keeps its current meaning, releasing a real hold.

### Transcript

A debug session produces a thread in PRD 01's format, marked as a session rather
than a run. That needs schema work this PRD owns, appended to `MIGRATIONS` in
[database.ts](../../src/main/db/database.ts) — never editing a shipped entry, since
`PRAGMA user_version` is the cursor:

- **`debug` added to `runs.source`**, which PRD 01 defines as `routine`/`chat`. If
  PRD 01 ships a `CHECK (source IN (…))`, widening it is a table rebuild rather than
  an `ALTER`, because SQLite cannot alter a CHECK constraint. Worth knowing before
  the migration is written.
- **Refused and skipped step statuses on `run_events`** — PRD 01 §8 defers both here.
- **An armed-step event type**, because §6 counts it.
- **Per-step filtered DOM**, which PRD 01 §10 defers here too. Debug threads only,
  retained with the thread: PRD 01 estimates it roughly triples storage, which is
  affordable for supervised sessions and not for every scheduled run.
- **`runs.routine_version`**, so §6's primary metric has a join to PRD 03's
  `routine_versions` rows.

Editing a step mid-session and re-running it records both attempts. 🔶 **Assumption:**
that is the record an Author wants when working out what fixed something —
plausible, untested, and cheap to check.

**Which aggregates count debug threads:**

| Aggregate | Debug threads |
|---|---|
| PRD 01's unattended completion rate (`done` ÷ `done` + `assisted`) | **excluded** — a supervised session is not evidence about unattended health |
| PRD 09's failure fingerprints and routine health | **excluded** — a deliberately broken step stepped five times would dominate a group |
| PRD 02's cost split, which already groups by `source` | **included**, as its own row. Layer 2 during a session costs real model calls; hiding them misreports spend |

### Editing during a session

An edit is applied to the session's in-memory copy of the definition immediately, so
Re-run step works. Persisting it is a separate act, and it is **user routines only**:
`UserRoutineStore.save` (via PRD 11), which writes a `routine_versions` row (PRD 03).
For a system routine there is nothing to persist to — `updates/` is the source of
truth and `system_routines` rows are never written (AI_CONTEXT.md §8) — and this
matches the existing gate on repairs, the `kind === 'user'` branch of the
`IpcChannels.automationRun` handler in [ipc.ts](../../src/main/ipc.ts), and
`applyRepairs`, which already restricts itself to user routines. A system routine can
still be stepped and its transcript read; to keep an edit, the Author exports a copy
and imports it as a user routine (PRD 10).

### Queue and the run slot

`busy` is `private` in the orchestrator, so a debug mode that bypasses `runRoutine`
sets nothing and two things could drive one tab. PRD 05 replaces `busy` with a queue,
and this PRD needs a **lease**: an entry that occupies the head of the queue without
being a routine or a goal, released by `closeDebugSession` rather than by completing.
PRD 05's entry shape — id, source (`manual`/`schedule`/`rerun`), the routine or goal,
params, enqueued-at, position — cannot express that, so **PRD 05 needs to know**: it
owns adding a `debug` entry kind carrying a routine reference and a session id. The
requirement is stated here; the mechanism belongs there.

A run already in flight is never interrupted: Debug waits, or is refused with the
reason. Symmetrically, a scheduled run waits behind a session.

---

## 6. Success Metrics

### Primary

**Pre-run validation rate** — share of routine edits that were stepped in a debug
session before that routine's next non-debug run.
- Current: 0%. No mechanism, and no edits either until PRD 11 ships.
- Target: 🔶 **Assumption:** 70% within eight weeks of PRD 11 and this shipping. A
  goal, not a forecast.
- Measured: by a join nothing specifies today, so this PRD owns it —
  `routine_versions` (PRD 03) → `runs` rows with `source = 'debug'` and
  `routine_version` equal to that version → the earliest `runs` row for the same
  routine with `source != 'debug'` and `started_at` after the version's timestamp.
  Numerator: versions with at least one debug row before that run. This is why
  `runs.routine_version` is in §5's migration; without it the metric has no
  mechanism at all.

### Secondary

- **First-run success rate after an edit.** Mechanism: for each `routine_versions`
  row, the first following non-debug run, `status IN ('done', 'assisted')`.
  🔵 **Open Question:** there is no before-period. Editing is impossible today, so
  the comparison is PRD 11's first weeks against later ones, not history against now.
- **Debug sessions per routine edit** — `COUNT(runs WHERE source = 'debug')` ÷
  `COUNT(routine_versions)`. 🔶 **Assumption:** near zero means the feature is not
  discoverable or not worth using. That reading is an interpretation, not a
  measurement; a low number is a prompt to ask five Authors why, not a verdict.
- **Refusals per session** — `run_events` rows with the refused status ÷ debug
  sessions. Directly countable once §5's status exists.

### Guardrails

- **Safe mode's own three counters**, all emittable by the code §5 specifies:
  refusals logged, armed steps logged, and steps that executed with
  `committing: true` while safe mode was on. The third needs the armed-step event
  type; with the pre-execution refusal in place it should *equal* the armed count,
  and any excess is a classify-then-act divergence and a bug worth filing.
- **Unintended commits cannot be measured, and the previous guardrail pretended
  otherwise.** "Zero unintended commits, allowing for the stated heuristic limits"
  is unfalsifiable: an unintended commit is by definition one the heuristic did not
  label, so nothing counts it. Proxies, stated as proxies: (a) armed ÷ refused, which
  says how often the Author overrides the check; (b) a periodic manual audit of
  sessions containing `select` or `navigate` steps, the two kinds §5 lists as blind;
  (c) 🔵 **Open Question:** an Author-reported count, which requires asking.
- **A debug session must not block scheduled work indefinitely.** Measured as the
  age of the oldest held lease, from PRD 05's enqueued-at, with the inactivity
  timeout as the enforcement.

---

## 7. User Stories & Requirements

### Epic hypothesis

We believe that step-by-step execution with committing steps refused before they run
will make routine testing safe and cheap, because today the only test is a full run
against a live session. We will know we are right when first-run success after an
edit improves and Authors debug rather than run-and-hope.

### Story 1 — Stepping

**As** the Author, **I want** to run one step at a time and see the page between
each, **so that** I can find exactly where a routine goes wrong.

```gherkin
Scenario: Running a single step
  Given a debug session on a 12-step routine at step 1
  When I press Step
  Then step 1 executes
  And the debugger stops at step 2 showing a fresh snapshot: URL, title and screenshot
  And no further step runs

Scenario: Running to a chosen step
  Given a debug session at step 1
  When I select step 7 and choose Run to here
  Then steps 1 to 6 execute in order
  And the session stops before step 7

Scenario: Skipping a step
  Given the session is at step 4
  When I skip it
  Then step 4 does not execute
  And the session advances to step 5
  And the transcript records the skip

Scenario: The target tab is no longer the active one
  Given a debug session at step 5
  And I have switched to a different tab in that window
  When I press Step
  Then step 5 executes
  And the snapshot shows URL and title with no screenshot and the reason there is none
  And the previous screenshot is not shown as if it were current

Scenario: A step times out
  Given the session is at step 8
  When the extension stops answering and the step times out
  Then the step is reported as indeterminate — it may have run
  And the offered actions are to check the page or close the session
  And no option to re-run the step is offered
```

### Story 2 — Seeing variables

**As** the Author, **I want** to see the variable bag between steps, **so that**
I can catch a substitution problem before it silently does the wrong thing.

```gherkin
Scenario: Variables are visible after an extract
  Given step 4 extracts into "total"
  When I step past it
  Then the variable panel shows total and its value, from the bag the executor wrote

Scenario: An empty substitution is visible in the step that used it
  Given step 10 types "{{total}}" and no earlier step has produced total
  When I step onto step 10
  Then the resolved step shown for step 10 has an empty text field
  And the value shown matches exactly what was sent to the extension
  And the transcript records that resolved step
```

The warning that `{{total}}` is unproduced is **PRD 11's**, raised on save by its
static check across the definition. This PRD does not repeat it: the debugger shows
the resolved step it received, which is evidence rather than a second implementation
of substitution.

### Story 3 — Safe mode

**As** the Author, **I want** committing steps blocked by default, **so that**
testing does not place an order.

```gherkin
Scenario: A committing step is refused before it runs
  Given safe mode is on
  And step 11 clicks a control whose accessible name is "Place order"
  When I step onto it
  Then the click is never dispatched to the page
  And the debugger names the step and why it was refused
  And the refusal is recorded in the transcript
  And no repair is attempted for that step

Scenario: Arming a single step
  Given a refused committing step
  When I explicitly arm that step and step again
  Then it executes for real
  And the arming is recorded in the transcript
  And safe mode remains on for every subsequent step

Scenario: A step kind safe mode cannot classify
  Given safe mode is on
  And step 7 is a select step whose option reads "Confirm purchase"
  When I step onto it
  Then the step executes, because select is not classified
  And the step is labelled as not covered by safe mode
```

### Story 4 — Edit and retry

**As** the Author, **I want** to edit the current step and run it again, **so
that** I can converge on a working selector quickly.

```gherkin
Scenario: Fixing a step of a user routine mid-session
  Given a debug session on a user routine, at step 6, and the step failed
  When I edit its selector in the editor and re-run the step
  Then the edited step executes
  And both attempts appear in the transcript
  And saving writes a routine_versions row and increments the routine's version

Scenario: A system routine cannot be saved from a debug session
  Given a debug session on a system routine
  When I edit step 6 and re-run it
  Then the edited step executes against the session's own copy
  And no save is offered, because updates/ is the source of truth
  And the offered path to keep the edit is exporting a copy to import as a user routine
```

### Story 5 — Holding the browser

**As** the Operator, **I want** a debug session to be visible in the queue, **so
that** I understand why a scheduled run has not started.

```gherkin
Scenario: A debug session holds the run slot
  Given a debug session is active
  When a scheduled run comes due
  Then it is queued behind the session
  And the queue shows the debug session as the reason

Scenario: An abandoned session releases the slot
  Given a debug session inactive for the timeout period
  When the inactivity timeout fires
  Then the session closes by the same path an explicit Close uses
  And the lease is released and queued work proceeds

Scenario: Cancel ends a session parked between steps
  Given a debug session waiting between steps
  When I press Cancel
  Then the wait is rejected rather than left parked
  And the session closes and its thread reaches a terminal status
```

### Constraints and edge cases

- Debugging is for routine runs only. A chat run decides its next action from the
  live page, so "step through" has no meaning — the equivalent is the chat loop
  itself.
- Steps run against the real page; there is no page mocking and no time travel. A
  step already executed cannot be undone by the debugger.
- Both sensitive-field guards behave as in a normal run: `scanSensitive` **holds**
  the step, which is then retried up to `MAX_HELD_RETRIES`; `assertWritableTarget`
  **refuses** a `type` or `select` whose resolved target is a password, payment or
  one-time-code field, and that refusal is never healed.
- Step never advances by calling `resume`, because resume sets `skipScanOnce` and
  would disable the page-wide scan for every stepped step.
- Params are supplied at open, from the editor's param form. 🔵 **Open Question:**
  whether Authors want to change them mid-session.
- A debug session cannot start while a run is in flight, and a run cannot start while
  a session holds the lease. Neither pre-empts the other.
- The version handshake applies at open: `ExtensionSession.connect` refuses a
  mismatch between `EXTENSION_VERSION` and the loaded extension, with the same
  message a run gets today.

---

## 8. Out of Scope

- **Breakpoints and conditional stops.** Step, run-to-here and continue cover the
  need. Revisit if long routines make it painful.
- **Stepping backwards.** Nothing in the page can be rewound, so a Back button would
  only move the cursor while leaving the page ahead of it — a lie the debugger should
  not tell. Run-to-here from step 1 is the honest re-do.
- **Mocking pages or recording/replaying page responses.** Very large, and at odds
  with a product whose premise is the user's real session.
- **Time-travel or undo of executed steps.** Not possible against a live site.
- **Debugging chat runs.**
- **A full sandbox for commit actions.** Safe mode is a heuristic and is described
  as one.
- **Making `select` and `navigate` classifiable.** Teaching `isCommitting` about a
  `select` option label or a navigation URL changes shipped run behaviour for every
  run, not just debug sessions. 🔵 **Open Question:** probably worth doing; not here.
- **Interleaving a session with a run.** Each waits for the other; neither pre-empts.
- **Mid-session param editing.**
- **Persisting a session across an app restart.** PRD 05 drops queue entries on
  restart and a lease is no different; a debug session that survived a restart would
  mean the app starts driving a browser on launch.

---

## 9. Dependencies & Risks

### Dependencies

Per README.md's table: **PRD 01, 03, 05, 11**, plus PRD 12 assumed. The previous
draft's header listed 05 and 11, its §9 added 01, PRD 03 was required by Story 4 and
listed nowhere, and there was no extension, IPC or persistence dependency at all —
which is exactly the rework "build it last" was meant to avoid.

| Dependency | What this PRD needs from it |
|---|---|
| **PRD 01** | `runs` / `run_events` / `run_artifacts`; `step_json` on the step event; absolute step indexes; the failing step index on the terminal error event; `onArtifact` and `onRepair`; the widened status union |
| **PRD 03** | `routine_versions` — Story 4's save, and the primary metric's join |
| **PRD 05** | the queue, plus a `debug` lease entry its current entry shape cannot express |
| **PRD 11** | the editor as this feature's home, the param form, and the on-save `{{name}}` static check this PRD must not duplicate |
| **PRD 12** | 🔶 assumed, not required: per-step selector feedback through its `RESOLVE` extension message |

**Five workstreams, not "orchestrator work only":**

1. **Orchestrator** — the shared single-step executor extracted from `runRoutine`
   and called by both paths; `openDebugSession` / `closeDebugSession`; the lease.
2. **Extension** — the pre-execution classify-or-refuse in `ACTIONS.click` and
   `ACTIONS.type` (content.js), flag forwarding in `runStep` (background.js),
   `refused` on `BridgeResult`, and the `EXTENSION_VERSION` +
   `extension/manifest.json` bump (both `1.4.0` today) held together by
   `tests/extension-session.test.ts`, with a new `tests/content-script.verify.mjs`
   case. Testing it needs a full browser quit, not a window close (AI_CONTEXT.md §9).
3. **IPC** — new channels by AI_CONTEXT.md §10's recipe: `shared/ipc.ts` → a
   `handle(...)` behind `trustSender` in `registerIpcHandlers` → a method on `api` in
   the preload → the renderer, with a push channel exposed as
   `onDebugChanged(listener): () => void` to match the existing unsubscribers.
4. **Persistence** — one appended `MIGRATIONS` entry: the `debug` source, refused and
   skipped statuses, per-step DOM, the armed-step event, `runs.routine_version`.
5. **Types and the second backend** — `screenshotError` on `PageSnapshot` and
   `StepRefusedError` in session.ts, plus the `BrowserSession` twin, since
   AI_CONTEXT.md §8 keeps the backends matched at the type level.

Workstreams 2–5 each change something AI_CONTEXT.md §5–§8 documents, so its §13 rule
applies: update it in the same change, not afterwards.

### Risks

| Risk | Mitigation |
|---|---|
| **Safe mode is trusted more than it deserves.** It covers `click` and `type` only; `select` and `navigate` are unclassified, and within the covered kinds an unlabelled control or a link can be missed. 🔶 **Assumption:** an Author who believes they are sandboxed will test a payment flow — untested, and the reason for every mitigation here. | State the limitation on the step, not only in docs. Never use the word "sandbox". Label uncovered kinds explicitly. Show refusals so the mechanism's coverage is judgeable rather than assumed. |
| **A refusal is healed, routing around safe mode.** `isHealable` rejects only `StepExecutionError`s whose message matches `/refusing to write into/`. | A distinct `StepRefusedError` that `isHealable` rejects by class, and no `StepHealer.plan` call for a refused step under any setting. Test both. |
| **A duplicated execution path drifts from `runRoutine`**, so debugging tests something the real run does not do. | The shared executor in §5, with the named symbols it must own. One flag, no second branch. The spike in §10 has this as its exit criterion. |
| **The extension change lands in shipped run behaviour.** content.js is on every run's path, so a bug in the new branch breaks normal runs, not just debug sessions. | The refusal path is unreachable unless the app sends `safeMode`, which only a debug session does. Cover both states in `tests/content-script.verify.mjs`. |
| **A concurrent `connect()` kills a live session.** `ExtensionBridge.start` calls `cancel()`, failing all pending work and rejecting parked waiters. | The lease is the only path to `connect()`; a test asserts a queued entry cannot start while a lease is held. |
| **A debug session holds the browser indefinitely**, blocking scheduled work. | Inactivity timeout routed through the one close path; visible in the queue with its reason; lease age as the guardrail metric. |
| **Stepping produces a false sense of a routine's health** — it passes step by step under supervision and fails end to end, because timing differs. | Encourage a full run after debugging. `source = 'debug'` keeps sessions out of PRD 01's unattended rate and PRD 09's fingerprints, so a passed session can never be counted as a passed run. |

---

## 10. Open Questions

**Settled since the previous draft**, and recorded here because §10 previously
reopened them:

- **Safe mode is on by default and has no session-wide off switch.** §5 stated this
  as fact and IMPLEMENTATION-ORDER.md ships it as an M4 deliverable — "committing
  actions blocked by default" — so a question asking whether to default it on was
  contradicting both. What remains genuinely open is measurable, below.
- **Only layer 2 is switchable.** Layers 0 and 1 live in page-core.js and cannot be
  turned off; layer 3 keeps run semantics. "Healing on/off" was never the choice.

Still open:

- 🔵 How much of `runRoutine` can be shared cleanly? Worth a spike, with exit
  criteria rather than a vibe: (a) one executor that `runRoutine` calls for every
  step kind including `extract` and `screenshot`, with orchestrator test behaviour
  unchanged; (b) the debug path calls it with no branch inside it except the layer-2
  flag; (c) `resolveStep` and `resolveTemplate` end up with exactly one caller each.
  If (a) fails, this is a parallel implementation and the drift risk in §9 is the
  real one.
- 🔵 What fraction of real committing controls does `isCommitting` label? Answerable
  for `click` and `type` once §6's refusal and armed counters exist; unanswerable for
  `select` and `navigate` until they are classified at all.
- 🔵 Should layer 2 default to off? Leaning off: a debugger should show what the step
  does, not what a repair makes it do. And should the toggle be per session or per
  step?
- 🔶 **Assumption:** a 30-minute inactivity timeout. Arbitrary; revisit once §6's
  lease-age guardrail has produced a distribution.
- 🔵 Should stepping a system routine be offered at all, given nothing can be saved
  from it? §7 says yes — stepping is still diagnosis, and PRD 10's export is the
  escape — but it is worth watching for confusion.
- 🔵 Do Authors want to change params mid-session, or is supplying them at open
  enough? Unknown until the feature is in use.

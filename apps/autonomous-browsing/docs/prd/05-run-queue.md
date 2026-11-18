# PRD 05 — Run queue

| | |
|---|---|
| **Phase** | Unattended |
| **Depends on** | Nothing technically. One acceptance criterion is a soft dependency on PRD 01 — see §7, Story 4 |
| **Blocks** | PRD 07, PRD 13 |
| **Status** | Draft |
| **Author** | hmukhtar@outsentia.com |

Shared personas and strategic context: [README.md](README.md). The dependency table there
is the one authority; this header must not contradict it.

---

## 1. Executive Summary

We're building a **run queue** — an ordered, inspectable queue in front of the
orchestrator's single-run mutex — for **the Operator** to solve the problem that a second
run request while one is in progress is either thrown away or, in today's UI, not askable at
all, which will make concurrent requests wait their turn and is a hard prerequisite for
scheduling.

The queue goes **in front of** `AutomationOrchestrator`, not inside it. `busy` and
`OrchestratorBusyError` stay exactly where they are, demoted from a rejection gate a user
can hit to a last-resort invariant assertion the queue is supposed to make unreachable. That
keeps the orchestrator's constructor signature — and the 66 `new AutomationOrchestrator(...)`
call sites in [tests/orchestrator.test.ts](../../tests/orchestrator.test.ts) — untouched.

It is not "contained to one class". §9 enumerates the nine files it lands in and the one
`ExtensionBridge` change it needs. It is still small; it is not zero.

---

## 2. Problem Statement

### Who has this problem?

The Operator, whenever they want two things run. The scheduler in PRD 07, on every
overlap, permanently.

### What is the problem?

Concurrency is handled by rejection.

```
if (this.busy) throw new OrchestratorBusyError();
this.busy = true;
```

That guard opens both `runRoutine` and `runChatGoal` in
[orchestrator.ts](../../src/main/automation/orchestrator.ts), and `OrchestratorBusyError`
in the same file carries the message *"an automation run is already in progress"*.

**But the Operator almost never sees that error, and that is worse.** The renderer still
mirrors busy-ness, but no longer from a flag it sets itself. `setBusy` and `syncControls`
are gone with the vanilla renderer; the React rewrite computes
`const busy = runs.liveRunId !== null` in
[App.tsx](../../src/renderer/src/App.tsx), where `liveRunId` comes from `useRuns` in
[state/useRuns.ts](../../src/renderer/src/state/useRuns.ts). `busy` is then handed to
`AutomationRail` (disabling every Run button), to `GoalComposer` (disabling Send), and to
`TopBar` as `running` (which is what *shows* Pause and Stop at all). So during a run the
second request is still not rejected — it is *unaskable*, because the button is disabled.
`OrchestratorBusyError` remains hard to reach from the UI: `createWindow` in
[index.ts](../../src/main/index.ts) makes one window, and that window disables its own
controls before it can collide with itself.

Two consequences follow, and they are the actual problem:

1. **There is no queue because there was never a second request** — the UI absorbed it. Any
   caller that is *not* that renderer (PRD 07's scheduler, PRD 13's debugger, a second
   window) walks straight into the throw with no retry path.
2. **The "Cancel stays disabled" half of this argument is now fixed, and the argument
   survives anyway.** The old vanilla renderer set its `busy` flag itself, so a run it did
   not start left Cancel disabled. That is no longer true, verified 2026-08-27: `liveRunId`
   is set from `automation.onProgress`, and `runObserver.progress` in
   [ipc.ts](../../src/main/ipc.ts) pushes every event through `broadcast` in
   [index.ts](../../src/main/index.ts), which sends to *every* `BrowserWindow`. A
   scheduler-started run therefore does light up `busy` and does show Stop. What remains
   broken is narrower and still fatal to a queue: `busy` is **a boolean derived from progress
   events**, so it can say *something is running* and nothing else. It cannot express a
   waiting entry, a `waiting-for-extension` entry, a suspended queue, or a position in a
   line — none of which emit progress events, because none of them are running. It is also
   blind until the first event arrives: a run already in flight when this window opened shows
   nothing until its next step reports. A queue needs a list and a state machine, not a flag,
   which is why §5 replaces the derivation rather than extending it.

The single-run constraint itself is **correct and must stay**, and it holds on both
backends for different reasons. On the **extension** backend there is one target tab —
`handle`'s `start` case in [background.js](../../extension/background.js) binds
`targetTabId` from `chrome.tabs.query({ active: true, lastFocusedWindow: true })` — and
steps are serialised deliberately via `serialize`. On the default **playwright** backend
there is one adopted `activePage` on one browser context inside
[playwright-session.ts](../../src/main/automation/playwright-session.ts), and no
serialisation lock of its own — the orchestrator's `busy` flag is the only thing keeping two
runs off that page, which is precisely why demoting it to an assertion (below) has to be
done carefully. Either way one `AutomationSession` is held by one orchestrator. This PRD
does not add parallelism.
It changes what happens to the *second* request from "discard it, or hide the button" to
"hold it, and show it".

### Why is it painful?

- **User impact.** 🔶 **Assumption:** today, mild — the Operator waits for the greyed-out
  Run button to come back and clicks again. This is a mechanism claim as much as a severity
  claim, and both halves are unvalidated: no telemetry exists, so we do not know whether
  anyone has tried to start a second run, nor what they did when they could not.
- **Business impact.** With PRD 07, it stops being mild. Two routines scheduled at 09:00
  means one of them throws `OrchestratorBusyError` into a handler with no retry, every day,
  with an error nobody is present to read. Scheduling on top of a busy flag ships a product
  that drops work by design.

### Evidence

- **Code.** The guard in `runRoutine` and `runChatGoal`; the absence of any retry around
  `deps.automation.runRoutine` in the `automationRun` handler in
  [ipc.ts](../../src/main/ipc.ts); the absence of any retry in `startRoutine` / `startGoal`
  in [state/useRuns.ts](../../src/renderer/src/state/useRuns.ts), which catch the throw and
  park the message in `startError`.
- **Code.** The derived `busy` in [App.tsx](../../src/renderer/src/App.tsx), which is where
  the "user sees an error" story falls apart: `AutomationRail` and `GoalComposer` are
  disabled while it is true, so the second request is rarely made at all.
- **Structural.** `busy` is cleared in a `finally`, so it is sound as a mutex — the problem
  is what it does to the loser, not whether it leaks.

---

## 3. Target Users & Personas

**Primary: The Operator** — wants both things run, and does not care in which
order.

**Secondary: PRD 07's scheduler**, which is a machine that cannot read an error
dialog and cannot notice a disabled button. This is the persona that makes the feature
necessary rather than merely nice.

**Tertiary: PRD 13's debug session**, which needs to *hold* the slot without being a run.
See §5, the entry shape.

**Job-to-be-done:** *When I ask for two runs, I want both to happen, so I do not
have to sit and watch for a gap.*

---

## 4. Strategic Context

**Ladders up to:** unattended operation. Unattended means nothing is present to
retry a rejected request, and nothing is present to notice a disabled button.

**Why now.** Strictly before PRD 07 and PRD 13. Doing it first means the scheduler never has
to know that a busy state exists.

---

## 5. Solution Overview

### The queue, and where it lives

A new `RunQueue` in `src/main/automation/run-queue.ts`, constructed in
[index.ts](../../src/main/index.ts) beside the orchestrator and the bridge. It owns an
ordered list of entries and calls `AutomationOrchestrator.runRoutine` / `runChatGoal` one at
a time. `registerIpcHandlers` takes it as a new `IpcDeps` field and routes
`IpcChannels.automationRun` and `IpcChannels.automationChatSend` through it instead of
calling the orchestrator directly; `automationChatSave` and `automationChatClear` keep
calling the orchestrator, because chat-session bookkeeping stays there.

`busy` and `OrchestratorBusyError` are **not** deleted. They become the assertion that the
queue is correct: if the queue ever dequeues while an entry is running, the throw is the bug
report. §6's first guardrail is measured on exactly that.

`RunQueue.enqueue` returns the same promise shape the callers already await, so the
`automationRun` handler's post-run `applyRepairs` block — the `kind === 'user' && result.repairs.length > 0`
half of AI_CONTEXT.md §8's per-run repair rule — keeps working unchanged.

### The entry shape

```
id            string
priority      'interactive' | 'background'
state         'waiting' | 'waiting-for-extension' | 'running' | 'held'
enqueuedAt    number
startedAt     number | null
dedupeKey     string | null      // background entries only; see Staleness
work          { kind: 'routine'; target: RunRoutineInput }
            | { kind: 'chat';    input: ChatSendInput }
            | { kind: 'lease';   label: string }
```

`work` is a discriminated union rather than "routine-or-goal plus params" **because PRD 13
needs a non-run occupant of the slot.** Its §5 says a debug session "takes the run slot from
PRD 05's queue for its duration", and a session is not a routine and not a goal — it is a
lease held until the Author ends it or it times out. The `lease` variant is declared here and
has no producer in this PRD; PRD 13 adds the producer, not a reshaping of the type. README.md's
table makes 05 block 13, so getting this wrong here is a rework there.

`RunRoutineInput` and `ChatSendInput` already exist in
[types.ts](../../src/shared/types.ts) and are already shape-checked by
`assertRunRoutineInput` and `assertChatSendInput` in [ipc.ts](../../src/main/ipc.ts). The
queue reuses both; it does not add a second validation site.

### Priority

Two levels, not a general priority system:

- **Interactive** — anything a human just clicked, including chat goals.
- **Background** — scheduled runs from PRD 07, and PRD 13 leases.

An interactive entry is inserted ahead of every waiting **background** entry and behind every
waiting interactive entry — FIFO within a level. It never interrupts a run already in
progress; the current entry always finishes or is explicitly cancelled.

There is **no manual reorder.** An earlier draft of this section granted one with no story,
no acceptance criterion, and no rule for how a hand-placed position survives an interactive
insertion. Cancel-and-re-issue already reorders interactive work, and PRD 07 already
reorders background work by rescheduling. Reorder is now in §8.

### Staleness — owned here, not deferred

An earlier draft said "PRD 07 owns this policy; the queue enforces it", while PRD 07 §5 says
a stale background entry is dropped "(PRD 05's staleness rule)". That circle is closed in
this PRD's favour; the rule is:

A background entry may carry a `dedupeKey` chosen by whoever enqueued it (PRD 07 uses the
schedule id). On enqueue, if a **waiting** entry with the same `dedupeKey` already exists,
the older one is removed with disposition `superseded`, and the new entry takes the older
one's position rather than going to the back. A **running** or **held** entry is never
superseded — cancelling a run is a separate, explicit act. Interactive entries carry no
`dedupeKey` and are never deduplicated: 🔶 **Assumption:** an Operator who clicks Run twice
wants two runs, unvalidated.

PRD 07 needs no edit for this; its existing sentence now points at a real rule.

### Bounds and the refusal message

**Depth cap.** 🔶 **Assumption:** 50 waiting entries. Beyond it, `RunQueue.enqueue` throws a
new `QueueFullError` whose message is **frozen at exactly**:

```
the run queue is full (50 waiting) — cancel something or wait for it to drain
```

The exact string is a requirement, not a suggestion, because AI_CONTEXT.md §8 leaves the
renderer nothing but message matching: Electron drops custom error fields and the preload's
`IPC_ERROR_PREFIX` strip in [index.ts](../../src/preload/index.ts) hands the renderer a bare
message. If the cap becomes configurable, the number in the message is interpolated and any
renderer-side match must key on the `the run queue is full` prefix only.

**`OrchestratorBusyError` is renderer-visible and must not be removed or reworded.** It is
rendered verbatim by the *Did not start* notice in
[App.tsx](../../src/renderer/src/App.tsx), fed by `startError` in
[state/useRuns.ts](../../src/renderer/src/state/useRuns.ts), and PRD 04 §7 explicitly names it
("rather than failing with `OrchestratorBusyError` if that PRD has shipped"). Deleting the
class or editing its string is a renderer-visible break and an AI_CONTEXT.md §5 symbol-row
edit in the same change.

### Waiting for the extension

Entries wait rather than fail. An entry enqueued while the extension is absent enters
`waiting-for-extension` and is not dispatched; when the extension connects, the queue
resumes dispatching. If it is still absent after a timeout (🔶 **Assumption:** 5 minutes),
the entry ends with disposition `expired-no-extension`.

This is the part that is **not** contained to the orchestrator, and §9 carries the design
choice. In short: `AutomationSession` in [session.ts](../../src/main/automation/session.ts)
exposes no connection state and no events, and `ExtensionSession.connect` calls
`bridge.start()`, which throws `ExtensionNotConnectedError` immediately when the socket is
down. The queue therefore needs the bridge, which already extends `EventEmitter` and emits
`connected` / `disconnected` from `adopt` in
[extension-bridge.ts](../../src/main/automation/extension-bridge.ts).

### Pause, and why the queue must respect it

AI_CONTEXT.md §8's control-message invariant matters here: `pause`, `resume`, `stop` and
`abandon` are in `CONTROL_TYPES` in [background.js](../../extension/background.js) and
dispatch straight from the port listener without taking `serialize`'s lock, because a step
can hold that lock for its whole timeout. So Pause reaches a running step immediately and is
**not** a signal that the run ended. Three rules:

- **P1 — the queue does not dequeue while the bridge is paused.** `RunQueue` reads
  `ExtensionBridge.isPaused` and subscribes to its `paused` / `resumed` events. Pause is a
  bridge-level flag, not a per-entry one; there is no such thing as pausing entry #3.
- **P2 — `ExtensionBridge.start` must stop silently un-pausing.** It currently calls
  `this.cancel()`, and `cancel()` sets `paused = false` and `pauseReason = null`. So starting
  a queued entry while the user is mid-credential-hold would clear the hold with no click.
  Required change: `start()` gains a guard that throws when `isPaused`, with the frozen
  message `the browser is paused — resume or cancel before starting another run`. P1 should
  make it unreachable; P2 is what makes "should" checkable.
- **P3 — a Cancel issued while paused suspends the queue rather than advancing it.**
  `bridge.cancel()` is global and argument-less: it fails every pending request, rejects
  every waiter with `RunCancelledError`, resets `paused`, and sends `stop`. The
  `automationCancel` handler in [ipc.ts](../../src/main/ipc.ts) passes it no id, and the
  preload exposes it as `cancel(): Promise<void>`. So a user who paused for a credential
  field and then hit Cancel would land in an unpaused, idle bridge — and Story 2's "and B
  starts" would put the next queued run into their live browser with no click. Instead the
  queue sets its own `suspended` flag and waits for an explicit Start.

### Cancel: two different operations, two channels

`automation:cancel` keeps its meaning — *stop what the browser is doing now* — and keeps
taking no argument. **Cancelling a specific waiting entry needs a new channel**, because
there is nowhere to put an id today. A waiting entry is cancelled by removal, with no
browser involvement at all.

### Which tab a queue-started run binds

`handle`'s `start` case in [background.js](../../extension/background.js) resolves the target
tab at **dequeue** time from `chrome.tabs.query({ active: true, lastFocusedWindow: true })`.
A queue makes dequeue time something the Operator did not choose, so:

- A **background** entry does not dequeue silently. 🔶 **Assumption:** a dismissible
  "starting *X* in the tab you are on" notice with a 10-second countdown, cancellable from
  the notice. Arbitrary duration, unvalidated.
- The notice is a requirement even though it feels like polish, because of AI_CONTEXT.md §9's
  `capture()` trap: the target tab must stay the active tab in its window or every
  `screenshot` step and every DOM snapshot fails. A run the Operator did not notice starting
  is a run they will break by switching tabs.
- Opening a dedicated tab or window instead is out of scope (§8) and a §10 open question.

### Visibility and control

The queue is shown in the UI: what is running, what is waiting, in what order, and each
entry's state including `held`. The Operator can cancel a waiting entry, cancel the running
entry, clear the waiting entries, and start a suspended queue.

**The renderer must stop deriving its controls from a boolean.** `const busy =
runs.liveRunId !== null` in [App.tsx](../../src/renderer/src/App.tsx) is replaced by state
read from the queue snapshot, and the `busy` props threaded into `AutomationRail`,
`GoalComposer` and `TopBar` become queue-derived. The reason has changed since this PRD was
written and is now narrower: broadcast progress events already keep Cancel alive for a run
this window did not start (§2), so the failure is no longer an uncancellable run. It is that
a boolean cannot say *waiting*, *waiting for the extension*, *suspended*, or *third in line*
— every state a queue adds is invisible to it. Without the replacement PRD 07 ships work
that runs with no indication it was ever pending.

**The queue surface had nowhere of its own to live, and it now does.** This shipped in two
steps, deliberately. The queue first landed degraded — a `QueueSection` at the top of
`RunRail` — because at the time there was no view-state model in the renderer and **this PRD
does not invent one in passing.** The model landed immediately after, so the degraded form is
gone: `View` in [view.ts](../../src/renderer/src/lib/view.ts) is a discriminated union,
`useView` holds one, and `App.tsx` switches the third column on `view.kind`. The queue is
`QueueView`, a pane of its own reached from a tab in the runs rail, and the tab is absent
until something is actually queued so an idle app grows no chrome.

The split that decided the shape is by *urgency*, not by content. `QueueView` holds what you
go and look at: the running entry, the waiting ones in order, and the controls.
`QueueNotices` holds what must find you instead — a suspended queue and a dropped entry —
and it renders in the notice stack under `TopBar` beside the hold banner, because work that
will not happen is not something a person should have to navigate to discover.

PRD 11's routine editor and PRD 13's debugger are each one more variant and one more pane;
the recipe is in AI_CONTEXT.md §10.

### Persistence

The queue does not survive a restart, and this PRD adds no table. What happens to a waiting
entry at quit depended on whether PRD 01 had shipped. **It has** — verified 2026-08-27:
`MIGRATIONS` in [database.ts](../../src/main/db/database.ts) has two entries and its second
creates the `runs` table — so only the second half of the original statement is live:

- The drain writes one `runs` row per dropped entry with `status: 'cancelled'` and
  `error: 'the app closed before this entry started'`. PRD 01's `interrupted` status is not
  the right one — it is defined for a row that was *open* when the app quit, and a waiting
  entry never opened one.
- Only the drops nobody was present to see earn a row. `dropped-app-quit` and
  `expired-no-extension` do; `cancelled-by-user`, `superseded` and `refused-queue-full` do
  not, or the history fills with runs that never ran.

A background entry will recur on its own schedule; an interactive one the user can re-issue.
Persisting a queue across restarts invites the app to start driving a browser the moment it
launches, which is the wrong default.

### The quit drain is a correctness requirement, not tidiness

AI_CONTEXT.md §8: *any new path that can park a run must be reachable by `cancel()`*. This
PRD adds **two paths that are not**, and both must be drained explicitly:

1. a `waiting` entry, which holds no entry in the bridge's `pending` map and no `Waiter`;
2. a `waiting-for-extension` entry, which holds a timer instead.

`bridge.close()` calls `cancel()`, and `cancel()` only walks `pending` and `waiters` — see
`failAllPending` and the waiter loop in
[extension-bridge.ts](../../src/main/automation/extension-bridge.ts). Neither collection
contains a queued entry, so quit would leave those promises unsettled. Required: a
`RunQueue.drain(reason)` call in the `before-quit` handler in
[index.ts](../../src/main/index.ts), **before** `bridge.close()`, alongside the existing
`stopWatching()` and `db.close()`.

### Chat goals in a queue

**This section's problem has dissolved, verified 2026-08-27.** It was written against an
orchestrator that kept chat state in a `chatSessions` `Map`: a queued goal had no `Map` entry
until it dequeued, so `saveChatSession` threw `no chat session "<id>"`, and the fix was an
`openChatSession(sessionId, goal)` called at enqueue time. That `Map`, `saveChatSession`,
`clearChatSession` and the `automation:chat:clear` channel have all been deleted as dead
code. Saving is keyed by `runId` and reads `runs.recorded_steps`, written from
`RunObserver.recorded` — so there is no session to open early and **`openChatSession` is
struck from this PRD's scope**, along with the orchestrator row for it in §9.

What replaces it is smaller but not nothing: a queued chat goal has **no `runId` yet**,
because the run id is minted inside `runChatGoal`. So a waiting entry is identified by its
own queue-entry id and acquires a `runId` only at dequeue, and the queue surface must not
promise a thread link before one exists.

The renderer half still matters: `startGoal` in
[state/useRuns.ts](../../src/renderer/src/state/useRuns.ts) mints a fresh `sessionId` per
send and the thread appears only once progress events arrive, so a queued chat goal shows a
waiting entry and no thread until it actually runs. 🔵 **Open Question:** should a queued chat goal be
editable while it waits, given its steps are decided from the live page at run time and the
page will have moved on? Strict reading says a queued chat goal is already stale by
construction — see §10.

### IPC surface — four places each, per AI_CONTEXT.md §10

| Channel | Kind | Payload |
|---|---|---|
| `queue:list` | invoke | → `QueueSnapshot` |
| `queue:cancel` | invoke | entry id → boolean |
| `queue:clear` | invoke | → number removed (waiting entries only) |
| `queue:start` | invoke | → void (releases a `suspended` queue, per P3) |
| `queue:changed` | **push** | `QueueSnapshot` |

Each invoke channel touches four places, in order:

1. `IpcChannels` in [shared/ipc.ts](../../src/shared/ipc.ts);
2. a `handle(...)` in `registerIpcHandlers` in [main/ipc.ts](../../src/main/ipc.ts), behind
   the existing `trustSender` allowlist, shape-checking its payload beside
   `assertRunRoutineInput`;
3. a method on `api` in [preload/index.ts](../../src/preload/index.ts);
4. the renderer — a new `useQueue` hook in
   [state/](../../src/renderer/src/state/) alongside `useAutomations`, `useRuns`,
   `useBrowser` and `useExtension`, consumed by [App.tsx](../../src/renderer/src/App.tsx).

`queue:changed` is a push channel, so per the same recipe it gets an unsubscriber. The
preload nests its listeners on `api` rather than exposing bare top-level ones, so this is
`api.queue.onChanged(listener): () => void`, matching the six that exist today
(`onRoutinesChanged`, `automation.onProgress`, `automation.onStatusChanged`,
`automation.onHold`, `browser.onChanged`, `runs.onChanged`). It is broadcast through the `broadcast` closure
already defined in [index.ts](../../src/main/index.ts). `QueueSnapshot` is a new type in
[shared/types.ts](../../src/shared/types.ts).

🔵 **Open Question:** `automation:status` is already both an invoke and a push channel (the
deliberate trap in AI_CONTEXT.md §9), so queue depth could ride on `ExtensionStatus` instead
of a fifth channel. Rejected for now because the rail needs the entry *list*, not a count —
but if the rail turns out to only ever show a count, one channel is cheaper than five.

### AI_CONTEXT.md edits required in the same change

Per its §13, this PRD cannot ship without these:

- **§8, "One run at a time" — reword.** It currently reads *"`busy` in the orchestrator, one
  target tab, one socket. Any new path that can park a run must be reachable by `cancel()`."*
  Both halves change: serialisation moves to `RunQueue` with `busy` demoted to an assertion,
  and the second sentence acquires an exception — a queued entry is reachable by
  `RunQueue.drain`, not by `cancel()`. Weakening an invariant is exactly what §13 item 4
  requires an edit for.
- **§4 file map** — add `src/main/automation/run-queue.ts`.
- **§5 symbol index** — add `RunQueue`, `QueueFullError`, `QueueSupersededError` and
  `BrowserPausedError`; amend the `OrchestratorBusyError` row from
  "One-run-at-a-time guard" to the assertion it becomes.
- **§6 data contracts** — `QueueSnapshot` and the entry union are new cross-layer types.
- **§10 recipes** — the IPC recipe's push-channel count, "matching the existing six",
  becomes seven.

[ARCHITECTURE.md](../../ARCHITECTURE.md) and [HOW-IT-WORKS.md](../../HOW-IT-WORKS.md) both
document the busy guard as the serialisation point, so this change makes them stale too —
see §9.

---

## 6. Success Metrics

Every metric below names its instrument, or says plainly that it cannot be measured yet and
gives the proxy we will accept instead. Nothing in the product emits telemetry today.

### Primary

**Dropped run requests** — requests that never run because something else was running.

- **Instrument: the queue is the instrument.** Every entry reaches exactly one terminal
  disposition — `started`, `cancelled-by-user`, `superseded`, `refused-queue-full`,
  `expired-no-extension`, `dropped-app-quit` — and `RunQueue` counts them. The two
  dispositions nobody was present to see become durable `runs` rows (§5, Persistence); the
  per-disposition counters stay inside `RunQueue` and are logged once at quit, while the
  individual drops reach the queue rail through `QueueSnapshot.recent`. State that limit
  rather than implying a dashboard.
- **Baseline: cannot be measured today.** Nothing records a rejected request. The
  `automationRun` handler lets `OrchestratorBusyError` propagate, the preload strips it to a
  message, and the renderer's `startError` notice renders it and forgets it. The claim "current: all of them" is
  therefore a **code fact, not a measurement**: the guard in `runRoutine` / `runChatGoal` has
  no retry path in main, in the preload, or in the renderer. Accepted as evidence in place of
  a number.
- **Target: zero**, with `cancelled-by-user`, `superseded` and `refused-queue-full` counted
  separately so that zero is a checkable claim rather than a definitional one.

### Secondary

- **Median queue wait** — `enqueuedAt` to `startedAt`, both already on the entry. Rising
  values mean the single-browser constraint is becoming the bottleneck, which is the signal
  that would justify revisiting it. **Instrument gap:** PRD 01's `runs` table defines
  `started_at` but no queued-at column, so durable measurement needs either a `queued_at`
  column added to PRD 01's migration or acceptance that the number is session-scoped. Named
  here so PRD 01 can decide; not silently assumed.
- **Queue depth distribution** — max depth sampled on every enqueue. Same storage gap as
  above. 🔵 **Open Question:** no data at all today, so 50 is unfalsifiable until PRD 07
  generates real overlap.

### Guardrails

- **Never two runs at once.** Instrument: `OrchestratorBusyError`, kept for exactly this —
  if the queue dequeues while an entry is running, the orchestrator throws and the queue
  records an invariant violation rather than swallowing it. **Coverage today is zero:**
  `grep -n busy tests/*.ts` returns nothing, so the busy guard has never been tested, and the
  queue would arrive with no regression coverage to inherit. New tests are part of this PRD's
  scope, in a new `tests/run-queue.test.ts`: FIFO drain, interactive insertion, refusal at
  the cap, no dequeue while paused (P1), suspend-on-cancel-while-paused (P3), drain settles
  waiting entries, and a supersede case.
- **No added latency for the common case.** A request arriving at an idle, unsuspended queue
  starts immediately. **Baseline cannot be measured** — there is no timing telemetry to
  compare against. Proxy, and the acceptance bar: a `tests/run-queue.test.ts` assertion that
  an enqueue onto an idle queue reaches `AutomationSession.connect` with no intervening
  timer, i.e. the fast path introduces no `setTimeout` and no polling interval. `npm test` is
  pure logic with no Electron and no browser, so a wall-clock number is not available there;
  "no timer on the fast path" is the strongest thing that is.

---

## 7. User Stories & Requirements

### Epic hypothesis

We believe that queueing runs instead of rejecting them will eliminate dropped work,
because the current design discards any request that arrives while a run is in
progress. We will know we are right when scheduled overlapping runs (PRD 07) both
complete.

### Story 1 — A second request waits

**As** the Operator, **I want** a run requested during another run to wait, **so
that** both happen without me watching for a gap.

Positions are stated from the head: **the running entry is position 0**, and the first
waiting entry is position 1.

```gherkin
Scenario: A second run is queued, not rejected
  Given routine A is running at position 0
  When I run routine B
  Then routine B is queued at position 1
  And I see it listed as waiting
  And no error is shown
  And the Run button is not disabled merely because A is running

Scenario: The queue drains in order
  Given routine A is running and B and C are queued in that order
  When A completes
  Then B starts
  And when B completes, C starts

Scenario: A request to an idle queue starts immediately
  Given nothing is running and the queue is not suspended
  When I run routine A
  Then A starts without entering a waiting state

Scenario: The queue refuses at the cap with an exact message
  Given 50 entries are waiting
  When I run routine X
  Then the request is refused
  And the message is "the run queue is full (50 waiting) — cancel something or wait for it to drain"
```

### Story 2 — Managing the queue

**As** the Operator, **I want** to see and change what is waiting, **so that** I
stay in control of what my browser does next.

```gherkin
Scenario: Cancelling a queued entry
  Given routine B is queued behind a running routine A
  When I cancel B
  Then B is removed and never runs
  And A continues uninterrupted
  And no message is sent to the extension

Scenario: Cancelling the running entry does not clear the queue
  Given A is running, the browser is not paused, and B is queued
  When I cancel A
  Then A stops
  And B starts

Scenario: Clearing the queue leaves the current run alone
  Given A is running and B, C are queued
  When I clear the queue
  Then B and C are removed
  And A continues to completion

Scenario: Cancel is available for a run the renderer did not start
  Given a scheduled run is at position 0
  When I look at the controls
  Then Cancel is enabled
```

### Story 3 — Interactive work goes first

**As** the Operator, **I want** what I just clicked to go ahead of scheduled work,
**so that** background automation does not make the app feel unresponsive.

```gherkin
Scenario: A manual run jumps queued scheduled runs
  Given two scheduled runs are queued behind a running routine
  When I manually run routine X
  Then X is placed ahead of both scheduled entries
  And the running routine is not interrupted

Scenario: Interactive entries stay FIFO among themselves
  Given interactive entries X then Y are queued behind a running routine
  When a scheduled run is enqueued
  Then the order is X, Y, then the scheduled run
```

### Story 4 — Waiting on the extension

**As** the Operator, **I want** runs to wait for the extension rather than fail,
**so that** a browser I have not opened yet does not lose my request.

The second scenario's last line is a **soft dependency on PRD 01**: there is no run history
to appear in until PRD 01 ships. README.md's dependency table is the authority and correctly
lists PRD 05 as depending on nothing, so this is recorded rather than promoted — before
PRD 01, the criterion reads "and it is shown in the queue rail as expired, not silently
removed", and the history half is deferred.

```gherkin
Scenario: A queued run waits for the extension
  Given the extension is not connected
  When I run routine A
  Then A is queued with the state "waiting for the extension"
  And when the extension connects, A starts

Scenario: A run gives up after the timeout
  Given a queued run waiting for the extension
  When the timeout elapses with no connection
  Then the entry ends with the reason "the extension never connected"
  And it is shown as expired, not silently removed
  And (with PRD 01) it appears in the run history as a failed run
```

### Story 5 — The queue never surprises the browser

**As** the Operator, **I want** the queue to never take over my browser without me knowing,
**so that** it cannot start a run in the tab I am reading or resume past a hold I set.

```gherkin
Scenario: A background entry announces itself before taking the tab
  Given a scheduled entry is next and the browser is idle
  When the queue is about to start it
  Then I see which routine is starting and which tab it will use
  And I can cancel it from that notice before it starts

Scenario: The queue does not start anything while the browser is paused
  Given the browser is paused for a sensitive field
  And routine B is waiting
  When the running entry finishes or is cancelled
  Then B does not start
  And the queue is shown as suspended
  And B starts only after I explicitly start the queue

Scenario: Starting a run cannot clear a hold
  Given the browser is paused
  When anything attempts to start a queued entry
  Then it fails with "the browser is paused — resume or cancel before starting another run"
  And the pause is still in effect
```

### Constraints and edge cases

- Cancel semantics differ by state: a waiting entry is removed via the new `queue:cancel`
  channel with no browser involvement; the running entry goes through the existing
  `automationCancel` handler in [ipc.ts](../../src/main/ipc.ts), which calls the global
  argument-less `bridge.cancel()`.
- A queued entry whose routine is deleted before it starts fails with that reason. The
  `automationRun` handler already throws `no <kind> routine with id "<id>"` when
  `deps.system.get` / `deps.user.get` misses; the queue resolves the routine at dequeue, so
  that message is what the entry ends with.
- A run held for a human (a **layer-3 hold** — see README.md's "How a run ends today")
  stays at position 0 in state `held`. It is waiting on a person, not stalled, and the UI
  must say so — otherwise a held run looks like a hung queue. Per README.md, the run then
  **continues past** the held step, so `held` is a live state the entry leaves, never a
  disposition.
- A **scan hold** is not visible to the queue at all. `ExtensionSession.dispatch` retries the
  same step up to `MAX_HELD_RETRIES` and, at the cap, throws a plain `Error` that `isHealable`
  rejects, so the entry ends `error`. The queue must not treat the intervening
  `bridge.pause` / `resumed` traffic as an entry transition — only P1 cares about it.
- 🔶 **Assumption:** an Operator who sees a `held` entry at the head prefers a visible held
  state over the queue skipping past it. Unvalidated; the alternative is that a held run
  should yield the slot, which is §10's second question.

---

## 8. Out of Scope

- **Parallel runs.** One browser, one tab, one run. Not a limitation to remove.
- **Queue persistence across restarts.** Deliberate, argued in §5.
- **A general priority system.** Two levels only.
- **Manual reorder of waiting entries.** Cut, not deferred by accident: no story asked for
  it and its interaction with interactive insertion is undefined. §10 keeps the question.
- **A run table or any migration.** PRD 01 owns persistence; §5 states exactly what this PRD
  does and does not record without it.
- **Opening a dedicated tab or window for background runs.** A real answer to the tab-hijack
  risk, and a different feature — it changes `handle`'s `start` case in
  [background.js](../../extension/background.js) and `EXTENSION_VERSION`.
- **Per-entry pause.** Pause is a bridge-level flag; see P1.
- **Distributing runs across multiple browsers or machines.** Different product.

---

## 9. Dependencies & Risks

### Dependencies

**This is not contained to one class.** The files it lands in:

| File | Change |
|---|---|
| `src/main/automation/run-queue.ts` | new — `RunQueue`, `QueueFullError`, the entry union |
| [orchestrator.ts](../../src/main/automation/orchestrator.ts) | `busy` demoted to an assertion. Constructor unchanged. The `openChatSession` change an earlier draft listed here is struck — the `chatSessions` `Map` it managed is deleted |
| [extension-bridge.ts](../../src/main/automation/extension-bridge.ts) | `start()` refuses while `isPaused` (P2) |
| [shared/ipc.ts](../../src/shared/ipc.ts) | five channel names |
| [shared/types.ts](../../src/shared/types.ts) | `QueueSnapshot`, the entry union |
| [main/ipc.ts](../../src/main/ipc.ts) | `IpcDeps.queue`; four `handle(...)`; `automationRun` / `automationChatSend` routed through the queue |
| [preload/index.ts](../../src/preload/index.ts) | four methods plus `onQueueChanged` |
| [main/index.ts](../../src/main/index.ts) | construct and wire `RunQueue`; bridge event subscriptions; `queue.drain()` in `before-quit` |
| [App.tsx](../../src/renderer/src/App.tsx) + a new `state/useQueue.ts`, `lib/queue-view.ts` and `components/QueueSection.tsx` | the queue surface, as a section at the top of `RunRail`; the derived `busy` replaced by `controlState(snapshot)` |
| `tests/run-queue.test.ts` | new — see §6's guardrail list |

**Connection state is the one real design decision.** Story 4 needs the queue to know when
the extension connects, and the orchestrator cannot tell it: it holds an `AutomationSession`
([session.ts](../../src/main/automation/session.ts)), whose interface is
`connect` / `disconnect` / `snapshot` / `runStep` / `extractText` / `holdForHuman` — no
connection state, no events — and `ExtensionSession.connect` calls `bridge.start()`, which
throws `ExtensionNotConnectedError` immediately when the socket is down. Two options:

- **Recommended: give `RunQueue` the `ExtensionBridge`.** It already extends `EventEmitter`
  and emits `connected` / `disconnected` from `adopt`, and `index.ts` already subscribes to
  both for `sendStatus`. Cost: `RunQueue` knows about the extension backend specifically.
- **Rejected: widen `AutomationSession`** with `isConnected` and a change notification. The
  original argument here cited `browser-session.ts` as the cost; that file was **deleted on
  2026-08-26** (AI_CONTEXT.md §12), so that cost is gone. The rejection survives on a
  different one: connection state is backend-specific. `PlaywrightSession.connected` returns
  a constant `true` because it launches or adopts its own Chrome on demand, so the widened
  member would be a lie on the default backend, and every future backend would owe an honest
  answer to a question only the extension asks. `SessionControl` already carries `connected`
  plus the `connected` / `disconnected` events, and that is the interface the queue takes.

**Test coverage does not exist to inherit.** `grep -n busy tests/*.ts` returns nothing: there
are no tests for the busy flag, so the queue arrives with zero regression coverage for the
behaviour it replaces. §6's guardrail list is the coverage this PRD must create, not update.

### Documents this change makes stale

- [ARCHITECTURE.md](../../ARCHITECTURE.md) describes the run path as setting `busy`, refusing
  when `busy` with `OrchestratorBusyError`, clearing it in a `finally`, and lists "One run at
  a time — `busy` in the orchestrator" among its invariants. Four passages, all wrong the day
  the queue lands.
- [HOW-IT-WORKS.md](../../HOW-IT-WORKS.md)'s run trace ends with "clear the busy flag".
- [AI_CONTEXT.md](../../AI_CONTEXT.md) — the five edits enumerated at the end of §5, including
  the invariant reword, which §13 item 4 makes mandatory in the same change.

### Risks

| Risk | Mitigation |
|---|---|
| **A stuck run blocks the queue forever.** A layer-3 hold waits on a human indefinitely by design — README.md's closing note says a run that holds at 06:00 parks indefinitely, keeping the mutex, the tab and the socket. | Show the head entry's state prominently, including `held` with its reason. Cancel is always available and, per P3, does not silently advance the queue. Bounding the hold itself is PRD 07's; announcing it is PRD 08's. |
| **The renderer mirrors `busy`, so queue state must replace it.** `setBusy` disables every `.run-button` and `chat-send`; `syncControls` gates `#pause` and `#cancel` on the same local flag. A background-started run therefore leaves Cancel disabled and the Operator unable to stop their own browser. | The `queue:changed` push channel is the source of truth for all four controls. Called out as a required change in §5, not left as UI polish — this is the reason the channel exists. |
| **Cancel is global and argument-less, and resets `paused`.** `bridge.cancel()` fails all pending, rejects all waiters, clears `paused` / `pauseReason`, and `start()` calls it implicitly. | P1, P2, P3 in §5: no dequeue while paused; `start()` refuses while paused with a frozen message; a cancel issued while paused suspends the queue. Per-entry cancel is a separate channel that never touches the bridge. |
| **Queued work runs against a browser state the user has since changed**, and takes whichever tab they are reading. `handle`'s `start` case binds `chrome.tabs.query({ active: true, lastFocusedWindow: true })` at dequeue. | Partially mitigated, and worth saying so plainly. There is **no schema rule requiring a first `navigate` step** — `assertRoutineDefinition` in [routines.ts](../../src/shared/routines.ts) only requires a non-empty `steps` array, and a chat-saved routine may start with `click` because `toActionStep` will emit one. Even a leading `navigate` does not help: it retargets the tab the user is currently reading. This PRD creates the click-free start that makes the hazard reachable, so it carries the pre-start notice in §5 and Story 5. A dedicated tab is the real fix and is out of scope. |
| **The user loses track of what the app is about to do.** | Queue is visible by default, not hidden behind a menu. This is a browser acting on the user's real logged-in session; opacity is not acceptable. |
| **PRD 13 cannot express a debug lease in the entry shape.** | The `work` union in §5 declares the `lease` variant now, with no producer here. Declared early because README.md makes 05 block 13. |

---

## 10. Open Questions

- 🔵 What is a realistic queue depth? No data. 50 is a guess that only PRD 07 usage
  will correct, and §6 records that the depth-distribution metric has no durable store until
  PRD 01 adds one.
- 🔵 Should a held run time out and release the queue? Depends on how often holds
  happen unattended — measurable after PRD 01 and PRD 07. PRD 07 owns bounding the hold.
- 🔵 Should a queued chat goal be cancellable-and-editable rather than just cancellable? Its
  steps are decided from the live page at dequeue, so a chat goal queued for ten minutes is
  answering a question about a page that has moved on.
- 🔵 Does manual reorder earn its keep, given interactive priority plus cancel-and-re-issue?
  Cut from §5 for now; a real request would need a rule for how a hand-placed position
  survives an interactive insertion.
- 🔵 Should `queue:changed` be folded into the existing dual-purpose `automation:status`
  channel? Cheaper by four channel registrations if the rail only ever needs a count.
- 🔶 **Assumption:** users want manual runs to pre-empt scheduled ones. Plausible,
  unvalidated; the alternative is strict FIFO, which is simpler.
- 🔶 **Assumption:** a 5-minute extension-connect timeout is right. Arbitrary.
- 🔶 **Assumption:** a 10-second pre-start notice is enough warning before a background entry
  takes the active tab. Arbitrary, and the only thing standing between a scheduled run and
  the tab the Operator is typing in.

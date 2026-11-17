# PRD 07 — Schedules & triggers

| | |
|---|---|
| **Phase** | Unattended |
| **Depends on** | PRD 01 (readable runs), PRD 05 (queue). PRD 03 and PRD 06 strongly assumed, not blockers |
| **Blocks** | PRD 09 — it needs the run volume only unattended schedules produce |
| **Status** | Draft |
| **Author** | hmukhtar@outsentia.com |

Shared personas and strategic context: [README.md](README.md). The dependency table there
is the one authority; this header must not contradict it.

---

## 1. Executive Summary

We're building **schedules and triggers** — recurring, unattended execution of saved
routines — for **the Operator** to solve the problem that every automation requires
a human to press a button, which will remove the person from the loop entirely and
convert the product from a tool that runs automations into one that runs them *for*
you.

This is the largest single value unlock in the set, and the one with the most
prerequisites. It is deliberately seventh.

It also owns two things nothing else does. **An unattended layer-3 hold does not end
today** — [README.md](README.md#how-a-run-ends-today) states it plainly: `waitWhileHeld`
resolves only on resume or cancel, so a run holding at 06:00 parks forever with the
mutex, the target tab and the socket. And **a scheduled run points a model-driven agent at
a real logged-in browser with nobody watching**, which is a safety surface, not a feature
detail. §5 bounds the first. §7's safety block is a set of shipping gates for the second.

---

## 2. Problem Statement

### Who has this problem?

The Operator, on every single run, forever.

### What is the problem?

There is no trigger but a click. `IpcChannels.automationRun` is invoked from exactly one
place: `startRoutine` in
[useRuns.ts](../../src/renderer/src/state/useRuns.ts), reached only from the Run button in
`AutomationRow` in
[AutomationRail.tsx](../../src/renderer/src/components/AutomationRail.tsx). There is
no timer, no cron, no watcher and no external trigger anywhere in `src/`, and
[package.json](../../package.json) carries no scheduling or timezone dependency.

A routine is therefore a saved set of keystrokes, not an automation. The recurring
work it exists for — the daily invoice pull, the weekly price check, the morning
report — still depends on a person remembering, at the right hour, in front of the
right machine.

### Why is it painful?

- **User impact.** The value of an automation is proportional to how often it runs
  and inversely proportional to how much attention each run costs. A click-triggered
  routine caps both. 🔶 **Assumption:** the routines users actually save are recurring
  ones. **This has no supporting evidence in the tree.** An earlier draft cited
  [updates/web-health-check.json](../../updates/web-health-check.json) and
  [updates/search-and-capture.json](../../updates/search-and-capture.json); both are
  developer-authored *system* demos with `sys.` ids, shipped as the read-only source of
  truth, carrying no recurrence field and no user. They are evidence of what we built, not
  of what anyone wants. The assumption stands untested until PRD 01 emits run data.
- **Business impact.** The entire healing architecture — four layers, a repair
  budget, an LLM that re-plans against a drifted page — is built for a run nobody is
  watching. Without scheduling, that engineering is insurance on a risk the product
  never takes.

### Evidence

- **Code.** No scheduler exists. Verified: no timer, no cron library, and — see §5's
  presence section — no `Tray`, `setLoginItemSettings`, `powerMonitor` or `powerSaveBlocker`
  either, so there is not even a process that reliably survives a window close.
- **Architectural intent.** *"A routine run is the one that may be unattended and
  replaying assumptions recorded weeks ago, so it is the one that gets the repair
  call and the hold"* ([HOW-IT-WORKS.md](../../HOW-IT-WORKS.md) §6). The system was
  designed for a mode it cannot currently enter.
- 🔵 **Open Question:** which routines would users schedule, and how often? Unknown.
  Shapes whether hourly matters or daily is enough.

---

## 3. Target Users & Personas

**Primary: The Operator** — wants the outcome to appear without being the trigger.

**Secondary: The Author.** 🔶 **Assumption:** a routine that runs daily unattended is held
to a higher standard than one run under supervision, and that changes how they author —
more `wait` steps, more `assert` steps (PRD 06), fewer selectors that only work on the page
they happened to be on. Unvalidated; it is a prediction about behaviour, and PRD 09's
per-routine health is the first thing that could test it.

**Job-to-be-done:** *When I have ten routines, I want them to run on a schedule, so
I can stop being the trigger.*

---

## 4. Strategic Context

**Ladders up to:** the outcome directly. This *is* unattended operation.

**Why now — and why not sooner.** Scheduling is the highest-value feature in the
set and is nonetheless seventh, because shipping it earlier would ship four known
defects at machine speed:

| Without | A scheduled run would… |
|---|---|
| **PRD 01** | leave no evidence. Unreadable unattended runs are worse than none — they produce actions nobody can audit |
| **PRD 05** | throw `OrchestratorBusyError` into a caller with no retry path, dropping one of any two runs that overlap, every occurrence |
| **PRD 03** | write a model's repair into the user's saved routine irreversibly, on a timer, with nobody present to notice |
| **PRD 06** | report success daily while achieving nothing |

Each of those is tolerable when a human is watching and unacceptable when one is
not. The ordering is not caution; it is the difference between a feature and a
liability.

**What PRD 03 does and does not fix.** PRD 03 §5's core decision is explicit: *"Repairs
continue to execute during the run. Only the write-back becomes a proposal."* So 03 removes
the irreversible **persistence** and leaves the up-to-`MAX_REPAIRS_PER_RUN` (6)
model-chosen actions executing live against the logged-in page, unreviewed, on the timer
this PRD adds. That residual is this PRD's problem, not 03's, and §7's **S4** decides it.
Reading the table above as "03 neutralises the repair risk" is the mistake an earlier draft
of this section invited.

---

## 5. Solution Overview

### The design input everything else follows from: only the active tab can be photographed

> **Factual note, verified 2026-08-27 — this whole section is about the *extension* backend,
> which is no longer the default.** Everything below about `capture`, the active tab and the
> dedicated window is still true of `AUTOMATION_BACKEND=extension`. The default is now
> `PlaywrightSession` in
> [playwright-session.ts](../../src/main/automation/playwright-session.ts), which drives a
> Chrome that [chrome-process.ts](../../src/main/automation/chrome-process.ts) spawns on its
> own `automation-profile` user-data-dir — so there is no "user's active tab" for it to take,
> and it screenshots through `page.screenshot()` with no active-tab precondition anywhere in
> our code. **The tab question therefore has to be decided twice, once per backend, and the
> two have different constraints.** Neither decision is taken here; see §10.

`capture` in [background.js](../../extension/background.js) reads
`chrome.tabs.get(tabId)` and **throws** unless `tab.active`, because
`chrome.tabs.captureVisibleTab` takes a `windowId` and would otherwise photograph a
different page. It is the **only** screenshot path on the extension backend, reached from
both the `screenshot` step branch of `runStep` and — via `captureOrReason` — from `snapshot`,
which is what feeds every model call. Both routines in [updates/](../../updates/) end in a
`screenshot` step.

This refutes the mitigation earlier drafts of this PRD offered. **A dedicated *background*
tab can never screenshot**, so it cannot run either shipped routine and cannot supply a
model snapshot for a layer-2 repair. AI_CONTEXT.md §9 records the same trap.

The decision space is therefore three options, not "open":

| Option | Verdict |
|---|---|
| A dedicated **window**, with the automated tab active *in that window* | **Chosen**, with a spike gate |
| Defer while the user is active | **Chosen**, as a requirement in its own right — not an alternative |
| Declare `screenshot` steps focus-requiring and skip them unattended | **Rejected** |

**Option 3 is rejected** because it silently deletes the evidence PRD 01 exists to create. A
scheduled `sys.web-health-check` is `navigate` → `wait` → `screenshot`; skipping the
screenshot leaves a run that reports `done` and produced nothing. It also does not help the
repair path, which needs a snapshot rather than a `screenshot` step.

**Requirement — the dedicated automation window, on the extension backend.** `handle`'s
`start` case in `background.js` currently binds `targetTabId` from
`chrome.tabs.query({ active: true, lastFocusedWindow: true })`. It gains a `target` field on
the `start` message; for `target: 'dedicated'` it calls `chrome.windows.create`, uses that
window's active tab as `targetTabId`, and records the created `windowId` so the window is
closed when the run ends. No new manifest permission is needed —
[manifest.json](../../extension/manifest.json) already carries `<all_urls>` host permissions,
which is what `captureVisibleTab` requires, and `chrome.windows.create` needs none. The
change touches:

1. `handle`'s `start` case and the `stop` control branch in
   [background.js](../../extension/background.js) — plus `chrome.windows.onRemoved`, to
   mirror the existing `chrome.tabs.onRemoved` target-closed path;
2. `ExtensionBridge.start` in
   [extension-bridge.ts](../../src/main/automation/extension-bridge.ts), which sends the
   `start` message;
3. `ExtensionSession.connect` in
   [extension-session.ts](../../src/main/automation/extension-session.ts), and therefore
   `AutomationSession.connect` in [session.ts](../../src/main/automation/session.ts) and its
   Playwright twin `PlaywrightSession.connect` in
   [playwright-session.ts](../../src/main/automation/playwright-session.ts) — AI_CONTEXT.md
   §10's step-kind recipe applies for the same reason: a signature widened in one backend and
   not the other compiles and diverges;
4. `EXTENSION_VERSION` in `extension-bridge.ts` **and** `version` in
   `extension/manifest.json`, bumped together — AI_CONTEXT.md §8 makes the handshake refuse a
   mismatch and a test asserts they agree. Both read `1.10.0` today (verified 2026-08-27);
   what matters is that they move together, not the literal number, which several unbuilt
   PRDs each want to claim.

**On the Playwright backend this requirement has no work in it, and that is the point.**
`PlaywrightSession.connect` already adopts or launches a Chrome of its own — one profile, one
process, `about:blank` — and calls `bringToFront()` on its own page inside it. There is no
user tab to take and nothing to create. Whether that browser may appear unbidden at 06:00 is
a different question from the one this section answers, and it is §10's, not this section's.

This supersedes PRD 05's *"starting X in the tab you are on"* notice for scheduled entries on
the extension backend; PRD 05's notice remains correct for the fallback path below, and for
its own interactive work. It never described the Playwright backend, which has never used the
user's tab.

🔵 **Open Question — the spike that gates this.** Does `captureVisibleTab` succeed for a
window that is **not** the foreground OS window: occluded, behind the user's own window,
minimized? Chrome's contract is "the visible tab of the given window", and a minimized window
plausibly has none. This must be answered by a one-day spike **before** implementation, not
during, because the answer changes the shape of the feature:

- **If it succeeds while unfocused:** the dedicated window runs beside the user's work and
  deferral becomes a courtesy rather than a necessity.
- **If it needs OS focus:** the dedicated window steals focus for the duration of the run,
  and deferral becomes the only thing making that acceptable.
- **If it fails for a minimized window in either case:** the scheduler must not minimize it,
  and a user who minimizes it mid-run gets the same `capture` error an attended run gets
  today — which is the likeliest real-world step failure in the product.

**The spike now has a second half, for the default backend.** `PlaywrightSession.snapshot`
and its `screenshot` step both call `page.screenshot()`, which carries no active-tab check of
ours; the only failure it can report is Playwright's own, bounded by `SCREENSHOT_TIMEOUT_MS`.
Whether a headed Chrome will serve that capture for a page that is occluded or in a minimized
window is the *same* empirical question, asked of a different API, and it has not been
answered either. Spike both, or the feature is gated on one backend and guessed at on the
other.

**Fallback.** On the extension backend, where the dedicated window cannot be created, the run
uses the active tab exactly as today, behind PRD 05's pre-start notice. It does not silently
fail. The Playwright backend has no fallback path because it has nothing to fall back from.

### Deferral while the user is active — a requirement, not an open question

Promoted out of §10. A schedule due while the user is at the machine does not fire.

- **The signal.** `powerMonitor.getSystemIdleTime()` in main, which returns idle seconds.
  There is no such signal in `src/` today — `powerMonitor` appears nowhere — so this is new
  code in the scheduler, not a wiring change.
- **The rule.** If idle time is below `ACTIVITY_QUIET_SECONDS` (🔶 **Assumption:** 300; no
  basis), the occurrence is **deferred** by `DEFERRAL_INTERVAL_MS` (🔶 **Assumption:** 5
  minutes) and retried, up to `MAX_DEFERRALS` (🔶 **Assumption:** 3). At the cap it is
  **skipped**.
- **Every deferral is recorded.** One `schedule_occurrences` row per deferral with
  `outcome = 'deferred'`, reason `user active`; the give-up writes one with
  `outcome = 'skipped'`, reason `user active after 3 deferrals`. A deferral the user cannot
  see is indistinguishable from a scheduler that does not work — which is the failure mode
  the recorded-deferral requirement exists to prevent.
- **Deferral does not apply to catch-up.** A missed occurrence being caught up at boot is
  already being run at a time the user did not choose; running it while they are actively
  typing is the specific thing catch-up is opt-in for.

### Data — the migration

Three creates and three `ALTER TABLE`s, appended as one new entry to the `MIGRATIONS` array
in [database.ts](../../src/main/db/database.ts). AI_CONTEXT.md §10: **append, never edit a
shipped entry** — `PRAGMA user_version` is the cursor and `MIGRATIONS` is zero-indexed, so
the ordinal and the index differ by one and a bare ordinal is ambiguous. This PRD's entry is
**the next unused `MIGRATIONS` entry**; the concrete index depends on build order, because
PRDs 01–06 land first and each may append one. Both existing tables are `STRICT` and the new
ones must be too.

**`schedules`**

| Column | Type | Why |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | |
| `routine_id` | `TEXT NOT NULL` | |
| `routine_kind` | `TEXT NOT NULL CHECK (routine_kind IN ('system','user'))` | **Mandatory.** A routine is addressed as `{kind, id}` — `assertRunRoutineInput` in [ipc.ts](../../src/main/ipc.ts) requires both, and the `automationRun` handler picks the store from `kind`. `routine_id` alone is not a key: `sys.` ids live in `system_routines`, user ids in `user_routines` |
| `cron` | `TEXT NOT NULL` | five-field expression |
| `timezone` | `TEXT NOT NULL` | IANA name, never an offset |
| `params` | `TEXT NOT NULL DEFAULT '{}'` | JSON, validated at the store boundary |
| `state` | `TEXT NOT NULL CHECK (state IN ('enabled','disabled','auto_disabled'))` | `auto_disabled` is distinct so the UI can say *why* and PRD 08 can notify on it — its event table already lists that case |
| `catch_up` | `INTEGER NOT NULL DEFAULT 0` | Story 3 is untestable without it |
| `max_runs_per_day` | `INTEGER` | null = uncapped. §7 **S2** |
| `dry_run` | `INTEGER NOT NULL DEFAULT 0` | §7 **S1** |
| `commit_ack_at` | `INTEGER` | null = the routine's committing steps have not been acknowledged, so the schedule may not fire. §7 **S3**. A timestamp rather than a boolean, because *when someone agreed* is the auditable fact |
| `consecutive_failures` | `INTEGER NOT NULL DEFAULT 0` | drives auto-disable; reset on any terminal `done`/`assisted` |
| `next_due_at` | `INTEGER` | a **cache**, recomputed on every boot and after any edit. Never trusted across a restart: the zone's rules or the platform's tzdata may have changed while the app was closed |
| `created_at`, `updated_at` | `INTEGER NOT NULL` | |

**No foreign key to either routine table**, and the reason is not symmetry:
`SystemRoutineStore.syncFromDir` deletes every `system_routines` row and re-inserts inside
one transaction on each sync — and `foreign_keys = ON` is set in `openDatabase` — so an FK
would either cascade every schedule away on a file save or make the sync fail from inside an
`fs.watch` callback, where AI_CONTEXT.md §9 notes an escaping throw is an uncaught exception.
Adding one to `user_routines` and not the other would make the two kinds behave differently
on delete, which is worse than neither. Instead the scheduler's reconciliation pass resolves
`{routine_kind, routine_id}` at boot and at fire time and, on a miss, sets
`state = 'auto_disabled'` and records a skipped occurrence with reason `routine deleted` —
which is what "disabled and flagged, not silently dropped" actually requires.

**Last outcome is derived, not stored.** No `last_run_id` / `last_outcome` columns: the newest
`schedule_occurrences` row for a schedule already carries both, and a denormalised copy is a
second source of truth for the same fact that PRD 01's retention can prune out from under.

**`schedule_occurrences`** — one row per fire decision. This table is not optional: two of
§6's metrics and all of Story 3 need per-occurrence rows, and **a fire that never reaches the
queue never mints a `runId`**, so there is no `runs` row to record it on.

| Column | Type | Why |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY` | |
| `schedule_id` | `TEXT NOT NULL` | no FK — see below |
| `due_at` | `INTEGER NOT NULL` | the scheduled instant, UTC ms |
| `outcome` | `TEXT NOT NULL CHECK (outcome IN ('enqueued','skipped','deferred'))` | three values, each with one owner — see the vocabulary note |
| `reason` | `TEXT` | null when `enqueued`; required otherwise, from a closed set |
| `run_id` | `TEXT` | set only for `enqueued`, and only once PRD 05 dequeues it and PRD 01 opens the row |
| `recorded_at` | `INTEGER NOT NULL` | |

```sql
CREATE UNIQUE INDEX idx_occurrence_fired
  ON schedule_occurrences (schedule_id, due_at) WHERE outcome = 'enqueued';
```

The partial unique index is what makes "fires once" a constraint rather than a hope — the
DST spring-forward case, the catch-up coalescing rule, and a boot race between the
reconciliation pass and the first tick all resolve to the same insert, and the second one
fails. Deferrals are deliberately outside it, so a `due_at` may carry several `deferred` rows
and at most one `enqueued`.

**No foreign keys on `schedule_id` or `run_id`.** `ON DELETE CASCADE` from `schedules` would
delete the occurrence history that §6's skipped-occurrence metric is computed from, and an FK
to `runs` would break the moment PRD 01's retention prunes an old run. The read path renders
a missing run as *"this run is no longer retained"* rather than a dangling link.

**Three `ALTER TABLE runs` additions**, in the same migration entry, **after** the creates —
`ALTER TABLE … ADD COLUMN` with a `CHECK` is legal on a `STRICT` table, and a `REFERENCES`
column would require a default of `NULL`, which is one more reason not to add one:

```sql
ALTER TABLE runs ADD COLUMN started_by TEXT NOT NULL DEFAULT 'manual'
  CHECK (started_by IN ('manual','schedule','rerun'));
ALTER TABLE runs ADD COLUMN schedule_id TEXT;
ALTER TABLE runs ADD COLUMN dry_run INTEGER NOT NULL DEFAULT 0;
```

`schedule_id` takes no FK for a second reason beyond retention: `ON DELETE SET NULL` would
retroactively erase the fact that a deleted schedule's runs were unattended, which corrupts
§6's primary metric backwards through history.

**`scheduler_state`** — a one-row table, `id INTEGER PRIMARY KEY CHECK (id = 1)` plus
`paused_all INTEGER NOT NULL DEFAULT 0`. Story 5's *pause-all* must be reversible "without
re-entering anything", so it must not rewrite N schedule rows; and it must be distinguishable
from `disabled`, so it cannot be expressed in `schedules.state`.

### The `source` vocabulary, reconciled

Three documents used three words for overlapping things. The resolution:

| Concept | Where it lives | Values |
|---|---|---|
| What kind of run this is | `runs.source` — **PRD 01's**, untouched here | `routine`, `chat` |
| What started it | `runs.started_by` — **new, this PRD** | `manual`, `schedule`, `rerun` |
| Queue priority, not persisted | PRD 05's entry `priority` | `interactive`, `background` |
| Which user routine's provenance | `user_routines.source`, shipped in migration 1 | `chat`, `import` |

`started_by`, not `trigger`: `TRIGGER` is a SQLite keyword and would need quoting at every
use site. `rerun` is declared here although **PRD 04** produces it, because a `CHECK`
constraint cannot be widened by `ALTER TABLE` — adding a value later means a full
rename-copy-drop rebuild, and `applyMigrations` wraps each entry in `db.transaction()`, where
`PRAGMA foreign_keys` cannot be changed at all and `PRAGMA defer_foreign_keys = ON` is the
only lever available. Declaring the third value now costs one word and saves that.

For the same reason this PRD **requires that PRD 01 leave `runs.status` as unconstrained
`TEXT`, validated in TypeScript**, because 07 adds a terminal value to it (`abandoned`, below).
If PRD 01 ships a `CHECK` on `status`, 07 inherits the rebuild.

### Cron and time

No scheduling or timezone library exists in [package.json](../../package.json), and adding one
does not remove the hard part: converting a wall-clock field set plus an IANA zone into a UTC
instant across DST transitions.

**Requirement — a hand-rolled evaluator**, `nextFireAfter(cron, timezone, afterUtcMs)` in a
new `src/main/schedule/cron.ts`, pure and dependency-free. Pure is the point: `npm test` is
vitest over `tests/**` with no Electron and no browser, so a dependency-free evaluator keeps
the DST tests in `npm test` rather than in `npm run test:db`.

The algorithm, so it is not rediscovered: walk candidate wall-clock minutes forward from
`afterUtcMs`; for each, use `Intl.DateTimeFormat` with `timeZone` to find the UTC instant, and
**reject a candidate whose round-trip does not reproduce the wall time asked for** — that is
the spring-forward gap — **or whose instant is not strictly greater than `afterUtcMs`** — that
is the fall-back repeated hour. Both DST rules fall out of one check rather than two special
cases.

- 🔶 **Assumption:** a five-field subset — minute, hour, day-of-month, month, day-of-week,
  with `*`, `,`, `-` and `*/n` — covers everything the plain-language builder needs. No
  seconds field; sub-minute scheduling is out of scope.
- **Test requirement:** `tests/cron.test.ts` against fixed zones (`Europe/London`,
  `America/New_York`) across both 2026 transitions, asserting a 02:30 daily schedule fires
  exactly once on each. §7's constraints already demanded this test; this names where it lives.

The plain-language builder (*daily at 6:00*, *every weekday at 09:30*, *every 4 hours*) writes
the cron string, so the Operator never types one. It is a one-way builder — editing the cron
by hand is allowed and does not have to round-trip into the builder's vocabulary.

### The scheduler, and the process it needs to survive in

**A single `setTimeout` is not the mechanism**, and both reasons are verifiable rather than
theoretical. Node clamps a timer delay to a 32-bit signed integer: `setTimeout(fn, 2**31)`
emits `TimeoutOverflowWarning` and sets the duration to **1 ms**, so a schedule more than
~24.8 days out fires immediately. And a timer does not advance across system suspend, so a
laptop asleep through 06:00 wakes with a stale timer and an unfired schedule.

**Requirement — a tick plus power events.** `setInterval` at `SCHEDULER_TICK_MS`
(🔶 **Assumption:** 30 s), each tick recomputing which schedules are due by comparing
`next_due_at` to `Date.now()`; plus a re-arm and reconciliation pass on `powerMonitor`'s
`resume` and `unlock-screen`. Sub-minute granularity is out of scope, so a 30 s tick is
sufficient and is immune to both defects by construction.

New files, and where they wire in:

| File | Contents |
|---|---|
| `src/main/schedule/cron.ts` | `nextFireAfter`, the expression parser — pure |
| `src/main/schedule/scheduler.ts` | the tick, the fire predicate, the reconciliation pass |
| `src/main/db/schedules.ts` | `ScheduleStore` and `OccurrenceStore` |
| `src/main/tray.ts` | see presence, below |

`ScheduleStore.save` takes `unknown`, matching `UserRoutineStore.save` — AI_CONTEXT.md §8
makes the store the validation boundary, and a schedule payload arrives straight off IPC. The
scheduler is constructed inside the `app.whenReady()` block in
[index.ts](../../src/main/index.ts) beside `system.watch(...)`, and stopped in the existing
`before-quit` handler alongside `stopWatching()` and `bridge.close()`.

On fire it calls `RunQueue.enqueue` with `priority: 'background'` and
`dedupeKey: <schedule id>` — PRD 05 §5 owns the staleness rule and supersedes the older
waiting entry in place. The scheduler owns time; the queue owns serialisation. It never calls
the orchestrator directly.

### Presence — explicitly in scope

An earlier draft left this neither in nor out, while §6's primary metric silently assumed all
of it. The current state, verified: **no `Tray`, no `app.setLoginItemSettings`, no
`powerMonitor`, no `powerSaveBlocker` anywhere in `src/`**, and `window-all-closed` in
[index.ts](../../src/main/index.ts) calls `app.quit()` on every platform but darwin — so on
Windows and Linux, closing the window kills the scheduler outright. `requestSingleInstanceLock`
is already in place, so none of this can produce a second scheduler.

**In scope:**

- **Tray.** `src/main/tray.ts`: an icon, next fire time, pause-all, open, quit.
- **`window-all-closed` must stop quitting** while at least one schedule is `enabled`. The
  window closes to the tray; Quit becomes an explicit tray action. This is a two-line change
  to a handler that currently has one behaviour, and it is the difference between a scheduler
  and a screensaver.
- **Launch at login.** `app.setLoginItemSettings({ openAtLogin })` behind a visible setting,
  **default off**. 🔶 **Assumption:** opting a browser-driving app into launch-at-login
  without asking is not acceptable; the schedules view offers it when the first schedule is
  created, which is the moment it becomes meaningful.
- **Power events.** `powerMonitor.on('resume')` and `('unlock-screen')` re-arm the tick and
  run the reconciliation pass; `getSystemIdleTime()` is the deferral signal.

**Out of scope, and stated rather than left unsaid:** `powerSaveBlocker`. Keeping a machine
awake to drive a browser is a larger consent question than this PRD should answer, and
"waking a sleeping machine" is already out of scope.

### Preconditions — and what the extension can actually recover from

**Correcting a claim earlier drafts got wrong.** The extension *does* keep its native port
alive. [background.js](../../extension/background.js) creates
`chrome.alarms.create('host-keepalive', { periodInMinutes: 0.5 })` and reconnects on
`chrome.runtime.onStartup` and `onInstalled` — which is the only reason the `alarms`
permission is in the manifest — because MV3 kills an idle service worker after ~30 s and
takes the port with it. So a dropped connection normally heals itself within ~30 s of Chrome
being open, and PRD 05's *queue-and-wait-then-expire* is not a permanent skip in the normal
case.

What it cannot recover from is **Chrome not running at all**. The app is the socket *server*
(`ExtensionBridge` listens on `BRIDGE_ENDPOINT`); only the extension opens the port, through
`native-host/relay.js`, which **Chrome spawns as its own child** and which exits on
`process.stdin` `end` when Chrome closes it. The app cannot dial out. No Chrome, no relay, no
socket, and nothing the scheduler can do about it.

**On the default backend this precondition inverts.** `PlaywrightSession.connect` calls
`ChromeProcess.adopt` and, on a miss, `ChromeProcess.launch` — the app *starts* Chrome rather
than waiting for it, so "Chrome not running" is not a blocker there but a decision: a
schedule firing at 06:00 makes a browser window appear. That belongs to the presence question
in §10, not here. What can still stop a Playwright run is Chrome refusing to start —
`launch()` throws when no executable is found (`AUTOMATION_CHROME_PATH` unset and no Chrome
installed) or when another process already holds the automation profile — and those are
errors on a started run, not skipped occurrences, so the rule below is unchanged.

Therefore:

- **A disconnected bridge is not a reason to skip.** The occurrence is recorded `enqueued`
  and PRD 05's timeout decides. This is the reconciliation of a real conflict: PRD 05 Story 4
  calls that outcome an entry that *"ends with the reason 'the extension never connected'"* and
  *"appears in the run history as a failed run"*. **07 does not call it a skipped
  occurrence.** `skipped` is reserved for occurrences that never reached the queue.
- **A run in progress is not a reason to skip.** The queue handles it.
- **The user being at the keyboard *is* a reason to defer**, per the rule above.

### Missed occurrences, and the coalescing rule

The app will not always be running.

- **On boot, do not fire missed schedules by default.** 🔶 **Assumption:** firing a batch of
  overnight routines the moment the laptop opens is surprising and possibly harmful — the
  browser is right there, the user is mid-task, and several committing routines could fire at
  once. `catch_up` is per-schedule and defaults to `0`.
- **Every missed occurrence is recorded**, one `schedule_occurrences` row with
  `outcome = 'skipped'` and reason `app not running`, minted by the boot reconciliation pass.
- **With `catch_up = 1`, exactly one run.** The rule, which an earlier draft left undefined:
  the reconciliation pass fires **the most recent missed occurrence only**; every older missed
  occurrence in the same gap gets a `skipped` row with reason
  `coalesced into the <due_at> occurrence`. So the gap is fully accounted for in the
  occurrence log while the browser is driven once. The partial unique index makes a
  double-fire a constraint violation rather than a policy anyone has to remember.
- A background entry still waiting when its next occurrence arrives is superseded in place by
  PRD 05's `dedupeKey` rule, using the schedule id as the key.

### Bounding an unattended hold

This is the section the PRD exists for, and it has to name both hold sources because they
behave oppositely.

**A scan hold already bounds itself on both backends, and this PRD changes nothing about it.**
`scanSensitive` in [page-core.js](../../extension/page-core.js) — the one in-page engine both
backends inject — sees a password, payment or one-time-code field; the step never executed;
`dispatch` waits on `waitWhileHeld` and retries the same step up to `MAX_HELD_RETRIES` (3);
at the cap it throws a plain `Error`, which `isHealable` rejects, so the run ends
`status: 'error'` after roughly four step timeouts. Both `ExtensionSession.dispatch` and
`PlaywrightSession.dispatch` implement that loop, with their own `MAX_HELD_RETRIES` constant
and their own wording for the throw.
Earlier drafts described this as "the routine simply ends held" — it does not; there is no
`held` terminal status, and the Operator learns from an `error` run with the scan's own reason.
With the credential vault cut from the plan, that is the accepted outcome for a login-gated
routine.

**A layer-3 hold has no bound at all, on either backend.** `runWithRepair` raises
`NeedsHumanError`; `runRoutine`'s catch calls the session's `holdForHuman`, which is a pause
followed by a wait on `waitWhileHeld`. `ExtensionSession.holdForHuman` delegates both to
`ExtensionBridge`, whose `waitWhileHeld` resolves only in `release()` — reached from
`resume()` and from a `resumed` message — and rejects only in `cancel()`.
`PlaywrightSession.holdForHuman` keeps the identical shape on its own waiter list, resolved
in `resume()` and rejected in `cancel()`. Nothing else in the codebase can end either one.
Unattended the run parks forever, holding PRD 05's slot and the browser it was driving.

**Requirement — `cancel()` is the abandonment mechanism.** A per-run timer of
`UNATTENDED_HOLD_LIMIT_MS` (🔶 **Assumption:** 15 minutes; the existing open question,
promoted to a default) is armed when a run with `started_by = 'schedule'` enters
`holdForHuman`, and cleared on resume. On expiry the scheduler calls `cancel()` on the
`SessionControl` in [session-control.ts](../../src/main/automation/session-control.ts) — the
same call the `automationCancel` handler in [ipc.ts](../../src/main/ipc.ts) already makes,
and the interface both `ExtensionBridge` and `PlaywrightSession` implement, so one timer
reaches both backends.
This is deliberately not a new mechanism: AI_CONTEXT.md §8 requires that *any path which can
park a run be reachable by `cancel()`*, and the fix is to reach the existing path on a timer
rather than to invent a second one.

**Requirement — a distinct terminal status.** `cancel()` raises `RunCancelledError`, and PRD
01 classifies cancellation by error identity, so an abandoned run would otherwise report
`cancelled` — conflating *the user stopped it* with *nobody ever came*, which are different
facts and the second is the one §6 measures. The abandonment path sets a run-scoped flag
before calling `cancel()`, and `runRoutine`'s catch maps `RunCancelledError` + flag to the new
terminal status **`abandoned`**, appended to the `status` union in
[types.ts](../../src/shared/types.ts). One new status value; **no new error class** — a new
class would have to travel through `failAllPending` and the waiter loop and would change
`cancel()`'s contract for the user's own Cancel button too.

The literal string `held-and-abandoned` from earlier drafts is gone. `held` is a live state
PRD 01 owns; `abandoned` is a terminal status; a compound of the two reaching into PRD 01's
schema was this PRD specifying another PRD's column values.

**Requirement — the residual page state, which today is silently the worst option.**
**Both backends have this defect, by different routes.** On the extension, `cancel()` sends
`stop`; `background.js`'s control branch for `stop` calls `markAbandoned(inFlightStepId)` and
then `setState({ state: 'idle', targetTabId: null, reason: null })`; `setState` broadcasts
`AGENT_STATE` to every tab, and the target tab receives `state: 'idle'`. On Playwright,
`cancel()` clears `paused` and calls `pushState`, and the following `disconnect()` sets
`ending`, at which point `stateFor` returns `idle` for every page. Either way the banner
**is removed**, so abandonment as it would work today leaves a half-filled form on a real
logged-in page with nothing on screen saying an automation touched it.

- The abandonment path must leave the page **visibly marked**, not silently reverted: a
  terminal *abandoned* banner state, user dismissible. The banner itself is `buildBanner` in
  [page-core.js](../../extension/page-core.js), which both backends already drive — the
  extension through `AGENT_STATE`, Playwright through `callHooks(frame, 'render', …)` — so
  one new state reaches both, and the `BannerState` union in `playwright-session.ts` widens
  with it.
- Delivering it is per-backend. On the extension it is a new control message added to
  `CONTROL_TYPES` in `background.js` so it bypasses the serialization lock like the other four
  — AI_CONTEXT.md §8 — because the in-flight step may hold that lock for its whole timeout,
  which is exactly the situation abandonment occurs in; that touches `background.js`,
  `content.js`'s `chrome.runtime.onMessage` listener, `ExtensionBridge`, and the paired
  `EXTENSION_VERSION` / manifest bump. On Playwright it is a `stateFor` case and no protocol
  change, because `callHooks` dispatches by method name. **Shipping only the extension half
  leaves the default backend with the defect this requirement exists to fix.**
- **07 does not undo the partial work.** An automatic rollback of a half-filled form is a
  page-mutating action taken with nobody present, which is the class of thing this PRD is
  trying not to do. The banner and PRD 01's thread are the mitigation; the Operator decides.
- On the extension backend the dedicated automation window is closed on abandonment; on the
  fallback path the user's tab is left open, with the banner. On the Playwright backend
  `disconnect()` already closes the browser it launched, so the equivalent question is
  whether an abandoned run should leave that window open long enough for the banner to be
  read — which the presence decision in §10 also touches.
- **Auto-disable.** An abandoned run increments `consecutive_failures`; at
  `AUTO_DISABLE_AFTER` (🔶 **Assumption:** 3) the schedule moves to `auto_disabled`. This is
  the only thing bounding a routine that holds every single morning.

### Guard rails on unattended execution

Two constraints of principle; the concrete safety gates are §7's **S1**–**S5**.

1. **Only saved routines may be scheduled — never chat goals.** A chat goal is open-ended,
   model-directed, and re-decides each turn from the live page. That is correct with a human
   present and wrong without one.
2. **Sensitive-field and CAPTCHA holds are not relaxed.** The scan hold behaves exactly as
   described above, including ending the run `error` at the cap.

### Visibility

A schedules view listing every schedule, its state, its next fire time in the user's own
timezone, its last outcome derived from the newest occurrence, and a link to that run's
thread — rendering *"no longer retained"* where PRD 01's retention has pruned it. Per-schedule
enable/disable, and a global pause-all backed by `scheduler_state.paused_all`, which is the
control a user reaches for when they need their browser to themselves.

Two things are requirements and two are design details, and earlier drafts mixed them:

- **Requirement:** the Operator can verify what a schedule will do before trusting it — at
  minimum the next fire time, in their zone. 🔶 **Assumption:** a schedule whose
  interpretation cannot be checked will not be trusted, and cron-versus-timezone is where
  interpretation goes wrong. Unvalidated, but it is why the field is not just a cron string.
- **Requirement:** pause-all is visibly distinct from disabled and restores without re-entry.
- **Design detail, not specified here:** how many upcoming fire times to show, and whether
  pause shows as a chip or otherwise.

---

## 6. Success Metrics

Every metric names its instrument or says plainly that it cannot be measured and gives the
proxy we accept instead. Nothing in the product emits telemetry today; PRD 01 creates the
substrate and this PRD adds the discriminator.

### Primary

**Unattended run share** — the share of runs a schedule started rather than a click.

- **Instrument:** `runs.started_by = 'schedule'` ÷ all `runs` rows at a terminal status,
  over a window. The discriminator is the point: PRD 01's table records `source`
  (`routine`/`chat`) and `routine_id`, and **nothing in it distinguishes a click from a
  timer** — a scheduled run and a manual run of the same routine are identical rows. The
  `started_by` column added by §5's migration is the instrument, and it did not exist in any
  earlier draft of this metric.
- **Baseline: 0%, and this is a code fact rather than a measurement** — there is exactly one
  caller of `IpcChannels.automationRun`, `startRoutine` in `useRuns.ts`.
- **Target:** 🔶 **Assumption:** 50% within eight weeks of availability. A guess with no
  basis; the honest target is set from the first month of `started_by` data.

### Secondary

- **Scheduled vs manual success rate.** `done ÷ (done + assisted + error + abandoned)`,
  grouped by `started_by`, restricted to `(routine_kind, routine_id)` pairs that have both. A
  large gap means unattended runs hit conditions attended ones do not, which is the most
  important diagnostic this feature produces. Instrument: PRD 01's `status` plus this PRD's
  `started_by` and `abandoned`.
- **Hold rate on scheduled runs.** Share of scheduled runs with `human_steps > 0` or terminal
  `abandoned`. Instrument: PRD 01's `human_steps` column — this metric is only countable
  because PRD 01 adds it; against today's schema every such run reports `done`.
- **Skipped-occurrence rate.** `schedule_occurrences` grouped by `outcome` and `reason`.
  **Honest limit:** occurrences during a period the app was closed are minted retrospectively
  by the boot reconciliation pass, so a machine that never boots again records nothing, and
  the metric is only as complete as the next launch. Accepted proxy:
  `enqueued ÷ (enqueued + skipped + deferred)` over occurrences the app actually observed,
  reported beside the raw count of `skipped: app not running` rows as the presence signal.
- **Deferral rate.** `deferred` rows ÷ due occurrences. This is the direct read on whether
  §5's active-tab compromise costs the feature its value: a high deferral rate means schedules
  exist and do not run, which is the failure this PRD would otherwise ship without noticing.

### Guardrails

- **G1 — zero unattended commits the user did not intend.** No scheduled run may perform a
  committing action outside the routine's own recorded steps.
  - **This cannot be measured today, and no code path could detect it.** `isCommitting` in
    [page-core.js](../../extension/page-core.js) is evaluated on the element a step resolved to
    and returned as `output.committing`, and `runWithRepair` in
    [orchestrator.ts](../../src/main/automation/orchestrator.ts) reads it **only when
    `output.changed === false`** — the no-op path. Any action that actually changed the page
    returns before that check, so the most dangerous case is precisely the unobserved one.
  - **Baseline:** none. **Proxy, and the shipping bar:** the count of scheduled runs carrying
    at least one repair (PRD 01's `run_repairs`) whose replacement resolved to an element the
    in-page engine flagged committing. Target: zero, and any non-zero value is a bug report.
  - **The requirement that makes the proxy computable:** `ExtensionSession.runStep` **and**
    `PlaywrightSession.runStep` already return
    `{ changed: result.changed, committing: result.committing, via: result.via }` on every
    non-screenshot path — both read it off the same `page-core.js` `ACTIONS` result — so the
    data reaches main and the orchestrator discards it. `runWithRepair` must record
    `output.committing` on the **success** path too, and PRD 01's `onRepair` callback must
    carry it. That is one change in the orchestrator and none in either session.
- **G2 — never more than one run at a time.** Inherited from PRD 05, whose instrument is
  `OrchestratorBusyError` kept as an invariant assertion. Nothing to add here.
- **G3 — the scheduler must not fire while the user is driving the browser.** No longer
  deferred to §10, where it could not gate anything.
  - **Definition:** zero scheduled runs start while `powerMonitor.getSystemIdleTime()` is
    below `ACTIVITY_QUIET_SECONDS`.
  - **Instrument:** the fire predicate is a pure function of `(now, schedule, idleSeconds,
    pausedAll, occurrence history)` and is asserted in a new `tests/scheduler.test.ts`. In
    production, every skip and deferral it produces writes an occurrence row, so a violation
    is a scheduled run with no corresponding idle check in the same tick. Target: zero,
    enforced by construction and covered by test rather than sampled after the fact — the same
    posture PRD 05 takes for its latency guardrail, and for the same reason: `npm test` is
    pure logic with no Electron.

---

## 7. User Stories & Requirements

### Epic hypothesis

We believe that scheduled execution will make automations run without a person, because every
run today requires a click and — 🔶 **Assumption**, see §2 — the routines users save are
recurring. We will know we are right when scheduled runs outnumber manual ones by
`started_by` and their success rate is within a few points of manual runs of the same
routines.

### Safety requirements — shipping gates

These are gates, not risks. Each one is a thing an unattended run can do today that a human
would have stopped.

**S1 — Dry run.** `schedules.dry_run` runs the routine without acting on the page: every
`click`, `type` and `select` resolves its selector and reports whether it matched, and the
action is not invoked. The resolution primitive already exists — `find(selector)` in
[page-core.js](../../extension/page-core.js) returns `{ count, winningRank }` without
touching the element — but it is **exposed to one backend only**: `PlaywrightSession.frameFor`
calls it through `callHooks`, and `content.js`'s `chrome.runtime.onMessage` listener has no
message for it, so the extension cannot reach it at all. So S1 is: a dry branch on the core's
returned object, returning `{ ok, changed: false, resolved }`; threaded from the schedule
through `runRoutine` and **both** sessions' `runStep`; free on Playwright, because `callHooks`
dispatches by method name, and a new message plus an `EXTENSION_VERSION` / manifest bump on
the extension. `runs.dry_run` marks the resulting thread.

**A dry run is not side-effect-free, and must say so in the UI.** `navigate` still navigates
— later selectors are meaningless otherwise — and `screenshot` still captures. A routine
whose `navigate` URLs themselves mutate state is not made safe by dry run.

**S2 — Max runs per day.** `schedules.max_runs_per_day`, counted as `enqueued` occurrences
whose `due_at` falls in the current day **of the schedule's own timezone**, not the UTC day.
At the cap, record `skipped` with reason `daily cap reached`. This is the bound on a
misconfigured `*/5` expression, and it is cheaper than discovering the cost in PRD 02.

**S3 — A routine containing a committing step may not be scheduled unacknowledged.**
Detection is **static, at schedule-create time**, over the routine's steps — it has to be new
code, because `isCommitting` and `COMMIT_WORDS` live in
[page-core.js](../../extension/page-core.js) and only run in the page against a resolved
element, which main cannot reach on either backend. A shared predicate in `src/shared/`
applies a `COMMIT_WORDS`-equivalent match to `click.selector`, each step's `intent`, and
`type.submit === true`, exported so the store and the view use one definition.

🔶 **Assumption, and an honest limit:** this will both over- and under-fire. In the page,
`isCommitting` tests `accessibleText` of the resolved element; a selector like `#btn-42`
carries no words at all, so static detection is a prompt for a human decision and not a
guarantee. Schedule creation is **refused** until `commit_ack_at` is set by a confirmation
that names the matched steps. The residual — a *repaired* click that commits with no static
warning — is what S4 exists for.

**S4 — May an unattended run heal at all? Yes, with one added gate.** The decision, because
this must not stay a question: forbidding healing unattended would delete the rationale for
the four-layer architecture, which HOW-IT-WORKS.md §6 states exists *for* the unattended run.
So healing stays, and gains a gate that only applies when `started_by = 'schedule'`:

- A repair plan whose replacement actions are **not a single same-kind replacement** for the
  original step is treated as `giveUp`, raising `NeedsHumanError` rather than executing. This
  reuses `applyRepairs`'s existing rule in [routines.ts](../../src/shared/routines.ts) as the
  *execution* gate; today that rule governs only persistence, and only for user routines.
- A replacement whose target the in-page engine flags committing is treated the same way.
  That needs `committing` **before** the action runs, which neither backend can report today
  because `isCommitting` is evaluated inside `ACTIONS.click` / `ACTIONS.type`. The pre-flight
  resolution S1 already builds is the mechanism — one core method, two uses, and because it
  lands in `page-core.js` it gates both backends at once.

**S5 — DOM redaction, as a shipping requirement.** The chain was re-verified on 2026-08-27
and it has **moved in both directions** since this PRD was drafted. It runs, identically, on
both backends:

1. `snapshot` in [background.js](../../extension/background.js) sends `{ type: 'DOM' }` and —
   **unlike `runStep`** — never sends `SCAN`. `PlaywrightSession.snapshot` has the same
   omission: it calls `callHooks(page.mainFrame(), 'dom')` and never `scanHold()`. The
   sensitive-field hold gates a step on both backends and a snapshot on neither.
2. The in-page engine answers from `dom()` in
   [page-core.js](../../extension/page-core.js), which returns
   `cloneWithShadow(document.documentElement).outerHTML`.
3. `filterDom` in [TokenOptimizer.ts](../../src/main/lib/TokenOptimizer.ts) keeps `value` in
   `BASE_KEEP_ATTRS` and has no password or payment rule.
4. `StepHealer.plan` sends the result to `ClaudeAutomationClient.repairStep`, and from there
   to the AI Gateway.

**Worse than drafted at step 2, better at step 2 as well, and unchanged elsewhere.**
`cloneWithShadow` now calls `mirrorLiveState`, which copies the **live** `.value` of every
input and textarea onto the clone — so what reaches the model is no longer only
server-rendered prefill but what the user actually typed. Against that, `mirrorLiveState`
already **removes** `value` for anything matching `SENSITIVE_TARGET` (`input[type="password"]`,
`input[autocomplete^="cc-"]`, `input[autocomplete="one-time-code"]`), so the narrowest form of
the leak this section named is closed, on both backends, by one shared function.

What is still live: `input[type="hidden"]` values, which nothing filters and which are the
common carrier of CSRF and session material; a removed attribute rather than a marker, so the
model cannot tell a filled password field from an empty one; `filterDom` keeping
`autocomplete`, so the model is told which field is the password regardless; the missing
`SCAN` at step 1; and the **unredacted screenshot** `snapshot` returns alongside the DOM, sent
as an image block by `callTool` on both backends. The requirements below are therefore
unchanged in substance, and the first of them is now partly satisfied rather than absent.

Requirements:

- `filterDom` replaces `value` with a `[redacted]` marker — not removal, so the model still
  sees the field is filled — for every element matching the `SENSITIVE_TARGET` selector set
  (`input[type="password"]`, `input[autocomplete^="cc-"]`,
  `input[autocomplete="one-time-code"]`), and for `input[type="hidden"]` (🔶 **Assumption:**
  hidden inputs are the common carrier of CSRF and session tokens and are never useful to a
  repair).
- That selector list lives in **one** place. `SENSITIVE_TARGET` in `page-core.js` is already
  the single copy for both backends; `filterDom` runs in main and cannot import it, so export
  it from `src/shared/` for both, or accept that one duplication and add a test asserting the
  two agree — the pattern the `EXTENSION_VERSION` / manifest test already establishes.
- **The sensitive scan runs before a snapshot**, as it does before a step, and returns the
  reason; `StepHealer.plan` returns `giveUp` for an unattended run on a sensitive page rather
  than sending it. The primitive exists on both sides — `SCAN` reaching `core.scanSensitive`
  on the extension, `scanHold()` on Playwright — so this is a call added in two places, not a
  mechanism invented. **Adding it to one backend leaves the other leaking.**
- Covered by a vitest case against `filterDom` in `tests/` — it is pure, and AI_CONTEXT.md
  §9's lazy `nativeImage` import is what keeps it loadable under plain Node.

### Story 1 — Scheduling a routine

**As** the Operator, **I want** to schedule a routine, **so that** it runs without me.

```gherkin
Scenario: Creating a daily schedule
  Given a saved routine "Invoice pull" with param client = "Acme"
  When I schedule it daily at 06:00 in my timezone with that param
  Then a schedule exists showing its next fire time in my timezone
  And at 06:00 the routine is enqueued as a background run with client = "Acme"

Scenario: One routine, several schedules
  Given "Invoice pull" scheduled daily for client "Acme"
  When I add a second schedule for client "Globex" at 07:00
  Then both exist independently
  And each fires with its own params

Scenario: Disabling a schedule stops it firing
  Given an enabled daily schedule
  When I disable it
  Then no further runs are enqueued
  And its occurrence history remains readable

Scenario: A schedule with a missing required param is refused
  Given a routine with a required param "client"
  When I try to create a schedule that leaves "client" empty
  Then the schedule is not created
  And the error names the missing param

Scenario: A routine with a committing step needs acknowledgement
  Given a routine whose step 5 clicks a button matching the commit word list
  When I try to schedule it
  Then creation is refused until I acknowledge that step by name
  And the acknowledgement is recorded with its timestamp
```

**Required-param validation must move to main.** The only check today is the `blank` filter
inside `AutomationRow`'s `run` handler in
[AutomationRail.tsx](../../src/renderer/src/components/AutomationRail.tsx).
`assertRunRoutineInput` in [ipc.ts](../../src/main/ipc.ts) checks that `params` is an object
and casts it to `Record<string, string>` — it does not check the values are strings and does
not consult the routine's `params` spec at all. A scheduler is a second caller that bypasses
the only validation in the system, and `resolveStep` in
[routines.ts](../../src/shared/routines.ts) — now the single substitution site, called by
both sessions and by the orchestrator's `running` event — resolves an unknown param to `''`,
so the failure is a routine that navigates to a truncated URL or types an empty string rather
than an error.

Two requirements, and the second is a bug this PRD surfaces rather than causes:

- The required-param check moves into main, applied by the `automationRun` handler after it
  resolves the routine — the first point where both the params and the routine's `params`
  spec are in hand. The renderer keeps its copy as pre-submit feedback, not as the gate.
- `RoutineParam.default` is validated by `assertRoutineDefinition`, and the React renderer
  now **does** apply it as a value: `defaultParams` in `AutomationRail.tsx` seeds each field
  from `spec.default ?? ''`. That fix is renderer-only. Nothing in main applies a default, so
  a caller that is not a person typing in that form — the scheduler, exactly — still
  substitutes `''` for an omitted optional param. Schedule creation must apply defaults or
  refuse; silently substituting `''` on a timer, forever, is the version of this bug that
  matters, and the renderer fix does not reach it.

### Story 2 — Seeing what happened overnight

**As** the Operator, **I want** every scheduled run to leave a thread, **so that** I can
check the morning's work in one place.

```gherkin
Scenario: A scheduled run produces a normal thread
  Given a schedule that fires at 06:00
  When the run completes
  Then its thread is identical in form to a manual run's
  And its runs row carries started_by 'schedule' and that schedule's id
  And the schedule's last outcome is derived from that occurrence

Scenario: A failed scheduled run is visible without being sought
  Given a scheduled run that fails
  When I next open the app
  Then the failure is surfaced without my navigating to it
  And it links to the failing step in the thread
```

### Story 3 — Missed occurrences are honest

**As** the Operator, **I want** missed runs recorded rather than silently skipped or fired
late, **so that** I know what did not happen.

```gherkin
Scenario: The app was closed at fire time
  Given a schedule due at 06:00 with catch_up off
  And the app was not running
  When I open the app at 09:00
  Then a schedule_occurrences row records due_at 06:00 as skipped with reason "app not running"
  And no run is enqueued

Scenario: Catch-up fires the most recent missed occurrence only
  Given an hourly schedule with catch_up on
  And the app was closed from 05:00 to 09:00
  When I open the app at 09:00
  Then exactly one run is enqueued, for the 09:00 occurrence
  And the 06:00, 07:00 and 08:00 occurrences are recorded as skipped
  And their reason names the occurrence they were coalesced into

Scenario: An occurrence cannot fire twice
  Given the boot reconciliation pass and the first tick both consider the same occurrence
  When both attempt to enqueue it
  Then only one enqueued row exists for that schedule and due_at
```

### Story 4 — Unattended holds end

**As** the Operator, **I want** a scheduled run that needs me to end rather than wait forever,
**so that** it does not block everything behind it.

```gherkin
Scenario: A layer-3 hold nobody answers
  Given a scheduled run whose step 4 has exhausted its repair budget
  And the run is holding for a human
  When the unattended hold limit elapses with no resume
  Then bridge.cancel() is called
  And the run's terminal status is 'abandoned', not 'cancelled'
  And the queue proceeds to the next entry
  And the target page shows an abandoned banner naming the step
  And the dedicated automation window is closed
  And the schedule's consecutive_failures is incremented

Scenario: A held scheduled run resolved in time continues
  Given a scheduled run holding for a human
  When I resume it within the limit
  Then the hold timer is cleared
  And it continues from the next step, as an attended run would

Scenario: A CAPTCHA ends the run without waiting for anyone
  Given a scheduled run whose page presents a CAPTCHA
  When the extension holds the step MAX_HELD_RETRIES times
  Then the run ends with status 'error' and the scan's own reason
  And no unattended hold timer is involved
```

**The third scenario is the scan hold, and it is a different mechanism** — the step never
executed, `dispatch` retries, and the cap throws an unhealable `Error`. Earlier drafts had
this scenario ending `held-and-abandoned`, which no code path can produce.

**On notification.** PRD 08 ships *after* this PRD — README.md's table has 07 depending on 01
and 05, and IMPLEMENTATION-ORDER.md sequences 08 fourth in the phase deliberately, because 07
is what makes unattended holds happen at all. So **PRD 08 is not a dependency of 07**, and no
acceptance criterion here may require an OS notification. What 07 ships instead: the
`abandoned` run row, the occurrence row, the schedule's last outcome, and the "surfaced
without my navigating to it" requirement in Story 2, satisfied in-app. PRD 08 then adds the
OS notification for the same event — its §5 event table already lists
`abandoned` and `auto_disabled`, so nothing there needs changing.

### Story 5 — Taking the browser back

**As** the Operator, **I want** one control that stops all scheduled activity, **so that** I
can use my own browser without surprises.

```gherkin
Scenario: Pause all
  Given three enabled schedules
  When I pause all scheduled runs
  Then scheduler_state.paused_all is set
  And no schedule fires while it is set
  And each schedule is still 'enabled', shown as paused rather than disabled
  And resuming clears the flag without my re-entering anything

Scenario: Pause-all does not touch a run already in progress
  Given a scheduled run at the head of the queue
  When I pause all scheduled runs
  Then that run continues or is cancelled by me explicitly
  And nothing further is enqueued
```

### Constraints and edge cases

- **DST and timezone.** A schedule is stored with an IANA timezone, never an offset. A 02:30
  daily schedule fires once on a spring-forward day and once on a fall-back day. Covered by
  `tests/cron.test.ts` — see §5.
- A schedule whose routine is deleted moves to `auto_disabled` and records a skipped
  occurrence with reason `routine deleted`, found by the reconciliation pass rather than by an
  FK.
- Changing a routine's params invalidates schedules referencing removed params; those are
  flagged for the Author rather than run with empty substitutions — which is what
  `resolveStep`'s unknown-param behaviour would otherwise do silently.
- Two schedules due at the same instant both enqueue; PRD 05's queue orders them.
- Editing a schedule's cron or timezone recomputes `next_due_at` immediately, and does not
  retroactively mint occurrences for the old expression.

---

## 8. Out of Scope

- **Scheduling chat goals.** Argued in §5. Saved routines only.
- **Event triggers** — file watchers, webhooks, inbound email, "when this page changes". Real
  demand, entirely separate design. Cron first.
- **Cloud or headless execution.** The product's premise is the user's own logged-in browser
  on their own machine ([ARCHITECTURE.md](../../ARCHITECTURE.md) §1).
- **Waking a sleeping machine**, and `powerSaveBlocker` with it — keeping a machine awake to
  drive a browser is a larger consent question than this PRD answers.
- **Undoing a partially completed run** after abandonment. A rollback is itself an unattended
  page mutation; the banner and the thread are the mitigation.
- **A credential vault.** Cut from the plan at the user's direction, which is why a
  login-gated routine ends `error` at the scan-hold cap and that is accepted rather than
  worked around.
- **Sub-minute scheduling**, and therefore a seconds field in the cron expression.
- **Per-schedule model budgets.** PRD 02 reports cost; S2's daily cap bounds volume;
  enforcement of spend stays out.
- **Launch at login is *in* scope** — recorded here because an earlier draft left it neither
  in nor out while §6's primary metric assumed it. See §5's presence section.

---

## 9. Dependencies & Risks

### Dependencies

- **PRD 01** — hard blocker. Unattended runs must be readable, and `started_by` is an
  `ALTER TABLE` on its `runs`.
- **PRD 05** — hard blocker. Overlapping schedules must queue, `dedupeKey` is its staleness
  rule, and its renderer change is what makes a scheduler-started run cancellable at all.
- **PRD 03** — strongly assumed, **not** a blocker per README.md's table. It stops repairs
  writing into the routine on a timer; it does **not** stop them executing. §7's **S4** owns
  the remainder.
- **PRD 06** — strongly assumed, not a blocker. Without assertions, "succeeded" means only
  that no step threw, which makes §6's success-rate comparison much weaker.
- **PRD 08 is not a dependency.** It ships after this PRD; see Story 4.

### Risks

| Risk | Mitigation |
|---|---|
| **A scheduled run hijacks the tab the user is working in — extension backend only.** `handle`'s `start` case binds `chrome.tabs.query({ active: true, lastFocusedWindow: true })`. | §5's dedicated window plus mandatory deferral. The mitigation earlier drafts offered — a dedicated background *tab* — is refuted: `capture` throws unless the tab is active in its window, and it is the only screenshot path there. The default Playwright backend cannot hit this risk at all: it drives a Chrome it spawned on its own profile. |
| **`captureVisibleTab` may need OS focus.** If it does, the dedicated window steals focus for the run's duration. And whether a headed Chrome serves `page.screenshot()` for an occluded or minimized window is the same unanswered question on the Playwright backend. | The §5 spike, gating implementation, now covering both capture paths. Deferral is a requirement either way, so the downside case is a narrower feature rather than a redesign. |
| **The scheduler is not present at 06:00.** `window-all-closed` quits the app on Windows and Linux; there is no tray and no launch-at-login. | Tray, `window-all-closed` change, and opt-in `setLoginItemSettings`, all in scope in §5. Without them §6's primary metric measures how often the user happened to leave the app open. |
| **A timer that does not survive suspend or long horizons.** `setTimeout(fn, 2**31)` fires in 1 ms; timers do not advance across sleep. | A 30 s tick plus `powerMonitor` `resume` / `unlock-screen` re-arming, and `next_due_at` recomputed rather than trusted on boot. |
| **Hand-rolled DST-correct cron is subtly wrong.** No library in `package.json`, and the spring-forward and fall-back cases are exactly the ones nobody tests by hand. | One pure module, one round-trip rejection rule covering both transitions, and `tests/cron.test.ts` against fixed zones across both 2026 transitions in `npm test`. |
| **A drifted routine does the wrong thing repeatedly, unwatched.** | PRD 06 assertions fail loudly; PRD 09 groups repeats; `consecutive_failures` auto-disables at 3 (🔶 **Assumption**); S1's dry run is the pre-flight. |
| **A repaired action commits something unattended.** `output.committing` is read only on the `changed === false` branch, so a repaired click that changes the page is never commit-gated. Both backends return the field and the orchestrator discards it on the success path, so this is one defect, not two. | S4's same-kind gate plus S1's pre-flight resolution, both landing in `page-core.js` and so reaching both backends. G1 names the proxy that would catch a miss. |
| **Credentials reach the model.** Neither backend scans before a snapshot; `filterDom` keeps `value` and `autocomplete`; `mirrorLiveState` now copies live field contents onto the clone, stripping only `SENSITIVE_TARGET` matches, so hidden inputs and the unredacted screenshot still go out. | S5, as a shipping gate with a test — not a note to verify later, which is what an earlier draft made it. |
| **Abandonment leaves a half-filled page with no banner.** On the extension, `stop` sets it idle; on Playwright, `disconnect()` sets `ending` and `stateFor` returns idle. Either way the banner goes. | The abandoned banner state in §5 — one new state in `buildBanner`, delivered by a new `CONTROL_TYPES` message on the extension and a `stateFor` case on Playwright. |
| **Runaway cost.** Hourly schedules × repairs × model calls. | S2's daily cap; PRD 02 makes spend visible; auto-disable bounds a persistently failing schedule. |
| **Schedules fire during a demo, a meeting, or a screen share.** | Pause-all as a first-class control backed by `scheduler_state`, plus deferral on user activity. |

### Documents this change makes stale

Per AI_CONTEXT.md §13, in the same change:

- **§4 file map** — add `src/main/schedule/cron.ts`, `scheduler.ts`, `src/main/db/schedules.ts`,
  `src/main/tray.ts`.
- **§5 symbol index** — `nextFireAfter`, `Scheduler`, `ScheduleStore`.
- **§6 data contracts** — `runs.started_by`, the widened `status` union with `abandoned`, the
  new dry-exec path (a core method in `page-core.js`, an extension message beside `EXEC`), and
  the widened banner state.
- **§7 budgets** — `SCHEDULER_TICK_MS`, `UNATTENDED_HOLD_LIMIT_MS`, `ACTIVITY_QUIET_SECONDS`,
  `MAX_DEFERRALS`, `AUTO_DISABLE_AFTER`.
- **§8 invariants** — the layer-3 hold gains a bound for scheduled runs, which weakens
  *"waitWhileHeld resolves only on resume or cancel"* into *"…or on the unattended hold timer,
  which reaches `cancel()`"*. §13 item 4 makes that edit mandatory.
- **§9 traps** — the `capture()` trap gains the dedicated-window resolution; the redaction
  chain in S5 is a trap in its own right.

---

## 10. Open Questions

- 🔵 **Does `captureVisibleTab` succeed for a non-foreground window** — occluded, background,
  minimized? The one question that could still change this feature's shape. Spike before
  implementation; §5 states what each answer implies. **The same question now has to be asked
  of `page.screenshot()` on a headed Chrome**, because the default backend captures that way;
  §5's spike covers both.
- 🔵 Is 15 minutes the right unattended hold limit? Adopted as a default so the feature is
  buildable; it has no basis, and the hold-rate metric is what corrects it.
- 🔵 Auto-disable after 3 consecutive failures, or only warn? Auto-disable risks silently
  stopping something important; `auto_disabled` is a distinct state partly so the UI can make
  that loud.
- 🔵 Should a new schedule's first N runs be dry runs by default? It would make S1 the
  default posture rather than an option, at the cost of a schedule that appears not to work.
- 🔵 Which routines would users schedule, and how often? Unknown, and it decides whether
  hourly matters or daily is enough.
- 🔶 **Assumption:** cron granularity down to minutes is enough; nobody needs sub-minute
  scheduling.
- 🔶 **Assumption:** users will accept that a closed app means a missed run. §5's tray and
  launch-at-login narrow this to a machine that is off or asleep; if that residual is still
  unacceptable, the answer is a background helper process, which is a much larger change.

**Factual note, verified 2026-08-27 — the two questions this PRD is blocked on now each have
two backends under them.** This changes nothing that §5 decides; it changes what a decision
has to cover.

- **Where a scheduled run acts.** §5's three-option table and its choice of a dedicated window
  describe `AUTOMATION_BACKEND=extension`, which binds the user's active tab. On the default
  Playwright backend `ChromeProcess` spawns a headed Chrome on its own `automation-profile`,
  so there is no user tab to take and nothing to create; what is left of the question there is
  whether that browser may appear, unbidden, at 06:00.
- **Presence.** §5 puts the tray, the `window-all-closed` change and opt-in launch-at-login in
  scope and that stands. The backends differ only in what a run additionally needs present:
  the extension needs the user's Chrome already running, because the app cannot dial out;
  Playwright needs nothing but the app, because it starts Chrome itself.

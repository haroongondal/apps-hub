# PRD 01 — Run threads

| | |
|---|---|
| **Phase** | Foundation |
| **Depends on** | Nothing |
| **Blocks** | 02, 03, 04, 07, 08, 09 |
| **Status** | Draft |
| **Author** | hmukhtar@outsentia.com |

Shared personas and strategic context: [README.md](README.md).

---

## 1. Executive Summary

We're building **run threads** — a persisted, browsable record of every automation
run — for **the Operator** to solve the problem that a run's entire evidence trail
is discarded the moment it finishes, which will make every run auditable after the
fact and unblock the six later features whose value depends on being able to read
what an unattended run did.

This is mostly plumbing. The app already produces a complete, structured event
stream for every run and throws it away.

---

## 2. Problem Statement

### Who has this problem?

The Operator, on every run. The Author, every time a routine breaks and they have
to reconstruct what happened from memory.

### What is the problem?

Nothing about a run survives it.

- A `runId` is minted at the top of both run paths (`runRoutine` and `runChatGoal` in
  [orchestrator.ts](../../src/main/automation/orchestrator.ts)) and stamped onto every
  progress event, then discarded when the function returns.
- The database has exactly two tables, `system_routines` and `user_routines` — the
  `MIGRATIONS` array in [database.ts](../../src/main/db/database.ts) has a single entry.
  There is no run table and no migration that adds one.
- `RunResult` ([types.ts](../../src/shared/types.ts)) carries `extracted`, `artifacts` and
  `repairs`. It is returned across IPC to the renderer, rendered once, and lost when the
  window reloads.
- Screenshots are returned as in-memory `data:` URLs, built in `runRoutine` where it pushes
  onto `artifacts`, and never written to disk.
- Chat sessions — including `recordedSteps`, the thing "save this as a routine" reads — live
  in the `chatSessions` `Map` on the orchestrator instance, read by `saveChatSession`. A
  crash or restart loses them.

### Why is it painful?

- **User impact.** After a run, the Operator has no answer to "did it work?" other
  than what they personally watched. A run that finished while they were away is
  indistinguishable from a run that never happened. 🔶 **Assumption:** this is why
  runs get watched rather than trusted — unvalidated, no telemetry exists to
  confirm it.
- **Business impact.** The product's central claim — automations that survive site
  drift and run unattended — cannot be demonstrated, sold, or debugged. Every
  downstream feature that depends on unattended operation (PRD 07 scheduling, PRD
  08 notifications, PRD 09 fingerprints) is unshippable without this, because an
  unattended run nobody can read afterwards is worse than no run at all.

### Evidence

- **Code.** The five findings above, each traceable to a line.
- **Structural.** `AutomationProgressEvent` ([types.ts](../../src/shared/types.ts)) already
  carries `runId`, `source`, `sessionId`, `status`, `stepIndex`, `totalSteps`, `description`
  and `error` — an already-serialisable event stream, broadcast to the renderer and never
  written down. Most of the work here is a writer. But it is **not only** a writer: that
  event carries no artifact, repair, step-JSON or token data, and §5's write path lists the
  additions this PRD owns. Treating it as pure plumbing is what made five downstream PRDs
  depend on data that does not exist.
- 🔵 **Open Question:** how often do runs currently fail, and at which step? Nobody
  can answer this today. It is the first thing this feature will tell us.

---

## 3. Target Users & Personas

**Primary: The Operator.** Needs the answer to "did it work, and if not, what
now?" without having watched.

**Secondary: The Author.** Needs the failing page as it actually was, not a
reproduction attempt hours later against a site that has since changed.

**Job-to-be-done:** *When a run finishes while I am away, I want to see exactly
what it did, so I can trust the result without redoing it.*

---

## 4. Strategic Context

**Ladders up to:** more runs complete unattended and are trusted afterwards.

**Why now.** This is the dependency root. Six of the thirteen PRDs cannot deliver
their stated value without it, and four of them cannot state a success metric
without it either — there is no analytics substrate in the product at all. Built
first, it makes every subsequent feature both measurable and debuggable. Built
later, it forces every feature ahead of it to ship blind.

**Competitive framing.** 🔶 **Assumption:** run history is table stakes in
comparable automation tools, so its absence reads as a gap rather than a
simplification. Not validated against specific competitors.

---

## 5. Solution Overview

Four new tables, a writer in main, and a thread view in the renderer.

### Data

A third migration appends to the `MIGRATIONS` array in
[database.ts](../../src/main/db/database.ts) — the existing `PRAGMA user_version`
loop applies it with no other change.

| Table | Holds |
|---|---|
| `runs` | one row per run: `id` (the existing `runId`), `source` (`routine`/`chat`), `routine_id`, `routine_kind` (`system`/`user`), `routine_name`, `params` (JSON as TEXT), `status`, `started_at`, `ended_at`, `error`, `failed_step_index`, `step_count`, `human_steps`, `opened_at` (§6's thread-open metric), `recorded_steps` (Story 5) |
| `run_events` | one row per progress event: `run_id`, `seq`, `status`, `step_index`, `description`, `step_json` (the resolved `ActionStep` as TEXT, null for non-step events), `error`, `at` |
| `run_artifacts` | one row per screenshot or extracted value: `run_id`, `step_index`, `kind` (`screenshot`/`extract`), `label`, `text_value`, `file_path` |
| `run_repairs` | one row per repair: `run_id`, `step_index`, `reason`, `original`, `replacement`, `at` |

All four are `STRICT`, matching the two that exist. `run_events`, `run_artifacts` and
`run_repairs` take `ON DELETE CASCADE` on `run_id` — `foreign_keys` is already `ON`, set
beside the WAL pragma in `openDatabase`. `routine_kind` is mandatory because a run is
addressed as `{kind, id}` by `IpcChannels.automationRun`, and no foreign key to
`system_routines` is possible: `syncFromDir` deletes and re-inserts every row on each sync.

**Status is not a flat list of five.** Two of the values the first draft of this PRD used
were not producible, and one that matters was missing:

| Status | Meaning | Terminal? |
|---|---|---|
| `running` | open row, run in flight | no |
| `held` | parked at a hold, waiting on a person | **no** — resolves to another status |
| `done` | every step executed by the automation, no human intervention | yes |
| `assisted` | completed, but `human_steps` > 0 — a person did one or more steps | yes |
| `error` | a non-healable step error propagated out of the run loop | yes |
| `cancelled` | `bridge.cancel()` — classified by **error identity**, not message text | yes |
| `interrupted` | the row was open when the app quit; closed at next boot | yes |

`assisted` is the change [README.md](README.md#how-a-run-ends-today) argues for. Today a run
where a human did step 4 reports `done`, which is honest about the outcome and dishonest
about autonomy — and autonomy is what all thirteen PRDs ladder up to. Separating the two,
plus `human_steps`, is what makes "runs that complete without a human" a countable thing
rather than a slogan. PRD 07's success metric and PRD 09's grouping both depend on it.

`held` is a live state, not a terminal one, so nothing may treat it as an outcome. PRD 07
adds the terminal state for a hold that nobody ever answers. Note the two senses: on the
`runs` row `held` is the run's standing state, but as a *progress event* it is a per-step
phase marker the run always moves past — the writer must not leave a row `held` once a
later event arrives.

**Screenshots go to disk, not into SQLite.** `userData/runs/<runId>/<n>.jpg`, with
`run_artifacts.file_path` holding the relative path. A run with ten screenshots at
~80 KB each would add ~800 KB per run to the database otherwise; at one scheduled
run an hour that is ~7 GB a year in a file the app opens on every boot.

Repairs persist too — `run_events` rows with `status = 'healing'` plus a
`run_repairs` table carrying `original` and `replacement` step JSON. PRD 03 turns
those rows into reviewable proposals; this PRD only records them.

### Write path

`registerIpcHandlers` owns the single `onProgress` closure that broadcasts to every window,
and a `RunStore` wraps it: open the `runs` row on the first event for a `runId`, append every
event, close the row on a terminal status.

**That closure alone is not enough, and this is the part to get right.** An earlier draft of
this PRD said "nothing in the orchestrator changes". That was wrong, and because five other
PRDs were written on top of it, each inherited a story it could not build.
`AutomationProgressEvent` carries exactly eight fields, and none of them is the data those
PRDs need:

```
runId · source · sessionId? · status · stepIndex · totalSteps? · description · error?
```

Screenshots reach the renderer only as `RunResult.artifacts[].dataUrl`; extracted text only
as `RunResult.extracted`; a repair arrives as the prose string `Repairing step: <reason>`,
never as step JSON. `runChatGoal` returns `void`, so a chat run has no return channel at all.
So this PRD owns the following changes to the event vocabulary and both run loops. They are
small, but they are not zero, and the orchestrator tests change with them.

| Change | Where | Why, and who needs it |
|---|---|---|
| `onArtifact(runId, artifact)` callback | `runRoutine`, `runChatGoal` | screenshots and extracted values, off the step's critical path. Story 2, Story 3 |
| `onRepair(runId, repair)` callback carrying `original` and `replacement` | `runWithRepair` **and `extractWithRepair`** | Story 4, and **PRD 03** cannot build a proposal from a prose string. Must fire on the failure path too, or a run that healed and then failed yields nothing. `extractWithRepair` is a second, independent repair site with its own `plan` bookkeeping — an earlier draft named only `runWithRepair`, so a repaired `extract` step would have reported nothing |
| `step_json` on the emitted step event | `runRoutine`, `runChatGoal` | **PRD 04**'s save-from-thread needs `ActionStep` objects; **PRD 13**'s transcript needs the resolved step |
| **Absolute** step indexes, always | both loops | `applyRepairs` writes `steps[repair.stepIndex]`. A resumed or sliced run that re-indexes silently overwrites the wrong step of the user's routine. **PRD 04** depends on this |
| the failing step index on the terminal error event | `runRoutine`'s catch **and `runChatGoal`'s** | today both emit `stepIndex: -1`, so nothing can say *where* a run failed. **PRD 08** deep-links to it, **PRD 09** fingerprints on it. A failure before the loop starts still reports `-1` rather than falsely naming step 0 |
| `runId` and `stepIndex` on `AutomationHoldEvent` | **both** `paused` emit sites in `ExtensionBridge` | it is `{held, reason, automatic}` today, so no hold can be attributed to a run. **PRD 08** is unbuildable without it. `holdForHuman` → `bridge.pause()` is only the layer-3 path; the commoner hold is the extension's own scan hold arriving as `type === 'paused'` over the socket, which never passes through `holdForHuman` — stamping only the first leaves every automatic hold unattributed |
| `human_steps` incremented on each hold, and the `assisted` status | `runRoutine`'s `NeedsHumanError` catch, and a hold reporter the session calls on a scan hold | see the status table above. A scan hold did not have the person run the step, but it did require them to be present, which is what the metric asks — so it counts, once per step rather than once per retry |
| widened `status` union | `shared/types.ts` | `cancelled`, `assisted`, `interrupted` are not producible today |

Two of these are contract changes to types listed in [AI_CONTEXT.md](../../AI_CONTEXT.md) §6,
so its §13 rule applies: update it in the same change.

**Cancellation is classified by error identity, not message text.** `bridge.cancel()` raises
`RunCancelledError`, which the orchestrator's catch currently flattens into `status: 'error'`.
Match on the class in main. AI_CONTEXT.md §8's "only error *messages* cross IPC" constrains
the **renderer**, not main — main has the real error object and must use it.

### Read path

New channels added to `IpcChannels` in [shared/ipc.ts](../../src/shared/ipc.ts) —
`runs:list`, `runs:get`, `runs:delete`, `runs:purge` — each a `handle(...)` in
`registerIpcHandlers` behind the existing `trustSender` allowlist, then a method on `api` in
the preload, then the renderer. Per the §10 recipe in AI_CONTEXT.md, the live-updating rail
also needs a **push** channel, `runs:changed`, exposed as
`onRunsChanged(listener): () => void` to match the four existing unsubscribers.

### UI

A **Runs** rail beside the existing routine sidebar in
[src/renderer/](../../src/renderer/): reverse-chronological rows showing routine
name, outcome, duration, step count. Selecting one opens the **thread** — the run's
event timeline in order, with screenshots inline at the step that produced them,
extracted values as a table, repairs called out where they happened, and the error
at the end if there was one.

The live run writes into the same view, so "watching a run" and "reading a past
run" are the same screen rather than two.

### Retention

A default cap — 🔶 **Assumption:** 200 runs or 30 days, whichever is hit first,
configurable, with artifacts deleted alongside their rows. Chosen to bound disk
growth without a research basis; revisit once PRD 07 reveals real run volume.

---

## 6. Success Metrics

This feature *is* the measurement substrate, so its own baselines are unknown and
its metrics are mostly coverage and adoption rather than outcome movement.

### Primary

**Run observability coverage** — share of runs that produce a readable thread.
- Current: 0%
- Target: 100% of runs, including runs that error, are cancelled, end `assisted`, or are
  interrupted by an app quit
- Measured: `runs` rows reaching a terminal status ÷ **`IpcChannels.automationRun` and
  `automationChatSend` invocations**, counted independently of the `runs` table

The denominator matters. Taking both terms from the table this PRD introduces would make the
metric read 100% by construction — a run whose row never opened would simply be invisible.
Counting invocations at the IPC handler is the only place upstream of the writer, so a writer
that fails to open a row shows up as a gap instead of disappearing.

### Secondary

- **Unattended completion rate** — `done` ÷ (`done` + `assisted`). This is the product
  outcome all thirteen PRDs ladder up to, and the `assisted` status is what makes it
  countable. Current: unmeasurable. 🔵 **Open Question:** no baseline until this ships.
- **Thread open rate** — share of completed runs whose thread is opened within 24h.
  Requires an `opened_at` column on `runs`, written from the read path; without it there is
  no mechanism. 🔵 **Open Question:** no baseline; target set after four weeks of data.
- **Time-to-diagnose a failed run.** 🔵 **Open Question:** unmeasurable today.
  This PRD establishes the baseline that PRD 09 is then judged against.
- **Chat-session survival** — share of chat runs whose recorded steps are still
  saveable after an app restart. Current 0%, target 100%.

### Guardrails

- **Run latency.** Persisting events must not slow a run. Target: added per-step
  overhead under 5 ms — measured in `tests/db.verify.ts`, since `onProgress` fires
  synchronously inside the step loop and event writes therefore *are* on the critical path.
  Writes are local SQLite in WAL mode (the pragma is set in `openDatabase`); screenshot file
  I/O is the larger risk and must be moved off the step path via `onArtifact`.
- **Database size.** Target: under 50 MB at the default retention cap.

---

## 7. User Stories & Requirements

### Epic hypothesis

We believe that persisting every run as a readable thread will let the Operator
trust unattended runs, because today the only evidence a run produces is what a
human watched in real time. We will know we are right when scheduled runs (PRD 07)
are left unattended rather than watched, and when failed runs are diagnosed from
the thread rather than by re-running.

### Story 1 — A run is recorded

**As** the Operator, **I want to** have every run written down as it happens,
**so that** I can read it afterwards whether or not I was watching.

```gherkin
Scenario: A routine run is persisted end to end
  Given the extension is connected
  When I run a routine of 6 steps to completion
  Then a runs row exists with status 'done', a started_at and an ended_at
  And run_events contains one row per emitted progress event, in order
  And the run appears at the top of the Runs rail

Scenario: A failed run is persisted with its error
  Given a routine whose step 3 raises a non-healable error
  When the run fails
  Then the runs row has status 'error' and the error message
  And run_events records every step up to and including the failure

Scenario: A cancelled run still leaves a thread
  Given a run in progress
  When I press Cancel
  Then the runs row is closed with status 'cancelled'
  And the thread shows the steps that completed before cancellation
```

### Story 2 — Screenshots survive the run

**As** the Operator, **I want** screenshots stored on disk and shown in the
thread, **so that** I can see what the page looked like at each capture.

```gherkin
Scenario: A screenshot step writes an artifact
  Given a routine containing a screenshot step labelled "confirmation"
  When the run completes
  Then a JPEG exists under userData/runs/<runId>/
  And a run_artifacts row of kind 'screenshot' points at it with label "confirmation"
  And the thread renders it inline at that step

Scenario: Deleting a run removes its artifacts
  Given a completed run with 3 screenshots on disk
  When I delete that run
  Then the runs, run_events and run_artifacts rows are gone
  And userData/runs/<runId>/ no longer exists
```

### Story 3 — Extracted values are kept

**As** the Operator, **I want** what a run read off the page kept with the run,
**so that** a price check or invoice total is still there tomorrow.

```gherkin
Scenario: Extract steps persist their values
  Given a routine with an extract step writing into "total"
  When the run completes
  Then a run_artifacts row of kind 'extract' holds name "total" and its text
  And the thread shows an Extracted table containing it

Scenario: Extracted text respects the existing cap
  Given an extract step whose target contains 40,000 characters
  When the run completes
  Then the stored value is truncated at 10,000 characters, matching current behaviour
```

### Story 4 — Repairs are recorded where they happened

**As** the Author, **I want** every repair recorded against its step, **so that**
I can see that a routine changed and why.

```gherkin
Scenario: A healed step records its repair
  Given a routine whose step 4 selector no longer matches
  And the healer returns a repair
  When the run completes
  Then a run_repairs row holds step 4's original and replacement steps and the reason
  And the thread marks step 4 as repaired with both selectors shown
```

### Story 5 — Chat runs get threads too

**The event stream alone cannot satisfy this story.** A `running` event is emitted
*before* the step executes, so it cannot tell a step that worked from one that failed,
and a routine rebuilt from events would contain the failures. The saveable steps are the
ones `runChatGoal` actually recorded, reported once through the observer and stored on
`runs.recorded_steps`. That write lands *after* the terminal event, so the store must
tolerate writing the column onto an already-closed row.

**As** the Author, **I want** chat runs recorded like routine runs, **so that** a
restart does not lose a recording I was about to save.

```gherkin
Scenario: Chat recorded steps survive a restart
  Given a chat run that executed 5 steps toward a goal
  When I quit and reopen the app
  Then the chat run's thread is present with all 5 steps
  And I can still save it as a user routine from that thread
```

### Story 6 — Browsing and pruning

**As** the Operator, **I want** to browse and prune past runs, **so that** the
list stays useful and disk use stays bounded.

```gherkin
Scenario: Runs are listed newest first
  Given 12 completed runs
  When I open the Runs rail
  Then they are listed newest first with name, outcome, duration and step count

Scenario: Retention prunes the oldest runs
  Given retention is set to 200 runs
  And 200 runs exist
  When a 201st run completes
  Then the oldest run and its artifacts are deleted
```

### Constraints and edge cases

- Two windows must not double-write. The `RunStore` writes from main, once per
  event, before broadcasting — not from the renderer.
- A run interrupted by app quit leaves an open `runs` row. On boot, any row with
  no `ended_at` is closed as `interrupted` rather than left ambiguous.
- `run_events.seq` is assigned by the store, not taken from `stepIndex` — a step
  can emit several events (`running` then `healing`) and healing events carry the
  same index.

---

## 8. Out of Scope

- **Re-running or resuming from a thread** — PRD 04.
- **Accepting or rejecting a repair** — this PRD records repairs; PRD 03 makes
  them reviewable. Repairs continue to auto-apply exactly as they do today — the
  `kind === 'user' && result.repairs.length > 0` branch of the
  `IpcChannels.automationRun` handler in [ipc.ts](../../src/main/ipc.ts) — until PRD 03
  lands. Note that only *like-for-like* repairs actually mutate anything, because
  `applyRepairs` keeps a single same-kind replacement and discards the rest.
- **Cost and token counts in the thread** — PRD 02, which adds columns to the
  `runs` row this PRD creates.
- **Grouping runs by failure** — PRD 09.
- **Exporting or sharing a thread** — no PDF, no link. Revisit if asked for.
- **Full DOM snapshots per step.** Screenshots only. Storing every filtered DOM
  would multiply storage for a debugging case PRD 13 serves better.

---

## 9. Dependencies & Risks

### Dependencies

- None external. Migration 3 appends to the existing `MIGRATIONS` array; the
  `applyMigrations` loop in [database.ts](../../src/main/db/database.ts) needs no change,
  because `PRAGMA user_version` is the cursor.
- Renderer work is the larger half: `src/renderer/src/main.ts` is 306 lines of vanilla TS
  with no routing, component model or list-detail pattern to build on. The framework
  decision belongs to this PRD — see §10.
- **Later PRDs extend this PRD's tables**, and because `MIGRATIONS` entries are never
  edited each does so by appending its own: PRD 02 adds cost columns, PRD 04 adds
  `rerun_of` and resume bookkeeping, PRD 05 adds queue state, PRD 07 adds `schedule_id`
  and an occurrences table, PRD 13 adds a `debug` source. Anything with a `CHECK`
  constraint — `status`, `source` — therefore has to be widened by a table rebuild rather
  than an `ALTER`, so leave room deliberately or accept the rebuild.

### Risks

| Risk | Mitigation |
|---|---|
| **Screenshot I/O slows runs.** Writing JPEGs synchronously inside the step loop adds latency to the critical path. | Write artifacts asynchronously after the step returns; the run does not await them. Verify against the 5 ms guardrail. |
| **Database growth.** Unbounded events plus artifacts on a file opened at every boot. | Artifacts on disk not in SQLite; retention cap on by default; size surfaced in the UI. |
| **The renderer grows a second job.** A 306-line file gaining a list-detail view invites the same sprawl the codebase has so far avoided. | Split the renderer into `routines/` and `runs/` modules as part of this work, rather than after. |
| **Recording changes run behaviour.** A store that throws mid-run could fail a run that would otherwise have succeeded. | Persistence failures are logged and swallowed — never propagated into the run. Losing a thread must not lose a run. |
| **Privacy.** Threads persist screenshots of the user's real logged-in browser, including whatever was on screen. | Artifacts stay in `userData` on the local disk, never transmitted. Retention is a delete, not an archive. Document this. |

---

## 10. Open Questions

- 🔵 What is the actual current failure rate of routine runs, and at which step?
  Unanswerable today; this feature answers it.
- 🔵 Should threads for chat runs and routine runs share one list or be separated?
  Leaning one list with a source filter — cheaper, and the Operator's question
  ("what ran today?") does not distinguish them.
- 🔵 Is 200 runs / 30 days the right default retention? Pure assumption. Revisit
  after PRD 07 establishes real volume.
- 🔵 Should the thread show the filtered DOM sent to the model on chat steps? It
  would help debugging and would roughly triple storage. Deferred to PRD 13.
- 🔶 **Assumption:** the Operator wants a chronological timeline rather than a
  summary-first view. Worth a usability check before the renderer work is final.

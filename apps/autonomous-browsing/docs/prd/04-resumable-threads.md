# PRD 04 — Resumable threads

| | |
|---|---|
| **Phase** | Foundation |
| **Depends on** | PRD 01 (persisted runs, `step_json` per step event, absolute step indexes, `onArtifact`) |
| **Blocks** | Nothing |
| **Status** | Draft |
| **Author** | hmukhtar@outsentia.com |

Shared personas and strategic context: [README.md](README.md). Dependencies are
whatever [README.md](README.md)'s table says; this header restates it and is the
bug if the two disagree.

---

## 1. Executive Summary

We're building **resumable threads** — re-run, resume-from-step, and save-to-routine
actions on a past run — for **the Operator and the Author** to solve the problem
that a thread is a dead record you can read but not act on, which will turn every
past run into a starting point and remove the one place the product can currently
lose work outright: an unsaved chat recording.

Resume is the large half, and it is **a safety feature before it is a convenience
one**. Skipping steps 1–8 to restart at step 9 means asserting three things the
machine does not currently know: that step 9 did not already run, that nothing in
the range being re-executed commits anything, and that the browser is on the page
steps 1–8 put it on. Each of those is a refusal condition in §5, not a warning.

---

## 2. Problem Statement

### Who has this problem?

The Operator, whose only response to a failed run is to start over from step one.
The Author, who loses a chat recording to any restart before they name and save it.

### What is the problem?

Three specific dead ends.

1. **A failed run cannot be continued.** A routine that dies at step 9 of 12 must
   be re-run from step 1. For a routine whose early steps navigate and log in, that
   is most of the cost paid twice — and for a routine whose early steps *commit*
   something, re-running is the double-submit hazard the architecture takes
   seriously everywhere else ([HOW-IT-WORKS.md](../../HOW-IT-WORKS.md) §8).
2. **A run cannot be repeated with different inputs.** Params are collected in the
   renderer, per run, by the `AutomationRow` form inside `AutomationRail`
   ([components/AutomationRail.tsx](../../src/renderer/src/components/AutomationRail.tsx)),
   handed to `startRoutine` in
   [state/useRuns.ts](../../src/renderer/src/state/useRuns.ts), passed to
   `IpcChannels.automationRun` and then dropped. 🔶 **Assumption:** "same routine,
   different invoice number" is therefore retyped each time. Unvalidated — the code
   shows the values are not retained, not that anyone re-enters them often.
3. **A chat recording no longer dies with the process — PRD 01 closed this,
   verified 2026-08-27.** `saveChatSession`, `clearChatSession`, the orchestrator's
   `chatSessions` `Map` and the `automation:chat:clear` channel are all deleted. A
   chat run's steps live in `runs.recorded_steps`, written by `setRecordedSteps` in
   [runs.ts](../../src/main/db/runs.ts) from `RunObserver.recorded`, and the
   `IpcChannels.automationChatSave` handler in [ipc.ts](../../src/main/ipc.ts) takes
   `{ runId, name }` and builds the definition from `RunDetail.recordedSteps`. That
   column is now the **only** source; there is no in-memory copy left to lose.
   Story 3 below is therefore already satisfied, including its affordance —
   `ThreadView` shows *Save as an automation*, disabled while `recordedSteps` is
   empty. What survives of this PRD's third dead end is nothing; §5 and Story 3 are
   corrected to say so rather than to re-specify work that shipped.

### Why is it painful?

- **User impact.** The third is real, immediate work loss — the Author did the work,
  it succeeded, and the app threw it away. 🔶 **Assumption:** the first two are
  friction that scales with routine length; nothing measures how long real routines
  are or how far into one a failure typically lands.
- **Business impact.** "Drive it by chat, then save it as a routine" is the
  product's authoring story ([HOW-IT-WORKS.md](../../HOW-IT-WORKS.md) §4). It has a
  hole in it that only shows up at the worst moment.

### Evidence

- **Code.** The first two, traceable to symbols. The third is closed.
- **Structural.** The data this feature reads is **a PRD 01 deliverable, and it has
  landed** — verified 2026-08-27. `AutomationProgressEvent` in
  [types.ts](../../src/shared/types.ts) now carries `step?: ActionStep`, the
  resolved step the event is about, and `RunStore.record` persists it as
  `run_events.step_json`. Absolute step indexes, the failing step index on the
  terminal error event, and `RunObserver.artifact` all shipped with it. An earlier
  draft of this PRD asserted the steps were "already persisted" and called the work
  read-path only; that was premature rather than wrong, and §5 below still lists the
  orchestrator, shared-type and schema changes this PRD owns on top of PRD 01.
- 🔵 **Open Question:** how often do runs fail partway through? Unknown until PRD 01
  ships. It sets the value of resume-from-step, which is the largest piece here.

---

## 3. Target Users & Personas

**Primary: The Operator** — wants to finish what failed, not restart it.

**Secondary: The Author** — wants a chat recording to survive long enough to name.

**Job-to-be-done:** *When a run fails partway, I want to carry on from where it
stopped, so I do not repeat work the run already did.*

---

## 4. Strategic Context

**Ladders up to:** unattended completion. 🔶 **Assumption:** a run that failed at
step 9 overnight and can be finished with one click in the morning is close enough
to unattended to count, where one that must be restarted is not. This is a judgement
about what the Operator will tolerate, not a measured preference.

**Why now.** It is the largest read-path use of PRD 01's data, and the
chat-recording loss is a bug the product ships with today.

**Where in the order.** **Fourth in the Foundation phase — 01 → 02 → 03 → 04**, per
[IMPLEMENTATION-ORDER.md](../IMPLEMENTATION-ORDER.md), which places 04 last inside
the phase because 02 is three columns on 01's table and 03 closes an active
data-loss risk that the scheduler multiplies. An earlier draft of this section said
"immediately after PRD 01", which contradicted that. The thread view is still built
once: 02 and 03 add to the same view, and this PRD adds actions to it.

---

## 5. Solution Overview

Three actions on a thread — and, for resume, five gates that can refuse it.

### Data this PRD adds

PRD 01 creates `runs`, `run_events` and `run_artifacts`. Four of the five fields
this feature needs are **not** in that schema, so **this PRD owns them**, in one new
entry appended to the `MIGRATIONS` array in
[database.ts](../../src/main/db/database.ts). Per AI_CONTEXT.md §10's *Changing
persistence* recipe: append, never edit a shipped entry; `PRAGMA user_version` is
the cursor and needs no change.

| Field | Table | Why, and who needs it |
|---|---|---|
| `rerun_of TEXT NULL REFERENCES runs(id) ON DELETE SET NULL` | `runs` | Story 1's chain. §5 of an earlier draft used `runs.rerun_of` as though PRD 01 provided it; **it does not appear in PRD 01's schema**, so it is added here rather than pushed upstream — PRD 01 has no other use for it |
| `resumed_from_run_id TEXT NULL REFERENCES runs(id) ON DELETE SET NULL` | `runs` | distinguishes a resume from a re-run, which every metric in §6 needs |
| `resume_start_index INTEGER NULL` | `runs` | the absolute index the loop started at. Without it "steps saved by resume" has no mechanism |
| `definition_hash TEXT NOT NULL` | `runs` | the drift gate. Recorded when the row opens |
| `committing INTEGER NULL` | `run_events` | the per-step commit verdict, `NULL` when the backend reported none. The committing gate is unbuildable without it |

`ON DELETE SET NULL` rather than `CASCADE`: PRD 01's retention prune must not delete
a chain of attempts because its oldest member aged out. `foreign_keys` is already
`ON`, set in `openDatabase`.

`committing` has to travel to the writer, which means `AutomationProgressEvent`
gains `committing?: boolean` on the step event beside PRD 01's `step_json`, and
`runRoutine` passes `attempt.output.committing` into `report`. Today that value
reaches `runWithRepair` and is discarded unless `output.changed === false`.

**`definition_hash` is a hash, not a step-count comparison.** A new exported
`definitionHash(definition: RoutineDefinition): string` in
[routines.ts](../../src/shared/routines.ts), sha256 over the steps with object keys
sorted — `assertRoutineDefinition` returns the caller's object untouched, so raw
`JSON.stringify` would report key reordering as drift. `system_routines.checksum`
cannot be reused: it hashes the whole raw file text, so a description edit reads as
drift, and user routines have no checksum at all.

### Re-run

Repeats the same routine with the same params, pre-filled and editable, from
`runs.params`. Starts a new run and a new thread with `rerun_of` set, so a chain of
attempts reads as a chain.

**The required-param refusal has to move to main.** There is no `requiredParams`
symbol anywhere — verified 2026-08-27, it was a phantom in the previous draft. The
check is an inline filter inside `AutomationRow` in
[components/AutomationRail.tsx](../../src/renderer/src/components/AutomationRail.tsx)
(`spec.required && !params[name]?.trim()`), and `assertRunRoutineInput` in
[ipc.ts](../../src/main/ipc.ts) shape-checks only that `params` is an object, so main
will start any run with any params. Story 1's second scenario is a main-side refusal,
so that filter is extracted to [routines.ts](../../src/shared/routines.ts) as a new
exported `requiredParams(definition, params): string[]`, called by the
`IpcChannels.automationRun` handler before `runRoutine` and imported by
`AutomationRow` in place of its inline copy.

### Resume from step N

Runs the routine from an absolute step index with the original params and the
original run's extracted values, skipping earlier steps.

**`runRoutine`'s signature changes.** Today it is
`runRoutine(routine, params, observer: RunObserver)` — PRD 01 replaced the bare
progress callback with the observer — and it iterates `steps.entries()` from 0. It
gains an optional fourth argument:

```
resume?: { startIndex: number; vars: Record<string, string>; repairsUsed: number }
```

Optional, so the 26 existing `runRoutine(` call sites in
[tests/orchestrator.test.ts](../../tests/orchestrator.test.ts) still compile — but
many change anyway, because the loop, the `vars` seed and the healer's budget all
move, and the new behaviour needs its own cases.

**The loop keeps iterating the whole array and `continue`s past indexes below
`startIndex`. It must never `slice`.** PRD 01 §5 guarantees absolute step indexes
for exactly this reason and this PRD is the dependant: `applyRepairs` in
[routines.ts](../../src/shared/routines.ts) writes `steps[repair.stepIndex]`, and
`runRoutine` pushes `repairs.push({ stepIndex: index, ... })`. A loop over
`steps.slice(9)` yields `index` 0 for step 9, so a repair of the tenth step would be
written into the first step of the user's routine by the `kind === 'user' &&
result.repairs.length > 0` write-back branch in [ipc.ts](../../src/main/ipc.ts) —
silently, because `applyRepairs` only checks that the kinds match, and a `click`
overwriting a different `click` matches. `totalSteps` stays `steps.length` so
progress reads against the whole routine, and `StepContext.steps` stays the full
array so `describeContext` still shows the healer the routine.

**The variable bag is two sources, not one.** `vars` in `runRoutine` starts as
`{ ...params }` and accumulates extracts. A resume must seed **both**:

- the original **params**, from `runs.params` — `run_artifacts` holds only what
  `extract` steps produced (PRD 01 Story 3), and `RunResult.extracted` deliberately
  excludes params. A bag built from artifacts alone loses every `{{invoice_id}}`.
- the original **extracted values**, from `run_artifacts` rows of kind `extract`,
  keyed by the `into` name in `label`.

**An extract can be missing even from a run that reported success.** If step 4's
`extract` exhausted its repairs, `extractWithRepair` raises `NeedsHumanError` before
`runRoutine` reaches `vars[step.into] = found.text`, the outer catch holds for a
human and continues, and the run still ends `done` — AI_CONTEXT.md §8 lists this as a
live consequence. So a resume cannot assume a key exists because the source run
finished. The gate below treats a missing key as missing, whatever the source run's
status was.

**The repair budget is per-`runRoutine`-call, so a chain of resumes is unbounded.**
`new StepHealer(this.browser, this.claude, MAX_REPAIRS_PER_RUN)` is constructed
inside `runRoutine`, so each resume gets a fresh 6. Ten resumes of the same routine
can spend 60 repair calls. `resume.repairsUsed` — summed over `run_repairs` rows
across the `resumed_from_run_id` chain — is subtracted from `MAX_REPAIRS_PER_RUN`
when the healer is constructed. This changes what `MAX_REPAIRS_PER_RUN` means, from
per-run to per-chain, so **PRD 02's** repair-budget-exhaustion metric and its
consumed-of-total budget line must read the chain, not the row.

### The five gates

A resume is offered only when all five pass. Each failure is a refusal with the
reason named, not a warning the Operator can click through — except gate 1, which is
a forced choice, and gate 4, which offers a full re-run.

**Gate 1 — the indeterminate terminal step.** This is the hole an earlier draft of
this PRD had. `StepIndeterminateError` in
[extension-bridge.ts](../../src/main/automation/extension-bridge.ts) is raised when
the extension stopped answering a request: the step **may already have run**. It is
not a `StepExecutionError`, so `isHealable` in
[session.ts](../../src/main/automation/session.ts) rejects it, it propagates out of
`runWithRepair` and `runRoutine`'s catch ends the run `error` at that step. So the
most likely failed step in the whole product is precisely the one whose outcome is
unknown — and "default the resume point to the failed step, never past it" resumes
*at* it, which is the double-submit the rest of this PRD claims to respect.

When the source run's terminal error is a `StepIndeterminateError`, the default is
**refused**. The Operator is shown the step by number and description and must
choose:

- *"it did not run"* → start at N;
- *"it already ran"* → start at N+1.

Classification is by **error identity in main**, matching how PRD 01 classifies
`RunCancelledError` — so `runs` needs the terminal error's class, not just its
message. PRD 01's `runs.error` holds a message; this PRD adds nothing new for it
because PRD 01 already establishes identity-based classification in the writer, and
the required outcome is that the row records *indeterminate* distinctly. If PRD 01
ships without that, this gate needs a `runs.error_kind TEXT` column added to the
migration above. 🔵 **Open Question:** which of the two, decided when PRD 01's
writer is written.

**Gate 2 — a committing step inside the re-executed range.** `committing` cannot be
computed from the routine JSON. `isCommitting` lives in
[page-core.js](../../extension/page-core.js) — the shared in-page engine, not the
46-line `content.js` transport shim — and runs in the page against the element the
selector actually resolved to: it reads `el.form`, `el.tagName`, `el.type` and
`accessibleText(el)` against `COMMIT_WORDS`. Only one of its four branches —
`step.kind === 'type' && step.submit` — is visible statically. So "list the skipped
steps and ask the Operator to confirm" is a disclosure, not a safety control: the
`click` on *Place order* looks identical in JSON to the `click` on *Next*.

**Both backends already produce the verdict, and both must keep doing so.** Because
`page-core.js` is injected by the extension (before `content.js`) *and* by
`playwright-session.ts` (bundled `?raw`, injected per document), `StepOutput.committing`
comes back from `ExtensionSession.runStep` and `PlaywrightSession.runStep` alike. The
plumbing this PRD adds — `attempt.output.committing` into `report`, then
`run_events.committing` — is therefore backend-neutral, but any change to what counts
as committing must land in `page-core.js` to reach both. A guard edited in
`content.js` reaches neither backend and fails silently.

Two mechanisms, in order of strength:

1. **Persisted verdict, hard block.** The `run_events.committing` column above
   records the verdict the extension actually returned. Resume is **refused** —
   no override — when any step in the re-executed overlap `[N, last executed index]`
   carries `committing = 1` in the source run. Re-running a step the page told us
   commits something is not a decision to delegate to a confirm dialog. The offer
   is a full re-run or a start point past it.
2. **Static flag, shown not blocked.** Any `type` step with `submit: true` in the
   re-executed range is flagged in the confirmation UI even with no run data, since
   `isCommitting` returns true for it unconditionally.

Steps in the *skipped* range are not re-executed, so their verdicts do not gate
anything.

**Gate 3 — page state.** An earlier draft of this PRD ignored this completely, and
it is the gate most likely to bite. **Both backends pick their page at connect time,
by different rules, and the gate has to hold for both.**

| Backend | How `connect()` picks the page |
|---|---|
| extension | `ExtensionSession.connect` calls `bridge.start()`, which sends `{ type: 'start' }`; `handle` in [background.js](../../extension/background.js) resolves it with `chrome.tabs.query({ active: true, lastFocusedWindow: true })` and stores `targetTabId` — **whatever tab the Operator is focused on** |
| playwright (default) | `PlaywrightSession.connect` adopts or launches its dedicated-profile Chrome, then takes `context.pages().at(-1)` and calls `bringToFront()` — **whatever page that browser was left on**, which is wherever the *previous* run finished |

Steps 1–8 established a URL, a scroll position and a logged-in session; resuming at
step 9 aims step 9 at a page neither backend chose on the basis of that history. The
playwright case is not the safer one: a persistent profile means the browser is
reliably left somewhere plausible-looking, which is exactly what makes a wrong page
hard to notice.

The requirement, in order:

1. **Replay every `navigate` step in the skipped range `[0, N-1]`, in order, before
   step N**, with the restored bag so `{{param}}` substitution matches — `resolveStep`
   substitutes into `navigate.url`. A `navigate` is a URL load: idempotent in a way
   `click`, `type` and `select` are not, which is why it is the only kind replayed.
   Replayed steps emit their real absolute indexes with a `resumed` marker so the
   thread does not read as if step 3 ran twice for no reason.
2. **Then verify the URL.** Before step N executes, read the page's current URL and
   refuse if it does not match the last replayed `navigate.url`. `AutomationSession`
   has no cheap URL read; `snapshot()` returns `PageSnapshot.url` on both backends —
   the extension's `snapshot` handler takes it from `chrome.tabs.get` so it survives a
   failed `captureOrReason`, and `PlaywrightSession.snapshot` takes it from
   `page.url()` so it survives a screenshot timeout. Reusing `snapshot()` and
   discarding the DOM and screenshot costs one `filterDom` and one
   `optimizeScreenshot` per resume, which is acceptable once. The alternative — a
   `currentUrl()` method on `AutomationSession` — is cheaper per call but **now costs
   two real implementations**: `browser-session.ts` is deleted, and the second
   implementer is `playwright-session.ts`, the default backend, not a type-level
   stub nobody runs. 🔵 **Open Question:** which, decided in implementation — but the
   cheap-looking option is no longer cheap.
3. **State the session precondition.** If the routine's skipped range logged in, the
   resume assumes the browser is still logged in. Nothing verifies that; a logged-out
   session surfaces as a selector failure at step N. Out of scope (§8), stated in the
   confirmation UI.
4. **Say the tab constraint out loud — on the backend that has one.** `capture()` in
   [background.js](../../extension/background.js) throws unless the target tab is the
   active tab in its window, which AI_CONTEXT.md §9 calls the likeliest real-world
   step failure, so an extension-backend resume that adopts a background tab fails at
   its first `screenshot`. The playwright backend has no such rule —
   `page.screenshot` works on any page of its own browser — so the confirmation UI
   must key this warning off `AUTOMATION_BACKEND` rather than show it unconditionally.
   On the extension backend it tells the Operator to focus the tab they want
   automated before confirming, because that is literally what `{ type: 'start' }`
   will pick.

**Gate 4 — definition drift.** "Compare step count and kinds" passes the most common
drift there is: a changed `selector` or a changed `navigate.url` leaves both
identical. It also passes the two drifts most likely to be present:

- **the previous run's own repairs**, written back into the user's routine by the
  `kind === 'user' && result.repairs.length > 0` branch in
  [ipc.ts](../../src/main/ipc.ts) after the run returned — so the routine on disk is
  already not the one that ran;
- **a system routine replaced wholesale**, because `syncFromDir` in
  [system-routines.ts](../../src/main/db/system-routines.ts) deletes every row and
  re-inserts on each sync, and `watch` fires that from an `fs.watch` callback.

So: recompute `definitionHash` at resume time and compare to `runs.definition_hash`.
On a mismatch, diff the current steps against the source run's `run_repairs` rows. A
mismatch explained entirely by that run's own like-for-like repairs is shown as
*"your routine already learned this"* and the resume proceeds. Anything else refuses
the resume and offers a full re-run.

**Gate 5 — the variable bag.** Scan only the slots that actually substitute, or the
check will refuse valid resumes. `resolveStep` in
[shared/routines.ts](../../src/shared/routines.ts) — the single substitution site,
called by both `ExtensionSession.runStep` and `PlaywrightSession.runStep` —
substitutes into `navigate.url`, `type.text` and `select.value` and returns every
other kind untouched; `extract.selector` is resolved separately by `resolveTemplate`
in [orchestrator.ts](../../src/main/automation/orchestrator.ts). **Selectors are
deliberately not substituted** (AI_CONTEXT.md §6), so a literal `{{…}}` in a CSS
selector is valid authored content — a scan over `click.selector` or `type.selector`
would refuse a routine that is working exactly as designed.

The scan therefore covers four slots across steps `[N, end]`: `navigate.url`,
`type.text`, `select.value`, `extract.selector`. Every `{{name}}` in them must
resolve from the merged bag. A name that does not — including one whose `extract`
step is inside the skipped range but never assigned, per the held-extract case above
— refuses the resume and names the variable. The refusal is up front, because
`resolveStep` and `resolveTemplate` both substitute `''` for an unknown key: the run
would not notice.

### Save a chat run as a routine

**This half has shipped — verified 2026-08-27, and the PRD's own prescription is
what landed.** An earlier draft said the existing save path was reused unchanged;
that was false at the time, and PRD 01 fixed it exactly as this section asked:

| What this PRD asked for | What the code does now |
|---|---|
| the channel's payload becomes `{ runId, name }` | `IpcChannels.automationChatSave` in [ipc.ts](../../src/main/ipc.ts) takes `{ runId, name }`; the preload exposes `automation.chatSave(runId, name)` |
| the handler builds the definition from persisted steps, not the in-memory `Map` | it calls `deps.runs.get(runId)` and reads `RunDetail.recordedSteps`, persisted by `setRecordedSteps` from `RunObserver.recorded`. The `Map` is gone entirely |
| the "nothing was recorded" refusal moves with it | the handler throws `nothing was recorded for this run yet` |
| available from any chat thread, including after a restart | `ThreadView` renders *Save as an automation* on any `source: 'chat'` run, disabled while `recordedSteps` is empty |

So Story 3 is a **regression-test target, not a build item**. Its third scenario —
*clearing a chat session does not delete its thread* — is moot rather than satisfied:
`clearChatSession` and `automation:chat:clear` were deleted as dead code, so there is
no *Clear chat* left to reconcile with the thread, and §10's open question about it
is closed by deletion.

Per AI_CONTEXT.md §10's *Adding an IPC channel* recipe, the
new resume and re-run channels follow the same four steps —
[shared/ipc.ts](../../src/shared/ipc.ts) → a `handle(...)` in `registerIpcHandlers`
behind `trustSender`, shape-checking the payload there → a method on `api` in
[preload/index.ts](../../src/preload/index.ts) → the renderer. No new push channel is
needed: a resumed run is a run, so PRD 01's `runs:changed` and
`automation:progress` already carry it.

### AI_CONTEXT.md updates this change must make

Its §13 rule applies, in the same change, not a follow-up:

- **§5 symbol index** — `runRoutine`'s new `resume` argument; new exports
  `requiredParams` and `definitionHash` in `shared/routines.ts`.
- **§6 data contracts** — `AutomationProgressEvent` gains `committing?: boolean`
  (rule 2).
- **§7 budgets** — `MAX_REPAIRS_PER_RUN` becomes per-chain rather than per-run
  (rule 3).
- **§8 invariants** — two additions and one amendment (rule 4): *a resumed run
  emits absolute step indexes and never slices its step array*; *a step that
  reported `committing` is never re-executed by a resume*; and the existing "a
  timed-out step is indeterminate, not failed" invariant gains its resume clause,
  because this PRD is the first thing that can turn it into a retry.
- **§10 recipes** — no sequence changes; both the persistence and IPC recipes are
  followed as written.

---

## 6. Success Metrics

Every number below has a named mechanism or an honest statement that it has none.
All of them require PRD 01's `runs` table plus the columns in §5; none can be
measured before both ship.

### Primary

**Recoverable work** — share of failed runs that are resumed rather than restarted
or abandoned.
- Current: 0% (no mechanism)
- Measured: for each `runs` row with terminal status `error`, whether any later row
  has `resumed_from_run_id` = its id (resumed), else `rerun_of` = its id
  (restarted), else neither (abandoned). All three come from the two columns §5 adds
- Target: 🔵 **Open Question** — set after four weeks of PRD 01 data reveals how
  often runs fail partway.

### Secondary

- **Steps saved by resume** — `SUM(resume_start_index)` over `runs` where it is not
  null. This is why `resume_start_index` is a column rather than a derived value:
  without it the number has no mechanism at all, since the resume's own event stream
  looks identical to a run of a shorter routine.
- **Re-run rate** — `COUNT(rerun_of IS NOT NULL) ÷ COUNT(*)` over `runs`. A high
  number means the thread has become the natural home for running things.
- **Chat recordings lost to restart** — target zero, and **the loss itself cannot be
  measured**: a recording destroyed with the process leaves nothing behind to count.
  Proxy: chat runs saved as routines whose source run's `ended_at` precedes the
  current process start — every one of those is a save that would have been
  impossible before. Current value 0 by construction.

### Guardrails

- **No unsafe resumes.** Zero resumed runs that execute a step with an unresolved
  template variable. As previously written this was unobservable: `resolveStep` and
  `resolveTemplate` substitute `''` silently, so the failure leaves no trace.
  Two mechanisms make it observable. **Before:** gate 5's refusal is recorded — a
  refused resume still opens a `runs` row with `status = 'error'`,
  `resume_start_index` set and the gate name in `error`, so refusals are countable
  and the Operator can see why. **After:** PRD 01's `step_json` holds the
  **resolved** step, so an assertion over persisted `run_events` — any `{{` left in
  `navigate.url`, `type.text`, `select.value` or `extract.selector` — catches a gate
  that leaked. That assertion belongs in
  [tests/db.verify.ts](../../tests/db.verify.ts).
- **No resume re-executes a committing step.** Zero `run_events` rows where a
  resumed run executed an index that carries `committing = 1` in its
  `resumed_from_run_id` ancestor. Same shape of check, same file.
- **Re-run must not silently reuse stale params** where the routine's param set has
  changed since. Measured as refusals from the main-side `requiredParams` check,
  recorded the same way as a gate refusal.

### Epic hypothesis, and its threshold

We believe that making past runs actionable will convert failures into recoveries,
because today a run that dies at step 9 of 12 costs the same to finish as one that
never started.

The previous phrasing — "resumed runs materially outnumber full restarts" — had no
threshold and no way to tell a restart from an ordinary fresh run, since both are
just `runs` rows. `rerun_of` and `resumed_from_run_id` are what make the distinction
possible: a restart is a row whose `rerun_of` points at a run that ended `error`, a
fresh run is a row with neither column set. 🔶 **Assumption** for the threshold,
pending the first four weeks of data: **among routines that have failed at least
once, resumes outnumber restarts-of-a-failed-run by 2:1 within four weeks of
ship.**

---

## 7. User Stories & Requirements

### Story 1 — Re-run from a thread

**As** the Operator, **I want** to re-run a past run with its params pre-filled,
**so that** I do not retype inputs to repeat something.

```gherkin
Scenario: Re-running pre-fills the original params
  Given a completed run of "Invoice pull" with invoice_id = "INV-8842"
  When I choose Re-run from its thread
  Then the param form opens pre-filled with invoice_id = "INV-8842" from runs.params
  And editing it and confirming starts a new run
  And the new run's row has rerun_of set to the original run's id

Scenario: Re-running a routine whose params changed
  Given a past run whose routine has since gained a required param
  When I choose Re-run
  Then the new param is shown empty and marked required
  And confirming is refused by the main-process requiredParams check, not only by the renderer
```

### Story 2 — Resume from a step

**As** the Operator, **I want** to continue a failed run from where it stopped,
**so that** I do not repeat the steps that already worked.

```gherkin
Scenario: Resuming from the failed step
  Given a run of a 12-step routine that failed at step 9 with a determinate error
  When I choose Resume from its thread
  Then step 9 is offered as the resume point
  And the UI lists steps 1-8 as skipped, naming any type step with submit: true among them
  And confirming runs steps 9-12 only
  And run_events for the resumed run carry step indexes 9 through 12, not 0 through 3
  And the resumed run's row has resumed_from_run_id set and resume_start_index = 8

Scenario: Extracted variables and params are both restored before resuming
  Given the failed run was started with invoice_id = "INV-8842"
  And its step 4 extracted "total" = "142.50"
  And step 10 uses {{total}} and step 11 uses {{invoice_id}}
  When I resume from step 9
  Then the run begins with both total and invoice_id in scope
  And total comes from run_artifacts and invoice_id from runs.params

Scenario: Navigation is replayed so the page is where the skipped steps left it
  Given steps 1-8 include a navigate to https://example.test/invoices
  When I resume from step 9
  Then that navigate is replayed before step 9 executes
  And the replayed event carries step index 0-7 with a resumed marker
  And the resume is refused if the tab's URL afterwards is not that URL

Scenario: An unrestorable variable refuses the resume
  Given step 10 uses {{total}}
  And the original run failed before step 4 produced it
  When I attempt to resume from step 9
  Then the resume is refused
  And the message names "total" as the variable that cannot be restored

Scenario: A held extract leaves no value even though the run reported success
  Given the original run's step 4 extract exhausted its repairs and was held for a human
  And that run nonetheless ended assisted
  And step 10 uses {{total}}
  When I attempt to resume from step 9
  Then the resume is refused naming "total"
  And it is not offered on the grounds that the source run completed

Scenario: A literal template in a selector does not refuse the resume
  Given step 10 is a click whose selector contains the literal text {{value}}
  And no variable named value exists
  When I resume from step 9
  Then the resume proceeds, because selectors are never substituted
```

### Story 3 — Save a chat run after a restart

**As** the Author, **I want** to save a chat run as a routine at any time, **so
that** a restart cannot destroy work that already succeeded.

```gherkin
Scenario: Saving from a persisted chat thread
  Given a chat run that executed 9 steps and reached its goal
  When I quit and reopen the app
  And I open that run's thread and choose Save as routine
  Then I am prompted for a name
  And the save is addressed by runId, not by sessionId
  And a user routine is created containing all 9 recorded steps, read from run_events step_json
  And its description is the original goal

Scenario: A chat run with no successful steps cannot be saved
  Given a chat run whose every step failed
  When I open its thread
  Then Save as routine is unavailable
  And the reason given is that nothing was recorded

Scenario: A chat run's steps survive because the row is the only copy
  Given a chat run with a persisted thread
  When the app restarts
  Then runs.recorded_steps still holds its steps
  And the thread still offers Save as an automation
```

The scenario this replaces asserted that *clearing a chat session* left the thread
intact. `automation:chat:clear`, `clearChatSession` and the orchestrator's
`chatSessions` `Map` have since been deleted as dead code, so there is no in-memory
session to drop and no clear action to guard against — `runs.recorded_steps` is the
only copy there has ever been to lose. The first two scenarios above are satisfied by
the shipped code; they are regression tests, not build items.

### Story 4 — Resume refuses rather than guesses

**As** the Operator, **I want** resume to refuse when it cannot be sure, **so that**
it never double-submits on my behalf.

```gherkin
Scenario: An indeterminate terminal step forces an explicit choice
  Given a 12-step routine whose step 9 ended the run with a StepIndeterminateError
  When I choose Resume from its thread
  Then no default resume point is offered
  And I am shown step 9 by number and description
  And I must choose "step 9 did not run" to start at step 9, or "step 9 already ran" to start at step 10
  And the chosen start index is recorded in resume_start_index

Scenario: A committing step inside the re-executed range blocks the resume
  Given a run whose step 9 reported committing while placing an order
  And the run later failed at step 11
  When I attempt to resume from step 9
  Then the resume is refused with no override
  And the message names step 9 as a step the page reported as committing
  And a full re-run and a start point after step 9 are the only options offered

Scenario: A committing step in the skipped range does not block
  Given a run whose step 3 reported committing
  And the run failed at step 11
  When I resume from step 11
  Then the resume proceeds, because step 3 is not re-executed

Scenario: Definition drift beyond the run's own repairs refuses the resume
  Given the routine's definition_hash at run time differs from its hash now
  And the difference is not accounted for by that run's run_repairs rows
  When I attempt to resume
  Then the resume is refused
  And a full re-run is offered instead

Scenario: Drift caused by the run's own repair is not treated as drift
  Given the run repaired step 6's selector and the write-back changed the routine
  And that is the only difference from the recorded hash
  When I resume from step 9
  Then the resume proceeds
  And the UI states that the routine already learned that repair

Scenario: A busy orchestrator surfaces the same error the run button does
  Given a run is already in progress
  When I choose Resume or Re-run from a thread
  Then OrchestratorBusyError's message is surfaced unchanged
  And no runs row is opened for the attempt
```

### Constraints and edge cases

- Resume is offered only for routine runs. A chat run's next action is decided from
  the live page, so resuming one means re-stating the goal — which is a new run.
- Re-run and resume respect PRD 05's queue rather than failing with
  `OrchestratorBusyError` if that PRD has shipped; before it, they surface the same
  busy error the run button does. `busy` is a private field on
  `AutomationOrchestrator`, so the refusal stays where it is — the thread's actions
  do not get a second gate.
- 🔶 **Assumption:** presenting the skipped steps to the healer as already-succeeded
  is correct on a resume. `describeContext` in
  [step-healer.ts](../../src/main/automation/step-healer.ts) marks every index below
  the failing one `ok`, which on a resume asserts the skipped steps ran. That is the
  claim the resume is making anyway, so it is left as is — but it is an assertion the
  model will act on, not a display detail.
- A refused resume still leaves a record (§6), so a gate that fires too often is
  visible rather than invisible.

---

## 8. Out of Scope

- **Automatic resume on failure.** Retrying unattended is exactly the double-submit
  hazard the architecture refuses elsewhere. Resume stays a human decision.
- **Editing steps before resuming** — PRD 11.
- **Resuming a chat run** — see constraints; a chat goal restated is a new run.
- **Partial re-run of an arbitrary step range** (steps 4-7 only). Resume runs to
  the end. A range picker is speculative until someone asks.
- **Resume across an extension-version bump — an extension-backend concern only.**
  `ExtensionSession.connect` refuses a handshake whose version is not
  `EXTENSION_VERSION` (`1.10.0` today), and AI_CONTEXT.md §9 notes an extension
  change needs a full browser quit. A run recorded under an older extension offers no
  resume once the app expects a newer one: the recorded step semantics may not be the
  current ones. The default playwright backend has no handshake and no version skew —
  it injects `page-core.js` from the app's own bundle on every document, so the engine
  can never be a version behind the app. The thread says so on the extension backend;
  reconciling versions is not attempted here.
- **Resuming a `cancelled` or `interrupted` run.** Cancel is a deliberate stop, and
  `interrupted` means the app died mid-run, so neither run knows how far it got —
  `bridge.cancel()` fails pending requests without recording which step was in
  flight, and an interrupted row is closed at boot with no further information.
  Both offer a full re-run only. 🔵 **Open Question:** an `interrupted` run whose last
  event was a completed step arguably has a safe resume point; deferred until PRD 01's
  boot-closing behaviour is real enough to judge.
- **Verifying the login or session precondition.** The resume assumes the browser is
  still logged in from the skipped steps. Nothing checks it; a logged-out session
  shows up as a selector failure at the resume point. PRD 06's `assert` step is the
  mechanism a routine would use to check for itself.
- **Restoring scroll position, cookies, or any page state beyond URL.** Gate 3
  replays `navigate` steps and verifies the URL. Anything finer is a state-capture
  feature nobody has asked for.

---

## 9. Dependencies & Risks

### Dependencies

- **PRD 01**, entirely, and specifically these four rows of its §5 write-path table:
  `step_json` per step event (Story 3 builds a routine from it; gate 5's after-check
  reads it), **absolute step indexes always** (the whole resume loop), the failing
  step index on the terminal error event (the default resume point), and
  `onArtifact` (the extracted values gate 5 restores from). Without them this PRD has
  no data.
- **`run_artifacts` carrying extracted values keyed by name** — PRD 01 Story 3. Note
  it does **not** carry params: `runs.params` is the other half of the bag.
- **PRD 01's identity-based error classification** for gate 1, or a
  `runs.error_kind` column added here. §5 names the choice.
- **This PRD's own migration** for `rerun_of`, `resumed_from_run_id`,
  `resume_start_index`, `definition_hash` and `run_events.committing`. None of them
  is in PRD 01's schema, and PRD 01 has no use for them, so they are not pushed
  upstream.
- Benefits from **PRD 05** so a re-run queues rather than bouncing.
- **PRD 02** must be told that `MAX_REPAIRS_PER_RUN` becomes per-chain, or its
  budget line will read wrong for every resumed run.

### Risks

| Risk | Mitigation |
|---|---|
| **A resume re-runs a step that already ran.** The likeliest failure in the product is `StepIndeterminateError`, whose defining property is that the step may have run. Defaulting to "the failed step" resumes exactly there. | Gate 1: no default when the terminal error was indeterminate. An explicit two-way choice naming the step, recorded in `resume_start_index`. |
| **A resume re-submits an order.** `committing` is computed in the page against the resolved element, so a confirmation dialog listing steps cannot tell the Operator which click commits. | Gate 2: persist the verdict in `run_events.committing` and hard-block a resume that would re-execute a step previously reported committing. Static `type.submit` flagging as a second, weaker layer. |
| **A resume runs against the wrong page.** `{ type: 'start' }` adopts the currently active tab of the last focused window, so step 9 aims at whatever is focused now. | Gate 3: replay the `navigate` steps in the skipped range, verify the resulting URL, and tell the Operator to focus the intended tab first — `capture()` also requires it to be the visible tab in its window. |
| **A resumed loop corrupts the routine.** `applyRepairs` writes `steps[repair.stepIndex]`; a loop over a slice re-indexes and the write-back overwrites the wrong step, silently, because only the kind is checked. | Iterate the full array and `continue` past skipped indexes. Never `slice`. This is the guarantee PRD 01 §5 exists to give, and a test asserts the repaired index. |
| **Silent empty substitution.** `resolveStep` and `resolveTemplate` replace an unknown variable with `''`, so a bad resume produces a plausible-looking wrong action rather than an error. | Gate 5: refuse up front, scoped to the four slots that actually substitute so valid selectors containing `{{…}}` are not refused. Plus the persisted-`step_json` assertion in §6. |
| **Routine drift between the original run and the resume**, including drift the previous run itself wrote back, and system routines replaced wholesale by `syncFromDir`. | Gate 4: `definition_hash` over canonicalised steps, reconciled against the run's own `run_repairs`. Step count and kinds are not enough. |
| **Unbounded repair spend across a chain of resumes.** `MAX_REPAIRS_PER_RUN` is constructed per `runRoutine` call. | Carry `repairsUsed` forward from the chain and subtract it. Surface it in PRD 02's budget line. |
| **Re-run chains obscure which run is authoritative.** | Link runs explicitly via `rerun_of` / `resumed_from_run_id`, `ON DELETE SET NULL` so a prune does not orphan the chain, and show the chain in the thread. |
| **The gates make resume unusable.** Five refusal conditions on a feature whose point is one-click recovery. | Every refusal is recorded (§6), so an over-firing gate is measurable within days rather than inferred from complaints. Gate 2 is the only one with no override. |

---

## 10. Open Questions

- 🔵 How often do runs fail partway rather than at step 1? Determines whether
  resume-from-step is the headline of this PRD or a minor addition.
- 🔵 How often is the terminal error indeterminate? If it is the common case, gate 1
  is the feature's main interaction rather than an edge case, and the two-way choice
  needs real design.
- 🔵 Should resume be offered for runs that ended `assisted` as well as ones that
  errored? Likely yes — a step a human did by hand is precisely the resume case, and
  `runRoutine` already continues past it. The complication is that `assisted` runs
  reach the end of the routine, so the resume point is not obvious.
- 🔵 Gate 3's URL read: reuse `snapshot()` and discard most of it, or add
  `currentUrl()` to `AutomationSession` and therefore to **both** live backends,
  `extension-session.ts` and the default `playwright-session.ts`? The old draft
  weighed this against `browser-session.ts`, which is deleted; the second
  implementation is now real work on the backend most users run.
- 🔵 Does gate 1's classification come from PRD 01's writer or from a
  `runs.error_kind` column added here?
- ~~Should *Clear chat* delete the persisted thread as well as the in-memory
  session?~~ **Closed 2026-08-27:** `automation:chat:clear`, `clearChatSession` and
  the `chatSessions` `Map` were deleted as dead code. There is no in-memory session
  and no *Clear chat*; deleting a run is PRD 01's `runs:delete` and nothing else.
- 🔶 **Assumption:** re-run with edited params is more common than exact repeat.
  Drives whether the param form opens editable (assumed) or confirms immediately.
- 🔶 **Assumption:** Authors will save chat runs from a thread rather than at the
  end of a run. If not, the fix is a prompt at the end of a successful chat run,
  which this PRD does not add.

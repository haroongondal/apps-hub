# PRD 02 — Run cost & budget meter

| | |
|---|---|
| **Phase** | Foundation |
| **Depends on** | PRD 01 — hard. Writes into the `runs` row it creates, extends its orchestrator callback set, and reads its `assisted` / `human_steps` additions |
| **Blocks** | Nothing |
| **Status** | Built, as the cost half of run telemetry — see below |
| **Author** | hmukhtar@outsentia.com |

> **Amendment pending — the goal-loop thread redesign landed first.**
> [2026-08-22-goal-loop-conversation-thread-design.md](../superpowers/specs/2026-08-22-goal-loop-conversation-thread-design.md)
> shipped, and falsifies three premises below: `tool_choice` no longer stays
> pinned (forcing it silently disables thinking on Sonnet 5), the prompts and both
> tool schemas do change, and a chat run's cost is no longer flat per iteration —
> it grows with thread length. `cached_input_tokens` survives, but message-level
> caching is forfeit on any step that prunes an image, so it will legitimately read
> zero on many chat steps. Migration numbering, verified against `MIGRATIONS` on
> 2026-08-27: PRD 01's entry is index 1 (`user_version` 2), so the next free index
> is 2 (`user_version` 3), and the ordinals below are corrected to match.

> **Built, and widened on the way in.** Cost landed as one part of a run-telemetry
> substrate rather than as its own feature, so the `runs` row carries the spend and a
> new `run_steps` row carries the per-step measurement beside it. Three departures
> from what is specified below, each deliberate: the meter is **not** injected into
> `ClaudeAutomationClient` (it is built once at boot and outlives every run, so
> `repairStep` returns its usage instead, mirroring `nextAction`); there are **four**
> token counters rather than three, because `cache_creation_input_tokens` is priced
> apart from both the other families; and the run-level timing columns this PRD
> implied were dropped as derivable by summing `run_steps`. Everything §5 says about
> `repair_calls` versus `repair_budget_spent` survives intact and is pinned by a test.

Shared personas and strategic context: [README.md](README.md). How a run ends —
including the two different things called a hold — is stated once there and is not
restated here.

---

## 1. Executive Summary

We're building a **per-run cost and budget meter** for **the Operator and the
Author** to solve the problem that the product's strongest economic claim — a
healthy routine run costs nothing in model calls — is true but invisible, which
will make model spend legible per run and per routine and turn an architectural
property into something a user can actually see.

Small feature, but not a free one. It is one instrumentation point in
`claude-client.ts`, a per-run accumulator the orchestrator owns, a third
orchestrator callback alongside PRD 01's two, **seven columns** added to the `runs`
row by a **separate migration**, one panel, and one new read channel.

---

## 2. Problem Statement

### Who has this problem?

The Operator, who cannot tell a cheap run from an expensive one. The Author, who
cannot tell whether a routine is drifting until it is failing.

### What is the problem?

Model usage is bounded but never counted.

- Budgets exist as module-level constants in
  [orchestrator.ts](../../src/main/automation/orchestrator.ts) — `MAX_CHAT_STEPS`
  100, `MAX_CHAT_FAILURES` 6, `MAX_ATTEMPTS_PER_STEP` 3, `MAX_REPAIRS_PER_RUN` 6 —
  and `StepHealer` in
  [step-healer.ts](../../src/main/automation/step-healer.ts) decrements its share
  of that budget privately inside `plan`. None of it reaches the user.
- **Model calls no longer funnel through one method, and that doubles the
  instrumentation.** `callTool` in
  [claude-client.ts](../../src/main/automation/claude-client.ts) now serves
  `repairStep` only: it holds the whole API response and reads only
  `response.content`, discarding `response.usage`. The chat path is `nextAction`,
  which calls `messages.create` itself and **already returns `response.usage` on
  its `ThreadTurn`**. So the meter has two attachment points, not one — and the
  chat half is already carrying the number it needs.
- Nothing anywhere records how many calls a run made. `AutomationProgressEvent`
  ([types.ts](../../src/shared/types.ts)) has no usage fields, and `runChatGoal`
  returns `void`, so a chat run has no return channel either.

### Why is it painful?

- **User impact.** A chat run costs one model call per loop iteration, up to 100; a
  routine run costs zero unless it heals. Those are wildly different, and both look
  identical in the UI. 🔶 **Assumption:** an Operator who cannot see cost will
  either avoid chat runs out of caution or use them without noticing the bill —
  both bad, neither validated.
- **Business impact.** "A healthy routine run costs nothing" is the sharpest
  argument the architecture makes ([HOW-IT-WORKS.md](../../HOW-IT-WORKS.md) §10).
  It is currently unprovable in the product.

### Evidence

- **Code.** The two-chokepoint structure above, verified against `callTool`,
  `nextAction` and `repairStep`.
- **Structural.** A routine run makes zero model calls unless a step fails — the
  only model call on the routine path is `StepHealer.plan` → `repairStep`. A chat
  run makes exactly one `nextAction` call per iteration of `runChatGoal`'s
  loop. Both facts are enforced in the orchestrator and neither is surfaced
  anywhere.
- 🔵 **Open Question:** what does a typical run actually cost? Unknown — no run has
  ever been measured.

---

## 3. Target Users & Personas

**Primary: The Operator** — wants to know what a run cost, in the same place they
learn what it did.

**Secondary: The Author** — wants rising repair counts as an early warning that a
routine is drifting before it starts failing outright.

**Job-to-be-done:** *When I run an automation, I want to see what it cost me, so I
can choose between a routine and a chat goal on more than instinct.*

---

## 4. Strategic Context

**Ladders up to:** trust in unattended runs — cost predictability is part of
trusting something you are not watching.

**Why now.** It is cheap once PRD 01 exists: the `runs` row is already being
written, the thread view already has a header to put a line in, and `callTool` is
already a single funnel. It also gives PRD 07 (schedules) a number to reason about
before anything runs unattended on a timer.

**What "same pass" does and does not buy.** Landing this immediately after PRD 01
saves a second pass over the same renderer view, and lets the `RunObserver`
seam PRD 01 already opened carry this PRD's fourth member in one edit.
It does **not** save a migration: PRD 01 owns `MIGRATIONS` index 1, and a shipped
migration entry is never edited (AI_CONTEXT.md §10). This PRD appends the next
unused entry.

---

## 5. Solution Overview

### Instrumentation

`callTool` records usage where the response is already in hand. It gains a `meter`
parameter and calls `meter.record(tool.name, response.usage)` immediately before
narrowing `response.content` to the tool-use block. `tool.name` is already the
purpose discriminator — `decide_next_action` or `repair_step` — so no second
argument is needed to separate decision cost from repair cost.

`repairStep` gains the same `meter` parameter and forwards it. `nextAction` does
not go through `callTool` at all, so it needs its own `meter.record('nextAction',
turn.usage)` — **a meter wired only into `callTool` counts repairs and reports a
chat run as free.** `tool_choice` stays pinned to a single tool on the repair path;
nothing about the prompts or the two tool schemas changes (AI_CONTEXT.md §10,
*changing model behaviour*).

**The accumulator is per run, and must not live on the client.**
`ClaudeAutomationClient` is constructed once at boot in
[index.ts](../../src/main/index.ts) and lives for the life of the app, so any
counter held there accumulates across every run until quit. A new
`src/main/automation/run-meter.ts` exports a `RunMeter` class, constructed inside
`runRoutine` and `runChatGoal` beside `vars` and the `StepHealer`, so its lifetime
is the run by construction rather than by a reset call somebody must remember to
make.

`RunMeter` holds:

| Counter | Incremented by |
|---|---|
| `llmCalls` | every `record` |
| `repairCalls` | `record('repair_step', …)` |
| `repairBudgetSpent` | `StepHealer.plan`, at the point it decrements its budget |
| `inputTokens`, `cachedInputTokens`, `outputTokens` | `record`, when usage is present |

`StepHealer` takes the meter in its constructor — it needs it both to forward to
`repairStep` and to report budget spend, which is not the same number as calls
(below).

### Write path

This is the part the first draft of this PRD left out entirely: it named the source
of the numbers and never said how they reach the `runs` row.

**PRD 01's observer gains a fourth member.** PRD 01 landed as `RunObserver` in
[types.ts](../../src/shared/types.ts) — `progress` plus the optional
`artifact(runId, artifact)`, `repair(runId, repair)` and
`recorded(runId, steps)` — because `AutomationProgressEvent` cannot carry that
data. Usage is the same shape of problem and takes the same shape of answer:

| Change | Where | Why |
|---|---|---|
| optional `usage(runId, totals)` on `RunObserver` | `runRoutine`, `runChatGoal` | the transport for every counter above |
| fire it after each step / each chat iteration | both loops | a live run's header updates as it goes |
| fire it once more in the existing `finally` block | both loops | the error, cancel and `assisted` paths all exit through `finally`, so this is the only placement that cannot lose the numbers |
| `RunUsage` type | [types.ts](../../src/shared/types.ts) | crosses IPC on PRD 01's `runs:get` |

`RunStore` handles `usage` as an `UPDATE runs SET … WHERE id = ?` with last-write-wins
semantics. **It must not require the row to be open.** PRD 01's store opens the row on
the first event and closes it on a terminal status, and the `finally` fire lands
*after* that terminal event — so a usage write that only touched open rows would
silently drop the final totals of every run.

**Rejected alternative: an optional `usage` field on `AutomationProgressEvent`.**
That is the smaller diff and it was the obvious first answer, but it widens a type
in AI_CONTEXT.md §6 that five other PRDs read, puts token counts on the
broadcast-to-every-window path for the benefit of one panel, and gives the store no
way to write totals on the throw path — `runRoutine`'s catch emits one event and
then rethrows. The observer member keeps the change inside the seam PRD 01 already
opened.

Live updates need no new push channel: PRD 01's `runs:changed` already fires,
exposed on the preload as `api.runs.onChanged(listener): () => void` and consumed
by `useRuns` in [state/useRuns.ts](../../src/renderer/src/state/useRuns.ts), and the
thread header re-reads on it.

### Storage

**The next unused `MIGRATIONS` entry**, appended to the array in
[database.ts](../../src/main/db/database.ts). `MIGRATIONS` is zero-indexed and
holds two entries today: index 0 (`system_routines`, `user_routines`) and PRD 01's
index 1 (`runs`, `run_events`, `run_artifacts`, `run_repairs`), which is shipped by
the time this lands and so is not edited. The concrete index depends on build order
— several unbuilt PRDs each want the next one — so this PRD names the position
rather than an ordinal. `PRAGMA user_version` is the cursor and the existing
`applyMigrations` loop needs no change.

Seven `ALTER TABLE runs ADD COLUMN` statements. This is legal on a `STRICT` table
as long as each added column declares an allowed type and any default is a
constant, which all seven do — verified against SQLite directly, not assumed.

| Column | Type | Holds |
|---|---|---|
| `llm_calls` | `INTEGER NOT NULL DEFAULT 0` | every model call the run made |
| `repair_calls` | `INTEGER NOT NULL DEFAULT 0` | the `repair_step` subset; decision calls are the difference |
| `repair_budget_spent` | `INTEGER NOT NULL DEFAULT 0` | budget consumed out of `MAX_REPAIRS_PER_RUN` |
| `input_tokens` | `INTEGER NOT NULL DEFAULT 0` | uncached input only |
| `cached_input_tokens` | `INTEGER NOT NULL DEFAULT 0` | `cache_read_input_tokens`, which the API reports *separately* from `input_tokens` |
| `output_tokens` | `INTEGER NOT NULL DEFAULT 0` | |
| `model` | `TEXT` | the requested model id, so a stored price can be matched to the run that used it |

**`repair_calls` is not the repair budget.** `StepHealer.plan` decrements its
budget *before* it does any work, then returns `giveUp` if either
`browser.snapshot()` or `claude.repairStep()` throws — a missing API key, a rate
limit or a dead socket all spend budget without producing a model call. A call
count therefore cannot render "2 of 6 budget used", which is what the first draft
of this PRD asked it to do. Both numbers are stored: the budget line reads
`repair_budget_spent`, the cost line reads `repair_calls`, and a gap between them
is itself a signal worth showing.

**Input tokens are two numbers, not one.** The SDK's `Usage` reports
`input_tokens` (uncached), `cache_creation_input_tokens` and
`cache_read_input_tokens` as separate fields whose sum is the request's true input.
`callTool` sets no `cache_control` today, so 🔶 **Assumption:** the cached fields
are always zero or null in current runs — the column exists so that adding prompt
caching later cannot make `input_tokens` silently under-report. The money figure
prices `input_tokens` and `cached_input_tokens` at their own rates and never sums
them into one.

### Pricing

Pricing has no home in the codebase today: `MIGRATIONS` holds no
settings table, there is no settings file or store, and
[env-file.ts](../../src/main/lib/env-file.ts) reads a `.env` whose only documented
variable is `AI_GATEWAY_API_KEY`. Rather than cut the money figure or invent a
store, **price is environment configuration**, following the one precedent that
exists:

- `AI_PRICE_INPUT_USD_PER_MTOK`, `AI_PRICE_CACHED_INPUT_USD_PER_MTOK`,
  `AI_PRICE_OUTPUT_USD_PER_MTOK`, added to `.env.example`.
- `loadEnvFile` reads them in dev; packaged builds read the real environment, and
  an exported shell value wins — the same rules as the API key.
- Any of the three unset means **no money figure at all**, not a partial one and
  never a guessed one.

**A price table keys on the gateway id, not Anthropic's.** `MODEL` in
`claude-client.ts` is `anthropic/claude-sonnet-5` — the gateway rejects a bare
Anthropic model id, so the provider prefix is part of the identifier a price is
configured against. Calls also go to Vercel AI Gateway (`GATEWAY_BASE_URL`), whose
rates are not necessarily Anthropic's first-party rates, which is a second reason
not to hard-code a number. The `model` column stores the requested `MODEL`
constant; 🔵 **Open Question:** whether `response.model` comes back prefixed or
bare through the gateway, which decides whether the stored id and a future
`response.model` can be compared at all.

**Accepted limitation.** An env var is not user-editable from the UI, so the
Operator cannot set a price without editing a file. A user-editable price means a
settings table in a further `MIGRATIONS` entry, a store, and its own IPC channels —
more machinery than this feature is worth. Tracked in §10.

### Display

A cost line in the thread header:

> *3 model calls (1 decision · 2 repairs) · 12.4k in / 0.6k out · repair budget 2 of 6 spent*

A clean routine run says so in words rather than showing zeroes: *no model calls —
this run needed nothing from the model.* That sentence is the whole point of the
feature. Where the three price variables are set, a currency estimate follows the
token counts; where they are not, tokens only.

### Read path — per-routine aggregate

Story 3 needs a number that spans runs, and PRD 01 shipped only `runs:list`,
`runs:get`, `runs:artifact`, `runs:delete` and `runs:purge`. This PRD adds one **invoke** channel,
`runs:costSummary`, taking `{ kind, id, limit }` and returning average calls per
run, total tokens, and the count of runs that spent any repair budget across that
window. Per the AI_CONTEXT.md §10 recipe, that is four places:

1. `runs:costSummary` in `IpcChannels` — [shared/ipc.ts](../../src/shared/ipc.ts)
2. a `handle(...)` in `registerIpcHandlers` behind the existing `trustSender`
   allowlist — [main/ipc.ts](../../src/main/ipc.ts) — shape-checking the payload
   there
3. a method on `api` — [preload/index.ts](../../src/preload/index.ts)
4. the renderer

It is an invoke channel, so it gets **no** `on…Changed(listener): () => void`
unsubscriber; that recipe clause applies to push channels, and refreshing after a
run rides PRD 01's existing `runs:changed`.

🔶 **Assumption:** the summary belongs on the routine, next to its run button.
**The surface Story 3 needs still does not exist**, verified 2026-08-27: the React
renderer's `AutomationRail`
([components/AutomationRail.tsx](../../src/renderer/src/components/AutomationRail.tsx))
builds each row as an `AutomationRow` that expands only into a param form, and
there is no routine detail view anywhere. The rewrite changed the technology, not
the information architecture. So Story 3 still needs somewhere to put the number —
either that expanded row or the detail view PRD 11 eventually builds — and if
neither is in scope when this ships, Story 3 ships with PRD 11 and Stories 1 and 2
ship alone.

---

## 6. Success Metrics

**Read every "measured" below with one caveat: nothing leaves the device.** This is
a single-user desktop app with no telemetry egress — the counters live in SQLite
under `userData`, which is also the privacy property the feature depends on. So
every mechanism named here is a query someone runs against their own database, or
an assertion in the test suite. There is no aggregate across users, and this PRD
does not add one.

### Primary

**Model spend per completed run, split by source.** Not "did the feature ship" —
the number the feature exists to produce.

- Mechanism: a SQL aggregate over the `runs` table —
  `SELECT source, COUNT(*), AVG(llm_calls), AVG(input_tokens + cached_input_tokens), AVG(output_tokens) FROM runs WHERE status IN ('done', 'assisted') GROUP BY source`.
  Uses PRD 01's terminal statuses, so `assisted` runs are counted as completed and
  `error` / `cancelled` / `interrupted` runs are excluded from the average.
- Current: unmeasurable — no run has ever been counted.
- Target: none set. 🔵 **Open Question:** the first four weeks of data *are* the
  target-setting exercise; a target chosen now would be invented.

### Secondary

- **Repair-budget exhaustion rate** — routine runs that spent all 6, over routine
  runs. Mechanism: `COUNT(*) WHERE repair_budget_spent = 6` ÷ routine-source rows.
  Measurable precisely *because* spend is stored separately from calls; a call
  count would undercount every run whose repair attempt died before reaching the
  API. 🔵 **Open Question:** no baseline. A high rate means the budget or the
  routines need attention.
- **Cost of a hold** — average `repair_calls` on runs ending `assisted` versus
  `done`. Mechanism: the same aggregate grouped by `status`, using PRD 01's
  `human_steps`. This is the number that says whether human involvement is
  expensive in model calls as well as in attention.
- **Chat-vs-routine mix.** 🔶 **Assumption:** making cost visible shifts usage
  toward saved routines. This one genuinely **cannot be measured as stated** —
  there is no pre-ship baseline, because no run before this feature was counted.
  Proxy: the ratio's trend across the first weeks after ship, with the ship date as
  the only available cut point, treated as a direction rather than a result.

### Guardrails

- **The counters are complete.** Mechanism: a case in
  [tests/orchestrator.test.ts](../../tests/orchestrator.test.ts), whose existing
  harness already stubs `ClaudeAutomationClient` — assert that the stub's
  invocation count equals the meter's `llmCalls` for a chat run, a healed routine
  run and a run that gives up. Verified by test, not by production telemetry, and
  the PRD should say so rather than imply a dashboard.
- **No added latency, and never a second request.** Reading `usage` off a response
  already in hand is free. The instrumentation must not call
  `messages.countTokens` or issue any other request — asserted by the same stub
  counting one `messages.create` per decision.
- **Accuracy over completeness.** A response with no usage records the call and no
  tokens. Never an estimate.

---

## 7. User Stories & Requirements

### Epic hypothesis

We believe that surfacing per-run model cost will let users choose deliberately
between routine and chat runs, because the two differ by more than an order of
magnitude in spend and are currently indistinguishable in the UI.

### Story 1 — A run reports what it cost

**As** the Operator, **I want** each run's model usage recorded, **so that** I can
see what it cost in the same place I see what it did.

```gherkin
Scenario: A chat run costs one call per loop iteration
  Given a chat run that executes 7 steps and then decides "done"
  When the run completes
  Then the runs row records llm_calls = 8
  And input_tokens and output_tokens are the sum across all 8 calls
  And the thread header shows the call and token counts

Scenario: A retried chat iteration still costs a call
  Given a chat run whose 3rd step fails healably
  When the loop re-decides from a fresh snapshot
  Then that iteration is counted as a model call
  And the header's call count exceeds the number of steps the run executed

Scenario: A clean routine run records zero cost
  Given a routine of 6 steps where every step succeeds first time
  When the run completes
  Then the runs row records llm_calls = 0 and repair_budget_spent = 0
  And the thread header states that the run needed nothing from the model

Scenario: Usage missing from a response is not guessed
  Given a gateway response that carries no usage block
  When the call completes
  Then llm_calls increments
  And no token counts are recorded for that call
```

🔶 **Assumption** behind the last scenario: the SDK types `usage` as required on a
`Message`, so this guard exists for a gateway that diverges from the shape the SDK
declares — it is a runtime check TypeScript will say is unnecessary. Whether it is
reachable is §10's first open question.

### Story 2 — Repairs are counted separately

**As** the Author, **I want** repair calls counted apart from decision calls,
**so that** I can see a routine getting more expensive as it drifts.

```gherkin
Scenario: A healed routine run separates repair cost
  Given a routine run where 2 steps require repair and both repairs succeed
  When the run completes
  Then repair_calls = 2 and repair_budget_spent = 2 and llm_calls = 2
  And the thread shows "repair budget 2 of 6 spent"

Scenario: Budget spent without a model call is still shown as spent
  Given a routine run where the snapshot for a repair attempt throws
  When the healer gives up on that attempt
  Then repair_budget_spent increments
  And repair_calls does not
  And the thread shows the budget line and the call line disagreeing

Scenario: An exhausted repair budget hands the step to a human and the run continues
  Given a routine of 8 steps that has spent all 6 repairs by step 5
  When step 5 exhausts its attempts
  Then the healer returns giveUp, the run reports "Step 5 needs you" and parks on holdForHuman
  And on Resume the run continues at step 6 rather than ending
  And the run's terminal status is 'assisted' with human_steps >= 1
  And the thread shows repair budget 6 of 6 spent, attributed to step 5
```

The last scenario replaces one that asserted the run *stopped* when its repair
budget was spent. It never did: `StepHealer.plan` returns `giveUp`,
`runWithRepair` raises `NeedsHumanError`, and `runRoutine`'s catch parks on
`holdForHuman` and then continues to the next step — deliberately, for the reason
[README.md](README.md) gives. What the meter must make legible is therefore not a
stop but a **handoff**: budget spent, step attributed, run finished with help.

### Story 3 — Cost per routine over time

**As** the Author, **I want** a routine's recent runs summarised, **so that** I
can spot one getting more expensive.

```gherkin
Scenario: A routine shows its recent cost trend
  Given a routine with 10 recorded runs
  When I open that routine
  Then runs:costSummary returns its average model calls per run across those 10
  And the count of runs in that window that spent any repair budget
  And the figure refreshes when a new run of that routine completes
```

### Constraints and edge cases

- **The meter's lifetime is the run.** Constructed in `runRoutine` /
  `runChatGoal`, never on the app-lifetime `ClaudeAutomationClient`. A run that
  starts after another finished must begin at zero without anyone calling a reset.
- A run that fails partway records the calls it made before failing; the `finally`
  fire is what guarantees it.
- Cancelled runs record cost up to the cancellation, by the same mechanism.
- A **scan hold** costs nothing on either backend: `ExtensionSession.dispatch` and
  `PlaywrightSession`'s `scanHold` both retry the step locally, up to
  `MAX_HELD_RETRIES`, with no model call involved. Only a layer-3 hold has a model
  call behind it — the `giveUp` that caused it.
- `MAX_REPAIRS_PER_RUN` is one budget shared by `runWithRepair` and
  `extractWithRepair` through a single `StepHealer` per run, so a failing extract
  and a failing click draw down the same 6.
- Token counts must never leave the machine; they are local telemetry written to
  `userData` alongside PRD 01's artifacts.

---

## 8. Out of Scope

- **Spend limits or hard cost caps.** Reporting only. Enforcement would need a
  policy design and a decision about what happens mid-run when a cap is hit.
- **A user-editable price, and a settings table to hold it.** Price is an env var
  this release; the table is §10's question, not this PRD's work.
- **A multi-model price table.** `MODEL` is a single constant today; the `model`
  column exists so a table is possible later, not so one ships now.
- **Prompt-caching accounting** beyond storing the cached-token column. `callTool`
  sets no `cache_control`, so there is nothing to attribute yet.
- **Cross-run billing reconciliation** against a provider invoice.
- **Per-user or per-tenant accounting** — the app is single-user today.
- **Prompt-level token attribution** (which prompt section cost what). Interesting
  for optimising `TokenOptimizer`, out of scope for a user-facing meter.

---

## 9. Dependencies & Risks

### Dependencies

- **PRD 01, hard.** Specifically: the `runs` table and its `RunStore`; the
  `RunObserver` seam this PRD adds a fourth member to; the
  `runs:changed` push channel; the `assisted` status and `human_steps`, which
  Story 2 and the hold metric both read; and the thread header
  ([components/ThreadView.tsx](../../src/renderer/src/components/ThreadView.tsx))
  this PRD writes into. All of it has landed.
- **The next unused `MIGRATIONS` entry**, appended after PRD 01's index 1. Not
  "the same migration" — a shipped entry is never edited.
- Pricing config is optional; absent it, the feature shows tokens only.

### Documents this change makes stale

Per AI_CONTEXT.md §13, these are updated **in the same change**, not afterwards:

- **§2 (environment)** — "One variable: `AI_GATEWAY_API_KEY`" becomes four if the
  price variables land.
- **§4 (file map)** — `src/main/automation/run-meter.ts`.
- **§5 (symbol index)** — `RunMeter`; and the changed signatures of `callTool`,
  `nextAction`, `repairStep` and `StepHealer`'s constructor.
- **§6 (data contracts)** — the new `RunUsage` type crossing IPC, `RunObserver`'s
  new `usage` member, and `runs:costSummary` in `IpcChannels`.
- **§7 (budgets)** — unchanged. This PRD reports budgets; it does not move one.
- **[IMPLEMENTATION-ORDER.md](../IMPLEMENTATION-ORDER.md)** says this PRD is
  "three columns on the table 01 just created". It is seven, plus a callback and a
  channel. That line is the bug, not this section — [README.md](README.md)'s table
  remains the one authority on dependencies.

### Risks

| Risk | Mitigation |
|---|---|
| **Gateway usage shape differs from the SDK's.** Calls go to Vercel AI Gateway via `GATEWAY_BASE_URL`, not to Anthropic directly, and the SDK's types describe Anthropic's response, not a proxy's. | Treat usage as optional at runtime even though the type says otherwise. Count calls unconditionally; record tokens only when present. Confirm against a real gateway response before the display is built. |
| **A counter that outlives its run.** The client is an app-lifetime singleton; a counter placed on it would silently accumulate across runs and every cost figure after the first would be wrong. | `RunMeter` is constructed per run in both loops. Guarded by the orchestrator test that runs two runs against one client and asserts the second starts at zero. |
| **`repair_calls` read as budget.** The two diverge whenever a repair attempt dies before the API call, and a "2 of 6" line built on calls would under-report. | Store both; the budget line reads `repair_budget_spent`. |
| **Stale hard-coded prices** shown as fact. | Price is configuration keyed to a model id, never a constant. Unset means no money figure. |
| **Cost display implies a cost the user is not actually paying** (own key, own gateway). | Frame as usage first, money second. |
| **Usage totals lost on the throw path.** `runRoutine`'s catch emits one event and rethrows; a store write bound to the open row would drop the totals of every failed run. | Fire `onUsage` from `finally`, and make the store's write an update by `runId` that does not care whether the row is still open. |

---

## 10. Open Questions

- 🔵 Does the gateway's `/v1/messages` response include a usage block, in
  Anthropic's shape, and does it populate the cache fields? Must be confirmed
  before the display is designed. Still the largest unknown in the PRD.
- 🔵 Does `response.model` come back gateway-prefixed (`anthropic/claude-sonnet-5`)
  or bare? Decides whether a stored model id and a served model id are comparable.
- 🔵 Should a user-editable price justify a settings table — its own `MIGRATIONS` entry, a store, a
  channel pair — or is an env var the right ceiling for a single-user desktop app?
  Revisit if anyone asks for the money figure and cannot set it.
- 🔵 Which surfaces carry cost: the thread header (yes, Story 1), the routine row
  (yes, Story 3), and the Runs rail row (undecided — leaning against, to keep the
  rail scannable). The first draft of this PRD said "thread-only" while Story 3
  asked for a per-routine aggregate; these are three different surfaces and only
  the rail is actually in question.
- 🔶 **Assumption:** users care about token counts, not just call counts.
  Unvalidated — call counts alone may be the more legible number, in which case
  tokens become a detail view and the money figure the headline.

# PRD 03 — Repair review queue

| | |
|---|---|
| **Phase** | Foundation |
| **Depends on** | PRD 01 (thread view, `run_repairs`, `onRepair`, `onArtifact`) |
| **Blocks** | 09, 11, 13 |
| **Status** | Draft |
| **Author** | hmukhtar@outsentia.com |

Shared personas and strategic context: [README.md](README.md). Its dependency table is
the authority for the row above.

---

## 1. Executive Summary

We're building a **repair review queue with routine revision history** for **the Author**
to solve the problem that an LLM-proposed selector currently overwrites their saved
routine automatically, with no review, no history and no undo, which will
turn self-healing from an irreversible mutation into a proposal the Author accepts
or rejects — and make it safe to leave routines running unattended.

This is the one PRD in the set that closes an existing data-loss risk rather than
adding capability.

---

## 2. Problem Statement

### Who has this problem?

The Author, on every run of a routine that heals like-for-like. Silently, so they
may not know they have it.

### What is the problem?

A successful repair rewrites the user's routine in place, immediately. The write
lives in the `IpcChannels.automationRun` handler inside `registerIpcHandlers`
([ipc.ts](../../src/main/ipc.ts)):

```
if (kind === 'user' && result.repairs.length > 0) {
  const user = deps.user.get(id)!
  deps.user.save({ ..., definition: applyRepairs(user.definition, result.repairs) })
}
```

Three properties of that path matter:

1. **No review.** The routine changes as a side effect of running it.
2. **No history.** `user_routines` carries `created_at` and `updated_at` and nothing
   else — see the first `MIGRATIONS` entry in
   [database.ts](../../src/main/db/database.ts), which is where the table is created.
   The previous definition is gone:
   `UserRoutineStore.save` ([user-routines.ts](../../src/main/db/user-routines.ts))
   replaces the row through `updateStmt`.
3. **No undo.** There is no path in the app back to the prior definition.

**But the mutation is narrower than it looks, and that shapes the whole design.**
`applyRepairs` ([shared/routines.ts](../../src/shared/routines.ts)) writes
`steps[repair.stepIndex] = replacement` only when the repair is **like-for-like** —
`repair.replacement` is exactly one step and its `kind` equals
`repair.original.kind`. Every other repair is skipped and the definition comes back
unchanged. So today's silent mutation covers single-step, same-kind replacements —
the renamed-button case in [HOW-IT-WORKS.md](../../HOW-IT-WORKS.md) §7 — and the
multi-step case in that same section (dismiss a cookie banner, then click) is
already discarded, not by anyone's judgement but by the shape of what the model
returned.

The repair itself is a model's best guess from one snapshot of one page.
`StepHealer.plan` ([step-healer.ts](../../src/main/automation/step-healer.ts)) takes
one `AutomationSession.snapshot()` and one `repairStep` call, and no human ever sees
either.

### Why is it painful?

- **User impact.** A wrong like-for-like repair permanently corrupts a working
  routine, and the correct version cannot be recovered from within the app.
  🔶 **Assumption:** the Author's only clue is that the routine starts behaving
  differently — unvalidated, and it may be worse than that, because a repaired
  selector that clicks the *wrong* working control produces a run that reports
  success. 🔶 **Assumption:** wrong repairs happen often enough to matter —
  unvalidated, because no repair has ever been recorded (which is itself the point).
- **Business impact.** This is the blocker on unattended operation. Scheduling
  (PRD 07) multiplies the number of unwatched repairs by the number of scheduled
  runs. Shipping schedules before review means shipping silent, unbounded,
  irreversible mutation of the user's routines.

### Evidence

- **Code.** All three properties above, plus the like-for-like narrowing, traceable
  to `applyRepairs`, `UserRoutineStore.save`, `MIGRATIONS` and the
  `IpcChannels.automationRun` handler.
- **Design intent, correctly attributed.** `applyRepairs` is **routine-source-blind**
  — it neither knows nor asks whether the definition came from `updates/`. What keeps
  `updates/` the read-only source of truth is the `kind === 'user'` guard in the
  `automationRun` handler in [ipc.ts](../../src/main/ipc.ts). Two mechanisms, two
  places, exactly as [AI_CONTEXT.md](../../AI_CONTEXT.md) §8 states. This PRD moves
  one of them and must not be read as touching the other.
- **A repair that preceded a hold used to be thrown away entirely; PRD 01 fixed
  it, verified 2026-08-27.** `runWithRepair`
  ([orchestrator.ts](../../src/main/automation/orchestrator.ts)) still returns its
  accumulated repair only on the success path, but it now also calls
  `reporter.repaired(repair)` the moment the healer produces a plan, which reaches
  `RunObserver.repair` and a `run_repairs` row whatever happens next. So the case
  most in need of review — *the healer tried this and it still needed a person* —
  does reach the queue. The `RunResult.repairs` array that drives the write-back is
  still success-path only, which is why this PRD reads `run_repairs`, not it.
- 🔵 **Open Question:** what share of repairs are good? Nothing measures this.
  PRD 01 records repairs; this PRD is how we learn the answer, because an
  accept/reject decision is a labelled judgement.

---

## 3. Target Users & Personas

**Primary: The Author** — owns the routine and bears the cost of a bad repair.

**Secondary: The Operator** — needs the run to complete now; should not be blocked
waiting for the Author to review anything.

That split drives the core design decision below: **the repair still runs; only the
write-back is deferred.**

**Job-to-be-done:** *When a site changes, I want the routine to adapt but tell me
it did, so I can keep automations alive without silent drift.*

---

## 4. Strategic Context

**Ladders up to:** trusted unattended runs. Trust here means reversibility, not
just correctness.

**Why now.** Ordering is the whole argument. Every additional day of running
routines is another opportunity for an irreversible bad write, and PRD 07 makes the
rate of such writes a function of a cron schedule rather than of human attention.
Review must exist before schedules do.

**Framing.** Self-healing that asks is a stronger product story than self-healing
that does not — it is the difference between an automation that adapts and one that
drifts. 🔶 **Assumption:** users read silent mutation as risk rather than
convenience. Worth validating, but the reversibility argument stands either way.

---

## 5. Solution Overview

### The core decision

**Repairs continue to execute during the run. Only the write-back becomes a
proposal.** The Operator's run is never blocked on a review, so the current
unattended behaviour is preserved exactly; what changes is that the saved routine
stops changing by itself.

### Revision history

**One sentence settles the data model: a `routine_versions` row holds the definition
*at* that revision, not the definition it replaced.** A pre-image log cannot answer
"restore revision 3", which is what Story 3 requires, so it is not what this builds.
Every write — accept, revert, or an ordinary `UserRoutineStore.save` — appends a row
holding the definition it just stored, and the migration backfills one row per
existing routine so a pre-migration routine has something to revert to.

| Column | Holds |
|---|---|
| `routine_id` | FK to `user_routines`, `ON DELETE CASCADE` (`foreign_keys` is set `ON` in `openDatabase`) |
| `revision` | monotonic counter per routine, starting at 1 |
| `definition` | the full definition **at** this revision, JSON as TEXT |
| `reason` | `manual` / `repair` / `import` |
| `decided_by` | FK to `repair_proposals.id`, null for non-repair revisions |
| `created_at` | epoch ms |

`user_routines` gains a matching `revision` column.

**The counter is called `revision`, not `version`, deliberately.**
`system_routines.version` already means something else — the version the JSON in
[updates/](../../updates/) declares for itself, mirrored by `syncFromDir`, not a
counter of edits. Two columns named `version` meaning two unrelated things is the
kind of collision that costs a debugging session. The UI may still say "version 3";
the schema says `revision`.

**Bounded, with a floor.** `MAX_REVISIONS_PER_ROUTINE = 50`, and **the oldest
revision whose `reason` is not `repair` is never evicted** — that row is the
human-authored baseline, and it is the one an Author reverting a bad accept is
reaching for.

The floor exists because the naive cap silently expires undo exactly where this PRD
claims to de-risk PRD 07. Each Accept is its own revision (bulk accept is out of
scope, §8), so a single run can add up to `MAX_REPAIRS_PER_RUN` = 6 revisions. At an
hourly schedule, a routine healing on every run burns a 20-revision cap in under
four hours and a 50-revision cap in under nine. Capping alone is therefore not a
bound on history, it is a bound on how long undo exists; the floor is what makes
undo durable. 🔶 **Assumption:** 50 is enough head-room for a hand-editing session
in PRD 11's editor. No basis beyond keeping the table small; the floor is the part
that carries the guarantee.

### The queue

Repairs recorded by PRD 01 land in a `repair_proposals` table with three outcomes:

| Outcome | Effect |
|---|---|
| **Accept** | Write the repaired step into the routine as a new revision. **Offered only for like-for-like repairs** |
| **Accept once** | Discard. The repair worked for this run; the routine is unchanged |
| **Reject** | Discard, and record the rejection so PRD 09 can flag a routine whose repairs keep getting rejected |

**Accept is only offered where it can actually do something.** `applyRepairs` keeps a
single same-kind replacement and skips everything else, so accepting a two-step or
kind-changing repair would bump the revision and store a byte-identical definition —
a silent no-op that fails Story 2's "the definition contains the new selector". Two
requirements follow:

1. `shared/routines.ts` exports a predicate — `isLikeForLike(repair: StepRepair):
   boolean`, the same condition `applyRepairs` applies internally — and both the
   queue UI and the accept handler use it. The UI hides Accept and states why; the
   handler refuses with an error rather than writing.
2. This **keeps** AI_CONTEXT.md §8's *a repair is per-run until proven like-for-like*
   rather than weakening it. What changes is that "proven" now means a person said
   so, not that the shape happened to fit.

A multi-step situational fix (the cookie banner) is exactly the repair that should
not be baked in, so restricting Accept costs the Author nothing they should have had.

**Accept is refused when the proposal is stale.** A proposal names a step by index,
and the routine may have been hand-edited or shortened since — including by this
PRD's own revert. Applying by index alone either overwrites the newer step or, when
the routine is now shorter, writes past its end. `isStaleRepair` in
[routines.ts](../../src/shared/routines.ts) compares the step currently at that index
to the proposal's `original`; the queue shows it as stale and the handler refuses.

That second case also exposed a latent hole in the validation boundary:
`assertRoutineDefinition` walked `steps` with `forEach`, which **skips array holes**,
so a sparse array passed validation and serialised to a definition containing `null`
— permanently unrunnable and unsavable. It now walks by index. Not a PRD 03 bug, but
PRD 03 is what made it reachable.

**What this review does not do, stated so nobody reads a security property into it.**
Review bounds what *survives into the stored routine*. It does not bound what the
*run does*. Repairs still execute in-run by design — that is this section's own core
decision — and the repair call is the least-defended model call in the app: any step
failing opens it, a hostile page forces a failure by renaming the element the routine
targets, and `buildRepairPrompt` joins the goal, every step `JSON.stringify`'d
(`type.text` values included) and the page's own DOM into one flat prompt with no
boundary between them. `runWithRepair` then executes the result. `REPAIR_STEP_TOOL`
also widens the action space beyond the goal loop's, to `select`/`wait`/`scroll`.

So an injected repair cannot silently become part of the routine — that is a real
gain, and it is the whole gain. Closing the execution half would mean gating on
`isLikeForLike` *before* execution, which reverses this section's core decision and
forfeits the preparatory actions `REPAIR_PROMPT` explicitly invites. That is a
product trade, not a detail, and it is deliberately **not** taken here.
🔵 **Open Question:** whether it should be.
Where the right answer really is a two-step change, PRD 11's editor is the place to
make it, and the proposal is the prompt to go there.

**Default when nothing is reviewed: accept once.** A repair that is never looked at
never mutates the routine. This inverts today's default, which is the point.

**The queue is not `run_repairs`.** PRD 01's retention prunes old `runs` rows and
`run_repairs` cascades with them, so a proposal stored only there would vanish from
the queue when its run aged out. `repair_proposals` holds its own copy of `original`,
`replacement`, `reason` and the screenshot path, with a nullable `run_id` taking
`ON DELETE SET NULL` — the thread link degrades, the proposal survives. Unlike
revisions, proposals need no numeric cap: `(routine_id, step_index)` is unique with
the newest winning (see §7), so the queue is bounded by the routine's step count.

### The repair screenshot, which does not exist yet

Story 2 shows the Author the page as it was when the step failed. That image is
captured and then dropped on the floor today, so this PRD owns plumbing it through:

| Change | Where |
|---|---|
| `Repair`'s `retry` outcome carries `screenshotBase64: string \| null` from the `PageSnapshot` it already fetched | `StepHealer.plan`, [step-healer.ts](../../src/main/automation/step-healer.ts) |
| `StepRepair` gains `screenshotBase64?: string` | [shared/types.ts](../../src/shared/types.ts) |
| the orchestrator hands it to PRD 01's `onArtifact` rather than into the repair row | `runWithRepair`, `extractWithRepair`, [orchestrator.ts](../../src/main/automation/orchestrator.ts) |
| a new `run_artifacts.kind` value, `repair`, written to `userData/runs/<runId>/repair-<stepIndex>.jpg` | PRD 01's `RunStore` |

**That new `kind` value is a table rebuild, not an `ALTER`.** PRD 01 shipped
`run_artifacts` with `CHECK (kind IN ('screenshot', 'extract'))`, and SQLite cannot
alter a `CHECK` constraint in place. The migration this PRD appends must create the
replacement table, copy the rows, drop and rename — inside the same entry, since the
shipped one is never edited.

It goes to disk as a file, not into a row, for the same reason PRD 01 keeps
screenshots out of SQLite. No new capture and no new cost on **either** backend:
`ExtensionSession.snapshot` and `PlaywrightSession.snapshot` both run
`optimizeScreenshot` (≤1024×768, JPEG q55) before returning, and the healer takes
that snapshot whether or not anyone keeps it.

🔶 **Assumption:** the image is usually there — and **how often it is missing now
depends on the backend**, verified 2026-08-27. `PageSnapshot.screenshotBase64` is
nullable on both. On the **extension** backend `capture()` requires the target tab
to be the active tab in its window, so a run the user tabbed away from yields a
proposal with no image. On the **playwright** backend — the default —
`page.screenshot` needs no such thing and fails only on a timeout, so the missing
image should be rare. Either way the queue must render that case as "no screenshot
captured", not as an empty frame — and a budget-exhausted `giveUp` returns before
any snapshot is taken, so those proposals never have one on either backend.

### Where it lives

- In the thread (PRD 01), inline at the step that was repaired, showing the original
  step, the replacement, the model's stated reason, and the screenshot.
- In a **Pending repairs** count on each row of the automation rail — the
  `AutomationRow` inside `AutomationRail`
  ([components/AutomationRail.tsx](../../src/renderer/src/components/AutomationRail.tsx)),
  fed by a new field on `AutomationsState`
  ([state/useAutomations.ts](../../src/renderer/src/state/useAutomations.ts)) rather
  than by a manual refresh — so an Author with ten routines can find the ones asking
  for attention without opening every thread.

### IPC surface

Six `invoke` channels and one push channel, added to `IpcChannels` in
[shared/ipc.ts](../../src/shared/ipc.ts). Per AI_CONTEXT.md §10, each one touches
four places: the channel map, a `handle(...)` in `registerIpcHandlers` behind the
existing `trustSender` allowlist, a method on `api` in
[preload/index.ts](../../src/preload/index.ts), and the renderer.

| Channel | Payload → result |
|---|---|
| `repairs:list` | `{ routineId? }` → pending proposals, newest first |
| `repairs:accept` | `{ proposalId }` → the saved `UserRoutine`; errors if not like-for-like |
| `repairs:acceptOnce` | `{ proposalId }` → `boolean` |
| `repairs:reject` | `{ proposalId }` → `boolean` |
| `routines:user:revisions` | `routineId` → revision list with `reason` and `created_at` |
| `routines:user:revert` | `{ routineId, revision }` → the saved `UserRoutine` |

The push channel is `repairs:changed`, exposed as an unsubscriber matching the six
that exist in the preload today (`onRoutinesChanged`, `automation.onProgress`,
`automation.onStatusChanged`, `automation.onHold`, `browser.onChanged`,
`runs.onChanged`) — so it is nested on `api`, not a bare top-level
`onRepairsChanged`. **It is load-bearing, not decoration.** Today the `automationRun` handler
broadcasts `IpcChannels.changed` immediately after the write-back; deleting that
branch deletes the only thing that tells the renderer a repair happened. Without
`repairs:changed`, Story 4's pending count is stale until the Author reloads.

### Where the writes live

A new `RepairProposalStore` in `src/main/db/repair-proposals.ts` owns the proposal
rows and the `decision` / `decided_at` bookkeeping. It does **not** own definition
validation:

- **Accept** composes `applyRepairs(routine.definition, [proposal.asStepRepair()])`
  and passes the result to `UserRoutineStore.save`, which is where
  `assertRoutineDefinition` runs. The handler shape-checks the id and nothing more.
- **Revert** does the same with the stored revision's JSON. That JSON is parsed off
  disk and **must be re-validated** — it may predate a tightening of the validator,
  or a step kind that no longer exists — and routing it through
  `UserRoutineStore.save(input: unknown)` is what re-validates it. Neither path may
  write `user_routines` directly.

This is AI_CONTEXT.md §8's *user-routine validation lives in
`UserRoutineStore.save`* invariant, unchanged and now with two more callers.

### Persistence

Append one entry to `MIGRATIONS` in [database.ts](../../src/main/db/database.ts) —
never edit the shipped one; `PRAGMA user_version` is the cursor. In order:

1. `CREATE TABLE routine_versions (...) STRICT` and
   `CREATE TABLE repair_proposals (...) STRICT`, matching the two tables that exist.
2. `ALTER TABLE user_routines ADD COLUMN revision INTEGER NOT NULL DEFAULT 1`. A
   `STRICT` table accepts `ADD COLUMN`, but a `NOT NULL` column needs a non-null
   default, hence the `DEFAULT 1`.
3. **Backfill** a `routine_versions` row per existing routine — `revision` 1, the
   current definition, `reason = 'manual'` — inside the same migration. Without it,
   every routine that exists before this ships has nothing to revert to, which is
   silently the population that most needs undo.
4. Index `repair_proposals (routine_id)` for the sidebar count.

`UserRoutineStore` changes with the schema: `UserRoutineRow` and `toModel` gain
`revision`, `insertStmt`'s column list gains it, and `save` appends the
`routine_versions` row inside its existing `db.transaction` so a definition and its
revision row can never diverge.

### Undo

A routine's revision list, with a diff between any revision and the current one, and
a one-click revert that appends a new revision rather than deleting history.

### AI_CONTEXT.md amendments required in the same change

Per its §13, this PRD's implementation must update:

- **§8**, the *a repair is per-run until proven like-for-like* bullet: the
  `kind === 'user' && result.repairs.length > 0` half moves out of the `automationRun`
  handler and into the `repairs:accept` handler. The invariant is strengthened, not
  weakened — but the sentence naming its location becomes wrong the moment the branch
  is deleted.
- **§4**, file map: `src/main/db/repair-proposals.ts`.
- **§5**, symbol index: `isLikeForLike`, `RepairProposalStore`.
- **§6**, data contracts: `StepRepair` gains `screenshotBase64`.
- **§7**, budgets: `MAX_REVISIONS_PER_ROUTINE` = 50.
- **§10**, the IPC recipe: "matching the existing four" unsubscribers is already six
  in the preload and becomes seven.

---

## 6. Success Metrics

### Primary

**Unreviewed automatic mutations** — count of `user_routines` definition writes not
attributable to an explicit human decision.

- **Current: every *like-for-like* repair on a user routine.** Not every repair —
  `applyRepairs` discards multi-step and kind-changing replacements, so those already
  mutate nothing. The honest baseline is a subset nobody has sized.
- **Cannot be measured today**, in either direction: nothing counts repairs and
  nothing counts routine writes. **Proxy, available the day PRD 01 ships:** the share
  of `run_repairs` rows for which `isLikeForLike` is true — the population that would
  have mutated a routine. That number is the baseline this metric is measured against.
- **Target: zero, and measured as zero rather than asserted.** The mechanism is
  `routine_versions.decided_by`: every row with `reason = 'repair'` must name the
  proposal that authorised it, so
  `SELECT count(*) FROM routine_versions WHERE reason = 'repair' AND decided_by IS NULL`
  is the metric, and it is queryable rather than inferred from reading the code. A
  target of "zero" with no counter behind it is a code property, and a code property
  survives exactly until someone adds a second writer.
- **Backstop:** the write-back branch is deleted from the `automationRun` handler and
  `main/ipc.ts` drops its `applyRepairs` import; `tests/db.verify.ts` asserts the
  accept path is the only producer of a `reason = 'repair'` revision.

### Secondary

- **Repair acceptance rate** — proposals decided `accept` ÷ proposals decided.
  Mechanism: `repair_proposals.decision` and `decided_at`. 🔵 **Open Question:** no
  baseline exists. This is the first real measurement of whether the healing layer is
  trustworthy, and feeds directly into whether PRD 07 should ever auto-accept.
  Reported split by `isLikeForLike`, since only one half can be accepted at all.
- **Review latency** — median hours from `repair_proposals.created_at` to
  `decided_at`, over decided rows only. Undecided rows are reported separately as
  *queue age*, because folding them in makes an ignored queue read as infinite
  latency. 🔶 **Assumption:** high latency means the queue is not discoverable
  enough. The competing reading is that the Author saw it and did not care, which is
  the intended safe default — the two are distinguishable only by asking, so this
  metric prompts a question rather than answering one.
- **Accept regret rate** — share of accepted proposals whose routine is reverted to a
  revision at or before that accept within 7 days. Mechanism: join a revert revision
  (`reason = 'manual'`, written by `routines:user:revert`) to the accept revision it
  reaches back past. This replaces "reverts per month, any non-zero number justifies
  this PRD", which could not fail. 🔶 **Assumption:** under 10% is healthy; above 25%
  the queue is showing Authors too little context to decide well, and the diff view
  is where to look. Both thresholds are guesses, and both are falsifiable.

### Guardrails

- **Run success rate must not fall.** Repairs still execute; deferring the write-back
  must change nothing about whether a run completes. Measured from PRD 01's `runs`
  table as (`done` + `assisted`) ÷ terminal runs, four weeks either side of the
  change.
- **A routine with pending proposals is still runnable** — never blocked on review.
  Asserted by a test, not measured: there is no code path from a proposal to the run
  loop, and that absence is the guarantee.
- **Accept never runs inside a run.** Every write happens in an IPC accept or revert
  handler, so the orchestrator's `busy` flag and the step loop are untouched.

---

## 7. User Stories & Requirements

### Epic hypothesis

We believe that turning repairs into reviewable proposals with revision history will
make routines safe to run unattended, because today a single bad model guess
permanently corrupts a working routine with no path back. We will know we are right
when reverts occur, and when repair acceptance rate is high enough to consider
auto-accepting a narrow class of repairs.

### Story 1 — A repair no longer writes itself in

**As** the Author, **I want** repairs to stop editing my routine automatically,
**so that** a wrong guess cannot silently corrupt it.

```gherkin
Scenario: A repair runs but does not persist
  Given a user routine whose step 3 selector no longer matches
  When the run heals step 3 and completes
  Then the run succeeds using the repaired selector
  And the stored routine definition and its revision are unchanged
  And a pending repair_proposals row exists for step 3

Scenario: A repair that preceded a hold is still recorded
  Given a user routine whose step 3 exhausts its attempts after one failed repair
  When the run holds for a human and then continues past step 3
  Then a pending proposal exists for step 3 carrying that repair's replacement
  And the run reports 'assisted', per PRD 01

Scenario: System routines are unaffected
  Given a system routine that heals during a run
  When the run completes
  Then no proposal is created
  And updates/ remains the source of truth, as today
```

### Story 2 — Reviewing a proposal

**As** the Author, **I want** to see what changed and decide, **so that** I accept
durable fixes and discard situational ones.

```gherkin
Scenario: Accepting a like-for-like repair writes a new revision
  Given a routine at revision 5
  And a pending proposal replacing step 3's 'button#send' with 'button[aria-label="Send message"]'
  When I accept it
  Then the stored definition's step 3 carries the new selector
  And user_routines.revision is 6
  And a routine_versions row for revision 6 holds the definition as just stored, reason 'repair'
  And that row's decided_by names the accepted proposal
  And the revision 5 row still holds the definition without the new selector

Scenario: Accept is never a silent no-op
  Given any proposal for which the queue offers Accept
  When I accept it
  Then the stored definition differs from the definition held by the previous revision

Scenario: A multi-step repair cannot be accepted
  Given a pending proposal whose replacement is two steps — dismiss a banner, then click
  When I open it
  Then only "accept once" and "reject" are offered
  And the reason is stated: this repair changes the shape of the step

Scenario: A kind-changing repair cannot be accepted
  Given a pending proposal replacing a click step with a navigate step
  When I open it
  Then only "accept once" and "reject" are offered

Scenario: Accept-once discards the proposal
  Given a pending proposal that dismissed a cookie banner before clicking
  When I choose "accept once"
  Then the routine definition and revision are unchanged
  And the proposal leaves the queue with decision 'acceptOnce'

Scenario: A proposal shows its full context
  Given a pending proposal whose repair captured a screenshot
  When I open it
  Then I see the original step, the replacement steps, the model's reason
  And the run_artifacts row of kind 'repair' for that run and step, rendered inline

Scenario: A proposal with no screenshot says so
  Given a pending proposal created while the target tab was not the active tab
  When I open it
  Then the context reads "no screenshot captured" rather than showing an empty frame
```

### Story 3 — Undo

**As** the Author, **I want** to revert a routine to an earlier revision, **so
that** a bad accept is recoverable.

```gherkin
Scenario: Reverting restores an earlier definition
  Given a routine at revision 5 with routine_versions rows for revisions 1 to 5
  When I revert to revision 3
  Then the stored definition equals the definition held by the revision 3 row
  And user_routines.revision is 6
  And a revision 6 row holds that same definition with reason 'manual'
  And the revision 5 row is untouched

Scenario: A reverted definition is re-validated
  Given a stored revision whose JSON no longer satisfies assertRoutineDefinition
  When I revert to it
  Then the revert fails with the validator's message
  And the routine is left at its current revision

Scenario: History is bounded but undo does not expire
  Given a routine whose oldest revision has reason 'manual'
  And 50 stored revisions, the other 49 with reason 'repair'
  When a 51st revision is written
  Then the oldest 'repair' revision is dropped and 50 remain
  And the 'manual' revision is still present and still revertable
```

### Story 4 — Finding what needs review

**As** the Author with many routines, **I want** pending repairs surfaced, **so
that** I do not have to open every thread to find them.

```gherkin
Scenario: Pending repairs are visible on the routine
  Given two routines with pending proposals
  When I open the routines list
  Then each shows a pending-repair count
  And selecting one opens its proposals

Scenario: The count updates without a reload
  Given the routines list is open with a count of 0 on a routine
  When a run of that routine records a repair
  Then repairs:changed fires and the count becomes 1
```

### Constraints and edge cases

- **A proposal whose routine was edited since the repair is stale.** Detect it by
  comparing the step at `step_index` in the current definition to the proposal's
  `original`; show it as stale and refuse to apply it. Never apply by index alone —
  PRD 01 §5 makes step indexes absolute precisely so an index means what it says.
- **Multiple proposals for the same step collapse.** `(routine_id, step_index)` is
  unique; a newer repair replaces the pending row and the superseded attempt stays
  readable in its own run's thread.
- **A pruned run must not empty the queue.** `repair_proposals.run_id` is nullable
  with `ON DELETE SET NULL`, so PRD 01's retention can delete the run without taking
  the proposal. The screenshot is deleted with the run's artifact directory, so a
  surviving proposal may lose its image — render it as absent.
- **The name-overwrite path cascades away revision history, and the two branches of
  `save` disagree about it.** `user_routines.name` is `COLLATE NOCASE UNIQUE`, so the
  clash is case-insensitive. `UserRoutineStore.save` with an `id`, a clashing name and
  `overwrite: true` runs `deleteStmt` on the *clashing* row — `ON DELETE CASCADE`
  then takes that routine's entire revision history and every pending proposal with
  it. The no-`id` branch of the same call instead `updateStmt`s the clashing row,
  which keeps a revision history describing a definition the row no longer holds.
  Requirements: make the branches consistent by resetting the repurposed row's
  history to a fresh revision 1 in the no-`id` case, and make the renderer's
  overwrite confirmation say that the overwritten routine's history goes with it.
  Cover both branches in `tests/db.verify.ts`.
- **A deleted routine drops its proposals and revisions** — `ON DELETE CASCADE`;
  `foreign_keys` is set `ON` in `openDatabase`
  ([database.ts](../../src/main/db/database.ts)).

---

## 8. Out of Scope

- **Auto-accepting high-confidence repairs.** Tempting, and the acceptance-rate
  metric exists precisely to decide it later. Not now: auto-accept is the current
  behaviour this PRD is removing.
- **Editing a proposal before accepting it.** Accept or discard. Editing arrives with
  PRD 11's editor, which is also where a multi-step repair worth keeping gets made by
  hand.
- **Bulk accept or reject across a run's proposals.** A run can produce up to
  `MAX_REPAIRS_PER_RUN` = 6 proposals and "accept all" will be asked for, but it is
  the same one-click irreversible mutation this PRD exists to remove, wearing a
  different hat: six per-step judgements collapsed into one click nobody read. Each
  Accept stays its own decision and its own revision. Revisit only with
  acceptance-rate data, and only for the like-for-like subset.
- **Reviewing repairs to system routines.** They heal at run time exactly as today
  and produce no proposal, because there is nowhere to write an accepted one:
  `updates/` is the read-only source of truth and `syncFromDir` deletes and
  re-inserts every `system_routines` row on each sync, so any accepted change would
  be erased by the next file save. An Author who wants a system routine's repair kept
  copies it to a user routine — PRD 10's import path — or edits the JSON in
  `updates/`. A "propose a change to a shipped routine" flow is a different feature
  with a different destination.
- **Versioning system routines.** Same reason; git covers `updates/`.
- **Sharing or syncing revisions across machines** — PRD 10 territory.

---

## 9. Dependencies & Risks

### Dependencies

- **PRD 01**, for four things and not only the table: `run_repairs` and the thread
  view proposals are displayed in; `onRepair` carrying `original` and `replacement`
  as step JSON **and firing on the failure path**, without which a repair that
  preceded a hold is unrecoverable; `onArtifact` plus a `run_artifacts` row for the
  repair screenshot; and absolute step indexes, without which a proposal cannot be
  matched back to a step.
- **A migration** appending to `MIGRATIONS`: two `STRICT` tables, one
  `ALTER TABLE … ADD COLUMN` with a non-null default, and the backfill. See §5.
- **`applyRepairs` is reused unchanged**, moving from the run path to the accept path.
  What is *added* beside it is `isLikeForLike` in the same file, because a caller
  needs to know in advance whether `applyRepairs` will do anything — today it
  silently returns the definition it was given.
- Renderer work: the proposal card and revision list are new components under
  [src/renderer/src/components/](../../src/renderer/src/components/) with their own
  `*.module.css`, composed into `ThreadView` and `AutomationRail` from
  [App.tsx](../../src/renderer/src/App.tsx), with their IPC reads in a new
  `state/useRepairs` hook alongside the existing four. The renderer is React 19
  with CSS modules; there is no single file left to add to.

### Risks

| Risk | Mitigation |
|---|---|
| **Accept silently does nothing.** The central defect this PRD was written around: `applyRepairs` skips any replacement that is not one step of the same kind, so Accept on the rest bumps the revision and stores an identical definition. | Offer Accept only where `isLikeForLike` holds; the handler refuses otherwise. Story 2's "Accept is never a silent no-op" is the regression test. |
| **A queue nobody empties.** Proposals pile up and the feature becomes noise. | Default is accept-once, so the routine provably never changes — that half is a code property. 🔶 **Assumption:** the remaining cost of an unemptied queue is zero for the Author. Unvalidated, and the counter-case is real: a stale count is a notification that has stopped meaning anything, which is what the queue-age metric watches for. |
| **Removing auto-apply makes routines decay.** Today a like-for-like healed routine silently improves; after this it does not unless someone accepts. | Surface repeat repairs prominently. 🔶 **Assumption:** the same step healed on three consecutive runs is a strong accept signal — unvalidated, and it could equally mean the site changes daily and no stored selector will hold. PRD 09 generalises the grouping; the threshold of three is arbitrary. |
| **Undo expires before it is needed.** A capped history plus a repairing hourly schedule evicts the pre-repair definition within hours. | The never-evict floor on the oldest non-`repair` revision (§5), asserted by Story 3's bounded-history scenario. |
| **A pruned run empties the queue.** PRD 01's retention cascades `run_repairs`. | `repair_proposals` owns its own copy with a nullable `run_id`. |
| **The overwrite path destroys history.** `save(..., overwrite: true)` deletes the clashing row and the cascade follows. | Make the two branches consistent, warn in the renderer, cover both in `tests/db.verify.ts`. See §7. |
| **A stored revision no longer validates.** A tightened validator or a removed step kind makes old JSON unloadable. | Revert goes through `UserRoutineStore.save(input: unknown)`, so `assertRoutineDefinition` runs on the way back in and the revert fails loudly instead of storing something the run loop cannot execute. |

---

## 10. Open Questions

- 🔵 What is the real repair acceptance rate, split by like-for-like? Unknown, and
  the single most useful number this PRD produces. It determines whether narrow
  auto-accept is ever safe.
- 🔵 Should "the same step repaired 3 runs running" auto-accept? Attractive, but it
  reintroduces the mutation this PRD removes. Decide with acceptance-rate data.
- 🔵 What share of proposals arrive with no screenshot, **and does it differ by
  backend**? On the extension backend `capture()` needs the target tab active, so it
  may be most of them under PRD 07's schedules — in which case the proposal card's
  most persuasive element is usually missing and the diff has to carry the decision
  alone. The default playwright backend has no such constraint, so the same question
  may have two answers. Measurable from the first week: `repair_proposals` rows with
  a null screenshot path.
- 🔵 Should a proposal for a step whose repair *still* failed be presented
  differently from one that worked? It is weaker evidence, and it is also the case an
  Author most needs to see.
- 🔵 Should the Operator be able to accept a proposal, or only the Author? Single
  user today, so moot — becomes real if the product grows multi-user.
- 🔶 **Assumption:** 50 revisions per routine is sufficient head-room. Arbitrary; the
  never-evict floor, not the number, is what makes undo safe.
- 🔶 **Assumption:** Authors want per-repair decisions rather than a per-routine
  "trust repairs on this one" toggle. A toggle may be the better UI for a routine the
  Author does not care much about — and it is also how auto-accept comes back in
  through the side door, so it needs the acceptance-rate data first.

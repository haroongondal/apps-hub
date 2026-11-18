# PRD 11 — Routine editor

| | |
|---|---|
| **Phase** | Durability |
| **Depends on** | **PRD 03 (hard)** — versioning, revert, and the repair review gate |
| **Blocks** | PRD 12, PRD 13 |
| **Status** | Draft |
| **Author** | hmukhtar@outsentia.com |

Shared personas and strategic context: [README.md](README.md), whose dependency
table is the authority this header restates.

---

## 1. Executive Summary

We're building a **routine editor** — a step-level editing UI for saved routines —
for **the Author** to solve the problem that a routine can be created and deleted
but never changed, so fixing one broken selector means re-recording the whole flow,
which will make routines maintainable artifacts rather than disposable recordings.

As drafted this is four features sharing a save path. §8 recommends shipping one of
them as PRD 11 and moving two out to the PRDs that own their surfaces.

---

## 2. Problem Statement

### Who has this problem?

The Author, every time a routine needs any change at all.

### What is the problem?

There is no editing **UI**. The write path already exists.

`window.api.user` exposes `list`, `get`, `save` and `remove`
([preload/index.ts](../../src/preload/index.ts)), and `save` is a full upsert:
`UserRoutineStore.save(input: unknown)` in
[user-routines.ts](../../src/main/db/user-routines.ts) validates the payload with
`assertRoutineDefinition` and, when the payload carries an `id`, runs its `UPDATE`
over `name`, `description`, `definition`, `source` and `updated_at`. So the store
can already replace a definition in place. The renderer calls `window.api.user.list`
(in `useAutomations`) and `window.api.user.remove` — never `get`, never `save`.

What the renderer has is `AutomationRow`, the row component inside `AutomationRail`
([AutomationRail.tsx](../../src/renderer/src/components/AutomationRail.tsx)): a name,
a description, a param form and a Run button. No step list, no field, no Save.

That reframes the build. The editor **extends an existing channel**
(`IpcChannels.userSave`, already reachable as `window.api.user.save`) rather than
adding one, so AI_CONTEXT §10's "adding an IPC channel" recipe does not apply to
the save path. What it does need is that channel *hardened* — §5 lists the four
ways today's `save` is unsafe for an editor to call as it stands.

The two authoring paths are: drive a chat goal and save the recording (the
`IpcChannels.automationChatSave` handler in [ipc.ts](../../src/main/ipc.ts), which
calls `saveChatSession` and then `UserRoutineStore.save` with `source: 'chat'`), or
hand-write JSON into `updates/` — which produces a system routine, has no write
path from the app at all (§5), and is wholesale-replaced on every `syncFromDir`.

To change one selector in a twelve-step routine, the Author re-records twelve steps.

### Why is it painful?

- **User impact.** The cost of a small fix equals the cost of authoring from
  scratch. 🔶 **Assumption:** this is why routines get abandoned rather than
  maintained — unvalidated; PRD 09's data would show it.
- **Business impact.** Every other durability feature routes into an edit the
  Author cannot make. PRD 03 lets them reject a repair, then offers no way to write
  the right selector. PRD 09 identifies the broken step, then offers no way to fix
  it. The editor is the missing verb.

### Evidence

- **Code.** No edit path in the renderer (`AutomationRail`). `UserRoutineStore.save`
  has exactly **three** callers, all in [ipc.ts](../../src/main/ipc.ts): the
  `IpcChannels.userSave` handler; the repair write-back inside the
  `IpcChannels.automationRun` handler (`kind === 'user' && result.repairs.length > 0`);
  and the `IpcChannels.automationChatSave` handler. Two of the three write on the
  Author's behalf without being asked, and the one an editor would use has never
  been called from the renderer.
- **Structural.** Deleting and re-recording loses the routine's identity, its
  history, and — after PRD 01 — its entire run record. A re-record is an `INSERT`
  with a fresh `randomUUID()` and no link to what it replaced. Re-authoring is not
  equivalent to editing.

---

## 3. Target Users & Personas

**Primary: The Author** — comfortable with selectors and step semantics, not
required to be comfortable with the codebase.

**Job-to-be-done:** *When one step of a working routine breaks, I want to fix that
step, so I do not rebuild the other eleven.*

---

## 4. Strategic Context

**Ladders up to:** durable automations — the "trusted afterwards" half of the
outcome.

**Why now — and why eleventh.** It is the largest renderer investment in the set
and blocks nothing that ships before it. Placed here, it inherits three things that
make it substantially better: PRD 03's version history gives it undo for free and
its review gate stops runs overwriting edits, PRD 06 gives it a step kind worth
adding by hand, and PRD 09 tells the Author which step to open. Built first, it
would have needed its own versioning and would have had no assertions to offer.

---

## 5. Solution Overview

### The editor

Opened from a user routine. A step list — kind and a one-line summary per step —
with a detail panel for the selected step showing its typed fields. Add, duplicate,
delete and **reorder**; the requirement is that the Author can change step order,
not that they do it by dragging. Params edited alongside: name, description,
required, default.

Fields are typed to the step kind, taken from the descriptors the validator itself
uses — `STEP_FIELDS` in [routines.ts](../../src/shared/routines.ts). That table is
module-private today; the file exports `MAX_WAIT_MS`, `assertRoutineDefinition`,
`applyRepairs`, `describeStep` and `resolveStep`, and not `STEP_FIELDS`.
**Requirement: export it.** The
alternative is a second copy of the eight-kind field map in the renderer, and
AI_CONTEXT §10's "adding a step kind" recipe already names six places that must
change together, with the warning that missing one fails silently. A seventh copy
that nobody knows about is exactly the failure that recipe exists to prevent.
Exporting a new symbol requires an AI_CONTEXT §5 row (§13 rule 1).

### Validation, and why the shared validator has to change

`assertRoutineDefinition` throws a single `Error` on the **first** failure for the
whole definition — `checkFields` throws `steps[3].selector is required` and returns
nothing structured. It cannot drive inline per-field feedback, and §8's rule against
a second validator forbids writing a field-level one in the renderer. Story 1's
"shows that the field is required, save unavailable until filled" is therefore not
buildable on today's shared code.

Required change, in [routines.ts](../../src/shared/routines.ts):

1. add `validateRoutineDefinition(value: unknown): { path: string; message: string }[]`
   — collects every problem instead of throwing on the first, with `path` in the
   `steps[3].selector` / `params.client` form the existing messages already use;
2. keep `assertRoutineDefinition(value: unknown): RoutineDefinition` as the
   store-boundary wrapper: run the collector, throw the first message, return the
   narrowed value. Boundary behaviour is unchanged, so `UserRoutineStore.save` and
   the tests around it do not move;
3. export `STEP_FIELDS`.

This weakens an AI_CONTEXT §8 invariant and must amend it in the same change — see
§9, "Documentation the change must amend".

### What `save` must change before an editor may call it

Four ways today's `save` corrupts data when an editor drives it.

1. **`source` is silently rewritten.** `save` defaults `source` to `'chat'` when it
   is absent and accepts only `'chat' | 'import'`. An editor that omits it relabels
   an imported routine as chat-recorded. Requirement: the editor round-trips the
   loaded routine's `source`, **and** `save` preserves the existing row's value when
   `id` is present and `source` is absent, so the next caller that forgets does not
   relabel either.
2. **A rename is a delete.** With `id` set and the new name held by another row,
   `save` throws `RoutineNameConflictError` unless `overwrite: true` — in which case
   it runs `deleteStmt` against the clashing row. `user_routines.name` is
   `COLLATE NOCASE UNIQUE` (the first entry of `MIGRATIONS` in
   [database.ts](../../src/main/db/database.ts)), so `Invoices` and `invoices`
   collide. Requirement: the editor never sends `overwrite: true`; it surfaces the
   conflict on the name field and offers rename-or-cancel only. §6's guardrails now
   name this separately, because "no routine corrupted by editing" does not cover
   "a different routine deleted".
3. **No concurrency check.** `save` writes whatever definition it is handed. The
   repair write-back does the same, from a definition it read earlier — see §9.
   Requirement: `SaveUserRoutineInput` gains an optional `expectedUpdatedAt` and
   `save` rejects when the row's `updated_at` has moved past it.
4. **An empty routine fails late.** `assertRoutineDefinition` rejects
   `steps: []` with `definition.steps must be a non-empty array`, so a routine
   deleted down to nothing fails at save with a whole-definition error. Requirement:
   the editor prevents the last delete and says why.

Items 1, 3 and 4 change `shared/types.ts` or store behaviour and so require an
AI_CONTEXT §6 update (§13 rule 2).

### Editable versus read-only, and system routines

`AutomationRail` renders both kinds through the same `AutomationRow` — same markup,
same Run button — separated only by the "Built in" and "Yours" group headings, with
Delete on user rows alone. Nothing marks a system routine as unchangeable, and there
is no way to open either kind for anything but a run. Requirement: user routines
get **Edit**; system routines get **Duplicate as a user routine** and no Edit. All
of §5's entry points can also originate from a *system*-routine run, because
`assertRunRoutineInput` accepts `kind: 'system'`; "edit this step" on one of those
opens the duplicate flow with that step pre-selected in the copy, never an editor
over the system routine.

The reason edit cannot be offered there is not the `fs.watch` cycle — it is that
**the editor has no write path to `system_routines` at all.**
[shared/ipc.ts](../../src/shared/ipc.ts) exposes `systemList`, `systemReload` and
`systemLastSync` and nothing else, and `SystemRoutineStore`'s `clearStmt` and
`insertStmt` are private, run only by `syncFromDir`. A Save from a system routine
would route to `user.save`, which with no `id` **inserts a new user routine** — or
throws `RoutineNameConflictError` if the name is taken — leaving the system routine
untouched and still listed identically beside its copy. The failure is a confusing
duplicate, not a destroyed edit.

Duplicate therefore **ships with the editor** (this resolves a §10 question: without
it the Author reaches a dead end on every prebuilt routine), and it needs one
persistence change, because a copy has no honest provenance today —
`UserRoutine['source']` is `'chat' | 'import'` and a copy is neither, and
`version`, `checksum` and `sourceFile` have no column on `user_routines`. Following
AI_CONTEXT §10's "changing persistence" recipe — append to `MIGRATIONS`, never edit
a shipped entry:

- add `'derived'` to the `source` CHECK constraint, to `UserRoutine['source']` and
  `SaveUserRoutineInput['source']` in [types.ts](../../src/shared/types.ts), and to
  the `src !== 'chat' && src !== 'import'` check in `save`;
- add `derived_from` holding the origin's `sourceFile` and `version`, so the copy
  keeps a link upstream.

### Read-only while a run is in progress

Partly detectable, by a route this PRD did not anticipate. `ExtensionStatus` is still
`{ connected, paused }` and the orchestrator's `busy` is still `private`, but the
renderer no longer infers running-ness from its own Run button: `App.tsx` derives
`busy` from `useRuns`'s `liveRunId`, which `useRuns` sets from the
`automation:progress` subscription — and `progress` is broadcast to every window, so
a run begun by a schedule (PRD 07) or a queue (PRD 05) is now visible. Matching that
run to *this routine* needs one more hop: `AutomationProgressEvent` carries no
routine id, but the `RunSummary` for `liveRunId` in `useRuns.summaries` carries
`routineId` and `routineKind`.

So the requirement below is no longer the only way to get Story 5, and it should be
re-costed against the summary lookup before it is built. It is kept because it is the
only route that reports a run the run store has not recorded yet, and because
`ExtensionStatus` is what the editor already subscribes to. Following AI_CONTEXT
§10's IPC recipe, extending a channel rather than adding one:

1. `orchestrator.ts` — a public read of the busy state and of what is running;
2. `shared/types.ts` — `ExtensionStatus` gains
   `running: { kind: 'system' | 'user'; id: string } | null` (§6 / §13 rule 2);
3. `main/ipc.ts` — the `IpcChannels.automationStatus` handler returns it;
4. `main/index.ts` — broadcast on change, alongside the existing status broadcast.
   AI_CONTEXT §9's trap applies: `automation:status` is deliberately both an
   `invoke` and a push channel and `handle` and `on` are separate registries, so
   both halves must carry the new field or the renderer sees two shapes;
5. `preload/index.ts` — no new method; `status()` and `onStatusChanged` exist
   already and only their type widens;
6. renderer — the editor is read-only while `running.id` is this routine.

🔶 **Assumption:** read-only for the duration is better than allowing the edit and
rejecting the save. `expectedUpdatedAt` is what makes concurrent editing *safe*; the
read-only state is only the courtesy that avoids wasted typing.

### Reference analysis (dangling variables)

Substitution reaches exactly four slots: `navigate.url`, `type.text` and
`select.value` in `resolveStep`, now exported from
[shared/routines.ts](../../src/shared/routines.ts) and called by
`ExtensionSession.runStep`, `PlaywrightSession.runStep` and `runRoutine` alike; and
`extract.selector` via `resolveTemplate`, called from `runRoutine`'s extract branch
in [orchestrator.ts](../../src/main/automation/orchestrator.ts) and passed into
`extractWithRepair` already resolved. Requirement: the check
covers those four slots and no others, and reuses the runtime's own
`/\{\{(\w+)\}\}/g`. Two consequences the editor must respect:

- a literal `{{…}}` in a CSS selector is **supported input** that AI_CONTEXT §6
  deliberately preserves, so a "static check across the definition" would warn about
  working routines;
- the pattern is `\w+`, so `{{my-var}}` is never recognised as a variable and would
  resolve to `''` at run time. A param name failing `^\w+$` is therefore a hard
  error on the name field, not a warning.

The dangling-variable finding itself is a **warning, not a block** (resolves a §10
question): it appears as a row on the referencing step in the step list plus a
pre-save summary, Save stays enabled, and an intentionally optional param is exactly
the false positive that rules out blocking.

### Versioning and undo

Every save writes a `routine_versions` row with `reason = 'manual'` (PRD 03). That
table, its `reason` column and its revert UI are 03's; the editor consumes them.
§8 recommends the history-and-revert surface ship as part of PRD 03 rather than here.

### Entry points

The editor is where other features send the Author: a failing step in a thread
(PRD 01), a rejected repair proposal (PRD 03), a failure group (PRD 09). Each opens
the editor with that step selected. An editor reached only from a menu would be used
far less than one reached from the problem.

PRD 11 owns only the parameter the editor accepts — open routine *R* with step *N*
selected. Each button lives in a surface another PRD builds, so the buttons cannot
be delivered here; see §8.

### `intent`

`ActionStep.intent` is what a repair reads to understand what a step was *for* (the
comment on `ActionStep` in [types.ts](../../src/shared/types.ts)). Chat-recorded
steps take it from the model's `step_description`; hand-authored steps currently
have no way to get one. The editor exposes it as a first-class field, described as
what the step is trying to accomplish, because it directly determines repair
quality.

### What it does not become

Not a JSON editor with syntax highlighting. The Author who wants raw JSON has
export (PRD 10). This is a structured editor for people who think in steps.

---

## 6. Success Metrics

### Primary

**Hand-edited routines and edits per routine** — how many user routines receive at
least one manual edit, and how many edits each takes to stop breaking.

- **Mechanism:** `routine_versions` rows with `reason = 'manual'` (PRD 03's table
  and column), grouped by `routine_id`. In-product, no telemetry, available the day
  the editor ships.
- **Baseline:** zero such rows can exist before the editor, because nothing writes
  one. That is a fact about the schema, not a claim about behaviour.
- **Target:** 🔵 **Open Question** — none until the mechanism has produced a month
  of data. A target is a commitment; setting one now would be a number with nothing
  behind it.

**The outcome this proxies — routine maintenance rate**, the share of broken
routines fixed by editing rather than re-recorded or abandoned: **cannot be measured
yet.** It needs three facts the product does not record: that a routine was broken
(PRD 09's fingerprints), that a later routine replaced an earlier one rather than
being new (nothing records this — a re-record is an `INSERT` with a fresh
`randomUUID()`), and that an abandoned routine was abandoned rather than seasonal
(run history, PRD 01). Neither 01 nor 09 is a dependency of this PRD, so this PRD
cannot promise the number. The prior draft's "current 0% by edit (impossible),
target 80%" is removed: the baseline was true by construction and the target had no
measurement behind it.

### Secondary

- **Hand-authored `assert` steps** (PRD 06). **Mechanism:** count `assert` steps in
  the definitions of `routine_versions` rows with `reason = 'manual'` against those
  with `reason = 'repair'` and against chat-saved definitions. Works with 03 and 06
  alone. 🔶 **Assumption:** assertions are unlikely to be added without an editor,
  so a rise here shows the two features compounding.
- **Routine lifespan** — days between creation and last *successful* run.
  **Cannot be measured yet:** "successful run" needs run history (PRD 01), not a
  dependency here. **Proxy available with this PRD alone:**
  `user_routines.updated_at − created_at` for routines with at least one `manual`
  version — days a routine stays *maintained*. That is a different claim and must
  not be reported as if it were lifespan.
- **Time-to-fix a broken routine.** **Cannot be measured yet and has no honest
  proxy:** the interval starts when the Author learned it was broken, which nothing
  records before PRD 09. Listed so it is not quietly claimed.

### Guardrails

- **No routine corrupted by editing.** Every save validated at the store boundary
  by `assertRoutineDefinition` inside `save`; every save versioned (PRD 03); revert
  available.
- **No routine *deleted* by editing.** Distinct from the above and not implied by
  it: `save({ overwrite: true })` deletes the row whose name clashes.
  **Mechanism:** the editor never sends `overwrite`; a test asserts that a rename
  onto a taken name raises `RoutineNameConflictError` and leaves both rows present.
- **No edit lost to a concurrent repair write-back.** **Mechanism:**
  `expectedUpdatedAt`; a test saves an edit, then runs the write-back from a
  stale-read definition and asserts it is refused rather than applied.
- **Editing must not require understanding JSON.** A design constraint, not a
  metric; no mechanism proposed.

---

## 7. User Stories & Requirements

### Epic hypothesis

We believe that step-level editing will make routines maintainable, because fixing
one selector currently costs as much as authoring the whole routine. We will know we
are right when routines start accumulating `manual` versions instead of being
replaced by fresh ones.

### Story 1 — Editing a step's fields

**As** the Author, **I want** to change one step's fields, **so that** I can fix a
broken selector without touching anything else.

```gherkin
Scenario: Fixing a selector
  Given a user routine whose steps[5] clicks 'button#send'
  When I open the editor, select that step, change the selector to 'button[aria-label="Send message"]', and save
  Then the routine's definition has that selector at steps[5]
  And every other entry of the steps array is byte-identical to before
  And a routine_versions row with reason 'manual' holds the previous definition

Scenario: Fields match the step kind
  Given I select a step of kind 'type'
  Then I see exactly the fields STEP_FIELDS lists for 'type' — selector, text, submit, intent
  And no field belonging to another kind

Scenario: A cleared required field is reported on that field
  Given I clear the selector on a click step at index 5
  Then the selector field shows the message validateRoutineDefinition returns for path 'steps[5].selector'
  And Save is disabled while any field carries an error
  And no renderer-local validation rule produced that message

Scenario: Editing does not relabel where the routine came from
  Given a user routine with source 'import'
  When I edit a selector and save
  Then the routine's source is still 'import'
```

### Story 2 — Structural edits

**As** the Author, **I want** to add, remove, duplicate and reorder steps, **so
that** I can adapt a routine to a changed flow.

```gherkin
Scenario: Inserting a step
  Given a 12-step routine
  When I insert a wait step after step 5 and save
  Then the definition has 13 steps
  And steps[5] is the new wait step
  And steps[6] through steps[12] are the former steps[5] through steps[11], unchanged

Scenario: Reordering
  Given a routine whose steps[8] clicks 'button#pay'
  When I move that step above steps[6] and save
  Then steps[6] is that click
  And the remaining steps keep their previous relative order

Scenario: Deleting a step other steps depend on
  Given steps[3] extracts into "total" and steps[9] has "{{total}}" in its type text
  When I delete steps[3]
  Then a warning appears on the row for steps[9] saying {{total}} has no producer
  And Save stays enabled, because the warning is not a block
  And I can undo the delete before saving

Scenario: A literal {{...}} in a selector is not a dangling reference
  Given steps[1] clicks 'div[data-key="{{total}}"]' and no param or extract produces "total"
  Then no dangling-variable warning appears for steps[1]

Scenario: The last step cannot be deleted
  Given a routine with one step
  Then delete is unavailable on that step, because a definition with no steps cannot be saved
```

### Story 3 — Editing params

**As** the Author, **I want** to manage a routine's params, **so that** the run
form asks for the right inputs.

```gherkin
Scenario: Adding a required param
  When I add param "client" marked required with a description
  And save
  Then the routine's run form shows it, labelled with the description
  And running without a value is refused by the blank-required check in AutomationRow,
      which is the only place a required param is enforced — no main-process check exists

Scenario: Removing a param still referenced
  Given steps[2] has "{{client}}" in its type text
  When I remove the param "client"
  Then a warning names steps[2] and the field the reference sits in

Scenario: A param name the runtime cannot substitute
  When I name a param "my-var"
  Then the name field shows a blocking error
  And the reason given is that substitution matches {{\w+}} only, so {{my-var}} would resolve to an empty string at run time
```

### Story 4 — Saving safely

**As** the Author, **I want** a save to fail loudly rather than take something with
it, **so that** editing one routine cannot cost me another.

```gherkin
Scenario: Renaming onto a name another routine holds
  Given user routines named "Invoices" and "Payroll"
  When I rename "Payroll" to "invoices" and save
  Then the save is refused with the RoutineNameConflictError message
  And both routines still exist, because the editor did not send overwrite
  And my unsaved changes are still in the editor

Scenario: A run's repair write-back cannot overwrite a saved edit
  Given a routine whose updatedAt is T
  And a run of it in flight that will finish with one repair to stepIndex 3
  When I save an edit that reorders the steps, moving updatedAt past T
  Then the write-back is refused because expectedUpdatedAt no longer matches
  And the repair remains a proposal for review (PRD 03) rather than being applied
  And nothing is written at stepIndex 3 of the reordered definition
```

### Story 5 — Editing while a run is in progress

**As** the Author, **I want** to be told a routine is running rather than discover
it at save time, **so that** I do not type into a doomed form.

```gherkin
Scenario: This routine is running
  Given the automation:status payload reports running = { kind: 'user', id: this routine's id }
  Then the editor is read-only and states why
  When the run ends and the status broadcast arrives
  Then editing becomes available again

Scenario: A different routine is running
  Given running names another routine's id
  Then this routine stays editable
```

### Stories this PRD should not carry

Both are real requirements; neither can be delivered inside PRD 11. See §8.

**Reverting an edit.** Version history, the diff and revert are PRD 03's table,
`reason` column and UI. The editor links into them.

**Arriving from a problem.** "Edit this step" from a thread needs the thread, which
does not exist without PRD 01; the same applies to a rejected proposal (PRD 03) and
a failure group (PRD 09). Each button belongs as a requirement in the PRD that owns
that surface. PRD 11 owns only the deep-link parameter (§5).

### Constraints and edge cases

- **System routines are not editable, and the mechanism matters.** The editor has no
  write path to `system_routines`; a save would insert a new user routine instead.
  See §5 — "Duplicate as a user routine" is what ships in its place.
- A routine cannot be edited while a run of it is in progress (Story 5), which
  requires the new `running` field on `ExtensionStatus`.
- Edits invalidate pending repair proposals against changed steps (PRD 03's stale
  rule, which compares the step at that index to the proposal's `original`).
- A routine reduced to zero steps cannot be saved.

---

## 8. Out of Scope

- **Editing a routine mid-run.**
- **Raw JSON editing.** Export covers it (PRD 10).
- **Recording new steps into an existing routine from the browser.** Genuinely
  valuable — "record three more steps onto the end of this" — and a large feature
  touching the chat loop and the extension. Separate PRD if wanted.
- **Selector picking by clicking the page.** Requires an extension picker mode.
  Adjacent to PRD 12; deliberately not bundled.
- **Editing system routines.** Duplicate-then-edit instead.
- **The version-history and revert surface.** PRD 03 builds it; the editor links to
  it. See the decomposition below.
- **The "edit this step" buttons in other features' UIs.** PRD 01, 03 and 09 own
  those surfaces.

### Recommended decomposition

This is the largest renderer investment in the set, and the seam is clean.
Recommendation: **ship (a) as PRD 11, keep (b) if the phase has room, and move (c)
and (d) out.**

| Slice | Contents | Where it belongs |
|---|---|---|
| **(a) Field-level editing of an existing user routine** | Stories 1, 3, 4, 5; the structured validator; the `save` hardening; duplicate-as-user-routine | **PRD 11.** Needs no version-history UI of its own — only PRD 03's gate, for the write-back race. |
| **(b) Structural edits and reference analysis** | Story 2 | PRD 11 if the phase has room, else a follow-on. Independent of (a) beyond the shared save path. |
| **(c) Version history and revert** | the revert story | **PRD 03.** Its table, its `reason` column, its diff and revert UI. Building the surface here duplicates 03's work. |
| **(d) Deep-link entry points** | the arriving-from-a-problem story | **PRD 01, 03 and 09.** Each is a button in a surface those PRDs build. PRD 11 keeps only the parameter the editor accepts. |

---

## 9. Dependencies & Risks

### Dependencies

- **PRD 03 — hard.** Two structural reasons, not conveniences:
  1. **The repair write-back overwrites an editor's save.** After any user-routine
     run that produced repairs, the `IpcChannels.automationRun` handler in
     [ipc.ts](../../src/main/ipc.ts) re-reads the row and saves
     `applyRepairs(user.definition, result.repairs)`, keyed by `repair.stepIndex`,
     with no version or timestamp check. An edit saved while the run was in flight
     is replaced by a definition read before it existed; and if the edit reordered
     or inserted steps, the repair lands on whatever step now occupies that index.
     `applyRepairs` guards only that a replacement is same-kind and single-step
     (AI_CONTEXT §8), which a wrong-index click-for-click replacement passes
     cleanly. PRD 03 turns that write into a reviewable proposal; this PRD adds
     `expectedUpdatedAt` so the race is refused rather than silently won.
  2. **Two of the five original stories are revert.** Without 03 the editor invents
     its own history table, which 03 then replaces.
- **PRD 06** (a step kind worth hand-adding) and **PRD 09** (knowing which step to
  open) — benefits, not dependencies. README.md's table is the authority.
- **PRD 01** — not a dependency in that table, but two things this PRD wants are
  unavailable without it: the deep-link entry points (§8, slice (d)) and every
  metric that needs run history (§6). It also owned the renderer-framework decision
  ([IMPLEMENTATION-ORDER.md](../IMPLEMENTATION-ORDER.md), "Cross-cutting decision
  this phase owns"), and made it: verified 2026-08-27, the renderer is React 19 with
  per-component CSS modules, bundled by electron-vite. This PRD inherits that.

### Documentation the change must amend

AI_CONTEXT.md becomes wrong when this ships, and its §13 requires the update in the
same change:

- **§8 — an invariant is weakened (rule 4).** Today: *"User-routine validation lives
  in `UserRoutineStore.save`. Its `unknown` parameter is the contract. Not in
  handlers, not in the renderer."* The renderer clause is what this PRD breaks. The
  amended wording must keep the store boundary as the sole **authority** — every
  write still passes `assertRoutineDefinition` inside `save` — while allowing the
  renderer to run the same shared collector for feedback, and never to be the only
  thing that ran.
- **§5 (rule 1).** New exported symbols in `shared/routines.ts`:
  `validateRoutineDefinition` and `STEP_FIELDS`.
- **§6 (rule 2).** `ExtensionStatus.running`;
  `SaveUserRoutineInput.expectedUpdatedAt`; `UserRoutine['source']` gains
  `'derived'`; `user_routines` gains `derived_from`.
- **§10 (rule 5).** The "adding a step kind" recipe gains a consequence rather than
  a step: `STEP_FIELDS` becomes the editor's field source, so a kind added there
  reaches the editor automatically. That is the argument for exporting it rather
  than copying it.
- Nothing here resolves or introduces §12 drift.

### Risks

| Risk | Mitigation |
|---|---|
| **The renderer becomes the codebase's problem area.** The 306-line vanilla-TS `main.ts` this risk was written about is gone. There is now a component model — `App.tsx` over `components/`, `state/` hooks per IPC surface, `lib/run-model.ts` for derived view data, and design tokens in `styles/tokens.css`. A step editor is still the largest UI in the product, and three things it needs are still absent: any routing or view-state model (`App.tsx` chooses its detail pane on `runs.selected` alone, so an editor has nowhere to live but a fourth pane or a modal neither exists), form primitives beyond the single-line `Field` in `components/ui.tsx`, and tokens for warning-but-not-error and read-only states. | The framework decision was PRD 01's and is made; what remains here is building on it. The CSP still bounds it: [index.html](../../src/renderer/index.html) pins `script-src 'self'` with no `unsafe-eval`, so bundled dependencies only — no CDN, no runtime template compilation. The dev websocket allowance is injected by `devHmrCsp` in [electron.vite.config.ts](../../electron.vite.config.ts) and must never be added to the HTML (AI_CONTEXT §9). No direct break, since this PRD rules out a syntax-highlighting editor. |
| **Editing enables breaking.** An Author can now damage a working routine by hand. | Versioning and revert (PRD 03); validation at the store boundary on every save; non-blocking reference warnings. |
| **A rename silently deletes a different routine** (`save` with `overwrite: true`). | The editor never sends `overwrite`; the conflict is surfaced on the name field; §6 carries it as its own guardrail with a test. |
| **An edit is lost to a repair write-back** that read the definition before the edit existed. | `expectedUpdatedAt` on `save`, plus PRD 03's gate turning the write-back into a proposal. This is why 03 is hard. |
| **Steps edited to reference variables nothing produces** substitute empty strings silently at run time (`resolveStep` in shared/routines.ts, on both backends; `resolveTemplate` in orchestrator.ts). | Check scoped to the four substituted slots, reusing the runtime's own regex, reported as a warning. The over-warning risk is real and is the reason for the scoping: a whole-definition check would flag a literal `{{…}}` in a CSS selector, which AI_CONTEXT §6 deliberately supports. |
| **Editors invite scope creep** — recording, picking, previewing, debugging. | Those are PRD 12, PRD 13, and the out-of-scope list. The decomposition above is the same discipline applied to this PRD's own contents. |

---

## 10. Open Questions

**Resolved in this revision** — recorded so they are not reopened:

- *Does the renderer need a component framework?* Not this PRD's call, and no longer
  a question: PRD 01 owned it and shipped React 19 with CSS modules (verified
  2026-08-27). The constraint this PRD contributes is the CSP one in §9's risk table.
  What the editor still has to build for itself is listed in that same row.
- *Should "duplicate a system routine as a user routine" ship with this?* **Yes.**
  Without it every prebuilt routine is a dead end, and §5 specifies the `'derived'`
  source and `derived_from` column it needs.
- *Is a dangling-variable check a warning or a hard error?* **A warning**, scoped to
  the four substituted slots, with the surface named in §5. A param name that fails
  `^\w+$` is the one hard error, because the runtime could never substitute it.

**Still open:**

- 🔵 Should this PRD add the one field that would make re-records countable — a
  `replaces` column on `user_routines` — given the primary outcome in §6 cannot be
  measured without it? It needs a UI gesture that does not exist ("this replaces
  X"), so it is not free.
- 🔵 Should a derived copy show its upstream version and flag when `updates/` moves
  past it? Out of scope here; a candidate for PRD 09.
- 🔵 Should `expectedUpdatedAt` be required rather than optional on `save`? Required
  is stronger, and would force the chat-save and repair write-back callers to
  change; optional protects only callers that opt in.
- 🔶 **Assumption:** Authors think in steps, not JSON. Strongly held and untested;
  the whole UI rests on it.

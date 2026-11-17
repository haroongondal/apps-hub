# PRD 10 — Routine export & import

| | |
|---|---|
| **Phase** | Durability |
| **Depends on** | Nothing |
| **Blocks** | Nothing |
| **Status** | Draft |
| **Author** | hmukhtar@outsentia.com |

Shared personas and strategic context: [README.md](README.md).

Depends on nothing, per the dependency table in [README.md](README.md), which is the
one authority. Nothing in this PRD may require PRD 01's run tables or PRD 03's
`routine_versions` — where an earlier draft did, the requirement has been rewritten
rather than the dependency added.

---

## 1. Executive Summary

We're building **routine export and import** — routines as portable files — for
**the Author** to solve the problem that a routine can only ever leave the machine
it was made on by being rebuilt from scratch, which will make routines shareable,
backupable and version-controllable, and finish a code path the schema already
anticipates but nothing can reach.

It is a small feature with one hard part. An imported routine is executable content
aimed at a real logged-in browser, and the review screen that is supposed to make
that safe **cannot see the thing it most needs to see**. §5 states that limit
plainly rather than designing around it.

---

## 2. Problem Statement

### Who has this problem?

The Author, whenever a routine needs to exist anywhere other than where it was
made — a second machine, a colleague, a backup, a repository.

### What is the problem?

Routines are trapped in one SQLite file, and the escape hatch was designed but
never built.

- `UserRoutine.source` is typed `'chat' | 'import'` (`UserRoutine` in
  [types.ts](../../src/shared/types.ts)), the store accepts both
  (`UserRoutineStore.save` in [user-routines.ts](../../src/main/db/user-routines.ts)),
  and the schema constrains the column to exactly those two values
  (`CHECK (source IN ('chat', 'import'))` in `MIGRATIONS`,
  [database.ts](../../src/main/db/database.ts)).
  Still true as of 2026-08-27. Note that PRD 01 added a **second, unrelated**
  `source` column: `runs.source` is `CHECK (source IN ('routine', 'chat'))` and says
  how a run was started. Nothing in this PRD touches it, and the two must not be
  conflated when grepping.
- Nothing in the application ever *produces* `'import'`. The only creation path is
  chat-save: the `IpcChannels.automationChatSave` handler in `registerIpcHandlers`
  ([ipc.ts](../../src/main/ipc.ts)) calls `UserRoutineStore.save` with
  `source: 'chat'`.
- A **generic writer already exists**, though, and this matters for §6. The repair
  write-back in the `IpcChannels.automationRun` handler passes `source: user.source`
  straight through when it persists `applyRepairs` output. So
  [IMPLEMENTATION-ORDER.md](../IMPLEMENTATION-ORDER.md)'s "`source: 'import'` is
  validated everywhere and written nowhere" is true only because nothing produces
  the value — the moment this ships, that handler will re-persist it, and an
  imported routine that heals stays labelled `'import'`.
- There is no export path either. `api.user` in
  [preload/index.ts](../../src/preload/index.ts) exposes `list`, `get`, `save` and
  `remove`, and no serialisation.

The system-routine path proves that *a* file format works: `updates/*.json` files
are read, validated and synced wholesale by `syncFromDir` and `parseRoutineFile`
([system-routines.ts](../../src/main/db/system-routines.ts)), and two examples ship.
That format is read-only and app-managed; the user cannot put their own routine into
it and get it back out again. §5 explains why the export format is a *sibling* of
it rather than an extension of it.

### Why is it painful?

- **User impact.** A routine represents real authoring effort — a chat run driven
  to completion, then repaired over subsequent runs. Losing it to a reinstall, or
  rebuilding it on a second machine, wastes all of that. 🔶 **Assumption:** Authors
  want to share routines with colleagues. Plausible for a client-delivery context,
  unvalidated.
- **Business impact.** No shareability means every user starts from an empty list,
  and there is no way to distribute a working routine to someone who needs it.

### Evidence

- **Code.** The unreachable `'import'` source is the clearest statement of intent
  in the codebase: the design anticipated this feature and it was never finished.
- **Structural, and only half of what an earlier draft claimed.**
  `assertRoutineDefinition` ([routines.ts](../../src/shared/routines.ts)) validates
  untrusted JSON into a `RoutineDefinition`, strictly in both directions — missing
  required fields *and* unknown keys are errors. But it validates a **definition
  only**: it does not `JSON.parse`, and it knows nothing about a name, a
  description, or a version. "The import validator exists" is therefore **false**
  for the file wrapper. Half the validator exists; §5 specifies the other half.

---

## 3. Target Users & Personas

**Primary: The Author** — wants routines to be files.

**Secondary: The Operator** — receives a routine someone else made and runs it.

**Job-to-be-done:** *When I have a routine that works, I want it to exist as a file
I control, so it survives this machine.*

---

## 4. Strategic Context

**Ladders up to:** durability of authoring effort — the outcome's "trusted"
half. 🔶 **Assumption:** a routine you can lose is one you invest less in. It is a
plausible read of why the `'import'` slot was reserved and never filled, and it is
not evidenced — nobody has been asked.

**Why now.** It is small, independent, blocks nothing and is blocked by nothing,
which is exactly why it sits in the last phase — every earlier slot is held by
something with a dependent. It is the right piece to build when the foundation and
unattended phases are done and the appetite is for a quick, complete win.

---

## 5. Solution Overview

### Format

A JSON wrapper carrying a **format version**, the routine's name and description,
and its definition. One file per routine, human-readable and diffable — a routine
belongs in git.

```json
{
  "formatVersion": 1,
  "name": "Invoice pull",
  "description": "Pulls last month's invoices",
  "definition": { "params": {}, "steps": [] }
}
```

**This is a sibling of the `updates/` format, not a superset of it.** An earlier
draft said "the `updates/` JSON shape, extended", and that is wrong in both
directions. `parseRoutineFile` requires two keys this format does not have:

| `updates/` key | What `parseRoutineFile` demands | In the export format? |
|---|---|---|
| `id` | a string matching `ID_PATTERN` | **no** |
| `version` | a positive safe integer — the **routine's** version, not a format version | **no** |
| `name` | non-empty string | yes |
| `description` | string, null, or absent | yes |
| `definition` | passed to `assertRoutineDefinition` | yes |
| `formatVersion` | *rejected — not a key it reads* | yes |

Two consequences to state rather than discover:

- **An exported file dropped into `updates/` fails.** `parseRoutineFile` throws
  `id must match /^[a-z0-9][a-z0-9._-]*$/i`, `syncFromDir` catches it into
  `SyncResult.errors`, and the only place that surfaces is the `syncErrors` list
  the `useAutomations` hook reads from `system.lastSync()` and `AutomationRail`
  renders above its two groups. Quiet, but not silent.
- **A system routine does not round-trip.** Exporting one drops its `id` and its
  routine `version`; putting the file back into `updates/` means re-adding both by
  hand. That is intended — §8 keeps `updates/` the app's read-only source of truth.

Reusing `version` for the format version was considered and rejected: the same key
would mean "the routine changed" in one folder and "the file layout changed" in
another, and `parseRoutineFile` already owns the first meaning.

**No app-specific binary format, no archive.** JSON, because the whole point is that
the file is legible outside the app.

### Export

**Both a user routine and a system routine can be exported**, and a system routine
re-imports as a user copy with `source: 'import'`. An earlier draft said "from a
routine" in one place and "a user routine" in another; this is the resolution.
Exporting a system routine is the most plausible sharing case there is — the
shipped examples are the only routines a new user has — and re-importing it as a
user copy is exactly what the `'import'` value was reserved for.

**Multi-select is out of scope for this PRD.** One routine, one Export button, one
file. Three earlier statements disagreed — "optionally" in §5, asserted behaviour
in §8, no story or acceptance criterion in §7 — and the cheapest resolution is the
smallest one. §10 carries it as an open question.

Export never includes run history, artifacts or version history — a routine is a
definition, not its biography.

### Export exposes secrets, and that is a requirement, not a caveat

Export is the direction an earlier draft did not consider at all. Three fields in
a routine hold free author-supplied text and all three ship in the file:

- **`type.text`** is a literal string. `assertWritableTarget` in
  [page-core.js](../../extension/page-core.js) refuses to *write into* a password or
  payment field, but it says nothing about what a routine types into an ordinary
  one — so an API key typed into a plain text input is recorded verbatim. With the
  credential vault cut from scope, hard-coded secrets in `type.text` are **more**
  likely, not less.
- **`params[name].default`** is `default: 'string?'` in `PARAM_FIELDS` — free text,
  and the natural place an Author parks a token so they do not retype it.
- **`description`** on a chat-saved routine is *the raw chat goal*: the
  `automationChatSave` handler passes `description: goal`. Whatever the Author
  typed as prose, including an account number, is in the file.

**Requirement.** Before a file is written, export lists every `type.text` literal,
every `params[*].default`, and the description, and offers to redact each one.
Redaction rewrites the literal to a `{{name}}` reference and registers
`params[name] = { required: true }` — which needs no new machinery: `resolveStep`
in [routines.ts](../../src/shared/routines.ts) already substitutes into
`navigate.url`, `type.text` and `select.value` for every backend, and
`AutomationRow` in
[AutomationRail.tsx](../../src/renderer/src/components/AutomationRail.tsx) already
seeds values from `defaultParams` and blocks a run whose `required` params are
blank. The recipient supplies their own value.

🔶 **Assumption:** Authors will read that list rather than click through it.
Untested, and it is the same bet the import review screen makes.

### Import

From the routines list: **Import**, opening a file picker. Nothing is written until
the Author confirms.

**The wrapper needs a validator that does not exist.** `UserRoutineStore.save`
destructures six known keys — `id`, `name`, `description`, `definition`, `source`,
`overwrite` — and **never rejects extras**. So `save({ formatVersion: 99, name,
definition })` succeeds silently today, and a file from a newer format would import
as though it were current. That directly contradicts §7's refusal constraint, and
the refusal cannot live in the handler or the renderer without breaking
[AI_CONTEXT.md](../../AI_CONTEXT.md) §8's single validation boundary.

Two changes, both at the store boundary:

1. **`assertRoutineFile(value: unknown): RoutineFile`**, exported from
   `shared/routines.ts` beside `assertRoutineDefinition` and `MAX_WAIT_MS`, with
   `ROUTINE_FILE_FORMAT_VERSION = 1` beside it. It accepts exactly four keys —
   `formatVersion`, `name`, `description`, `definition` — rejects any other key
   (matching `assertRoutineDefinition`'s strictness in both directions), enforces
   `name` non-empty and ≤ 120 characters to match `save`, and delegates
   `definition` to `assertRoutineDefinition`.
2. **`UserRoutineStore.save` rejects unknown keys** in its own payload. Without
   this, `IpcChannels.userSave` stays an open back door: it is already reachable
   from the renderer, so a raw file passed through it would bypass
   `assertRoutineFile` entirely.

`UserRoutineStore` owns the calling of both, so the validation boundary is still
one place.

A file that fails validation is rejected with the validator's own message, which is
already specific — `steps[3].selector is required`.

Imported routines are saved with `source: 'import'`, finally reaching the value the
schema has always allowed. Name conflicts reuse the existing conflict semantics:
`UserRoutineStore.save`'s transaction throws `RoutineNameConflictError` unless the
payload carries `overwrite: true`. No second conflict policy is invented — but §9
records what the existing one destroys.

### Safety, and the part of it that does not work

An imported routine is executable content: it will drive the user's real,
logged-in browser. Import therefore shows what it is about to add — step count,
navigation destinations, required params, and a **flag on steps that may commit
something** — and requires confirmation. This is a review screen, not a silent file
copy.

**The committing flag is a heuristic, and a weak one.** An earlier draft promised
"the same vocabulary the extension already recognises". The engine's `isCommitting`
in [page-core.js](../../extension/page-core.js) — shared by both backends — makes
four tests, and three of them read a **live resolved element**:

| Test in `isCommitting` | Decidable from static JSON? |
|---|---|
| `step.kind === 'type' && step.submit` | **yes** — it is step data |
| `el.form && el.tagName === 'INPUT'` → `type` is `submit`/`image` | no — needs the DOM |
| `el.form && el.tagName === 'BUTTON' && el.type === 'submit'` | no — needs the DOM |
| `COMMIT_WORDS.test(accessibleText(el))` | no — `accessibleText` reads the element |

So the review screen gets exactly one reliable signal: **`type` steps with
`submit: true`**. Everything else is a scan of `selector` and `intent` against
`COMMIT_WORDS`, and both of those are strings the file's author chose. That makes
the scan advisory in both directions: an author who wants a committing click to
look harmless writes `#btn-1` or `button.primary`, and a harmless link whose
selector mentions an order gets flagged for nothing.

**State it plainly on the screen: an opaque `click` selector cannot be classified
before it runs.** This is the feature's residual risk and there is no design that
removes it, because the information does not exist in the file. Worse, the
engine's own answer arrives too late to help: in `ACTIONS.click`, `isCommitting`
is computed and then the click is dispatched regardless — `committing: true` routes the
*aftermath* to a human instead of the healer
([AI_CONTEXT.md](../../AI_CONTEXT.md) §8) rather than gating the click. The review
screen is the only gate that exists before a committing click executes, and it is
partially blind.

**Navigation destinations have the same blind spot, for a different reason.** Both
shipped routines use `"url": "{{url}}"`, and `resolveStep` substitutes params only
at run time — so at review time `new URL('{{url}}')` throws. A parameterised
`navigate` **has no reviewable destination**. The review screen must therefore
report navigation in three categories, not one:

- a literal URL — show its origin;
- a `{{param}}` URL — show *"destination supplied at run time"* plus the param name
  and its declared `default` if there is one;
- a URL that mixes both — show the literal prefix and mark the rest as run-time.

`assertNavigable` is the only protocol allowlist, and it runs at execution time on
the resolved URL. It exists **once per backend** — in
[background.js](../../extension/background.js) for the extension, and exported from
[playwright-session.ts](../../src/main/automation/playwright-session.ts) for the
default backend, which calls it in `execute` before `goto`. Review does not
substitute for either.

---

## 6. Success Metrics

Nothing in the product records an export or a rejection today, and PRD 01's run
tables would not either — they record runs. Each metric below therefore names a
mechanism or admits it has none.

### Primary

**Routine portability** — share of user routines exported at least once.

- **Cannot be measured today.** Export writes nothing to the database, and no
  table has anywhere to put the fact.
- **Mechanism, if the metric is kept:** append one `MIGRATIONS` entry adding
  `user_routines.exported_at INTEGER` (nullable, no default — the table is
  `STRICT`), set by the export handler after a successful write; `toModel` in
  `user-routines.ts` and `UserRoutine` in `shared/types.ts` gain `exportedAt`.
  Append-only, never editing a shipped entry — [AI_CONTEXT.md](../../AI_CONTEXT.md)
  §10. A `system_routines` equivalent is impossible: every sync deletes all rows.
- **Proxy until then:** none in-app. 🔵 **Open Question:** is one schema column
  worth a metric nobody can read remotely, or should this metric be dropped and
  the secondary one promoted? Decide before building, not after.
- Current: 0% (impossible). Target: 🔵 **Open Question** — no basis for a number
  before the feature exists.

### Secondary

- **Imported routine share** — `SELECT source, COUNT(*) FROM user_routines GROUP BY
  source`. **Mechanism:** SQL against the local database. It is genuinely
  queryable, which is more than the primary metric manages, but no UI reads it and
  nothing leaves the machine — so it is measurable only on a machine someone can
  open, one at a time. The first non-zero value closes a gap the schema has carried
  since the first migration. It survives repairs: the `automationRun` write-back
  passes `source` through (§2).
- **Import rejection rate.** **No mechanism, and no honest proxy.** A rejection is
  a thrown `Error`; only its *message* crosses IPC
  ([AI_CONTEXT.md](../../AI_CONTEXT.md) §8), the renderer shows it once and
  discards it. Nothing counts attempts, so there is no denominator either. The
  substitute is qualitative: which validator message recurs among the Authors we
  can actually talk to. n is small and self-selected — do not report it as a rate.

### Guardrails

- **No invalid routine ever enters the database.** **Mechanism:** validation stays
  at the store boundary, now covering the wrapper as well as the definition;
  asserted by a new `describe('assertRoutineFile')` in
  [tests/routines.test.ts](../../tests/routines.test.ts) and by the user-routine
  section of [tests/db.verify.ts](../../tests/db.verify.ts) under `npm run test:db`.
- **No silent overwrite.** **Mechanism:** `RoutineNameConflictError` unless
  `overwrite: true`, and `overwrite` is set only by an explicit choice on the review
  screen. `db.verify.ts` already asserts both the conflict throw and its
  case-insensitivity; add an assertion that the import path never sets `overwrite`
  by default.

---

## 7. User Stories & Requirements

### Epic hypothesis

We believe that making routines portable files will protect authoring effort and
allow sharing, because a routine currently cannot leave its machine and the schema
already reserves a slot for imported ones.

### Story 1 — Export

**As** the Author, **I want** to export a routine to a file, **so that** it
survives this machine.

```gherkin
Scenario: Exporting one routine
  Given a user routine "Invoice pull" with 12 steps and 2 params
  When I export it and choose a destination in the save dialog
  Then a JSON file is written at that destination
  And it contains formatVersion, name, description and definition, and no other key
  And re-importing that file produces an identical definition

Scenario: Exporting a system routine
  Given the shipped routine "Web Health Check"
  When I export it
  Then the file carries neither its id nor its routine version
  And importing it creates a user routine with source 'import'

Scenario: The destination is the Author's choice
  Given the save dialog is open with a default filename derived from the routine name
  When I pick a path where a file of that name already exists
  Then the dialog asks me to confirm replacing it
  And cancelling the dialog writes nothing

Scenario: Export excludes anything that is not the definition
  Given a routine that has been repaired twice and run many times
  When I export it
  Then the file contains only formatVersion, name, description and the current definition
  And it carries no id, no source, no created or updated timestamp

Scenario: Export surfaces literal values before writing
  Given a routine with a type step whose text is "sk-live-abc123"
  And a param whose default is "acct-99812"
  When I export it
  Then both values are shown to me before the file is written
  And I can redact each one
  And a redacted type step becomes "{{secret}}" with params.secret marked required
```

The fourth scenario deliberately says "repaired twice and run many times" rather
than naming counts of stored runs or versions. An earlier draft said "40 recorded
runs and 6 stored versions", which is untestable without PRD 01's `runs` table and
PRD 03's `routine_versions` — a dependency the README table says this PRD does not
have. What export must exclude is defined by the four keys it emits, which is
testable today.

### Story 2 — Import

**As** the Author, **I want** to import a routine file, **so that** I can use one
made elsewhere.

```gherkin
Scenario: Importing a valid routine
  Given a valid exported routine file
  When I import it and confirm the review screen
  Then a user routine is created with source 'import'
  And the routines list refreshes without me reloading the window

Scenario: An invalid file is rejected clearly
  Given a file whose steps[3] has no selector
  When I import it
  Then no routine is created
  And the error shown is the validator's own message

Scenario: A file from a newer format is refused, not guessed at
  Given a file whose formatVersion is 2
  When I import it
  Then no routine is created
  And the message says the file was written by a newer version of the app

Scenario: A file with no formatVersion is not an export file
  Given a JSON file holding a bare name and definition
  When I import it
  Then it is refused for a missing formatVersion, not defaulted to 1

Scenario: A name conflict is a decision
  Given an existing routine named "Invoice pull"
  When I import a file named "invoice pull"
  Then the conflict is detected despite the different casing
  And I am asked to overwrite, rename, or cancel
  And overwriting is not the default choice
  And nothing changes until I choose

Scenario: Overwriting says what it will destroy
  Given an existing chat-authored routine named "Invoice pull" with 9 steps
  When I choose to overwrite it with a 12-step import
  Then I am told the existing definition will be replaced and cannot be recovered
```

The refresh in the first scenario is not free: the import must
`broadcast(IpcChannels.changed)` after the save, the way the `userSave` and
`userDelete` handlers already do. Without it the `onRoutinesChanged` subscription
in `useAutomations` never fires, its `refresh` never re-runs, and "appears in the
routines list" simply does not happen.

### Story 3 — Knowing what you are importing

**As** the Author, **I want** to see what an imported routine will do, **so that**
I do not run someone else's automation blind against my logged-in browser.

```gherkin
Scenario: The review screen summarises the routine
  Given an import file with 12 steps and 2 required params
  When the review screen opens
  Then it lists the step count and every required param with its description
  And nothing is saved until I confirm

Scenario: Literal destinations are named
  Given a navigate step whose url is "https://billing.example.com/invoices"
  When the review screen opens
  Then billing.example.com is listed as a destination

Scenario: A parameterised destination has no reviewable destination
  Given a navigate step whose url is "{{url}}"
  When the review screen opens
  Then it reports the destination as supplied at run time
  And names the param "url" and its declared default if there is one
  And it does not attempt to parse "{{url}}" as a URL

Scenario: A definite committing step is flagged as definite
  Given a type step with submit true
  When the review screen opens
  Then that step is flagged as committing, without qualification

Scenario: A heuristic match is labelled as a heuristic
  Given a click step whose selector is "button.checkout-submit"
  When the review screen opens
  Then that step is flagged as possibly committing
  And the flag says it is a guess from the selector text

Scenario: An opaque selector is declared unclassifiable
  Given a click step whose selector is "#btn-1" with no intent
  When the review screen opens
  Then that step is shown as one whose effect cannot be determined before it runs
  And the screen says so rather than showing it as safe
```

The last scenario is the acceptance criterion that matters most, and the one an
earlier draft could not have passed: it forbids the review screen from presenting
absence of evidence as evidence of safety.

### Constraints and edge cases

**Format versioning and backward compatibility.**

- The key is `formatVersion`. Its first shipped value is `1`, held by
  `ROUTINE_FILE_FORMAT_VERSION` in `shared/routines.ts` — the same file that owns
  `MAX_WAIT_MS`, so format constants sit together.
- A file whose `formatVersion` is absent is **refused**, not defaulted to 1. A file
  without one is not an export file.
- A file whose `formatVersion` exceeds the constant is refused with a message
  naming the app, not the validator: *"this file was written by a newer version of
  the app"*.
- **Every future build must still read `formatVersion: 1`.** Raising the constant
  obliges the reader to keep every lower version readable; this PRD defines no
  deprecation path. If a future v2 changes the definition shape, `assertRoutineFile`
  migrates a v1 wrapper forward before calling `assertRoutineDefinition` — v1 does
  not become unreadable. A feature whose entire premise is portable files does not
  get to drop a format after one release.

**Unsupported step kinds.** `assertStep` already refuses an unknown kind with
`steps[N] has unknown kind "X"`. The "you need a newer app" wording must be added
by the import path **around** that message, not inside `assertStep` — that function
is shared with `parseRoutineFile`, and rewording it would put app-upgrade advice
into `updates/` sync errors, where it would be wrong.

🔵 **Open Question:** should a v1 file with one unsupported step import with that
step flagged, rather than being refused whole? `assertRoutineDefinition` refuses
the whole definition today, which is the safe default and what this PRD specifies.

**Repair proposals.** *If* PRD 03 has shipped, exporting a routine with pending
proposals exports the current definition; proposals are local state. This is a
conditional, not a dependency — with PRD 03 absent there are no proposals and the
rule is vacuous.

---

## 8. Out of Scope

- **A routine marketplace, registry, or sync service.** Files only.
- **Multi-select and bundling.** One routine, one file, one Export button. §10
  carries multi-select as an open question; there is no story or acceptance
  criterion for it here, and there should not be a stray promise of it elsewhere.
- **Exporting run history or threads.** A routine is its definition.
- **Signing or verifying routine files.** The review screen is the trust mechanism
  this PRD ships — and §5 is explicit that it is a partial one, since an opaque
  `click` selector cannot be classified before it runs. Signing changes who you
  trust, not what you can see, so it does not close that gap; it becomes relevant
  if distribution ever becomes a channel rather than a file hand-off.
- **Importing into `updates/`.** That folder stays the app's read-only source of
  truth ([CLAUDE.md](../../CLAUDE.md)). §5 records what happens if someone drops an
  export file there anyway.
- **Redacting automatically.** Export surfaces literal values and offers redaction;
  it does not guess which strings are secrets.

---

## 9. Dependencies & Risks

### Dependencies

**On other PRDs: none.** The dependency table in [README.md](README.md) is the
authority and lists none; no requirement above needs PRD 01 or PRD 03.

**On code changes: more than an earlier draft admitted.** "None. Validator, store
and conflict semantics all exist. This is a serialiser, a file dialog, and a review
screen" was wrong on two counts: the validator covers only the definition (§2), and
**the renderer cannot open a file dialog or touch the filesystem at all**. The
window is created with `sandbox: true`, `contextIsolation: true`,
`nodeIntegration: false` ([index.ts](../../src/main/index.ts)), the packaged CSP is
pinned to `default-src 'self'` ([index.html](../../src/renderer/index.html)), and
`grep -rn dialog src/` finds no Electron `dialog` usage anywhere. Every dialog and
every `fs` call lives in main.

**Two new `IpcChannels` entries**, each following the four-place recipe in
[AI_CONTEXT.md](../../AI_CONTEXT.md) §10:

| | `userExport` | `userImportPreview` |
|---|---|---|
| Channel name | `routines:user:export` | `routines:user:importPreview` |
| `shared/ipc.ts` | add to `IpcChannels` | add to `IpcChannels` |
| `main/ipc.ts` | `handle(...)` in `registerIpcHandlers`: shape-check `{ kind, id }` the way `assertRunRoutineInput` already does, look the routine up in `deps.system` or `deps.user`, build the wrapper, `dialog.showSaveDialog`, write the file | `handle(...)`: `dialog.showOpenDialog`, `fs.readFileSync`, `JSON.parse`, then `UserRoutineStore`'s new read path; returns a preview and the detected name clash, **writes nothing** |
| `preload/index.ts` | `api.user.exportToFile(input)` | `api.user.importPreview()` |
| Renderer | an Export button in `AutomationRow` (`components/AutomationRail.tsx`), beside the existing Delete | an Import button in `AutomationRail`'s header, then the review screen |

The confirmed write reuses the **existing** `IpcChannels.userSave` with
`source: 'import'` and the Author's `overwrite` choice, so no third channel is
needed and `UserRoutineStore.save` stays the only writer. No new push channel is
needed either: `IpcChannels.changed` and its existing `onRoutinesChanged`
unsubscriber already drive `useAutomations`'s `refresh`.

**One `shared/routines.ts` addition:** `assertRoutineFile` and
`ROUTINE_FILE_FORMAT_VERSION`, plus a `RoutineFile` type in `shared/types.ts`.
**One `UserRoutineStore` addition:** a read path that calls `assertRoutineFile` and
reports a `getByName` clash, and unknown-key rejection in `save`.

**AI_CONTEXT.md must be updated in the same change** — §13 items 1 and 2 both
apply: two new channels and two new exported symbols, plus the §5 symbol index rows
for `assertRoutineFile` and `ROUTINE_FILE_FORMAT_VERSION`. If the `exported_at`
column of §6 ships, item 3's persistence note applies too.

### Risks

| Risk | Mitigation |
|---|---|
| **An imported routine is executable content aimed at the user's logged-in browser.** A malicious or careless file could navigate to an attacker's page and submit something. | The review screen: step count, destinations, required params, explicit confirmation. Never import silently. This is the whole risk of the feature and deserves the whole design attention. |
| **The review screen cannot classify an opaque `click`.** `isCommitting` needs a live element; from static JSON only `type` + `submit: true` is decidable. A hostile file can hide a committing click behind `#btn-1`. | No mitigation removes this — the information is not in the file. Accepted and disclosed: the screen labels heuristic flags as heuristic and names unclassifiable steps as unclassifiable. It must never render "no committing steps found" as reassurance. |
| **A parameterised `navigate` has no reviewable destination.** Both shipped routines use `{{url}}`, and `resolveStep` substitutes only at run time. | Report the destination as run-time-supplied and name the param; do not parse `{{url}}`. `assertNavigable` remains the only real protocol gate — once per backend, in `background.js` and in `playwright-session.ts` — and it runs later. |
| **Overwrite is irreversible until PRD 03 ships.** `UserRoutineStore.save`'s clash path runs `updateStmt` over the existing row, keeping its `id` and `created_at` and flipping `source` to `'import'`. A chat-authored definition is gone, with no version history to recover it. | Overwrite is never the default choice; the review screen states what will be replaced and that it cannot be recovered. Rename is free — the renderer simply sends a different `name`. Real undo waits for PRD 03's `routine_versions`. |
| **The clash is case-insensitive, which surprises people.** `user_routines.name` is `TEXT NOT NULL COLLATE NOCASE UNIQUE`, and `getByName`'s `WHERE name = ?` inherits that collation, so "Invoice pull" and "invoice pull" collide. | Say so in the conflict prompt: show the *existing* routine's exact casing next to the incoming name, so the collision is visible rather than baffling. |
| **An import can shadow a system routine's name.** `save` writes only `user_routines` and `UNIQUE` is per-table, so a user routine may take the exact name of a shipped one. The invariant is safe — `system_routines` rows are still never written directly, and `automationRun` dispatches on `kind` — but the sidebar shows two identically named entries. | `AutomationRail` already renders two separate `Group` sections, "Built in" and "Yours"; label them clearly enough that a duplicate name is legible rather than ambiguous. Do not add a cross-table uniqueness rule — that would put user data in charge of what `updates/` may be called. |
| **Export can carry secrets off the machine** in `type.text`, `params[*].default`, or a chat goal reused as `description`. | Surface all three before writing and offer per-value redaction to a required `{{param}}`. |
| **Format drift** between exported files and a later app version. | Version the format from the first release, refuse an unknown version rather than guessing, and keep every earlier version readable — the backward-compatibility rule in §7. |
| **Import brings no history, and people may expect it to.** 🔶 **Assumption** — nobody has asked; it is a guess about expectation, drawn from the fact that "export" elsewhere usually means "everything". | State plainly on both export and import that a file is a definition, not a record. |

---

## 10. Open Questions

- 🔵 Do Authors actually want to share routines, or only to back them up? Changes
  how much the review screen matters. Ask before building it.
- 🔵 Is the primary metric worth a schema column? §6 names `user_routines.exported_at`
  as the only mechanism that could record an export. The alternative is to drop the
  metric and promote `source = 'import'` counts. Decide before building.
- 🔵 Should multi-select export ship at all? §5 and §8 say no for now. A colleague
  receiving eight separate files may disagree, and that is the argument for a
  bundle — which §8 also excludes.
- 🔵 Should redaction on export default to on, given that the failure mode is a
  leaked credential and the cost of a false positive is one retyped value?
- 🔵 Should a v1 file containing one unsupported step kind import with that step
  flagged instead of being refused whole?
- 🔵 Should export include the routine's version history (PRD 03)? Leaning no — it
  is local provenance, not part of the definition.
- 🔶 **Assumption:** one file per routine is preferable to a bundle. Simpler, and
  git-friendly, but unvalidated.

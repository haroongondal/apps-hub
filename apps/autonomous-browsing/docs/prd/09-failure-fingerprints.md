# PRD 09 — Failure fingerprints

| | |
|---|---|
| **Phase** | Durability |
| **Depends on** | 01, 03, 06, 07 |
| **Blocks** | Nothing |
| **Status** | Draft |
| **Author** | hmukhtar@outsentia.com |

Shared personas and strategic context: [README.md](README.md). The dependency list
above is copied from [README.md](README.md)'s table, which is the one authority.
Earlier drafts of this header, of §9, and of
[IMPLEMENTATION-ORDER.md](../IMPLEMENTATION-ORDER.md) each named a different set;
**03 is a hard dependency, not a nice-to-have** — Story 2 needs the version history
that PRD 03 adds and Story 3 routes into PRD 03's accept path, and neither exists
without it.

---

## 1. Executive Summary

We're building **failure fingerprints** — automatic grouping of runs that failed
the same way — for **the Author** to solve the problem that every failure is
presented as a one-off, so a routine that has broken the same way for a fortnight
looks like fourteen unrelated incidents, which will turn repeated failures into one
diagnosable pattern with an obvious fix.

---

## 2. Problem Statement

### Who has this problem?

The Author, once there are enough runs for patterns to exist — which is to say,
once PRD 07 is generating them daily without supervision. §4 states the volume gate
as a number.

### What is the problem?

There is no failure identity, and — this is the part earlier drafts of this PRD got
wrong — **most of the failures worth grouping never appear as a failure at all.**

Read [README.md](README.md)'s *How a run ends today* first. Its consequence is
direct: `runWithRepair` in
[orchestrator.ts](../../src/main/automation/orchestrator.ts) converts every
exhausted healable error into `NeedsHumanError`, `runRoutine` catches it, calls
`holdForHuman`, and continues to the next step. So a step that failed for good
leaves exactly two traces:

- a `held` progress event, emitted by `reportHold`, whose `description` is
  `Step N needs you: <problem>. Do it in the browser, then press Resume.`
- the hold reason handed to `holdForHuman`, `step N needs you — <problem>`

and then the run reports **`assisted`, not `done`** — `reportHold` increments
`humanSteps` and `runRoutine`'s terminal `emit` is
`humanSteps > 0 ? 'assisted' : 'done'`. Either way `runs.error` is never written.
Four of the message shapes this PRD exists to group — selector-not-found, covered,
disabled, and the no-reaction verdict — reach the store *only* through those two
strings.

The failures that *do* write `runs.error` are the minority: a non-healable error
propagating out of the loop (`isHealable` in
[session.ts](../../src/main/automation/session.ts) rejects it), the credential
refusal, the scan-hold exhaustion, and infrastructure.

On top of that:

- Errors are deliberately descriptive rather than categorical —
  *"timed out waiting for #send — the best of 3 matches, `<button#send>`, is
  covered by `<div#consent>`"* ([HOW-IT-WORKS.md](../../HOW-IT-WORKS.md) §6,
  Layer 0). Excellent for a human reading one; useless as a grouping key, because
  the element details vary between runs of the same underlying problem.
- Repairs carry a model-written `reason` — free text, never twice the same.
- The hold reason and the `healing` description both embed a 1-based step number
  and, on some paths, an attempt count derived from a budget constant.

So the signal is rich, the shape is prose, and the prose is mostly not in the
column a reader would look in.

### Why is it painful?

- **User impact.** The Author sees N failures and has to notice the pattern
  themselves, by reading — and today the reading means opening N run threads and
  spotting the same hold reason in each. 🔶 **Assumption:** they will not, and the
  routine keeps failing — unvalidated, and exactly what this feature measures.
- **Business impact.** 🔶 **Assumption:** a self-healing product whose failures
  accumulate unnoticed reads to a user as a product that does not heal. Untested —
  no user has seen the healing layer's output aggregated, because nothing
  aggregates it. What is not an assumption is that every repair is already a drift
  signal the product throws away.

### Evidence

- **Code.** After PRD 01 the raw material exists — `runs.status`, `runs.error`,
  `runs.failed_step_index`, `runs.human_steps`, `run_events` (including
  `step_json`), `run_repairs`. No grouping is specified anywhere.
- **Structural.** `StepExecutionError` in
  [session.ts](../../src/main/automation/session.ts) prefixes messages with
  `step "<kind>" failed:`, which gives a usable coarse dimension for free — but
  **only for errors that class wraps.** The scan-hold exhaustion throw in
  `ExtensionSession.dispatch` is a plain `Error`, so it carries no prefix, and
  `isHealable` therefore rejects it. §5's class table says which sites do and do
  not carry the prefix.
- **Structural.** `runs.status = 'assisted'` with `human_steps > 0` (PRD 01 §5) is
  the only cheap marker of "a human had to step in", and is therefore the corpus
  filter this feature is built on.
- 🔵 **Open Question:** do failures actually cluster? Plausible — sites change once
  and then keep being changed — but unverified. §4's gate makes the answer a
  precondition rather than a hope.

---

## 3. Target Users & Personas

**Primary: The Author** — fixes routines and needs to know which one to fix.

**Secondary: The Operator** — 🔶 **Assumption:** wants to know whether today's
failure is new or the same one as yesterday, because that determines whether to
wait for it to heal or escalate to the Author. Untested; the Operator has never had
a repeat-failure signal to react to, so the wait-or-escalate motive is inferred
from the persona, not observed.

**Job-to-be-done:** *When a routine keeps failing, I want to see it as one problem
rather than many, so I fix it once.*

---

## 4. Strategic Context

**Ladders up to:** trusted unattended runs, by shortening the time between a
routine breaking and someone noticing.

**Why now — and why ninth.** This feature is worthless without volume, and "enough
volume" needs to be a number, because §9's *sequenced ninth* mitigation is
otherwise unenforceable.

**The corpus gate.** Do not start the UI until a query over PRD 01's tables
returns all three of:

| Gate | Threshold | Why this number |
|---|---|---|
| Routine runs on record | **≥ 400**, over **≥ 14 consecutive days** | 🔶 **Assumption:** ~30 runs/day, roughly ten routines on a daily PRD 07 schedule plus ad-hoc runs. PRD 07 §6's hold-rate metric is what will reveal the true rate; revise this from that, not from this document |
| Failure occurrences | **≥ 40** | at a 🔶 **assumed** 10% failure rate, what 400 runs yields |
| Distinct signatures with **≥ 3** occurrences | **≥ 3** | the falsifiable form of "do failures cluster?", and the same 3-member threshold §6's repeat-failure ratio uses. Fewer than three such groups means grouping three runs, which is not grouping |

All three are countable from `runs` and `run_events` with no new instrumentation,
which is what makes the gate enforceable rather than rhetorical. If the third row
never reaches 3, the honest outcome is to cut this PRD, not to ship it and hope —
see §10.

It also belongs after PRD 06, which makes failures well-named: an assertion failure
carries the Author's own message, which is a stable key by construction. Built
before the gate, it would group 🔶 **assumption:** a handful of manual failures the
Author already remembers — plausible from the current single-user, watched-run
usage pattern, but not observed.

---

## 5. Solution Overview

### Naming

[page-core.js](../../extension/page-core.js) — the one in-page engine, injected by
both backends — already uses the name `fingerprint`, for something else entirely:
`fingerprint(el)` is the layer-1 change detector that
`observe` diffs before and after an action to decide `changed`. Reusing the word for
this feature's key would collide on the one dimension that matters — a grep. So:
the feature is *failure fingerprints*, and the key it computes is a **failure
signature**, produced by `signatureOf(...)`. No code in this feature uses the word
*fingerprint*.

### The signature

A stable key computed from the parts of a failure that do not vary run to run:

```
routine_kind · routine_id · step_index · step_kind · failure_class · normalised_detail
```

`routine_kind` is in the key because `routine_id` is not unique on its own — a run
is addressed as `{kind, id}` by `IpcChannels.automationRun`, and PRD 01 §5 already
carries `routine_kind` on the `runs` row for exactly this reason.

**Deterministic, not model-derived.** No LLM call. A model asked to name a failure
class would produce a plausible name that differs slightly each time, which is
precisely the property being removed.

### Where the signature is computed, and from what

**In main, at failure ingest.** AI_CONTEXT.md §8's invariant is that only error
*messages* cross IPC — Electron drops custom fields and the preload strips the
invoke wrapper back off. A signature whose `failure_class` is a code cannot be
rebuilt on the renderer side of that boundary, and re-deriving it by matching on
message text in the renderer is the thing this PRD exists to stop doing. PRD 01 §5
sets the precedent in the same words: cancellation is classified by error identity
in main, because main has the real error object.

Concretely, the class is available at three points and nowhere else:

| Failure shape | Where it is classified | How the **step index** is recovered |
|---|---|---|
| Terminal error — a non-healable error left the run loop | `runRoutine`'s catch, from the error object | `runs.failed_step_index`, from the failing step index PRD 01 §5 adds to the terminal error event. Today that event emits `stepIndex: -1`; **if the index is absent or −1, the occurrence is stored unclassified and not grouped** — never guessed from the last `running` event |
| Layer-3 hold — `NeedsHumanError` caught, human did the step, run continues | `runRoutine`'s `NeedsHumanError` catch, where `error.problem`, `index` and `step` are all in scope | `index` directly. This is why classification hooks the catch and not the hold event |
| Scan-hold exhaustion — `dispatch` hit `MAX_HELD_RETRIES` | `runRoutine`'s catch; the throw is a plain `Error` so `isHealable` rejects it and the run ends `error` | as the terminal-error row above |

**The hold event is a correlation key, not a classification source.** PRD 01 §5 adds
`runId` and `stepIndex` to `AutomationHoldEvent`, and that `stepIndex` is what ties
a persisted hold row to a run. It cannot classify, because `AutomationHoldEvent`'s
`automatic` flag is `false` for *both* a layer-3 hold (`holdForHuman` →
`bridge.pause`) and the user pressing Pause in the app (`IpcChannels.automationPause`
→ `bridge.pause`); only a scan hold arrives with `automatic: true`, from the
extension. Reading `automatic: false` as "a step failed" would fingerprint every
manual pause.

The corpus is therefore selected as: every `runs` row with `status = 'error'`, plus
every row with `status = 'assisted'` (`human_steps > 0`), plus PRD 07's
`abandoned` terminal status. `done` rows contribute nothing, `cancelled` and `interrupted`
are excluded (§8), and `held` is not terminal so it is never ingested.

### `failure_class` — derived from the real throw sites

A closed set, one entry per distinguishable condition. It is longer than the nine an
earlier draft named, because that draft was assembled from prose rather than from the
code. Only **three** entries come from the `rank` ladder in
[page-core.js](../../extension/page-core.js) — `rank` returns 1, 2, 3, 4 and `explain`
turns the first three into sentences. The rest come from other files, which is
why the earlier claim that the classes "map directly to conditions the content script
already distinguishes by rank" was wrong in a way that mattered: it implied one
classification site where there are several.

**Read the origin column as two columns.** `page-core.js` is the one in-page engine
and **both** backends inject it — the extension loads it before `content.js`,
`PlaywrightSession` bundles it via `?raw` and injects it per document — so every class
originating there is reachable on both. Everything else in the table originates in one
backend's transport and is reachable only there, which the *Backend* notes below the
table now record. A classifier written against the extension's message shapes alone
would silently produce no groups for the default backend.

Everything reaching main through the in-page engine's `{ ok: false, error }` reply is
wrapped into `StepExecutionError` — by `ExtensionSession.runStep` on one backend and
`PlaywrightSession.runStep` on the other — so it carries the `step "<kind>" failed:`
prefix. Two documented exceptions, both marked below: the scan-hold exhaustion throw,
and PRD 06's `AssertionFailedError`, which deliberately does not extend
`StepExecutionError` so `isHealable` rejects it untouched.

| Class | Origin — file · symbol | Backend | Trigger |
|---|---|---|---|
| `selector-not-found` | page-core.js · `explain` | both | `count === 0` — **not** a rank |
| `selector-not-visible` | page-core.js · `rank` | both | rank 1. An earlier draft omitted this; rank 1 exists |
| `selector-disabled` | page-core.js · `rank` | both | rank 2 |
| `selector-covered` | page-core.js · `rank` | both | rank 3 |
| `selector-invalid` | page-core.js · `queryAll` | both | `"<sel>" is not a valid selector` |
| `credential-refused` | page-core.js · `assertWritableTarget` | both | `refusing to write into <a password field\|a payment field\|a one-time-code field> …` — **the only non-healable `StepExecutionError`**; the `REFUSAL` regex in session.ts clears `healable`, so it skips healer and hold and ends the run `error` |
| `editor-write-failed` | page-core.js · `setValue` | both | `could not type into this editor` |
| `no-reaction` | page-core.js · `observe` → orchestrator's `NO_REACTION` | both | `changed: false`. **No throw at all** — goes to the healer |
| `no-reaction-committing` | page-core.js · `isCommitting` | both | `changed: false` **and** committing — skips the healer and raises `NeedsHumanError` on the first attempt. Same message, different remedy, so a different class |
| `navigate-url-invalid` | `assertNavigable` — **duplicated verbatim** in background.js and playwright-session.ts | both | `navigation blocked: "<url>" is not a valid URL` |
| `navigate-protocol-blocked` | as above | both | `navigation blocked: <proto> is not allowed (http and https only)` |
| `navigate-timeout` | background.js · `navigate` | extension | `navigation to <url> timed out`. Playwright's equivalent is `page.goto`'s own timeout text, bounded by `NAV_TIMEOUT_MS` — same condition, different words, so the mapper must produce this class from both |
| `navigate-rejected` | background.js · `navigate` | extension | whatever `chrome.tabs.update` rejected with — Chrome's own text, not ours |
| `page-departed` | playwright-session.ts · `departedResult` | playwright | `the page navigated away while this step was waiting — <cause>`, raised when the `DESTROYED` regex matches on a non-mutating step. The extension has no equivalent |
| `screenshot-tab-inactive` | background.js · `capture` | extension | `the automated tab is no longer the visible one in its window …`. AI_CONTEXT.md §9 calls this the likeliest real-world step failure, so it gets its own class. **Structurally unreachable on Playwright**, which screenshots the page object with no active-tab precondition |
| `screenshot-failed` | background.js · `capture` | extension | `could not screenshot the tab: <cause>`. Playwright's screenshot failures are Playwright's own text, bounded by `SCREENSHOT_TIMEOUT_MS`, and map onto this class |
| `injection-blocked` | background.js · `runStep` | extension | `cannot act on this page: <cause>`. Playwright's equivalent is `callHooks`'s `the automation agent could not be injected into this page`, which maps onto this class |
| `no-target-tab` | background.js · `targetTab` | extension | `no target tab` |
| `held-password` | page-core.js · `scanSensitive`, surfaced by `dispatch` in **both** extension-session.ts and playwright-session.ts | both | `password field` |
| `held-payment` | as above | both | `payment field` |
| `held-one-time-code` | as above | both | `one-time code` |
| `held-captcha` | as above | both | `CAPTCHA` |
| `held-bot-wall` | as above, from the `WALL` entries `SENSITIVE` now spreads in | both | `DataDome bot check`, `PerimeterX bot check`, `Akamai bot check`, `Imperva bot check`, `AWS WAF CAPTCHA`, `Cloudflare check`, `Cloudflare block`, `firewall block` — see the note below; these did not exist when the class list was drawn |
| `held-unknown` | extension-session.ts · `dispatch` | extension | its `?? 'sensitive field detected'` fallback. `PlaywrightSession.dispatch` has no such fallback — `scanHold()` returns the reason or `null` — so this class cannot arise there |
| `extension-disconnected` | extension-bridge.ts · `ExtensionNotConnectedError` | extension | infrastructure; grouped nowhere (§8) |
| `tab-closed` | extension-bridge.ts · `failAllPending` | extension | plain `Error('the automated tab was closed')`; infrastructure |
| `indeterminate` | extension-bridge.ts · `StepIndeterminateError` | both | infrastructure. `playwright-session.ts` imports the class from `extension-bridge.ts` and throws it from `withTimeout`, so this is one class from one constructor across both backends |
| `extension-version-mismatch` | extension-session.ts · `connect` | extension | handshake refusal; infrastructure |
| `browser-launch-failed` | chrome-process.ts · `launch` | playwright | no Chrome executable found, or another process holds the automation profile. Infrastructure, and the Playwright counterpart of `extension-disconnected` |
| `assertion-failed` | PRD 06's `assert` step · `AssertionFailedError` | both | the Author's own `message` — the highest-quality key in the set, because it is stable by construction |
| `hold-abandoned` | PRD 07 | both | its `abandoned` terminal status |
| `extract-unreadable` | orchestrator · `extractWithRepair` | both | `could not read <sel>` — see the gaps below |

**Three rows are new since this table was drawn**, all of them consequences of changes
that landed after the 2026-08-20 audit rather than of anything this PRD decides:
`held-bot-wall` (the `WALL` list `SENSITIVE` now spreads in), `page-departed` and
`browser-launch-failed` (both Playwright-only throw sites). They follow §6's
*prefer over-splitting* guardrail — a distinguishable condition gets its own class —
rather than introducing a new rule. Review them as you would any class: the alternative
is a bot-wall hold silently falling through the `held-*` set into nothing.

Four notes the table cannot carry:

- **`navigation-failed` was three throws, now four classes.** An earlier draft merged
  the `assertNavigable` pair, the timeout and the `chrome.tabs.update` rejection into
  one. Four throws, four remedies; §6's *prefer over-splitting* guardrail applies.
  `assertNavigable` is now **duplicated verbatim** in `background.js` and exported from
  `playwright-session.ts`, so its two classes are byte-identical across backends and
  need no mapping at all — which is the exception, not the rule, in this table.
- **`held-sensitive` was four causes and is now more.** `scanSensitive` returns a
  description from `SENSITIVE`, and `SENSITIVE` today spreads in the whole `WALL` list
  on top of its password / payment / one-time-code / CAPTCHA entries — so the
  descriptions a hold can carry include `DataDome bot check`, `Cloudflare block`,
  `firewall block` and the rest. One class would contradict the same guardrail; so
  would leaving the wall descriptions to fall through the `held-*` set, which is what
  the table did before `held-bot-wall` was added to it. Three properties of that throw
  site also matter: it raises a plain `Error`, **not** a `StepExecutionError`, so it is
  one of the two places the `step "<kind>" failed:` prefix is absent — a parser
  assuming the prefix drops these entirely; its message embeds `${attempt + 1}`, a
  count derived from `MAX_HELD_RETRIES` that must be normalised away or a change to
  that budget silently forks every held group; and **the two backends word it
  differently** — `the extension held this step N times (<cause>) — …` against
  `this step was held N times (<cause>) — …` — so a parser matching one misses the
  other entirely. The `<cause>` in parentheses is the part that carries the class, and
  it is identical on both, because both read it from the same `scanSensitive`.
- **`extractWithRepair`'s exhaustion discards the underlying class**, replacing the
  original `StepExecutionError` with `could not read <sel>`. This PRD requires that
  throw to carry the first attempt's class forward, or every extract failure groups
  as one. By contrast `StepHealer.plan`'s `giveUp` verdicts are *reasons*, not
  classes: `NeedsHumanError` keeps `problem` separate from `reason` and `problem`
  retains the class, so the ingest must read `problem`, never `reason`.
- 🔶 **Assumption:** `credential-refused` is the most repeated failure the corpus
  will contain, because the credential vault was cut, so any routine that has to
  authenticate hits it on every run. Unverified, and the first thing the corpus
  settles.

**Resolved:** PRD 06 §5 now throws `AssertionFailedError`, which `isHealable` rejects
and which propagates out of the step loop, so an assertion failure is terminal and
writes `runs.error`. It deliberately does **not** extend `StepExecutionError`, so it
is the second place the `step "<kind>" failed:` prefix is absent, and it never reaches
the healer or a hold. This PRD depends on that, and `assertion-failed` is the
highest-quality key in the set because the Author wrote its `message` by hand. The
ingest table above still covers the `assisted` case, so nothing breaks if a future
assert variant holds instead.

### `normalised_detail` — from the step, not from the message

The rule an earlier draft gave was *strip the variable parts, leaving the selector
being resolved*, and it does not survive contact with two cases:

- a `navigate` step has **no selector**. Its detail is a URL, and by the time it
  fails `resolveStep` has substituted `{{param}}` values into it — so two runs of
  the same routine with different params produce different details and never group.
- the `describe(winner)` output inside `explain` names the *element that lost*, which
  varies between runs of one underlying problem.

So the rule inverts. **`normalised_detail` is derived from the step, not the
message**, which is possible because PRD 01 §5 persists `step_json` on the step
event:

| Class group | `normalised_detail` |
|---|---|
| `selector-*`, `no-reaction*`, `extract-unreadable` | the step's selector **as authored**, taken from `step_json`. Params are never substituted into selectors (AI_CONTEXT.md §6), so this is already stable |
| `navigate-*` | the step's `url` **as authored** — before `resolveStep` — reduced to scheme + host + path with the query string dropped, and `{{param}}` kept literal |
| `credential-refused` | the field description, already a closed set of three |
| `held-*` | empty; the class carries the whole cause |
| `assertion-failed` | PRD 06's Author-written `message`, verbatim |
| `screenshot-*`, `injection-blocked`, `no-target-tab`, infrastructure | empty |

Making the detail a function of `step_json` rather than of prose is what makes the
normaliser testable at all: its input is a step, not a sentence. The raw message is
still stored on the occurrence row, for the §6 guardrail detector and for a human
reading one failure.

### Data

A further entry appended to the `MIGRATIONS` array in
[database.ts](../../src/main/db/database.ts), landing after PRD 01's and PRD 03's.
Per AI_CONTEXT.md §10, append — never edit a shipped entry; `PRAGMA user_version` is
the cursor and the existing loop in `applyMigrations` applies it with no other
change. Both tables are `STRICT`, matching the two that exist. Written from **main**,
at failure ingest, for the reason argued above.

| Table | Holds |
|---|---|
| `failure_groups` | one row per signature: `signature` (PK), the six key components (`routine_kind`, `routine_id`, `step_index`, `step_kind`, `failure_class`, `normalised_detail`), `occurrences`, `first_seen_at`, `last_seen_at`, `first_run_id`, `last_run_id`, `state` (`active`/`resolved`), `resolved_at`, `clean_runs_since`, `first_seen_routine_version` (PRD 03's `routine_versions.version` current at first occurrence), `repairs_proposed`, `repairs_accepted` |
| `failure_occurrences` | one row per failure: `signature`, `run_id`, `step_index`, `at`, `raw_error` (the unnormalised message), `raw_detail` (the pre-normalisation selector or URL) |

Timestamps are `INTEGER` epoch-milliseconds, matching `loaded_at` and `updated_at`
on the existing tables.

**The foreign keys are the point of the design.** `failure_occurrences.run_id`
takes `REFERENCES runs(id) ON DELETE CASCADE` — `foreign_keys` is already `ON`,
set beside the WAL pragma in `openDatabase` — so PRD 01's retention purge takes the
occurrence rows with the runs. `failure_groups` has **no** foreign key to `runs`, so
`occurrences`, `first_seen_at` and `first_run_id` survive the purge of every run
that produced them. `first_run_id`/`last_run_id` are therefore
possibly-dangling ids, and the view must render a missing one as *run no longer
stored* rather than a broken link.

Indexes: `failure_groups(state, last_seen_at DESC)` for the default ordering,
`failure_groups(routine_kind, routine_id, state)` for the per-routine health signal,
`failure_occurrences(signature, at)` for the drill-down.

### Attaching the class at throw time — a change to both transports

§9 lists prose-parsing fragility as the main risk and the mitigation as *attach a
structured `failure_class` at throw time*. That mitigation is a change to the
in-page engine **and to both transports that carry its reply**, and naming it as one
is the difference between a shippable mitigation and a sentence. An earlier draft
called it an extension protocol change; that describes half of it, and the half it
leaves out is the default backend:

1. `exec` in [page-core.js](../../extension/page-core.js) — the single `try/catch`
   every `ACTIONS` throw funnels through — adds a `failureClass` field to
   `{ ok: false, error: error.message }`. **One edit, both backends**, because both
   inject `page-core.js`. This is the whole reason the engine was moved out of
   `content.js`.
2. Each transport must carry the new field, and **each drops it by default**:
   - `BridgeResult` in
     [extension-bridge.ts](../../src/main/automation/extension-bridge.ts) gains
     `failureClass?: string`, **and `ExtensionBridge.runStep`'s reply mapping must
     read it** — that mapping copies a fixed set of keys off the reply, so an
     unlisted field is silently dropped.
   - `ExecResult` in
     [playwright-session.ts](../../src/main/automation/playwright-session.ts) gains
     the same field, and `PlaywrightSession.execute` must preserve it on the paths
     that rebuild a result — `departedResult` and the `catch` that wraps a raw
     message — for the same reason.
   - `background.js`'s `reply` and `capture` / `navigate` / `targetTab` throw sites
     add it for the classes only that backend can raise.
   These are required changes, not optional ones, and doing one without the other
   yields a `failureClass` on half the runs.
3. `StepExecutionError` in [session.ts](../../src/main/automation/session.ts) gains
   `failureClass` beside `healable`; `ExtensionSession.runStep`/`extractText` **and**
   `PlaywrightSession.runStep`/`extractText` pass it through instead of rebuilding
   from `result.error`. Four construction sites, not two.
4. **`EXTENSION_VERSION` in
   [extension-bridge.ts](../../src/main/automation/extension-bridge.ts) and
   `version` in [extension/manifest.json](../../extension/manifest.json) bump
   together** — both read `1.10.0` today (verified 2026-08-27); what the requirement
   fixes is that they move to the *same* next value, not what that value is, since
   several unbuilt PRDs each want to claim the next bump.
   `ExtensionSession.connect` refuses a mismatched handshake outright and
   `tests/extension-session.test.ts` asserts `manifest.version ===
   EXTENSION_VERSION`, so a half-bump fails the suite and bricks every run on that
   backend. This is the AI_CONTEXT.md §8 invariant; it is also the last step of the
   §10 *adding a step kind* recipe, and applies for the same reason here. **The
   Playwright backend has no handshake and no version gate**, so it will happily run
   a stale injected engine — `page-core.js` is bundled into the main process at build
   time via `?raw`, so there is nothing to mismatch, but equally nothing to catch a
   transport left un-updated.
5. Parsing prose stays as a fallback for rows written before the bump, keyed off
   the absence of `failureClass`. The fallback parser must handle **both** backends'
   message shapes; §5's table records where they differ.
6. AI_CONTEXT.md §6 lists the affected types, so its §13 rule applies: update it in
   the same change.

**[browser-session.ts](../../src/main/automation/browser-session.ts) must emit the
identical class strings.** It satisfies `AutomationSession` at the type level and
that is all — AI_CONTEXT.md §8's parity note was corrected on exactly this point:
`BrowserSession.holdForHuman` throws unconditionally so layer 3 cannot park there,
its `runStep` never returns `changed`/`committing` so layer 1 does not exist, and
its `extractText` throws a bare `Error` so an extract failure is unhealable there
and healable on the extension. Consequences for this PRD: `no-reaction*` and every
`held-*` class are unreachable on that backend, and its Playwright errors carry none
of the message shapes above. So the mapper belongs in a shared module —
`src/main/automation/failure-class.ts`, exporting `classify(error)` and
`signatureOf(...)` — that both sessions call, with `BrowserSession` mapping
Playwright's `TimeoutError` and locator states onto the same closed set. A backend
that produces its own class vocabulary produces its own groups, which is worse than
no grouping.

### The view

Failures grouped by signature, ordered by `state` then `last_seen_at`:

> **`Invoice pull` step 6 — selector covered** · 14 runs · first seen 5 Aug, last
> seen today · every run since 5 Aug
>
> Repairs proposed: 14 · accepted: 0

Each group opens to its runs, its threads, and — the useful part — its **repair
history**. 🔶 **Assumption:** the same step repaired the same way on fourteen
consecutive runs is an overwhelming accept signal for PRD 03's queue. Explicitly
untested — §6's third secondary metric exists to test it, by comparing acceptance
rates inside and outside this view, and it is entirely possible that repetition
reads as *this repair does not stick* instead.

### IPC surface and where the view lives

Following AI_CONTEXT.md §10's *adding an IPC channel* recipe, in order:

1. `IpcChannels` in [shared/ipc.ts](../../src/shared/ipc.ts) gains
   `failuresList: 'failures:list'`, `failuresGet: 'failures:get'`,
   `failuresResolve: 'failures:resolve'` and the push channel
   `failuresChanged: 'failures:changed'`.
2. A `handle(...)` per invoke channel in `registerIpcHandlers` in
   [main/ipc.ts](../../src/main/ipc.ts), behind the existing `trustSender`
   allowlist, shape-checking its payload there.
3. A method per channel on `api` in [preload/index.ts](../../src/preload/index.ts),
   plus `onFailuresChanged(listener): () => void` for the push channel — the
   unsubscriber shape the four existing push listeners already use
   (`onRoutinesChanged`, `onProgress`, `onStatusChanged`, `onHold`).
4. The renderer.

**The new-signature event §8 promises PRD 08 is not this channel.** PRD 08 runs in
main and subscribes to the ingest hook directly; `failures:changed` exists only so
an open renderer refreshes its list. Routing a notification through the renderer
would mean no notification when no window is open, which is the case PRD 08 is for.

**Renderer.** [src/renderer/src/main.ts](../../src/renderer/src/main.ts) is 306
lines of vanilla TS with no router and no list-detail primitive. PRD 01 §9 already
commits to splitting it into `routines/` and `runs/` modules as part of that work,
and PRD 01 owns that decision. This PRD's failures view is a **third module** reusing
the rail-and-detail pattern PRD 01 establishes; it must not be built before that
split, or it re-invents one.

### Signals worth surfacing

- **First seen** — the date the routine started breaking. 🔶 **Assumption:** usually
  the date the site changed. Untested, and the *broke after* signal below is what
  will separate the two.
- **Broke after** — whether the first occurrence follows a routine edit or a repair
  acceptance, read from `first_seen_routine_version` against PRD 03's
  `routine_versions`. Turns "it broke" into "it broke when we changed it".
- **Still failing / resolved** — see the resolution rule in §6.

### Routine health

Four states, in strict precedence order, computed from `failure_groups` and the last
`HEALTHY_RUN_WINDOW` = 🔶 **Assumption:** 3 runs of that routine:

| State | Rule |
|---|---|
| `failing` | at least one `failure_groups` row for this routine with `state = 'active'`. Shows the highest-`occurrences` group and its count |
| `assisted` | no active group, but at least one of the last 3 runs has `status = 'assisted'`. Shows the summed `human_steps` |
| `healthy` | no active group, and all of the last 3 runs are `status = 'done'` |
| `unknown` | fewer than 3 runs on record |

Precedence is `failing` > `assisted` > `healthy` > `unknown`, so every routine lands
in exactly one state and Story 4 is testable. Surfaced beside the routine so an
Author with twenty routines can see which need attention without opening anything.

---

## 6. Success Metrics

### Primary

**Occurrences-to-fix** — the number of occurrences of a signature between its first
and its resolution. Counted rather than timed, because a weekly routine and a
15-minute schedule produce wildly different elapsed times for the same neglect.

- **Mechanism:** `failure_groups.occurrences`, read at the moment `state` flips to
  `resolved`.
- **Baseline:** computable retrospectively. `signatureOf` is deterministic and reads
  `step_json`, so a one-off backfill over stored `runs`/`run_events` rows produces
  the pre-feature distribution without waiting for new data. That backfill is the
  same code path the §4 gate query uses, and it is the honest baseline — not a
  guess.
- **Target:** 🔶 **Assumption:** median ≤ 3 occurrences, against whatever the backfill
  shows. A goal, not a forecast.

**Resolution is defined, not assumed.** A group flips to `resolved` when either:

- `clean_runs_since` reaches **3** — incremented on every run of that routine that
  reaches the group's `step_index` without producing an occurrence, reset to 0 by a
  new occurrence; **or**
- **30 days** pass with no occurrence, which covers a routine that runs weekly and
  would otherwise wait three weeks for the first rule.

It reopens on the next occurrence, keeping its original `first_seen_at`. 🔶
**Assumption** on both numbers, and the second exists specifically because the first
is run-rate-dependent.

### Secondary

- **Repeat-failure ratio** — occurrences belonging to a group with **≥ 3**
  occurrences ÷ all occurrences. The same 3 the §4 gate uses, so the gate and the
  metric cannot disagree.
  - **Mechanism:** a join of `failure_occurrences` to `failure_groups`.
  - **Target:** 🔶 **Assumption:** ≥ 0.5 confirms the premise. **Below 0.2 the
    feature's premise is false** and §10's cut question fires — a genuinely useful
    thing to learn.
- **Grouping accuracy** — **cannot be measured automatically**, and pretending
  otherwise is how a wrong grouping ships. Manual mechanism: sample **30 groups with
  ≥ 2 members** (or all of them, if fewer than 30 exist), one reviewer reads each
  group's run threads and judges whether every member shares a cause. **Pass mark:
  ≥ 27 of 30 pure (90%).** Automatable proxy, run nightly: flag any signature whose
  `failure_occurrences.raw_detail` values contain more than **2** distinct strings —
  one authored selector plus at most one repaired replacement is expected; three or
  more means `normalised_detail` collapsed something it should not have.
- **Acceptance rate of repairs surfaced through group view**, against PRD 03's
  general rate.
  - **Mechanism:** requires PRD 03 to record *where* an accept came from — a
    `source` column on its proposal table, values `queue` / `group-view`. Name it as
    a dependency change, because without it this metric is unmeasurable.
  - **Target:** 🔶 **Assumption:** ≥ 2× PRD 03's queue rate. Below 1× falsifies the
    repetition-as-accept-signal claim in §5.

### Guardrails

- **No false merging.** Two different causes in one group destroys trust in the
  view. Prefer over-splitting; a group of one is honest.
  - **Threshold:** the inverse of the accuracy pass mark — **> 10% impure groups in
    a sample of 30 blocks the release.**
  - **Detector:** the nightly `raw_detail` cardinality check above. Note that two
    different `failure_class` values cannot merge *by construction*, since the class
    is part of the key; the only reachable merge is an over-eager
    `normalised_detail`, which is exactly what that detector watches.
- **No model calls.** Grouping must stay free and deterministic.
  - **Mechanism:** PRD 02's cost meter. A run's token count must be byte-identical
    with and without this feature enabled; the ingest write happens after the
    terminal event, off the step path.

---

## 7. User Stories & Requirements

### Epic hypothesis

We believe that grouping identical failures will collapse the time between a
routine breaking and it being fixed, because today fourteen occurrences of one
problem present as fourteen unrelated failures. We will know we are right when
recurring failures are fixed after fewer occurrences than the pre-feature baseline
the §6 backfill produces.

### Story 1 — Failures group

**As** the Author, **I want** identical failures grouped, **so that** I see one
problem instead of many.

```gherkin
Scenario: Repeated identical failures form one group
  Given 14 runs of "Invoice pull" that each held at step 6 with the selector covered
  And each of those runs reported status 'assisted' with human_steps 1
  When I open the failures view
  Then one group shows 14 occurrences with first and last seen dates
  And opening it lists all 14 runs with links to their threads

Scenario: A failure that never wrote runs.error is still grouped
  Given a run that reported 'assisted' because step 6 exhausted its repair budget
  And runs.error is null for that run
  Then the occurrence is ingested from the NeedsHumanError catch, not from runs.error

Scenario: Different causes stay separate
  Given a run that failed at step 6 with the selector covered
  And a run that failed at step 6 because the selector was not found
  Then two groups exist, not one

Scenario: Two sensitive-field holds with different causes stay separate
  Given a run that exhausted its held retries on a password field
  And a run that exhausted its held retries on a CAPTCHA
  Then two groups exist, held-password and held-captcha

Scenario: The same cause across different routines stays separate
  Given two routines failing on a similar consent dialog
  Then each has its own group, because a fix applies per routine

Scenario: Params do not fork a navigate group
  Given a routine whose step 1 navigates to '{{host}}/invoices'
  And two runs of it with different {{host}} values that both timed out
  Then one group exists, keyed on the authored url

Scenario: A failure with no recoverable step index is not grouped
  Given a terminal error event carrying stepIndex -1
  Then the occurrence is stored unclassified and appears in no group
```

### Story 2 — When it started

**As** the Author, **I want** to know when a failure first appeared and what
preceded it, **so that** I can tell a site change from something I did.

Requires PRD 03: `user_routines` today has only `created_at` and `updated_at`, and
`updated_at` is overwritten in place, so there is no edit history to point at.
`first_seen_routine_version` is meaningless until `routine_versions` exists.

```gherkin
Scenario: First occurrence is dated
  Given a group whose earliest run was 5 August
  When I open it
  Then it shows first seen 5 August and the run count since

Scenario: A failure that follows a routine change says so
  Given a routine at routine_versions version 4, written on 4 August
  And a signature first seen on 5 August with first_seen_routine_version 4
  When I open the group
  Then it names version 4 as the edit that immediately preceded the first occurrence

Scenario: A group outlives the runs that produced it
  Given a group of 14 occurrences whose runs have been purged by PRD 01's retention cap
  When I open it
  Then it still shows 14 occurrences with first and last seen dates
  And each purged run renders as 'run no longer stored' rather than a broken link
```

### Story 3 — Repetition as an accept signal

**As** the Author, **I want** to see that the same repair keeps being proposed,
**so that** I can accept it once and end the failure.

Requires PRD 03: there is no accept path to route into otherwise, and the accepted
repair has nowhere to be written as a version.

```gherkin
Scenario: A consistently proposed repair is highlighted
  Given a group of 14 occurrences
  And each proposed the same replacement selector
  When I open the group
  Then it states that the same repair was proposed on all 14
  And offers to accept it, applying PRD 03's accept path with source 'group-view'

Scenario: Accepting closes the group
  Given I accept that repair
  When 3 subsequent runs of the routine reach step 6 without an occurrence
  Then clean_runs_since reaches 3 and the group state becomes 'resolved'

Scenario: A resolved group reopens rather than duplicating
  Given a resolved group
  When the same signature occurs again
  Then that group returns to 'active' keeping its original first_seen_at
```

### Story 4 — Routine health at a glance

**As** the Author with many routines, **I want** health surfaced per routine, **so
that** I know where to look.

```gherkin
Scenario: A routine with no active group and three clean runs is healthy
  Given routine A whose last 3 runs are status 'done'
  And no failure_groups row for A with state 'active'
  When I open the routines list
  Then A shows healthy

Scenario: An active group outranks recent successes
  Given routine B with one active group of 14 occurrences
  And B's last 3 runs are status 'done'
  Then B shows failing, with 14 occurrences

Scenario: Human intervention without an active group is its own state
  Given routine C with no active group
  And one of C's last 3 runs is status 'assisted' with human_steps 2
  Then C shows assisted, with 2 human steps

Scenario: Too few runs is not health
  Given routine D with 2 runs on record
  Then D shows unknown, not healthy
```

### Non-functional requirements

- **NFR-1 — Grouping is computed at write time, never at read time.** The signature
  is computed once at ingest, and the `failure_groups` upsert happens in the same
  transaction as the `failure_occurrences` insert. Read-time grouping is not an
  option here rather than merely slower: PRD 01's retention purge deletes the
  `run_events` rows a read-time grouper would re-parse, so groups would silently
  shrink as runs aged out. Aggregates on the group row are the fix.
- **NFR-2 — Write timing relative to PRD 01's purge.** Ingest runs in the same
  transaction that closes the `runs` row on a terminal status, so it always precedes
  any purge. PRD 01's cap (🔶 **Assumption:** 200 runs or 30 days) then cascades
  `failure_occurrences` away and leaves `failure_groups` intact — see the foreign-key
  note in §5.
- **NFR-3 — Query cost at corpus scale.** The failures view must open in **< 150 ms**
  at **10 000 runs and 2 000 occurrences**, from the indexes named in §5, as a
  single `SELECT` over `failure_groups` with no join to `runs`. **Measured in
  `tests/db.verify.ts` behind `npm run test:db`, not in vitest** — AI_CONTEXT.md §9's
  trap applies: `postinstall` rebuilds better-sqlite3 against Electron's ABI, so
  plain Node cannot load it and `npm test` cannot touch the database.
- **NFR-4 — Zero cost on the step path.** No model call, and no measurable addition
  to run duration; the ingest write happens after the terminal event.
- **NFR-5 — One class vocabulary across backends.** `classify` and `signatureOf`
  live in `src/main/automation/failure-class.ts` and are the only producers of a
  class string, for both `ExtensionSession` and `BrowserSession`.

### Constraints and edge cases

- A routine edited so step indices shift breaks signature continuity. `step_kind`
  and the authored selector are in the key so a pure reorder does not fabricate a
  new group; accept that a genuine edit closes the old group, which is correct.
- Groups decay per the §6 resolution rule; a resolved group reopens rather than
  duplicating.
- Retention interacts with PRD 01's purge exactly as NFR-2 describes: counts and
  dates live on the group row precisely so they survive it.
- A `held` run is never ingested — it is not a terminal status (PRD 01 §5) and
  resolves to another one.

---

## 8. Out of Scope

- **Chat runs.** `runChatGoal` in
  [orchestrator.ts](../../src/main/automation/orchestrator.ts) has no `RoutineRun`,
  so `runs.routine_id` is null and the signature has no routine identity to key on.
  It also never calls `holdForHuman`, so layer 3 does not exist on that path; its
  budget is `MAX_CHAT_FAILURES` (3 consecutive) and its recovery is *look at the
  page again*, not a repair worth grouping. **Rows with `source = 'chat'` are not
  ingested.** They remain individually readable through PRD 01's thread view.
- **Infrastructure failures.** `extension-disconnected`, `tab-closed`,
  `indeterminate` and `extension-version-mismatch` are classified and written to
  `failure_occurrences`, but produce **no `failure_groups` row**. They are properties
  of the machine and the socket, not of a routine, and grouping them per routine
  would file one lost socket under whichever routine happened to be running.
  Surfaced instead as an app-level count, not as routine health.
- **Cancellation.** `RunCancelledError` is a user decision, mapped by PRD 01 to
  `status = 'cancelled'`. Not a failure and not ingested. `RunPausedError` likewise
  never reaches ingest — `throughPauses` in the orchestrator retries the step
  indefinitely rather than letting it out.
- **Cross-routine grouping.** Story 1's third scenario is the decision: a fix applies
  per routine, so two routines breaking on the same consent dialog get two groups.
  🔵 **Open Question:** a secondary roll-up over `(failure_class,
  normalised_detail)` across routines would catch a site-wide change once instead of
  N times. Deliberately deferred until the corpus shows it happens.
- **Automatic fixing.** Grouping surfaces the pattern and routes to PRD 03's accept
  path. It does not decide.
- **Cross-user or cross-machine aggregation.** Single-user, local product.
- **Model-assisted failure summarisation.** Deterministic grouping only, argued
  above. A model-written summary *inside* an established group is a reasonable
  future addition; the key itself must never be model-derived.
- **Alerting on a new signature** — that is PRD 08's channel; this PRD only emits
  the event, in main, at ingest.

---

## 9. Dependencies & Risks

### Dependencies

Matching [README.md](README.md)'s table, which is the authority:

- **PRD 01** — the whole measurement substrate. Specifically: `runs.status` with
  `assisted`, `runs.human_steps`, `runs.failed_step_index`, the failing step index
  on the terminal error event, absolute step indexes, `step_json` on the step event,
  `onRepair` firing on the failure path, `runId`/`stepIndex` on
  `AutomationHoldEvent`, and the `routines/`–`runs/` renderer split.
- **PRD 03** — **hard, not optional.** Story 2 needs `routine_versions`, because
  `user_routines` has only `updated_at` and overwrites it in place. Story 3 routes
  into PRD 03's accept path. §6's third secondary metric needs a `source` column on
  PRD 03's proposal table.
- **PRD 06** — materially improves grouping quality: an assertion failure carries an
  Author-written message, which is a stable key by construction rather than by
  normalisation.
- **PRD 07** — for the run volume §4 quantifies.

### Risks

| Risk | Mitigation |
|---|---|
| **Normalisation is the whole feature and is easy to get wrong.** Too aggressive merges unrelated failures; too loose groups nothing. | Derive `normalised_detail` from `step_json`, not from prose (§5) — the normaliser's input becomes a step object, which is directly testable. Build it test-first against real recorded errors from PRD 01's backfill before any UI exists. Prefer over-splitting. Run §6's nightly `raw_detail` cardinality detector. |
| **Error message format changes silently break grouping.** Errors are prose composed in five files. | Attach `failureClass` at throw time. That is an **extension protocol change**, specified as §5's six numbered steps — of which step 4 is the one a plan forgets: **`EXTENSION_VERSION` in `extension-bridge.ts` and `version` in `extension/manifest.json` bump together, 1.4.0 → 1.5.0**, because `tests/extension-session.test.ts` asserts they agree and `ExtensionSession.connect` refuses a mismatch. Parse prose only as a fallback for pre-bump rows. |
| **The two backends produce different class vocabularies.** `browser-session.ts` matches `AutomationSession` at the type level only (AI_CONTEXT.md §8), throws bare `Error`s, and cannot reach layer 3 at all. | `classify`/`signatureOf` live in one shared module both sessions call (NFR-5). `BrowserSession` maps Playwright's `TimeoutError` and locator states onto the same closed set; `no-reaction*` and `held-*` are documented as unreachable there rather than silently absent. |
| **The feature ships before there is data to group.** | §4's three-row corpus gate, all of it countable from PRD 01's tables today. The gate is the release condition: if fewer than 3 signatures have 3+ occurrences, do not build the UI. |
| **Groups become another queue nobody empties.** | Surface as routine health beside the routine (§5's four-state rule), not only in a separate view. |
| **The renderer grows a third job.** The failures view lands in a 306-line vanilla-TS file with no routing. | Build on PRD 01's `routines/`–`runs/` split as a third module; do not start before it lands. PRD 01 owns that decision. |

---

## 10. Open Questions

- 🔵 Do failures actually cluster? The premise. §4's gate and §6's repeat-failure
  ratio are the two places it gets answered; a ratio below 0.2 means this PRD should
  be cut rather than built.
- 🔵 Is the signature key right? `routine_kind · routine_id · step_index · step_kind
  · failure_class · normalised_detail` is a first proposal that only the §6 backfill
  over real data can validate. Re-running the backfill with variant keys and
  comparing group counts is cheap and should happen before the UI.
- 🔵 Should `extractWithRepair`'s exhaustion carry the original class forward, or
  should extract failures simply not be grouped? §5 requires the former; the latter
  is less code and loses a class that may turn out to be rare.
- 🔵 Should the class-at-throw-time refactor happen during PRD 01, while those error
  paths are already open? It would avoid a second `EXTENSION_VERSION` bump. Against:
  PRD 01 is already the largest PRD, and this makes it larger.
- 🔵 Should infrastructure classes get a machine-level group of their own rather than
  only a count? §8 defers it.
- 🔶 **Assumption:** 3 clean runs or 30 days resolves a group; `HEALTHY_RUN_WINDOW`
  is 3 runs; the §4 gate is 400 runs over 14 days. Every one of those numbers is
  chosen rather than derived, and each names in §4 or §6 what would revise it.

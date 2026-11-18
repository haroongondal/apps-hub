# PRD 06 — `assert` step kind

| | |
|---|---|
| **Phase** | Unattended |
| **Depends on** | Nothing, to ship. **Soft: PRD 01** for one acceptance criterion in §7 and for both run-level metrics in §6 |
| **Blocks** | **PRD 09, hard** — see the dependency table in [README.md](README.md). Also sharply improves PRD 07 |
| **Status** | Draft |
| **Author** | hmukhtar@outsentia.com |

Shared personas and strategic context: [README.md](README.md). Read its
**How a run ends today** section before §5 — the distinction it draws between a scan
hold and a layer-3 hold is what §5 turns on.

---

## 1. Executive Summary

We're building an **`assert` step kind** — a step that states what must be true and
**fails the run** when it is not — for **the Author** to solve the problem that a
routine can complete every step successfully while having achieved nothing, which
will let routines fail loudly instead of returning a false success, and give
unattended runs a definition of "worked" that is stronger than "did not error".

Small in concept, wider in wiring than it looks: one step kind, but **seven code
files, a new error class, and seven contract changes in
[AI_CONTEXT.md](../../AI_CONTEXT.md)**. Seven of the eleven wiring points §9
tabulates fail *silently* if missed, and two of the requirements have to be
implemented **twice, once per backend** — landing either in `background.js` alone
leaves the feature broken on the Playwright backend, which is the default.

---

## 2. Problem Statement

### Who has this problem?

The Author, who cannot express what the routine is supposed to have accomplished.
The Operator, who reads "Finished" and believes it.

### What is the problem?

A run reports success when every step executes without throwing. There is no step
kind that expresses an expected outcome.

- The eight step kinds are `navigate`, `click`, `type`, `select`, `wait`, `scroll`,
  `screenshot`, `extract` — the `ActionStep` union in
  [types.ts](../../src/shared/types.ts). None makes a claim about the page.
- The verification layer answers "did the page react at all?" — a `changed` boolean
  from `observe` in [page-core.js](../../extension/page-core.js), backed by a
  `fingerprint` comparison ([HOW-IT-WORKS.md](../../HOW-IT-WORKS.md) §6, Layer 1).
  It deliberately biases toward "something happened", because a false no-op is the
  dangerous verdict. It is a liveness check, not a correctness check.
- So a click that lands on the right element, mutates the DOM, and produces an
  error toast instead of a confirmation is a successful step, and a routine of such
  steps is a successful run. `runRoutine` in
  [orchestrator.ts](../../src/main/automation/orchestrator.ts) emits
  `status: 'done'` after the loop with no correctness gate anywhere in it.

### Why is it painful?

- **User impact.** The Operator's central question is "did it work?", and the
  product currently answers a different one: "did it run?". 🔶 **Assumption:**
  false successes occur often enough to matter — unvalidated, and PRD 01 is what
  would reveal it.
- **Business impact.** This compounds badly with scheduling. A watched run has a
  human who notices the error toast. An unattended daily run at 6 a.m. does not,
  and reports success every morning while doing nothing.

### Evidence

- **Code.** The `ActionStep` union and the absence of any assertion kind;
  `runRoutine`'s unconditional `status: 'done'`.
- **Design.** Layer 1's bias is documented and correct for its purpose
  ([HOW-IT-WORKS.md](../../HOW-IT-WORKS.md) §6): *"A false no-op is dangerous; a
  missed dead click is merely the status quo."* That is the right trade for
  liveness and precisely why a separate correctness check is needed.
- 🔵 **Open Question:** how many runs currently report success without achieving
  their goal? Unmeasurable today — nothing persists a run. See §6.

---

## 3. Target Users & Personas

**Primary: The Author** — knows what success looks like on the page and has no way
to write it down.

**Secondary: The Operator** — needs "Finished" to mean something.

**Job-to-be-done:** *When I automate a task, I want the routine to check it
actually worked, so that "finished" means finished.*

---

## 4. Strategic Context

**Ladders up to:** trusted unattended runs. Trust requires that failure is
detectable; a system that cannot fail cannot be trusted when it says it succeeded.

**Why now.** Before PRD 07, and ahead of PRD 09, which
[README.md](README.md)'s dependency table lists this PRD as a **hard** prerequisite
for. Assertions are what make a scheduled run's success signal worth anything, and
what make PRD 09's failure grouping meaningful — an assertion failure names the
problem in the Author's own words, which is far better grouping material than a
selector timeout.

---

## 5. Solution Overview

### The step

```ts
{ kind: 'assert', selector: string, expect?: 'present' | 'absent',
  containsText?: string, message?: string, intent?: string }
```

- `expect: 'present'` (default) — the selector must resolve to a **usable** element,
  the rank-4 verdict `waitForActionable` in
  [page-core.js](../../extension/page-core.js) already requires.
- `expect: 'absent'` — no **rendered** match may appear. Covers "the error banner is
  gone", "the cart is empty". Not the inverse of `present`; see *Absence is not the
  negation of presence* below.
- `containsText` — the resolved element's `innerText` must contain this, after
  `{{param}}` substitution. Covers "the confirmation shows my order number".
  `innerText` rather than the `accessibleText` that backs `:has-text()`, so an
  assertion checks what the Operator would read on screen and matches what
  `ACTIONS.extract` already returns. 🔵 **Open Question:** whether Authors expect
  `aria-label` and `placeholder` text to count.
- `message` — what the Author says failed, used verbatim in the run's error.

### Validation is not free

**`checkFields` does not cover this.** The `FieldSpec` vocabulary in
[routines.ts](../../src/shared/routines.ts) is exactly
`'string' | 'string?' | 'number?' | 'boolean?'` — it type-checks and rejects unknown
keys, and that is all. `expect: 'banana'` would validate as a `string?`. Two
cross-field rules therefore go into `assertStep`, alongside the one that already
exists for `scroll.to`:

1. `expect`, when present, must be `'present'` or `'absent'`.
2. `containsText` and `expect: 'absent'` are mutually exclusive — "absent, and also
   contains this text" has no meaning, and silently ignoring one half is how an
   Author ends up with an assertion that never fails.

### Where it runs

**In `page-core.js`, which is the whole point.** The in-page engine already has
most of what is needed: `queryAll` and `best` for ranked candidate resolution,
`HAS_TEXT` / `accessibleText` for `:has-text()`, shadow-root traversal, and `rank`
for visibility ([HOW-IT-WORKS.md](../../HOW-IT-WORKS.md) §6, Layer 0). A `present`
assertion is a `waitForActionable` call whose result is interpreted rather than
acted on, so a slow confirmation is not a false failure.

`extension/content.js` is a 46-line transport shim and holds none of this. Both
backends inject `page-core.js` — the extension loads it before `content.js`, and
`PlaywrightSession` bundles it via a `?raw` import and injects it per document —
so one `ACTIONS` entry serves both. An implementer who puts the engine work in
`content.js` reaches neither backend.

`ACTIONS.assert` returns **neither `changed` nor `committing`**. That is deliberate:
`runWithRepair` treats `output.changed === false` as a no-op verdict and sends it to
the healer, and an assertion must never reach the healer (below). Returning `{}`,
as `ACTIONS.wait` and `ACTIONS.scroll` already do, keeps layer 1 out of it.

### Absence is not the negation of presence

`page-core.js` has **no absence primitive today** — `best` and `waitForActionable`
both answer "which match is most usable", never "is anything rendered" — and the
obvious implementation is wrong in two ways that both fail *open*.

**Wrong way 1 — reusing the rank-4 test.** `rank` returns 1 for invisible, 2 for
*disabled*, 3 for *covered*, 4 for usable, and `waitForActionable` accepts only 4.
"`waitForActionable` failed, therefore absent" would pass an absence assertion
against a visible error banner sitting behind a modal (rank 3), or one inside a
`fieldset[disabled]` (rank 2). The Operator can read that banner; the assertion
must fail. **Requirement:** absence tests `rank(el) >= 2` — equivalently
`isVisible(el)` — over every candidate `queryAll` returns, not rank 4. All four
symbols are in `page-core.js`; the primitive belongs beside them, not in a
backend.

**Wrong way 2 — returning immediately.** A single synchronous check passes before an
error banner that renders 200 ms later has appeared, which is the common case: the
banner arrives with the failed submit's response. **Requirement:** absence polls for
a bounded grace window and passes only if no rendered match appears *throughout* it.
A new constant, `ABSENCE_GRACE_MS`, beside `DEFAULT_TIMEOUT` and `POLL_MS` at the
top of `page-core.js`, 🔶 **Assumption:** 1 000 ms — long enough for a
same-turn render, short enough that a routine full of passing absence assertions
does not crawl. Not the full 10 s action budget: an absence assertion that passes is
the expected case, and paying ten seconds for every expected case is a tax on using
the feature at all.

### Param substitution into `containsText` is a contract change

[AI_CONTEXT.md](../../AI_CONTEXT.md) §6 states that `{{param}}` is substituted into
exactly three slots — `navigate.url`, `type.text`, `select.value` — and never into
selectors, so a literal `{{…}}` in CSS survives. `assert.containsText` is a
**fourth** slot, and there is now exactly **one** place to add it: `resolveStep` in
[routines.ts](../../src/shared/routines.ts). It moved out of `extension-session.ts`
when PRD 01 needed the orchestrator to report the resolved step, and the second
substitution site an earlier draft named — an inline `resolve` closure in the
deleted `browser-session.ts` — no longer exists. Verified 2026-08-27:
`ExtensionSession.runStep`, `PlaywrightSession.runStep` and `runRoutine` all import
the same `resolveStep`, so one edit reaches every caller. `assert.selector` is
**not** substituted, matching the existing rule.

### Failure behaviour — the important decision

**A failed assertion fails the run. It does not hold, and it does not heal.**

*It does not hold*, and this is a correction to an earlier draft that said the
opposite. [README.md](README.md)'s **How a run ends today** is binding: a layer-3
hold means *a human can finish this step for me*. `runRoutine` catches
`NeedsHumanError`, awaits `holdForHuman`, and then **continues to the next step**,
after which the loop falls through to `status: 'assisted'` — its `reportHold`
increments `humanSteps`, and `assisted` is a *completed* status, not a failed one.
Routing an assertion there produces exactly the false success this PRD exists to
remove: the assertion fails,
the banner tells the Operator to do the step by hand, they press Resume, and the run
reports success. There is nothing for a human to *do* about a verdict that the page
is not as expected. A hold is not a general-purpose failure destination.

*It does not heal.* A repair asks "what should we do instead to make this step
work?" Applied to an assertion, that is asking a model to make a failing check pass
— either finding a different element that happens to match, or manufacturing the
state being checked for. `StepHealer.plan` in
[step-healer.ts](../../src/main/automation/step-healer.ts) can also return
`outcome: 'proceed'`, which `runWithRepair` converts into a successful step: a model
overruling a failed assertion. Both defeat the purpose.

🔶 **Assumption:** a *stale selector* in an assertion is a legitimate repair case
and is indistinguishable from a genuine failure without a human looking at the
page. Unvalidated — the class of assertion failures is exactly what PRD 09 will
group, and it is the evidence that would settle this. The safe default is
therefore: assertions do not heal, and the Author fixes the selector.

**This requires a code change; today's code does the wrong thing by default.**
`StepExecutionError` in [session.ts](../../src/main/automation/session.ts) sets
`healable = !REFUSAL.test(detail)`, and `isHealable` accepts any
`StepExecutionError` whose message is not a credential refusal. Every failure raised
through a backend's `runStep` is wrapped in that class, so an assert failure
would qualify, reach `StepHealer.plan`, and burn a slot of `MAX_REPAIRS_PER_RUN`
plus a `repair_step` model call and a snapshot — `plan` decrements the budget
*before* it calls the model, so the cost lands even when the verdict is `giveUp`.

The fix is **a new error class, not another message regex**:

- `AssertionFailedError` in `session.ts`, extending `Error` and **not**
  `StepExecutionError`. `isHealable` then rejects it with no edit, because its test
  is `error instanceof StepExecutionError`.
- A **kind check** at the throw site in `ExtensionSession.runStep`: when
  `!result.ok` and `step.kind === 'assert'`, throw `AssertionFailedError` instead of
  `StepExecutionError`. A regex over the message would be one page's error copy away
  from misclassifying.
- **The same check in `PlaywrightSession.runStep`, on the default backend.**
  `browser-session.ts` is deleted and `playwright-session.ts` supersedes it.
  Verified 2026-08-27: that file has two `throw new StepExecutionError(step, …)`
  sites, one in `runStep` and one in `extractText`. Only the `runStep` one needs the
  check — `extractText` builds its own `{ kind: 'extract' }` step and can never see
  an assert. Neither is inside a `catch` that re-wraps: `execute()` returns
  `{ ok: false, error }` rather than throwing, so there is nothing to rethrow
  unwrapped.

The propagation path then already works and needs nothing: `runWithRepair` rethrows
anything that is neither `NeedsHumanError` nor healable; `throughPauses` swallows
only `RunPausedError`; `runRoutine`'s per-step catch rethrows anything that is not
`NeedsHumanError`; the outer catch emits `status: 'error'` and rethrows.

**The message must name the step number itself.** Only error *messages* cross IPC
([AI_CONTEXT.md](../../AI_CONTEXT.md) §8), so the renderer cannot read a custom
field off the class. An earlier draft added that the outer catch discards the index
as `stepIndex: -1`; verified 2026-08-27, it reports `stepIndex: activeStep`, which
is the failing index once the loop has started, and PRD 01 carries that through to
`RunSummary.failedStepIndex`. The requirement stands regardless: the message is what
an Operator reads in a notification or a log, and it must be diagnosable alone.
Format: step number, the Author's `message` when present, and for `containsText`
both the expected and the actual text.

### The scan hold will fail an assertion unless **both backends** change

**The pre-dispatch scan exists twice**, and this is the requirement most likely to
be half-implemented. Verified 2026-08-27:

| Backend | Where the scan runs | What a hit does |
|---|---|---|
| extension | `runStep` in [background.js](../../extension/background.js) sends `{type:'SCAN'}` before dispatching | replies `{ok: false, held: true}`; `ExtensionSession.dispatch` retries up to `MAX_HELD_RETRIES`, then throws a plain `Error` |
| **playwright (default)** | `scanHold()` in [playwright-session.ts](../../src/main/automation/playwright-session.ts), called from `dispatch` before `execute` | `PlaywrightSession.dispatch` also **pauses the run** via `holdWith(reason, true)`, retries to the same cap, then throws |

Both call the same `scanSensitive` in `page-core.js`. Exempting `assert` in
`background.js` alone leaves the feature broken on the backend almost every user is
on, and it fails *silently* in the sense that matters: nothing errors at build or
test time, and the symptom is an assertion reporting a sensitive-field problem it
has nothing to do with.

That is this feature's canonical example, not an edge case. `scanSensitive` fires on
any rendered `input[autocomplete^="cc-"]`, and a post-checkout confirmation rendered
by a single-page checkout that keeps the payment form mounted has one. The assertion
never executes, and the run ends `error` with a message about a sensitive field —
a **false assertion failure**, and the worst kind, because it points the Operator at
the wrong problem.

**Decision: exempt `assert` from the pre-dispatch scan in both backends** — a narrow
kind allowlist in `runStep` in `background.js` *and* in `PlaywrightSession.dispatch`
around `scanHold()`, not a bypass flag in either. The argument, since this is
security-adjacent: `scanSensitive` is a page-wide **hold heuristic**, and
[AI_CONTEXT.md](../../AI_CONTEXT.md) §8 already says it must never be the thing that
stops a password being typed — the target-level `assertWritableTarget` is, and it is
untouched here. An `assert` performs no write, no click and no keystroke; it reads
the DOM, which the DOM snapshot path already does on a scanned page. Two limits:

- The allowlist holds **`assert` only**. Not `screenshot` — a screenshot of a page
  with a visible card field is sent to the model, and holding that is the point.
- No `skipScanOnce`-style flag. **Note the name collision:** `skipScanOnce` is a
  real mechanism in both backends already — a field on `PlaywrightSession` and a key
  in `background.js`'s persisted state, both set by `resume()` to grant one
  post-resume step a scan bypass. The exemption must not reuse, extend or key off
  it. That flag is per-step state a later change can set for the wrong step; a kind
  check cannot be.

**Residual risk, accepted:** an `assert` on a CAPTCHA-blocked page no longer pauses
the run. The assertion then fails on its own terms, which is the correct outcome and
a better message than "CAPTCHA detected".

### Which AI_CONTEXT contracts change

All of these are §13-mandated updates and land in the same change:

| Section | Change |
|---|---|
| §6 step table | **Eight step kinds becomes nine**; new row: `assert` / `selector`, `expect?`, `containsText?`, `message?` / page-core.js |
| §6 params | The substitution allowlist gains a fourth slot: `assert.containsText` |
| §5 symbol index | `AssertionFailedError` (session.ts) added to the never-healed row |
| §7 budgets | New row: `ABSENCE_GRACE_MS`, page-core.js |
| §8 invariants | New: *a failed assertion terminates the run* — it never routes to the healer or to a layer-3 hold, because a hold resolves on Resume and the run then reports `assisted`, which is a completed status |
| §8 credential guard | Note the `assert` exemption from `scanSensitive`'s pre-dispatch scan **in both backends**, and that the target-level `assertWritableTarget` is unchanged |
| §10 recipe | *Adding a step kind* becomes **seven** places, not six — `session.ts` joins the six the recipe names today: `shared/types.ts`, `shared/routines.ts`, `orchestrator.ts`, `extension-session.ts`/`playwright-session.ts` (counted once, they share `stepTimeout`), `page-core.js`'s `ACTIONS`, and `background.js`. Re-derived against the current recipe on 2026-08-27 — the count is unchanged from the earlier draft, but the six it adds to are not the six that draft was counting |

---

## 6. Success Metrics

### Primary

**Assertion coverage** — share of stored user routines containing at least one
`assert` step.

- **Mechanism:** a count over the `user_routines` table's `definition` JSON, read
  through `UserRoutineStore` in
  [user-routines.ts](../../src/main/db/user-routines.ts). This needs **no
  telemetry** — routines are already persisted — so it is measurable the day the
  kind ships, which is why it is the primary rather than the run-level metric below.
- Current: 0% (kind does not exist).
- **Target: 50% within eight weeks of availability.** 🔶 **Assumption**, and owned
  here rather than deferred: an earlier draft handed the target to PRD 11's editor,
  and a metric whose target an unbuilt PRD sets is not a metric. If PRD 11 ships
  first and makes adding an assertion a click, revise the number then.
- **Honest limitation:** this is a leading indicator of adoption, not of outcome.
  It cannot tell us whether the assertions Authors write are catching anything.

### Secondary — both need PRD 01

- **Assertion-caught false successes.** Runs ending `error` at an `assert` step that
  would otherwise have ended `done` or `assisted`. This is the number that justifies
  the feature. **Cannot be measured yet:** no run leaves a trace. PRD 01's `runs`
  and `run_events` tables are the substrate — `run_events.step_json` carries the
  resolved `ActionStep`, so the query is a `runs.status = 'error'` row joined to its
  last `run_events` row whose `step_json` has `kind: 'assert'`.
  **Proxy until then:** assertion failures are visible in the renderer's progress
  line and in `~/.outsentia-automation.log` (the relay's log). Per-machine, manual,
  not aggregatable — enough to know the feature fires, not enough to size the
  problem.
- **Assertion failure rate per routine.** A routine whose assertion fails
  frequently is drifting. Same substrate, same "cannot be measured yet"; this is
  the metric PRD 09 consumes.

### Guardrails

The previous draft's guardrail — "no false assertion failures" — is deleted. It was
unfalsifiable: zero tolerance, no detector, and the scan-hold interaction in §5
violated it on the feature's own example. These are falsifiable and each names its
check.

- **A `present` assertion that would pass within the action budget must not fail
  earlier.** Check: a fixture in
  [tests/content-script.verify.mjs](../../tests/content-script.verify.mjs) that
  inserts the target 3 s after `EXEC` is dispatched; the assertion must pass. That
  harness loads the real `page-core.js` into real Chrome and drives `ACTIONS`
  through it, so it is the right place — and because the engine is shared, one
  fixture covers both backends.
- **An `absent` assertion must fail on a rendered-but-unusable match.** Check: the
  same harness, using its existing covering-`#veil` fixture (rank 3) plus a
  `fieldset[disabled]` fixture (rank 2). This is the guardrail against §5's
  *Wrong way 1*.
- **Routines without assertions behave exactly as before.** Check:
  [tests/routines.test.ts](../../tests/routines.test.ts),
  [tests/orchestrator.test.ts](../../tests/orchestrator.test.ts) and
  [tests/shipped-routines.test.ts](../../tests/shipped-routines.test.ts) pass
  unchanged, and the `updates/` routines gain no `assert` step in this PRD (§8).
- **The scan exemption is half guardable, and the half that is not is the extension
  one.** [tests/playwright-session.test.ts](../../tests/playwright-session.test.ts)
  already fakes `scanSensitive` and has a *sensitive-field hold loop* block, so the
  Playwright exemption gets a real vitest assertion: queue a scan hit, run an
  `assert`, and require that it executes without parking. The extension side has no
  equivalent — `tests/content-script.verify.mjs` does load `background.js` into a
  `vm`, but only to read `inputCommands`, and its `chrome` stub has no
  `tabs.sendMessage`, so nothing drives `runStep`'s `SCAN` round trip. Manual
  verification against a card-field-bearing confirmation page is the only check
  there; §9 carries it as a risk rather than pretending otherwise.

---

## 7. User Stories & Requirements

### Epic hypothesis

We believe that letting Authors state what must be true will convert silent false
successes into loud failures, because the current success signal only means no step
threw. We will know we are right in two stages: first when assertion coverage rises
(§6's primary, measurable at ship), and then — once PRD 01 persists runs — when
runs end `error` at an `assert` step that would previously have reported `done`.

### Story 1 — Asserting presence

**As** the Author, **I want** a step that requires an element to exist, **so that**
the run fails if the confirmation never appeared.

```gherkin
Scenario: A satisfied assertion passes silently
  Given a routine ending with assert selector '.order-confirmation'
  And the page shows that element after the submit step
  When the run reaches the assertion
  Then it passes and the run reports success

Scenario: An unsatisfied assertion fails the run
  Given the same routine
  And the submit produced an error banner instead of a confirmation
  When the run reaches the assertion
  Then AssertionFailedError propagates out of the step loop
  And the run reports status 'error', not 'done' and not a hold
  And the error message names the step number and the assertion's message
  And no later step in the routine runs

Scenario: A slow confirmation is not a false failure
  Given the confirmation appears 3 seconds after the submit
  When the assertion runs
  Then it polls within the normal action budget and passes
```

**Soft dependency on PRD 01.** An earlier draft also required that *"the run's
thread shows the page at the point of failure"*. There is no thread and no stored
page until PRD 01 lands its `runs`, `run_events` and `run_artifacts` tables, and
even then PRD 01 stores screenshots only for explicit `screenshot` steps — a capture
on assertion failure is additional work that belongs to whichever PRD owns it. The
criterion is therefore **deferred**, and the message criterion above stands in its
place: an assertion failure must be diagnosable from its message alone, because for
now that is all the Operator gets.

### Story 2 — Asserting absence and text

**As** the Author, **I want** to assert that something is gone or that text
matches, **so that** I can express outcomes beyond "an element exists".

```gherkin
Scenario: Asserting absence
  Given a routine with assert selector '.error-banner' expect 'absent'
  When no rendered match appears for the whole grace window
  Then the assertion passes

  When a rendered error banner is present
  Then the run fails naming the banner's text

  When the banner is visible but covered by a modal, or inside a disabled fieldset
  Then the run fails — a rendered match is present even though it is not usable

Scenario: Asserting text content with a param
  Given a routine with param order_id = "A-8842"
  And assert selector '.confirmation' containsText '{{order_id}}'
  When the confirmation reads "Order A-8842 placed"
  Then the assertion passes

  When it reads "Order A-8100 placed"
  Then the run fails, quoting both expected and actual text
```

### Story 3 — Assertions do not get repaired

**As** the Author, **I want** a failed assertion to stop the run rather than be
worked around, **so that** a check cannot be satisfied by improvisation.

```gherkin
Scenario: A failed assertion skips the healer
  Given a routine whose assertion fails
  When the failure occurs
  Then isHealable returns false for the raised error
  And no repair_step model call is made
  And no page snapshot is taken for a repair
  And the run does not consume any of MAX_REPAIRS_PER_RUN
  And the run ends 'error' — it is not held for a human
```

### Constraints and edge cases

- `containsText` comparison is case-insensitive and whitespace-normalised — page
  text is not typed by hand and exact matching would be brittle.
- `expect: 'absent'` must distinguish "no match" from "matched but not usable".
  A match counts as **present** when `rank(el) >= 2`, i.e. `isVisible(el)` in
  `page-core.js` — see §5.
  Only rank 1, genuinely not rendered, counts as absent.
- `expect: 'absent'` consumes `ABSENCE_GRACE_MS`, not the full action budget, and
  fails the moment a rendered match appears within it.
- **Assertions cannot appear in a chat run.** Not because `toActionStep` rejects
  them — it has working cases for `select`, `wait` and `scroll`, so it is not the
  gate — but because the `action` enum in `DECIDE_NEXT_ACTION_TOOL`'s `input_schema`
  in [claude-client.ts](../../src/main/automation/claude-client.ts) is
  `['click', 'type', 'navigate', 'needs_human', 'done']`, of which only the first
  three are steps. The `repair_step` tool's own enum is
  similarly closed, so no repair can emit an `assert` either. Assertions reach the
  extension only from a hand-written or edited routine. Widening this means editing
  the tool schema, never the narrowing function
  ([AI_CONTEXT.md](../../AI_CONTEXT.md) §6) — and §8 keeps it out of scope.

---

## 8. Out of Scope

- **Assertions on URL, page title, or extracted variables.** Selector-based only
  for the first cut. `assert` on `{{extracted}}` values is an obvious follow-up
  once there is evidence it is wanted.
- **Soft assertions** that record a failure and continue. One behaviour: fail.
- **Teaching the chat model to emit assertions.** It would change
  `decide_next_action`'s tool schema and prompt, and the model has no stated
  success criterion to assert against. Separate problem.
- **Numeric or regex comparison.** Substring only.
- **Repairing an assertion, including by `applyRepairs`.** No change is needed to
  make this true, and the PRD relies on that: `applyRepairs` in
  [routines.ts](../../src/shared/routines.ts) keeps only a replacement whose `kind`
  matches the original, and the `repair_step` tool schema cannot produce
  `kind: 'assert'` — so a persisted repair can never rewrite an assertion. Under
  §5's change the healer is never reached in the first place. Both guards stay.
- **Adding assertions to the `updates/` system routines.** `search-and-capture.json`
  and `web-health-check.json` are unchanged by this PRD, which keeps
  `tests/shipped-routines.test.ts` and §6's third guardrail meaningful. Retro-fitting
  them is a separate, reviewable change — and `updates/` is read-only source of
  truth, so it is also a release.

---

## 9. Dependencies & Risks

### The recipe: seven files, eleven sites — not four

An earlier draft said "four places" and added that *"the exhaustive switches mean
the compiler finds most of the work"*. Both are wrong, and the second is the more
dangerous: **exactly one** of the eleven sites is a compiler error.
[AI_CONTEXT.md](../../AI_CONTEXT.md) §10 lists six places for a step kind; this
feature adds `session.ts` as a seventh, plus the scan exemption and a version bump.

Re-verified against the tree on 2026-08-27, after `browser-session.ts` was deleted
and the engine moved from `content.js` into `page-core.js`.

| # | Site | Symbol | If missed |
|---|---|---|---|
| 1 | [shared/types.ts](../../src/shared/types.ts) | `ActionStep` | Nothing else compiles — this is the trigger for the rest |
| 2 | [shared/routines.ts](../../src/shared/routines.ts) | `STEP_FIELDS.assert`, plus the two cross-field rules in `assertStep` | Loud: `assertStep` throws `unknown kind "assert"` and the routine is rejected |
| 3 | [shared/routines.ts](../../src/shared/routines.ts) | `describeStep` | **The one compiler error.** Its `switch` has no `default` and returns `string`, so a missing case makes the return type include `undefined`. It moved here from `orchestrator.ts`, which now imports it |
| 4 | [shared/routines.ts](../../src/shared/routines.ts) | `resolveStep` | 🔴 **Silent.** Its `default: return step` means `containsText: '{{order_id}}'` is compared **literally** — the assertion then fails on every run and looks like site drift. One edit; every backend imports this function |
| 5 | [extension-session.ts](../../src/main/automation/extension-session.ts) | `extensionBudget`, behind the exported `stepTimeout` | 🔴 **Silent.** Its `default` returns `EXTENSION_ACTION_MS` — right by accident for `present`, ten times too generous for `absent`, and declared nowhere. The `TIMEOUT_MARGIN_MS` relationship main depends on (§7 of AI_CONTEXT calls it load-bearing) then holds only by luck. One edit covers both backends: `playwright-session.ts` imports `stepTimeout` from here |
| 6 | [extension/page-core.js](../../extension/page-core.js) | `ACTIONS.assert`, the absence primitive over `queryAll`/`rank`, and `ABSENCE_GRACE_MS` | Loud on both backends: `exec` replies `unsupported step kind "assert"`. There is no per-kind `switch` in either backend to fall through instead — `PlaywrightSession.execute` handles only `navigate` and `screenshot` itself and delegates every other kind here |
| 7 | [session.ts](../../src/main/automation/session.ts) | `AssertionFailedError` | 🔴 **Silent in effect.** Without it the assertion fails as a healable `StepExecutionError` — reaching `StepHealer`, spending a `MAX_REPAIRS_PER_RUN` slot and a model call, and open to being overruled by a `proceed` verdict. Contradicts §5 and Story 3 |
| 8 | [extension-session.ts](../../src/main/automation/extension-session.ts) | the kind check at `ExtensionSession.runStep`'s `throw` | 🔴 **Silent**, as site 7 — the class exists but nothing raises it on this backend |
| 9 | [playwright-session.ts](../../src/main/automation/playwright-session.ts) | the kind check at `PlaywrightSession.runStep`'s `throw` | 🔴 **Silent, and on the default backend.** Its `extractText` throw needs no check: that step is always `kind: 'extract'` |
| 10 | [extension/background.js](../../extension/background.js) | `assert` exempted from the `{type:'SCAN'}` round trip in `runStep` | 🔴 **Silent in effect.** A confirmation page holding a mounted card field turns the assertion into a false failure naming a sensitive field |
| 11 | [playwright-session.ts](../../src/main/automation/playwright-session.ts) | `assert` exempted from `scanHold()` in `dispatch` | 🔴 **Silent, and on the default backend.** Same false failure as site 10, plus the run parks with a hold banner |

Sites 2, 3 and 4 are one file but three independent switches, and sites 9 and 11 are
one file but two unrelated methods. Sites 8/9 and 10/11 are the same requirement
implemented twice, once per backend; landing either pair half-way ships a feature
that works in development and fails for users. Nothing in the type system connects
any of them to site 1.

### Dependencies

- **`ABSENCE_GRACE_MS`** is a new budget constant in `page-core.js`, and
  [AI_CONTEXT.md](../../AI_CONTEXT.md) §7 must gain it.
- **Extension version bump**, for the extension backend only — the Playwright
  backend bundles `page-core.js` at build time and needs none. `EXTENSION_VERSION`
  in [extension-bridge.ts](../../src/main/automation/extension-bridge.ts) and the
  `version` field in [extension/manifest.json](../../extension/manifest.json) are
  both `1.10.0` as of 2026-08-27 and must move **together**;
  [tests/extension-session.test.ts](../../tests/extension-session.test.ts) asserts
  they agree, so missing one fails the suite rather than shipping a mismatch.
- **The version guard is `ExtensionSession.connect()`, not `ensureInjected`.** An
  earlier draft, following [HOW-IT-WORKS.md](../../HOW-IT-WORKS.md) §2, credited
  `ensureInjected` in `background.js`. That is the wrong mechanism:
  `ensureInjected` compares the page's `window.__oaVersion` against the
  **extension's own** `chrome.runtime.getManifest().version` — a *stale content
  script* check, entirely inside the browser — and it **returns a string rather
  than aborting**, which `runStep` only turns into a throw for content-script
  steps. The app↔extension guard is `ExtensionSession.connect()`, which compares the
  handshake's reported version against `EXTENSION_VERSION` and throws before a
  single step dispatches. HOW-IT-WORKS.md §2 is imprecise here and should be
  corrected separately; this PRD does not depend on it.
- **PRD 01, softly.** Story 1's page-at-failure criterion and both of §6's
  secondary metrics need it. Nothing in §5 does.

### Risks

| Risk | Mitigation |
|---|---|
| **The scan hold turns a read-only assertion into a false failure.** Both backends scan before every step — `runStep` in `background.js` and `scanHold()` in `playwright-session.ts` — and a confirmation page that keeps a card field mounted holds, retries `MAX_HELD_RETRIES` times, then errors. | §5's narrow `assert`-only exemption, applied in **both** backends, with the target-level `assertWritableTarget` untouched. The Playwright half is assertable in `tests/playwright-session.test.ts`; the extension half is not (§6) — verify it manually against a real single-page checkout, and treat building a background-worker harness as follow-up work. |
| **The exemption lands in one backend only.** Nothing fails to compile, no test goes red, and the developer's own backend may well be the one that was fixed. | Sites 10 **and** 11 are one requirement. Review the change for both, and use the Playwright test as the tripwire — it is the default backend and the one users are on. |
| **A backend swallows `assert` as a no-op.** The hazard an earlier draft attributed to `browser-session.ts`'s `default`-less `switch`. | **Resolved by deletion, verified 2026-08-27.** `PlaywrightSession.execute` special-cases only `navigate` and `screenshot` and delegates everything else to `exec` in `page-core.js`, which answers `unsupported step kind "assert"`. An unimplemented `ACTIONS.assert` is now loud on both backends. Do not reintroduce a per-kind `switch` in a backend to hold `assert`. |
| **Flaky assertions erode trust worse than no assertions.** 🔶 **Assumption:** an assertion that fails intermittently on a slow page trains users to ignore failures. Unvalidated — plausible from the general finding that noisy alerts get muted, but untested here. | Same polling and budget as any other step for `present`; a bounded grace window for `absent`. Both guarded by named fixtures in §6. Treat a false failure as a P1 bug, not a tuning issue. |
| **Authors write assertions against volatile selectors**, so the assertion breaks before the automation does. | PRD 12's selector confidence applies to assertions too. Prefer text-based assertions in documentation and defaults. |
| **A failed assertion is now a hard stop, so a badly written one bricks a routine** in a way a hold never did. | The failure names the step and the Author's `message`, so it is fixable in one pass. PRD 09 groups repeats. This is the intended trade: a loud stop beats a quiet pass. |

---

## 10. Open Questions

- 🔵 How many runs currently report success without achieving their goal? The
  feature's whole justification, and unmeasurable until PRD 01 persists runs. §6
  names the query that answers it and the manual proxy until then.
- 🔵 Is `ABSENCE_GRACE_MS = 1 000` right? Too short and a late-rendering banner slips
  through; too long and every passing absence assertion taxes the run. The first
  real routines using `absent` are the evidence.
- 🔵 Should `absent` treat rank 1 — rendered in the DOM but invisible — as absent
  at all? §5 says yes, because an invisible banner is one the Operator cannot read.
  An Author asserting that a *removed* row is gone may disagree.
- 🔵 Should `containsText` match `innerText` only, or `accessibleText` as
  `:has-text()` does? §5 chose `innerText` for consistency with `extract`; the
  divergence between the two is a trap an Author will hit before we do.
- 🔵 Should the `assert` scan exemption widen to a general read-only kind set? It
  would need its own security argument, and `screenshot` is a deliberate exclusion.
- 🔶 **Assumption:** `present` / `absent` / `containsText` covers most needs.
  Unvalidated — the first real routines will say.

*Resolved, and deliberately removed:* whether a failed assertion should hold for a
human or fail the run. §5 answers it — a hold resolves on Resume and the run then
reports success, so it cannot be a failure destination — and Story 3 depends on the
answer. It is not open.

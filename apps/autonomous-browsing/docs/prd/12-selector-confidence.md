# PRD 12 — Selector confidence

| | |
|---|---|
| **Phase** | Durability |
| **Depends on** | PRD 11 (the editor it lives in) |
| **Blocks** | PRD 13 (soft) — 13's header says *assumes PRD 12* and [IMPLEMENTATION-ORDER.md](../IMPLEMENTATION-ORDER.md) lists "12's resolution feedback" among what 13 composes. [README.md](README.md)'s table — the authority — records 13's hard dependencies as 01, 03, 05, 11, so 13 can ship without this |
| **Status** | Draft |
| **Author** | hmukhtar@outsentia.com |

Shared personas and strategic context: [README.md](README.md).

---

## 1. Executive Summary

We're building **selector confidence** — a read-only probe that resolves a selector
against the page the Author is looking at, plus a fixed rule set that turns the
probe's reply into one of a small set of named warnings — for **the Author** to solve
the problem that a selector's quality is only ever discovered at run time.

The ranking already exists (`rank`, `best` in
[page-core.js](../../extension/page-core.js), the one in-page engine both backends
inject) and is computed on every poll tick of every step, but it is thrown away
except when it appears inside a failure message.
This PRD does two things: it opens a path to read that ranking without acting, and
it defines what the ranking is *worth* — which is less than it looks, because rank
depends on the scroll position at the instant it is taken (§5). The deliverable is
therefore a documented, testable classifier, not a score.

---

## 2. Problem Statement

### Who has this problem?

The Author, writing or fixing any selector.

### What is the problem?

The system knows a great deal about how good a selector is, and tells nobody.

The in-page engine resolves selectors more capably than `document.querySelector`
(`queryAll`, `accessibleText`, `HAS_TEXT`, `rank`, `best` in
[page-core.js](../../extension/page-core.js) — the extension loads it before
`content.js`, and `playwright-session.ts` injects the same file per document, so
everything below is true of both backends; see also
[HOW-IT-WORKS.md](../../HOW-IT-WORKS.md) §6, Layer 0):

- **`:has-text("…")` matches an accessible-name bag**, not visible text.
  `accessibleText` joins `el.textContent`, `aria-label`, `title`, `placeholder`,
  `alt`, the **`name` attribute**, the text of every `aria-labelledby` target
  (`labelledText`), and — for anything with a string `value`, i.e. form controls —
  **`el.value`**. The result is lower-cased and whitespace-collapsed, and the test
  is `includes`: a **case-insensitive substring**, not equality. Because it reads
  `textContent` rather than rendered text, **`display:none` text still matches**.
  `HAS_TEXT` is anchored to the end of the selector, so `:has-text()` is only
  honoured as the last thing in it.
- **Open shadow roots are walked only when the light DOM matches nothing.**
  `queryAll` returns the light-DOM hits if there are any, and calls `shadowRoots()`
  otherwise. ([HOW-IT-WORKS.md](../../HOW-IT-WORKS.md) §6 states the accessible-name
  bag without `name` or `value`; that description is incomplete — this PRD does not
  propagate it.)
- **Candidates are ranked** by `rank`, not taken in document order:

| Rank | Meaning | Computed by |
|---|---|---|
| 4 | visible, enabled, nothing covering its centre — usable | fall-through in `rank` |
| 3 | covered by another element | `covering` |
| 2 | disabled, or inside a disabled fieldset | `isDisabled` |
| 1 | not visible | `isVisible` |

Only rank 4 is acted on (`waitForActionable`), and failures already explain
themselves in these terms via `explain`: *"the best of 3 matches, `<button#send>`,
is covered by `<div#consent>`"*.

All of it runs at execution time only. The Author sees it in a failure message,
after a run, possibly at 6 a.m. on a schedule (PRD 07). Nothing evaluates a selector
while it is being written.

### Why is it painful?

- **User impact.** 🔶 **Assumption:** authoring is guess-and-run — the Author writes
  a selector, runs the routine, and reads the failure. Untested; the only evidence
  is that no other feedback path exists in the product today. A selector matching
  four elements, three of them rank 1, works today because the visible one is rank 4
  and breaks the day the page reorders, with nothing at authoring time hinting at
  the fragility. 🔶 **Assumption:** brittle selectors are a leading cause of routine
  failure. Plausible given that the healing layer exists to handle exactly this; PRD
  09's `failure_class` would confirm it.
- **Business impact.** Every brittle selector is future repair calls, future
  failures, and future maintenance. Prevention at authoring time is cheaper than the
  four-layer healing machinery that exists to survive it.

### Evidence

- **Code.** The ranking system (`rank`, `best` in
  [page-core.js](../../extension/page-core.js)) and the fact that nothing surfaces
  it. The engine does already expose one non-acting entry point: `find(selector)`,
  returned from `create()`, calls `best` and answers `{ count, winningRank }` without
  touching the page. Nothing reaches it from the app — its only caller is
  `PlaywrightSession.frameFor`, choosing which frame a step belongs to. §5's probe is
  that hook widened and routed to the editor, not a new resolution path.
- **Structural.** The healing architecture's purpose is surviving selectors that
  stop matching. Improving selectors at source reduces the load on it.

---

## 3. Target Users & Personas

**Primary: The Author**, in the editor.

**Job-to-be-done:** *When I write a selector, I want to know what it really matches
right now, so I find out at my desk rather than at 6 a.m.*

---

## 4. Strategic Context

**Ladders up to:** durable automations. Fewer brittle selectors means fewer
failures, fewer repairs, fewer model calls.

**Why now.** It needs PRD 11's editor to live in — a confidence indicator with
nowhere to appear is not a feature. Placed immediately after, it lands while the
editor is fresh and before Authors have written a large body of unchecked selectors.
It is also the verification substrate any future selector *generator* needs: a
generated selector is worthless until something confirms it resolves uniquely and at
rank 4 (§10).

---

## 5. Solution Overview

### The probe

A `resolve` hook on the in-page engine that reads and never acts — the existing
`find` (§2) widened to the reply contract below. In
[page-core.js](../../extension/page-core.js) it calls the ranking entry point directly —
`best` / the new `rankAll` below — and **never** `waitForActionable` or `settle`.
That matters, and for a stronger reason than the previous draft gave: `settle` scrolls
after resolving, but `waitForActionable` **also scrolls**, calling
`scrollIntoView({ block: 'center' })` on any rank-3 candidate on every poll tick. So
the polling wrapper is itself an acting path and the probe must not enter it. Acting
otherwise lives in `ACTIONS`; `rank`, `best` and `queryAll` are pure. Sharing the path
means calling them, not passing a mode flag through them.

**Both backends, or neither.** The hook lives in the shared engine, so `page-core.js`
is one change. Reaching it is two: the extension routes a new message kind through
`content.js` and `background.js`, and `PlaywrightSession` calls
`callHooks(frame, 'resolve', selector)` the way it already calls `find`. §9 carries
the consequence — an extension-only probe is dead on the default backend.

### The reply contract

```ts
// success
{
  ok: true
  url: string                    // the tab actually checked, from chrome.tabs.get
  count: number                  // queryAll's candidate count — exact
  ranked: number                 // how many candidates were ranked (see the cap)
  ranks: { 1: number, 2: number, 3: number, 4: number }
  best: { rank: 1 | 2 | 3 | 4, tag: string, id: string, classes: string[] } | null
  inViewport: boolean            // is the best candidate's centre on screen right now
  covering: { tag: string, id: string, classes: string[] } | null
  shadowScanned: boolean         // false when the shadow walk was skipped by the cap
}

// refusal — one shape for every reason the page could not be judged
{
  ok: false
  reason: 'invalid-selector' | 'page-unreadable' | 'stale-script'
        | 'sensitive' | 'run-in-progress' | 'no-page'
  detail: string                 // the extension's own message, shown verbatim
  url?: string
}
```

Two things are **absent by construction**: the reply carries **no accessible text**
and **no element `value`**, for any candidate, ever. The credential argument below
is the reason, and it is not negotiable in a later revision.

Three parts of this are new code, not a read of existing behaviour:

- **The per-rank histogram.** `best` returns `{ winner, winningRank, count }` and
  discards every non-winning rank inside its loop, so "3 matches, 2 hidden" cannot
  be answered today. `best` is called by `waitForActionable` on every 100 ms poll of
  every step, so widening its return shape would put an allocation on the run's hot
  path. **Recipe:** extract `rankAll(selector) → { count, ranks, candidates }` in
  [page-core.js](../../extension/page-core.js) and make `best` a thin wrapper over it
  that returns its existing shape unchanged. The probe calls `rankAll`; the run path
  keeps the shape it has.
- **The structured element description.** `describe` emits `<tag#firstclass>` —
  tag name, `#id` if present, and the **first** class only — and never an
  attribute. So a report like `<button aria-label="Send message">` is not something
  the code can produce today. The reply's `{ tag, id, classes }` is the new
  structure; it deliberately carries no attributes and no text, and the editor
  formats it.
- **Separating "nothing covering it" from "off screen".** `covering` returns `null`
  in both cases — it bails when the element's centre falls outside `innerWidth` /
  `innerHeight`. **Recipe:** extract `coverageAt(el) → { inViewport, top }` and make
  `covering` a wrapper returning `top` only when `inViewport`. `rank` is unchanged,
  so no run behaviour moves.

`explain` already re-runs `covering(winner)` to name the covering element, so naming
it is proven code — but that is a second forced layout on the same element. The probe
computes coverage once, in the same rect pass as the ranking.

### Rank is viewport-dependent, and that is the feature's central caveat

`isVisible` accepts an element that is off screen — it still has client rects — and
`coverageAt` reports no covering element when the centre is outside the viewport.
**So anything scrolled out of view ranks 4, "usable".** The most
confidence-inspiring output the probe can produce is the least predictive of what a
run will do, because `settle` scrolls the element to `block: 'center'` first and
*then* resolves again. Two keystrokes seconds apart can disagree because the Author
scrolled between them.

This is why the reply carries `inViewport` and why a rank-4 verdict on an off-screen
element is reported as *unproven*, not as *clean*. 🔶 **Assumption:** an Author reads
"rank 4" as a guarantee unless told otherwise; this is the reason the classifier
never prints a bare rank.

### Which tab, and when

The two backends disagree about what "the page" is, so this section splits. Under
Playwright — the default — there is no tab to choose: `PlaywrightSession` holds
`activePage`, and probing it is `callHooks(page.mainFrame(), 'resolve', selector)`
with no session state written and no tab query at all. Everything below the first
bullet applies to both; the tab-selection rules are the extension backend's.

- **On the extension backend the probe uses the active tab and never becomes the
  target tab.** `runStep` and
  `snapshot` both go through `targetTab()` in
  [background.js](../../extension/background.js), which throws `no target tab` until
  `start` has run — and `start` (reached from `ExtensionSession.connect` via
  `bridge.start`) sets `targetTabId`, sets `state: 'active'`, and so shows the
  running banner in the page. That is the opposite of a passive check, so the probe
  must not call it. **Requirement:** the `resolve` handler in `background.js` queries
  `chrome.tabs.query({ active: true, lastFocusedWindow: true })` itself and **writes
  no session state** — no `targetTabId`, no `state`, no banner.
- **This is a scoped deviation from AI_CONTEXT §8's "one target tab"**, and it is
  bounded by the next rule: a probe tab and a target tab never coexist.
- **Probes are refused while a run is in progress, on either backend.**
  `background.js` routes anything not in `CONTROL_TYPES` through `serialize`, and a
  step can hold that lock for its whole budget — 20 s for `navigate`. A probe queued
  behind it would answer long after the keystroke. Playwright has no such lock, which
  makes it worse rather than better: a probe would evaluate in the same frame a step
  is mid-way through driving. The alternative, adding `resolve` to `CONTROL_TYPES`, would
  re-enter the page mid-action and stretch a set that AI_CONTEXT §8 deliberately
  limits to `pause` / `resume` / `stop` / `abandon`. **Requirement:** the
  main-process handler refuses with `reason: 'run-in-progress'` before touching the
  bridge, gated on the orchestrator's `busy` flag; the editor shows "live checking
  pauses while a run is in progress". `busy` is `private` in
  [orchestrator.ts](../../src/main/automation/orchestrator.ts), so this adds a public
  `get isBusy()` beside `OrchestratorBusyError`.
- **The probe takes no screenshot**, so the trap that breaks every `screenshot` step
  — `capture()` in [background.js](../../extension/background.js) throws unless the
  target tab is the active tab in its window — does not apply. The active-tab
  *query* is still the thing that decides what gets probed, so switching tabs
  changes the answer, which is what `url` in the reply is for.

### Pages the probe cannot judge, and must not guess about

Each of these produces a refusal, never `count: 0`. A confident false negative is
worse than no answer.

- **Iframes — on the extension backend.** `extension/manifest.json` sets
  `all_frames: false`, so the content script runs in the top frame only, and
  `queryAll` cannot cross an iframe boundary in any case. A perfectly valid selector
  for an element inside an iframe reports zero matches, indistinguishable from a typo.
  **Requirement:** the editor states the scope — *"no matches in the top frame of
  `<url>`; frames are not checked"* — whenever `count` is 0. **The Playwright backend
  does not have this limit**, and hiding that would make the probe disagree with the
  run it is predicting: `PlaywrightSession.frameFor` already falls back to walking
  `page.frames()` when the main frame matches nothing, so a step whose selector lives
  in an iframe runs there. **Requirement:** on that backend the probe repeats the same
  fallback and reports which frame answered, and the zero-match copy drops the "frames
  are not checked" clause rather than asserting something false.
- **`chrome://`, PDF viewer and new-tab pages** have no content script at all.
  `ensureInjected` returns an error string, which `snapshot` already surfaces as
  `domError`. The probe surfaces it as `reason: 'page-unreadable'`. The Playwright
  twin is `callHooks`, which re-injects once and then throws *"the automation agent
  could not be injected into this page"* — the same refusal, different sentence.
- **A stale content script — extension backend only.** `ensureInjected` compares
  `window.__oaVersion` against the manifest version and returns *"this tab is running
  automation script X but the extension is Y — reload the tab"*. The probe returns
  that verbatim as `reason: 'stale-script'` (§9 explains why this is the common case
  right after this ships). Playwright cannot reach this state: it injects
  `page-core.js` from the app's own bundle on every document, so app and engine cannot
  disagree about their version.
- **An invalid selector.** `queryAll` throws `"…" is not a valid selector` from its
  `catch` around `querySelectorAll`. This is the *dominant* case while typing — every
  intermediate keystroke of `button:has-text(` is invalid — so it is a first-class
  state, `reason: 'invalid-selector'`, rendered as neutral progress rather than as an
  error.

### The credential guard points the wrong way today

`accessibleText` pushes `el.value` into the match bag. So
`input[type=password]:has-text("hunter2")` is a working oracle: it matches when the
guess is right and not when it is wrong. And any report echoing accessible text would
carry a password across the serialization hops into the main process.

The previous draft's constraint — *"checks must respect the sensitive-field scan"* —
does not address this. `scanSensitive` is a page-wide **hold** heuristic, invoked from
`runStep` in [background.js](../../extension/background.js) on the extension backend
and from `scanHold()` in
[playwright-session.ts](../../src/main/automation/playwright-session.ts) on the
default one; a probe path reaches neither, and AI_CONTEXT §8 forbids leaning on it
for credentials anyway. The
target-level guard is `assertWritableTarget` in
[page-core.js](../../extension/page-core.js), which refuses `type` / `select` against
`SENSITIVE_TARGET` — it covers writes only, and neither guard gates a read.

**Requirements, all three:**

1. **The probe's text matching ignores live input.** The resolve path computes its
   accessible-name bag **without** `el.value`. This closes the oracle at source. It
   is a deliberate divergence from the run path — a selector that relies on matching
   a field's current contents will report fewer matches in the editor than at run
   time — and it is owned by the divergence risk in §9 rather than hidden.
2. **A read-side twin of `assertWritableTarget`.** A new `assertReadableTarget` in
   [page-core.js](../../extension/page-core.js), over the same `SENSITIVE_TARGET` table:
   if any candidate matches, the reply is `reason: 'sensitive'` with no counts, no
   ranks and no description. Like its write-side twin it gets **no bypass** — nothing
   resembling `skipScanOnce`.
3. **No accessible text and no `value` in the reply**, per the contract above.

With (1) in place, the residual signal in (2) is "some password field on this page
matches this CSS", which is not a credential. Without (1), (2) alone would still leak
one bit per guess.

### The classifier — what "confidence" actually means here

The deliverable is a pure function from the reply to one verdict, not a number. A
number would be a fiction; a rule set is testable. **Recipe:** put
`classifySelector(reply) → { verdict, fields }` in a new
`src/shared/selector-confidence.ts` with a unit test in
`tests/selector-confidence.test.ts` — pure logic, no Electron, no browser, which is
all `npm test` accepts (AI_CONTEXT §2). Rules are evaluated top to bottom; the first
match wins.

| # | Condition on the reply | Verdict |
|---|---|---|
| 1 | `ok: false` | `unavailable` — carries `reason` and `detail` |
| 2 | `count === 0` | `no-match` — scoped to the top frame and `url` |
| 3 | `best.rank === 4` and `count === 1` and `inViewport` | `clean` |
| 4 | `best.rank === 4` and `!inViewport` | `unproven-offscreen` |
| 5 | `best.rank === 4` and `count > 1` | `ambiguous` — carries `ranks` |
| 6 | `best.rank === 3` | `covered` — carries `covering` |
| 7 | `best.rank === 2` | `disabled` |
| 8 | `best.rank === 1` | `hidden-only` |
| 9 | any rule above, **plus** a generated-looking class in the selector | the verdict, plus a `generated-class` annotation |
| 10 | `shadowScanned: false` | the verdict, plus a `partial-scan` annotation |

**Generated-class detection** needs a pattern or it is not a requirement. Two, as a
named constant in the shared module and covered by the same test file:
`/^(css|sc|jsx|emotion|chakra)-[a-z0-9]{4,}$/i` (styled-components / emotion family)
and `/^[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9]{5,}$/` (CSS-modules hashes). Applied per
class token in the selector, never to `id`. 🔶 **Assumption:** these two cover enough
real class names to be worth warning on, and false positives are annoying rather
than harmful. Nothing measures this yet; if the annotation proves noisy it is one
constant to delete.

The wording the editor shows for each verdict is PRD 11's business, not this PRD's —
pinning copy here would settle presentation before the signal is proven.

### Suggesting better selectors

Where a more durable alternative exists for the same element, offer it. "Durability"
is not a score; it is this fixed order, and "exists" means the named predicate holds:

| Order | Candidate | Exists when |
|---|---|---|
| 1 | `#id` | the element has a non-empty `id` and no generated-class pattern matches it |
| 2 | `[data-testid="…"]` | the element carries `data-testid` / `data-test-id` / `data-test` |
| 3 | `tag:has-text("…")` | the element's accessible name (minus `value`) is non-empty |
| 4 | — | nothing else is offered; a structural path is out of scope (§8) |

**Every suggestion is verified by re-probing it before it is shown**, and shown only
if that probe returns `count === 1` and `best.rank === 4`. This is not belt-and-braces:
`:has-text()` is a case-insensitive substring over the accessible-name bag, so
`:has-text("Send")` and `:has-text("Send message")` can match different sets, and the
narrower string is not necessarily the unique one.

**Deterministic, no model call.** 🔶 **Assumption:** a model call in a
per-keystroke loop would make authoring slow and expensive enough to be abandoned —
untested here, but the four hops in §7's latency budget already consume the budget
without one. Note also that nothing in this repo generates a selector today; the four
rules above are new code, not a solved problem being reused.

### Assertions

PRD 06's `assert` steps take selectors and are more sensitive to brittleness — a
flaky assertion is worse than no assertion. The probe applies to them, but **the
guidance inverts for `expect: 'absent'`**, which is half of PRD 06's step shape:

| Reply | `expect: 'present'` | `expect: 'absent'` |
|---|---|---|
| `no-match` | *is this the right page?* | the assertion passes right now |
| `hidden-only` | fragile | passes — PRD 06 counts a hidden element as absent |
| `clean` | good | the assertion **fails** right now |

So the editor must know the step's `expect` before it says anything, and must never
show "0 matches — is this the right page?" against an `absent` assertion.

---

## 6. Success Metrics

### Primary

**Authored-clean share** — of the selectors in a saved routine, the share whose probe
verdict at save time was `clean`.

- **Mechanism.** The editor already has the reply; the save path records the verdict
  per step alongside the routine. That is a persistence change, so it follows
  AI_CONTEXT §10: **append** a migration to `MIGRATIONS` in
  [database.ts](../../src/main/db/database.ts) adding a nullable `probe_verdicts TEXT`
  column to `user_routines` — never edit a shipped entry; `PRAGMA user_version` is the
  cursor and both tables are `STRICT`.
- **Baseline.** Zero rows have it before this ships, which is the point: the metric is
  readable from the first save afterwards, without PRD 01 or PRD 09.
- **Cohort split.** `user_routines.created_at` exists and gives before/after. Routines
  hand-written into [updates/](../../updates/) have no authoring timestamp at all —
  `system_routines.loaded_at` is the sync time, not the write time — so the cohort
  comparison covers user routines only. Say so when reporting it.

### Secondary

- **Selector failure rate** — share of run failures caused by selector resolution.
  🔵 **Open Question**, and **cannot be measured yet**: it needs PRD 09's
  `failure_class`, which is a *measurement* dependency, not a build dependency —
  [README.md](README.md)'s table records this PRD's only dependency as PRD 11, and
  this PRD must not wait on 09. Proxy until then: the repair count already carried in
  `RunResult.repairs`, split by the same `created_at` cohort.
- **Suggestion acceptance rate** — how often the Author takes an offered selector.
  **Cannot be measured yet**: no PRD provides editor-side event logging, and this one
  does not add it. Proxy: for saved routines, how many selectors exactly equal a
  suggestion the rules would have produced — computable offline from
  `probe_verdicts` plus the definition.
- **Latency** — see the guardrail below for its mechanism.

### Guardrails

- **Never block saving a selector the checker dislikes.** Guidance, never
  enforcement — the Author may be authoring against a page that is not open.
- **The check must be fast.** 🔶 **Assumption:** above ~300 ms it stops reading as
  live feedback. The number is asserted, not measured, and it is asserted about a
  path with four serialization boundaries (§9). **Mechanism:** in-page cost is
  measured in real Chrome by `tests/content-script.verify.mjs`
  (`npm run test:extension`, which already drives the content script through
  playwright-core) against a named fixture — 5 000 nodes, three open shadow roots,
  a selector matching nothing — asserting the `rankAll` call stays under a stated
  bound. End-to-end round trip **cannot be measured in the field today**; the
  handler in [ipc.ts](../../src/main/ipc.ts) logs its own `Date.now()` delta in dev
  as the interim proxy.
- **The check must never act on the page.** No `settle`, no `scrollIntoView`, no
  polling, no `ACTIONS` entry. Enforced by which functions the `resolve` handler is
  allowed to call.

---

## 7. User Stories & Requirements

### Epic hypothesis

We believe that showing selector quality while authoring will reduce selector-caused
failures, because the ranking that predicts them is already computed and shown only
after a failure. We will know we are right when the authored-clean share rises and
the repair count for routines created after this ships is lower than for those
created before.

### Story 1 — Live feedback

**As** the Author, **I want** to see what a selector matches as I type it, **so
that** I find out immediately rather than at run time.

```gherkin
Scenario: A clean selector reports itself usable
  Given the editor is open and the target page is the active tab
  And no run is in progress
  When I type 'button:has-text("Send")' and stop typing
  Then the reply reports count 1, best rank 4 and inViewport true
  And the classifier returns verdict 'clean'
  And the checked URL is shown

Scenario: A rank-4 element that is scrolled out of view is not called clean
  Given the only match is below the fold
  When the probe returns best rank 4 and inViewport false
  Then the classifier returns 'unproven-offscreen'
  And the editor does not present the selector as verified

Scenario: A covered element is called out
  Given '#checkout' matches one element whose centre is under a consent dialog
  When I type it
  Then the reply carries best rank 3 and covering { tag: 'div', id: 'consent' }
  And the covering element is named from those structured fields

Scenario: No matches states its scope
  Given '.submit-btn' matches nothing in the top frame
  Then the editor reports zero matches, names the checked URL, and states that
       frames are not checked

Scenario: A partial selector mid-keystroke is not an error
  Given I have typed 'button:has-text(' which queryAll rejects
  Then the reply is ok:false with reason 'invalid-selector'
  And the editor shows a neutral in-progress state, not a failure

Scenario: The bridge is not connected
  Given the extension is not connected
  Then the reply is ok:false with reason 'no-page'
  And the editor states that live checking is unavailable
  And editing continues normally

Scenario: A run is in progress
  Given a routine is running
  When I type a selector
  Then the handler refuses with reason 'run-in-progress' without contacting the
       extension
  And the editor says live checking pauses during a run

Scenario: The tab still has the previous content script
  Given the extension was upgraded and this tab has not been reloaded
  Then the reply is ok:false with reason 'stale-script'
  And the extension's own reload instruction is shown verbatim

Scenario: The page cannot carry a content script
  Given the active tab is a chrome:// page, a PDF or the new-tab page
  Then the reply is ok:false with reason 'page-unreadable'
  And no match count is shown

Scenario: A sensitive candidate is refused
  Given I type 'input[type=password]:has-text("hunter2")'
  Then assertReadableTarget refuses and the reply is reason 'sensitive'
  And the reply carries no count, no ranks, no description and no text
```

### Story 2 — Fragility warnings

**As** the Author, **I want** to be warned about selectors that work now but will
not last, **so that** I avoid writing tomorrow's failure today.

```gherkin
Scenario: Multiple matches with hidden duplicates
  Given a selector whose reply is count 3, ranks { 1: 2, 4: 1 }
  Then the classifier returns 'ambiguous' and the editor reports the rank breakdown

Scenario: A generated-looking class is annotated
  Given a selector containing '.css-1x9d0f'
  When the constant's first pattern matches that token
  Then the verdict carries a 'generated-class' annotation
  And a suggestion is offered only if one satisfies Story 3's verification

Scenario: A capped scan says so
  Given the light DOM matched nothing and the shadow walk hit its cap
  Then shadowScanned is false and the verdict carries a 'partial-scan' annotation
```

### Story 3 — Better alternatives

**As** the Author, **I want** a suggested selector for the element I meant, **so
that** I do not have to know what makes one durable.

```gherkin
Scenario: A suggestion is verified before it is shown
  Given my selector matches a button whose accessible name is "Send message"
  When the rules produce 'button:has-text("Send message")'
  Then that suggestion is itself probed
  And it is shown only if the probe returns count 1 and best rank 4
  And a suggestion whose probe returns count 2 is discarded, not shown

Scenario: Substring semantics can widen a suggestion
  Given two buttons named "Send" and "Send message"
  When the rules would offer 'button:has-text("Send")' for the second
  Then the verification probe returns count 2 and the suggestion is discarded

Scenario: Suggestions follow the fixed order
  Given the element has a non-generated id, a data-testid and an accessible name
  Then the id is offered first, then the test id, then the has-text form
  And accepting one replaces the selector in the step

Scenario: Nothing durable exists
  Given the element has no id, no test id and an empty accessible name
  Then no suggestion is offered and the warning stands alone
```

### Constraints and edge cases

- **The probe checks the active tab**, which may not be the page the step runs on.
  Every reply carries `url` and the editor always shows it.
- **`:has-text()` is honoured only at the end of a selector** (`HAS_TEXT` is
  end-anchored), so a mid-selector occurrence is passed to `querySelectorAll` and
  rejected as invalid. The `invalid-selector` refusal covers it.
- **A selector containing `{{param}}` is probed verbatim.** Params substitute only
  into `navigate.url`, `type.text` and `select.value` (`resolveStep`, now the single
  substitution site, exported from
  [shared/routines.ts](../../src/shared/routines.ts) and called by both backends) —
  never into selectors, deliberately, so a literal `{{…}}` in CSS survives
  (AI_CONTEXT §6).
  There is also no concept of a param *default*: unknown params resolve to `''`. So
  the probe reports what the CSS actually says, which for a templated selector is
  normally `invalid-selector` or zero matches. Substituting into selectors would be a
  data-contract change, not a probe feature — see §8.
- **A match cap bounds the in-page cost.** `shadowRoots()` runs
  `querySelectorAll('*')` over the whole document and recursively per open root, and
  it fires precisely when the light DOM matched nothing — i.e. on most keystrokes.
  `MAX_PROBE_SHADOW_ROOTS` bounds that walk and sets `shadowScanned: false` when it
  bites; `MAX_PROBE_RANKED` bounds how many candidates get a rect and an
  `elementFromPoint`, with `count` still reported exactly (it is just
  `candidates.length`) and `ranked` saying how many were scored.

---

## 8. Out of Scope

- **Click-to-pick a selector from the page.** Needs a picker mode, an overlay and a
  selector generator; §10 records the decision to sequence it after this.
- **Structural / path-based suggestions** (`div > ul > li:nth-child(3)`). Brittle by
  construction, and not worth offering as a "durable" alternative.
- **Substituting params into selectors.** Legitimate, but it is a scoped
  data-contract change with its own PRD, not a line in this one. It is one site
  smaller than this bullet used to claim: `resolveStep` moved to
  [shared/routines.ts](../../src/shared/routines.ts), where both
  `ExtensionSession.runStep` and `PlaywrightSession.runStep` call it, so there is no
  per-backend twin to keep in step any more. It still touches that function and the
  validator's treatment of a literal `{{…}}` in CSS
  ([routines.ts](../../src/shared/routines.ts)) — plus it deletes an invariant
  AI_CONTEXT §6 states deliberately.
- **Checking frames.** Would mean `all_frames: true` in
  `extension/manifest.json` and a frame-aware reply; both change what every step
  sees, not just the probe.
- **Checking a page other than the active tab**, and checking pages with no content
  script.
- **Historical selector reliability** ("this selector failed 4 times") — PRD 09.
- **Auto-rewriting selectors** without the Author accepting.
- **Model-generated selector suggestions.**

---

## 9. Dependencies & Risks

### Dependencies

- **PRD 11** — the editor. Hard blocker.
- **A new IPC channel.** None of the 27 in `IpcChannels`
  ([ipc.ts](../../src/shared/ipc.ts)) fits. AI_CONTEXT §10's recipe, in order:
  1. add `automationResolveSelector: 'automation:selector:resolve'` to `IpcChannels`
     in [shared/ipc.ts](../../src/shared/ipc.ts);
  2. add a `handle(...)` in [main/ipc.ts](../../src/main/ipc.ts) that shape-checks
     the payload there (a non-empty `selector` string, plus the step's `expect` when
     it is an assert), gates on the orchestrator's new `isBusy`, and calls the
     **session**, not the bridge — the `handle` wrapper already enforces
     `trustedSenders`. No store is involved, so there is no deep-validation step;
  3. add the method to `api.automation` in
     [preload/index.ts](../../src/preload/index.ts);
  4. call it from the renderer — from the editor component PRD 11 builds, through a
     `state/` hook alongside `useAutomations` and `useRuns`, which is where every
     other IPC surface is reached from since the React rewrite.
  It is invoke-only, so it gets no `on…Changed(listener): () => void` unsubscriber.
  Because only error *messages* cross IPC (AI_CONTEXT §8), the refusal reasons travel
  as **data** in the reply, never as thrown errors the renderer would have to
  string-match.
- **This is not a new step kind**, so the six-place recipe does not apply: no
  `ActionStep` member, no `STEP_FIELDS` entry, no `describeStep` case, no
  `stepTimeout` entry.
- **But it does need both backends, and the previous draft's escape route is
  closed.** That draft said the probe could hang off `ExtensionBridge` directly,
  "exactly as `automationStatus` and `automationPause` already do". Those two do not
  do that any more: they go through `SessionControl`
  ([session-control.ts](../../src/main/automation/session-control.ts)), the interface
  `ExtensionBridge` and `PlaywrightSession` both implement and which `main/index.ts`
  picks between at startup. Since `AUTOMATION_BACKEND` defaults to Playwright, a
  probe reached only through `ExtensionBridge` would be **dead in the default
  configuration** — every reply `no-page`, on every machine that has not opted into
  the extension backend. **Requirement:** the probe is a method on
  `AutomationSession` ([session.ts](../../src/main/automation/session.ts)) with an
  implementation in each session class, so the two backends match at the type level
  as AI_CONTEXT §8 requires and at the behavioural level because the engine beneath
  them is one file.
- **A per-backend method with its own timeout, in both places.** On the extension
  backend, add `resolve(selector, options)` beside `snapshot` in
  [extension-bridge.ts](../../src/main/automation/extension-bridge.ts) with a short
  `PROBE_TIMEOUT_MS` and its own error, **not** `StepIndeterminateError`. Reusing
  `request`'s 30 s default would make a slow probe reject as *"it may or may not have
  run, so check the page"* — nonsense for a pure read. It stays in the same `pending`
  map, so `cancel()` rejects it with `RunCancelledError` (AI_CONTEXT §8 requires any
  new parked request be reachable by `cancel()`); the editor renders that as
  `unavailable`, not as a failure. The Playwright twin needs the same bound for the
  same reason and gets it from a different mechanism: `timedEvaluate` already caps
  every `callHooks` at `HOOKS_TIMEOUT_MS`, which is 30 s and so is exactly the budget
  a probe must not inherit. Give the probe its own shorter timeout there too, and
  register it with `cancelRejectors` so `cancel()` reaches it.
- **A version bump, with consequences — and only on one backend.**
  `EXTENSION_VERSION` in
  [extension-bridge.ts](../../src/main/automation/extension-bridge.ts) and `version`
  in `extension/manifest.json` are both `1.10.0` (verified 2026-08-27) and must move
  together to `1.11.0`; `tests/extension-session.test.ts` asserts they agree. What
  that costs: `ExtensionSession.connect` throws on any mismatch, so **the app refuses
  every older extension for every run**, not just for probes; picking up the new
  extension needs a **full Chrome quit**, not a window close; and every already-open
  tab keeps the old engine because of the `window.__oaVersion` re-injection guard in
  `content.js`, so the first probe against such a tab returns `stale-script`. Story 1
  covers that scenario explicitly — bridge disconnection is not the only degradation
  path. None of this applies to the Playwright backend, which injects `page-core.js`
  from the app's own bundle and so cannot be out of step with itself.

### Risks

| Risk | Mitigation |
|---|---|
| **The probe diverges from the run path**, so the editor says one thing and the run does another — worse than no feedback. | Call `rankAll` / `best` / `queryAll` directly; they are already pure. There is no mode flag to thread, because acting lives in `ACTIONS` and in `settle`'s `scrollIntoView`, not in the resolver. Two divergences are deliberate and **reported in the reply**: the probe never scrolls (so a rank-4 verdict on an off-screen element is `unproven-offscreen`), and it ignores `el.value` in `:has-text()` matching (`shadowScanned` and the classifier annotations carry the rest). |
| **A rank-4 verdict is read as a guarantee** when it was taken at a scroll position the run will not reproduce. | `inViewport` in the reply, a distinct verdict for it, and no bare rank is ever printed. This is the feature's headline caveat, not a footnote. |
| **A password leaks across the bridge.** `accessibleText` folds `el.value` into the match bag, which makes `input[type=password]:has-text("…")` an oracle. | The three §5 requirements: value-free matching on the probe path, `assertReadableTarget` with no bypass, and a reply that carries no text and no `value`. Not `scanSensitive` — AI_CONTEXT §8 forbids leaning on it for credentials. |
| **The wrong page is checked**, giving confidently wrong feedback. | `url` in every reply, always shown; refusals for every page the probe cannot read; 0 matches always scoped to "the top frame of `<url>`". |
| **Latency makes the editor feel sluggish.** The path is renderer → preload → main → socket → [relay.js](../../native-host/relay.js) → stdio → background → content and back: four serialization boundaries, plus a whole-document `querySelectorAll('*')` walk per open shadow root when nothing matched, plus a rect and an `elementFromPoint` per candidate. | Debounce in the editor; `MAX_PROBE_SHADOW_ROOTS` and `MAX_PROBE_RANKED`; no polling and no wait-for-appearance; the short `PROBE_TIMEOUT_MS`; and the §6 measurement mechanism so the 300 ms figure stops being an assertion. |
| **Suggestions are worse than what the Author wrote.** | The fixed order, plus the verification probe — nothing is shown that does not itself resolve uniquely at rank 4. Never auto-applied. |

---

## 10. Open Questions

- **Resolved: click-to-pick comes second, not first.** It is the more valuable
  feature in the long run, but it needs this probe to be worth anything — a generated
  selector is only a suggestion until something confirms it resolves uniquely at rank
  4, which is exactly Story 3's verification step. **Decision rule:** if Story 3's
  suggestion rules cannot show a verified alternative for the majority of
  `generated-class` and `ambiguous` verdicts in the first month of authored-clean
  data (§6), cut Story 3 and re-open click-to-pick as its replacement rather than
  iterating on the rules.
- **Resolved: the probe reports the instantaneous state**, not a polled one. `best`
  is the pure entry point and `waitForActionable` is the polling wrapper, so this is
  also the cheaper and the non-acting choice.
- 🔵 What share of failures are selector-caused? PRD 09 answers it, and it sizes this
  PRD's value precisely. Until then §6's primary metric stands on its own.
- 🔵 Should the classifier's `unproven-offscreen` verdict offer to scroll the element
  into view and re-probe? It would make the verdict predictive, but scrolling is
  acting on the page, which §6's third guardrail forbids. Currently: no.
- 🔵 Does the `sensitive` refusal fire often enough on ordinary login and checkout
  pages to be irritating? `SENSITIVE_TARGET` is narrow — password, `cc-*`,
  one-time-code — but a checkout form is exactly where an Author works.
- 🔶 **Assumption:** the two generated-class patterns in §5 are worth their false
  positives. One constant to delete if not.

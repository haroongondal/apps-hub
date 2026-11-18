# Model evals

Measured behaviour of the model layer — the prompts, tool schemas and loop in
`src/main/automation` — against a fixed dataset of pages and goals. Unlike
`npm test`, every trial here **calls the live model through the gateway** and
costs real money, so evals are a separate command, never part of CI-by-default.

```
npm run eval                       # every case, 3 trials each (~90 calls, well under $1)
npm run eval -- --list             # show the dataset without calling anything
npm run eval -- --suite decisions  # one suite
npm run eval -- --case D02-search-type-submit --trials 5
npm run eval -- --min-pass 0.8     # exit 1 below 80% pass rate (for a CI gate)
npm run eval -- --concurrency 8    # default 4
```

Needs `AI_GATEWAY_API_KEY` (read from `.env` like the app in dev). Every run
writes full transcripts — each decision, grade and reason — to
`evals/results/<timestamp>.json` (gitignored) for failure analysis.

## The three suites

| Suite | What runs | What one trial costs |
| --- | --- | --- |
| `decisions` | One `nextAction` call on a production-shaped thread: goal, filtered DOM, optionally prior turns pruned exactly as `pruneThread` leaves them | 1 model call |
| `repairs` | One `repairStep` call with the routine context `describeContext` builds | 1 model call |
| `goals` | The real `runChatGoal` loop end to end, driving a `FakeSession` over fixture pages | one call per step, bounded by the case's `stepCap` |

The goals suite is the highest-fidelity signal: it exercises the system prompt,
the tool schema, thread pruning, the dead-target refusal, hand-offs and the
static-page counter — everything except a real browser. The decisions suite
isolates single judgments so a regression names the exact behaviour that moved.

## How grading works — no LLM judge

Every grader is code. A case states what a correct answer looks like and the
grader checks the model's actual output against the page:

- **Selector resolution.** `harness/selector.ts` mirrors `queryAll`/`rank`/
  `best` from `extension/content.js` (including `:has-text()` and accessible
  text), so "the selector resolves to the right element" means it would have
  worked in the browser. Fixture pages mark acceptable elements with
  `data-eval-target="name"` — `filterDom` strips that attribute, so **the model
  never sees the markers**; only the grader does.
- **Kind-conditional expectations.** When a case sets both `target` and
  `urlMatches` they are alternatives: a `click` must resolve to the marked
  element, a `navigate` must match the URL — because the system prompt itself
  says either is right. `textMatches` applies to typed text, `submit` to type
  actions.
- **Forbids.** `forbid.targets` (e.g. a password field), `forbid.actions`
  (e.g. `done` at a wall), `forbid.selectorMatches` (machine-generated ids),
  and the case's `avoid` list are graded as hard failures.
- **Goal outcomes.** Terminal status (`done` vs `assisted` vs `error`), the
  page the run ended on, whether a hand-off happened, and what was actually
  typed into each field. `status` and `finalPage` each take a list when more
  than one ending is honest — use that rather than picking one arbitrarily and
  failing a model that chose the other. `forbidFinalMatches` is the opposite
  test: a regex the run's sign-off must **not** match, for cases where the
  failure is what the run *claims* rather than where it ends up.

Trials exist because the model is nondeterministic: a case passing 2/3 is a
different signal from 0/3, and the report shows both per case and per suite.

## The fake session

`harness/fake-session.ts` implements `AutomationSession` over a page graph:

- Each page is a fixture HTML file; snapshots run through the production
  `filterDom`. Snapshots are DOM-only (`screenshotError` set), which is the
  real occluded-window path — the model is told to decide from the DOM alone.
- `transitions` move between pages when an action matches: by marker, typed
  text, `submit`, a `from` page, or `filled` preconditions (regexes over what
  has been typed so far — how G04 makes "place order" only work once the form
  is truly filled).
- Typed text is mirrored into the served DOM like `mirrorLiveState` does, so
  the model sees fields it filled as filled.
- A selector that matches nothing throws a healable `StepExecutionError`; a
  marker listed in the page's `covered` throws the covered-element refusal; a
  click that matches no transition returns `changed: false`. All three exercise
  the loop's real recovery paths.
- `onHold` says which page a human hand-off leaves behind; `stepCap` bounds
  model spend — a run that looks at the page more times than that ends as an
  error and fails its trial.

## Adding a case

1. Pick or write a fixture in `pages/`. Real-world noise (scripts, wrapper
   divs, machine-generated ids) is good — `filterDom` runs on it either way.
   Mark every element a correct answer may touch with `data-eval-target`.
2. Add the case to `cases/decisions.json`, `cases/repairs.json` or
   `cases/goals.json`. Field reference: `harness/types.ts`. Regexes are strings
   compiled case-insensitive.
3. `npm test` — `tests/eval-dataset.test.ts` cross-checks every case against
   its pages (markers exist, fixtures load, regexes compile, transitions point
   at real pages) before any token is spent.
4. Run the single case a few trials: `npm run eval -- --case <id> --trials 3`.
   A case a correct model fails is a bad case; fix the expectation, not the
   model.

Keep cases fair: one unambiguously best behaviour (or an explicit alternative
via `target`/`urlMatches`), goals worded the way a user would put them, and no
marker leakage into visible text.

## Current baseline

22/23 cases passed at 1 trial on 2026-08-26 (Sonnet 5 via the gateway).
`G05-served-error-page` and `G06-terminal-block-page` were both added after that
run and each passes 3/3 on its own; the suite has not been re-run whole since, so
24/25 is inferred, not measured.
`R04-committing-ambiguous` is a **known red**: shown a committing click that ran
with no reaction on a fully-filled form, the model invents doubt about the
selector and repairs to click "Place order" again — exactly what
`REPAIR_PROMPT`'s never-repeat-a-commit rule forbids. It stays red as a tracked
prompt weakness; if a prompt change fixes it, this section is what to update.

## Known limits

- **No screenshots.** Fixtures cannot render, so every trial is the DOM-only
  path. Vision-dependent behaviour is out of scope here.
- **No layout.** The Node-side resolver cannot compute visibility from CSS or
  occlusion; it ranks on `hidden`/`disabled`/`aria` attributes, and coverage is
  declared per page via `covered`. Fixtures should not rely on stylesheet-only
  hiding.
- **Repair calls report no token usage** — `repairStep` returns only the plan;
  the report counts those calls but prices only what `nextAction` reports.

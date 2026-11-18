# Implementation brief

Paste this into a fresh session, or tell it: *read `docs/IMPLEMENTATION-PROMPT.md` and start.*

---

## What I want

Build out this product against the thirteen PRDs in [docs/prd/](prd/), and fix the frontend
while you do it. Work through the PRDs in the order and phases argued in
[docs/IMPLEMENTATION-ORDER.md](IMPLEMENTATION-ORDER.md). Ship in slices that leave the app
working, not one giant branch.

Use multiple agents / agent teams for this. It is a large body of work with genuinely
independent pieces, and I would rather you fan out and verify than do it all in one thread.
How you decompose it, when you parallelise, and how you review your own output is your call —
you have the whole picture, so make those decisions yourself rather than asking me to
choreograph them.

Use the frontend and UI/UX skills available to you for the interface work. It should look and
feel like a considered product, not a form.

## Read first

[AI_CONTEXT.md](../AI_CONTEXT.md), in full, before opening anything else — [CLAUDE.md](../CLAUDE.md)
requires it and it will save you a context window. Then [docs/prd/README.md](prd/README.md),
which carries the shared personas, the strategic context, the dependency table, and a section
called *How a run ends today* that every PRD depends on.

Two things about the state of these documents:

- **The PRDs and the architecture docs were audited against the code and corrected on
  2026-08-20.** Every code citation names a file and an exported symbol rather than a line
  number, and every code change a PRD requires is written into that PRD explicitly — the
  migration, the IPC channels, the six-place step-kind recipe, the invariants to amend. Trust
  them. If you find one that is wrong, that is a real bug: fix the document in the same change,
  the way `AI_CONTEXT.md` §13 requires.
- **`AI_CONTEXT.md`, `ARCHITECTURE.md` and `HOW-IT-WORKS.md` had drifted and were also
  corrected.** Their known-remaining gaps are recorded in `AI_CONTEXT.md` §12.

## Decisions already made — do not reopen these

They came out of the audit, and reversing one silently would break several PRDs at once.

1. **A layer-3 hold continues past the held step. That stays.** A human who just did step 4 by
   hand must not watch it replay. No PRD may specify that exhausting the repair budget ends the
   run.
2. **But `done` is the wrong terminal status for such a run**, because it is a lie about
   autonomy rather than about outcome. PRD 01 owns the widened status set — `done` vs
   `assisted`, plus a `human_steps` count — and five other PRDs are written against it. Land
   PRD 01's event-vocabulary change properly; it is the thing most of the set is blocked on.
3. **A failed `assert` fails the run.** It is a verdict about the page, not an errand a human
   can run for you, so it must not route to the hold path. PRD 06 specifies the non-healable
   error.
4. **M2 is a gate, not a guideline.** Nothing that runs unattended ships before PRDs 01, 03, 05
   and 06 are done. `IMPLEMENTATION-ORDER.md` explains why; the short version is that a
   scheduler on today's foundation ships four known defects at machine speed.

Two things are still open and are mine to decide, not yours — surface them when you get close
and I will answer: **which tab a scheduled run uses**, and **whether the app runs in the
background at all** (tray, launch-at-login). PRD 07 argues a position on both. Do not
implement PRD 07's scheduling until we have settled them.

## The frontend

The renderer is 306 lines of vanilla TS, one 279-line stylesheet, and one HTML file. It works
and it is honest, but it is a developer's scaffold rather than a designed interface, and it is
about to absorb the largest UI additions in the set — a runs rail, a thread view, a repair
queue, a step editor, a debugger.

**Decide early whether that stays vanilla TS or takes a framework.** `IMPLEMENTATION-ORDER.md`
assigns that call to PRD 01 deliberately, so that it is made while the first real UI is being
built instead of being discovered during PRD 11. Note the packaged CSP is pinned to `'self'`
with no `unsafe-eval`, so whatever you choose has to be bundled — no CDN, no runtime template
compilation.

I flagged that the save button looks merged into the chat messages. It does, and the cause is
structural rather than cosmetic. These are the issues I verified in the current code — treat it
as a starting set, not the whole list, and do your own pass:

- **A control is being rendered into a transcript.** `appendSaveControl` appends a bare
  `div.save-row` straight into `#messages`, which is a flex column of chat bubbles. It has no
  surface of its own, so "Save as 1-Click Automation" reads as another message. That is the bug
  I noticed, and the fix is to stop putting an action in the conversation stream.
- **The chat input can be pushed out of view.** `.messages` is `flex: 1; overflow-y: auto` with
  no `min-height: 0`, which is the classic flexbox scroll trap — the container grows with its
  content instead of scrolling, and `body` is `overflow: hidden`, so `#chat-form` goes
  unreachable on a long transcript.
- **The save control only appears when a chat run succeeds** (it hangs off `.then`), so a
  session that recorded real steps and then failed can never be saved. It also appends a *new*
  one per goal, so they accumulate.
- **Routine runs and chat runs share one surface.** Clicking Run in the sidebar dumps results
  into a pane titled "Automation Chat". Worse, `appendRunResult` returns early when there is
  nothing extracted, so a successful run can leave no trace at all.
- **`#run-status` is one ephemeral 12px grey span** that every run overwrites — the primary
  feedback channel for the product's main action.
- **Param defaults are shown as `placeholder`**, so a field looks filled and submits empty.
- **No `:focus-visible` styles anywhere**, on custom-styled buttons and inputs.
- **No empty states** for either routine list.
- **The hold banner is `role="status"`** (polite) for an interruption that has stalled the run
  and needs the user in the browser now.
- **Buttons have no hierarchy** — "Cancel run" is styled identically to "Pause" and "Send".
- **Five names for one concept**: Quick Launch, Prebuilt automations, Saved automations,
  1-Click Automation, and "routine" in the PRDs. Pick one vocabulary and use it everywhere.
- **`#d5484f` error text at 12px** probably fails AA contrast on the dark background. Check it.

## How I want you to work

- Follow [CLAUDE.md](../CLAUDE.md) on code style. It is stricter than usual about comments —
  three per file, two lines each, explaining *why* — and it means it.
- Tests: `npm test` (vitest, pure logic), `npm run typecheck`, `npm run test:extension`, and
  `npm run test:db` — that last one **cannot** be replaced with plain `vitest` or `node`, for
  the reason given in `AI_CONTEXT.md` §9. Anything touching the schema needs assertions there.
- Update `AI_CONTEXT.md` in the same change that makes it stale. Its §13 lists exactly when.
- If you change an extension message or behaviour, bump `EXTENSION_VERSION` and
  `extension/manifest.json` together — a test asserts they agree, and the handshake refuses a
  mismatch.
- The repo has **no commits yet** and everything is untracked. Get it into git early with sane
  commits so the work is reviewable, and branch rather than working on `main`.
- Tell me when a slice is done and verified, and show me the app actually running rather than
  only the tests passing. Report honestly — if something is half-done or you skipped it, say so
  and say why.

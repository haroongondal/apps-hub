# PRD set — autonomous browsing

Thirteen PRDs, ordered by the sequence they should be built in. The order and its
reasoning live in [IMPLEMENTATION-ORDER.md](../IMPLEMENTATION-ORDER.md); this file
holds the context every PRD shares so none of them has to repeat it.

| # | PRD | Phase | Depends on |
|---|---|---|---|
| 01 | [Run threads](01-run-threads.md) | Foundation | — |
| 02 | [Run cost & budget meter](02-cost-meter.md) | Foundation | 01 |
| 03 | [Repair review queue](03-repair-review.md) | Foundation | 01 |
| 04 | [Resumable threads](04-resumable-threads.md) | Foundation | 01 |
| 05 | [Run queue](05-run-queue.md) | Unattended | — |
| 06 | [`assert` step kind](06-assert-step.md) | Unattended | — |
| 07 | [Schedules & triggers](07-schedules.md) | Unattended | 01, 05 |
| 08 | [Hold & failure notifications](08-notifications.md) | Unattended | 01 |
| 09 | [Failure fingerprints](09-failure-fingerprints.md) | Durability | 01, 03, 06, 07 |
| 10 | [Routine export & import](10-export-import.md) | Durability | — |
| 11 | [Routine editor](11-routine-editor.md) | Durability | 03 |
| 12 | [Selector confidence](12-selector-confidence.md) | Durability | 11 |
| 13 | [Step-through debugger](13-step-debugger.md) | Durability | 01, 03, 05, 11, 12 (soft) |

This table is the one authority on dependencies. Where a PRD's own header or
[IMPLEMENTATION-ORDER.md](../IMPLEMENTATION-ORDER.md) disagrees with it, this table wins
and the other document is the bug.

## Shared strategic context

**Product outcome all thirteen ladder up to:** more automation runs complete
without a human watching, and are trusted afterwards.

That outcome is already what the codebase is paying for. The four-layer healing
architecture described in [HOW-IT-WORKS.md](../../HOW-IT-WORKS.md) §6 — selector
resolution, change verification, LLM repair, human hold — exists so a routine
recorded weeks ago still works today. What the codebase does *not* yet have is
any way to know whether that investment is working, because no run leaves a trace.

**Evidence baseline.** Every factual claim in these PRDs about the current system
is traceable to a **file and exported symbol** — never a line number. Line numbers rot
within a day, which is the rule [AI_CONTEXT.md](../../AI_CONTEXT.md) §13 already states for
itself; a citation that names `runRoutine` stays true and stays grep-able. Every claim about
user behaviour is tagged 🔶 **Assumption** or 🔵 **Open Question**, because the product
currently emits no telemetry — PRD 01 is what creates the measurement substrate the other
twelve depend on for their metrics. Read any un-tagged behavioural claim, and any
line-number citation, as a bug in these documents.

## How a run ends today

Five of these PRDs originally described this wrongly, so it is stated once here and no PRD
should restate it. Read [HOW-IT-WORKS.md](../../HOW-IT-WORKS.md) §6 for the four healing
layers; this is only the part the PRDs kept getting wrong.

**There are two different things called a hold, and they behave differently.**

A **scan hold** comes from the extension: `scanSensitive` in
[content.js](../../extension/content.js) sees a password, payment or one-time-code field
anywhere on the page and refuses to act. The step **never executed**.
`ExtensionSession.dispatch` waits on `waitWhileHeld` and then **retries the same step**, up
to `MAX_HELD_RETRIES`. This is the invariant AI_CONTEXT.md §8 states as *held ≠ failed*.

A **layer-3 hold** comes from the app: a step has exhausted `MAX_ATTEMPTS_PER_STEP` and
`MAX_REPAIRS_PER_RUN`, so `runWithRepair` raises `NeedsHumanError`. `runRoutine` catches it,
reports `Step N needs you`, awaits `holdForHuman`, and then — deliberately — **continues to
step N+1 and reports the run as `done`**:

> The human does this step themselves, so resuming continues past it. Re-running what they
> just did by hand is the wrong kind of retry.
> — the comment on that catch in [orchestrator.ts](../../src/main/automation/orchestrator.ts)

**Three consequences every PRD must respect.**

1. **Continuing past the held step is correct and stays.** No PRD may specify that
   exhausting the repair budget ends the run. A human did that step; replaying it is the
   double-submit hazard AI_CONTEXT.md §8 warns about.
2. **`done` is nonetheless the wrong terminal status, and PRD 01 owns fixing it.** It is not
   a lie about the outcome — the goal was met — but it is a lie about *autonomy*, and
   autonomy is the product outcome all thirteen ladder up to. A status that cannot separate
   "needed nobody" from "needed me four times" makes that outcome unmeasurable by
   construction. PRD 01 §5 carries the required change: a distinct terminal state plus a
   count of human interventions per run.
3. **A hold is not a general-purpose failure destination.** It means *a human can finish
   this step for me*. Anything that is a verdict about the page rather than an action a human
   can take — a failed assertion, most obviously — must not route here, because the hold
   resolves on Resume and the run then reports success. PRD 06 §5 carries that distinction.

**Unattended, a layer-3 hold does not end at all.** `waitWhileHeld` resolves only on resume
or cancel, so a run that holds at 06:00 with nobody present parks indefinitely, keeping the
orchestrator's `busy` flag, the target tab and the socket. PRD 07 owns bounding it; PRD 08
owns announcing it.

## Shared personas

### Primary — The Operator

Runs automations that someone else authored, day to day. Not a developer. Their
job is the outcome (invoices pulled, prices checked, forms filled), not the
automation. They judge the product on one question: *did it work, and if not,
what do I do now?*

- **Goals:** start a run and walk away; know without asking whether it worked
- **Pain points:** a run that fails silently; a run that needs them at an
  unpredictable moment; no way to show a colleague what happened
- **Current behaviour:** 🔶 **Assumption** — watches the run in the browser
  because there is no other way to know what it did

### Secondary — The Author

Creates and maintains routines, via chat-save today or by hand-writing JSON into
[updates/](../../updates/). Semi-technical: comfortable with selectors and JSON,
not necessarily with the Electron codebase.

- **Goals:** get a routine working once and keep it working as sites drift
- **Pain points:** no editor; no way to test a single step; repairs rewrite their
  routine without asking; no history to roll back to
- **Current behaviour:** authors by running a chat goal and saving the recording — the
  `IpcChannels.automationChatSave` handler in [ipc.ts](../../src/main/ipc.ts), which calls
  `saveChatSession` and then `UserRoutineStore.save` with `source: 'chat'`

### Jobs-to-be-done

| When… | I want to… | So I can… |
|---|---|---|
| a run finishes while I am away | see exactly what it did | trust the result without redoing it |
| a run fails | see where and why, with the page as it was | fix it once instead of watching it fail again |
| a site changes | have the routine adapt, but tell me it did | keep automations alive without silent drift |
| I have ten routines | run them on a schedule | stop being the trigger |

## How these PRDs are scaled

All thirteen carry the same ten sections so a reader always knows where to find scope,
metrics, and risk.

Length tracks how much had to be *decided*, which is not the same as build size. PRD 07
is the longest because it is the only feature that acts with nobody watching, so it
carries the safety gates, the tab decision and the presence requirements. PRD 01 is among
the shortest despite being the foundation, because most of its work is one writer and one
migration. Do not read a short PRD as a small feature or a long one as a large one — read
the **Size** column in [IMPLEMENTATION-ORDER.md](../IMPLEMENTATION-ORDER.md) for that.

🔵 **Open Question:** the set roughly doubled in length when every required code change,
migration and IPC channel was written down explicitly. That makes it complete but no
longer skimmable. If a reader needs an overview, the fix is a short summary per PRD rather
than deleting the detail.

# How it works

A step-by-step walkthrough of one automation run: which process does what, when
the LLM is called, how a request reaches the browser, and what happens when a
step fails.

[ARCHITECTURE.md](ARCHITECTURE.md) is the reference for *why* things are shaped
the way they are. This document is the narrative: follow a step from a button
click to a click on a web page and back.

---

## 1. The five processes

Nothing here is one program. Five separate processes pass messages, and each hop
uses a different transport.

```
┌─────────────────────────────────────────────────────────────┐
│ ELECTRON APP                                                │
│                                                             │
│  renderer  ──Electron IPC──▶  preload  ──invoke──▶   main    │
│  (the UI)                    (bridge)         (orchestrator, │
│                                                SQLite, LLM)  │
└───────────────────────────────────────────────┬─────────────┘
                                                │
                        unix socket, newline-delimited JSON
                        ~/.outsentia-automation.sock
                                                │
┌───────────────────────────────────────────────▼─────────────┐
│ relay.js  (native host — a Node process Chrome spawns)      │
└───────────────────────────────────────────────┬─────────────┘
                                                │
                        Chrome native messaging
                        4-byte little-endian length + JSON, over stdio
                                                │
┌───────────────────────────────────────────────▼─────────────┐
│ CHROME EXTENSION                                            │
│                                                             │
│  background.js  ──chrome.tabs.sendMessage──▶  content.js    │
│  (service worker)                             (in the page) │
└─────────────────────────────────────────────────────────────┘
```

**The LLM is only ever called from Electron main.** The extension never talks to
Anthropic, and the API key never leaves the app process.

| Hop | Transport | Who is the server |
|---|---|---|
| renderer ↔ main | Electron IPC (`ipcRenderer.invoke` / `ipcMain.handle`) | main |
| main ↔ relay.js | Unix socket / Windows named pipe, one JSON object per line | **main** — relay connects to it and retries every 1 s |
| relay.js ↔ background.js | Chrome native messaging over stdio | Chrome spawns relay.js |
| background.js ↔ content.js | `chrome.tabs.sendMessage` | — |

Channel names live in [src/shared/ipc.ts](src/shared/ipc.ts). The socket path is
`BRIDGE_ENDPOINT` in [extension-bridge.ts](src/main/automation/extension-bridge.ts).

---

## 2. One step, end to end

This is the round trip every single action takes. Say the step is
`{ kind: 'click', selector: 'button:has-text("Send")' }`.

1. **Orchestrator** ([orchestrator.ts](src/main/automation/orchestrator.ts))
   calls `browser.runStep(step, vars)`.

2. **ExtensionSession** ([extension-session.ts](src/main/automation/extension-session.ts))
   substitutes `{{params}}` into the step's text fields via `resolveStep`, works
   out a timeout budget for this kind of step (`stepTimeout`), waits if the run
   is currently held, then hands it to the bridge.

3. **ExtensionBridge** ([extension-bridge.ts](src/main/automation/extension-bridge.ts))
   mints a UUID, parks a promise under that id with a timer, and writes one line
   to the socket:

   ```json
   {"type":"step","id":"9f3c…","step":{"kind":"click","selector":"button:has-text(\"Send\")"}}
   ```

4. **relay.js** reads the line, re-frames it as `<4-byte length><JSON>` and writes
   it to stdout, which is Chrome's native-messaging port.

5. **background.js** receives it. `step` messages go through `serialize()` — a
   promise chain that guarantees strictly one step at a time. It then:
   - re-injects `content.js` if needed and checks the tab is running the same
     extension version (`ensureInjected`);
   - sends `{type:'SCAN'}` to the content script to look for password fields,
     payment fields, one-time-code inputs and CAPTCHA widgets. **A hit stops
     here** — it replies `{ok:false, held:true}` and pauses the run;
   - handles `navigate` and `screenshot` itself, because those need the
     `chrome.tabs` API;
   - forwards everything else to the page as `{type:'EXEC', step}`.

6. **content.js** resolves the selector, performs the action, watches the page
   for a reaction, and calls `sendResponse({ok:true, changed:true, committing:false})`.

7. The reply walks back up the same chain. `background.js` echoes the original
   `id` so the bridge can match it, the bridge clears the timer and resolves the
   parked promise, and `runStep` returns.

**If nothing comes back in time**, the bridge's timer fires and raises
`StepIndeterminateError` — deliberately *not* a failure, because the extension
may well have run the step. It also sends `{type:'abandon', id}` so a late reply
is discarded rather than landing against the next step.

---

## 3. Flow A — running a saved routine

A routine is a JSON list of steps, stored in SQLite (user routines) or loaded
from [updates/](updates/) (system routines). **A routine run makes zero LLM calls
unless something goes wrong.**

```
▶ Run clicked
   │
   ├─ renderer collects params, calls window.api.automation.run({kind, id, params})
   ├─ preload forwards over 'automation:run', strips Electron's error wrapper
   ├─ ipc.ts checks the sender is allowlisted, validates the payload, loads the routine
   │
   ├─ RunQueue.enqueue → dispatch now, or hold in `waiting` behind the running entry
   │
   └─ orchestrator.runRoutine({name, description, definition}, params, onProgress)
        │
        ├─ assert no run is in progress (reaching this throw means the queue dispatched twice)
        ├─ browser.connect()  → {type:'start'} → extension picks the active tab
        │                       of the last focused window, returns its version;
        │                       a mismatch aborts here
        │
        ├─ for each step:
        │     emit progress {status:'running', stepIndex, description}
        │     ├─ extract  → extractText(selector), store into vars + extracted
        │     └─ anything → §2 round trip
        │                    └─ on failure or no-op → §6 healing
        │
        ├─ emit progress {status:'done'}
        └─ finally: browser.disconnect(), clear the busy flag, queue pumps the next entry
```

`runRoutine` resolves with `{runId, extracted, artifacts, repairs}`:

- **`extracted`** — what `extract` steps read, capped at 10 000 characters each.
  Only what the run *produced*, never the params it was given.
- **`artifacts`** — screenshots, as data URLs.
- **`repairs`** — steps that were healed **and then succeeded** (see §6). A step
  repaired on one attempt and held on the next contributes nothing: the local
  repair is discarded when `runWithRepair` throws, so the most interesting case
  leaves no record.

---

**The chosen tab must stay the visible one.** `capture()` in `background.js`
throws — *"switch back to it, then resume"* — if the target tab is no longer the
active tab in its window. That covers every `screenshot` step **and** every DOM
snapshot the healer takes, which makes "the user switched tabs mid-run" the most
likely real-world step failure in the product. It is also the first constraint any
background or scheduled run has to design around, because a genuinely background
tab can never screenshot at all.

---

## 4. Flow B — a chat-driven run

Here the LLM drives. `runChatGoal` loops up to **25 times**, and each iteration
makes **exactly one** LLM call.

```
   ┌──────────────────────────────────────────────────────┐
   │                                                      │
   ▼                                                      │
 snapshot the page                                        │
   │  {type:'snapshot'} → screenshot + full DOM (parallel) │
   │                                                      │
 squeeze it (TokenOptimizer)                              │
   │  filterDom: strip script/style/svg, drop hidden       │
   │  elements, keep aria-*/testids/form attrs, truncate    │
   │  optimizeScreenshot: ≤1024×768, JPEG quality 55       │
   │                                                      │
 claude.decideNextAction(goal, snapshot, history) ◀── LLM │
   │                                                      │
   ├─ action 'done' → emit done, exit                      │
   │                                                      │
 toActionStep(decision) → a strict ActionStep             │
   │                                                      │
 run it (§2 round trip)                                   │
   │                                                      │
   ├─ succeeded → record the step, push its description ───┤
   └─ failed    → push "… — FAILED: <why>" into history ───┘
                  (no extra LLM call — the next loop
                   iteration was going to call anyway)
```

The history handed to the model is only the *descriptions* of previous steps,
never previous DOMs — so token cost stays flat across a long run.

Every executed step is recorded in memory, which is what makes "save this chat
as a routine" possible.

---

## 5. The two LLM calls

Both go to `anthropic/claude-sonnet-5` through the Vercel AI gateway
(`https://ai-gateway.vercel.sh`), with `max_tokens: 1024`, thinking disabled, and
**`tool_choice` pinned to a single tool** — so the reply is always structured
data, never prose to parse. Both live in
[claude-client.ts](src/main/automation/claude-client.ts) and share one
`callTool` helper.

### `decide_next_action` — drives a chat run

| | |
|---|---|
| **Called** | Once per chat-loop iteration, up to 25 times |
| **Never called** | During a routine run |
| **Sent** | Goal · numbered history of past step descriptions · URL · page title · filtered DOM · the screenshot as a base64 JPEG image block |
| **Returns** | `{action: 'click'\|'type'\|'navigate'\|'done', selector?, text?, step_description}` |

`step_description` is not just UI text — it becomes the step's `intent`, which is
what a future repair reads to understand what the step was *for*.

### `repair_step` — heals a broken step

| | |
|---|---|
| **Called** | Only when a step fails or leaves the page unchanged |
| **Sent** | The routine's goal · its full step list with the failing index marked `>>` and completed ones marked `ok` · that step's `intent` · what went wrong · a **fresh** snapshot and screenshot |
| **Returns** | `{verdict: 'repair'\|'proceed'\|'impossible', actions?, reason}` |

The three verdicts:

- **`proceed`** — the action did work, the page just doesn't show it (or what the
  step wanted is already true). The run carries on untouched.
- **`repair`** — run these actions instead. Usually one: the same action with a
  selector that matches what's really on the page. Occasionally several, when the
  page needs preparing first — dismiss a consent dialog, then click.
- **`impossible`** — nothing on this page can do it: behind a login, inside a
  cross-origin iframe, or simply absent. A human takes over. This is a real
  answer, not a failure to answer.

The system prompt explicitly forbids repeating a committing action — submitting
an order, sending a message, confirming a payment — on the chance it didn't go
through. If the model can't tell whether such an action landed, it must answer
`impossible`.

---

## 6. How healing works

Four layers. Each one runs **only if the one before it couldn't settle the
matter**, so the cheap deterministic fixes happen before any network call.

```
   run the step
        │
   ┌────▼─────────────────────────────────────────┐
   │ LAYER 0 — resolution        (content.js)     │  no network
   │ find the right element despite the page       │
   └────┬─────────────────────────────────────────┘
        │ found it
   ┌────▼─────────────────────────────────────────┐
   │ LAYER 1 — verification      (content.js)     │  no network
   │ did the page actually react?                  │
   └────┬─────────────────────────────────────────┘
        │ failed, or reacted to nothing
   ┌────▼─────────────────────────────────────────┐
   │ LAYER 2 — repair            (main + LLM)     │  1 model call
   │ what should we do instead?                    │
   └────┬─────────────────────────────────────────┘
        │ impossible, or out of budget
   ┌────▼─────────────────────────────────────────┐
   │ LAYER 3 — the human         (pause banner)   │
   │ you do this one, then press Resume            │
   └──────────────────────────────────────────────┘
```

### Layer 0 — resolution

Most "the automation broke" is really "the selector was fine, the page just isn't
what we assumed". [content.js](extension/content.js) handles this with no model
involved:

- **`:has-text("Send")` matches the accessible name** — visible text,
  `aria-label`, `title`, `placeholder`, `alt`, `aria-labelledby` — so it finds an
  icon-only `<button aria-label="Send message">` containing nothing but an SVG.
- **Open shadow roots are searched** when the light DOM turns up nothing.
  `document.querySelector` can't cross a shadow boundary; `queryAll` walks every
  open root.
- **Candidates are ranked**, not taken in document order:

  | Rank | Meaning |
  |---|---|
  | 4 | visible, enabled, and nothing covering it — **usable** |
  | 3 | covered by another element (`elementFromPoint` returns something else) |
  | 2 | disabled, or inside a disabled fieldset |
  | 1 | not visible (`display:none`, `visibility:hidden`, `opacity:0`, no rects) |

  Only rank 4 is clicked. It polls every 100 ms until one appears or the budget
  runs out. This is why a hidden mobile duplicate no longer shadows the real
  control — and why the DOM the model is sent carries only what the page renders,
  so it is never offered a rank-1 element it cannot act on.
- **Errors explain themselves.** Instead of `timed out waiting for #send`, you get
  `timed out waiting for #send — the best of 3 matches, <button#send>, is covered
  by <div#consent>`. That string is also what Layer 2 reads.

### Layer 1 — verification

A click that finds its target and dispatches perfectly can still do nothing. Old
behaviour: report success. New behaviour: `click`, `type` and `select` watch the
page and return a `changed` boolean.

- A `MutationObserver` on `documentElement` (childList, subtree, attributes)
  **resolves on the first mutation**, so a healthy step pays ~10 ms. The 750 ms
  ceiling is only paid in full when the answer was going to be "nothing happened".
- Mutations aren't enough on their own, so a fingerprint also covers `location.href`,
  scroll position, and the target's `checked` / `value` / `className` / `disabled` /
  `aria-expanded` / `aria-pressed` / `aria-checked` / `aria-selected`. **Ticking a
  checkbox mutates no HTML at all** — `el.checked = true` never touches the
  serialised DOM — so without this it would read as a no-op.
- `pagehide` / `beforeunload` **short-circuit to `changed: true` immediately**.
  Without that, a click that navigates would tear down the content script before
  the timer fired, the reply would never arrive, and a perfectly good click would
  be reported as indeterminate.
- The verdict is deliberately biased toward "something happened". A false *no-op*
  is dangerous; a missed dead click is merely the status quo.

The same reply also carries `committing: true` when the element is a real
form-associated submit control, or its accessible name matches a commit
vocabulary (submit, order, pay, buy, checkout, confirm, delete, send, book,
transfer, withdraw…).

### Layer 2 — repair

Reached when the step threw a healable error, or ran with `changed: false`.

```
problem ──▶ StepHealer.plan(context, problem)
              │
              ├─ budget spent? → giveUp
              ├─ take a FRESH snapshot (the page has moved on)
              ├─ claude.repairStep(...)          ◀── 1 LLM call
              │    └─ any throw here (no API key, rate limit, dead socket)
              │       becomes giveUp, never a crash
              │
              ├─ 'proceed'    → carry on to the next step
              ├─ 'repair'     → convert to ActionSteps, run them, verify again
              └─ 'impossible' → Layer 3
```

Up to **3 attempts per step** and **6 repairs per run**, so a run's model cost is
bounded however far a site has drifted.

**In a chat run there is no Layer 2 at all** — and it doesn't need one. The loop
already re-snapshots and re-decides every turn, so a failure is pushed into the
history as `… — FAILED: <why>. That selector does not work; use a different one.`
and the next `decideNextAction` picks again from the live page. Zero extra model
calls. Three failures in a row ends the run, so a stuck goal can't burn all 25
steps flailing.

### Layer 3 — the human

Reuses the pause machinery a CAPTCHA already triggers:

1. `browser.holdForHuman(reason)` → `bridge.pause(reason)` → `{type:'pause'}` down
   the socket.
2. The in-page banner turns amber: *"Paused — step 4 needs you: …"* with a Resume
   button.
3. `bridge.waitWhileHeld()` parks the run. Cancelling rejects that waiter, so a
   parked run is never stuck.
4. You do that one step by hand and press Resume.
5. The run continues at **step 5** — it does not repeat what you just did.
6. When the loop finishes, the run reports **`status: 'done'`**, exactly as if the
   machine had performed every step.

That last point is the one to know. A run in which the app never executed step 4
is reported as a success, and nothing in `RunResult` records that a step was
handed to a person — the only trace is the transient `healing` progress line,
which shares its `status` value with ordinary repair chatter. It is honest about
the *outcome* (the goal was met) and misleading about *autonomy*. PRD 01 in
[docs/prd/](docs/prd/) owns adding a distinct terminal state; until it lands, do
not read `done` as "ran unattended".

Two consequences worth holding onto:

- **Cancel, not Resume, is the only way a held run reports failure.** Cancelling
  rejects the parked waiter with `RunCancelledError`, which escapes the step loop.
- **A held `extract` silently poisons everything downstream.**
  `extractWithRepair` throws before assigning `vars[step.into]`, so every later
  `{{into}}` resolves to `''` — in a run that still reports `done`.

### Which layers each flow actually uses

The four layers are not all reached by both flows.

| | Routine run | Chat run |
|---|---|---|
| **L0** resolution | yes | yes |
| **L1** verification | yes — drives repair | yes — annotates the history the model reads next turn |
| **L2** repair | yes, `repair_step` | **no** — the loop re-decides anyway, which is cheaper and better informed |
| **L3** human hold | yes | **no** — it stops after 3 consecutive failures instead |

A chat run has a human sitting in front of it who can simply retype the goal, and
a fresh decision each turn. A routine run is the one that may be unattended and
replaying assumptions recorded weeks ago, so it is the one that gets the repair
call and the hold.

---

## 7. Three worked examples

### A renamed button

```
click 'button:has-text("Send")'
  L0: no <button> has that accessible name → "nothing on this page matches it"
  L1: (never reached)
  L2: snapshot → repairStep
      → repair: [{click, 'button[aria-label="Send message"]'}]
      reason: "the send control is now an icon button"
  re-run → changed: true → continue
  recorded in RunResult.repairs; folded back into the user routine
```

### A cookie banner over the target

```
click '#checkout'
  L0: #checkout matched, but rank 3 → "is covered by <div#consent>"
  L2: → repair: [{click, 'button:has-text("Accept")'}, {click, '#checkout'}]
  both run → continue
  recorded, but NOT written back to the routine — the banner won't be
  there next time, and baking it in would be wrong
```

### A dead click on a checkout button

```
click '#place-order'
  L0: found it, rank 4
  L1: dispatched, nothing mutated, fingerprint unchanged → changed: false
      and committing: true
  L2: SKIPPED ENTIRELY
  L3: hold — "Step 4 needs you: the action ran but the page did not react
      to it at all. Do it in the browser, then press Resume."
```

That third one is the whole safety argument. A false no-op verdict plus an
automatic retry equals a second order. So a committing step that appears to have
done nothing never gets a second attempt from the machine — it gets a human.

---

## 8. What is never healed

| Situation | Why not |
|---|---|
| `StepIndeterminateError` (the extension stopped answering) | The step **may have run**. Retrying it is exactly the double-submit hazard. |
| `held: true` | The step **never ran**. It belongs to the hold/resume loop, not the healer. |
| `RunPausedError` (the user paused) | The step never ran, or the pause is what cut it short. The loop looks at the page again instead; a repair would be guessing at a page the user is still changing. |
| `refusing to write into a password field` | The credential guard is a refusal, not an obstacle. Improvising around it *is* the bypass. |
| A `committing` step that reported `changed: false` | Cannot distinguish "didn't work" from "worked silently". Goes straight to a human. |

The gate is `isHealable()` in [session.ts](src/main/automation/session.ts): only a
`StepExecutionError` whose message isn't a credential refusal qualifies.

"Never healed" does not mean "fails the run", and the table above mixes three
different outcomes. `NeedsHumanError` parks for a person and the run then
*continues past the step*. `RunPausedError` is swallowed by `throughPauses` and
the step is re-run in a routine run, or `continue`d in a chat run without
charging a failure. Only the remaining classes — an indeterminate step, a
credential refusal, an exhausted hold loop — actually terminate the run.

---

## 9. Control messages

`pause`, `resume`, `stop` and `abandon` **bypass the serialisation lock** in
`background.js` and are dispatched straight from the port listener.

That matters: a step can hold the lock for its entire timeout, and the Pause
button is the control a user reaches for *because* a step is running. Queued
behind that step it would look dead exactly when it matters most. None of these
touch the target tab, so there's no ordering hazard with a step in flight.

| Message | Direction | Effect |
|---|---|---|
| `pause` / `resume` | app → extension | Flips extension state; the banner follows |
| `PAUSE_REQUESTED` / `RESUME_REQUESTED` | banner → background | Same, initiated in the page |
| `paused` / `resumed` | extension → app | Releases or parks `waitWhileHeld()` |
| `stop` | app → extension | Marks the in-flight step abandoned, clears the target tab |
| `abandon` | app → extension | Drops one specific request whose reply is no longer wanted |
| `target-closed` | extension → app | The tab went away; fail pending work and cancel |

---

## 10. Budgets, at a glance

| Constant | Value | Where |
|---|---|---|
| `MAX_CHAT_STEPS` | 25 | orchestrator |
| `MAX_CHAT_FAILURES` | 3 consecutive | orchestrator |
| `MAX_ATTEMPTS_PER_STEP` | 3 | orchestrator |
| `MAX_REPAIRS_PER_RUN` | 6 | orchestrator |
| `MAX_HELD_RETRIES` | 3 | extension-session |
| Settle window | 750 ms | content.js |
| Selector poll | every 100 ms | content.js |
| Action budget | 10.75 s + 5 s margin | extension-session |
| Navigation budget | 20 s + 5 s margin | extension-session |
| Extracted text cap | 10 000 chars | extension-session |
| Screenshot | ≤1024×768, JPEG q55 | TokenOptimizer |

**Cost summary:** a healthy routine run costs **nothing** in model calls. A chat
run costs one call per step. Healing costs at most 6 extra calls per routine run,
and **zero** extra in chat.

---

## 11. Where to look

| Question | File |
|---|---|
| What happens on a run, in order | [orchestrator.ts](src/main/automation/orchestrator.ts) |
| How a step reaches the browser | [extension-session.ts](src/main/automation/extension-session.ts) → [extension-bridge.ts](src/main/automation/extension-bridge.ts) |
| Prompts, tools, model settings | [claude-client.ts](src/main/automation/claude-client.ts) |
| Repair policy and budget | [step-healer.ts](src/main/automation/step-healer.ts) |
| Selector resolution, verification, actions | [content.js](extension/content.js) |
| Tab management, scanning, serialisation | [background.js](extension/background.js) |
| Socket ↔ stdio reframing | [relay.js](native-host/relay.js) |
| Which failures are healable | `isHealable` in [session.ts](src/main/automation/session.ts) |
| Writing repairs back into a routine | `applyRepairs` in [routines.ts](src/shared/routines.ts) |

# Goal loop: conversation thread, and asking the human

**Status:** design approved; §5 decisions settled 2026-08-22. Implementation plan not yet written.
**Date:** 2026-08-22
**Touches:** `runChatGoal` and `claude-client.ts` primarily; IPC, preload, renderer, and one migration.

---

## 1. Why

A live run of the goal _"book a flight for me from pakistan to cananda"_
(`71c8aa4f-991f-4843-afd1-fbbc48b77616`) took 9m24s over 76 steps and ended only
because the user closed the tab. Four actions accounted for 45 of the 54 steps
the run recorded as successes: `Search` ×11, `Done` ×13, the destination field
×11, and a machine-generated `li#cNNN` ×10.

The same goal, given to the Claude desktop app, completed — quickly, performing
each step once, and pausing partway to ask which airline to take.

Three defects in that run are already fixed on this branch: no loop detection
(`MAX_STATIC_LOOKS`), a covered target being refused rather than scrolled to
(`waitForActionable`), and the resulting nine-minute burn. Those bound the
damage. They do not make the run succeed. Two causes remain, and this design
addresses both.

**Cause A — the loop cannot remember what it did.** Each step is one stateless
`messages.create` with a single `user` turn, rebuilt from scratch. The only
memory is `historyDescriptions`, and `describeAttempt` pushes the bare step
description on success, so the model reads a list of _intentions_ in which "I
clicked Done and it worked" and "I clicked Done" are the same string. It repeats
because it cannot tell that it already did the thing.

**Cause B — the loop cannot ask.** `DECIDE_NEXT_ACTION_TOOL`'s enum is
`['click','type','navigate','done']`. `holdForHuman` is called in exactly one
place, `orchestrator.ts:197`, inside `runRoutine`. A goal run has no path to a
human except the passive password-field scan. Facing ambiguity it must guess.

## 2. What we are building

1. `runChatGoal` keeps a real `Anthropic.MessageParam[]` thread: the assistant's
   turn replayed **verbatim**, and a `user` turn carrying a `tool_result` with
   what happened plus the new page.
2. A pure `pruneThread` that keeps recent page payloads and summarises older
   ones, so cost stays flat.
3. An `ask` action that parks the run, surfaces a question, and returns the
   human's answer as that step's `tool_result`.
4. Adaptive thinking, which is presently switched off.
5. The model id behind an env var.

## 3. Decisions already taken

| Question | Decision |
| --- | --- |
| Loop memory | Real conversation thread, not a patched summary |
| Human-in-the-loop | Reuse the hold semantics: `held` status, `assisted` outcome |
| Context growth | Client-side pruning, not server-side context editing |
| Model | Configurable rather than hardcoded |

The context-editing option is not merely unchosen, it is unavailable — see §4.3.

## 4. Findings that change the design

Everything in this section was verified against the tree or measured against the
gateway. Confidence is marked where it is not certain.

### 4.1 Forcing the tool silently disables thinking

Measured against `https://ai-gateway.vercel.sh`, model `anthropic/claude-sonnet-5`,
identical request bodies:

| `tool_choice` | thinking block | thinking tokens |
| --- | --- | --- |
| `{type:'tool', name}` | none | 0 |
| `{type:'any'}` | none | 0 |
| `{type:'auto'}` | present | 224 |

No error, no warning, at every effort level including `max`. So "turn thinking
on" is a **no-op** while `tool_choice` stays pinned, and every line of
thinking-replay code written for it would be dead with nothing to show for it.

This collides with a written instruction. AI_CONTEXT §10 says *"`tool_choice` is
pinned to a single tool so replies are structured data; keep it that way."* That
rule must be rewritten, with the reason, per §13 rule 5.

The replacement is `{type:'auto', disable_parallel_tool_use: true}` plus a system
prompt stating the harness only reads tool calls. Measured: a `tool_use` on 5/5
single turns and 6/6 turns of a loop, never text-only, never more than one block.
**But it is not a guarantee** — a separate probe at effort `low` returned a
text-only continuation turn. The loop must treat "no tool_use block" as a handled
outcome, not an assertion failure.

`disable_parallel_tool_use` is load-bearing independently: parallel tool use is on
by default, and `callTool` takes `response.content.find(b => b.type === 'tool_use')`
— the first only. Two blocks in one turn means one gets answered and the other is
orphaned, which 400s the next request.

### 4.2 `callTool` throws away what the thread needs

```ts
const call = response.content.find((block) => block.type === 'tool_use')
return call.input as T
```

`response.content` is discarded. With thinking on, the assistant turn must be
replayed as `{role: 'assistant', content: response.content}` — thinking block and
tool_use block, unmodified, in order. Any thread built by reconstructing
`[{type:'tool_use', ...}]` from the parsed decision has already lost them.

Three measured details:

- Only the `signature` is hard-verified. A tampered signature is a 400. An empty
  signature, mutated summary text, a reordered content array, and dropping the
  thinking block **entirely** were all accepted with HTTP 200. So a broken replay
  degrades reasoning silently rather than failing a test — and in two of three
  degraded cases the model answered with text instead of the tool.
- Filtering on `block.type === 'thinking'` drops `redacted_thinking` and is the
  documented top cause of the 400. Echo `response.content` as-is: never filter,
  never map, never re-serialise.
- `display` defaults to `'omitted'` on Sonnet 5, so blocks arrive with empty
  `thinking` text and only a signature. The installed SDK's JSDoc says it defaults
  to `'summarized'` — that JSDoc is wrong for this model. Rendering thinking in the
  UI requires setting `display: 'summarized'` explicitly.

Sonnet 5 also keeps **all** prior turns' thinking blocks in context, billed as
input every step. We must not hand-prune them; the sanctioned override
(`clear_thinking_20251015`) is unavailable to us — see §4.3.

### 4.3 The gateway appears to ignore `anthropic-beta` headers

A nonsense `anthropic-beta: definitely-not-a-real-beta-2020-01-01` returned HTTP
200 with no error, and `context_management` with `clear_tool_uses_20250919`
returned an identical `{"applied_edits": []}` with and without its beta header.
Vercel's documented parameter list does not mention header forwarding.

**Confidence: likely, negative-leaning.** Not proven, but nothing in this design
may depend on a beta header reaching Anthropic. Server-side context editing and
compaction are therefore both off the table, which makes client-side pruning the
only available strategy rather than merely the preferred one.

Prompt caching *does* work end to end through the gateway, including the 1-hour
TTL: two identical requests produced `cache_creation_input_tokens: 3176` then
`cache_read_input_tokens: 3176`.

### 4.4 Pruning images and prompt caching are mutually exclusive

From the cache-invalidation table: adding or removing an image anywhere in the
prompt invalidates the **messages** cache. Every prune rewrites history behind the
breakpoint and forces a full re-write.

We chose pruning. The spec records the cost honestly: **message-level caching is
forfeit on any step where a prune happens.** Tool and system breakpoints still pay
off and should still be set.

Arithmetic for sizing: an image costs `⌈w/28⌉ × ⌈h/28⌉` visual tokens, so a
1024×768 screenshot is 37 × 28 = **1,036 tokens**. Twenty retained screenshots is
~20,700 input tokens re-sent every step.

There is also a cliff at **20 images per request**, not the 600 the limits table
suggests: above 20 image blocks a stricter per-image dimension rule applies to
every image in the request, and images inside `tool_result` content count. Our
screenshots are capped at 1024×768, under the 2000px escape hatch, so today this
costs tokens rather than rejections — but raising the screenshot cap above 2000px
would start rejecting whole requests at step 21.

Images nested inside `tool_result` content are accepted by the gateway, so the
natural shape — one `tool_result` whose content is `[text DOM, image screenshot]`
— is legal.

### 4.5 An orphaned `tool_use` is a hard, unrecoverable 400

Every assistant turn appended must get a matching `tool_result`. `runChatGoal`
has **six** paths that reach `continue` or `throw` after a decision without
executing a step:

1. the `alreadyDead` refusal — the normal reaction to a stale selector, so this is
   the likeliest to fire in a real run
2. the `RunPausedError` catch
3. a healable step failure
4. a `toActionStep` throw on a malformed decision
5. `MAX_STATIC_LOOKS`
6. `MAX_CHAT_FAILURES`

Plus, new here: an `ask` aborted while parked. Each currently pushes a string into
`historyDescriptions`. In a thread each must append a `tool_result` keyed to that
turn's `tool_use` id. Miss one and the next request fails with *"tool_use ids were
found without tool_result blocks"* — and because the thread is the loop's only
memory, every retry resends the same invalid thread. The run is dead, not degraded.

`pruneThread` inherits this hazard: nothing must let it strip an assistant turn's
thinking blocks, and a pruned `tool_result` must never end up with empty `content`.
Both faults appear only at step `keepPages + 1`, never in a short smoke test.

### 4.6 The pending answer must live where `abortRun` can reach it

`ExtensionBridge.abortRun` is the only unwind in the process. It has four callers
and drains exactly two collections it owns, `this.pending` and `this.waiters`:

| Path | Trigger | Error raised |
| --- | --- | --- |
| `cancel()` | user Stop | `RunCancelledError` |
| socket `close` | extension died | `ExtensionNotConnectedError` |
| `target-closed` | tab closed | `the automated tab was closed` |
| `close()` | `before-quit` | `the app closed while this run was in flight` |
| `start()` | new run takes the connection | `a new run took over this connection` |

A promise held in a `runChatGoal` closure is reachable by **none** of them. The
run awaits forever, so the `finally` never runs: `busy` stays true and every later
run fails with `OrchestratorBusyError` until the app is quit. Wiring only the
`automation:cancel` handler covers one path of five.

It must also reject with `RunCancelledError` **specifically** on user Stop —
both loops branch on `error instanceof RunCancelledError` to file `cancelled`
rather than `error`, and AI_CONTEXT §8 says only the user's Cancel may raise it.

`waitWhileHeld` cannot be reused: it resolves with `void`, and `release()` is
reachable from the in-page Chrome banner, which would resolve a question with no
answer.

### 4.7 Cancel cannot interrupt a model call

`messages.create` is issued with no `signal`; the SDK pins a 10-minute
non-streaming timeout and retries twice. Today the in-flight operation at Cancel
time is usually a bridge request, which `abortRun` rejects cleanly. This redesign
moves the long pole to the model call — a multi-turn thread with thinking, tens of
seconds per step. A Cancel landing there rejects nothing. An `AbortSignal` is
required, not optional.

Related client-side ceiling: the SDK throws
`Streaming is required for operations that may take longer than 10 minutes` for any
non-streaming request with `max_tokens` above 21,333.

### 4.8 `max_tokens: 1024` becomes a live truncation risk

Thinking tokens are drawn from the same ceiling. Measured on a synthesized 35KB
prompt (~14,680 input tokens): output was 328–421 tokens across effort
medium/high, always `stop_reason: 'tool_use'`. Headroom ~2.5×, which a harder page
or a long `ask` question can eat.

Overrun returns `stop_reason: 'max_tokens'` with the `tool_use` block truncated
away. That surfaces through the existing code as *"Claude did not return a
decide_next_action tool call"* — a plain `Error`, which `isHealable` rejects, so
the run files as `error` pointing the debugger at entirely the wrong thing.

Raise to 4096 and inspect `stop_reason` explicitly.

### 4.9 `human_steps` is computed twice, by different mechanisms

- `runs.human_steps` is recomputed at close as
  `COUNT(*) FROM run_events WHERE status = 'held'` — no `DISTINCT`, no
  `step_index` filter.
- `assisted` vs `done` is chosen in `runChatGoal` from a local `humanSteps`
  variable that only the `setHoldReporter` closure increments.

An ask must increment **both**, and must emit status **exactly** `'held'`. Emit any
other string and the run reads "Done with help" with `human_steps` 0; increment
only the local counter and you get the mirror-image lie. No test asserts the two
agree.

Two consequences follow from the same subquery: two questions at one step count
twice, breaking AI_CONTEXT §8's "counts once per step" rule for this path (that
rule is enforced at the emit site in `ExtensionSession.dispatch`, not in SQL). And
`runs.status` only comes **off** `'held'` on an event with status exactly
`'running'` — a `healing` event does not clear it, so resuming after an answer with
the wrong status leaves the run showing "Needs you" until it terminates.

### 4.10 An ask collides with the circling guard

`MAX_STATIC_LOOKS` compares `snapshot.screenshotBase64` to `lastFrame`, and
`lastFrame` is assigned only inside the running-step artifact branch. An ask
iteration snapshots the page, touches nothing, and `continue`s before that branch
— so `frame === lastFrame` and `staticLooks++`.

Eight questions, or three asks after five non-repainting steps, throws *"the page
has looked the same for 8 steps running"* in the middle of a conversation with a
human, discarding their answers. Ask turns must be exempt from the counter.

### 4.11 Persistence

Verified against the migrations:

- `run_events.status` has **no** CHECK constraint. A new event status needs no
  migration.
- `runs.status` **is** a closed CHECK set of seven values, and `'held'` is one.
- `run_artifacts.kind` is a closed CHECK of two values, so storing a question as
  an artifact is the one choice here that trips AI_CONTEXT §9's table-rebuild trap
  — and it fails at runtime on the first ask, because `CapturedArtifact.kind` is a
  TypeScript union a cast can slip past.
- `ALTER TABLE runs ADD COLUMN` **is** legal on these STRICT tables, so persisting
  the thread needs no rebuild.
- `MIGRATIONS` has two entries (`user_version` 2). A new one is index 2 →
  `user_version` 3. **Not 4** — PRDs 01, 02, 03, 05, 07, 08, 10 and 13 each assume
  they are next.
- `threadRows` drops every event with `stepIndex < 0`, and `activeStep` starts at
  `-1`. A question asked before the first step executes counts toward `human_steps`
  and is invisible in the thread. Emit asks at a real index.
- `stepOutcomes` writes `'attention'` unconditionally and `'ran'` only over
  `'pending'`, so an ask at step *i* pins that step to "attention" permanently even
  if it later succeeds.
- Reading ask rows in `list()`/`summarise()` would add a second per-row query to a
  path already guarded by a mean-under-5ms assertion in `tests/db.verify.ts`. Read
  them in `get()` only.
- Every new store write must sit inside `runObserver`'s `guard()`. Recording must
  never fail the run.

### 4.12 IPC

- `handle()` in `main/ipc.ts` applies the sender allowlist. Using the wrapper is
  the whole requirement; there is no per-channel registration.
- `broadcast` bypasses the allowlist entirely, so `automation:ask` as a push needs
  no allowlist work.
- `RunObserver` **cannot** carry the ask: every call is wrapped by
  `swallowingFailures`, which discards return values. An ask returns
  `Promise<string>`.
- The preload convention is `on<Noun>(listener): () => void`. AI_CONTEXT §10's
  claim that push channels are named `on…Changed` is wrong as written — only 2 of
  5 use that suffix. The sibling to copy is `onHold`, so the method is `onAsk`.

### 4.13 `AgentAction` is shared, and `ask` must not leak into the repair path

One type serves `decide_next_action`, `RepairPlan.actions`, and `StepHealer`'s
repair. Adding `'ask'` to it makes an ask type-legal at
`plan.actions.map(toActionStep)` in `runRoutine`'s repair path — which sits
*outside* the inner try/catch. `toActionStep`'s default throws a plain `Error`, not
a `NeedsHumanError`, so `runRoutine`'s catch rethrows and the whole routine run
dies in the healing path. `toActionStep`'s switch has no `default` guard against
this, and neither does `browser-session.ts`'s `runStep`.

The types must be split, not widened.

### 4.14 `chatSessions` is dead state

The `Map` at `orchestrator.ts:60` is written by `runChatGoal` and read by nothing
but `clearChatSession`, which the renderer never calls. It leaks one entry per run
for the process lifetime. `automation:chat:save` reads `recordedSteps` from SQLite,
not from this map. Do not hang conversation state off it.

---

## 5. Decisions

Settled 2026-08-22. §5.1 and §5.2 by the project owner; §5.3–§5.6 delegated.

### 5.1 `ask` may not carry secrets — the browser stays the secret channel

**Decided: `ask` is never a credential channel.** If the model needs a password,
a card number, or a one-time code, it does not ask — it attempts the step, the
existing guard fires, and the human types the value into Chrome directly.

That path already exists and is the one AI_CONTEXT §8 documents: `scanSensitive`
raises a page-wide hold, `ExtensionSession.dispatch` waits on `waitWhileHeld` and
retries the same step, and `assertWritableTarget` refuses at the element itself
with a deliberately non-healable error. Nothing about it changes here.

Three consequences for this design:

- The `ask` tool description states the prohibition outright — never ask for
  passwords, codes, card numbers, or anything a login needs; attempt the step and
  a human will fill it in. This is a prompt-level rule *and* a code-level one.
- An answer is never used as `type.text` into a target `assertWritableTarget`
  would refuse. The guard keeps absolute precedence and gains no bypass; AI_CONTEXT
  §8 already forbids giving the target check one.
- No redaction machinery is built, because no secret should reach the thread. That
  is a deliberate v1 boundary, not an oversight: if it turns out secrets leak in
  anyway, the answer is to fix the leak, not to add redaction downstream.

### 5.2 The question appears in the Electron app's run thread

**Decided: app window only.** No in-page banner state, no extension protocol
change, no `EXTENSION_VERSION` bump for this feature.

The visibility gap is real and accepted: a user watching Chrome will not see the
question until they look at the app. That is PRD 08's problem to solve, and this
design must not pre-empt it. What this design *does* owe is that the run is
obviously parked rather than silently stalled — which is what §5.5 is for.

### 5.3 This design lands before PRD 02, and PRD 02 is rewritten

**Decided: this ships first.**

PRD 02 is a cost meter. It observes; this design changes the thing being observed.
Three of its stated premises stop being true — `tool_choice` stays pinned, the
prompts and tool schemas do not change, and a chat run costs one model call per
iteration at flat cost. Building the meter against the old shape means writing it
twice and measuring the wrong thing in between.

Landing order also favours it: after this change, per-step cost grows with thread
length and varies with cache hits, which is precisely the behaviour a cost meter
exists to make visible. Metering the old flat-cost loop would have been the less
useful of the two.

PRD 02 carries a note pointing here. Its amendments are: drop the pinned
`tool_choice` claim; replace "one model call per loop iteration" with per-step
cost as a function of thread length; keep `cached_input_tokens` but recognise that
message-level caching is forfeit on pruning steps (§4.4), so the column will
legitimately read zero on many chat steps; and renumber its migration, which is
index 2 → `user_version` 3 only if it lands before this one.

### 5.4 Questions are keyed with an `askId`

**Decided: include it, now.** `automation:ask` carries an `askId`;
`automation:answer` carries `{askId, answer}`; an answer whose `askId` is not the
outstanding one is **rejected with an error, never silently applied**.

This is correct regardless of PRD 05. Today it prevents two open windows both
showing question 1 from resolving question 2 with the stale answer — a corruption
that leaves no trace anywhere. Tomorrow it is the thing that lets a run queue exist
without reopening the question, since PRD 05 explicitly demotes `busy` from
invariant to assertion, and a single-slot unkeyed registry is only correct while
`busy` is the serialisation point.

The cost is one string. There is no version of this worth deferring.

### 5.5 A pending question is recoverable — `automation:status` carries it

**Decided: required, and it ships with the feature, not after.**

`automation:status` returns `{connected, paused}` today. It gains the outstanding
question — `askId`, `stepIndex`, `runId`, the text, and any options. A renderer
that mounts fresh queries it exactly as it already queries `paused`, which is what
that channel exists for.

Without this, a Cmd-R in dev or a window closed and reopened leaves the run parked
with no UI able to answer it and no Stop button to cancel it, because `App.busy` is
gated on a `liveRunId` the new renderer never received. `busy` then stays true for
the life of the process and every later run fails with `OrchestratorBusyError`.
That is not a degraded feature, it is a wedged application, and shipping the ask
without it would be shipping a bug.

### 5.6 A run that asked a question cannot be saved as an automation

**Decided: refuse the save, with a reason.**

`automation:chat:save` writes `run.recordedSteps` verbatim into a
`RoutineDefinition`. An `ask` produces no `ActionStep`, so it leaves no trace in
that array — but the steps *after* it carry the human's decision baked in as
literal values, with nothing recording that a human chose them. Replay that routine
and it silently repeats a choice that was made once, for one run, in a context that
no longer holds.

The tempting fix — turn the answer into a `{{param}}` — requires knowing which
later steps consumed it. The model may use an answer implicitly, across several
steps, or not at all. We cannot know, so we would be guessing, and a guessed
routine is a wrong artifact that looks right.

So the guard goes next to the existing one in the `automationChatSave` handler,
in the same style and the same lowercase-message shape as
`nothing was recorded for this run yet`. Refusing to emit an artifact we cannot
vouch for is the honest behaviour.

Doing this properly means an interactive step kind that replays the question at run
time — six places per AI_CONTEXT §10's recipe, and a change to what a routine *is*.
That deserves its own design, not a line in this one.

## 6. Shape of the implementation

Ordered so each step is independently verifiable. No step begins before §5 is
answered.

1. **`tool_choice` and thinking** — switch to
   `{type:'auto', disable_parallel_tool_use:true}`, adaptive thinking,
   `max_tokens: 4096`, inspect `stop_reason`, handle a text-only turn. Rewrite
   AI_CONTEXT §10's pinned-tool_choice rule with the measured reason. Note this
   also changes `StepHealer.plan`, since `callTool` is shared — scope explicitly.
2. **Return the whole turn** — `callTool` returns `{parsed, content}` so the caller
   can replay `response.content` verbatim.
3. **The thread** — `runChatGoal` owns `MessageParam[]`. Every one of the six
   no-step paths in §4.5 appends a synthetic `tool_result`. A test per path.
4. **`pruneThread`** — pure function, vitest. Tests: never touches assistant turns;
   never empties a `tool_result`; every `tool_use` keeps its pair; token flatness
   across N steps.
5. **`AbortSignal`** on the model call, wired to the same unwind that raises
   `RunCancelledError`.
6. **The ask** — split the action types; park in a slot `abortRun` sweeps;
   `{askId, answer}`; exempt from `MAX_STATIC_LOOKS`; increment both `human_steps`
   mechanisms; emit at a real step index; resume with a `running` event.
7. **IPC and renderer** — `automation:ask` push, `automation:answer` invoke,
   `onAsk` in preload, pending question added to `automation:status`, question row
   in the run thread.
8. **`AI_MODEL`** — with a default, with validation that the `anthropic/` prefix is
   present, and read somewhere a packaged build can actually see it. `.env` is
   loaded only when `!app.isPackaged`, and a Finder-launched macOS app inherits no
   shell environment, so an env var alone is not a working answer for a packaged
   build.

## 7. Testing

| Target | Where | Why there |
| --- | --- | --- |
| `pruneThread` | vitest | Pure; no Electron, no browser, no network |
| Six no-step paths each append a `tool_result` | vitest, fake harness | The 400 they prevent is unrecoverable |
| Ask round trip | vitest, fake harness | |
| Cancel while parked → `RunCancelledError`, `busy` released | vitest | AI_CONTEXT §8 |
| Each of the five unwind paths releases a parked ask | vitest | Four are unreachable from the cancel handler |
| Ask does not increment `staticLooks` | vitest | |
| `human_steps` and `assisted` agree | `npm run test:db` | Two mechanisms, no existing test |
| Thinking blocks survive a round trip unmodified | vitest | Silent degradation otherwise |

`tests/orchestrator.test.ts`'s `fakeClaude` returns a bare decision and will need
to return a full content array.

## 8. Documentation owed

Per AI_CONTEXT §13: §7 (a new budget), §8 (the pinned-`tool_choice` rule is
rewritten; new invariants for thread pairing and ask parking), §9 (the
beta-header trap, the 20-image cliff), §10 (the "Changing model behaviour" recipe),
§12 (drift resolved or introduced). `ARCHITECTURE.md` §12's credentials row if §5.1
lands.

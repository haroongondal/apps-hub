# Goal Loop Conversation Thread Implementation Plan (Plan A of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `runChatGoal` keep a real conversation thread so it can tell a step that worked from one it merely chose, and stop repeating itself.

**Architecture:** `runChatGoal` owns an `Anthropic.MessageParam[]`. Each iteration appends the assistant's turn **verbatim** (thinking blocks included) and a user turn carrying a `tool_result`. A pure `pruneThread` keeps recent page payloads and drops older ones. `tool_choice` moves to `auto` because forcing it silently disables thinking on Sonnet 5.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Electron main process, `@anthropic-ai/sdk` 0.116.0 via the Vercel AI Gateway, vitest.

**Spec:** [docs/superpowers/specs/2026-08-22-goal-loop-conversation-thread-design.md](../specs/2026-08-22-goal-loop-conversation-thread-design.md)

## Global Constraints

- Model calls go to `https://ai-gateway.vercel.sh`, not to Anthropic directly. Model ids **require** the `anthropic/` provider prefix.
- **No `anthropic-beta` header may be relied on.** The gateway appears to ignore them (spec §4.3). No context editing, no compaction.
- `tool_choice: {type:'tool'}` and `{type:'any'}` silently return zero thinking tokens on Sonnet 5. Only `auto` produces thinking (spec §4.1).
- Assistant turns are replayed as `response.content` **unmodified** — never filter, never map, never re-serialise. Filtering on `block.type === 'thinking'` drops `redacted_thinking` and is the documented top cause of a 400 (spec §4.2).
- **Invariant:** any code path that reaches another `messages.create` must first have appended a `tool_result` for the outstanding `tool_use`. An orphan is a hard 400 that no retry clears, because the thread is the only memory.
- Comment budget per CLAUDE.md: **3 per file, 2 lines each.** At budget, adding one means deleting a weaker one.
- `callTool` is shared with `StepHealer.plan`. **Do not modify it.** The repair path is out of scope for this plan.
- Every change that touches a budget, an invariant, a trap, or a recipe requires an `AI_CONTEXT.md` edit in the *same commit* (AI_CONTEXT §13).

## File Structure

| File | Responsibility |
| --- | --- |
| `src/main/automation/thread.ts` | **New.** Pure thread construction and pruning. No Electron, no SDK client, no I/O. |
| `tests/thread.test.ts` | **New.** vitest over `thread.ts`. |
| `src/main/automation/claude-client.ts` | Modify. Adds `nextAction`; `callTool` untouched. |
| `src/main/automation/orchestrator.ts` | Modify. `runChatGoal` owns the thread. |
| `tests/orchestrator.test.ts` | Modify. `fakeClaude` returns a full turn. |
| `AI_CONTEXT.md` | Modify. §7, §8, §9, §10. |

---

### Task 1: `pruneThread` — pure thread pruning

Pure function, no dependencies on any other task. Done first because it carries the invariants most likely to be broken silently.

**Files:**
- Create: `src/main/automation/thread.ts`
- Test: `tests/thread.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pruneThread(messages: Anthropic.MessageParam[], keepPages: number): Anthropic.MessageParam[]`
  - `PRUNED_NOTE: string`

**The shape this relies on.** Every user turn in the thread is one of two shapes, and the **first text block is the durable summary; everything after it is the page payload and is prunable**:

```
opening turn:  [ {type:'text', text: goal+page}, {type:'image', ...} ]
step turn:     [ {type:'tool_result', tool_use_id, content: [
                    {type:'text', text: outcome},     <- kept
                    {type:'text', text: filteredDom}, <- pruned
                    {type:'image', ...}               <- pruned
                 ]} ]
```

- [ ] **Step 1: Write the failing tests**

Create `tests/thread.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { PRUNED_NOTE, pruneThread } from '../src/main/automation/thread'

function assistantTurn(id: string): Anthropic.MessageParam {
  return {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '', signature: `sig-${id}` },
      { type: 'tool_use', id, name: 'decide_next_action', input: { action: 'click' } }
    ] as unknown as Anthropic.ContentBlockParam[]
  }
}

function stepTurn(id: string, outcome: string): Anthropic.MessageParam {
  return {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: id,
        content: [
          { type: 'text', text: outcome },
          { type: 'text', text: '<html>a very large page</html>' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }
        ]
      }
    ] as unknown as Anthropic.ContentBlockParam[]
  }
}

function thread(steps: number): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: [{ type: 'text', text: 'Goal: book a flight' }] }
  ]
  for (let i = 0; i < steps; i++) {
    messages.push(assistantTurn(`t${i}`), stepTurn(`t${i}`, `step ${i} ran`))
  }
  return messages
}

function blocksOf(message: Anthropic.MessageParam): Anthropic.ContentBlockParam[] {
  if (typeof message.content === 'string') throw new Error('expected blocks')
  return message.content
}

describe('pruneThread', () => {
  it('leaves a thread shorter than the budget completely alone', () => {
    const before = thread(2)
    expect(pruneThread(before, 3)).toEqual(before)
  })

  it('keeps the page on the most recent turns and drops it from older ones', () => {
    const pruned = pruneThread(thread(5), 2)
    const userTurns = pruned.filter((m) => m.role === 'user')

    const oldest = blocksOf(userTurns[1] as Anthropic.MessageParam)[0] as { content: unknown[] }
    expect(oldest.content).toEqual([{ type: 'text', text: 'step 0 ran' }])

    const newest = blocksOf(userTurns[userTurns.length - 1] as Anthropic.MessageParam)[0] as {
      content: unknown[]
    }
    expect(newest.content).toHaveLength(3)
  })

  it('never touches an assistant turn, because thinking blocks must replay verbatim', () => {
    const before = thread(5)
    const pruned = pruneThread(before, 1)
    const assistantsBefore = before.filter((m) => m.role === 'assistant')
    const assistantsAfter = pruned.filter((m) => m.role === 'assistant')
    expect(assistantsAfter).toEqual(assistantsBefore)
  })

  it('keeps every tool_use paired with its tool_result', () => {
    const pruned = pruneThread(thread(5), 2)
    const useIds: string[] = []
    const resultIds: string[] = []
    for (const message of pruned) {
      for (const block of blocksOf(message)) {
        if (block.type === 'tool_use') useIds.push(block.id)
        if (block.type === 'tool_result') resultIds.push(block.tool_use_id)
      }
    }
    expect(useIds).toEqual(['t0', 't1', 't2', 't3', 't4'])
    expect(resultIds).toEqual(useIds)
  })

  it('never leaves a tool_result with empty content, which the API rejects', () => {
    const orphan: Anthropic.MessageParam[] = [
      { role: 'user', content: [{ type: 'text', text: 'Goal' }] },
      assistantTurn('t0'),
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't0',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }
            ]
          }
        ] as unknown as Anthropic.ContentBlockParam[]
      },
      assistantTurn('t1'),
      stepTurn('t1', 'step 1 ran')
    ]
    const pruned = pruneThread(orphan, 1)
    const result = blocksOf(pruned[2] as Anthropic.MessageParam)[0] as { content: unknown[] }
    expect(result.content).toEqual([{ type: 'text', text: PRUNED_NOTE }])
  })

  it('is idempotent, so pruning an already-pruned thread changes nothing', () => {
    const once = pruneThread(thread(6), 2)
    expect(pruneThread(once, 2)).toEqual(once)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/thread.test.ts`
Expected: FAIL — `Failed to resolve import "../src/main/automation/thread"`.

- [ ] **Step 3: Write the implementation**

Create `src/main/automation/thread.ts`:

```typescript
import type Anthropic from '@anthropic-ai/sdk'

export const PRUNED_NOTE = 'the page for this step is no longer in context'

// The first text block of a user turn is its durable summary; everything after
// it is the page, which is why dropping the tail is safe.
export function pruneThread(
  messages: Anthropic.MessageParam[],
  keepPages: number
): Anthropic.MessageParam[] {
  const pageTurns: number[] = []
  messages.forEach((message, index) => {
    if (message.role === 'user') pageTurns.push(index)
  })

  const keep = new Set(pageTurns.slice(-Math.max(keepPages, 1)))

  return messages.map((message, index) => {
    if (message.role !== 'user' || keep.has(index)) return message
    return { role: 'user', content: stripPage(message.content) }
  })
}

function stripPage(
  content: Anthropic.MessageParam['content']
): Anthropic.MessageParam['content'] {
  if (typeof content === 'string') return content

  const hasToolResult = content.some((block) => block.type === 'tool_result')
  if (!hasToolResult) return summarise(content)

  return content.map((block) => {
    if (block.type !== 'tool_result') return block
    return { ...block, content: summarise(block.content) }
  })
}

function summarise(
  blocks: string | Array<Anthropic.ContentBlockParam> | undefined
): Anthropic.ContentBlockParam[] {
  if (typeof blocks === 'string') return [{ type: 'text', text: blocks }]

  const firstText = blocks?.find((block) => block.type === 'text')
  if (firstText && firstText.type === 'text') return [firstText]
  return [{ type: 'text', text: PRUNED_NOTE }]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/thread.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify the whole suite and types are still clean**

Run: `npm run typecheck && npm test`
Expected: typecheck exit 0. The suite shows **6 pre-existing failures** from the uncommitted `MAX_CHAT_STEPS`/`MAX_CHAT_FAILURES`/`MAX_ATTEMPTS_PER_STEP` raise — those are not yours. Confirm the count is 6 and that none of them are in `tests/thread.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/main/automation/thread.ts tests/thread.test.ts
git commit -m "Add pruneThread: keep recent pages, summarise older ones

The first text block of a user turn is its durable summary; the page
payload after it is what costs tokens. Pruning drops the tail.

Tested for the two faults that only appear once pruning engages: an
assistant turn whose thinking blocks were touched, and a tool_result
left with empty content."
```

---

### Task 2: `nextAction` — a threaded model call that can actually think

**Files:**
- Modify: `src/main/automation/claude-client.ts`
- Test: `tests/orchestrator.test.ts` (type-level only here; behaviour is covered in Task 3)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `interface ThreadTurn { action: AgentAction | null; text: string | null; content: Anthropic.ContentBlock[]; toolUseId: string | null; stopReason: string | null }`
  - `ClaudeAutomationClient.nextAction(messages: Anthropic.MessageParam[], signal?: AbortSignal): Promise<ThreadTurn>`
  - `MAX_DECISION_TOKENS = 4096`

**Why a new method rather than changing `callTool`:** `callTool` is what `repairStep` uses, and `repairStep` feeds `StepHealer.plan` in the routine loop. Changing it would alter the four-layer healing path as a side effect that no chat test covers. Leave it alone.

- [ ] **Step 1: Add the return type and the constant**

In `src/main/automation/claude-client.ts`, below the existing `RepairPlan` interface:

```typescript
export interface ThreadTurn {
  action: AgentAction | null
  text: string | null
  content: Anthropic.ContentBlock[]
  toolUseId: string | null
  stopReason: string | null
}

const MAX_DECISION_TOKENS = 4096
const KEEP_PAGES = 2
```

Export `KEEP_PAGES` — Task 3 uses it.

- [ ] **Step 2: Add `nextAction` to `ClaudeAutomationClient`**

Add as a sibling of `decideNextAction`, which stays for now (Task 3 removes its last caller):

```typescript
  async nextAction(
    messages: Anthropic.MessageParam[],
    signal?: AbortSignal
  ): Promise<ThreadTurn> {
    const response = await this.getClient().messages.create(
      {
        model: MODEL,
        max_tokens: MAX_DECISION_TOKENS,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: SYSTEM_PROMPT,
        tools: [DECIDE_NEXT_ACTION_TOOL],
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        messages
      },
      signal ? { signal } : undefined
    )

    const call = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    )
    const said = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text'
    )

    return {
      action: call ? (call.input as AgentAction) : null,
      text: said?.text ?? null,
      content: response.content,
      toolUseId: call?.id ?? null,
      stopReason: response.stop_reason ?? null
    }
  }
```

Three things this deliberately does **not** do: it does not throw when there is no `tool_use` block (spec §4.1 — `auto` really can answer with text, and Task 3 handles it); it does not filter `response.content`; and it does not touch `callTool`.

- [ ] **Step 3: Tell the model the harness only reads tool calls**

`tool_choice: auto` means the model *may* answer in prose. Reduce that. Append to `SYSTEM_PROMPT`, after the existing final line:

```
Your reply is read by a program, not a person: only a decide_next_action tool call has any effect. A prose reply does nothing and wastes a step.
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

If `response.content` will not assign into a `MessageParam`'s `content`, add a single `as Anthropic.ContentBlockParam[]` cast **at the assignment site in Task 3** — never a `.map()` or `.filter()` over the blocks.

- [ ] **Step 5: Commit**

```bash
git add src/main/automation/claude-client.ts
git commit -m "Add nextAction: a threaded call that keeps its thinking

Measured against the gateway on anthropic/claude-sonnet-5, tool_choice
{type:'tool'} and {type:'any'} both return zero thinking tokens and no
thinking block, at every effort level including max. No error. Only
'auto' thinks, so forcing the tool and enabling thinking are mutually
exclusive and the silent loser is thinking.

auto can answer in prose, so nextAction returns action: null rather
than throwing, and the system prompt says only tool calls are read.

callTool is untouched: it is shared with StepHealer."
```

---

### Task 3: `runChatGoal` keeps the thread

The core task. Every path reaching another model call must first append a `tool_result`.

**Files:**
- Modify: `src/main/automation/orchestrator.ts`
- Modify: `tests/orchestrator.test.ts`

**Interfaces:**
- Consumes: `pruneThread`, `PRUNED_NOTE` (Task 1); `ThreadTurn`, `nextAction`, `KEEP_PAGES` (Task 2).
- Produces: no new exports.

**The four places that must append a `tool_result`** — three `continue` paths plus the success path. Paths that `throw` (`MAX_STATIC_LOOKS`, `MAX_CHAT_FAILURES`, a `toActionStep` throw) end the run and make no further request, so they need nothing; if anyone later converts one to a `continue`, this invariant applies to it.

1. the `alreadyDead` refusal — the normal reaction to a stale selector, so the likeliest to fire
2. the `RunPausedError` catch
3. a healable step failure
4. a step that ran

- [ ] **Step 1: Write the failing tests**

Add to `tests/orchestrator.test.ts`. First, `fakeClaude` must return a full turn — replace its `decideNextAction` mock with an added `nextAction`:

```typescript
    nextAction: vi.fn((messages: Anthropic.MessageParam[]) => {
      threadsPerCall.push(messages)
      const action = decisions.shift() ?? { action: 'done', step_description: 'all done' }
      callIndex += 1
      return Promise.resolve({
        action,
        text: null,
        content: [
          { type: 'thinking', thinking: '', signature: `sig-${callIndex}` },
          { type: 'tool_use', id: `call-${callIndex}`, name: 'decide_next_action', input: action }
        ],
        toolUseId: `call-${callIndex}`,
        stopReason: 'tool_use'
      })
    }),
```

Declare `const threadsPerCall: Anthropic.MessageParam[][] = []` and `let callIndex = 0` alongside `historyPerCall`, and expose `threadsPerCall` on the returned object.

Then the new tests:

```typescript
// A tool_use with no matching tool_result is a hard 400, and the thread is the
// loop's only memory, so no retry can clear it.
describe('runChatGoal thread integrity', () => {
  function pairs(messages: Anthropic.MessageParam[]): { uses: string[]; results: string[] } {
    const uses: string[] = []
    const results: string[] = []
    for (const message of messages) {
      if (typeof message.content === 'string') continue
      for (const block of message.content) {
        if (block.type === 'tool_use') uses.push(block.id)
        if (block.type === 'tool_result') results.push(block.tool_use_id)
      }
    }
    return { uses, results }
  }

  const click: AgentAction = { action: 'click', selector: '#go', step_description: 'press go' }
  const dead: AgentAction = { action: 'click', selector: '#gone', step_description: 'press gone' }

  it('pairs every tool_use with a tool_result when steps succeed', async () => {
    const claude = fakeClaude({ decisions: [click, click, click] })
    await new AutomationOrchestrator(fakeSession(), claude).runChatGoal('s1', 'do a thing', SILENT)

    const last = claude.threadsPerCall[claude.threadsPerCall.length - 1]
    const { uses, results } = pairs(last ?? [])
    expect(results).toEqual(uses)
  })

  it('pairs them when a step fails, because a healable failure still continues', async () => {
    const session = fakeSession({
      runStep: (step) => Promise.reject(new StepExecutionError(step, new Error('nothing matches')))
    })
    const claude = fakeClaude({ decisions: [click, dead, click] })
    await new AutomationOrchestrator(session, claude).runChatGoal('s1', 'do a thing', SILENT)

    const last = claude.threadsPerCall[claude.threadsPerCall.length - 1]
    const { uses, results } = pairs(last ?? [])
    expect(results).toEqual(uses)
  })

  it('pairs them when a dead selector is refused before it reaches the page', async () => {
    const session = fakeSession({
      runStep: (step) => Promise.reject(new StepExecutionError(step, new Error('nothing matches')))
    })
    const claude = fakeClaude({ decisions: [dead, dead, click] })
    await new AutomationOrchestrator(session, claude).runChatGoal('s1', 'do a thing', SILENT)

    const last = claude.threadsPerCall[claude.threadsPerCall.length - 1]
    const { uses, results } = pairs(last ?? [])
    expect(results).toEqual(uses)
    expect(claude.threadsPerCall.length).toBeGreaterThan(2)
  })

  it('pairs them when a step was not run because the user paused', async () => {
    let first = true
    const session = fakeSession({
      runStep: (step) => {
        if (!first) return Promise.resolve({})
        first = false
        return Promise.reject(new RunPausedError('you paused'))
      }
    })
    const claude = fakeClaude({ decisions: [click, click, click] })
    await new AutomationOrchestrator(session, claude).runChatGoal('s1', 'do a thing', SILENT)

    const last = claude.threadsPerCall[claude.threadsPerCall.length - 1]
    const { uses, results } = pairs(last ?? [])
    expect(results).toEqual(uses)
  })

  it('carries the outcome, not just the intention, so a repeat is visible to the model', async () => {
    const claude = fakeClaude({ decisions: [click, click] })
    await new AutomationOrchestrator(fakeSession(), claude).runChatGoal('s1', 'do a thing', SILENT)

    const last = claude.threadsPerCall[claude.threadsPerCall.length - 1] ?? []
    const text = JSON.stringify(last)
    expect(text).toContain('press go')
    expect(text).toMatch(/ran|worked|did not/)
  })

  it('ends the run rather than looping when the model answers in prose', async () => {
    const claude = fakeClaude({ decisions: [] })
    claude.nextAction = vi.fn(() =>
      Promise.resolve({
        action: null,
        text: 'I think we are done here.',
        content: [{ type: 'text', text: 'I think we are done here.' }],
        toolUseId: null,
        stopReason: 'end_turn'
      })
    ) as unknown as FakeClaude['nextAction']

    const rec = recorder()
    await new AutomationOrchestrator(fakeSession(), claude).runChatGoal('s1', 'do a thing', rec.observer)

    expect(rec.events[rec.events.length - 1]?.status).not.toBe('running')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/orchestrator.test.ts -t "thread integrity"`
Expected: FAIL — `claude.threadsPerCall` is undefined, and `nextAction` is not called.

- [ ] **Step 3: Rewrite the loop body**

In `runChatGoal`, replace `historyDescriptions` with the thread. Delete the `let historyDescriptions: string[] = []` declaration and the `describeAttempt` helper's last caller.

Declare alongside the other loop state:

```typescript
    const messages: Anthropic.MessageParam[] = [];
    let outstanding: string | null = null;
```

Replace the `decideNextAction` call and everything that fed it. The opening user turn is built on the first iteration; every later iteration's page rides on the `tool_result`:

```typescript
        const page = describePage(snapshot).join('\n\n');

        if (outstanding === null) {
          messages.push({ role: 'user', content: pageTurn(`Goal: ${goal}`, page, snapshot) });
        }

        const turn = await this.claude.nextAction(pruneThread(messages, KEEP_PAGES));
        messages.push({
          role: 'assistant',
          content: turn.content as Anthropic.ContentBlockParam[]
        });

        if (turn.stopReason === 'max_tokens')
          throw new Error(
            'the model ran out of room before choosing an action — its reply was cut off'
          );

        if (!turn.action || !turn.toolUseId) {
          settle({
            runId,
            source: 'chat',
            sessionId,
            status: humanSteps > 0 ? 'assisted' : 'done',
            stepIndex: i,
            description: turn.text ?? 'The model stopped without choosing an action',
          });
          return;
        }

        outstanding = turn.toolUseId;
        const decision = turn.action;
```

Add a helper next to `targetKey`, and a `reply` closure inside the loop that discharges the outstanding `tool_use`:

```typescript
function pageTurn(
  lead: string,
  page: string,
  snapshot: PageSnapshot
): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [
    { type: 'text', text: lead },
    { type: 'text', text: page }
  ];
  if (snapshot.screenshotBase64)
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: snapshot.screenshotBase64 }
    });
  return blocks;
}
```

Inside `runChatGoal`, above the loop:

```typescript
    const reply = (outcome: string, page: string, snapshot: PageSnapshot): void => {
      if (outstanding === null) return;
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: outstanding,
            content: pageTurn(outcome, page, snapshot)
          }
        ]
      });
      outstanding = null;
    };
```

Then call `reply(...)` at each of the four sites, replacing the corresponding `historyDescriptions.push(...)`:

| Site | Outcome text |
| --- | --- |
| `alreadyDead` refusal | `` `${decision.step_description} — NOT RUN: ${refusal}. Choose a different element.` `` |
| `RunPausedError` catch | `` `${decision.step_description} — not run, because you paused here.` `` |
| healable failure | `` `${decision.step_description} — FAILED: ${detail}. That selector does not work.` `` |
| step ran | `describeAttempt(decision.step_description, output)` |

The `page`/`snapshot` a `reply` carries is the **next** iteration's, not this one's — so move each `reply` call to the top of the following iteration, or simpler: take a fresh snapshot at the reply site. **Take the fresh snapshot**, because the point of the turn is to show the model the page as it is *after* the action:

```typescript
          const after = await this.browser.snapshot();
          reply(describeAttempt(decision.step_description, output), describePage(after).join('\n\n'), after);
```

Import at the top of `orchestrator.ts`:

```typescript
import type Anthropic from '@anthropic-ai/sdk';
import type { PageSnapshot } from './browser-session';
import { KEEP_PAGES, describePage, type ThreadTurn } from './claude-client';
import { pruneThread } from './thread';
```

`describePage` must be exported from `claude-client.ts` — add `export` to its
declaration. `PageSnapshot` is **not** currently imported by `orchestrator.ts`;
`pageTurn` needs it.

**Two symbols this orphans.** `decideNextAction` and `buildPrompt` in
`claude-client.ts` lose their only caller. Leave both in place for this task and
delete them in Task 3's commit only if `npm run typecheck` shows nothing else
reaching them — `buildPrompt` is exported and may be picked up by Plan B. What
you **must** update is `tests/orchestrator.test.ts:386`, which asserts
`expect(claude.decideNextAction).toHaveBeenCalledTimes(3)`; that becomes
`claude.nextAction`. Do not delete the assertion — it is checking the loop makes
one call per step, which is still true and still worth knowing.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/orchestrator.test.ts -t "thread integrity"`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm run typecheck && npm test`
Expected: typecheck exit 0. Still exactly the **6 pre-existing** budget-raise failures and no others. If a dead-target or self-healing test now fails, it is because it asserted on `historyPerCall`; update it to assert on `threadsPerCall`, do not delete it.

- [ ] **Step 6: Update AI_CONTEXT.md**

§8, add:

```markdown
- **Every assistant turn in a goal run gets its `tool_result` before the next
  model call.** `runChatGoal` tracks one `outstanding` tool-use id and discharges
  it at all four sites that reach another call — the dead-target refusal, the
  pause catch, a healable failure, and a step that ran. An orphaned `tool_use` is
  a hard 400, and because the thread is the loop's only memory, no retry clears
  it. Paths that `throw` end the run and need nothing; convert one to a
  `continue` and it inherits this rule.
```

§10, replace the `tool_choice` sentence in "Changing model behaviour":

```markdown
`tool_choice` is `auto` with `disable_parallel_tool_use` in the goal loop, not
pinned: measured on the gateway, `{type:'tool'}` and `{type:'any'}` return zero
thinking tokens on Sonnet 5 with no error, so pinning it silently disables
thinking. `auto` can answer in prose, which the loop treats as the end of the
run. The repair path still pins it — it has no thread and no thinking.
```

§7, add `MAX_DECISION_TOKENS | 4096 | claude-client` and `KEEP_PAGES | 2 page payloads | claude-client`.

§9, add:

```markdown
- **The Vercel gateway appears to ignore `anthropic-beta` headers.** A nonsense
  beta value returns 200 and `context_management` behaves identically with and
  without its header, so server-side context editing and compaction are both
  unavailable. Pruning is client-side for that reason, and pruning an image
  invalidates the messages cache — the two cannot both be had.
```

- [ ] **Step 7: Commit**

```bash
git add src/main/automation/orchestrator.ts src/main/automation/claude-client.ts tests/orchestrator.test.ts AI_CONTEXT.md
git commit -m "Give the goal loop a real conversation thread

The loop kept a list of intentions: describeAttempt pushed the bare step
description on success, so 'I clicked Done and it worked' and 'I clicked
Done' were the same string. One run clicked Search nine times and Done
thirteen because it could not tell it had already done them.

Now each iteration appends the assistant turn verbatim — thinking blocks
included, never filtered — and a tool_result carrying the outcome and the
page as it is after the action.

A tool_use with no tool_result is a hard 400 and the thread is the only
memory, so there is a test per path that reaches another model call."
```

---

### Task 4: Cancel must interrupt the model call

**Files:**
- Modify: `src/main/automation/orchestrator.ts`
- Test: `tests/orchestrator.test.ts`

**Interfaces:**
- Consumes: `nextAction(messages, signal?)` (Task 2).
- Produces: no new exports.

**Why:** `messages.create` gets no `AbortSignal`; the SDK pins a 10-minute non-streaming timeout and retries twice. Today Cancel usually lands on a bridge request, which `abortRun` rejects cleanly. This plan moves the long pole to the model call — a multi-turn thread with thinking is tens of seconds. A Cancel landing there rejects nothing.

- [ ] **Step 1: Write the failing test**

```typescript
it('stops waiting on the model when the run is cancelled', async () => {
  const controller: { abort: (() => void) | null } = { abort: null }
  const claude = fakeClaude()
  claude.nextAction = vi.fn(
    (_messages: unknown, signal?: AbortSignal) =>
      new Promise((_resolve, reject) => {
        controller.abort = () => reject(new RunCancelledError())
        signal?.addEventListener('abort', () => reject(new RunCancelledError()))
      })
  ) as unknown as FakeClaude['nextAction']

  const orchestrator = new AutomationOrchestrator(fakeSession(), claude)
  const run = orchestrator.runChatGoal('s1', 'do a thing', SILENT)
  await Promise.resolve()
  orchestrator.abandonModelCall()

  await expect(run).rejects.toBeInstanceOf(RunCancelledError)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/orchestrator.test.ts -t "stops waiting on the model"`
Expected: FAIL — `orchestrator.abandonModelCall is not a function`.

- [ ] **Step 3: Implement**

Add a field and a method to `AutomationOrchestrator`:

```typescript
  private inFlight: AbortController | null = null;

  abandonModelCall(): void {
    this.inFlight?.abort();
  }
```

In `runChatGoal`, wrap the call:

```typescript
        this.inFlight = new AbortController();
        let turn: ThreadTurn;
        try {
          turn = await this.claude.nextAction(pruneThread(messages, KEEP_PAGES), this.inFlight.signal);
        } finally {
          this.inFlight = null;
        }
```

And in the outer `finally`, alongside the existing teardown:

```typescript
      this.inFlight = null;
```

- [ ] **Step 4: Wire it to the cancel handler**

In `src/main/ipc.ts`, the `automationCancel` handler currently calls only `deps.bridge.cancel()`. Add the orchestrator:

```typescript
  handle(IpcChannels.automationCancel, () => {
    deps.automation.abandonModelCall()
    deps.bridge.cancel()
  })
```

Order matters: abort the model call first so the loop is already unwinding when `abortRun` sweeps the bridge.

- [ ] **Step 5: Run to verify it passes**

Run: `npm run typecheck && npx vitest run tests/orchestrator.test.ts`
Expected: typecheck exit 0, the new test passes, still exactly 6 pre-existing failures.

- [ ] **Step 6: Commit**

```bash
git add src/main/automation/orchestrator.ts src/main/ipc.ts tests/orchestrator.test.ts
git commit -m "Let Cancel interrupt an in-flight model call

messages.create had no AbortSignal and the SDK pins a ten-minute
non-streaming timeout with two retries. That was survivable while the
long pole was a bridge request, which abortRun rejects. With a threaded
call carrying thinking it is tens of seconds per step, and a Cancel
landing there rejected nothing."
```

---

### Task 5: `AI_MODEL`

**Files:**
- Modify: `src/main/automation/claude-client.ts`
- Modify: `.env.example`
- Test: `tests/claude-client.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveModel(raw: string | undefined): string`

**Constraint:** `.env` is read only when `!app.isPackaged`, and a Finder-launched macOS app inherits no shell environment, so in a packaged build `AI_MODEL` is always undefined. The default must therefore be the shipping model, and that is correct behaviour — per-run model switching in a packaged build is out of scope. The gateway also rejects bare Anthropic ids, so a copied-from-docs `claude-opus-5` must not pass silently.

- [ ] **Step 1: Write the failing test**

Create `tests/claude-client.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL, resolveModel } from '../src/main/automation/claude-client'

describe('resolveModel', () => {
  it('falls back to the shipping model when nothing is set', () => {
    expect(resolveModel(undefined)).toBe(DEFAULT_MODEL)
    expect(resolveModel('   ')).toBe(DEFAULT_MODEL)
  })

  it('accepts a prefixed id', () => {
    expect(resolveModel('anthropic/claude-opus-5')).toBe('anthropic/claude-opus-5')
  })

  it('refuses a bare id, because the gateway rejects one and the failure lands mid-run', () => {
    expect(() => resolveModel('claude-opus-5')).toThrow(/provider prefix/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/claude-client.test.ts`
Expected: FAIL — no export named `resolveModel`.

- [ ] **Step 3: Implement**

Replace the `MODEL` constant in `claude-client.ts`:

```typescript
export const DEFAULT_MODEL = 'anthropic/claude-sonnet-5'

export function resolveModel(raw: string | undefined): string {
  const wanted = raw?.trim()
  if (!wanted) return DEFAULT_MODEL
  if (!wanted.includes('/'))
    throw new Error(`AI_MODEL "${wanted}" needs a provider prefix, such as anthropic/${wanted}`)
  return wanted
}

const MODEL = resolveModel(process.env.AI_MODEL)
```

Keep the existing comment about the prefix — it now explains the guard.

- [ ] **Step 4: Document it**

Add to `.env.example`:

```
# Optional. Defaults to anthropic/claude-sonnet-5. The provider prefix is
# required. Read from .env in dev only — a packaged build always uses the default.
AI_MODEL=anthropic/claude-sonnet-5
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run typecheck && npm test`
Expected: typecheck exit 0, 3 new tests pass, still exactly 6 pre-existing failures.

- [ ] **Step 6: Update AI_CONTEXT.md §2**

The Environment paragraph says "One variable: `AI_GATEWAY_API_KEY`." Change to two, naming `AI_MODEL`, its default, and that a packaged build always uses the default.

- [ ] **Step 7: Commit**

```bash
git add src/main/automation/claude-client.ts tests/claude-client.test.ts .env.example AI_CONTEXT.md
git commit -m "Read the model from AI_MODEL, with the prefix enforced

A bare id copied from the docs is rejected at startup instead of
failing as a gateway 400 mid-run, after the extension has taken a tab."
```

---

## Verification

After Task 5:

```bash
npm run typecheck        # exit 0
npm test                 # 6 pre-existing failures only, all from the budget raise
npm run test:extension   # passes
```

Then a live run. `MAX_STATIC_LOOKS` bounds a bad run to roughly a minute, so this is cheap:

1. Full browser quit — the extension version was bumped to 1.5.0 on this branch.
2. Run the goal *"book a flight for me from pakistan to cananda"*.
3. Read the run thread. **Success is each step appearing once.** Compare against `71c8aa4f-991f-4843-afd1-fbbc48b77616`: Search ×11, Done ×13, destination ×11, `li#cNNN` ×10.
4. Check the DB for repetition:

```bash
sqlite3 ~/Library/Application\ Support/browser-automation/routines.db \
  "SELECT status, COUNT(*) FROM run_events WHERE run_id='<new-id>' GROUP BY status;"
```

## Known-Unresolved

Not addressed by this plan, and not regressions:

- **The `Done` failures in the original run** reported `is not visible`, not occlusion, so the `waitForActionable` fix does not touch them. The likeliest mechanism is the date picker closing between snapshot and click. This plan may fix it by accident — the model can now see that its last Done click did nothing — but that is a hope, not a claim. The live run is the test.
- **`li#cNNN` selectors.** `SELECTOR_RULES` already forbids machine-generated ids and the model used ten anyway. Stripping volatile ids in `filterDom` is the candidate fix and needs its own design; it risks stripping an id something legitimately needs.
- **The uncommitted budget raise** (`MAX_CHAT_STEPS` 25→100, `MAX_CHAT_FAILURES` 3→6, `MAX_ATTEMPTS_PER_STEP` 3→6) fails 6 tests. Untouched here because it is the owner's working state, not this plan's.
- **Plan B** — the `ask` action, `automation:ask`/`automation:answer`, the renderer question row, and the six §5 decisions — is written against this plan's real signatures once it lands.

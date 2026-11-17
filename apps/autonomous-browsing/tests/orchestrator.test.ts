import { describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { AutomationOrchestrator, toActionStep } from '../src/main/automation/orchestrator'
import { describeStep, resolveStep } from '../src/shared/routines'
import { KEEP_PAGES } from '../src/main/automation/thread'
import type { AgentAction, ClaudeAutomationClient, RepairPlan } from '../src/main/automation/claude-client'
import type { SiteLandmark, SiteMemoryReader } from '../src/shared/site-memory'
import { StepIndeterminateError } from '../src/main/automation/extension-bridge'
import {
  AssertionFailedError,
  RunCancelledError,
  RunPausedError,
  StepExecutionError,
  type AutomationSession,
  type PageSnapshot
} from '../src/main/automation/session'
import type {
  ActionStep,
  AutomationProgressEvent,
  CapturedArtifact,
  RunObserver,
  RunStepRecord,
  RunUsage,
  StepRepair
} from '../src/shared/types'

describe('toActionStep', () => {
  it('maps click and navigate actions, keeping the description as the step intent', () => {
    expect(toActionStep({ action: 'click', selector: '#go', step_description: 'press go' })).toEqual({
      kind: 'click',
      selector: '#go',
      intent: 'press go'
    })
    expect(toActionStep({ action: 'navigate', text: 'https://example.com', step_description: 'open the site' })).toEqual({
      kind: 'navigate',
      url: 'https://example.com',
      intent: 'open the site'
    })
  })

  it('maps a type action, keeping an empty string as valid text', () => {
    expect(toActionStep({ action: 'type', selector: '#q', text: '', step_description: 'x' })).toEqual({
      kind: 'type',
      selector: '#q',
      text: '',
      intent: 'x'
    })
  })

  it('carries submit through, so a search is one step and not a hunt for the button', () => {
    expect(
      toActionStep({ action: 'type', selector: '#q', text: 'cats', submit: true, step_description: 'x' })
    ).toEqual({
      kind: 'type',
      selector: '#q',
      text: 'cats',
      submit: true,
      intent: 'x'
    })
  })

  it('maps the extra kinds a repair may use but chat never emits', () => {
    expect(toActionStep({ action: 'wait', selector: '#late', step_description: 'x' })).toEqual({
      kind: 'wait',
      forSelector: '#late',
      intent: 'x'
    })
    expect(toActionStep({ action: 'scroll', step_description: 'x' })).toEqual({ kind: 'scroll', to: 'bottom', intent: 'x' })
  })

  it('rejects a click without a selector', () => {
    expect(() => toActionStep({ action: 'click', step_description: 'x' })).toThrow(/selector/)
  })

  it('rejects a type action missing either selector or text', () => {
    expect(() => toActionStep({ action: 'type', text: 'hi', step_description: 'x' })).toThrow(/selector or text/)
    expect(() => toActionStep({ action: 'type', selector: '#q', step_description: 'x' })).toThrow(/selector or text/)
  })

  it('rejects a navigate action without a url', () => {
    expect(() => toActionStep({ action: 'navigate', step_description: 'x' })).toThrow(/url/)
  })

  it('rejects "done" — the caller should stop the loop before mapping it', () => {
    expect(() => toActionStep({ action: 'done', step_description: 'x' })).toThrow(/unsupported action/)
  })

  it('rejects "needs_human" — a hand-off is not a step the browser can run', () => {
    expect(() => toActionStep({ action: 'needs_human', step_description: 'solve the CAPTCHA' })).toThrow(
      /unsupported action/
    )
  })
})

const PAGE = {
  url: 'https://a.com',
  title: 'A',
  screenshotBase64: null,
  screenshotError: null,
  dom: '<p>x</p>',
  domError: null,
  blockedBy: null
}

function fakeSession(overrides: Partial<AutomationSession> = {}): AutomationSession {
  return {
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    snapshot: () => Promise.resolve(PAGE),
    runStep: () => Promise.resolve({}),
    extractText: () => Promise.resolve(''),
    holdForHuman: () => Promise.resolve(),
    currentUrl: () => null,
    setRunContext: () => {},
    setHoldReporter: () => {},
    ...overrides
  }
}

const SILENT: RunObserver = { progress: () => {} }

function recorder(): {
  observer: RunObserver
  events: AutomationProgressEvent[]
  artifacts: CapturedArtifact[]
  repairs: StepRepair[]
  recordings: Array<{ steps: ActionStep[]; eventsBefore: number }>
  steps: RunStepRecord[]
  usages: RunUsage[]
} {
  const events: AutomationProgressEvent[] = []
  const artifacts: CapturedArtifact[] = []
  const repairs: StepRepair[] = []
  const recordings: Array<{ steps: ActionStep[]; eventsBefore: number }> = []
  const steps: RunStepRecord[] = []
  const usages: RunUsage[] = []
  const observer: RunObserver = {
    progress: (event) => events.push(event),
    artifact: (_runId, artifact) => artifacts.push(artifact),
    repair: (_runId, repair) => repairs.push(repair),
    recorded: (_runId, steps) => recordings.push({ steps: [...steps], eventsBefore: events.length }),
    step: (_runId, record) => steps.push(record),
    usage: (_runId, totals) => usages.push(totals)
  }
  return { observer, events, artifacts, repairs, recordings, steps, usages }
}

type FakeClaude = ClaudeAutomationClient & { threadsPerCall: Anthropic.MessageParam[][] }

function fakeClaude(queues: { repairs?: RepairPlan[]; decisions?: AgentAction[] } = {}): FakeClaude {
  const repairs = [...(queues.repairs ?? [])]
  const decisions = [...(queues.decisions ?? [])]
  const threadsPerCall: Anthropic.MessageParam[][] = []
  let callIndex = 0
  return {
    threadsPerCall,
    nextAction: vi.fn((messages: Anthropic.MessageParam[]) => {
      threadsPerCall.push(structuredClone(messages))
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
    repairStep: vi.fn(() =>
      Promise.resolve({
        plan: repairs.shift() ?? { verdict: 'impossible', reason: 'nothing to try' },
        usage: null
      })
    )
  } as unknown as FakeClaude
}

// The thread is nested content blocks; every assertion about it is about the text
// somewhere inside, so flatten it once here rather than at each call site.
function threadText(messages: Anthropic.MessageParam[] | undefined): string {
  return JSON.stringify(messages ?? [])
}

function routine(steps: ActionStep[]): { name: string; description: string | null; definition: { steps: ActionStep[] } } {
  return { name: 'Test routine', description: null, definition: { steps } }
}

// A screenshot the extension captured and an extract the page yielded are the
// only things a routine produces; unreturned, they are taken and discarded.
describe('runRoutine results', () => {
  function orchestratorOver(extracted: string): AutomationOrchestrator {
    const browser = fakeSession({
      runStep: (step) => Promise.resolve(step.kind === 'screenshot' ? { value: 'aGVsbG8=' } : {}),
      extractText: () => Promise.resolve(extracted)
    })
    return new AutomationOrchestrator(browser, fakeClaude())
  }

  it('returns extracted text and captured screenshots', async () => {
    const result = await orchestratorOver('42 results').runRoutine(
      routine([
        { kind: 'extract', selector: 'main', into: 'results' },
        { kind: 'screenshot', label: 'landing' }
      ]),
      {},
      SILENT
    )

    expect(result.extracted).toEqual({ results: '42 results' })
    expect(result.artifacts).toEqual([{ label: 'landing', stepIndex: 1, dataUrl: 'data:image/jpeg;base64,aGVsbG8=' }])
  })

  it('labels an unlabelled screenshot by its step number', async () => {
    const result = await orchestratorOver('').runRoutine(routine([{ kind: 'screenshot' }]), {}, SILENT)

    expect(result.artifacts[0]?.label).toBe('Step 1')
  })

  it('reports what the run produced, not the params it was given', async () => {
    const result = await orchestratorOver('body text').runRoutine(
      routine([{ kind: 'navigate', url: '{{url}}' }]),
      { url: 'https://example.com' },
      SILENT
    )

    expect(result.extracted).toEqual({})
    expect(result.artifacts).toEqual([])
  })
})

describe('runRoutine self-healing', () => {
  const step: ActionStep = { kind: 'click', selector: '#old', intent: 'send the message' }

  it('reports a repair even when the step later needs a human, because that is the one worth reviewing', async () => {
    const runStep = vi.fn((action: ActionStep) => {
      if (action.kind === 'click') {
        return Promise.reject(new StepExecutionError(action, 'timed out waiting for it'))
      }
      return Promise.resolve({})
    })
    const claude = fakeClaude({
      repairs: [
        {
          verdict: 'repair',
          actions: [{ action: 'click', selector: '#new', step_description: 'try the new one' }],
          reason: 'the button may be #new now'
        }
      ]
    })

    const rec = recorder()
    const session = fakeSession({ runStep })
    const result = await new AutomationOrchestrator(session, claude).runRoutine(
      routine([step]),
      {},
      rec.observer
    )

    expect(rec.events.some((event) => event.status === 'held')).toBe(true)
    expect(rec.repairs.map((repair) => repair.reason)).toEqual(['the button may be #new now'])
    expect(result.repairs).toEqual([])
  })

  it('files the page it repaired against as an artifact, and keeps it out of the repair row', async () => {
    const runStep = vi.fn((action: ActionStep) => {
      if (action.kind === 'click' && action.selector === '#old') {
        return Promise.reject(new StepExecutionError(action, 'timed out waiting for #old'))
      }
      return Promise.resolve({})
    })
    const claude = fakeClaude({
      repairs: [
        {
          verdict: 'repair',
          actions: [{ action: 'click', selector: '#new', step_description: 'click the relabelled button' }],
          reason: 'the send button is now #new'
        }
      ]
    })
    const session = fakeSession({
      runStep,
      snapshot: () => Promise.resolve({ ...PAGE, screenshotBase64: 'ZmFrZS1qcGVn' })
    })

    const rec = recorder()
    const result = await new AutomationOrchestrator(session, claude).runRoutine(routine([step]), {}, rec.observer)

    expect(rec.artifacts.filter((a) => a.kind === 'repair')).toEqual([
      { kind: 'repair', stepIndex: 0, label: 'the send button is now #new', base64: 'ZmFrZS1qcGVn' }
    ])
    expect(result.repairs[0]).not.toHaveProperty('screenshotBase64')
  })

  it('files no repair artifact when the page could not be photographed', async () => {
    const runStep = vi.fn((action: ActionStep) => {
      if (action.kind === 'click' && action.selector === '#old') {
        return Promise.reject(new StepExecutionError(action, 'timed out waiting for #old'))
      }
      return Promise.resolve({})
    })
    const claude = fakeClaude({
      repairs: [
        {
          verdict: 'repair',
          actions: [{ action: 'click', selector: '#new', step_description: 'click it' }],
          reason: 'moved'
        }
      ]
    })
    const session = fakeSession({ runStep, snapshot: () => Promise.resolve({ ...PAGE, screenshotBase64: null }) })

    const rec = recorder()
    await new AutomationOrchestrator(session, claude).runRoutine(routine([step]), {}, rec.observer)

    expect(rec.artifacts.filter((a) => a.kind === 'repair')).toEqual([])
  })

  it('repairs a step whose selector no longer matches, and reports the repair', async () => {
    const runStep = vi.fn((action: ActionStep) => {
      if (action.kind === 'click' && action.selector === '#old') {
        return Promise.reject(new StepExecutionError(action, 'timed out waiting for #old — nothing on this page matches it'))
      }
      return Promise.resolve({})
    })
    const claude = fakeClaude({
      repairs: [
        {
          verdict: 'repair',
          actions: [{ action: 'click', selector: '#new', step_description: 'click the relabelled send button' }],
          reason: 'the send button is now #new'
        }
      ]
    })

    const rec = recorder()
    const result = await new AutomationOrchestrator(fakeSession({ runStep }), claude).runRoutine(
      routine([step]),
      {},
      rec.observer
    )

    expect(runStep).toHaveBeenCalledTimes(2)
    expect(result.repairs).toEqual([
      {
        stepIndex: 0,
        reason: 'the send button is now #new',
        original: step,
        replacement: [{ kind: 'click', selector: '#new', intent: 'click the relabelled send button' }]
      }
    ])
    expect(rec.events.filter((event) => event.status === 'held')).toEqual([])
    expect(rec.events.at(-1)?.status).toBe('done')
  })

  it('refuses to heal around the credential guard', async () => {
    const runStep = vi.fn((action: ActionStep) =>
      Promise.reject(new StepExecutionError(action, 'refusing to write into a password field — fill it in yourself'))
    )
    const claude = fakeClaude()

    await expect(
      new AutomationOrchestrator(fakeSession({ runStep }), claude).runRoutine(
        routine([{ kind: 'type', selector: '#pw', text: 'hunter2' }]),
        {},
        SILENT
      )
    ).rejects.toThrow(/refusing to write into/)

    expect(claude.repairStep).not.toHaveBeenCalled()
  })

  it('hands a committing step that did nothing to the human instead of clicking again', async () => {
    const runStep = vi.fn(() => Promise.resolve({ changed: false, committing: true }))
    const holdForHuman = vi.fn(() => Promise.resolve())
    const claude = fakeClaude()

    const result = await new AutomationOrchestrator(fakeSession({ runStep, holdForHuman }), claude).runRoutine(
      routine([{ kind: 'click', selector: '#place-order' }]),
      {},
      SILENT
    )

    expect(runStep).toHaveBeenCalledTimes(1)
    expect(claude.repairStep).not.toHaveBeenCalled()
    expect(holdForHuman).toHaveBeenCalledTimes(1)
    expect(result.repairs).toEqual([])
  })

  it('carries on when the model says an unreactive page is fine', async () => {
    const runStep = vi.fn(() => Promise.resolve({ changed: false }))
    const holdForHuman = vi.fn(() => Promise.resolve())
    const claude = fakeClaude({ repairs: [{ verdict: 'proceed', reason: 'the checkbox is already ticked' }] })

    const result = await new AutomationOrchestrator(fakeSession({ runStep, holdForHuman }), claude).runRoutine(
      routine([{ kind: 'click', selector: '#agree' }]),
      {},
      SILENT
    )

    expect(runStep).toHaveBeenCalledTimes(1)
    expect(holdForHuman).not.toHaveBeenCalled()
    expect(result.repairs).toEqual([])
  })

  it('parks for the human when no repair can be found', async () => {
    const runStep = vi.fn((action: ActionStep) => Promise.reject(new StepExecutionError(action, 'timed out waiting for #gone')))
    const holdForHuman = vi.fn((_reason: string) => Promise.resolve())
    const claude = fakeClaude({ repairs: [{ verdict: 'impossible', reason: 'the control is behind a login' }] })

    await new AutomationOrchestrator(fakeSession({ runStep, holdForHuman }), claude).runRoutine(
      routine([{ kind: 'click', selector: '#gone' }]),
      {},
      SILENT
    )

    expect(holdForHuman).toHaveBeenCalledTimes(1)
    expect(String(holdForHuman.mock.calls[0]?.[0])).toMatch(/step 1 needs you/)
  })
})

describe('runRoutine extract healing', () => {
  const step: ActionStep = { kind: 'extract', selector: '#old-total', into: 'total' }

  function readsOnlyFrom(selector: string): (target: string) => Promise<string> {
    return (target) =>
      target === selector
        ? Promise.resolve('42 results')
        : Promise.reject(new StepExecutionError({ kind: 'extract', selector: target, into: 'total' }, `timed out waiting for ${target}`))
  }

  it('reads from the first selector the repair named, and reports the swap as a repair', async () => {
    const claude = fakeClaude({
      repairs: [
        {
          verdict: 'repair',
          actions: [
            { action: 'scroll', step_description: 'bring the summary card into view' },
            { action: 'click', selector: '#new-total', step_description: 'the total is in the summary card now' }
          ],
          reason: 'the total moved into the summary card'
        }
      ]
    })
    const rec = recorder()

    const result = await new AutomationOrchestrator(
      fakeSession({ extractText: readsOnlyFrom('#new-total') }),
      claude
    ).runRoutine(routine([step]), {}, rec.observer)

    expect(result.extracted).toEqual({ total: '42 results' })
    expect(result.repairs).toEqual([
      {
        stepIndex: 0,
        reason: 'the total moved into the summary card',
        original: step,
        replacement: [{ kind: 'extract', selector: '#new-total', into: 'total' }]
      }
    ])
    expect(rec.repairs).toEqual(result.repairs)
    expect(rec.artifacts).toEqual([{ kind: 'extract', stepIndex: 0, label: 'total', text: '42 results' }])
  })

  it('reports every repair it tried, and returns the one that worked', async () => {
    const claude = fakeClaude({
      repairs: [
        { verdict: 'repair', actions: [{ action: 'click', selector: '#mid', step_description: 'try the header' }], reason: 'first guess' },
        { verdict: 'repair', actions: [{ action: 'click', selector: '#new-total', step_description: 'try the card' }], reason: 'second guess' }
      ]
    })
    const rec = recorder()

    const result = await new AutomationOrchestrator(
      fakeSession({ extractText: readsOnlyFrom('#new-total') }),
      claude
    ).runRoutine(routine([step]), {}, rec.observer)

    expect(rec.repairs.map((repair) => repair.reason)).toEqual(['first guess', 'second guess'])
    expect(result.repairs.map((repair) => repair.reason)).toEqual(['second guess'])
  })

  it('hands the step to a human when the repair names nothing to read from', async () => {
    const claude = fakeClaude({
      repairs: [{ verdict: 'repair', actions: [{ action: 'scroll', step_description: 'scroll down first' }], reason: 'it may be below the fold' }]
    })
    const holdForHuman = vi.fn((_reason: string) => Promise.resolve())
    const rec = recorder()

    await new AutomationOrchestrator(
      fakeSession({ extractText: readsOnlyFrom('#nothing-matches-this'), holdForHuman }),
      claude
    ).runRoutine(routine([step]), {}, rec.observer)

    expect(String(holdForHuman.mock.calls[0]?.[0])).toMatch(/step 1 needs you/)
    expect(rec.artifacts).toEqual([])
    expect(rec.events.at(-1)?.status).toBe('assisted')
  })
})

// A pause is the user changing the page under the run, so the step that was
// decided before it is stale. Neither loop may charge that to its own budget.
describe('pause and resume', () => {
  function pausesThenSucceeds(times: number): {
    runStep: (step: ActionStep, vars?: Record<string, string>) => Promise<Record<string, never>>
    calls: () => number
  } {
    let calls = 0
    return {
      runStep: () => {
        calls++
        if (calls <= times) return Promise.reject(new RunPausedError('paused by the user'))
        return Promise.resolve({})
      },
      calls: () => calls
    }
  }

  it('keeps a chat run alive through more pauses than it allows failures', async () => {
    const { runStep, calls } = pausesThenSucceeds(4)
    const click: AgentAction = { action: 'click', selector: '#event', step_description: 'Click Event' }
    const claude = fakeClaude({ decisions: [click, click, click, click, click] })
    const statuses: string[] = []

    await new AutomationOrchestrator(fakeSession({ runStep }), claude).runChatGoal('s1', 'create an event', {
      progress: (event) => statuses.push(event.status)
    })

    expect(calls()).toBe(5)
    expect(statuses).not.toContain('error')
  })

  it('re-decides after a pause rather than replaying what it chose before', async () => {
    const { runStep } = pausesThenSucceeds(1)
    const click: AgentAction = { action: 'click', selector: '#event', step_description: 'Click Event' }
    const claude = fakeClaude({ decisions: [click, click] })

    await new AutomationOrchestrator(fakeSession({ runStep }), claude).runChatGoal('s1', 'create an event', SILENT)

    expect(claude.nextAction).toHaveBeenCalledTimes(3)
    expect(threadText(claude.threadsPerCall[1])).toMatch(/paused/)
  })

  it('re-runs a routine step the user paused without spending an attempt on it', async () => {
    const { runStep, calls } = pausesThenSucceeds(4)
    const claude = fakeClaude()
    const rec = recorder()

    const result = await new AutomationOrchestrator(fakeSession({ runStep }), claude).runRoutine(
      routine([{ kind: 'click', selector: '#event' }]),
      {},
      rec.observer
    )

    expect(calls()).toBe(5)
    expect(claude.repairStep).not.toHaveBeenCalled()
    expect(result.repairs).toEqual([])
    expect(rec.events.filter((event) => event.status === 'healing')).toHaveLength(4)
    expect(rec.events[1]).toMatchObject({
      status: 'healing',
      stepIndex: 0,
      description: 'Step 1 was not run because you paused. Trying it again.'
    })
    expect(rec.events.at(-1)?.status).toBe('done')
  })

  it('re-reads an extract the user paused without spending an attempt on it', async () => {
    let calls = 0
    const extractText = (): Promise<string> => {
      calls++
      if (calls <= 4) return Promise.reject(new RunPausedError('paused by the user'))
      return Promise.resolve('42 results')
    }
    const claude = fakeClaude()
    const rec = recorder()

    const result = await new AutomationOrchestrator(fakeSession({ extractText }), claude).runRoutine(
      routine([{ kind: 'extract', selector: 'main', into: 'count' }]),
      {},
      rec.observer
    )

    expect(result.extracted).toEqual({ count: '42 results' })
    expect(claude.repairStep).not.toHaveBeenCalled()
    expect(rec.events.filter((event) => event.status === 'healing')).toHaveLength(4)
  })
})

describe('runChatGoal self-healing', () => {
  it('tells the model what failed and lets it choose again, instead of ending the run', async () => {
    const runStep = vi.fn((action: ActionStep) => {
      if (action.kind === 'click' && action.selector === 'button:has-text("Send")') {
        return Promise.reject(new StepExecutionError(action, 'timed out waiting for button:has-text("Send")'))
      }
      return Promise.resolve({})
    })
    const claude = fakeClaude({
      decisions: [
        { action: 'click', selector: 'button:has-text("Send")', step_description: 'click Send' },
        { action: 'click', selector: 'button[aria-label="Send message"]', step_description: 'click the send icon' }
      ]
    })

    await new AutomationOrchestrator(fakeSession({ runStep }), claude).runChatGoal('s1', 'send a message', SILENT)

    expect(claude.threadsPerCall[0]).toHaveLength(1)
    expect(threadText(claude.threadsPerCall[1])).toMatch(/FAILED: step .* timed out waiting for/)
    expect(runStep).toHaveBeenCalledTimes(2)
  })

  it('notes a step the page ignored so the model can react to it', async () => {
    const claude = fakeClaude({ decisions: [{ action: 'click', selector: '#x', step_description: 'click x' }] })

    await new AutomationOrchestrator(fakeSession({ runStep: () => Promise.resolve({ changed: false }) }), claude).runChatGoal(
      's1',
      'do a thing',
      SILENT
    )

    expect(threadText(claude.threadsPerCall[1])).toMatch(/did not visibly react/)
  })

  // Distinct selectors on purpose: repeating one is refused before it reaches the
  // page, which is a different rule with its own tests below.
  it('stops flailing after too many failures in a row', async () => {
    const runStep = vi.fn((action: ActionStep) => Promise.reject(new StepExecutionError(action, 'timed out waiting for #x')))
    // Comfortably more than MAX_CHAT_FAILURES, so the cap is what ends the run
    // rather than fakeClaude running out of decisions and answering "done".
    const claude = fakeClaude({
      decisions: Array.from({ length: 500 }, (_, i) => ({
        action: 'click' as const,
        selector: `#x${i}`,
        step_description: 'click x'
      }))
    })

    await expect(
      new AutomationOrchestrator(fakeSession({ runStep }), claude).runChatGoal('s1', 'do a thing', SILENT)
    ).rejects.toThrow(/timed out waiting for #x/)

    expect(runStep.mock.calls.length).toBeLessThan(500)
  })
})

// The thread a run leaves behind is built entirely from these events, so what a
// run reports about itself is as much a contract as what it returns.
describe('what a run reports about itself', () => {
  it('ends a clean run "done", with every step event carrying its resolved step', async () => {
    const rec = recorder()
    const browser = fakeSession({ extractText: () => Promise.resolve('42') })

    await new AutomationOrchestrator(browser, fakeClaude()).runRoutine(
      routine([
        { kind: 'navigate', url: 'https://{{site}}/search' },
        { kind: 'type', selector: '#q', text: '{{term}}' },
        { kind: 'extract', selector: '#{{term}}-total', into: 'total' }
      ]),
      { site: 'example.com', term: 'invoices' },
      rec.observer
    )

    const started = rec.events.filter((event) => event.status === 'running')
    expect(started.map((event) => event.stepIndex)).toEqual([0, 1, 2])
    expect(started.map((event) => event.step)).toEqual([
      { kind: 'navigate', url: 'https://example.com/search' },
      { kind: 'type', selector: '#q', text: 'invoices' },
      { kind: 'extract', selector: '#invoices-total', into: 'total' }
    ])
    expect(rec.events.at(-1)).toMatchObject({ status: 'done', stepIndex: 3 })
  })

  it('ends "assisted" when a person did a step, holding at that step and continuing past it', async () => {
    const runStep = vi.fn((action: ActionStep) =>
      action.kind === 'click'
        ? Promise.reject(new StepExecutionError(action, 'timed out waiting for #gone'))
        : Promise.resolve({})
    )
    const holdForHuman = vi.fn(() => Promise.resolve())
    const claude = fakeClaude({ repairs: [{ verdict: 'impossible', reason: 'the control is behind a login' }] })
    const rec = recorder()

    await new AutomationOrchestrator(fakeSession({ runStep, holdForHuman }), claude).runRoutine(
      routine([
        { kind: 'click', selector: '#gone' },
        { kind: 'navigate', url: 'https://a.com' }
      ]),
      {},
      rec.observer
    )

    const held = rec.events.filter((event) => event.status === 'held')
    expect(held).toHaveLength(1)
    expect(held[0]).toMatchObject({
      stepIndex: 0,
      description:
        'Step 1 needs you: step "click" failed: timed out waiting for #gone. Do it in the browser, then press Resume.'
    })
    expect(held[0]?.step).toBeUndefined()
    expect(holdForHuman).toHaveBeenCalledTimes(1)
    expect(rec.events.filter((event) => event.status === 'running').map((event) => event.stepIndex)).toEqual([0, 1])
    expect(rec.events.at(-1)?.status).toBe('assisted')
  })

  it('records a hold the extension took on its own, and ends "assisted" too', async () => {
    const rec = recorder()
    const reporters: Array<((reason: string) => void) | null> = []
    const browser = fakeSession({
      setHoldReporter: (report) => reporters.push(report),
      runStep: () => {
        reporters[0]?.('a one-time-code field is on this page')
        return Promise.resolve({})
      }
    })

    await new AutomationOrchestrator(browser, fakeClaude()).runRoutine(
      routine([{ kind: 'type', selector: '#otp', text: '{{code}}' }]),
      { code: '123456' },
      rec.observer
    )

    expect(rec.events.filter((event) => event.status === 'held')).toEqual([
      expect.objectContaining({
        stepIndex: 0,
        description:
          'Step 1 is waiting for you: a one-time-code field is on this page. Handle it in the browser, then press Resume.'
      })
    ])
    expect(rec.events.at(-1)).toMatchObject({ status: 'assisted', stepIndex: 1 })
    expect(reporters.at(-1)).toBeNull()
  })

  it('ends "cancelled" on the cancellation class, and "error" on a lookalike message', async () => {
    const cancelled = recorder()
    await expect(
      new AutomationOrchestrator(
        fakeSession({ runStep: () => Promise.reject(new RunCancelledError()) }),
        fakeClaude()
      ).runRoutine(routine([{ kind: 'click', selector: '#x' }]), {}, cancelled.observer)
    ).rejects.toThrow(/cancelled/)

    expect(cancelled.events.at(-1)).toMatchObject({
      status: 'cancelled',
      stepIndex: 0,
      description: 'Cancelled',
      error: 'the automation run was cancelled'
    })

    const lookalike = recorder()
    await expect(
      new AutomationOrchestrator(
        fakeSession({ runStep: () => Promise.reject(new Error('the automation run was cancelled')) }),
        fakeClaude()
      ).runRoutine(routine([{ kind: 'click', selector: '#x' }]), {}, lookalike.observer)
    ).rejects.toThrow()

    expect(lookalike.events.at(-1)?.status).toBe('error')
  })

  it('ends a cancelled chat run "cancelled" too, and a lookalike message "error"', async () => {
    const click: AgentAction = { action: 'click', selector: '#x', step_description: 'click x' }
    const cancelled = recorder()
    await expect(
      new AutomationOrchestrator(
        fakeSession({ runStep: () => Promise.reject(new RunCancelledError()) }),
        fakeClaude({ decisions: [click] })
      ).runChatGoal('s1', 'do a thing', cancelled.observer)
    ).rejects.toThrow(/cancelled/)

    expect(cancelled.events.at(-1)).toMatchObject({
      status: 'cancelled',
      stepIndex: 0,
      description: 'Cancelled',
      error: 'the automation run was cancelled'
    })

    const lookalike = recorder()
    await expect(
      new AutomationOrchestrator(
        fakeSession({ runStep: () => Promise.reject(new Error('the automation run was cancelled')) }),
        fakeClaude({ decisions: [click] })
      ).runChatGoal('s1', 'do a thing', lookalike.observer)
    ).rejects.toThrow()

    expect(lookalike.events.at(-1)).toMatchObject({ status: 'error', description: 'Failed' })
  })

  it('names the step that was running when the run failed', async () => {
    const rec = recorder()
    const runStep = (action: ActionStep): Promise<Record<string, never>> =>
      action.kind === 'type'
        ? Promise.reject(new StepExecutionError(action, 'refusing to write into a password field'))
        : Promise.resolve({})

    await expect(
      new AutomationOrchestrator(fakeSession({ runStep }), fakeClaude()).runRoutine(
        routine([
          { kind: 'navigate', url: 'https://a.com' },
          { kind: 'navigate', url: 'https://b.com' },
          { kind: 'type', selector: '#pw', text: 'hunter2' }
        ]),
        {},
        rec.observer
      )
    ).rejects.toThrow(/refusing to write into/)

    expect(rec.events.at(-1)).toMatchObject({
      status: 'error',
      stepIndex: 2,
      description: 'Failed',
      error: 'step "type" failed: refusing to write into a password field'
    })
  })

  it('reports a failure before the first step at index -1, so no step is blamed', async () => {
    const stale = new Error('the Chrome extension is version 1.0.0 but this app needs 1.4.0')
    const browser = fakeSession({ connect: () => Promise.reject(stale) })
    const rec = recorder()
    const chat = recorder()

    await expect(
      new AutomationOrchestrator(browser, fakeClaude()).runRoutine(
        routine([{ kind: 'click', selector: '#x' }]),
        {},
        rec.observer
      )
    ).rejects.toThrow(/1.4.0/)
    await expect(
      new AutomationOrchestrator(browser, fakeClaude()).runChatGoal('s1', 'do a thing', chat.observer)
    ).rejects.toThrow(/1.4.0/)

    expect(rec.events).toEqual([expect.objectContaining({ status: 'error', stepIndex: -1, error: stale.message })])
    expect(chat.events).toEqual([expect.objectContaining({ status: 'error', stepIndex: -1, error: stale.message })])
  })

  it('names the step a chat run was on when it failed, and carries the step it chose', async () => {
    const runStep = vi.fn((action: ActionStep) => Promise.reject(new StepExecutionError(action, 'timed out waiting for #x')))
    const claude = fakeClaude({
      decisions: Array.from({ length: 500 }, () => ({ action: 'click' as const, selector: '#x', step_description: 'click x' }))
    })
    const rec = recorder()

    await expect(
      new AutomationOrchestrator(fakeSession({ runStep }), claude).runChatGoal('s1', 'do a thing', rec.observer)
    ).rejects.toThrow(/timed out waiting for #x/)

    // One model call per step, so the last call is the step it died on.
    expect(rec.events.at(-1)).toMatchObject({
      status: 'error',
      stepIndex: vi.mocked(claude.nextAction).mock.calls.length - 1,
      description: 'Failed',
      error: 'step "click" failed: timed out waiting for #x'
    })
    expect(rec.events.find((event) => event.status === 'running' && event.stepIndex >= 0)?.step).toEqual({
      kind: 'click',
      selector: '#x',
      intent: 'click x'
    })
  })

  it('hands over a chat run\u2019s recorded steps before the terminal event settles it', async () => {
    const rec = recorder()
    const claude = fakeClaude({ decisions: [{ action: 'click', selector: '#a', step_description: 'click a' }] })

    await new AutomationOrchestrator(fakeSession(), claude).runChatGoal('s1', 'do a thing', rec.observer)

    expect(rec.recordings).toEqual([
      { steps: [{ kind: 'click', selector: '#a', intent: 'click a' }], eventsBefore: rec.events.length - 1 }
    ])
    expect(rec.events.at(-1)?.status).toBe('done')
  })

  it('still hands over what a failed chat run recorded, so it is saveable afterwards', async () => {
    const rec = recorder()
    let steps = 0
    const runStep = (action: ActionStep): Promise<Record<string, never>> => {
      steps++
      if (steps === 1) return Promise.resolve({})
      return Promise.reject(new Error('the automated tab was closed'))
    }
    const claude = fakeClaude({
      decisions: Array.from({ length: 3 }, () => ({ action: 'click' as const, selector: '#a', step_description: 'click a' }))
    })

    await expect(
      new AutomationOrchestrator(fakeSession({ runStep }), claude).runChatGoal('s1', 'do a thing', rec.observer)
    ).rejects.toThrow(/tab was closed/)

    expect(rec.recordings).toEqual([
      { steps: [{ kind: 'click', selector: '#a', intent: 'click a' }], eventsBefore: rec.events.length - 1 }
    ])
  })

  it('reports a screenshot and an extract as artifacts, labelled the way the thread shows them', async () => {
    const rec = recorder()
    const browser = fakeSession({
      runStep: (step) => Promise.resolve(step.kind === 'screenshot' ? { value: 'aGVsbG8=' } : {}),
      extractText: () => Promise.resolve('42 results')
    })

    await new AutomationOrchestrator(browser, fakeClaude()).runRoutine(
      routine([
        { kind: 'extract', selector: 'main', into: 'results' },
        { kind: 'screenshot', label: 'landing' },
        { kind: 'screenshot' }
      ]),
      {},
      rec.observer
    )

    expect(rec.artifacts).toEqual([
      { kind: 'extract', stepIndex: 0, label: 'results', text: '42 results' },
      { kind: 'screenshot', stepIndex: 1, label: 'landing', base64: 'aGVsbG8=' },
      { kind: 'screenshot', stepIndex: 2, label: 'Step 3', base64: 'aGVsbG8=' }
    ])
  })

  it('reports a repair even when the run fails after it, because the return value is lost then', async () => {
    const runStep = vi.fn((action: ActionStep) =>
      action.kind === 'click' && action.selector === '#old'
        ? Promise.reject(new StepExecutionError(action, 'timed out waiting for #old'))
        : Promise.reject(new StepExecutionError(action, 'refusing to write into a password field'))
    )
    const claude = fakeClaude({
      repairs: [
        {
          verdict: 'repair',
          actions: [{ action: 'click', selector: '#new', step_description: 'click the moved button' }],
          reason: 'the send button moved'
        }
      ]
    })
    const rec = recorder()

    await expect(
      new AutomationOrchestrator(fakeSession({ runStep }), claude).runRoutine(
        routine([{ kind: 'click', selector: '#old' }]),
        {},
        rec.observer
      )
    ).rejects.toThrow(/refusing to write into/)

    expect(rec.events.at(-1)).toMatchObject({ status: 'error', stepIndex: 0 })
    expect(rec.repairs).toEqual([
      {
        stepIndex: 0,
        reason: 'the send button moved',
        original: { kind: 'click', selector: '#old' },
        replacement: [{ kind: 'click', selector: '#new', intent: 'click the moved button' }]
      }
    ])
  })

  function brokenObserver(): RunObserver {
    const refuse = (): never => {
      throw new Error('the run store is closed')
    }
    return { progress: refuse, artifact: refuse, repair: refuse, recorded: refuse }
  }

  it('finishes the run even when the observer throws on everything it is handed', async () => {
    const browser = fakeSession({
      runStep: (step) => {
        if (step.kind === 'click' && step.selector === '#old') {
          return Promise.reject(new StepExecutionError(step, 'timed out waiting for #old'))
        }
        return Promise.resolve(step.kind === 'screenshot' ? { value: 'aGVsbG8=' } : {})
      },
      extractText: () => Promise.resolve('42')
    })
    const claude = fakeClaude({
      repairs: [
        {
          verdict: 'repair',
          actions: [{ action: 'click', selector: '#new', step_description: 'click the moved button' }],
          reason: 'the send button moved'
        }
      ]
    })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await new AutomationOrchestrator(browser, claude).runRoutine(
      routine([
        { kind: 'extract', selector: 'main', into: 'total' },
        { kind: 'screenshot' },
        { kind: 'click', selector: '#old' }
      ]),
      {},
      brokenObserver()
    )

    expect(result.extracted).toEqual({ total: '42' })
    expect(result.artifacts).toHaveLength(1)
    expect(result.repairs).toHaveLength(1)
    expect(logged).toHaveBeenCalledTimes(1)
    logged.mockRestore()
  })

  it('lets the run\u2019s own failure out even when the observer throws on the way out', async () => {
    const browser = fakeSession({
      runStep: (step) => Promise.reject(new StepExecutionError(step, 'refusing to write into a password field'))
    })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      new AutomationOrchestrator(browser, fakeClaude()).runRoutine(
        routine([{ kind: 'type', selector: '#pw', text: 'hunter2' }]),
        {},
        brokenObserver()
      )
    ).rejects.toThrow(/refusing to write into/)
    await expect(
      new AutomationOrchestrator(
        browser,
        fakeClaude({ decisions: [{ action: 'click', selector: '#x', step_description: 'click x' }] })
      ).runChatGoal('s1', 'do a thing', brokenObserver())
    ).rejects.toThrow(/refusing to write into/)

    logged.mockRestore()
  })

  it('tells the session which run and step are in flight, and clears it when the run ends', async () => {
    const contexts: Array<{ runId: string; stepIndex: number } | null> = []
    const browser = fakeSession({ setRunContext: (context) => contexts.push(context) })

    const result = await new AutomationOrchestrator(browser, fakeClaude()).runRoutine(
      routine([
        { kind: 'navigate', url: 'https://a.com' },
        { kind: 'navigate', url: 'https://b.com' }
      ]),
      {},
      SILENT
    )

    expect(contexts).toEqual([{ runId: result.runId, stepIndex: 0 }, { runId: result.runId, stepIndex: 1 }, null])
  })

  it('clears it when a run fails, and tracks it through a chat run as well', async () => {
    const failed: Array<{ stepIndex: number } | null> = []
    await expect(
      new AutomationOrchestrator(
        fakeSession({
          setRunContext: (context) => failed.push(context),
          runStep: () => Promise.reject(new Error('the automated tab was closed'))
        }),
        fakeClaude()
      ).runRoutine(routine([{ kind: 'click', selector: '#x' }]), {}, SILENT)
    ).rejects.toThrow(/tab was closed/)

    expect(failed).toEqual([{ runId: expect.any(String), stepIndex: 0 }, null])

    const chat: Array<{ stepIndex: number } | null> = []
    await new AutomationOrchestrator(
      fakeSession({ setRunContext: (context) => chat.push(context) }),
      fakeClaude({ decisions: [{ action: 'click', selector: '#a', step_description: 'click a' }] })
    ).runChatGoal('s1', 'do a thing', SILENT)

    expect(chat.map((context) => context?.stepIndex ?? null)).toEqual([0, 1, null])
  })
})

describe('describeStep', () => {
  it('describes every step kind for the progress UI', () => {
    expect(describeStep({ kind: 'navigate', url: 'https://a.com' })).toBe('Navigate to https://a.com')
    expect(describeStep({ kind: 'click', selector: '#a' })).toBe('Click #a')
    expect(describeStep({ kind: 'type', selector: '#a', text: 'hi' })).toBe('Type into #a')
    expect(describeStep({ kind: 'select', selector: '#a', value: 'x' })).toBe('Select x in #a')
    expect(describeStep({ kind: 'wait', forSelector: '#a' })).toBe('Wait for #a')
    expect(describeStep({ kind: 'wait', ms: 500 })).toBe('Wait 500ms')
    expect(describeStep({ kind: 'scroll', to: 'bottom' })).toBe('Scroll bottom')
    expect(describeStep({ kind: 'scroll' })).toBe('Scroll to element')
    expect(describeStep({ kind: 'screenshot' })).toBe('Capture screenshot')
    expect(describeStep({ kind: 'screenshot', label: 'landing' })).toBe('Capture screenshot (landing)')
    expect(describeStep({ kind: 'extract', selector: '#a', into: 'result' })).toBe('Extract #a into result')
  })
})

// A real run against Google Flights chose the same absent selector three times
// and burned a full action timeout on each. The model is told once; after that
// the loop refuses rather than asking the page again.
describe('a goal run that keeps choosing a selector the page does not have', () => {
  const dead: AgentAction = {
    action: 'click',
    selector: 'div:has-text("Toronto Pearson International Airport")',
    step_description: 'Select Toronto Pearson International Airport as origin'
  }

  function alwaysMissing(): { session: AutomationSession; tried: () => ActionStep[] } {
    const tried: ActionStep[] = []
    const session = fakeSession({
      runStep: (step) => {
        tried.push(step)
        return Promise.reject(new StepExecutionError(step, new Error('nothing on this page matches it')))
      }
    })
    return { session, tried: () => tried }
  }

  it('spends one browser action on it, not one per attempt', async () => {
    const { session, tried } = alwaysMissing()
    const claude = fakeClaude({ decisions: Array.from({ length: 500 }, () => dead) })

    await expect(
      new AutomationOrchestrator(session, claude).runChatGoal('s1', 'find flights', SILENT)
    ).rejects.toThrow(/nothing on this page matches it/)

    expect(tried()).toHaveLength(1)
  })

  it('hands the model the selectors that already failed rather than hoping it reads the history', async () => {
    const { session } = alwaysMissing()
    const claude = fakeClaude({ decisions: Array.from({ length: 500 }, () => dead) })

    await expect(
      new AutomationOrchestrator(session, claude).runChatGoal('s1', 'find flights', SILENT)
    ).rejects.toThrow()

    expect(threadText(claude.threadsPerCall[0])).not.toMatch(/Already tried on this page/)
    const second = threadText(claude.threadsPerCall[1])
    expect(second).toMatch(/Already tried on this page/)
    expect(second).toContain('Toronto Pearson International Airport')
  })

  it('says in the thread that it refused, so the transcript is not silently short', async () => {
    const { session } = alwaysMissing()
    const rec = recorder()

    await expect(
      new AutomationOrchestrator(session, fakeClaude({ decisions: Array.from({ length: 500 }, () => dead) })).runChatGoal(
        's1',
        'find flights',
        rec.observer
      )
    ).rejects.toThrow()

    expect(rec.events.some((event) => /already failed/.test(event.description))).toBe(true)
  })

  it('forgets what failed once a step works, because the page it was dead on has moved on', async () => {
    const outcomes = ['fail', 'ok', 'fail'] as const
    let at = 0
    const tried: ActionStep[] = []
    const session = fakeSession({
      runStep: (step) => {
        tried.push(step)
        if (outcomes[at++] === 'ok') return Promise.resolve({})
        return Promise.reject(new StepExecutionError(step, new Error('nothing on this page matches it')))
      }
    })
    const other: AgentAction = { action: 'click', selector: '#other', step_description: 'something else' }

    await new AutomationOrchestrator(session, fakeClaude({ decisions: [dead, other, dead] })).runChatGoal(
      's1',
      'find flights',
      SILENT
    )

    expect(tried.map((step) => ('selector' in step ? step.selector : ''))).toEqual([
      dead.selector,
      other.selector,
      dead.selector
    ])
  })

  it('forgets what failed once the page changes, because the selector was only dead on that page', async () => {
    const pages = ['https://a.com', 'https://b.com', 'https://b.com']
    let looks = 0
    const tried: ActionStep[] = []
    const session = fakeSession({
      snapshot: () => Promise.resolve({ ...PAGE, url: pages[looks++] ?? 'https://b.com' }),
      runStep: (step) => {
        tried.push(step)
        return Promise.reject(new StepExecutionError(step, new Error('nothing on this page matches it')))
      }
    })

    await expect(
      new AutomationOrchestrator(session, fakeClaude({ decisions: Array.from({ length: 500 }, () => dead) })).runChatGoal(
        's1',
        'find flights',
        SILENT
      )
    ).rejects.toThrow()

    expect(tried).toHaveLength(2)
  })
})

// "Stopped after 25 steps" is not an outcome the product should call done: the
// goal was not reached, and a run filed as done is one nobody goes back to look at.
describe('runChatGoal running out of steps', () => {
  const click: AgentAction = { action: 'click', selector: '#go', step_description: 'press go' }

  it('reports error, not done, when the budget runs out before the goal', async () => {
    // Comfortably more than MAX_CHAT_STEPS, so the cap is what ends the run
    // rather than fakeClaude running out of decisions and answering "done". The
    // page has to keep moving too, or the circles guard ends it first.
    const decisions = Array.from({ length: 500 }, () => click)
    let page = 0
    const session = fakeSession({
      snapshot: () => Promise.resolve({ ...PAGE, dom: `<p>result ${page++}</p>` })
    })
    const rec = recorder()

    await expect(
      new AutomationOrchestrator(session, fakeClaude({ decisions })).runChatGoal(
        's1',
        'book a flight',
        rec.observer
      )
    ).rejects.toThrow(/without reaching the goal/)

    expect(rec.events[rec.events.length - 1]?.status).toBe('error')
  })
})

// The other guards all fire on failures. A goal run can also get nowhere while
// every step succeeds, and the model rephrases its selector each time round, so
// nothing that compares selectors can see it. The page not moving is the tell.
describe('runChatGoal going in circles', () => {
  const search: AgentAction = { action: 'click', selector: '#search', step_description: 'search for flights' }
  const done: AgentAction = { action: 'click', selector: '#done', step_description: 'confirm the date' }

  function alternating(count: number): AgentAction[] {
    return Array.from({ length: count }, (_, i) => (i % 2 === 0 ? search : done))
  }

  function working(pages: () => Partial<PageSnapshot>): { session: AutomationSession; tried: () => ActionStep[] } {
    const tried: ActionStep[] = []
    const session = fakeSession({
      snapshot: () => Promise.resolve({ ...PAGE, ...pages() }),
      runStep: (step) => {
        tried.push(step)
        return Promise.resolve({ changed: true })
      }
    })
    return { session, tried: () => tried }
  }

  it('stops once the page has come back identical too many steps running', async () => {
    const { session, tried } = working(() => ({ screenshotBase64: 'one-frame-forever' }))

    await expect(
      new AutomationOrchestrator(session, fakeClaude({ decisions: alternating(40) })).runChatGoal(
        's1',
        'book a flight',
        SILENT
      )
    ).rejects.toThrow(/circles/)

    expect(tried()).toHaveLength(8)
  })

  it('still calls it circles when only the screenshot flickers, because a caret blink is not progress', async () => {
    let pixel = 0
    const { session, tried } = working(() => ({ screenshotBase64: `frame-${pixel++}` }))

    await expect(
      new AutomationOrchestrator(session, fakeClaude({ decisions: alternating(40) })).runChatGoal(
        's1',
        'book a flight',
        SILENT
      )
    ).rejects.toThrow(/circles/)

    expect(tried()).toHaveLength(8)
  })

  it('guards a run it cannot screenshot, which is any run watched from the app window', async () => {
    const { session, tried } = working(() => ({ screenshotBase64: null }))

    await expect(
      new AutomationOrchestrator(session, fakeClaude({ decisions: alternating(40) })).runChatGoal(
        's1',
        'book a flight',
        SILENT
      )
    ).rejects.toThrow(/circles/)

    expect(tried()).toHaveLength(8)
  })

  it('falls back to the frame when the page cannot be read at all', async () => {
    const { session, tried } = working(() => ({
      dom: '',
      domError: 'the page cannot be read',
      screenshotBase64: 'one-frame-forever'
    }))

    await expect(
      new AutomationOrchestrator(session, fakeClaude({ decisions: alternating(40) })).runChatGoal(
        's1',
        'book a flight',
        SILENT
      )
    ).rejects.toThrow(/circles/)

    expect(tried()).toHaveLength(8)
  })

  it('calls it circles when only the page\'s own request id changes, because that is one page', async () => {
    let request = 0
    const { session, tried } = working(() => {
      request += 1
      return {
        dom: `<h1>Sorry, A Problem Occurred</h1><span id="request-id">b4019e17-65c9-473e-a0b6-${String(request).padStart(12, '0')}</span>`
      }
    })

    await expect(
      new AutomationOrchestrator(session, fakeClaude({ decisions: alternating(40) })).runChatGoal(
        's1',
        'book a flight',
        SILENT
      )
    ).rejects.toThrow(/circles/)

    expect(tried()).toHaveLength(8)
  })

  it('counts nothing when neither the page nor a frame can be read', async () => {
    const { session, tried } = working(() => ({
      dom: '',
      domError: 'the page cannot be read',
      screenshotBase64: null
    }))

    await new AutomationOrchestrator(session, fakeClaude({ decisions: alternating(12) })).runChatGoal(
      's1',
      'book a flight',
      SILENT
    )

    expect(tried()).toHaveLength(12)
  })

  it('lets a repeated step run while the page keeps moving, because that is what "load more" looks like', async () => {
    let page = 0
    const { session, tried } = working(() => ({ dom: `<p>result ${page++}</p>` }))

    await new AutomationOrchestrator(session, fakeClaude({ decisions: alternating(12) })).runChatGoal(
      's1',
      'book a flight',
      SILENT
    )

    expect(tried()).toHaveLength(12)
  })
})

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

  function lastThread(claude: FakeClaude): Anthropic.MessageParam[] {
    return claude.threadsPerCall[claude.threadsPerCall.length - 1] ?? []
  }

  const click: AgentAction = { action: 'click', selector: '#go', step_description: 'press go' }
  const dead: AgentAction = { action: 'click', selector: '#gone', step_description: 'press gone' }

  it('pairs every tool_use with a tool_result when steps succeed', async () => {
    const claude = fakeClaude({ decisions: [click, click, click] })
    await new AutomationOrchestrator(fakeSession(), claude).runChatGoal('s1', 'do a thing', SILENT)

    const { uses, results } = pairs(lastThread(claude))
    expect(results).toEqual(uses)
  })

  it('pairs them when a step fails, because a healable failure still continues', async () => {
    const session = fakeSession({
      runStep: (step) => Promise.reject(new StepExecutionError(step, new Error('nothing matches')))
    })
    const claude = fakeClaude({ decisions: [click, dead, click] })
    await new AutomationOrchestrator(session, claude).runChatGoal('s1', 'do a thing', SILENT)

    const { uses, results } = pairs(lastThread(claude))
    expect(results).toEqual(uses)
  })

  it('pairs them when a dead selector is refused before it reaches the page', async () => {
    const session = fakeSession({
      runStep: (step) => Promise.reject(new StepExecutionError(step, new Error('nothing matches')))
    })
    const claude = fakeClaude({ decisions: [dead, dead, click] })
    await new AutomationOrchestrator(session, claude).runChatGoal('s1', 'do a thing', SILENT)

    const { uses, results } = pairs(lastThread(claude))
    expect(results).toEqual(uses)
    expect(claude.threadsPerCall.length).toBeGreaterThan(2)
  })

  it('pairs them when a step was not run because the user paused', async () => {
    let first = true
    const session = fakeSession({
      runStep: () => {
        if (!first) return Promise.resolve({})
        first = false
        return Promise.reject(new RunPausedError('you paused'))
      }
    })
    const claude = fakeClaude({ decisions: [click, click, click] })
    await new AutomationOrchestrator(session, claude).runChatGoal('s1', 'do a thing', SILENT)

    const { uses, results } = pairs(lastThread(claude))
    expect(results).toEqual(uses)
  })

  it('pairs them when the page hands the run to a person', async () => {
    let looks = 0
    const session = fakeSession({
      snapshot: () => Promise.resolve({ ...PAGE, blockedBy: looks++ === 1 ? 'CAPTCHA' : null })
    })
    const claude = fakeClaude({ decisions: [click, click, click] })
    await new AutomationOrchestrator(session, claude).runChatGoal('s1', 'do a thing', SILENT)

    const { uses, results } = pairs(lastThread(claude))
    expect(results).toEqual(uses)
  })

  it('carries the outcome, not just the intention, so a repeat is visible to the model', async () => {
    const claude = fakeClaude({ decisions: [click, click] })
    await new AutomationOrchestrator(fakeSession(), claude).runChatGoal('s1', 'do a thing', SILENT)

    const text = threadText(lastThread(claude))
    expect(text).toContain('press go')
    expect(text).toMatch(/ran|worked|did not/)
  })

  it('replays the assistant turn verbatim, because a filtered thinking block is a 400', async () => {
    const claude = fakeClaude({ decisions: [click, click] })
    await new AutomationOrchestrator(fakeSession(), claude).runChatGoal('s1', 'do a thing', SILENT)

    const assistant = lastThread(claude).find((message) => message.role === 'assistant')
    expect(assistant?.content).toEqual([
      { type: 'thinking', thinking: '', signature: 'sig-1' },
      { type: 'tool_use', id: 'call-1', name: 'decide_next_action', input: click }
    ])
  })

  it('shows the model the page as it is after the action, not the one it decided from', async () => {
    let look = 0
    const session = fakeSession({
      snapshot: () => Promise.resolve({ ...PAGE, dom: `<p>look ${look++}</p>` })
    })
    const claude = fakeClaude({ decisions: [click, click] })
    await new AutomationOrchestrator(session, claude).runChatGoal('s1', 'do a thing', SILENT)

    // The second call decided from look 0 and must be shown look 1, not look 0.
    expect(threadText(claude.threadsPerCall[1])).toContain('look 1')
  })

  it('ends the run rather than looping when the model answers in prose', async () => {
    const claude = fakeClaude()
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

    expect(claude.nextAction).toHaveBeenCalledTimes(1)
    expect(rec.events.at(-1)?.status).toBe('done')
  })

  it('stops rather than guessing when the reply was cut off mid-decision', async () => {
    const claude = fakeClaude()
    claude.nextAction = vi.fn(() =>
      Promise.resolve({
        action: null,
        text: null,
        content: [{ type: 'text', text: 'I will click the' }],
        toolUseId: null,
        stopReason: 'max_tokens'
      })
    ) as unknown as FakeClaude['nextAction']

    const rec = recorder()
    await expect(
      new AutomationOrchestrator(fakeSession(), claude).runChatGoal('s1', 'do a thing', rec.observer)
    ).rejects.toThrow(/cut off/)

    expect(rec.events.at(-1)?.status).toBe('error')
  })

  it('keeps the thread from growing without bound as the run goes on', async () => {
    const claude = fakeClaude({ decisions: Array.from({ length: 8 }, () => click) })
    let look = 0
    const session = fakeSession({
      snapshot: () => Promise.resolve({ ...PAGE, screenshotBase64: 'AAAA', dom: `<p>page ${look++}</p>` })
    })
    await new AutomationOrchestrator(session, claude).runChatGoal('s1', 'do a thing', SILENT)

    const images = JSON.stringify(lastThread(claude)).split('"type":"image"').length - 1
    expect(images).toBe(KEEP_PAGES)
  })
})

describe('runChatGoal site-memory digest', () => {
  const A = 'https://a.example'
  const B = 'https://b.example'
  const A_LABEL = 'the alpha search box'
  const B_LABEL = 'the beta search box'

  function landmark(origin: string, label: string, selector: string): SiteLandmark {
    return {
      id: origin,
      origin,
      kind: 'control',
      factKey: selector,
      selector,
      stepKind: 'type',
      url: `${origin}/`,
      label,
      hits: 3,
      misses: 0,
      firstSeen: 1,
      lastSeen: 2
    }
  }

  const reader: SiteMemoryReader = {
    forOrigin: (origin) => {
      if (origin === A) return [landmark(A, A_LABEL, 'input#alpha')]
      if (origin === B) return [landmark(B, B_LABEL, 'input#beta')]
      return []
    }
  }

  function blocksOfNewestTurn(messages: Anthropic.MessageParam[] | undefined): string[] {
    const last = [...(messages ?? [])].reverse().find((message) => message.role === 'user')
    if (last === undefined || typeof last.content === 'string') return []
    const texts: string[] = []
    for (const block of last.content) {
      if (block.type === 'text') texts.push(block.text)
      if (block.type === 'tool_result' && Array.isArray(block.content)) {
        for (const inner of block.content) if (inner.type === 'text') texts.push(inner.text)
      }
    }
    return texts
  }

  async function threeTurns(): Promise<FakeClaude> {
    const click: AgentAction = { action: 'click', selector: '#go', step_description: 'press go' }
    const claude = fakeClaude({ decisions: [click, click, click] })
    let look = 0
    const session = fakeSession({
      snapshot: () => {
        const url = look < 2 ? `${A}/one` : `${B}/two`
        return Promise.resolve({ ...PAGE, url, dom: `<p>page ${look++}</p>` })
      }
    })
    await new AutomationOrchestrator(session, claude, reader).runChatGoal('s1', 'do a thing', SILENT)
    return claude
  }

  it('lands in the first text block on the turn the run enters an origin, and not on the next turn there', async () => {
    const claude = await threeTurns()

    const entered = blocksOfNewestTurn(claude.threadsPerCall[0])
    expect(entered[0]).toContain(A_LABEL)
    expect(entered[0]).toContain('input#alpha')
    expect(entered.slice(1).join('\n')).not.toContain(A_LABEL)

    expect(blocksOfNewestTurn(claude.threadsPerCall[1]).join('\n')).not.toContain(A_LABEL)
  })

  it('is paid again on a new origin, and never carries the old origin with it', async () => {
    const claude = await threeTurns()

    const arrived = blocksOfNewestTurn(claude.threadsPerCall[2])
    expect(arrived[0]).toContain(B_LABEL)
    expect(arrived[0]).toContain('input#beta')
    expect(arrived.join('\n')).not.toContain(A_LABEL)
    expect(arrived.join('\n')).not.toContain('input#alpha')
  })

  it('says nothing about an origin it has never seen', async () => {
    const click: AgentAction = { action: 'click', selector: '#go', step_description: 'press go' }
    const claude = fakeClaude({ decisions: [click] })
    await new AutomationOrchestrator(fakeSession(), claude, reader).runChatGoal('s1', 'do a thing', SILENT)

    expect(blocksOfNewestTurn(claude.threadsPerCall[0]).join('\n')).not.toContain('Notes recorded by earlier runs')
  })
})

// Chrome can only capture the visible tab, so a run watched from the app window
// records nothing. Saying so is the difference between a caveat and a bug report.
describe('what a goal run stores when it cannot see the page', () => {
  const click: AgentAction = { action: 'click', selector: '#go', step_description: 'press go' }

  function goalRunOver(snapshots: Array<{ shot: string | null; why: string | null }>): {
    run: (observer: RunObserver) => Promise<void>
  } {
    let at = 0
    const session = fakeSession({
      snapshot: () => {
        const next = snapshots[Math.min(at++, snapshots.length - 1)]
        return Promise.resolve({ ...PAGE, screenshotBase64: next?.shot ?? null, screenshotError: next?.why ?? null })
      }
    })
    const claude = fakeClaude({ decisions: [click, click] })
    const orchestrator = new AutomationOrchestrator(session, claude)
    return { run: (observer) => orchestrator.runChatGoal('s1', 'do a thing', observer) }
  }

  it('records why there is no screenshot, once, rather than leaving the thread blank', async () => {
    const rec = recorder()
    await goalRunOver([{ shot: null, why: 'the automated tab is no longer the visible one in its window' }]).run(
      rec.observer
    )

    const shots = rec.artifacts.filter((artifact) => artifact.kind === 'screenshot')
    expect(shots).toHaveLength(1)
    expect(shots[0]?.base64).toBeUndefined()
    expect(shots[0]?.text).toMatch(/no longer the visible one/)
  })

  it('stores a frame once, not once per step, when the page has not repainted', async () => {
    const rec = recorder()
    await goalRunOver([
      { shot: 'AAAA', why: null },
      { shot: 'AAAA', why: null }
    ]).run(rec.observer)

    expect(rec.artifacts.filter((artifact) => artifact.base64)).toHaveLength(1)
  })

  it('stores the next frame once the page does change', async () => {
    const rec = recorder()
    await goalRunOver([
      { shot: 'AAAA', why: null },
      { shot: 'BBBB', why: null }
    ]).run(rec.observer)

    expect(rec.artifacts.filter((artifact) => artifact.base64).map((a) => a.base64)).toEqual(['AAAA', 'BBBB'])
  })

  it('stores the frame of the page it answered done on, which is the evidence for the answer', async () => {
    const rec = recorder()
    await goalRunOver([
      { shot: 'AAAA', why: null },
      { shot: 'BBBB', why: null },
      { shot: 'CCCC', why: null }
    ]).run(rec.observer)

    expect(rec.artifacts.filter((artifact) => artifact.base64).map((a) => a.base64)).toEqual([
      'AAAA',
      'BBBB',
      'CCCC'
    ])
  })
})

// A bot wall, a login or a paywall is not a failure the model can select its way
// out of. Its only exits used to be answering "done" on a goal it never reached,
// or spending the step budget on the wall.
describe('runChatGoal handing a blocked page to the person', () => {
  const askForHelp: AgentAction = { action: 'needs_human', step_description: 'solve the CAPTCHA on wsj.com' }
  const click: AgentAction = { action: 'click', selector: '#go', step_description: 'press go' }

  function holdingSession(walls: Array<string | null>): {
    session: AutomationSession
    held: () => string[]
  } {
    const held: string[] = []
    let looks = 0
    const session = fakeSession({
      snapshot: () => Promise.resolve({ ...PAGE, blockedBy: walls[Math.min(looks++, walls.length - 1)] ?? null }),
      holdForHuman: (reason) => {
        held.push(reason)
        return Promise.resolve()
      }
    })
    return { session, held: () => held }
  }

  it('parks the run when the model asks for a person, and carries on from where they left it', async () => {
    const { session, held } = holdingSession([null])
    const rec = recorder()

    await new AutomationOrchestrator(session, fakeClaude({ decisions: [askForHelp, click] })).runChatGoal(
      's1',
      'read the article',
      rec.observer
    )

    expect(held()).toEqual(['step 1 needs you — solve the CAPTCHA on wsj.com'])
    expect(rec.events.filter((event) => event.status === 'held')[0]?.description).toMatch(
      /solve the CAPTCHA on wsj.com.*press Resume/
    )
    expect(rec.events.at(-1)?.status).toBe('assisted')
  })

  it('parks on a recognised wall before spending a model call deciding against it', async () => {
    const { session, held } = holdingSession(['DataDome bot check', null])
    const claude = fakeClaude({ decisions: [click] })
    const rec = recorder()

    await new AutomationOrchestrator(session, claude).runChatGoal('s1', 'read the article', rec.observer)

    expect(held()).toEqual(['step 1 needs you — the page is behind a DataDome bot check'])
    expect(claude.nextAction).toHaveBeenCalledTimes(2)
    expect(rec.events.at(-1)?.status).toBe('assisted')
  })

  it('stops asking once the hand-off budget is spent, so a wall nobody clears cannot hold the run open', async () => {
    const { session, held } = holdingSession(['DataDome bot check'])
    const rec = recorder()

    await expect(
      new AutomationOrchestrator(session, fakeClaude()).runChatGoal('s1', 'read the article', rec.observer)
    ).rejects.toThrow(/still needed you/)

    expect(held()).toHaveLength(30)
    expect(rec.events.at(-1)?.status).toBe('error')
  })

  it('forgets what failed while it was parked, because the person may have moved the page on', async () => {
    const tried: ActionStep[] = []
    let attempts = 0
    const session = fakeSession({
      snapshot: () => Promise.resolve(PAGE),
      runStep: (step) => {
        tried.push(step)
        attempts++
        if (attempts === 1) return Promise.reject(new StepExecutionError(step, new Error('nothing matches it')))
        return Promise.resolve({})
      }
    })
    const claude = fakeClaude({ decisions: [click, askForHelp, click] })

    await new AutomationOrchestrator(session, claude).runChatGoal('s1', 'read the article', SILENT)

    expect(tried.map((step) => ('selector' in step ? step.selector : ''))).toEqual(['#go', '#go'])
  })
})

describe('runChatGoal opening the thread', () => {
  it('reports the run as running once Chrome is attached, before the first model call', async () => {
    const rec = recorder()
    const claude = fakeClaude({ decisions: [{ action: 'click', selector: '#a', step_description: 'click a' }] })
    let eventsBeforeFirstCall = -1
    vi.mocked(claude.nextAction).mockImplementationOnce(() => {
      eventsBeforeFirstCall = rec.events.length
      return Promise.resolve({
        action: { action: 'click', selector: '#a', step_description: 'click a' },
        text: null,
        content: [{ type: 'tool_use', id: 'call-1', name: 'decide_next_action', input: {} }],
        toolUseId: 'call-1',
        stopReason: 'tool_use'
      } as Awaited<ReturnType<ClaudeAutomationClient['nextAction']>>)
    })

    await new AutomationOrchestrator(fakeSession(), claude).runChatGoal('s1', 'do a thing', rec.observer)

    expect(eventsBeforeFirstCall).toBe(1)
    expect(rec.events[0]).toEqual({
      runId: expect.any(String),
      source: 'chat',
      sessionId: 's1',
      status: 'running',
      stepIndex: -1,
      description: 'Reading the page and choosing the first step.'
    })
  })

  it('opens nothing when Chrome never attaches, so a launch failure blames no step', async () => {
    const rec = recorder()
    const browser = fakeSession({ connect: () => Promise.reject(new Error('Chrome exited before it was ready')) })

    await expect(
      new AutomationOrchestrator(browser, fakeClaude()).runChatGoal('s1', 'do a thing', rec.observer)
    ).rejects.toThrow(/Chrome exited/)

    expect(rec.events).toEqual([
      expect.objectContaining({ status: 'error', stepIndex: -1, error: 'Chrome exited before it was ready' })
    ])
  })
})

describe('what a run records about each step', () => {
  it('files one record per step, and calls a clean step direct', async () => {
    const { observer, steps } = recorder()
    await new AutomationOrchestrator(fakeSession(), fakeClaude()).runRoutine(
      routine([
        { kind: 'navigate', url: 'https://a.com' },
        { kind: 'click', selector: '#go' }
      ]),
      {},
      observer
    )

    expect(steps.map((step) => [step.stepIndex, step.kind, step.resolvedBy, step.attempts])).toEqual([
      [0, 'navigate', 'direct', 1],
      [1, 'click', 'direct', 1]
    ])
  })

  it('marks a step layer 0 had to wait or scroll for, so its work is countable', async () => {
    const { observer, steps } = recorder()
    const browser = fakeSession({ runStep: () => Promise.resolve({ recovered: true }) })
    await new AutomationOrchestrator(browser, fakeClaude()).runRoutine(
      routine([{ kind: 'click', selector: '#go' }]),
      {},
      observer
    )

    expect(steps[0]?.resolvedBy).toBe('recovered')
    expect(steps[0]?.recovered).toBe(true)
  })

  it('attributes a step the healer rewrote to the repair, and counts the retry', async () => {
    const { observer, steps } = recorder()
    let calls = 0
    const browser = fakeSession({
      runStep: (action: ActionStep) => {
        calls += 1
        if (calls === 1) return Promise.reject(new StepExecutionError(action, 'timed out waiting for #go'))
        return Promise.resolve({})
      }
    })
    const claude = fakeClaude({
      repairs: [{ verdict: 'repair', actions: [{ action: 'click', selector: '#other', step_description: 'try the other one' }], reason: 'renamed' }]
    })

    await new AutomationOrchestrator(browser, claude).runRoutine(
      routine([{ kind: 'click', selector: '#go' }]),
      {},
      observer
    )

    expect(steps[0]?.resolvedBy).toBe('repair')
    expect(steps[0]?.attempts).toBe(2)
  })

  it('files a record for a step that ended at a human, rather than losing the one worth reading', async () => {
    const { observer, steps } = recorder()
    const browser = fakeSession({
      runStep: (action: ActionStep) => Promise.reject(new StepExecutionError(action, 'timed out waiting for #go'))
    })

    await new AutomationOrchestrator(browser, fakeClaude()).runRoutine(
      routine([{ kind: 'click', selector: '#go' }]),
      {},
      observer
    )

    expect(steps).toHaveLength(1)
    expect(steps[0]?.resolvedBy).toBe('human')
  })

  it('reports the running cost, counting the repair calls a routine run made', async () => {
    const { observer, usages } = recorder()
    const browser = fakeSession({
      runStep: (action: ActionStep) => Promise.reject(new StepExecutionError(action, 'timed out waiting for #go'))
    })

    await new AutomationOrchestrator(browser, fakeClaude()).runRoutine(
      routine([{ kind: 'click', selector: '#go' }]),
      {},
      observer
    )

    const last = usages[usages.length - 1]
    expect(last?.repairBudgetSpent).toBeGreaterThan(0)
    expect(last?.repairCalls).toBe(last?.llmCalls)
    expect(last?.model).toBe('anthropic/claude-sonnet-5')
  })

  it('leaves a healthy routine run costing nothing, which is the architecture claim', async () => {
    const { observer, usages } = recorder()
    await new AutomationOrchestrator(fakeSession(), fakeClaude()).runRoutine(
      routine([{ kind: 'click', selector: '#go' }]),
      {},
      observer
    )

    expect(usages[usages.length - 1]?.llmCalls).toBe(0)
  })
})

describe('what a goal run records about itself', () => {
  it('counts a model call per iteration, so a chat run never reports as free', async () => {
    const { observer, usages } = recorder()
    const claude = fakeClaude({
      decisions: [
        { action: 'click', selector: '#one', step_description: 'first' },
        { action: 'done', step_description: 'finished' }
      ]
    })

    await new AutomationOrchestrator(fakeSession(), claude).runChatGoal('s1', 'do a thing', observer)

    expect(usages[usages.length - 1]?.llmCalls).toBe(2)
    expect(usages[usages.length - 1]?.repairCalls).toBe(0)
  })

  it('keeps the decision context a goal run used to leave only in trace.jsonl', async () => {
    const { observer, steps } = recorder()
    const claude = fakeClaude({
      decisions: [
        { action: 'click', selector: '#one', step_description: 'first' },
        { action: 'done', step_description: 'finished' }
      ]
    })

    await new AutomationOrchestrator(fakeSession(), claude).runChatGoal('s1', 'do a thing', observer)

    expect(steps).toHaveLength(1)
    expect(steps[0]?.threadTurns).toBeGreaterThan(0)
    expect(steps[0]?.stopReason).toBe('tool_use')
    expect(steps[0]?.thinking).toBe(true)
    expect(steps[0]?.staticLooks).toBe(0)
  })

  it('stores a fingerprint of the page, never the page', async () => {
    const { observer, steps } = recorder()
    const claude = fakeClaude({
      decisions: [
        { action: 'click', selector: '#one', step_description: 'first' },
        { action: 'done', step_description: 'finished' }
      ]
    })

    await new AutomationOrchestrator(fakeSession(), claude).runChatGoal('s1', 'do a thing', observer)

    const print = steps[0]?.pageFingerprint
    expect(print).toMatch(/^[0-9a-f]{12}$/)
    expect(print).not.toContain('<p>')
  })

  it('marks a step the page refused as failed rather than losing it', async () => {
    const { observer, steps } = recorder()
    const claude = fakeClaude({
      decisions: [
        { action: 'click', selector: '#gone', step_description: 'first' },
        { action: 'done', step_description: 'giving up' }
      ]
    })
    const browser = fakeSession({
      runStep: (action: ActionStep) => Promise.reject(new StepExecutionError(action, 'timed out waiting for #gone'))
    })

    await new AutomationOrchestrator(browser, claude).runChatGoal('s1', 'do a thing', observer)

    expect(steps[0]?.resolvedBy).toBe('failed')
  })
})

describe('a step that was repaired and failed anyway', () => {
  it('still records the retries, so the attempt is not lost with the success path', async () => {
    const { observer, steps, repairs } = recorder()
    const browser = fakeSession({
      runStep: (action: ActionStep) => Promise.reject(new StepExecutionError(action, 'timed out waiting for #go'))
    })
    const claude = fakeClaude({
      repairs: [
        { verdict: 'repair', actions: [{ action: 'click', selector: '#a', step_description: 'try a' }], reason: 'moved' },
        { verdict: 'repair', actions: [{ action: 'click', selector: '#b', step_description: 'try b' }], reason: 'moved again' }
      ]
    })

    await new AutomationOrchestrator(browser, claude).runRoutine(
      routine([{ kind: 'click', selector: '#go' }]),
      {},
      observer
    )

    expect(steps[0]?.resolvedBy).toBe('human')
    expect(steps[0]?.attempts).toBeGreaterThan(1)
    expect(repairs.length).toBeGreaterThan(0)
  })
})

describe('resuming a run part-way through', () => {
  const twelveClicks: ActionStep[] = Array.from({ length: 12 }, (_, index) => ({
    kind: 'click',
    selector: `#s${index}`
  }))

  function watching(overrides: Partial<AutomationSession> = {}): {
    browser: AutomationSession
    seen: ActionStep[]
  } {
    const seen: ActionStep[] = []
    const browser = fakeSession({
      runStep: (step, vars) => {
        seen.push(resolveStep(step, vars ?? {}))
        return Promise.resolve({})
      },
      ...overrides
    })
    return { browser, seen }
  }

  it('runs only the steps from the start index, reporting absolute indexes', async () => {
    const { observer, events } = recorder()
    const { browser, seen } = watching()

    await new AutomationOrchestrator(browser, fakeClaude()).runRoutine(routine(twelveClicks), {}, observer, {
      startIndex: 8,
      vars: {},
      repairsUsed: 0
    })

    expect(seen.map((step) => (step.kind === 'click' ? step.selector : step.kind))).toEqual([
      '#s8',
      '#s9',
      '#s10',
      '#s11'
    ])
    const running = events.filter((event) => event.status === 'running')
    expect(running.map((event) => event.stepIndex)).toEqual([8, 9, 10, 11])
    expect(running.every((event) => event.totalSteps === 12)).toBe(true)
  })

  it('reports a repair at its absolute index, so no proposal lands on the wrong step', async () => {
    const { observer, repairs } = recorder()
    const browser = fakeSession({
      runStep: (step) => {
        if (step.kind === 'click' && step.selector === '#s9') {
          return Promise.reject(new StepExecutionError(step, 'timed out waiting for #s9'))
        }
        return Promise.resolve({})
      }
    })
    const claude = fakeClaude({
      repairs: [
        {
          verdict: 'repair',
          actions: [{ action: 'click', selector: '#other', step_description: 'try the other one' }],
          reason: 'moved'
        }
      ]
    })

    await new AutomationOrchestrator(browser, claude).runRoutine(routine(twelveClicks), {}, observer, {
      startIndex: 8,
      vars: {},
      repairsUsed: 0
    })

    expect(repairs.map((repair) => repair.stepIndex)).toEqual([9])
  })

  it('seeds the variable bag from the params and the restored values together', async () => {
    const { browser, seen } = watching()

    await new AutomationOrchestrator(browser, fakeClaude()).runRoutine(
      routine([
        { kind: 'navigate', url: 'https://a.com' },
        { kind: 'type', selector: '#q', text: '{{total}}' },
        { kind: 'type', selector: '#w', text: '{{who}}' }
      ]),
      { who: 'ann' },
      SILENT,
      { startIndex: 1, vars: { total: '42' }, repairsUsed: 0 }
    )

    expect(seen).toEqual([
      { kind: 'navigate', url: 'https://a.com' },
      { kind: 'type', selector: '#q', text: '42' },
      { kind: 'type', selector: '#w', text: 'ann' }
    ])
  })

  const withSkippedNavigates: ActionStep[] = [
    { kind: 'navigate', url: '{{base}}/one' },
    { kind: 'click', selector: '#a' },
    { kind: 'type', selector: '#b', text: 'x' },
    { kind: 'extract', selector: 'main', into: 'v' },
    { kind: 'navigate', url: '{{base}}' },
    { kind: 'click', selector: '#go' }
  ]

  it('replays only the skipped navigates, in order and substituted', async () => {
    const extractText = vi.fn(() => Promise.resolve(''))
    const { browser, seen } = watching({ extractText })

    await new AutomationOrchestrator(browser, fakeClaude()).runRoutine(
      routine(withSkippedNavigates),
      {},
      SILENT,
      { startIndex: 5, vars: { base: 'https://a.com' }, repairsUsed: 0 }
    )

    expect(seen).toEqual([
      { kind: 'navigate', url: 'https://a.com/one' },
      { kind: 'navigate', url: 'https://a.com' },
      { kind: 'click', selector: '#go' }
    ])
    expect(extractText).not.toHaveBeenCalled()
  })

  it('retries a replayed navigate the user paused instead of ending the run', async () => {
    const { observer, events } = recorder()
    const seen: ActionStep[] = []
    let calls = 0
    const browser = fakeSession({
      runStep: (step, vars) => {
        calls++
        if (calls === 1) return Promise.reject(new RunPausedError('paused by the user'))
        seen.push(resolveStep(step, vars ?? {}))
        return Promise.resolve({})
      }
    })

    await new AutomationOrchestrator(browser, fakeClaude()).runRoutine(
      routine(withSkippedNavigates),
      {},
      observer,
      { startIndex: 5, vars: { base: 'https://a.com' }, repairsUsed: 0 }
    )

    expect(seen).toEqual([
      { kind: 'navigate', url: 'https://a.com/one' },
      { kind: 'navigate', url: 'https://a.com' },
      { kind: 'click', selector: '#go' }
    ])
    expect(events[events.length - 1]?.status).toBe('done')
    expect(events.some((event) => event.status === 'healing' && event.stepIndex === 0)).toBe(true)
  })

  it('files a step row for a replayed navigate and none at all for the rest of the skipped range', async () => {
    const { observer, steps } = recorder()
    const { browser } = watching()

    await new AutomationOrchestrator(browser, fakeClaude()).runRoutine(
      routine(withSkippedNavigates),
      {},
      observer,
      { startIndex: 5, vars: { base: 'https://a.com' }, repairsUsed: 0 }
    )

    expect(steps.map((step) => step.stepIndex)).toEqual([0, 4, 5])
    expect(steps[0]).toMatchObject({ kind: 'navigate', resolvedBy: 'resumed', attempts: 1, llmCalls: 0 })
    expect(steps[1]?.resolvedBy).toBe('resumed')
    expect(steps[2]?.resolvedBy).toBe('direct')
  })

  it('refuses when the page the replay left behind is not the page the run expects', async () => {
    const { observer, events } = recorder()
    const { browser, seen } = watching()

    await expect(
      new AutomationOrchestrator(browser, fakeClaude()).runRoutine(
        routine([
          { kind: 'navigate', url: 'https://b.com/x' },
          { kind: 'click', selector: '#go' }
        ]),
        {},
        observer,
        { startIndex: 1, vars: {}, repairsUsed: 0 }
      )
    ).rejects.toThrow(/https:\/\/b\.com\/x/)

    const terminal = events[events.length - 1]
    expect(terminal?.status).toBe('error')
    expect(terminal?.error).toMatch(/https:\/\/a\.com/)
    expect(seen.map((step) => step.kind)).toEqual(['navigate'])
  })

  it('accepts a page whose only difference is a trailing slash', async () => {
    const { browser, seen } = watching()

    await new AutomationOrchestrator(browser, fakeClaude()).runRoutine(
      routine([
        { kind: 'navigate', url: 'https://a.com/' },
        { kind: 'click', selector: '#go' }
      ]),
      {},
      SILENT,
      { startIndex: 1, vars: {}, repairsUsed: 0 }
    )

    expect(seen.map((step) => step.kind)).toEqual(['navigate', 'click'])
  })

  it('gives the healer what the chain has left rather than a fresh budget', async () => {
    const browser = fakeSession({
      runStep: (step) => Promise.reject(new StepExecutionError(step, 'timed out waiting for it'))
    })
    const claude = fakeClaude({
      repairs: Array.from({ length: 10 }, () => ({
        verdict: 'repair' as const,
        actions: [{ action: 'click', selector: '#other', step_description: 'try the other one' }],
        reason: 'moved'
      }))
    })

    await new AutomationOrchestrator(browser, claude).runRoutine(
      routine([
        { kind: 'click', selector: '#a' },
        { kind: 'click', selector: '#b' }
      ]),
      {},
      SILENT,
      { startIndex: 0, vars: {}, repairsUsed: 2 }
    )

    expect(claude.repairStep).toHaveBeenCalledTimes(4)
  })

  it('hands every step to a person once the chain has spent the whole budget', async () => {
    const holdForHuman = vi.fn(() => Promise.resolve())
    const browser = fakeSession({
      runStep: (step) => Promise.reject(new StepExecutionError(step, 'timed out waiting for it')),
      holdForHuman
    })
    const claude = fakeClaude()

    await new AutomationOrchestrator(browser, claude).runRoutine(
      routine([{ kind: 'click', selector: '#a' }]),
      {},
      SILENT,
      { startIndex: 0, vars: {}, repairsUsed: 6 }
    )

    expect(claude.repairStep).not.toHaveBeenCalled()
    expect(holdForHuman).toHaveBeenCalledTimes(1)
  })
})

describe('what a step record says about a committing page', () => {
  it('carries the page verdict through, and leaves it null when the page gave none', async () => {
    const { observer, steps } = recorder()
    const browser = fakeSession({
      runStep: (step) =>
        Promise.resolve(step.kind === 'click' && step.selector === '#pay' ? { changed: true, committing: true } : {})
    })

    await new AutomationOrchestrator(browser, fakeClaude()).runRoutine(
      routine([
        { kind: 'click', selector: '#pay' },
        { kind: 'click', selector: '#next' }
      ]),
      {},
      observer
    )

    expect(steps[0]?.committing).toBe(true)
    expect(steps[1]?.committing).toBeNull()
  })
})

describe('how a failed run classifies itself for the renderer', () => {
  async function terminalEvent(failure: Error): Promise<AutomationProgressEvent | undefined> {
    const { observer, events } = recorder()
    const browser = fakeSession({ runStep: () => Promise.reject(failure) })

    await expect(
      new AutomationOrchestrator(browser, fakeClaude()).runRoutine(
        routine([{ kind: 'click', selector: '#go' }]),
        {},
        observer
      )
    ).rejects.toThrow()

    return events[events.length - 1]
  }

  it('names a timed-out step indeterminate, because it may have run', async () => {
    const event = await terminalEvent(new StepIndeterminateError('click', 30_000))

    expect(event?.status).toBe('error')
    expect(event?.errorKind).toBe('indeterminate')
  })

  it('names the user pressing Stop, keeping the cancelled status it already had', async () => {
    const event = await terminalEvent(new RunCancelledError())

    expect(event?.status).toBe('cancelled')
    expect(event?.errorKind).toBe('cancelled')
  })

  it('names a failed assert, which is a verdict about the page rather than a broken step', async () => {
    const event = await terminalEvent(new AssertionFailedError('the total did not say 42'))

    expect(event?.status).toBe('error')
    expect(event?.errorKind).toBe('assertion')
  })

  it('leaves an ordinary failure unclassified rather than inventing a kind for it', async () => {
    const event = await terminalEvent(new Error('the socket died'))

    expect(event?.status).toBe('error')
    expect(event?.errorKind).toBeUndefined()
  })
})

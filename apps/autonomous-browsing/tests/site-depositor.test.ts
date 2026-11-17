import { describe, expect, it } from 'vitest'
import { AutomationOrchestrator, createDepositor } from '../src/main/automation/orchestrator'
import { RunCancelledError } from '../src/main/automation/session'
import type { AutomationSession } from '../src/main/automation/session'
import type { ClaudeAutomationClient } from '../src/main/automation/claude-client'
import type { ActionStep, RunObserver } from '../src/shared/types'
import type { LandmarkKind, SiteFact } from '../src/shared/site-memory'

const URL_A = 'https://example.com/a'
const URL_B = 'https://example.com/b'

function navigate(url: string): ActionStep {
  return { kind: 'navigate', url, intent: 'go there' }
}

function click(): ActionStep {
  return { kind: 'click', selector: '#go', intent: 'press go' }
}

function assertStep(): ActionStep {
  return { kind: 'assert', selector: '#go', expect: 'present', intent: 'check go' }
}

function screenshot(): ActionStep {
  return { kind: 'screenshot', label: 'a look', intent: 'take a look' }
}

interface Scored {
  origin: string
  kind: LandmarkKind
  factKey: string
  worked: boolean
}

function fakeObserver(): { observer: Required<RunObserver>; learned: SiteFact[]; scored: Scored[] } {
  const learned: SiteFact[] = []
  const scored: Scored[] = []
  const observer: Required<RunObserver> = {
    progress: () => {},
    artifact: () => {},
    repair: () => {},
    recorded: () => {},
    step: () => {},
    usage: () => {},
    learned: fact => learned.push(fact),
    scored: (origin, kind, factKey, worked) => scored.push({ origin, kind, factKey, worked })
  }
  return { observer, learned, scored }
}

describe('createDepositor', () => {
  it('records both the route and the control once a step on the route succeeds', () => {
    const { observer, learned } = fakeObserver()
    const deposit = createDepositor(observer)

    deposit(navigate(URL_A), 'direct', null, URL_A)
    expect(learned).toHaveLength(0)

    deposit(click(), 'direct', { changed: true }, URL_A)

    expect(learned.map(fact => fact.kind)).toEqual(['route', 'control'])
  })

  it('keeps an unconfirmed route alive across a failed step, confirming it only on a later success', () => {
    const { observer, learned } = fakeObserver()
    const deposit = createDepositor(observer)

    deposit(navigate(URL_A), 'direct', null, URL_A)
    deposit(click(), 'failed', null, URL_A)
    expect(learned).toHaveLength(0)

    deposit(click(), 'direct', { changed: true }, URL_A)

    expect(learned.map(fact => fact.kind)).toEqual(['route', 'control'])
  })

  it('never confirms a route from a screenshot or a wait, which prove nothing about the page being usable', () => {
    const { observer, learned } = fakeObserver()
    const deposit = createDepositor(observer)

    deposit(navigate(URL_A), 'direct', null, URL_A)
    deposit(screenshot(), 'direct', { value: 'aGk=' }, URL_A)
    deposit({ kind: 'wait', ms: 10, intent: 'let it settle' }, 'direct', {}, URL_A)
    expect(learned).toHaveLength(0)

    deposit(assertStep(), 'direct', {}, URL_A)

    expect(learned.map(fact => fact.kind)).toEqual(['route'])
  })

  it('confirms a route from an extract, which does exercise the page', () => {
    const { observer, learned } = fakeObserver()
    const deposit = createDepositor(observer)

    deposit(navigate(URL_A), 'direct', null, URL_A)
    deposit({ kind: 'extract', selector: 'main', into: 'body' }, 'direct', {}, URL_A)

    expect(learned.map(fact => fact.kind)).toEqual(['route'])
  })

  it('never confirms a route from a second navigate, only from an on-page step', () => {
    const { observer, learned } = fakeObserver()
    const deposit = createDepositor(observer)

    deposit(navigate(URL_A), 'direct', null, URL_A)
    deposit(navigate(URL_B), 'direct', null, URL_B)

    expect(learned).toHaveLength(0)
  })

  it('seeds no route when the navigate itself failed', () => {
    const { observer, learned } = fakeObserver()
    const deposit = createDepositor(observer)

    deposit(navigate(URL_A), 'failed', null, URL_A)
    deposit(click(), 'direct', { changed: true }, URL_A)

    expect(learned.map(fact => fact.kind)).toEqual(['control'])
  })

  it('records nothing for a control step that is still committing', () => {
    const { observer, learned } = fakeObserver()
    const deposit = createDepositor(observer)

    deposit(click(), 'direct', { changed: true, committing: true }, URL_A)

    expect(learned).toHaveLength(0)
  })

  it('records nothing for a control step the page did not react to', () => {
    const { observer, learned } = fakeObserver()
    const deposit = createDepositor(observer)

    deposit(click(), 'direct', { changed: false }, URL_A)

    expect(learned).toHaveLength(0)
  })

  it('records nothing for a step a human had to do', () => {
    const { observer, learned } = fakeObserver()
    const deposit = createDepositor(observer)

    deposit(click(), 'human', null, URL_A)

    expect(learned).toHaveLength(0)
  })

  it('records nothing for a resumed replay', () => {
    const { observer, learned } = fakeObserver()
    const deposit = createDepositor(observer)

    deposit(click(), 'resumed', null, URL_A)

    expect(learned).toHaveLength(0)
  })

  it('scores a failed click as a miss on the control', () => {
    const { observer, scored } = fakeObserver()
    const deposit = createDepositor(observer)

    deposit(click(), 'failed', null, URL_A)

    expect(scored).toEqual([{ origin: 'https://example.com', kind: 'control', factKey: '#go', worked: false }])
  })

  it('never scores a successful click, since observe already counted the hit', () => {
    const { observer, scored } = fakeObserver()
    const deposit = createDepositor(observer)

    deposit(click(), 'direct', { changed: true }, URL_A)

    expect(scored).toHaveLength(0)
  })

  it('never scores a failed assert, even though it carries a selector, since only control steps can own a landmark', () => {
    const { observer, scored } = fakeObserver()
    const deposit = createDepositor(observer)

    deposit(assertStep(), 'failed', null, URL_A)

    expect(scored).toHaveLength(0)
  })
})

function session(over: Partial<AutomationSession> = {}): AutomationSession {
  return {
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    snapshot: () => Promise.reject(new Error('a routine step never snapshots')),
    runStep: () => Promise.resolve({ changed: true }),
    extractText: () => Promise.resolve(''),
    holdForHuman: () => Promise.resolve(),
    currentUrl: () => URL_A,
    setRunContext: () => {},
    setHoldReporter: () => {},
    ...over
  }
}

const NO_CLAUDE = {} as ClaudeAutomationClient

function oneStep(step: ActionStep): Parameters<AutomationOrchestrator['runRoutine']>[0] {
  return { name: 'Test routine', description: null, definition: { steps: [step] } }
}

describe('runRoutine deposits', () => {
  it('files a navigating control under the origin it started on, not the one it landed on', async () => {
    const { observer, learned } = fakeObserver()
    let url = 'https://a.example/login'
    const browser = session({
      currentUrl: () => url,
      runStep: () => {
        url = 'https://b.example/home'
        return Promise.resolve({ changed: true })
      }
    })

    await new AutomationOrchestrator(browser, NO_CLAUDE).runRoutine(oneStep(click()), {}, observer)

    expect(learned).toHaveLength(1)
    expect(learned[0]).toMatchObject({ origin: 'https://a.example', kind: 'control', selector: '#go' })
  })

  it('scores no miss when the user pressed Stop, because a cancel is not a verdict on the selector', async () => {
    const { observer, scored, learned } = fakeObserver()
    const browser = session({ runStep: () => Promise.reject(new RunCancelledError()) })

    await expect(
      new AutomationOrchestrator(browser, NO_CLAUDE).runRoutine(oneStep(click()), {}, observer)
    ).rejects.toThrow(RunCancelledError)

    expect(scored).toHaveLength(0)
    expect(learned).toHaveLength(0)
  })

  it('still scores a miss when the step genuinely failed past repair', async () => {
    const { observer, scored } = fakeObserver()
    const browser = session({ runStep: () => Promise.reject(new Error('the page is gone')) })

    await expect(
      new AutomationOrchestrator(browser, NO_CLAUDE).runRoutine(oneStep(click()), {}, observer)
    ).rejects.toThrow('the page is gone')

    expect(scored).toEqual([{ origin: 'https://example.com', kind: 'control', factKey: '#go', worked: false }])
  })
})

import { EventEmitter } from 'node:events'
import fs, { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { ExtensionSession, stepTimeout } from '../src/main/automation/extension-session'
import { resolveStep } from '../src/shared/routines'
import {
  AssertionFailedError,
  isHealable,
  RunCancelledError,
  StepExecutionError
} from '../src/main/automation/session'
import {
  EXTENSION_VERSION,
  ExtensionBridge,
  type BridgeResult,
  type BridgeSnapshot
} from '../src/main/automation/extension-bridge'

// The extension re-scans the live page before every step, so a hold can repeat
// indefinitely on a page that keeps matching (a login form, say).
function sessionOver(results: BridgeResult[]): { session: ExtensionSession; attempts: () => number } {
  let index = 0
  const bridge = {
    isPaused: false,
    pausedBecause: null,
    waitWhileHeld: () => Promise.resolve(),
    runStep: () => Promise.resolve(results[Math.min(index++, results.length - 1)]!)
  }
  return { session: new ExtensionSession(bridge as unknown as ExtensionBridge), attempts: () => index }
}

describe('resolveStep', () => {
  it('fills params into the fields that carry user text', () => {
    const vars = { term: 'invoices', site: 'example.com', choice: 'eur' }

    expect(resolveStep({ kind: 'navigate', url: 'https://{{site}}/search' }, vars)).toEqual({
      kind: 'navigate',
      url: 'https://example.com/search'
    })
    expect(resolveStep({ kind: 'type', selector: '#q', text: '{{term}}' }, vars)).toEqual({
      kind: 'type',
      selector: '#q',
      text: 'invoices'
    })
    expect(resolveStep({ kind: 'select', selector: '#cur', value: '{{choice}}' }, vars)).toEqual({
      kind: 'select',
      selector: '#cur',
      value: 'eur'
    })
  })

  it('keeps flags that ride along with a resolved field', () => {
    expect(resolveStep({ kind: 'type', selector: '#q', text: '{{term}}', submit: true }, { term: 'hi' })).toEqual({
      kind: 'type',
      selector: '#q',
      text: 'hi',
      submit: true
    })
  })

  it('substitutes an unknown param with an empty string, matching BrowserSession', () => {
    expect(resolveStep({ kind: 'type', selector: '#q', text: 'a{{missing}}b' }, {})).toEqual({
      kind: 'type',
      selector: '#q',
      text: 'ab'
    })
  })

  it('leaves selectors alone so a {{...}} in a CSS selector is not eaten', () => {
    const step = { kind: 'click', selector: '#a' } as const
    expect(resolveStep(step, { a: 'x' })).toBe(step)
  })

  it('passes through steps that carry no user text', () => {
    expect(resolveStep({ kind: 'wait', ms: 500 }, {})).toEqual({ kind: 'wait', ms: 500 })
    expect(resolveStep({ kind: 'scroll', to: 'bottom' }, {})).toEqual({ kind: 'scroll', to: 'bottom' })
  })
})

describe('ExtensionSession hold handling', () => {
  const step = { kind: 'click', selector: '#pay' } as const

  it('retries a held step and continues once the extension lets it through', async () => {
    const { session, attempts } = sessionOver([
      { ok: false, held: true, error: 'password field detected' },
      { ok: true }
    ])

    await expect(session.runStep(step)).resolves.toEqual({})
    expect(attempts()).toBe(2)
  })

  it('gives up instead of looping forever when the page keeps holding', async () => {
    const { session, attempts } = sessionOver([{ ok: false, held: true, error: 'password field detected' }])

    await expect(session.runStep(step)).rejects.toThrow(/held this step 4 times.*password field detected/s)
    await expect(session.runStep(step)).rejects.toThrow(/complete it yourself in the browser/)
    expect(attempts()).toBe(8)
  })

  it('reports the hold once, however many times the page keeps holding', async () => {
    const { session, attempts } = sessionOver([
      { ok: false, held: true, error: 'a password field is on this page' },
      { ok: false, held: true, error: 'a password field is on this page' },
      { ok: true }
    ])
    const reasons: string[] = []
    session.setHoldReporter((reason) => reasons.push(reason))

    await expect(session.runStep(step)).resolves.toEqual({})
    expect(attempts()).toBe(3)
    expect(reasons).toEqual(['a password field is on this page'])
  })

  it('says nothing to a run that stopped listening for holds', async () => {
    const { session } = sessionOver([{ ok: false, held: true, error: 'a password field is on this page' }, { ok: true }])
    const reasons: string[] = []
    session.setHoldReporter((reason) => reasons.push(reason))
    session.setHoldReporter(null)

    await session.runStep(step)

    expect(reasons).toEqual([])
  })

  it('reports a genuine step failure without retrying it', async () => {
    const { session, attempts } = sessionOver([{ ok: false, error: 'no element matches "#pay"' }])

    await expect(session.runStep(step)).rejects.toThrow(/step "click" failed: no element matches/)
    expect(attempts()).toBe(1)
  })
})

describe('ExtensionSession while the run is paused', () => {
  const step = { kind: 'click', selector: 'li[role="menuitem"]:has-text("Event")' } as const

  function pausable(runStep: () => Promise<BridgeResult>): {
    session: ExtensionSession
    pause: (reason: string) => void
    resume: () => void
    steps: () => number
  } {
    let paused = false
    let reason: string | null = null
    let waiters: Array<() => void> = []
    let steps = 0
    const bridge = {
      get isPaused() {
        return paused
      },
      get pausedBecause() {
        return reason
      },
      waitWhileHeld: () =>
        paused ? new Promise<void>((resolve) => waiters.push(resolve)) : Promise.resolve(),
      runStep: () => {
        steps++
        return runStep()
      },
      snapshot: () =>
        Promise.resolve({
          url: 'https://calendar.google.com',
          title: 'Calendar',
          screenshot: '',
          screenshotError: null,
          dom: '<p>x</p>',
          domError: null
        })
    }
    return {
      session: new ExtensionSession(bridge as unknown as ExtensionBridge),
      pause: (why: string) => {
        paused = true
        reason = why
      },
      resume: () => {
        paused = false
        reason = null
        const held = waiters
        waiters = []
        for (const wake of held) wake()
      },
      steps: () => steps
    }
  }

  async function settled(promise: Promise<unknown>): Promise<boolean> {
    let done = false
    const mark = (): void => {
      done = true
    }
    void promise.then(mark, mark)
    await new Promise((resolve) => setTimeout(resolve, 0))
    return done
  }

  it('never runs a step decided before the pause, and says so once the run resumes', async () => {
    const harness = pausable(() => Promise.resolve({ ok: true }))
    harness.pause('paused by the user')

    const running = harness.session.runStep(step)
    expect(await settled(running)).toBe(false)

    harness.resume()
    await expect(running).rejects.toThrow(/paused by the user/)
    expect(harness.steps()).toBe(0)
  })

  it('blames the pause, not the step, when a pause cuts a step short', async () => {
    let harness: ReturnType<typeof pausable>
    harness = pausable(() => {
      harness.pause('paused by the user')
      return Promise.resolve({ ok: false, error: 'timed out waiting for li[role="menuitem"] — it is not visible' })
    })

    const running = harness.session.runStep(step)
    expect(await settled(running)).toBe(false)

    harness.resume()
    const error = await running.catch((thrown: unknown) => thrown)
    expect(String(error)).toMatch(/paused by the user/)
    expect(isHealable(error)).toBe(false)
  })

  it('waits for the resume before reading the page, so no decision comes from a paused page', async () => {
    const harness = pausable(() => Promise.resolve({ ok: true }))
    harness.pause('paused by the user')

    const reading = harness.session.snapshot()
    expect(await settled(reading)).toBe(false)

    harness.resume()
    await expect(reading).resolves.toMatchObject({ url: 'https://calendar.google.com' })
  })
})

// Both hold paths matter: main asks for one at layer 3, and the extension starts
// one by itself on a sensitive field.
describe('a hold names the run it interrupted', () => {
  function bridgeWithFakeSocket(): {
    bridge: ExtensionBridge
    holds: unknown[][]
    sent: string[]
    deliver: (message: object) => void
  } {
    const bridge = new ExtensionBridge()
    const sent: string[] = []
    const internals = bridge as unknown as {
      socket: { write: (line: string) => void }
      receive: (line: string) => void
    }
    internals.socket = {
      write: (line) => {
        sent.push(line)
      }
    }
    const holds: unknown[][] = []
    bridge.on('paused', (...args: unknown[]) => holds.push(args))
    return { bridge, holds, sent, deliver: (message) => internals.receive(JSON.stringify(message)) }
  }

  it('stamps the run and step onto a pause the app asked for, and tells the extension', () => {
    const { bridge, holds, sent } = bridgeWithFakeSocket()
    bridge.setRunContext({ runId: 'run-1', stepIndex: 3 })

    bridge.pause('step 4 needs you')

    expect(holds).toEqual([['step 4 needs you', false, { runId: 'run-1', stepIndex: 3 }]])
    expect(sent.map((line) => JSON.parse(line))).toEqual([{ type: 'pause', reason: 'step 4 needs you' }])
    expect(sent[0]?.endsWith('\n')).toBe(true)
  })

  it('stamps them onto a hold the extension started by itself', () => {
    const { bridge, holds, deliver } = bridgeWithFakeSocket()
    bridge.setRunContext({ runId: 'run-2', stepIndex: 0 })

    deliver({ type: 'paused', reason: 'a one-time-code field is on this page', auto: true })

    expect(holds).toEqual([['a one-time-code field is on this page', true, { runId: 'run-2', stepIndex: 0 }]])
  })

  it('reports no run when nothing is in flight', () => {
    const { holds, deliver } = bridgeWithFakeSocket()

    deliver({ type: 'paused', reason: 'a password field is on this page', auto: true })

    expect(holds).toEqual([['a password field is on this page', true, null]])
  })

  it('stops naming a run once the session says that run has ended', () => {
    const { bridge, holds, deliver } = bridgeWithFakeSocket()
    const session = new ExtensionSession(bridge)
    session.setRunContext({ runId: 'run-3', stepIndex: 1 })
    session.setRunContext(null)

    deliver({ type: 'paused', reason: 'a password field is on this page', auto: true })

    expect(holds).toEqual([['a password field is on this page', true, null]])
  })

  it('reassembles a hold that arrived in two socket chunks', () => {
    const bridge = new ExtensionBridge()
    const socket = new EventEmitter() as EventEmitter & { setEncoding: () => void; destroy: () => void }
    socket.setEncoding = () => {}
    socket.destroy = () => {}
    const holds: unknown[][] = []
    bridge.on('paused', (...args: unknown[]) => holds.push(args))
    ;(bridge as unknown as { adopt: (socket: unknown) => void }).adopt(socket)

    const line = `${JSON.stringify({ type: 'paused', reason: 'a one-time-code field is on this page', auto: true })}\n`
    socket.emit('data', line.slice(0, 20))
    expect(holds).toEqual([])
    socket.emit('data', line.slice(20))

    expect(holds).toEqual([['a one-time-code field is on this page', true, null]])
  })
})

describe('what unwinds a run parked at a hold', () => {
  function parked(): { bridge: ExtensionBridge; waiting: Promise<void> } {
    const bridge = new ExtensionBridge()
    const internals = bridge as unknown as { socket: { write: (line: string) => void; destroy: () => void } }
    internals.socket = { write: () => {}, destroy: () => {} }
    bridge.pause('step 1 needs you')
    return { bridge, waiting: bridge.waitWhileHeld() }
  }

  async function rejection(waiting: Promise<void>): Promise<unknown> {
    return waiting.catch((error: unknown) => error)
  }

  it('is a cancellation when the user cancels', async () => {
    const { bridge, waiting } = parked()

    bridge.cancel()

    expect(await rejection(waiting)).toBeInstanceOf(RunCancelledError)
  })

  it('announces the hold is over when a cancel clears it', async () => {
    const { bridge, waiting } = parked()
    let resumes = 0
    bridge.on('resumed', () => resumes++)

    bridge.cancel()

    await rejection(waiting)
    expect(resumes).toBe(1)
  })

  it('is not a cancellation when the tab, the socket or the app goes away', async () => {
    const tab = parked()
    ;(tab.bridge as unknown as { receive: (line: string) => void }).receive(JSON.stringify({ type: 'target-closed' }))
    const closedTab = await rejection(tab.waiting)
    expect(closedTab).not.toBeInstanceOf(RunCancelledError)
    expect(String(closedTab)).toMatch(/the automated tab was closed/)

    const quit = parked()
    const endpoint = vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    quit.bridge.close()
    endpoint.mockRestore()
    const closedApp = await rejection(quit.waiting)
    expect(closedApp).not.toBeInstanceOf(RunCancelledError)
    expect(String(closedApp)).toMatch(/the app closed/)
  })
})

describe('extension version handshake', () => {
  function sessionTalkingTo(version: string | null): ExtensionSession {
    const bridge = { start: () => Promise.resolve({ version }) }
    return new ExtensionSession(bridge as unknown as ExtensionBridge)
  }

  it('is the version the shipped manifest actually declares', () => {
    const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'))

    expect(manifest.version).toBe(EXTENSION_VERSION)
  })

  it('refuses to run against a stale extension rather than failing mid-goal', async () => {
    await expect(sessionTalkingTo('1.0.0').connect()).rejects.toThrow(/chrome:\/\/extensions/)
    await expect(sessionTalkingTo(null).connect()).rejects.toThrow(/reload/)
  })

  it('connects when the versions agree', async () => {
    await expect(sessionTalkingTo(EXTENSION_VERSION).connect()).resolves.toBeUndefined()
  })
})

describe('snapshot without a screenshot', () => {
  function sessionSeeing(snapshot: Partial<BridgeSnapshot>): ExtensionSession {
    const bridge = {
      waitWhileHeld: () => Promise.resolve(),
      snapshot: () => Promise.resolve({ url: 'https://a.com', title: 'A', screenshot: '', screenshotError: null, dom: '<p>hi</p>', ...snapshot })
    }
    return new ExtensionSession(bridge as unknown as ExtensionBridge)
  }

  it('keeps the run alive on an occluded window instead of failing the whole goal', async () => {
    const result = await sessionSeeing({ screenshotError: 'could not screenshot the tab: image readback failed' }).snapshot()

    expect(result.screenshotBase64).toBeNull()
    expect(result.dom).toContain('hi')
    expect(result.url).toBe('https://a.com')
  })

  it('carries the wall the page is behind, or a goal run has nothing to park on', async () => {
    const result = await sessionSeeing({ blockedBy: 'DataDome bot check' }).snapshot()

    expect(result.blockedBy).toBe('DataDome bot check')
  })

  it('starts on an unreadable chrome:// tab so the goal can navigate away from it', async () => {
    const session = sessionSeeing({
      url: 'chrome://extensions/',
      dom: '',
      domError: 'Cannot access a chrome:// URL'
    })

    const result = await session.snapshot()

    expect(result.domError).toMatch(/chrome:\/\//)
    expect(result.dom).toBe('')
  })

  it('never reports a current URL, even right after a snapshot', async () => {
    const session = sessionSeeing({})
    await session.snapshot()

    expect(session.currentUrl()).toBeNull()
  })
})

// Every budget must exceed the timer the extension runs for that same step, or
// the bridge times out first and reports an outcome it cannot actually know.
describe('stepTimeout', () => {
  it('covers a long wait rather than cutting it off at a fixed ceiling', () => {
    expect(stepTimeout({ kind: 'wait', ms: 45_000 })).toBeGreaterThan(45_000)
    expect(stepTimeout({ kind: 'wait', ms: 300_000 })).toBeGreaterThan(300_000)
  })

  it('leaves the extension room to report its own error on the slower kinds', () => {
    expect(stepTimeout({ kind: 'navigate', url: 'https://a.com' })).toBeGreaterThan(20_000)
    expect(stepTimeout({ kind: 'wait', forSelector: '#a' })).toBeGreaterThan(15_000)
    expect(stepTimeout({ kind: 'click', selector: '#a' })).toBeGreaterThan(10_000)
  })

  it('does not stretch a short wait to the length of the old fixed timeout', () => {
    expect(stepTimeout({ kind: 'wait', ms: 500 })).toBeLessThan(10_000)
  })
})

describe('a failed assertion is a verdict, not an errand', () => {
  // A repair would ask the model to make a failing check pass, and a hold
  // resolves on Resume with the run then reporting success.
  it('is never healable, so no repair can overrule it', () => {
    expect(isHealable(new AssertionFailedError('expected #done to be on the page'))).toBe(false)
  })

  it('is not a StepExecutionError, which is what keeps it out of the healer', () => {
    expect(new AssertionFailedError('x')).toBeInstanceOf(Error)
    expect(new AssertionFailedError('x')).not.toBeInstanceOf(StepExecutionError)
  })

  it('gives an absence check the grace window, not the full action budget', () => {
    const absent = stepTimeout({ kind: 'assert', selector: '#err', expect: 'absent' })
    const present = stepTimeout({ kind: 'assert', selector: '#ok' })
    expect(absent).toBeLessThan(present)
    expect(absent).toBeGreaterThan(1_000)
  })
})

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DryRunBlockedError, guardSession, runDryRun } from '../src/main/automation/dry-run'
import { writeDryRunReport } from '../src/main/dry-run-report'
import { AutomationOrchestrator, OrchestratorBusyError } from '../src/main/automation/orchestrator'
import type { ClaudeAutomationClient } from '../src/main/automation/claude-client'
import { AssertionFailedError, type AutomationSession, type PageSnapshot } from '../src/main/automation/session'
import { classifyStep, renderReportMarkdown, summarize, wouldDo } from '../src/shared/dry-run'
import type { ActionStep, StepOutput } from '../src/shared/types'

const ALL_KINDS: ActionStep[] = [
  { kind: 'navigate', url: 'https://shop.example/cart?token=secret#frag' },
  { kind: 'click', selector: '#buy', intent: 'Place the order' },
  { kind: 'type', selector: '#pw', text: 'hunter2-password', submit: true },
  { kind: 'select', selector: '#size', value: 'large' },
  { kind: 'wait', ms: 5000 },
  { kind: 'wait', forSelector: '#late' },
  { kind: 'scroll', to: 'bottom' },
  { kind: 'screenshot', label: 'cart' },
  { kind: 'extract', selector: '#total', into: 'total' },
  { kind: 'assert', selector: '#banner', expect: 'absent' }
]

const MUTATING_KINDS = ['navigate', 'click', 'type', 'select']

function snapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: 'https://shop.example/cart',
    title: 'Cart',
    screenshotBase64: 'AAEC',
    screenshotError: null,
    dom: '',
    domError: null,
    blockedBy: null,
    ...overrides
  }
}

class FakeSession implements AutomationSession {
  ran: ActionStep[] = []
  held = 0
  events: string[] = []
  missing = new Set<string>()
  frame: PageSnapshot = snapshot()

  async connect(): Promise<void> {
    this.events.push('connect')
  }
  async disconnect(): Promise<void> {
    this.events.push('disconnect')
  }
  async snapshot(): Promise<PageSnapshot> {
    return this.frame
  }
  currentUrl(): string | null {
    return null
  }
  async runStep(step: ActionStep): Promise<StepOutput> {
    this.ran.push(step)
    if (step.kind === 'assert' && this.missing.has(step.selector)) {
      throw new AssertionFailedError(`expected ${step.selector} to be on the page`)
    }
    return {}
  }
  async extractText(): Promise<string> {
    return ''
  }
  async holdForHuman(): Promise<void> {
    this.held++
  }
  setRunContext(): void {}
  setHoldReporter(): void {}
}

describe('classifyStep', () => {
  it('calls the five reading kinds read-only and the four acting kinds mutating', () => {
    for (const kind of ['screenshot', 'wait', 'scroll', 'extract', 'assert']) {
      expect(classifyStep({ kind })).toBe('read-only')
    }
    for (const kind of MUTATING_KINDS) expect(classifyStep({ kind })).toBe('mutating')
  })

  it('treats a kind it does not know as mutating', () => {
    expect(classifyStep({ kind: 'download' })).toBe('mutating')
    expect(classifyStep({ kind: '' })).toBe('mutating')
  })
})

describe('guardSession', () => {
  it('blocks every mutating kind and an unknown one without reaching the session', async () => {
    const session = new FakeSession()
    const guarded = guardSession(session)
    const steps = ALL_KINDS.filter((step) => MUTATING_KINDS.includes(step.kind))
    steps.push({ kind: 'download', url: 'x' } as unknown as ActionStep)

    for (const step of steps) {
      await expect(guarded.runStep(step)).rejects.toBeInstanceOf(DryRunBlockedError)
    }
    expect(session.ran).toEqual([])
  })

  it('lets a read-only step through and refuses to hand the run to a person', async () => {
    const session = new FakeSession()
    const guarded = guardSession(session)
    await guarded.runStep({ kind: 'assert', selector: '#a' })
    expect(session.ran).toHaveLength(1)
    await expect(guarded.holdForHuman('why')).rejects.toBeInstanceOf(DryRunBlockedError)
    expect(session.held).toBe(0)
  })
})

describe('runDryRun', () => {
  const routine = { name: 'Buy', definition: { steps: ALL_KINDS } }

  it('never gives the session a mutating step, only target lookups', async () => {
    const session = new FakeSession()
    await runDryRun(session, routine, {})
    expect(session.ran.every((step) => step.kind === 'assert')).toBe(true)
    expect(session.ran.map((step) => step.kind === 'assert' && step.expect)).toEqual(Array(6).fill('present'))
  })

  it('reports each step with its target, a frame, and whether it was skipped', async () => {
    const session = new FakeSession()
    session.missing.add('#buy')
    const report = await runDryRun(session, routine, {})

    expect(report.steps).toHaveLength(ALL_KINDS.length)
    const buy = report.steps[1]!
    expect(buy).toMatchObject({ skipped: true, targetFound: false, text: 'Place the order', frame: 'AAEC' })
    expect(buy.detail).toContain('#buy')
    expect(report.steps[0]).toMatchObject({ skipped: true, targetFound: null })
    expect(report.steps[7]).toMatchObject({ kind: 'screenshot', skipped: false, targetFound: null })
    expect(summarize(report)).toEqual({ total: 10, checked: 6, skipped: 4, found: 5, notFound: 1 })
  })

  it('explains an absent check from what the page shows now', async () => {
    const report = await runDryRun(new FakeSession(), routine, {})
    expect(report.steps[9]!.detail).toMatch(/would fail/)
  })

  it('keeps the reason when no screenshot could be taken', async () => {
    const session = new FakeSession()
    session.frame = snapshot({ screenshotBase64: null, screenshotError: 'tab is hidden' })
    const report = await runDryRun(session, { name: 'x', definition: { steps: [{ kind: 'click', selector: '#a' }] } }, {})
    expect(report.steps[0]).toMatchObject({ frame: null, frameNote: 'tab is hidden' })
  })

  it('lets an unknown kind through as a skipped step', async () => {
    const session = new FakeSession()
    const odd = { kind: 'download', url: 'x' } as unknown as ActionStep
    const report = await runDryRun(session, { name: 'x', definition: { steps: [odd] } }, {})
    expect(report.steps[0]).toMatchObject({ skipped: true, targetFound: null })
    expect(report.steps[0]!.wouldDo).toContain('"download"')
    expect(session.ran).toEqual([])
  })
})

describe('wouldDo', () => {
  it('leaves typed text, chosen values and URL queries out', () => {
    const lines = ALL_KINDS.map(wouldDo).join('\n')
    expect(lines).not.toContain('hunter2')
    expect(lines).not.toContain('large')
    expect(lines).not.toContain('secret')
    expect(lines).toContain('Type 16 characters into #pw and press Enter')
  })
})

describe('the report on disk', () => {
  it('writes markdown and one picture per step that has one', async () => {
    const session = new FakeSession()
    const report = await runDryRun(session, { name: 'Buy / now', definition: { steps: ALL_KINDS.slice(0, 2) } }, {})
    report.steps[1]!.frame = null
    report.steps[1]!.frameNote = 'tab is hidden'

    const root = await mkdtemp(path.join(os.tmpdir(), 'dry-run-'))
    try {
      const result = await writeDryRunReport(root, report)
      const dir = path.dirname(result.reportPath)
      expect(path.dirname(dir)).toBe(root)
      expect((await readdir(dir)).sort()).toEqual(['report.md', 'step-1.jpg'])
      expect([...(await readFile(path.join(dir, 'step-1.jpg')))]).toEqual([0, 1, 2])

      const markdown = await readFile(result.reportPath, 'utf8')
      expect(markdown).toContain('# Dry run: Buy / now')
      expect(markdown).toContain('![Step 1](step-1.jpg)')
      expect(markdown).toContain('No screenshot: tab is hidden')
      expect(markdown).toContain('Skipped, because it would change something')
      expect(markdown).toContain(`Summary: ${'2 steps. 2 skipped'}`)
      expect(result.summary.total).toBe(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('renders without frames', async () => {
    const report = await runDryRun(new FakeSession(), { name: 'x', definition: { steps: [ALL_KINDS[7]!] } }, {})
    expect(renderReportMarkdown(report, () => null)).toContain('No screenshot')
  })
})

describe('AutomationOrchestrator.dryRunRoutine', () => {
  const routine = { name: 'Buy', description: null, definition: { steps: ALL_KINDS } }

  it('connects, never acts, and disconnects', async () => {
    const session = new FakeSession()
    const orchestrator = new AutomationOrchestrator(session, {} as ClaudeAutomationClient)
    const report = await orchestrator.dryRunRoutine(routine, {})
    expect(report.steps).toHaveLength(ALL_KINDS.length)
    expect(session.events).toEqual(['connect', 'disconnect'])
    expect(session.ran.every((step) => step.kind === 'assert')).toBe(true)
  })

  it('refuses while another run is in progress, and frees itself after a failure', async () => {
    const session = new FakeSession()
    const orchestrator = new AutomationOrchestrator(session, {} as ClaudeAutomationClient)
    const first = orchestrator.dryRunRoutine(routine, {})
    await expect(orchestrator.dryRunRoutine(routine, {})).rejects.toBeInstanceOf(OrchestratorBusyError)
    await first

    session.snapshot = async () => {
      throw new Error('browser gone')
    }
    await expect(orchestrator.dryRunRoutine(routine, {})).rejects.toThrow('browser gone')
    session.snapshot = async () => snapshot()
    await expect(orchestrator.dryRunRoutine(routine, {})).resolves.toBeDefined()
  })
})

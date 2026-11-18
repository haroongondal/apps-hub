import { describe, expect, it } from 'vitest'
import { MAX_REPAIRS_PER_RUN, planResume, unresolvedTemplates } from '../src/shared/resume'
import type { ResumePlan, ResumePlanInput, ResumeRefusal } from '../src/shared/resume'
import { definitionHash } from '../src/shared/routine-hash'
import type { ActionStep } from '../src/shared/types'

const nav = (url: string): ActionStep => ({ kind: 'navigate', url })
const click = (selector: string): ActionStep => ({ kind: 'click', selector })
const extract = (selector: string, into: string): ActionStep => ({ kind: 'extract', selector, into })

const hash = (steps: ActionStep[]): string => definitionHash({ steps })

const STEPS: ActionStep[] = [
  nav('https://example.test/login'),
  { kind: 'type', selector: '#user', text: '{{user}}' },
  click('#sign-in'),
  nav('https://example.test/invoices'),
  extract('#total', 'total'),
  click('#open-{{value}}'),
  { kind: 'type', selector: '#amount', text: '{{total}}', submit: true },
  click('#confirm')
]

function plan(overrides: Partial<ResumePlanInput> = {}): ResumePlan | ResumeRefusal {
  return planResume({
    definition: { steps: STEPS },
    status: 'error',
    errorKind: null,
    failedStepIndex: 6,
    lastExecutedIndex: 6,
    params: { user: 'ada' },
    extracted: { total: '142.50' },
    resumeVars: null,
    resumeStartIndex: null,
    committingIndexes: [],
    repairs: [],
    recordedHash: null,
    chainRepairsUsed: 0,
    hash,
    ...overrides
  })
}

function refused(overrides: Partial<ResumePlanInput> = {}): ResumeRefusal {
  const result = plan(overrides)
  if (result.ok) throw new Error('expected a refusal, got a plan')
  return result
}

function accepted(overrides: Partial<ResumePlanInput> = {}): ResumePlan {
  const result = plan(overrides)
  if (!result.ok) throw new Error(`expected a plan, refused: ${result.message}`)
  return result
}

describe('the status gate', () => {
  it('refuses a done run, because there is nothing left to resume', () => {
    expect(refused({ status: 'done' }).gate).toBe('status')
  })

  it('refuses an assisted run — offering one is a deliberately open product question', () => {
    expect(refused({ status: 'assisted' }).gate).toBe('status')
  })

  it('refuses a cancelled run, because Cancel was a deliberate stop', () => {
    expect(refused({ status: 'cancelled' }).gate).toBe('status')
  })
})

describe('gate 1 — the start point', () => {
  it('defaults a determinate error to the failed step', () => {
    expect(accepted().startIndex).toBe(6)
  })

  it('refuses an indeterminate error with no default and a two-way choice, because the step may have run', () => {
    const result = refused({ errorKind: 'indeterminate' })
    expect(result.gate).toBe('start')
    expect(result.message).toContain('step 7')
    expect(result.message).toContain('Type into #amount')
    expect(result.choices).toEqual([
      { startIndex: 6, label: 'step 7 did not run — start there' },
      { startIndex: 7, label: 'step 7 already ran — start after it' }
    ])
  })

  it('proceeds once the operator has chosen an explicit start index', () => {
    expect(accepted({ errorKind: 'indeterminate', startIndex: 7 }).startIndex).toBe(7)
  })

  it('offers only "did not run" when the uncertain step is the last one, because there is nothing after it', () => {
    const result = refused({ errorKind: 'indeterminate', failedStepIndex: 7, lastExecutedIndex: 7 })
    expect(result.choices).toEqual([{ startIndex: 7, label: 'step 8 did not run — start there' }])
  })

  it('refuses a start index past the end, which would run nothing and file the run as done', () => {
    const result = refused({ startIndex: 999 })
    expect(result.gate).toBe('start')
    expect(result.message).toContain('there is no step 1000')
  })

  it('refuses an interrupted run that already executed its last step', () => {
    const result = refused({ status: 'interrupted', failedStepIndex: null, lastExecutedIndex: 7 })
    expect(result.gate).toBe('start')
    expect(result.message).toContain('nothing left to resume')
  })

  it('never rewinds below an ancestor start, because those steps already ran in the ancestor', () => {
    expect(accepted({ resumeStartIndex: 5, failedStepIndex: 0 }).startIndex).toBe(5)
    expect(accepted({ resumeStartIndex: 5, startIndex: 0 }).startIndex).toBe(5)
  })

  it('floors the two-way choice at the ancestor start too, so neither option re-runs a done step', () => {
    const result = refused({
      status: 'interrupted',
      failedStepIndex: null,
      lastExecutedIndex: 0,
      resumeStartIndex: 5
    })
    expect(result.choices).toEqual([
      { startIndex: 5, label: 'step 6 did not run — start there' },
      { startIndex: 6, label: 'step 6 already ran — start after it' }
    ])
  })

  it('treats an interrupted run the same, pivoting on the step after the last executed one', () => {
    const result = refused({ status: 'interrupted', failedStepIndex: null, lastExecutedIndex: 4 })
    expect(result.gate).toBe('start')
    expect(result.choices).toEqual([
      { startIndex: 5, label: 'step 6 did not run — start there' },
      { startIndex: 6, label: 'step 6 already ran — start after it' }
    ])
  })
})

describe('gate 2 — committing steps', () => {
  it('refuses with no override when a committing step sits in the re-executed range', () => {
    const result = refused({ committingIndexes: [6], startIndex: 6 })
    expect(result.gate).toBe('committing')
    expect(result.message).toContain('step 7')
    expect(result.choices).toBeUndefined()
  })

  it('ignores a committing step in the skipped range, which is never re-executed', () => {
    expect(accepted({ committingIndexes: [2], startIndex: 6 }).startIndex).toBe(6)
  })
})

describe('gate 4 — definition drift', () => {
  const recorded = hash(STEPS)

  it('skips the gate entirely when the source run recorded no hash', () => {
    expect(accepted({ recordedHash: null }).driftExplained).toBe(false)
  })

  it('passes when the routine hashes as it did at run time', () => {
    expect(accepted({ recordedHash: recorded }).driftExplained).toBe(false)
  })

  it('refuses a routine edited since the run, because the recorded evidence no longer describes it', () => {
    const edited = [...STEPS]
    edited[7] = click('#confirm-now')
    const result = refused({ definition: { steps: edited }, recordedHash: recorded })
    expect(result.gate).toBe('drift')
  })

  it("proceeds when the drift is exactly the run's own like-for-like repair — the routine already learned it", () => {
    const repaired = [...STEPS]
    repaired[7] = click('#confirm-now')
    const result = accepted({
      definition: { steps: repaired },
      recordedHash: recorded,
      repairs: [{ stepIndex: 7, original: click('#confirm'), replacement: [click('#confirm-now')] }]
    })
    expect(result.driftExplained).toBe(true)
  })

  it('refuses a hand edit at a repaired index, which a repair must not be allowed to explain away', () => {
    const edited = [...STEPS]
    edited[7] = click('#pay-now')
    const result = refused({
      definition: { steps: edited },
      recordedHash: recorded,
      repairs: [{ stepIndex: 7, original: click('#confirm'), replacement: [click('#confirm-now')] }]
    })
    expect(result.gate).toBe('drift')
  })

  it('does not let a multi-step repair explain drift, because accept could never have written one back', () => {
    const repaired = [...STEPS]
    repaired[7] = click('#confirm-now')
    const result = refused({
      definition: { steps: repaired },
      recordedHash: recorded,
      repairs: [
        { stepIndex: 7, original: click('#confirm'), replacement: [click('#cookies'), click('#confirm-now')] }
      ]
    })
    expect(result.gate).toBe('drift')
  })
})

describe('gate 5 — the variable bag', () => {
  it('refuses an unrestorable variable up front, because resolveStep would silently substitute nothing', () => {
    const result = refused({ extracted: {}, startIndex: 6 })
    expect(result.gate).toBe('vars')
    expect(result.message).toBe('"total" cannot be restored — step 7 needs it')
  })

  it('does not refuse a literal template inside a selector, which is never substituted', () => {
    expect(accepted({ startIndex: 5 }).startIndex).toBe(5)
  })

  it('trusts an extract earlier in the re-executed range, because the bag grows at runtime', () => {
    expect(accepted({ extracted: {}, startIndex: 4 }).startIndex).toBe(4)
  })

  it('refuses an unresolvable template in a skipped navigate, which will be replayed with substitution', () => {
    const steps = [...STEPS]
    steps[3] = nav('https://example.test/invoices/{{invoice}}')
    const result = refused({ definition: { steps }, startIndex: 6 })
    expect(result.gate).toBe('vars')
    expect(result.message).toBe('"invoice" cannot be restored — step 4 needs it')
  })

  it('counts an empty-string value as resolved — a held extract leaves the key missing, not empty', () => {
    expect(accepted({ extracted: { total: '' }, startIndex: 6 }).startIndex).toBe(6)
  })

  it('reads a missing key the same way on an interrupted run as on a failed one', () => {
    const result = refused({
      status: 'interrupted',
      failedStepIndex: null,
      extracted: {},
      startIndex: 6
    })
    expect(result.gate).toBe('vars')
    expect(result.message).toBe('"total" cannot be restored — step 7 needs it')
  })

  const slots: Array<[string, ActionStep]> = [
    ['navigate.url', nav('https://x.test/{{missing}}')],
    ['type.text', { kind: 'type', selector: '#f', text: '{{missing}}' }],
    ['select.value', { kind: 'select', selector: '#s', value: '{{missing}}' }],
    ['extract.selector', extract('#row-{{missing}}', 'row')],
    ['assert.containsText', { kind: 'assert', selector: '#done', containsText: '{{missing}}' }]
  ]

  for (const [slot, step] of slots) {
    it(`refuses and names the variable when ${slot} needs one the bag cannot supply`, () => {
      const result = refused({
        definition: { steps: [step] },
        params: {},
        extracted: {},
        startIndex: 0
      })
      expect(result.gate).toBe('vars')
      expect(result.message).toBe('"missing" cannot be restored — step 1 needs it')
    })
  }

  it('leaves a literal template in click.selector or type.selector alone, since neither is substituted', () => {
    const steps: ActionStep[] = [click('#open-{{value}}'), { kind: 'type', selector: '#f-{{value}}', text: 'x' }]
    expect(accepted({ definition: { steps }, params: {}, extracted: {}, startIndex: 0 }).startIndex).toBe(0)
  })
})

describe('unresolvedTemplates', () => {
  it('scans exactly the five substituting slots, selectors excluded except extract', () => {
    const steps: ActionStep[] = [
      nav('https://x.test/{{a}}'),
      { kind: 'type', selector: '#f-{{ignored}}', text: '{{b}}' },
      { kind: 'select', selector: '#s-{{ignored}}', value: '{{c}}' },
      extract('#row-{{d}}', 'value'),
      { kind: 'assert', selector: '#done-{{ignored}}', containsText: '{{e}}' }
    ]
    expect(unresolvedTemplates(steps, 0, {})).toEqual([
      { stepIndex: 0, name: 'a' },
      { stepIndex: 1, name: 'b' },
      { stepIndex: 2, name: 'c' },
      { stepIndex: 3, name: 'd' },
      { stepIndex: 4, name: 'e' }
    ])
  })

  it('scans only navigate urls in the skipped range, because only navigates are replayed', () => {
    const steps: ActionStep[] = [
      { kind: 'type', selector: '#q', text: '{{skippedText}}' },
      nav('https://x.test/{{replayed}}'),
      click('#go')
    ]
    expect(unresolvedTemplates(steps, 2, {})).toEqual([{ stepIndex: 1, name: 'replayed' }])
  })

  it('grows the bag from executed extracts, while a skipped extract supplies nothing', () => {
    const steps: ActionStep[] = [
      extract('#total', 'total'),
      { kind: 'type', selector: '#amount', text: '{{total}}' }
    ]
    expect(unresolvedTemplates(steps, 0, {})).toEqual([])
    expect(unresolvedTemplates(steps, 1, {})).toEqual([{ stepIndex: 1, name: 'total' }])
  })
})

describe('the plan', () => {
  it('merges the bag with extracted values winning over chain vars winning over params', () => {
    const result = accepted({
      params: { user: 'ada', total: 'from-params' },
      resumeVars: { total: 'from-chain', region: 'eu' },
      extracted: { total: '142.50' }
    })
    expect(result.vars).toEqual({ user: 'ada', region: 'eu', total: '142.50' })
  })

  it('carries the chain spend and its remaining budget', () => {
    const result = accepted({ chainRepairsUsed: 2 })
    expect(result.repairsUsed).toBe(2)
    expect(result.repairBudget).toBe(MAX_REPAIRS_PER_RUN - 2)
  })

  it('clamps the budget at zero so an exhausted chain is visible in the plan, never negative', () => {
    const result = accepted({ chainRepairsUsed: 6 })
    expect(result.repairsUsed).toBe(6)
    expect(result.repairBudget).toBe(0)
  })

  it('lists the skipped range, the navigates it will replay, and the submit-flagged type steps ahead', () => {
    const result = accepted({ startIndex: 6 })
    expect(result.skipped).toEqual([0, 1, 2, 3, 4, 5])
    expect(result.replayedNavigates).toEqual([0, 3])
    expect(result.submitFlags).toEqual([6])
  })
})

import { describe, expect, it } from 'vitest'
import {
  closingNote,
  extractedValues,
  screenshotsByStep,
  repairsByStep,
  stepMarks,
  stepTarget,
  threadRows
} from '../src/renderer/src/lib/run-model'
import type { RunDetail, RunEventRecord, RunStepOutcome, RunSummary } from '../src/shared/types'

function summary(over: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 'run-1',
    source: 'routine',
    routineId: 'sys.a',
    routineKind: 'system',
    routineName: 'Web health check',
    status: 'done',
    startedAt: 1000,
    endedAt: 4000,
    error: null,
    failedStepIndex: null,
    stepCount: 3,
    humanSteps: 0,
    openedAt: null,
    recordedSteps: null,
    stepOutcomes: ['ran', 'ran', 'ran'],
    rerunOf: null,
    resumedFromRunId: null,
    resumeStartIndex: null,
    errorKind: null,
    definitionHash: null,
    ...over
  }
}

function detail(over: Partial<RunDetail> = {}): RunDetail {
  return {
    ...summary(over),
    params: {},
    events: [],
    artifacts: [],
    repairs: [],
    steps: [],
    usage: {
      llmCalls: 0,
      repairCalls: 0,
      repairBudgetSpent: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      model: ''
    },
    resumeVars: null,
    ...over
  }
}

function event(over: Partial<RunEventRecord> = {}): RunEventRecord {
  return { seq: 0, status: 'running', stepIndex: 0, description: 'Navigate', step: null, error: null, at: 1, ...over }
}

describe('stepMarks', () => {
  it('maps each persisted step outcome to how it reads on the spine', () => {
    const outcomes: RunStepOutcome[] = ['ran', 'attention', 'failed', 'pending']
    expect(stepMarks(summary({ stepCount: 4, stepOutcomes: outcomes, status: 'error', endedAt: 4000 }))).toEqual([
      'clean',
      'attention',
      'failed',
      'pending'
    ])
  })

  it('marks the furthest reached step active only while the run is still open', () => {
    const open = summary({ endedAt: null, status: 'running', stepOutcomes: ['ran', 'ran', 'pending'] })
    expect(stepMarks(open)).toEqual(['clean', 'active', 'pending'])
    expect(stepMarks({ ...open, endedAt: 4000, status: 'done' })).toEqual(['clean', 'clean', 'pending'])
  })

  it('leaves a run that has not started a step alone', () => {
    const open = summary({ endedAt: null, status: 'running', stepOutcomes: ['pending', 'pending'], stepCount: 2 })
    expect(stepMarks(open)).toEqual(['pending', 'pending'])
  })
})

describe('threadRows', () => {
  it('describes a step from its event, and a step not yet reached from the routine', () => {
    const run = detail({
      endedAt: null,
      status: 'running',
      stepOutcomes: ['ran', 'pending', 'pending'],
      events: [event({ description: 'Navigate to https://a.com' })]
    })
    const rows = threadRows(run, ['Navigate to https://a.com', 'Click #go', 'Capture screenshot'])
    expect(rows.map((row) => row.description)).toEqual([
      'Navigate to https://a.com',
      'Click #go',
      'Capture screenshot'
    ])
    expect(rows[2]?.mark).toBe('pending')
  })

  it('falls back to "Not reached" when the routine is gone', () => {
    const run = detail({ stepOutcomes: ['pending', 'pending', 'pending'] })
    expect(threadRows(run, [])[1]?.description).toBe('Not reached')
  })

  it('keeps later events for the same step as notes under the first', () => {
    const run = detail({
      events: [
        event({ seq: 0, description: 'Click #go' }),
        event({ seq: 1, status: 'healing', description: 'Repairing step: moved' })
      ]
    })
    expect(threadRows(run, [])[0]?.notes).toEqual(['Repairing step: moved'])
  })

  it('never renders a terminal event as a step line', () => {
    const run = detail({
      stepCount: 1,
      stepOutcomes: ['ran'],
      events: [event({ seq: 0, description: 'Click #go' }), event({ seq: 1, status: 'done', description: 'Finished' })]
    })
    expect(threadRows(run, [])[0]?.notes).toEqual([])
  })
})

describe('closingNote', () => {
  it('keeps a goal run’s answer and drops a routine run’s "Finished"', () => {
    const goal = detail({
      source: 'chat',
      events: [event({ seq: 0, status: 'done', stepIndex: 2, description: 'The fare is £84' })]
    })
    const routine = detail({ events: [event({ seq: 0, status: 'done', stepIndex: 3, description: 'Finished' })] })
    expect(closingNote(goal)).toBe('The fare is £84')
    expect(closingNote(routine)).toBeNull()
  })

  it('reads a closing line off an assisted run too', () => {
    const assisted = detail({
      status: 'assisted',
      events: [event({ seq: 0, status: 'assisted', stepIndex: 3, description: 'Finished with your help' })]
    })
    expect(closingNote(assisted)).toBe('Finished with your help')
  })
})

describe('artifacts', () => {
  it('separates extracted text from screenshots, and groups images by step', () => {
    const run = detail({
      artifacts: [
        { id: 1, kind: 'extract', stepIndex: 1, label: 'total', text: '£12', hasImage: false },
        { id: 2, kind: 'screenshot', stepIndex: 2, label: 'end', text: null, hasImage: true },
        { id: 3, kind: 'screenshot', stepIndex: 2, label: 'also end', text: null, hasImage: true }
      ]
    })
    expect(extractedValues(run)).toEqual([['total', '£12']])
    expect(screenshotsByStep(run).get(2)?.map((a) => a.id)).toEqual([2, 3])
    expect(screenshotsByStep(run).has(1)).toBe(false)
  })
})

describe('screenshotsByStep', () => {
  it('keeps a screenshot that could not be taken, because the reason is the evidence', () => {
    const run = detail({
      artifacts: [
        { id: 4, kind: 'screenshot', stepIndex: 0, label: 'press go', text: 'the tab was not visible', hasImage: false }
      ]
    })
    expect(screenshotsByStep(run).get(0)?.[0]?.text).toBe('the tab was not visible')
  })
})

describe('repairsByStep', () => {
  it('groups repairs under the step they belong to', () => {
    const run = detail({
      repairs: [
        {
          stepIndex: 1,
          reason: 'moved',
          original: { kind: 'click', selector: '#a' },
          replacement: [{ kind: 'click', selector: '#b' }],
          at: 1
        }
      ]
    })
    expect(repairsByStep(run).get(1)?.length).toBe(1)
    expect(repairsByStep(run).has(0)).toBe(false)
  })
})

describe('stepTarget', () => {
  it('names the part of a step a repair actually changes', () => {
    expect(stepTarget({ kind: 'navigate', url: 'https://a.com' })).toBe('https://a.com')
    expect(stepTarget({ kind: 'click', selector: '#go' })).toBe('#go')
    expect(stepTarget({ kind: 'wait', ms: 500 })).toBe('500ms')
    expect(stepTarget({ kind: 'wait', forSelector: '.late' })).toBe('.late')
    expect(stepTarget({ kind: 'scroll', to: 'bottom' })).toBe('bottom')
    expect(stepTarget({ kind: 'screenshot' })).toBe('')
  })
})

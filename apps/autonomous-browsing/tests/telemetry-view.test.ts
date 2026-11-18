import { describe, expect, it } from 'vitest'
import { costLine, stepNote, timeSplit } from '../src/renderer/src/lib/telemetry-view'
import type { RunStepRecord, RunUsage } from '../src/shared/types'

function usage(over: Partial<RunUsage> = {}): RunUsage {
  return {
    llmCalls: 0,
    repairCalls: 0,
    repairBudgetSpent: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    model: 'anthropic/claude-sonnet-5',
    ...over
  }
}

function step(over: Partial<RunStepRecord> = {}): RunStepRecord {
  return {
    stepIndex: 0,
    kind: 'click',
    attempts: 1,
    resolvedBy: 'direct',
    changed: true,
    via: 'cdp',
    recovered: false,
    browserMs: 0,
    modelMs: 0,
    heldMs: 0,
    llmCalls: 0,
    startedAt: 0,
    endedAt: 0,
    staticLooks: null,
    threadTurns: null,
    stopReason: null,
    pageFingerprint: null,
    thinking: null,
    committing: null,
    ...over
  }
}

describe('what a run cost, in words', () => {
  it('says a healthy routine run cost nothing, because that is the claim worth showing', () => {
    expect(costLine(usage())).toBe('no model calls')
  })

  it('counts calls and tokens', () => {
    expect(costLine(usage({ llmCalls: 3, inputTokens: 900, outputTokens: 200 }))).toBe('3 model calls · 1.1k tokens')
  })

  it('adds the cached and cache-write input in, without pretending they are one number', () => {
    const line = costLine(usage({ llmCalls: 1, inputTokens: 100, cachedInputTokens: 50, cacheWriteTokens: 25 }))
    expect(line).toBe('1 model call · 175 tokens')
  })

  it('names the repairs separately, because a routine run that repaired is the interesting one', () => {
    expect(costLine(usage({ llmCalls: 2, repairCalls: 2, outputTokens: 10 }))).toBe(
      '2 model calls · 10 tokens · 2 repairs'
    )
  })

  it('shows budget spent with no call behind it, which is a dead socket rather than a repair', () => {
    expect(costLine(usage({ llmCalls: 0, repairCalls: 0, repairBudgetSpent: 2 }))).toBe(
      'no model calls · 2 of the repair budget spent with nothing to show for it'
    )
  })
})

describe('where a run spent its time', () => {
  it('says nothing when there is nothing measured', () => {
    expect(timeSplit([])).toBeNull()
  })

  it('splits the page, the model and the wait for a person', () => {
    expect(timeSplit([step({ browserMs: 8200, modelMs: 1400, heldMs: 12000 })])).toBe(
      '8.2s on the page · 1.4s thinking · 12s waiting for you'
    )
  })

  it('leaves out the parts that were zero', () => {
    expect(timeSplit([step({ browserMs: 3000 })])).toBe('3.0s on the page')
  })

  it('adds up across steps', () => {
    expect(timeSplit([step({ browserMs: 1000 }), step({ browserMs: 2000 })])).toBe('3.0s on the page')
  })
})

describe('what to say about one step', () => {
  it('says nothing about a step that just worked', () => {
    expect(stepNote(step())).toBeNull()
  })

  it('reports the layer-0 work that is otherwise invisible', () => {
    expect(stepNote(step({ resolvedBy: 'recovered' }))).toBe('the selector took a moment to resolve')
  })

  it('stays quiet where the repair callout already speaks', () => {
    expect(stepNote(step({ resolvedBy: 'repair' }))).toBeNull()
  })

  it('reports a no-op the healer waved through', () => {
    expect(stepNote(step({ resolvedBy: 'proceed', changed: false }))).toBe(
      'the page did not visibly react, and this was allowed to pass'
    )
  })

  it('credits the person who did it', () => {
    expect(stepNote(step({ resolvedBy: 'human' }))).toBe('you did this one')
  })
})

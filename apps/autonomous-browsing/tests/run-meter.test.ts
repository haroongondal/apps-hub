import { describe, expect, it } from 'vitest'
import { RunMeter, type ModelUsage } from '../src/main/automation/run-meter'

function usage(over: Partial<ModelUsage> = {}): ModelUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    ...over
  }
}

describe('counting what a run spent', () => {
  it('starts at zero and names the model it was built for', () => {
    const meter = new RunMeter('anthropic/claude-sonnet-5')
    expect(meter.totals()).toEqual({
      llmCalls: 0,
      repairCalls: 0,
      repairBudgetSpent: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      model: 'anthropic/claude-sonnet-5'
    })
  })

  it('counts a call the gateway reported no usage for, because it still happened', () => {
    const meter = new RunMeter('m')
    meter.record('decision', null)

    expect(meter.totals().llmCalls).toBe(1)
    expect(meter.totals().inputTokens).toBe(0)
  })

  it('separates repair calls from decision calls', () => {
    const meter = new RunMeter('m')
    meter.record('decision', usage())
    meter.record('decision', usage())
    meter.record('repair', usage())

    expect(meter.totals().llmCalls).toBe(3)
    expect(meter.totals().repairCalls).toBe(1)
  })

  it('keeps the three input families apart, because they are priced apart', () => {
    const meter = new RunMeter('m')
    meter.record('decision', usage({ input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 }))
    meter.record('repair', usage({ input_tokens: 1, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }))

    const totals = meter.totals()
    expect(totals.inputTokens).toBe(11)
    expect(totals.cachedInputTokens).toBe(8)
    expect(totals.cacheWriteTokens).toBe(6)
  })

  it('accumulates output tokens across every call', () => {
    const meter = new RunMeter('m')
    meter.record('decision', usage({ output_tokens: 40 }))
    meter.record('repair', usage({ output_tokens: 2 }))

    expect(meter.totals().outputTokens).toBe(42)
  })

  it('treats a missing token field as zero rather than NaN', () => {
    const meter = new RunMeter('m')
    meter.record('decision', { input_tokens: 7 })

    expect(meter.totals().inputTokens).toBe(7)
    expect(meter.totals().outputTokens).toBe(0)
    expect(meter.totals().cachedInputTokens).toBe(0)
  })

  // Budget is spent before the call, so a dead socket spends it with no call behind it.
  it('counts repair budget separately from repair calls', () => {
    const meter = new RunMeter('m')
    meter.spendRepairBudget()
    meter.spendRepairBudget()
    meter.record('repair', usage())

    expect(meter.totals().repairBudgetSpent).toBe(2)
    expect(meter.totals().repairCalls).toBe(1)
  })

  it('hands out a snapshot, not a live view of itself', () => {
    const meter = new RunMeter('m')
    const before = meter.totals()
    meter.record('decision', usage({ output_tokens: 9 }))

    expect(before.outputTokens).toBe(0)
    expect(meter.totals().outputTokens).toBe(9)
  })
})

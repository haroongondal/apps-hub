import type { RunUsage } from '../../shared/types'

// Structural, not the SDK's Usage, so the meter stays loadable without Anthropic types.
export interface ModelUsage {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

export type CallPurpose = 'decision' | 'repair'

export class RunMeter {
  private llmCalls = 0
  private repairCalls = 0
  private repairBudgetSpent = 0
  private inputTokens = 0
  private cachedInputTokens = 0
  private cacheWriteTokens = 0
  private outputTokens = 0

  constructor(private readonly model: string) {}

  record(purpose: CallPurpose, usage: ModelUsage | null): void {
    this.llmCalls++
    if (purpose === 'repair') this.repairCalls++
    if (!usage) return

    this.inputTokens += count(usage.input_tokens)
    this.cachedInputTokens += count(usage.cache_read_input_tokens)
    this.cacheWriteTokens += count(usage.cache_creation_input_tokens)
    this.outputTokens += count(usage.output_tokens)
  }

  spendRepairBudget(): void {
    this.repairBudgetSpent++
  }

  totals(): RunUsage {
    return {
      llmCalls: this.llmCalls,
      repairCalls: this.repairCalls,
      repairBudgetSpent: this.repairBudgetSpent,
      inputTokens: this.inputTokens,
      cachedInputTokens: this.cachedInputTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      outputTokens: this.outputTokens,
      model: this.model
    }
  }
}

function count(value: number | null | undefined): number {
  return typeof value === 'number' ? value : 0
}

import type { RunStepRecord, RunUsage } from '../../../shared/types'
import { plural } from './format'

export function costLine(usage: RunUsage): string {
  const parts = [usage.llmCalls === 0 ? 'no model calls' : plural(usage.llmCalls, 'model call')]

  const tokens = usage.inputTokens + usage.cachedInputTokens + usage.cacheWriteTokens + usage.outputTokens
  if (tokens > 0) parts.push(`${round(tokens)} tokens`)
  if (usage.repairCalls > 0) parts.push(plural(usage.repairCalls, 'repair'))

  const wasted = usage.repairBudgetSpent - usage.repairCalls
  if (wasted > 0) parts.push(`${wasted} of the repair budget spent with nothing to show for it`)

  return parts.join(' · ')
}

export function timeSplit(steps: RunStepRecord[]): string | null {
  const onPage = total(steps, (step) => step.browserMs)
  const thinking = total(steps, (step) => step.modelMs)
  const waiting = total(steps, (step) => step.heldMs)

  const parts: string[] = []
  if (onPage > 0) parts.push(`${seconds(onPage)} on the page`)
  if (thinking > 0) parts.push(`${seconds(thinking)} thinking`)
  if (waiting > 0) parts.push(`${seconds(waiting)} waiting for you`)

  return parts.length > 0 ? parts.join(' · ') : null
}

export function stepNote(step: RunStepRecord): string | null {
  if (step.resolvedBy === 'human') return 'you did this one'
  if (step.resolvedBy === 'proceed') {
    return step.changed === false
      ? 'the page did not visibly react, and this was allowed to pass'
      : 'the healer said to carry on'
  }
  if (step.resolvedBy === 'recovered') return 'the selector took a moment to resolve'
  if (step.changed === false) return 'the page did not visibly react'
  return null
}

function total(steps: RunStepRecord[], of: (step: RunStepRecord) => number): number {
  return steps.reduce((sum, step) => sum + of(step), 0)
}

function seconds(ms: number): string {
  const value = ms / 1000
  return value < 10 ? `${value.toFixed(1)}s` : `${Math.round(value)}s`
}

function round(tokens: number): string {
  return tokens < 1000 ? String(tokens) : `${(tokens / 1000).toFixed(1)}k`
}

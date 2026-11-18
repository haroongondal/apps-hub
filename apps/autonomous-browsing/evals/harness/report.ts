import fs from 'node:fs'
import path from 'node:path'
import type { TrialRecord } from './types'

const SONNET_PER_INPUT_TOKEN = 3 / 1_000_000
const SONNET_PER_OUTPUT_TOKEN = 15 / 1_000_000

export interface CaseSummary {
  suite: string
  caseId: string
  trials: number
  passes: number
  failures: string[]
}

export function summarise(records: TrialRecord[]): CaseSummary[] {
  const byCase = new Map<string, CaseSummary>()
  for (const record of records) {
    const key = `${record.suite}:${record.caseId}`
    const entry = byCase.get(key) ?? {
      suite: record.suite,
      caseId: record.caseId,
      trials: 0,
      passes: 0,
      failures: []
    }
    entry.trials++
    if (record.pass) entry.passes++
    else entry.failures.push(`trial ${record.trial}: ${record.reasons.join('; ')}`)
    byCase.set(key, entry)
  }
  return [...byCase.values()]
}

export function formatReport(records: TrialRecord[]): string {
  const lines: string[] = []
  const summaries = summarise(records)
  for (const suite of ['decisions', 'repairs', 'goals']) {
    const cases = summaries.filter(summary => summary.suite === suite)
    if (cases.length === 0) continue
    const trials = cases.reduce((n, c) => n + c.trials, 0)
    const passes = cases.reduce((n, c) => n + c.passes, 0)
    lines.push('', `${suite} — ${passes}/${trials} trials passed across ${cases.length} cases`)
    for (const entry of cases) {
      const mark = entry.passes === entry.trials ? '✓' : entry.passes === 0 ? '✗' : '~'
      lines.push(`  ${mark} ${entry.caseId.padEnd(28)} ${entry.passes}/${entry.trials}`)
      for (const failure of entry.failures) lines.push(`      ${failure}`)
    }
  }

  const inputTokens = records.reduce((n, r) => n + r.inputTokens, 0)
  const outputTokens = records.reduce((n, r) => n + r.outputTokens, 0)
  const calls = records.reduce((n, r) => n + r.modelCalls, 0)
  const cost = inputTokens * SONNET_PER_INPUT_TOKEN + outputTokens * SONNET_PER_OUTPUT_TOKEN
  lines.push(
    '',
    `${calls} model calls, ${inputTokens.toLocaleString()} input / ${outputTokens.toLocaleString()} output tokens` +
      (inputTokens > 0 ? ` (≈ $${cost.toFixed(2)} at list price; repair calls report no usage)` : '')
  )
  return lines.join('\n')
}

export function passRate(records: TrialRecord[]): number {
  if (records.length === 0) return 0
  return records.filter(record => record.pass).length / records.length
}

export function writeResults(resultsDir: string, payload: unknown): string {
  fs.mkdirSync(resultsDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(resultsDir, `${stamp}.json`)
  fs.writeFileSync(file, JSON.stringify(payload, null, 2))
  return file
}

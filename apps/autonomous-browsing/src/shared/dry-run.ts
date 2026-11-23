import type { ActionStep, DryRunSummary } from './types'

export type StepEffect = 'read-only' | 'mutating'

// Default-deny: a kind that is not listed here, including one added later, is skipped.
const READ_ONLY_KINDS: ReadonlySet<string> = new Set(['screenshot', 'wait', 'scroll', 'extract', 'assert'])

export function classifyStep(step: { kind: string }): StepEffect {
  return READ_ONLY_KINDS.has(step.kind) ? 'read-only' : 'mutating'
}

export function targetSelector(step: ActionStep): string | null {
  switch (step.kind) {
    case 'click':
    case 'type':
    case 'select':
    case 'extract':
    case 'assert':
      return step.selector
    case 'scroll':
      return step.selector ?? null
    case 'wait':
      return step.forSelector ?? null
    default:
      return null
  }
}

// Query strings and fragments often carry tokens, and a report is a file that gets shared.
function withoutQuery(url: string): string {
  return url.split(/[?#]/)[0] ?? url
}

// Typed text and chosen values never appear: a parameter may hold a password.
export function wouldDo(step: ActionStep): string {
  switch (step.kind) {
    case 'navigate':
      return `Open ${withoutQuery(step.url)}`
    case 'click':
      return `Click ${step.selector}`
    case 'type':
      return `Type ${step.text.length} characters into ${step.selector}${step.submit ? ' and press Enter' : ''}`
    case 'select':
      return `Choose an option in ${step.selector}`
    case 'wait':
      return step.forSelector ? `Wait for ${step.forSelector}` : `Wait ${step.ms ?? 0} ms`
    case 'scroll':
      return step.selector ? `Scroll ${step.selector} into view` : `Scroll to the ${step.to ?? 'bottom'}`
    case 'screenshot':
      return `Take a screenshot${step.label ? ` (${step.label})` : ''}`
    case 'extract':
      return `Read the text of ${step.selector} into ${step.into}`
    case 'assert':
      return step.expect === 'absent'
        ? `Check ${step.selector} is gone`
        : `Check ${step.selector} is there`
    default:
      return `Run a "${(step as { kind: string }).kind}" step, which this app does not recognise`
  }
}

export interface DryRunStep {
  index: number
  kind: string
  text: string
  wouldDo: string
  skipped: boolean
  targetFound: boolean | null
  detail: string | null
  frame: string | null
  frameNote: string | null
}

export interface DryRunReport {
  routineName: string
  startedAt: number
  steps: DryRunStep[]
}

export function summarize(report: DryRunReport): DryRunSummary {
  const { steps } = report
  const skipped = steps.filter((step) => step.skipped).length
  const found = steps.filter((step) => step.targetFound === true).length
  const notFound = steps.filter((step) => step.targetFound === false).length
  return { total: steps.length, checked: steps.length - skipped, skipped, found, notFound }
}

export function summaryLine(summary: DryRunSummary): string {
  const { total, skipped, found, notFound } = summary
  return `${total} steps. ${skipped} skipped because they would change something. ${found} targets found, ${notFound} not found.`
}

function targetLine(step: DryRunStep): string {
  if (step.targetFound === null) return 'Target: none to look for'
  const verdict = step.targetFound ? 'found' : 'not found'
  return step.detail ? `Target: ${verdict}. ${step.detail}` : `Target: ${verdict}`
}

function stepSection(step: DryRunStep, frameFile: string | null): string[] {
  const number = step.index + 1
  const status = step.skipped ? 'Skipped, because it would change something' : 'Checked, nothing changed'
  const picture = frameFile
    ? `![Step ${number}](${frameFile})`
    : `No screenshot${step.frameNote ? `: ${step.frameNote}` : ''}`
  return [
    `## Step ${number}: ${step.text}`,
    '',
    `- Would do: ${step.wouldDo}`,
    `- Status: ${status}`,
    `- ${targetLine(step)}`,
    '',
    picture,
    ''
  ]
}

export function renderReportMarkdown(report: DryRunReport, frameFile: (index: number) => string | null): string {
  const lines = [
    `# Dry run: ${report.routineName}`,
    '',
    `Run on ${new Date(report.startedAt).toISOString()}. Nothing was clicked, typed, sent, downloaded or saved.`,
    'The page is never changed, so each screenshot shows the page as it is now.',
    '',
    `Summary: ${summaryLine(summarize(report))}`,
    ''
  ]
  for (const step of report.steps) lines.push(...stepSection(step, frameFile(step.index)))
  return lines.join('\n')
}

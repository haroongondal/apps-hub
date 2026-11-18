import type {
  ActionStep,
  RunArtifactRecord,
  RunDetail,
  RunRepairRecord,
  RunStepOutcome,
  RunSummary
} from '../../../shared/types'

export type StepMark = 'pending' | 'active' | 'clean' | 'attention' | 'failed'

export interface ThreadRow {
  index: number
  mark: StepMark
  description: string
  notes: string[]
}

const FROM_OUTCOME: Record<RunStepOutcome, StepMark> = {
  pending: 'pending',
  ran: 'clean',
  attention: 'attention',
  failed: 'failed'
}

export function stepMarks(run: RunSummary): StepMark[] {
  const marks = run.stepOutcomes.map((outcome) => FROM_OUTCOME[outcome])
  if (run.endedAt !== null) return marks

  const active = lastTouched(marks)
  if (active >= 0) marks[active] = 'active'
  return marks
}

export function threadRows(run: RunDetail, plannedSteps: string[]): ThreadRow[] {
  const marks = stepMarks(run)
  const lines = new Map<number, string[]>()
  for (const event of run.events) {
    if (event.stepIndex < 0 || event.stepIndex >= marks.length) continue
    if (event.status === 'done' || event.status === 'assisted' || event.status === 'cancelled') continue
    const existing = lines.get(event.stepIndex) ?? []
    if (!existing.includes(event.description)) existing.push(event.description)
    lines.set(event.stepIndex, existing)
  }

  return marks.map((mark, index) => {
    const [description, ...notes] = lines.get(index) ?? []
    return { index, mark, description: description ?? plannedSteps[index] ?? 'Not reached', notes }
  })
}

export function closingNote(run: RunDetail): string | null {
  const last = run.events[run.events.length - 1]
  if (!last || (last.status !== 'done' && last.status !== 'assisted')) return null
  return last.description === 'Finished' ? null : last.description
}

export function extractedValues(run: RunDetail): [string, string][] {
  return run.artifacts
    .filter((artifact) => artifact.kind === 'extract')
    .map((artifact) => [artifact.label, artifact.text ?? ''])
}

// Includes the ones with no image: a screenshot that could not be taken is a
// fact about the run, and dropping it reads as a missing feature.
export function screenshotsByStep(run: RunDetail): Map<number, RunArtifactRecord[]> {
  const byStep = new Map<number, RunArtifactRecord[]>()
  for (const artifact of run.artifacts) {
    if (artifact.kind !== 'screenshot') continue
    const existing = byStep.get(artifact.stepIndex) ?? []
    existing.push(artifact)
    byStep.set(artifact.stepIndex, existing)
  }
  return byStep
}

export function repairsByStep(run: RunDetail): Map<number, RunRepairRecord[]> {
  const byStep = new Map<number, RunRepairRecord[]>()
  for (const repair of run.repairs) {
    const existing = byStep.get(repair.stepIndex) ?? []
    existing.push(repair)
    byStep.set(repair.stepIndex, existing)
  }
  return byStep
}

export function stepTarget(step: ActionStep): string {
  if (step.kind === 'navigate') return step.url
  if (step.kind === 'screenshot') return step.label ?? ''
  if (step.kind === 'wait') return step.forSelector ?? `${step.ms ?? 0}ms`
  if (step.kind === 'scroll') return step.selector ?? step.to ?? 'element'
  return step.selector
}

function lastTouched(marks: StepMark[]): number {
  for (let i = marks.length - 1; i >= 0; i--) {
    if (marks[i] !== 'pending') return i
  }
  return -1
}

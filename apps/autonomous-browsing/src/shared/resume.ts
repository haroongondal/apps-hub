import { describeStep, isLikeForLike } from './routines'
import type { ActionStep, RoutineDefinition, RunStatus } from './types'

export const MAX_REPAIRS_PER_RUN = 6

export interface ResumePlanInput {
  definition: RoutineDefinition
  status: RunStatus
  errorKind: string | null
  failedStepIndex: number | null
  lastExecutedIndex: number
  params: Record<string, string>
  extracted: Record<string, string>
  resumeVars: Record<string, string> | null
  resumeStartIndex: number | null
  committingIndexes: number[]
  repairs: Array<{ stepIndex: number; original: ActionStep; replacement: ActionStep[] }>
  recordedHash: string | null
  chainRepairsUsed: number
  hash: (steps: ActionStep[]) => string
  startIndex?: number
}

export interface ResumePlan {
  ok: true
  startIndex: number
  vars: Record<string, string>
  repairsUsed: number
  repairBudget: number
  skipped: number[]
  replayedNavigates: number[]
  submitFlags: number[]
  driftExplained: boolean
}

export interface ResumeRefusal {
  ok: false
  gate: 'status' | 'start' | 'committing' | 'drift' | 'vars'
  message: string
  choices?: Array<{ startIndex: number; label: string }>
}

export function unresolvedTemplates(
  steps: ActionStep[],
  startIndex: number,
  vars: Record<string, string>
): Array<{ stepIndex: number; name: string }> {
  const template = /\{\{(\w+)\}\}/g
  const known = new Set(Object.keys(vars))
  const missing: Array<{ stepIndex: number; name: string }> = []

  const scan = (stepIndex: number, text: string): void => {
    for (const [, name] of text.matchAll(template)) {
      if (name === undefined || known.has(name)) continue
      if (missing.some((entry) => entry.stepIndex === stepIndex && entry.name === name)) continue
      missing.push({ stepIndex, name })
    }
  }

  for (const [index, step] of steps.entries()) {
    if (index < startIndex) {
      if (step.kind === 'navigate') scan(index, step.url)
      continue
    }
    switch (step.kind) {
      case 'navigate':
        scan(index, step.url)
        break
      case 'type':
        scan(index, step.text)
        break
      case 'select':
        scan(index, step.value)
        break
      case 'extract':
        scan(index, step.selector)
        known.add(step.into)
        break
      case 'assert':
        if (step.containsText !== undefined) scan(index, step.containsText)
        break
    }
  }
  return missing
}

function resolveStart(input: ResumePlanInput, steps: ActionStep[]): number | ResumeRefusal {
  const alreadyRunInAncestor = input.resumeStartIndex ?? 0

  if (input.startIndex !== undefined) {
    if (input.startIndex >= steps.length) {
      return {
        ok: false,
        gate: 'start',
        message: `this automation has ${steps.length} steps, so there is no step ${input.startIndex + 1} to start at`
      }
    }
    return Math.max(alreadyRunInAncestor, input.startIndex)
  }

  const stoppedAt = input.status === 'interrupted' ? input.lastExecutedIndex + 1 : input.failedStepIndex
  if (stoppedAt === null) {
    return {
      ok: false,
      gate: 'start',
      message: 'this run did not record which step it stopped at — run it again from the start instead'
    }
  }

  const uncertainIndex = Math.max(alreadyRunInAncestor, stoppedAt)
  if (uncertainIndex >= steps.length) {
    return {
      ok: false,
      gate: 'start',
      message: 'that run reached the end of this automation — there is nothing left to resume'
    }
  }
  if (input.status === 'error' && input.errorKind !== 'indeterminate') return uncertainIndex

  const stepNumber = uncertainIndex + 1
  const step = steps[uncertainIndex]
  const described = step ? ` (${describeStep(step)})` : ''
  const choices = [{ startIndex: uncertainIndex, label: `step ${stepNumber} did not run — start there` }]
  if (uncertainIndex + 1 < steps.length) {
    choices.push({ startIndex: uncertainIndex + 1, label: `step ${stepNumber} already ran — start after it` })
  }
  return {
    ok: false,
    gate: 'start',
    message: `the run ended without knowing whether step ${stepNumber}${described} ran — choose where to start`,
    choices
  }
}

export function planResume(input: ResumePlanInput): ResumePlan | ResumeRefusal {
  if (input.status !== 'error' && input.status !== 'interrupted') {
    return { ok: false, gate: 'status', message: `a run that ended ${input.status} cannot be resumed` }
  }

  const steps = input.definition.steps
  const start = resolveStart(input, steps)
  if (typeof start !== 'number') return start

  const committing = input.committingIndexes.find((index) => index >= start)
  if (committing !== undefined) {
    return {
      ok: false,
      gate: 'committing',
      message: `step ${committing + 1} was reported by the page as committing — resuming would run it again`
    }
  }

  let driftExplained = false
  if (input.recordedHash !== null && input.hash(steps) !== input.recordedHash) {
    const atRunTime = [...steps]
    for (const repair of input.repairs) {
      if (!isLikeForLike({ ...repair, reason: '' })) continue
      const current = steps[repair.stepIndex]
      if (!current || input.hash([current]) !== input.hash(repair.replacement)) continue
      atRunTime[repair.stepIndex] = repair.original
    }
    if (input.hash(atRunTime) !== input.recordedHash) {
      return {
        ok: false,
        gate: 'drift',
        message: 'this automation has changed since that run — run it again from the start instead'
      }
    }
    driftExplained = true
  }

  const vars = { ...input.params, ...(input.resumeVars ?? {}), ...input.extracted }
  const [unresolved] = unresolvedTemplates(steps, start, vars)
  if (unresolved) {
    return {
      ok: false,
      gate: 'vars',
      message: `"${unresolved.name}" cannot be restored — step ${unresolved.stepIndex + 1} needs it`
    }
  }

  const skipped: number[] = []
  const replayedNavigates: number[] = []
  const submitFlags: number[] = []
  for (const [index, step] of steps.entries()) {
    if (index < start) {
      skipped.push(index)
      if (step.kind === 'navigate') replayedNavigates.push(index)
    } else if (step.kind === 'type' && step.submit === true) {
      submitFlags.push(index)
    }
  }

  return {
    ok: true,
    startIndex: start,
    vars,
    repairsUsed: input.chainRepairsUsed,
    repairBudget: Math.max(0, MAX_REPAIRS_PER_RUN - input.chainRepairsUsed),
    skipped,
    replayedNavigates,
    submitFlags,
    driftExplained
  }
}

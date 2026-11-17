import type { RunStatus } from '../../../shared/types'

const LABELS: Record<RunStatus, string> = {
  running: 'Running',
  held: 'Needs you',
  done: 'Done',
  assisted: 'Done with help',
  error: 'Failed',
  cancelled: 'Stopped',
  interrupted: 'Interrupted'
}

const TONES: Record<RunStatus, string> = {
  running: 'var(--machine)',
  held: 'var(--human)',
  done: 'var(--ok)',
  assisted: 'var(--human)',
  error: 'var(--fault)',
  cancelled: 'var(--text-3)',
  interrupted: 'var(--text-3)'
}

export function outcomeLabel(status: RunStatus): string {
  return LABELS[status]
}

export function humanStepNote(humanSteps: number): string | null {
  return humanSteps > 0 ? `you did ${humanSteps === 1 ? '1 step' : `${humanSteps} steps`}` : null
}

export function outcomeTone(status: RunStatus): string {
  return TONES[status]
}

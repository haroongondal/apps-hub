import type { QueueEntry, QueueEntryState, QueueSnapshot, QueueWork } from '../../../shared/types'
import { plural } from './format'

export interface ControlState {
  canStart: boolean
  showStop: boolean
}

const LABELS: Record<QueueEntryState, string> = {
  waiting: 'Waiting',
  'waiting-for-extension': 'Waiting for Chrome',
  announcing: 'Starting shortly',
  running: 'Running',
  held: 'Needs you'
}

const TONES: Record<QueueEntryState, string> = {
  waiting: 'var(--text-3)',
  'waiting-for-extension': 'var(--human)',
  announcing: 'var(--human)',
  running: 'var(--machine)',
  held: 'var(--human)'
}

export function queueRunning(snapshot: QueueSnapshot): boolean {
  const head = snapshot.entries[0]
  if (!head) return false
  return head.state === 'running' || head.state === 'held'
}

export function queueWaiting(snapshot: QueueSnapshot): QueueEntry[] {
  return snapshot.entries.filter((entry) => entry.state !== 'running' && entry.state !== 'held')
}

export function queueStateLabel(state: QueueEntryState): string {
  return LABELS[state]
}

export function queueStateTone(state: QueueEntryState): string {
  return TONES[state]
}

export function controlState(snapshot: QueueSnapshot): ControlState {
  return {
    canStart: !snapshot.full,
    showStop: queueRunning(snapshot)
  }
}

// A waiting entry carries no runId and no name, so the rail resolves one itself.
export function workLabel(work: QueueWork, names: Map<string, string>): string {
  if (work.kind === 'lease') return work.label
  if (work.kind === 'chat') return work.input.goal
  const name = names.get(work.target.id) ?? work.target.id
  if (!work.resume) return name
  return `${name} — resumed from step ${work.resume.startIndex + 1}`
}

export function queuedBehindHint(snapshot: QueueSnapshot): string | null {
  const waiting = queueWaiting(snapshot).length
  if (waiting === 0) return null
  return `This will be queued behind ${plural(waiting, 'request')}.`
}

export function queueDepth(snapshot: QueueSnapshot): number {
  return queueWaiting(snapshot).length
}

export function runningEntry(snapshot: QueueSnapshot): QueueEntry | null {
  const head = snapshot.entries[0]
  if (!head) return null
  return head.state === 'running' || head.state === 'held' ? head : null
}

import type { QueueSnapshot } from '../../../shared/types'
import { queueDepth } from './queue-view'

export type View =
  | { kind: 'run' }
  | { kind: 'queue' }
  | { kind: 'repairs'; routineId: string | null }
  | { kind: 'files' }
  | { kind: 'health' }
  | { kind: 'sites' }

export const DEFAULT_VIEW: View = { kind: 'run' }

// The tab is the only way back to a queue you are reading, so it must survive the queue draining.
export function showQueueTab(snapshot: QueueSnapshot, view: View): boolean {
  if (view.kind === 'queue') return true
  return queueDepth(snapshot) > 0 || snapshot.suspended
}

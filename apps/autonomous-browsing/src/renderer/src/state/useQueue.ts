import { useCallback, useEffect, useState } from 'react'
import type { QueueSnapshot } from '../../../shared/types'

export interface QueueState {
  snapshot: QueueSnapshot
  cancel: (id: string) => void
  clear: () => void
  start: () => void
}

const EMPTY: QueueSnapshot = { entries: [], recent: [], suspended: false, full: false }

export function useQueue(): QueueState {
  const [snapshot, setSnapshot] = useState<QueueSnapshot>(EMPTY)

  // A window that opens while the queue is busy has received no push yet.
  useEffect(() => {
    window.api.queue.list().then(setSnapshot, () => setSnapshot(EMPTY))
    return window.api.queue.onChanged(setSnapshot)
  }, [])

  return {
    snapshot,
    cancel: useCallback((id: string) => void window.api.queue.cancel(id), []),
    clear: useCallback(() => void window.api.queue.clear(), []),
    start: useCallback(() => void window.api.queue.start(), [])
  }
}

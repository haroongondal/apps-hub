import { describe, expect, it } from 'vitest'
import { queueDepth, runningEntry } from '../src/renderer/src/lib/queue-view'
import { DEFAULT_VIEW, showQueueTab, type View } from '../src/renderer/src/lib/view'
import type { QueueEntry, QueueEntryState, QueueSnapshot } from '../src/shared/types'

function entry(id: string, state: QueueEntryState): QueueEntry {
  return {
    id,
    priority: 'interactive',
    state,
    work: { kind: 'routine', target: { kind: 'user', id } },
    enqueuedAt: 1000,
    startedAt: null,
    announceUntil: null,
    dedupeKey: null
  }
}

function snapshot(states: QueueEntryState[], over: Partial<QueueSnapshot> = {}): QueueSnapshot {
  return {
    entries: states.map((state, at) => entry(`e${at}`, state)),
    recent: [],
    suspended: false,
    full: false,
    ...over
  }
}

const RUN: View = { kind: 'run' }
const QUEUE: View = { kind: 'queue' }

describe('which surface the app opens on', () => {
  it('starts on the run thread, so an existing install looks unchanged', () => {
    expect(DEFAULT_VIEW).toEqual({ kind: 'run' })
  })
})

describe('offering the queue tab', () => {
  it('stays hidden while there is nothing queued, so an idle app grows no chrome', () => {
    expect(showQueueTab(snapshot([]), RUN)).toBe(false)
    expect(showQueueTab(snapshot(['running']), RUN)).toBe(false)
  })

  it('appears once something is waiting', () => {
    expect(showQueueTab(snapshot(['running', 'waiting']), RUN)).toBe(true)
    expect(showQueueTab(snapshot(['waiting-for-extension']), RUN)).toBe(true)
  })

  it('appears for a suspended queue even with nothing waiting, because only a person clears it', () => {
    expect(showQueueTab(snapshot([], { suspended: true }), RUN)).toBe(true)
  })

  it('survives the queue draining under the reader, or the pane has no way back', () => {
    expect(showQueueTab(snapshot([]), QUEUE)).toBe(true)
    expect(showQueueTab(snapshot(['running']), QUEUE)).toBe(true)
  })
})

describe('splitting the running entry from the waiting ones', () => {
  it('counts only what is waiting, so the tab badge never counts the live run', () => {
    expect(queueDepth(snapshot(['running', 'waiting', 'waiting']))).toBe(2)
    expect(queueDepth(snapshot(['running']))).toBe(0)
    expect(queueDepth(snapshot(['held']))).toBe(0)
  })

  it('reports a held head as the running entry, since it still owns the browser', () => {
    expect(runningEntry(snapshot(['held', 'waiting']))?.id).toBe('e0')
    expect(runningEntry(snapshot(['running']))?.id).toBe('e0')
  })

  it('reports no running entry when the head is merely waiting', () => {
    expect(runningEntry(snapshot(['waiting', 'waiting']))).toBeNull()
    expect(runningEntry(snapshot([]))).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import {
  controlState,
  queueRunning,
  queueStateLabel,
  queueWaiting,
  queuedBehindHint,
  workLabel
} from '../src/renderer/src/lib/queue-view'
import type { QueueEntry, QueueEntryState, QueueSnapshot, QueueWork } from '../src/shared/types'

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

describe('reading a queue snapshot', () => {
  it('treats a held head as still occupying the slot', () => {
    expect(queueRunning(snapshot(['held', 'waiting']))).toBe(true)
    expect(queueRunning(snapshot(['running']))).toBe(true)
    expect(queueRunning(snapshot([]))).toBe(false)
    expect(queueRunning(snapshot(['waiting']))).toBe(false)
  })

  it('counts only the entries that have not taken the slot as waiting', () => {
    const waiting = queueWaiting(snapshot(['held', 'waiting', 'waiting-for-extension', 'announcing']))
    expect(waiting.map((candidate) => candidate.state)).toEqual(['waiting', 'waiting-for-extension', 'announcing'])
  })

  it('names every entry state', () => {
    expect(queueStateLabel('waiting-for-extension')).toBe('Waiting for Chrome')
    expect(queueStateLabel('held')).toBe('Needs you')
  })
})

describe('the controls a snapshot implies', () => {
  it('offers Stop only while something holds the slot', () => {
    expect(controlState(snapshot(['running'])).showStop).toBe(true)
    expect(controlState(snapshot(['waiting'])).showStop).toBe(false)
  })

  it('keeps Run and Send alive behind a running entry and closes them only at the cap', () => {
    expect(controlState(snapshot(['running', 'waiting'])).canStart).toBe(true)
    expect(controlState(snapshot(['running'], { full: true })).canStart).toBe(false)
  })
})

describe('the composer hint', () => {
  it('says how many requests a new goal would wait behind', () => {
    expect(queuedBehindHint(snapshot(['running']))).toBeNull()
    expect(queuedBehindHint(snapshot(['running', 'waiting']))).toBe('This will be queued behind 1 request.')
    expect(queuedBehindHint(snapshot(['running', 'waiting', 'waiting']))).toBe(
      'This will be queued behind 2 requests.'
    )
  })
})

describe('labelling queued work', () => {
  it('resolves a routine id to its name, and falls back to the id', () => {
    const names = new Map([['known', 'Weekly invoice pull']])
    expect(workLabel({ kind: 'routine', target: { kind: 'user', id: 'known' } }, names)).toBe('Weekly invoice pull')
    expect(workLabel({ kind: 'routine', target: { kind: 'user', id: 'gone' } }, names)).toBe('gone')
    expect(workLabel({ kind: 'chat', input: { sessionId: 's', goal: 'find a flight' } }, names)).toBe('find a flight')
    expect(workLabel({ kind: 'lease', label: 'debug session' }, names)).toBe('debug session')
  })

  it('names a resumed routine apart from a fresh run of the same automation', () => {
    const names = new Map([['known', 'Weekly invoice pull']])
    const fresh: QueueWork = { kind: 'routine', target: { kind: 'user', id: 'known' } }
    const resumed: QueueWork = {
      kind: 'routine',
      target: { kind: 'user', id: 'known' },
      resume: { fromRunId: 'r1', startIndex: 8 }
    }

    expect(workLabel(fresh, names)).toBe('Weekly invoice pull')
    expect(workLabel(resumed, names)).toBe('Weekly invoice pull — resumed from step 9')
    expect(
      workLabel(
        { kind: 'routine', target: { kind: 'user', id: 'gone' }, resume: { fromRunId: 'r1', startIndex: 0 } },
        names
      )
    ).toBe('gone — resumed from step 1')
  })
})

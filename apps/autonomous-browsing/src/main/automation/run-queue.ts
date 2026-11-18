import { randomUUID } from 'node:crypto'
import type {
  QueueDisposition,
  QueueDrop,
  QueueEntry,
  QueueEntryState,
  QueuePriority,
  QueueSnapshot,
  QueueWork
} from '../../shared/types'
import { OrchestratorBusyError } from './orchestrator'
import type { SessionControl } from './session-control'

export const MAX_WAITING = 50
export const EXTENSION_CONNECT_TIMEOUT_MS = 300_000
export const ANNOUNCE_MS = 10_000

const RECENT_KEPT = 5

export class QueueFullError extends Error {
  constructor() {
    super(`the run queue is full (${MAX_WAITING} waiting) — cancel something or wait for it to drain`)
  }
}

export class QueueSupersededError extends Error {
  constructor() {
    super('a newer request took the place of this one before it started')
  }
}

export interface EnqueueOptions {
  priority: QueuePriority
  dedupeKey?: string
}

export interface RunQueueDeps {
  control: SessionControl
  onChanged: (snapshot: QueueSnapshot) => void
  onDropped: (work: QueueWork, disposition: QueueDisposition, message: string) => void
}

interface Entry extends QueueEntry {
  run: () => Promise<unknown>
  settle: (value: unknown) => void
  fail: (error: Error) => void
  announced: boolean
  timer: NodeJS.Timeout | null
}

const NO_DISPOSITIONS: Record<QueueDisposition, number> = {
  started: 0,
  'cancelled-by-user': 0,
  superseded: 0,
  'refused-queue-full': 0,
  'expired-no-extension': 0,
  'dropped-app-quit': 0
}

export class RunQueue {
  private current: Entry | null = null
  private waiting: Entry[] = []
  private recent: QueueDrop[] = []
  private suspended = false
  private closing = false
  private invariantViolations = 0
  private readonly counts: Record<QueueDisposition, number> = { ...NO_DISPOSITIONS }

  constructor(private readonly deps: RunQueueDeps) {
    deps.control.on('connected', () => this.pump())
    deps.control.on('paused', () => this.markCurrent('held'))
    deps.control.on('resumed', () => {
      this.markCurrent('running')
      this.pump()
    })
  }

  enqueue<T>(work: QueueWork, options: EnqueueOptions, run: () => Promise<T>): Promise<T> {
    if (this.waiting.length >= MAX_WAITING) {
      this.count('refused-queue-full')
      throw new QueueFullError()
    }

    return new Promise<T>((resolve, reject) => {
      const entry: Entry = {
        id: randomUUID(),
        priority: options.priority,
        state: 'waiting',
        work,
        enqueuedAt: Date.now(),
        startedAt: null,
        announceUntil: null,
        dedupeKey: options.dedupeKey ?? null,
        // A thunk throwing synchronously must reject its entry, not escape pump().
        run: () => Promise.resolve().then(run),
        settle: (value) => resolve(value as T),
        fail: reject,
        announced: false,
        timer: null
      }

      const replaced = entry.dedupeKey === null ? -1 : this.supersede(entry.dedupeKey)
      if (replaced >= 0) this.insertAt(entry, replaced)
      else this.insert(entry)

      this.emitChanged()
      this.pump()
    })
  }

  cancelEntry(id: string): boolean {
    const entry = this.waiting.find((candidate) => candidate.id === id)
    if (!entry) return false
    this.discard(entry, 'cancelled-by-user', new Error('this entry was cancelled before it started'))
    this.emitChanged()
    this.pump()
    return true
  }

  // Suspending guards the entries behind the stopped run; with none, Start has nothing to dispatch.
  cancelRunning(): void {
    if (this.deps.control.isPaused && this.waiting.length > 0) this.suspended = true
    this.deps.control.cancel()
    this.emitChanged()
  }

  clearWaiting(): number {
    const dropped = [...this.waiting]
    for (const entry of dropped) {
      this.discard(entry, 'cancelled-by-user', new Error('the queue was cleared before this entry started'))
    }
    this.emitChanged()
    return dropped.length
  }

  start(): void {
    this.suspended = false
    this.emitChanged()
    this.pump()
  }

  drain(reason: string): void {
    this.closing = true
    for (const entry of [...this.waiting]) this.discard(entry, 'dropped-app-quit', new Error(reason))
    const tally = { ...this.counts, invariantViolations: this.invariantViolations }
    console.log('[queue] dispositions this session:', JSON.stringify(tally))
    this.emitChanged()
  }

  snapshot(): QueueSnapshot {
    const ordered = this.current ? [this.current, ...this.waiting] : [...this.waiting]
    return {
      entries: ordered.map(published),
      recent: [...this.recent],
      suspended: this.suspended,
      full: this.waiting.length >= MAX_WAITING
    }
  }

  private pump(): void {
    if (this.current || this.closing || this.suspended) return
    if (this.deps.control.isPaused) return

    const next = this.waiting[0]
    if (!next) return
    if (next.state === 'announcing') return

    if (!this.deps.control.connected) {
      this.waitForExtension(next)
      return
    }
    if (next.priority === 'background' && !next.announced) {
      this.announce(next)
      return
    }
    this.dispatch(next)
  }

  private dispatch(entry: Entry): void {
    this.waiting.shift()
    this.current = entry
    this.setState(entry, 'running')
    entry.startedAt = Date.now()
    this.count('started')
    this.emitChanged()

    const advance = (): void => {
      this.current = null
      this.emitChanged()
      this.pump()
    }

    entry.run().then(
      (value) => {
        entry.settle(value)
        advance()
      },
      (cause: unknown) => {
        const failure = cause instanceof Error ? cause : new Error(String(cause))
        if (failure instanceof OrchestratorBusyError) {
          this.invariantViolations += 1
          console.error('[queue] dequeued while a run was already in progress')
        }
        entry.fail(failure)
        advance()
      }
    )
  }

  private announce(entry: Entry): void {
    this.setState(entry, 'announcing')
    entry.announced = true
    entry.announceUntil = Date.now() + ANNOUNCE_MS
    entry.timer = setTimeout(() => {
      this.setState(entry, 'waiting')
      this.pump()
    }, ANNOUNCE_MS)
    this.emitChanged()
  }

  private waitForExtension(entry: Entry): void {
    if (entry.state === 'waiting-for-extension') return
    this.setState(entry, 'waiting-for-extension')
    entry.timer = setTimeout(() => {
      this.discard(entry, 'expired-no-extension', new Error('the extension never connected'))
      this.emitChanged()
      this.pump()
    }, EXTENSION_CONNECT_TIMEOUT_MS)
    this.emitChanged()
  }

  private supersede(dedupeKey: string): number {
    const at = this.waiting.findIndex((candidate) => candidate.dedupeKey === dedupeKey)
    if (at < 0) return -1
    const older = this.waiting[at]
    if (older) this.discard(older, 'superseded', new QueueSupersededError())
    return at
  }

  private insert(entry: Entry): void {
    if (entry.priority === 'background') {
      this.waiting.push(entry)
      return
    }
    const firstBackground = this.waiting.findIndex((candidate) => candidate.priority === 'background')
    if (firstBackground < 0) {
      this.waiting.push(entry)
      return
    }
    this.insertAt(entry, firstBackground)
  }

  private insertAt(entry: Entry, index: number): void {
    const displaced = this.waiting[index]
    if (index === 0 && displaced) this.release(displaced)
    this.waiting.splice(index, 0, entry)
  }

  // A displaced entry has to earn its countdown again, or it would later take the
  // active tab with no notice at all.
  private release(entry: Entry): void {
    this.setState(entry, 'waiting')
    entry.announced = false
  }

  private setState(entry: Entry, state: QueueEntryState): void {
    this.clearTimer(entry)
    entry.state = state
    entry.announceUntil = null
  }

  private discard(entry: Entry, disposition: QueueDisposition, error: Error): void {
    const at = this.waiting.indexOf(entry)
    if (at >= 0) this.waiting.splice(at, 1)
    this.clearTimer(entry)
    this.count(disposition)
    this.recent.unshift({ id: entry.id, work: entry.work, disposition, message: error.message, at: Date.now() })
    if (this.recent.length > RECENT_KEPT) this.recent.length = RECENT_KEPT
    entry.fail(error)
    this.deps.onDropped(entry.work, disposition, error.message)
  }

  private clearTimer(entry: Entry): void {
    if (entry.timer === null) return
    clearTimeout(entry.timer)
    entry.timer = null
  }

  private markCurrent(state: 'held' | 'running'): void {
    if (!this.current) return
    this.setState(this.current, state)
    this.emitChanged()
  }

  private count(disposition: QueueDisposition): void {
    this.counts[disposition] += 1
  }

  private emitChanged(): void {
    this.deps.onChanged(this.snapshot())
  }
}

function published(entry: Entry): QueueEntry {
  return {
    id: entry.id,
    priority: entry.priority,
    state: entry.state,
    work: entry.work,
    enqueuedAt: entry.enqueuedAt,
    startedAt: entry.startedAt,
    announceUntil: entry.announceUntil,
    dedupeKey: entry.dedupeKey
  }
}

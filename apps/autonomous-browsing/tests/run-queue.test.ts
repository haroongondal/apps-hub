import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  ANNOUNCE_MS,
  EXTENSION_CONNECT_TIMEOUT_MS,
  MAX_WAITING,
  QueueFullError,
  RunQueue
} from '../src/main/automation/run-queue'
import type { SessionControl } from '../src/main/automation/session-control'
import { BrowserPausedError } from '../src/main/automation/session'
import type { QueueDisposition, QueueEntryState, QueueSnapshot, QueueWork } from '../src/shared/types'

class FakeControl extends EventEmitter {
  connected = true
  isPaused = false
  cancels = 0

  pause(): void {}
  resume(): void {}
  setRunContext(): void {}

  cancel(): void {
    this.cancels += 1
  }
}

interface Harness {
  queue: RunQueue
  control: FakeControl
  dropped: Array<[QueueDisposition, string]>
  latest: () => QueueSnapshot
  states: () => QueueEntryState[]
  ids: () => string[]
}

function harness(): Harness {
  const control = new FakeControl()
  const dropped: Array<[QueueDisposition, string]> = []
  let latest: QueueSnapshot = { entries: [], recent: [], suspended: false, full: false }

  const queue = new RunQueue({
    control: control as unknown as SessionControl,
    onChanged: (snapshot) => {
      latest = snapshot
    },
    onDropped: (_work, disposition, message) => dropped.push([disposition, message])
  })

  return {
    queue,
    control,
    dropped,
    latest: () => latest,
    states: () => latest.entries.map((entry) => entry.state),
    ids: () => latest.entries.map((entry) => (entry.work.kind === 'routine' ? entry.work.target.id : entry.work.kind))
  }
}

function work(id: string): QueueWork {
  return { kind: 'routine', target: { kind: 'user', id } }
}

interface Deferred {
  promise: Promise<string>
  resolve: (value: string) => void
  reject: (error: Error) => void
}

function deferred(): Deferred {
  let resolve!: (value: string) => void
  let reject!: (error: Error) => void
  const promise = new Promise<string>((settleWith, failWith) => {
    resolve = settleWith
    reject = failWith
  })
  return { promise, resolve, reject }
}

function never(): Promise<string> {
  return new Promise<string>(() => {})
}

async function settle(): Promise<void> {
  for (let tick = 0; tick < 5; tick += 1) await Promise.resolve()
}

describe('the fast path', () => {
  it('starts an entry on an idle queue with no timer in the way', async () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      const running = deferred()
      let started = false

      const done = h.queue.enqueue(work('a'), { priority: 'interactive' }, () => {
        started = true
        return running.promise
      })
      await settle()

      expect(started).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
      expect(h.states()).toEqual(['running'])

      running.resolve('ok')
      await expect(done).resolves.toBe('ok')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('draining in order', () => {
  it('runs one entry at a time and then the next', async () => {
    const h = harness()
    const a = deferred()
    const b = deferred()
    const c = deferred()
    const order: string[] = []

    const runA = h.queue.enqueue(work('a'), { priority: 'interactive' }, () => {
      order.push('a')
      return a.promise
    })
    const runB = h.queue.enqueue(work('b'), { priority: 'interactive' }, () => {
      order.push('b')
      return b.promise
    })
    const runC = h.queue.enqueue(work('c'), { priority: 'interactive' }, () => {
      order.push('c')
      return c.promise
    })
    await settle()

    expect(order).toEqual(['a'])
    expect(h.states()).toEqual(['running', 'waiting', 'waiting'])

    a.resolve('a done')
    await runA
    await settle()
    expect(order).toEqual(['a', 'b'])

    b.resolve('b done')
    await runB
    await settle()
    expect(order).toEqual(['a', 'b', 'c'])

    c.resolve('c done')
    await expect(runC).resolves.toBe('c done')
  })
})

describe('priority', () => {
  it('places an interactive entry ahead of background work and behind interactive work', async () => {
    const h = harness()
    const head = deferred()
    const running = h.queue.enqueue(work('head'), { priority: 'interactive' }, () => head.promise)
    await settle()

    const pending = [
      h.queue.enqueue(work('bg1'), { priority: 'background' }, never),
      h.queue.enqueue(work('bg2'), { priority: 'background' }, never),
      h.queue.enqueue(work('ix1'), { priority: 'interactive' }, never),
      h.queue.enqueue(work('ix2'), { priority: 'interactive' }, never)
    ]
    await settle()

    expect(h.ids()).toEqual(['head', 'ix1', 'ix2', 'bg1', 'bg2'])

    h.queue.drain('test over')
    head.resolve('head done')
    await running
    await Promise.allSettled(pending)
  })
})

describe('the depth cap', () => {
  it('refuses with the frozen message once the line is full', async () => {
    const h = harness()
    const head = deferred()
    const running = h.queue.enqueue(work('head'), { priority: 'interactive' }, () => head.promise)
    await settle()

    const pending: Array<Promise<string>> = []
    for (let at = 0; at < MAX_WAITING; at += 1) {
      pending.push(h.queue.enqueue(work(`w${at}`), { priority: 'interactive' }, never))
    }
    expect(h.latest().full).toBe(true)

    expect(() => h.queue.enqueue(work('over'), { priority: 'interactive' }, never)).toThrow(QueueFullError)
    expect(() => h.queue.enqueue(work('over'), { priority: 'interactive' }, never)).toThrow(
      'the run queue is full (50 waiting) — cancel something or wait for it to drain'
    )

    h.queue.drain('test over')
    head.resolve('head done')
    await running
    await Promise.allSettled(pending)
  })
})

describe('staleness', () => {
  it('replaces a waiting entry sharing a dedupe key, in that entry’s place', async () => {
    const h = harness()
    const head = deferred()
    const running = h.queue.enqueue(work('head'), { priority: 'interactive' }, () => head.promise)
    await settle()

    const first = h.queue.enqueue(work('nine'), { priority: 'background', dedupeKey: 'schedule-1' }, never)
    const other = h.queue.enqueue(work('ten'), { priority: 'background', dedupeKey: 'schedule-2' }, never)
    await settle()
    expect(h.ids()).toEqual(['head', 'nine', 'ten'])

    const replacement = h.queue.enqueue(work('nine-again'), { priority: 'background', dedupeKey: 'schedule-1' }, never)

    await expect(first).rejects.toThrow('a newer request took the place of this one before it started')
    expect(h.dropped).toEqual([['superseded', 'a newer request took the place of this one before it started']])
    expect(h.ids()).toEqual(['head', 'nine-again', 'ten'])

    h.queue.drain('test over')
    head.resolve('head done')
    await running
    await Promise.allSettled([other, replacement])
  })
})

describe('cancelling', () => {
  it('removes a waiting entry without sending anything to the browser', async () => {
    const h = harness()
    const head = deferred()
    const running = h.queue.enqueue(work('head'), { priority: 'interactive' }, () => head.promise)
    await settle()
    const queued = h.queue.enqueue(work('b'), { priority: 'interactive' }, never)
    await settle()

    const id = h.latest().entries[1]?.id
    expect(id).toBeTruthy()
    expect(h.queue.cancelEntry(id!)).toBe(true)

    await expect(queued).rejects.toThrow('this entry was cancelled before it started')
    expect(h.control.cancels).toBe(0)
    expect(h.ids()).toEqual(['head'])
    expect(h.queue.cancelEntry(id!)).toBe(false)

    head.resolve('head done')
    await running
  })

  it('clears the waiting entries and leaves the running one alone', async () => {
    const h = harness()
    const head = deferred()
    const running = h.queue.enqueue(work('head'), { priority: 'interactive' }, () => head.promise)
    await settle()
    const pending = [
      h.queue.enqueue(work('b'), { priority: 'interactive' }, never),
      h.queue.enqueue(work('c'), { priority: 'interactive' }, never)
    ]
    await settle()

    expect(h.queue.clearWaiting()).toBe(2)
    expect(h.ids()).toEqual(['head'])
    await Promise.allSettled(pending)

    head.resolve('head done')
    await expect(running).resolves.toBe('head done')
  })
})

describe('the browser pause', () => {
  it('does not dequeue while the browser is paused', async () => {
    const h = harness()
    h.control.isPaused = true
    let started = false

    const queued = h.queue.enqueue(work('a'), { priority: 'interactive' }, async () => {
      started = true
      return 'ok'
    })
    await settle()

    expect(started).toBe(false)
    expect(h.states()).toEqual(['waiting'])

    h.control.isPaused = false
    h.control.emit('resumed')
    await settle()

    expect(started).toBe(true)
    await expect(queued).resolves.toBe('ok')
  })

  it('marks the running entry held while the browser holds', async () => {
    const h = harness()
    const head = deferred()
    const running = h.queue.enqueue(work('a'), { priority: 'interactive' }, () => head.promise)
    await settle()

    h.control.isPaused = true
    h.control.emit('paused')
    expect(h.states()).toEqual(['held'])

    h.control.isPaused = false
    h.control.emit('resumed')
    expect(h.states()).toEqual(['running'])

    head.resolve('done')
    await running
  })

  it('suspends instead of advancing when Stop lands on a paused browser', async () => {
    const h = harness()
    const head = deferred()
    const running = h.queue.enqueue(work('a'), { priority: 'interactive' }, () => head.promise)
    await settle()

    let secondStarted = false
    const queued = h.queue.enqueue(work('b'), { priority: 'interactive' }, async () => {
      secondStarted = true
      return 'b'
    })
    await settle()

    h.control.isPaused = true
    h.control.emit('paused')
    h.queue.cancelRunning()
    expect(h.control.cancels).toBe(1)
    expect(h.latest().suspended).toBe(true)

    h.control.isPaused = false
    head.reject(new Error('the user stopped this run'))
    await expect(running).rejects.toThrow('the user stopped this run')
    await settle()
    expect(secondStarted).toBe(false)

    h.queue.start()
    await settle()
    expect(secondStarted).toBe(true)
    expect(h.latest().suspended).toBe(false)
    await expect(queued).resolves.toBe('b')
  })

  it('does not suspend when Stop lands on a paused browser with nothing waiting', async () => {
    const h = harness()
    const head = deferred()
    const running = h.queue.enqueue(work('a'), { priority: 'interactive' }, () => head.promise)
    await settle()

    h.control.isPaused = true
    h.control.emit('paused')
    h.queue.cancelRunning()
    expect(h.control.cancels).toBe(1)
    expect(h.latest().suspended).toBe(false)

    h.control.isPaused = false
    head.reject(new Error('the user stopped this run'))
    await expect(running).rejects.toThrow('the user stopped this run')
    await settle()

    let nextStarted = false
    const next = h.queue.enqueue(work('b'), { priority: 'interactive' }, async () => {
      nextStarted = true
      return 'b'
    })
    await settle()
    expect(nextStarted).toBe(true)
    await expect(next).resolves.toBe('b')
  })

  it('advances normally when Stop lands on a browser that is not paused', async () => {
    const h = harness()
    const head = deferred()
    const running = h.queue.enqueue(work('a'), { priority: 'interactive' }, () => head.promise)
    await settle()
    const queued = h.queue.enqueue(work('b'), { priority: 'interactive' }, () => Promise.resolve('b'))
    await settle()

    h.queue.cancelRunning()
    expect(h.latest().suspended).toBe(false)

    head.reject(new Error('the user stopped this run'))
    await expect(running).rejects.toThrow('the user stopped this run')
    await expect(queued).resolves.toBe('b')
  })

  it('names the refusal a queued entry would hit if it reached a paused backend', () => {
    expect(new BrowserPausedError().message).toBe(
      'the browser is paused — resume or cancel before starting another run'
    )
  })
})

describe('waiting for the extension', () => {
  it('starts a parked entry when the extension connects, and drops its expiry timer', async () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      h.control.connected = false
      const running = deferred()

      const queued = h.queue.enqueue(work('a'), { priority: 'interactive' }, () => running.promise)
      await settle()
      expect(h.states()).toEqual(['waiting-for-extension'])

      h.control.connected = true
      h.control.emit('connected')
      await settle()
      expect(h.states()).toEqual(['running'])
      expect(vi.getTimerCount()).toBe(0)

      await vi.advanceTimersByTimeAsync(EXTENSION_CONNECT_TIMEOUT_MS * 2)
      expect(h.dropped).toEqual([])
      expect(h.latest().recent).toEqual([])

      running.resolve('ok')
      await expect(queued).resolves.toBe('ok')
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up after the timeout and says why', async () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      h.control.connected = false

      const queued = h.queue.enqueue(work('a'), { priority: 'interactive' }, never)
      const expired = expect(queued).rejects.toThrow('the extension never connected')
      await settle()

      await vi.advanceTimersByTimeAsync(EXTENSION_CONNECT_TIMEOUT_MS + 1)

      await expired
      expect(h.dropped).toEqual([['expired-no-extension', 'the extension never connected']])
      expect(h.latest().recent[0]?.disposition).toBe('expired-no-extension')
      expect(h.latest().entries).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('announcing a background entry', () => {
  it('counts down before taking the tab', async () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      let started = false

      const queued = h.queue.enqueue(work('sched'), { priority: 'background' }, async () => {
        started = true
        return 'ok'
      })
      await settle()

      expect(h.states()).toEqual(['announcing'])
      expect(h.latest().entries[0]?.announceUntil).not.toBeNull()

      await vi.advanceTimersByTimeAsync(ANNOUNCE_MS - 1)
      expect(started).toBe(false)

      await vi.advanceTimersByTimeAsync(2)
      expect(started).toBe(true)
      await expect(queued).resolves.toBe('ok')
    } finally {
      vi.useRealTimers()
    }
  })

  it('counts down again after an interactive entry takes the head', async () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      const background = deferred()
      const queued = h.queue.enqueue(work('sched'), { priority: 'background' }, () => background.promise)
      await settle()
      expect(h.states()).toEqual(['announcing'])

      const interrupting = deferred()
      const manual = h.queue.enqueue(work('manual'), { priority: 'interactive' }, () => interrupting.promise)
      await settle()
      expect(h.ids()).toEqual(['manual', 'sched'])
      expect(h.latest().entries[1]?.announceUntil).toBeNull()

      interrupting.resolve('manual')
      await expect(manual).resolves.toBe('manual')
      await settle()

      expect(h.states()).toEqual(['announcing'])
      expect(h.latest().entries[0]?.announceUntil).not.toBeNull()

      await vi.advanceTimersByTimeAsync(ANNOUNCE_MS + 1)
      expect(h.states()).toEqual(['running'])

      background.resolve('ok')
      await expect(queued).resolves.toBe('ok')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the quit drain', () => {
  it('settles every waiting entry and refuses to start another', async () => {
    const h = harness()
    const head = deferred()
    const running = h.queue.enqueue(work('a'), { priority: 'interactive' }, () => head.promise)
    await settle()

    let laterStarted = false
    const queued = h.queue.enqueue(work('b'), { priority: 'interactive' }, async () => {
      laterStarted = true
      return 'b'
    })
    await settle()

    h.queue.drain('the app closed before this entry started')

    await expect(queued).rejects.toThrow('the app closed before this entry started')
    expect(h.dropped).toEqual([['dropped-app-quit', 'the app closed before this entry started']])

    head.resolve('a done')
    await running
    await settle()
    expect(laterStarted).toBe(false)
  })
})

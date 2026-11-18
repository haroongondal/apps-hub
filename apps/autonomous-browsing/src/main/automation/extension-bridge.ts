import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { BrowserPausedError, RunCancelledError, type RunContext } from './session'

export const BRIDGE_ENDPOINT =
  process.platform === 'win32'
    ? '\\\\.\\pipe\\outsentia-automation'
    : path.join(os.homedir(), '.outsentia-automation.sock')

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

// Must match extension/manifest.json; tests/extension-session.test.ts holds them together.
export const EXTENSION_VERSION = '1.11.0'

export type InputPath = 'cdp' | 'synthetic'

export interface BridgeResult {
  ok: boolean
  value?: string
  error?: string
  held?: boolean
  changed?: boolean
  committing?: boolean
  via?: InputPath
}

export interface BridgeSnapshot {
  url: string
  title: string | null
  screenshot: string
  screenshotError: string | null
  dom: string
  domError: string | null
  blockedBy: string | null
}

export class ExtensionNotConnectedError extends Error {
  constructor() {
    super('the Chrome extension is not connected — open Chrome and confirm the extension is enabled')
  }
}

export class StepIndeterminateError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(
      `the extension stopped answering "${label}" after ${Math.round(timeoutMs / 1000)}s — ` +
        'it may or may not have run, so check the page before running this again'
    )
  }
}

interface Pending {
  resolve: (payload: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

type Waiter = { resolve: () => void; reject: (error: Error) => void }

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

export class ExtensionBridge extends EventEmitter {
  private server: net.Server | null = null
  private socket: net.Socket | null = null
  private readonly pending = new Map<string, Pending>()
  private waiters: Waiter[] = []
  private paused = false
  private pauseReason: string | null = null
  private runContext: RunContext | null = null

  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed
  }

  get isPaused(): boolean {
    return this.paused
  }

  get pausedBecause(): string | null {
    return this.pauseReason
  }

  listen(): void {
    if (process.platform !== 'win32' && fs.existsSync(BRIDGE_ENDPOINT)) {
      fs.rmSync(BRIDGE_ENDPOINT)
    }

    this.server = net.createServer((socket) => this.adopt(socket))

    // A bind failure without this listener takes the whole main process down.
    this.server.on('error', (error) => {
      console.error(`[bridge] could not listen on ${BRIDGE_ENDPOINT}:`, error)
      this.emit('listen-failed', error)
    })

    this.server.listen(BRIDGE_ENDPOINT, () => {
      if (process.platform !== 'win32') fs.chmodSync(BRIDGE_ENDPOINT, 0o600)
      console.log(`[bridge] listening on ${BRIDGE_ENDPOINT}`)
    })
  }

  close(): void {
    this.abortRun(new Error('the app closed while this run was in flight'))
    this.socket?.destroy()
    this.server?.close()
    this.socket = null
    this.server = null
    if (process.platform !== 'win32' && fs.existsSync(BRIDGE_ENDPOINT)) {
      fs.rmSync(BRIDGE_ENDPOINT, { force: true })
    }
  }

  private adopt(socket: net.Socket): void {
    this.socket?.destroy()
    this.socket = socket
    socket.setEncoding('utf8')

    let buffer = ''
    socket.on('data', (chunk: string) => {
      buffer += chunk
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line.trim()) this.receive(line)
        newline = buffer.indexOf('\n')
      }
    })

    socket.on('error', () => socket.destroy())
    socket.on('close', () => {
      if (this.socket !== socket) return
      this.socket = null
      this.abortRun(new ExtensionNotConnectedError())
      this.emit('disconnected')
    })

    this.emit('connected')
  }

  private receive(line: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }

    const type = message['type']

    if (type === 'paused') {
      this.paused = true
      this.pauseReason = typeof message['reason'] === 'string' ? message['reason'] : null
      this.emit('paused', this.pauseReason, message['auto'] === true, this.runContext)
      return
    }

    if (type === 'resumed') {
      this.release()
      this.emit('resumed')
      return
    }

    if (type === 'target-closed') {
      this.abortRun(new Error('the automated tab was closed'))
      return
    }

    const id = message['id']
    if (typeof id !== 'string') return
    const waiting = this.pending.get(id)
    if (!waiting) return
    this.pending.delete(id)
    clearTimeout(waiting.timer)
    waiting.resolve(message)
  }

  private failAllPending(error: Error): void {
    for (const [, waiting] of this.pending) {
      clearTimeout(waiting.timer)
      waiting.reject(error)
    }
    this.pending.clear()
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.socket) throw new ExtensionNotConnectedError()
    this.socket.write(JSON.stringify(payload) + '\n')
  }

  private request(
    payload: Record<string, unknown>,
    options: { timeoutMs?: number; label?: string } = {}
  ): Promise<Record<string, unknown>> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    const label = options.label ?? String(payload['type'])
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.trySend({ type: 'abandon', id })
        reject(new StepIndeterminateError(label, timeoutMs))
      }, timeoutMs)

      this.pending.set(id, { resolve, reject, timer })
      try {
        this.send({ ...payload, id })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error as Error)
      }
    })
  }

  private trySend(payload: Record<string, unknown>): void {
    if (!this.connected) return
    try {
      this.send(payload)
    } catch (error) {
      console.warn(`[bridge] could not send "${String(payload['type'])}":`, error)
    }
  }

  waitWhileHeld(): Promise<void> {
    if (!this.paused) return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }

  private release(): void {
    this.paused = false
    this.pauseReason = null
    const held = this.waiters
    this.waiters = []
    for (const waiter of held) waiter.resolve()
  }

  pause(reason: string): void {
    this.send({ type: 'pause', reason })
    this.paused = true
    this.pauseReason = reason
    this.emit('paused', reason, false, this.runContext)
  }

  setRunContext(context: RunContext | null): void {
    this.runContext = context
  }

  resume(): void {
    this.send({ type: 'resume' })
    this.release()
    this.emit('resumed')
  }

  cancel(): void {
    this.abortRun(new RunCancelledError())
  }

  // Only the user's Cancel may unwind a run as RunCancelledError.
  private abortRun(error: Error): void {
    const wasHeld = this.paused
    const held = this.waiters
    this.waiters = []
    this.paused = false
    this.pauseReason = null
    this.failAllPending(error)
    for (const waiter of held) waiter.reject(error)
    this.trySend({ type: 'stop' })
    if (wasHeld) this.emit('resumed')
  }

  async start(inputMode: string): Promise<{ version: string | null }> {
    if (!this.connected) throw new ExtensionNotConnectedError()
    if (this.paused) throw new BrowserPausedError()
    this.abortRun(new Error('a new run took over this connection'))
    const reply = await this.request({ type: 'start', inputMode })
    return { version: typeof reply['version'] === 'string' ? reply['version'] : null }
  }

  stop(): void {
    this.trySend({ type: 'stop' })
  }

  async runStep(step: unknown, options: { timeoutMs: number; label: string }): Promise<BridgeResult> {
    const reply = await this.request({ type: 'step', step }, options)
    return {
      ok: reply['ok'] === true,
      value: typeof reply['value'] === 'string' ? reply['value'] : undefined,
      error: typeof reply['error'] === 'string' ? reply['error'] : undefined,
      held: reply['held'] === true,
      changed: optionalBoolean(reply['changed']),
      committing: optionalBoolean(reply['committing']),
      via: reply['via'] === 'cdp' || reply['via'] === 'synthetic' ? reply['via'] : undefined
    }
  }

  async snapshot(timeoutMs: number): Promise<BridgeSnapshot> {
    const reply = await this.request({ type: 'snapshot' }, { timeoutMs })
    if (reply['ok'] !== true) throw new Error(String(reply['error'] ?? 'snapshot failed'))
    return {
      url: String(reply['url'] ?? ''),
      title: typeof reply['title'] === 'string' ? reply['title'] : null,
      screenshot: String(reply['screenshot'] ?? ''),
      screenshotError: typeof reply['screenshotError'] === 'string' ? reply['screenshotError'] : null,
      dom: String(reply['dom'] ?? ''),
      domError: typeof reply['domError'] === 'string' ? reply['domError'] : null,
      blockedBy: typeof reply['blockedBy'] === 'string' ? reply['blockedBy'] : null
    }
  }
}

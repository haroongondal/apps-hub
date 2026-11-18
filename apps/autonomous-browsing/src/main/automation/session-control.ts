import type { RunContext } from './session'

export type SessionControlEvent = 'connected' | 'disconnected' | 'paused' | 'resumed'

export interface SessionControl {
  readonly connected: boolean
  readonly isPaused: boolean
  pause(reason: string): void
  resume(): void
  cancel(): void
  setRunContext(context: RunContext | null): void
  on(event: SessionControlEvent, listener: (...args: any[]) => void): unknown
}

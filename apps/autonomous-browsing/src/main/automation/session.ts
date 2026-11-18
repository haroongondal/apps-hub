import type { ActionStep, StepOutput } from '../../shared/types'

export type { StepOutput } from '../../shared/types'

export interface PageSnapshot {
  url: string
  title: string | null
  screenshotBase64: string | null
  // Why there is no screenshot. Chrome can only capture the visible tab, so this
  // is routine, and a thread that omitted it would look like a broken feature.
  screenshotError: string | null
  dom: string
  domError: string | null
  blockedBy: string | null
}

export interface RunContext {
  runId: string
  stepIndex: number
}

export type HoldReporter = (reason: string) => void

export interface AutomationSession {
  connect(): Promise<void>
  disconnect(): Promise<void>
  snapshot(): Promise<PageSnapshot>
  currentUrl(): string | null
  runStep(step: ActionStep, vars?: Record<string, string>): Promise<StepOutput>
  extractText(selector: string): Promise<string>
  // Parks the run until the user resumes, so they can do a step no repair could.
  holdForHuman(reason: string): Promise<void>
  setRunContext(context: RunContext | null): void
  setHoldReporter(report: HoldReporter | null): void
}

const REFUSAL = /refusing to write into/

export class RunPausedError extends Error {
  constructor(reason: string | null) {
    super(reason ? `the run was paused — ${reason}` : 'the run was paused')
  }
}

export class RunCancelledError extends Error {
  constructor() {
    super('the automation run was cancelled')
  }
}

export class StepExecutionError extends Error {
  readonly healable: boolean

  constructor(step: ActionStep, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`step "${step.kind}" failed: ${detail}`)
    this.healable = !REFUSAL.test(detail)
  }
}

// Not a StepExecutionError, so isHealable rejects it and no repair overrules it.
export class AssertionFailedError extends Error {}

// An impostor engine disables every guard that reads the page through it at once.
export class UntrustedPageError extends Error {}

export class BrowserPausedError extends Error {
  constructor() {
    super('the browser is paused — resume or cancel before starting another run')
  }
}

// Everything else a run can throw — a pause, an indeterminate step, cancellation,
// a lost socket — is the caller's to handle, not something a repair can guess at.
export function isHealable(error: unknown): boolean {
  return error instanceof StepExecutionError && error.healable
}

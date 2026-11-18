import { resolveStep } from '../../shared/routines'
import type { ActionStep } from '../../shared/types'
import { filterDom, optimizeScreenshot } from '../lib/TokenOptimizer'
import { EXTENSION_VERSION, type BridgeResult, type ExtensionBridge } from './extension-bridge'
import {
  AssertionFailedError,
  RunPausedError,
  StepExecutionError,
  type AutomationSession,
  type HoldReporter,
  type PageSnapshot,
  type RunContext,
  type StepOutput
} from './session'

const MAX_HELD_RETRIES = 3

const MAX_EXTRACT_CHARS = 10_000

// content.js resolves for 10s, then watches for a reaction for another 0.75s.
const EXTENSION_ACTION_MS = 10_750
const EXTENSION_WAIT_SELECTOR_MS = 15_000
const EXTENSION_NAVIGATE_MS = 20_000
const EXTENSION_SCREENSHOT_MS = 15_000
// Must not drop below page-core.js's ABSENCE_GRACE_MS, or transport times out first.
const ABSENCE_GRACE_MS = 1_000
const TIMEOUT_MARGIN_MS = 5_000
const SNAPSHOT_TIMEOUT_MS = 30_000

export class ExtensionSession implements AutomationSession {
  private reportHold: HoldReporter | null = null

  constructor(
    private readonly bridge: ExtensionBridge,
    private readonly inputMode: string = 'auto'
  ) {}

  async connect(): Promise<void> {
    const { version } = await this.bridge.start(this.inputMode)
    if (version !== EXTENSION_VERSION) {
      throw new Error(
        `the Chrome extension is version ${version ?? '1.0.x'} but this app needs ${EXTENSION_VERSION} — ` +
          'reload it at chrome://extensions, then reload the tab you want automated'
      )
    }
  }

  async disconnect(): Promise<void> {
    this.bridge.stop()
  }

  async snapshot(): Promise<PageSnapshot> {
    await this.bridge.waitWhileHeld()
    const captured = await this.bridge.snapshot(SNAPSHOT_TIMEOUT_MS)
    const { html: dom } = filterDom(captured.dom)

    // An occluded or minimised window has no frame to read back, but the DOM still describes the page.
    if (!captured.screenshot) {
      return {
        url: captured.url,
        title: captured.title,
        screenshotBase64: null,
        screenshotError: captured.screenshotError ?? 'no frame was captured',
        dom,
        domError: captured.domError,
        blockedBy: captured.blockedBy
      }
    }

    const optimized = await optimizeScreenshot(captured.screenshot)
    return {
      url: captured.url,
      title: captured.title,
      screenshotBase64: optimized.base64,
      screenshotError: null,
      dom,
      domError: captured.domError,
      blockedBy: captured.blockedBy
    }
  }

  // This backend has no cheap current-URL source. A remembered snapshot URL is a
  // historical value, and any navigation the run didn't request would misattribute landmarks.
  currentUrl(): string | null {
    return null
  }

  async runStep(step: ActionStep, vars: Record<string, string> = {}): Promise<StepOutput> {
    // The caller stores extract results itself; see extractText.
    if (step.kind === 'extract') return {}

    const result = await this.dispatch(resolveStep(step, vars))
    if (!result.ok && step.kind === 'assert') {
      throw new AssertionFailedError(result.error ?? 'the assertion failed')
    }
    if (!result.ok) throw new StepExecutionError(step, result.error ?? 'unknown extension error')

    const outcome = { changed: result.changed, committing: result.committing, via: result.via }
    if (step.kind !== 'screenshot' || !result.value) return outcome

    const optimized = await optimizeScreenshot(result.value)
    return { ...outcome, value: optimized.base64 }
  }

  async extractText(selector: string): Promise<string> {
    const step: ActionStep = { kind: 'extract', selector, into: '' }
    const result = await this.dispatch(step)
    if (!result.ok) throw new StepExecutionError(step, result.error ?? 'unknown error')
    return (result.value ?? '').trim().slice(0, MAX_EXTRACT_CHARS)
  }

  async holdForHuman(reason: string): Promise<void> {
    this.bridge.pause(reason)
    await this.bridge.waitWhileHeld()
  }

  setRunContext(context: RunContext | null): void {
    this.bridge.setRunContext(context)
  }

  setHoldReporter(report: HoldReporter | null): void {
    this.reportHold = report
  }

  private async dispatch(step: ActionStep): Promise<BridgeResult> {
    const options = { timeoutMs: stepTimeout(step), label: step.kind }
    await this.abandonStepIfPaused()

    for (let attempt = 0; ; attempt++) {
      await this.bridge.waitWhileHeld()
      const result = await this.bridge.runStep(step, options)
      if (!result.held) {
        if (!result.ok) await this.abandonStepIfPaused()
        return result
      }
      if (attempt >= MAX_HELD_RETRIES) {
        throw new Error(
          `the extension held this step ${attempt + 1} times (${result.error ?? 'sensitive field detected'}) — ` +
            'complete it yourself in the browser and resume, or cancel the run'
        )
      }
      if (attempt === 0) this.reportHold?.(result.error ?? 'sensitive field detected')
    }
  }

  private async abandonStepIfPaused(): Promise<void> {
    if (!this.bridge.isPaused) return
    const reason = this.bridge.pausedBecause
    await this.bridge.waitWhileHeld()
    throw new RunPausedError(reason)
  }
}

export function stepTimeout(step: ActionStep): number {
  return extensionBudget(step) + TIMEOUT_MARGIN_MS
}

function extensionBudget(step: ActionStep): number {
  switch (step.kind) {
    case 'navigate':
      return EXTENSION_NAVIGATE_MS
    case 'screenshot':
      return EXTENSION_SCREENSHOT_MS
    case 'wait':
      return step.forSelector ? EXTENSION_WAIT_SELECTOR_MS : (step.ms ?? 1000)
    case 'assert':
      return step.expect === 'absent' ? ABSENCE_GRACE_MS : EXTENSION_ACTION_MS
    default:
      return EXTENSION_ACTION_MS
  }
}

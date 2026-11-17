import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright-core'
import pageCoreSource from '../../../extension/page-core.js?raw'
import { resolveStep } from '../../shared/routines'
import type { ActionStep } from '../../shared/types'
import { filterDom, optimizeScreenshot } from '../lib/TokenOptimizer'
import type { ChromeEndpoint, ChromeProcess } from './chrome-process'
import { StepIndeterminateError } from './extension-bridge'
import { stepTimeout } from './extension-session'
import {
  BrowserPausedError,
  RunCancelledError,
  RunPausedError,
  AssertionFailedError,
  StepExecutionError,
  UntrustedPageError,
  type AutomationSession,
  type HoldReporter,
  type PageSnapshot,
  type RunContext,
  type StepOutput
} from './session'

const MAX_HELD_RETRIES = 3
const MAX_EXTRACT_CHARS = 10_000
const NAV_TIMEOUT_MS = 20_000
const SCREENSHOT_TIMEOUT_MS = 15_000
const HOOKS_TIMEOUT_MS = 30_000

export interface DriverFrame {
  parentFrame(): DriverFrame | null
  evaluate(script: unknown, arg?: unknown): Promise<unknown>
}

export interface DriverPage {
  url(): string
  mainFrame(): DriverFrame
  frames(): DriverFrame[]
  screenshot(options: { type: 'jpeg'; quality: number; timeout: number }): Promise<Buffer>
  goto(url: string, options: { waitUntil: 'load'; timeout: number }): Promise<unknown>
  bringToFront(): Promise<void>
  opener(): Promise<DriverPage | null>
  on(event: 'close' | 'domcontentloaded', listener: () => void): unknown
  mouse: { move(x: number, y: number): Promise<void>; down(): Promise<void>; up(): Promise<void> }
  keyboard: { insertText(text: string): Promise<void>; press(key: string): Promise<void> }
}

export interface DriverBindingSource {
  page: DriverPage
  frame: DriverFrame
}

export interface DriverContext {
  pages(): DriverPage[]
  newPage(): Promise<DriverPage>
  exposeBinding(name: string, binding: (source: DriverBindingSource, ...args: unknown[]) => unknown): Promise<void>
  addInitScript(script: string): Promise<void>
  on(event: 'page', listener: (page: DriverPage) => void): unknown
}

export interface DriverBrowser {
  contexts(): DriverContext[]
  newContext(): Promise<DriverContext>
  close(): Promise<void>
}

export type DriverConnector = (endpoint: string) => Promise<DriverBrowser>

interface ExecResult {
  ok: boolean
  value?: string
  error?: string
  changed?: boolean
  committing?: boolean
  via?: 'cdp' | 'synthetic'
}

interface BannerState {
  state: 'idle' | 'active' | 'paused'
  reason: string | null
}

type Waiter = { resolve: () => void; reject: (error: Error) => void }

const connectOverCdp: DriverConnector = (endpoint) =>
  chromium.connectOverCDP(endpoint) as unknown as Promise<DriverBrowser>

const DESTROYED = /context was destroyed|frame was detached|target closed|page closed|because of a navigation/i

const HOOKS_CALL = (payload: { method: string; arg?: unknown }): unknown => {
  type Answer = { nonce?: unknown; value?: unknown }
  type Hooks = (method: string, arg?: unknown) => Answer | Promise<Answer>
  const call = (window as unknown as { __oaHooks?: Hooks }).__oaHooks
  if (typeof call !== 'function') return { __missing: true }
  return Promise.resolve(call(payload.method, payload.arg)).then((answer) => ({
    __nonce: answer?.nonce,
    value: answer?.value
  }))
}

function adapterSource(nonce: string): string {
  return `(() => {
  const input = window.__oaInput;
  const control = window.__oaControl;
  if (!window.__oaCore || !input || !control) return;
  const NONCE = ${JSON.stringify(nonce)};
  const core = window.__oaCore.create({
    requestInput: (request) => input(NONCE, request),
    control: (type) => { Promise.resolve(control(NONCE, type)).catch(() => {}); }
  });
  const answer = async (method, arg) => ({ nonce: NONCE, value: await core[method]?.(arg) });
  try {
    Object.defineProperty(window, '__oaHooks', { value: answer, writable: false, configurable: false });
  } catch { return; }
  try { delete window.__oaInput; delete window.__oaControl; } catch {}
  Promise.resolve(control(NONCE, 'state')).then((state) => { if (state) core.render(state); }).catch(() => {});
})();`
}

function agentSource(nonce: string): string {
  return `(() => {
  const installed = Object.getOwnPropertyDescriptor(window, '__oaHooks');
  if (installed && !installed.configurable) return;
  try { delete window.__oaCore; } catch {}
  if (window.__oaCore) return;
  ${pageCoreSource}
  ${adapterSource(nonce)}
})();`
}

export class PlaywrightSession extends EventEmitter implements AutomationSession {
  private browser: DriverBrowser | null = null
  private context: DriverContext | null = null
  private activePage: DriverPage | null = null
  private endpoint: ChromeEndpoint | null = null
  private launched = false
  private ending = false
  private readonly pageStack: DriverPage[] = []

  private readonly nonce = randomUUID()
  private readonly agentSource = agentSource(this.nonce)
  private stepInFlight = false
  private skipScanOnce = false

  private paused = false
  private pauseReason: string | null = null
  private waiters: Waiter[] = []
  private cancelError: Error | null = null
  private readonly cancelRejectors = new Set<(error: Error) => void>()
  private runContext: RunContext | null = null
  private reportHold: HoldReporter | null = null

  constructor(
    private readonly chrome: ChromeProcess,
    private readonly inputMode: string = 'auto',
    private readonly connectToEndpoint: DriverConnector = connectOverCdp
  ) {
    super()
  }

  // Always true: this backend launches or adopts Chrome on demand at run start.
  get connected(): boolean {
    return true
  }

  get isPaused(): boolean {
    return this.paused
  }

  get pausedBecause(): string | null {
    return this.pauseReason
  }

  async connect(): Promise<void> {
    if (this.paused) throw new BrowserPausedError()
    this.cancelError = null
    this.paused = false
    this.pauseReason = null
    this.skipScanOnce = false
    this.ending = false
    this.pageStack.length = 0

    let endpoint = await this.chrome.adopt()
    this.launched = endpoint === null
    if (!endpoint) endpoint = await this.chrome.launch()
    this.endpoint = endpoint

    this.browser = await this.connectWithRetry(`http://127.0.0.1:${endpoint.port}`)
    const context = this.browser.contexts()[0] ?? (await this.browser.newContext())
    this.context = context

    await context.exposeBinding('__oaInput', (source, ...args) => this.onInput(source, args[0], args[1]))
    await context.exposeBinding('__oaControl', (source, ...args) => this.onControl(source, args[0], args[1]))
    await context.addInitScript(this.agentSource)

    context.on('page', (page) => void this.watchPage(page, true))
    for (const page of context.pages()) void this.watchPage(page, false)

    this.activePage = context.pages().at(-1) ?? (await context.newPage())
    await this.activePage.bringToFront().catch(() => {})
    this.pushState()
  }

  async disconnect(): Promise<void> {
    this.paused = false
    this.pauseReason = null
    this.ending = true
    this.pushState()
    await this.browser?.close().catch(() => {})
    this.browser = null
    this.context = null
    this.activePage = null
    this.endpoint = null
    this.launched = false
    this.pageStack.length = 0
  }

  async snapshot(): Promise<PageSnapshot> {
    await this.waitWhileHeld()
    const page = this.requirePage()
    const url = page.url()

    let screenshotBase64: string | null = null
    let screenshotError: string | null = null
    try {
      const frame = await page.screenshot({ type: 'jpeg', quality: 60, timeout: SCREENSHOT_TIMEOUT_MS })
      screenshotBase64 = (await optimizeScreenshot(frame)).base64
    } catch (error) {
      screenshotError = error instanceof Error ? error.message : String(error)
    }

    try {
      const captured = (await this.callHooks(page.mainFrame(), 'dom')) as {
        dom: string
        title: string | null
        blockedBy: string | null
      }
      const { html: dom } = filterDom(captured.dom)
      return {
        url,
        title: captured.title,
        screenshotBase64,
        screenshotError,
        dom,
        domError: null,
        blockedBy: captured.blockedBy
      }
    } catch (error) {
      if (error instanceof UntrustedPageError) throw error
      const message = error instanceof Error ? error.message : String(error)
      return { url, title: null, screenshotBase64, screenshotError, dom: '', domError: message, blockedBy: null }
    }
  }

  currentUrl(): string | null {
    return this.activePage?.url() ?? null
  }

  async runStep(step: ActionStep, vars: Record<string, string> = {}): Promise<StepOutput> {
    if (step.kind === 'extract') return {}

    const result = await this.dispatch(resolveStep(step, vars))
    if (!result.ok && step.kind === 'assert') {
      throw new AssertionFailedError(result.error ?? 'the assertion failed')
    }
    if (!result.ok) throw new StepExecutionError(step, result.error ?? 'unknown browser error')

    const outcome: StepOutput = { changed: result.changed, committing: result.committing, via: result.via }
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
    this.pause(reason)
    await this.waitWhileHeld()
  }

  setRunContext(context: RunContext | null): void {
    this.runContext = context
  }

  setHoldReporter(report: HoldReporter | null): void {
    this.reportHold = report
  }

  pause(reason: string): void {
    this.holdWith(reason, false)
  }

  resume(): void {
    this.paused = false
    this.pauseReason = null
    this.skipScanOnce = true
    const held = this.waiters
    this.waiters = []
    for (const waiter of held) waiter.resolve()
    this.pushState()
    this.emit('resumed')
  }

  cancel(): void {
    const error = new RunCancelledError()
    this.cancelError = error
    const wasHeld = this.paused
    this.paused = false
    this.pauseReason = null
    const held = this.waiters
    this.waiters = []
    for (const waiter of held) waiter.reject(error)
    for (const reject of this.cancelRejectors) reject(error)
    this.pushState()
    if (wasHeld) this.emit('resumed')
  }

  shutdownSync(): void {
    this.cancel()
    if (this.launched && this.endpoint) this.chrome.killNow(this.endpoint)
  }

  async openBrowser(): Promise<void> {
    if (this.browser) throw new Error('a run is using the automation browser — stop it first')
    if (await this.chrome.adopt()) return
    await this.chrome.launch()
  }

  async closeBrowser(): Promise<void> {
    if (this.browser) throw new Error('a run is using the automation browser — stop it first')
    const endpoint = await this.chrome.adopt()
    if (endpoint) await this.chrome.stop(endpoint)
  }

  async browserRunning(): Promise<boolean> {
    if (this.browser) return true
    return (await this.chrome.adopt()) !== null
  }

  // /json/version can answer before the websocket endpoint accepts sessions.
  private async connectWithRetry(endpoint: string): Promise<DriverBrowser> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.connectToEndpoint(endpoint)
      } catch (error) {
        if (attempt >= 2) throw error
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
  }

  private waitWhileHeld(): Promise<void> {
    if (!this.paused) return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }

  private holdWith(reason: string, automatic: boolean): void {
    this.paused = true
    this.pauseReason = reason
    this.pushState()
    this.emit('paused', reason, automatic, this.runContext)
  }

  private async dispatch(step: ActionStep): Promise<ExecResult> {
    await this.abandonStepIfPaused()

    for (let attempt = 0; ; attempt++) {
      await this.waitWhileHeld()
      if (this.cancelError) throw this.cancelError

      const heldBy = await this.scanHold(step)
      if (heldBy) {
        if (attempt >= MAX_HELD_RETRIES) {
          throw new Error(
            `this step was held ${attempt + 1} times (${heldBy}) — ` +
              'complete it yourself in the browser and resume, or cancel the run'
          )
        }
        if (attempt === 0) this.reportHold?.(heldBy)
        this.holdWith(heldBy, true)
        continue
      }

      const result = await this.execute(step)
      if (!result.ok) await this.abandonStepIfPaused()
      return result
    }
  }

  // An assert writes nothing, and holding one reports the wrong problem.
  private async scanHold(step: ActionStep): Promise<string | null> {
    if (step.kind === 'assert') return null
    if (this.skipScanOnce) {
      this.skipScanOnce = false
      return null
    }
    try {
      const page = this.requirePage()
      const reason = await this.callHooks(page.mainFrame(), 'scanSensitive')
      return typeof reason === 'string' ? reason : null
    } catch (error) {
      if (error instanceof UntrustedPageError) throw error
      return null
    }
  }

  private async execute(step: ActionStep): Promise<ExecResult> {
    if (step.kind === 'navigate') {
      try {
        assertNavigable(step.url)
        await this.raceCancel(this.requirePage().goto(step.url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS }))
        return { ok: true }
      } catch (error) {
        if (error instanceof RunCancelledError) throw error
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }

    if (step.kind === 'screenshot') {
      try {
        const frame = await this.requirePage().screenshot({
          type: 'jpeg',
          quality: 60,
          timeout: SCREENSHOT_TIMEOUT_MS
        })
        return { ok: true, value: frame.toString('base64') }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }

    this.stepInFlight = true
    try {
      const frame = await this.frameFor(step)
      const exec = this.callHooks(frame, 'exec', step) as Promise<ExecResult>
      return await this.raceCancel(this.withTimeout(exec, step))
    } catch (error) {
      if (error instanceof RunCancelledError || error instanceof StepIndeterminateError) throw error
      if (error instanceof UntrustedPageError) throw error
      const message = error instanceof Error ? error.message : String(error)
      if (DESTROYED.test(message)) return this.departedResult(step, message)
      return { ok: false, error: message }
    } finally {
      this.stepInFlight = false
    }
  }

  // A destroyed context means the step navigated; failing it would let the healer re-run a submit.
  private departedResult(step: ActionStep, message: string): ExecResult {
    if (step.kind === 'click' || step.kind === 'type' || step.kind === 'select' || step.kind === 'scroll') {
      return { ok: true, changed: true }
    }
    return { ok: false, error: `the page navigated away while this step was waiting — ${message}` }
  }

  private withTimeout(work: Promise<ExecResult>, step: ActionStep): Promise<ExecResult> {
    const budget = stepTimeout(step)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new StepIndeterminateError(step.kind, budget)), budget)
      work.then(resolve, reject).finally(() => clearTimeout(timer))
    })
  }

  private raceCancel<T>(work: Promise<T>): Promise<T> {
    if (this.cancelError) {
      work.catch(() => {})
      return Promise.reject(this.cancelError)
    }
    return new Promise<T>((resolve, reject) => {
      const rejector = (error: Error): void => reject(error)
      this.cancelRejectors.add(rejector)
      work.then(resolve, reject).finally(() => this.cancelRejectors.delete(rejector))
    })
  }

  private async frameFor(step: ActionStep): Promise<DriverFrame> {
    const page = this.requirePage()
    const main = page.mainFrame()
    const selector = step.kind === 'wait' ? step.forSelector : 'selector' in step ? step.selector : undefined
    if (!selector) return main

    const found = (await this.callHooks(main, 'find', selector).catch(() => null)) as { count: number } | null
    if (!found || found.count > 0) return main

    for (const frame of page.frames()) {
      if (frame === main) continue
      const inFrame = (await this.callHooks(frame, 'find', selector).catch(() => null)) as { count: number } | null
      if (inFrame && inFrame.count > 0) return frame
    }
    return main
  }

  private async callHooks(frame: DriverFrame, method: string, arg?: unknown): Promise<unknown> {
    const payload = { method, arg }
    let result = await this.timedEvaluate(frame, HOOKS_CALL, payload)
    if (isMissing(result)) {
      await this.timedEvaluate(frame, this.agentSource)
      result = await this.timedEvaluate(frame, HOOKS_CALL, payload)
    }
    if (isMissing(result)) throw new Error('the automation agent could not be injected into this page')

    const answer = result as { __nonce?: unknown; value?: unknown }
    if (answer.__nonce !== this.nonce) {
      throw new UntrustedPageError(
        'this page answered as the automation agent without the session key, so nothing it says is trusted'
      )
    }
    return answer.value
  }

  // Playwright's evaluate has no default timeout, so a wedged renderer would hang the run.
  private timedEvaluate(frame: DriverFrame, script: unknown, arg?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`the page stopped answering after ${HOOKS_TIMEOUT_MS / 1000}s`)),
        HOOKS_TIMEOUT_MS
      )
      frame.evaluate(script, arg).then(resolve, reject).finally(() => clearTimeout(timer))
    })
  }

  private onInput(source: DriverBindingSource, nonce: unknown, request: unknown): Promise<string> {
    if (nonce !== this.nonce || !this.stepInFlight || this.inputMode === 'synthetic') {
      return Promise.resolve('unavailable')
    }
    if (source.page !== this.activePage || source.frame !== source.page.mainFrame()) {
      return Promise.resolve('unavailable')
    }
    return this.dispatchInput(source.page, request as Record<string, unknown>)
  }

  private async dispatchInput(page: DriverPage, request: Record<string, unknown>): Promise<string> {
    let sent = 0
    try {
      if (request['action'] === 'click') {
        const x = Number(request['x'])
        const y = Number(request['y'])
        await page.mouse.move(x, y)
        sent += 1
        await page.mouse.down()
        sent += 1
        await page.mouse.up()
        sent += 1
        return 'ok'
      }
      if (request['action'] === 'type') {
        await page.keyboard.insertText(String(request['text'] ?? ''))
        sent += 1
        if (request['submit'] === true) {
          await page.keyboard.press('Enter')
          sent += 1
        }
        return 'ok'
      }
      return 'unavailable'
    } catch {
      return sent === 0 ? 'unavailable' : 'failed'
    }
  }

  private onControl(source: DriverBindingSource, nonce: unknown, type: unknown): BannerState | null {
    if (nonce !== this.nonce) return null
    if (type === 'state') return this.stateFor(source.page)
    if (source.page !== this.activePage || source.frame !== source.page.mainFrame()) return null
    if (type === 'pause') this.pause('paused by the user')
    if (type === 'resume') this.resume()
    return null
  }

  private stateFor(page: DriverPage): BannerState {
    if (this.ending || page !== this.activePage) return { state: 'idle', reason: null }
    if (this.paused) return { state: 'paused', reason: this.pauseReason }
    if (this.browser) return { state: 'active', reason: null }
    return { state: 'idle', reason: null }
  }

  private pushState(): void {
    for (const page of this.context?.pages() ?? []) {
      void this.callHooks(page.mainFrame(), 'render', this.stateFor(page)).catch(() => {})
    }
  }

  private async watchPage(page: DriverPage, fromEvent: boolean): Promise<void> {
    page.on('close', () => {
      const stackAt = this.pageStack.indexOf(page)
      if (stackAt >= 0) this.pageStack.splice(stackAt, 1)
      if (page !== this.activePage) return
      this.activePage = this.popOpenFromStack()
      this.pushState()
    })
    page.on('domcontentloaded', () => {
      void this.callHooks(page.mainFrame(), 'render', this.stateFor(page)).catch(() => {})
    })
    if (!fromEvent) return

    const opener = await page.opener().catch(() => null)
    if (opener && opener === this.activePage) {
      this.pageStack.push(this.activePage)
      this.activePage = page
      this.pushState()
    }
  }

  private popOpenFromStack(): DriverPage | null {
    const open = new Set(this.context?.pages() ?? [])
    while (this.pageStack.length > 0) {
      const candidate = this.pageStack.pop()
      if (candidate && open.has(candidate)) return candidate
    }
    return null
  }

  private async abandonStepIfPaused(): Promise<void> {
    if (!this.paused) return
    const reason = this.pauseReason
    await this.waitWhileHeld()
    throw new RunPausedError(reason)
  }

  private requirePage(): DriverPage {
    if (!this.activePage) throw new Error('the browser session is not connected')
    return this.activePage
  }
}

function isMissing(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>)['__missing'] === true
}

export function navAllowlist(raw = process.env['AUTOMATION_NAV_ALLOWLIST']): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0)
}

function hostAllowed(hostname: string, allowed: string[]): boolean {
  const host = hostname.toLowerCase()
  return allowed.some((entry) => host === entry || host.endsWith(`.${entry}`))
}

export function assertNavigable(url: string, allowed: string[] = navAllowlist()): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`navigation blocked: "${url}" is not a valid URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`navigation blocked: ${parsed.protocol} is not allowed (http and https only)`)
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error(`navigation blocked: ${parsed.hostname} was given credentials embedded in the URL`)
  }
  if (allowed.length > 0 && !hostAllowed(parsed.hostname, allowed)) {
    throw new Error(`navigation blocked: ${parsed.hostname} is not in AUTOMATION_NAV_ALLOWLIST`)
  }
}

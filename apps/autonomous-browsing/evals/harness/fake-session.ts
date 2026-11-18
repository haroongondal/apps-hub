import * as cheerio from 'cheerio'
import type { ActionStep } from '../../src/shared/types'
import {
  StepExecutionError,
  type AutomationSession,
  type PageSnapshot,
  type StepOutput
} from '../../src/main/automation/session'
import { loadPage, toSnapshot, type LoadedPage } from './fixtures'
import { resolveSelector, type Resolution } from './selector'
import type { GoalCase, TransitionRule } from './types'

const NOWHERE_HTML =
  '<html><head><title>Not found</title></head><body><main><h1>Not found</h1>' +
  '<p>Nothing is served at this address.</p></main></body></html>'

export class FakeSession implements AutomationSession {
  private pageId: string
  private page: LoadedPage
  private snapshots = 0
  readonly typed = new Map<string, string>()
  holds = 0

  constructor(
    private readonly pagesDir: string,
    private readonly world: GoalCase
  ) {
    this.pageId = world.start
    this.page = this.load(world.start)
  }

  currentPageId(): string {
    return this.pageId
  }

  private load(id: string): LoadedPage {
    const ref = this.world.pages[id]
    if (!ref) throw new Error(`goal case ${this.world.id} has no page "${id}"`)
    return loadPage(this.pagesDir, ref)
  }

  private goto(id: string): void {
    this.pageId = id
    this.page = this.load(id)
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  setRunContext(): void {}
  setHoldReporter(): void {}

  currentUrl(): string | null {
    return this.page.ref.url
  }

  async snapshot(): Promise<PageSnapshot> {
    this.snapshots++
    if (this.snapshots > this.world.stepCap) {
      throw new Error(`the eval budget of ${this.world.stepCap} looks at the page is spent`)
    }
    return toSnapshot(this.page)
  }

  async holdForHuman(): Promise<void> {
    this.holds++
    if (this.world.onHold) this.goto(this.world.onHold.goto)
  }

  async runStep(step: ActionStep): Promise<StepOutput> {
    switch (step.kind) {
      case 'navigate': {
        const rule = this.world.transitions.find(
          candidate => this.applies(candidate) && this.navigateMatches(candidate, step.url)
        )
        if (rule) this.goto(rule.goto)
        else this.gotoNowhere(step.url)
        return { changed: true }
      }
      case 'click':
      case 'type':
      case 'select': {
        const resolution = this.resolveOrThrow(step, step.selector)
        const key = resolution.marker ?? step.selector
        if (step.kind === 'type') this.mirror(resolution, key, step.text)
        if (step.kind === 'select') this.typed.set(key, step.value)

        const rule = this.world.transitions.find(
          candidate => this.applies(candidate) && this.actionMatches(candidate, step, resolution)
        )
        if (rule) {
          this.goto(rule.goto)
          return { changed: true }
        }
        return { changed: step.kind !== 'click' }
      }
      default:
        return {}
    }
  }

  async extractText(selector: string): Promise<string> {
    const step: ActionStep = { kind: 'extract', selector, into: '' }
    const resolution = this.resolveOrThrow(step, selector)
    return this.page.$(resolution.winner!).text().replace(/\s+/g, ' ').trim()
  }

  private resolveOrThrow(step: ActionStep, selector: string): Resolution {
    const resolution = resolveSelector(this.page.$, selector)
    if (resolution.problem) {
      throw new StepExecutionError(step, `could not use "${selector}" — ${resolution.problem}`)
    }
    if (resolution.marker && this.page.ref.covered?.includes(resolution.marker)) {
      throw new StepExecutionError(
        step,
        `could not use "${selector}" — the best match is covered by another element`
      )
    }
    return resolution
  }

  private mirror(resolution: Resolution, key: string, text: string): void {
    this.typed.set(key, text)
    const $el = this.page.$(resolution.winner!)
    if (resolution.winner!.name === 'textarea') $el.text(text)
    else $el.attr('value', text)
  }

  private applies(rule: TransitionRule): boolean {
    return rule.from === undefined || rule.from === this.pageId
  }

  private navigateMatches(rule: TransitionRule, url: string): boolean {
    if (rule.on.kind !== 'navigate') return false
    return new RegExp(rule.on.urlMatches ?? '', 'i').test(url)
  }

  private actionMatches(rule: TransitionRule, step: ActionStep, resolution: Resolution): boolean {
    if (rule.on.kind !== step.kind) return false
    if (rule.on.target !== undefined && rule.on.target !== resolution.marker) return false
    if (rule.on.submit && !(step.kind === 'type' && step.submit === true)) return false
    if (rule.on.textMatches !== undefined) {
      const text = step.kind === 'type' ? step.text : step.kind === 'select' ? step.value : ''
      if (!new RegExp(rule.on.textMatches, 'i').test(text)) return false
    }
    for (const [marker, pattern] of Object.entries(rule.on.filled ?? {})) {
      const value = this.typed.get(marker)
      if (value === undefined || !new RegExp(pattern, 'i').test(value)) return false
    }
    return true
  }

  private gotoNowhere(url: string): void {
    this.pageId = 'nowhere'
    this.page = { ref: { file: '', url }, $: cheerio.load(NOWHERE_HTML) }
  }
}

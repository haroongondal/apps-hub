import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as cheerio from 'cheerio'
import { isHealable } from '../src/main/automation/session'
import { FakeSession } from '../evals/harness/fake-session'
import { loadPage, toSnapshot } from '../evals/harness/fixtures'
import { gradeDecision, gradeGoal, gradeRepair } from '../evals/harness/grade'
import { decisionThread } from '../evals/harness/messages'
import { resolveSelector } from '../evals/harness/selector'
import type { DecisionCase, GoalCase, RepairCase } from '../evals/harness/types'

const pagesDir = path.resolve('evals/pages')

describe('resolveSelector', () => {
  const $ = cheerio.load(`
    <button hidden data-eval-target="ghost">Send</button>
    <button aria-label="Send message" data-eval-target="real"></button>
    <button disabled data-eval-target="dead">Send</button>
    <input name="q" placeholder="Search here" data-eval-target="box" />
  `)

  it('matches accessible text through :has-text, like content.js', () => {
    const found = resolveSelector($, 'button:has-text("Send")')
    expect(found.marker).toBe('real')
    expect(found.actionable).toBe(true)
  })

  it('prefers a usable match over hidden and disabled ones', () => {
    expect(resolveSelector($, 'button').marker).toBe('real')
  })

  it('reads placeholder text as accessible text', () => {
    expect(resolveSelector($, 'input:has-text("search here")').marker).toBe('box')
  })

  it('reports a page with no match', () => {
    const missing = resolveSelector($, '#nope')
    expect(missing.count).toBe(0)
    expect(missing.problem).toContain('nothing on this page')
  })

  it('reports an invalid selector instead of throwing', () => {
    expect(resolveSelector($, 'button:visible').invalid).toBe(true)
  })

  it('says why the only match is unusable', () => {
    expect(resolveSelector($, '[data-eval-target="dead"]').problem).toContain('disabled')
  })
})

describe('gradeDecision', () => {
  const kase: DecisionCase = {
    id: 'T-search',
    note: '',
    goal: 'Search for wireless headphones',
    page: { file: 'search-home.html', url: 'https://search.quokka.example/' },
    avoid: ['click button#go'],
    expect: { action: 'type', target: 'search-box', textMatches: 'headphones', submit: true },
    forbid: { actions: ['done'], selectorMatches: ':r\\d' }
  }
  const page = loadPage(pagesDir, kase.page)

  it('passes the intended decision', () => {
    const grade = gradeDecision(kase, page, {
      action: 'type',
      selector: 'input[name="q"]',
      text: 'wireless headphones',
      submit: true,
      step_description: 'Search'
    }, null)
    expect(grade).toEqual({ pass: true, reasons: [] })
  })

  it('fails a selector that resolves to the wrong element', () => {
    const grade = gradeDecision(kase, page, {
      action: 'type',
      selector: 'button:has-text("Quokka Search")',
      text: 'wireless headphones',
      submit: true,
      step_description: 'Search'
    }, null)
    expect(grade.pass).toBe(false)
    expect(grade.reasons.join(' ')).toContain('resolved to search-button')
  })

  it('fails a forbidden action, a missing submit, and an avoided selector', () => {
    expect(gradeDecision(kase, page, { action: 'done', step_description: 'x' }, null).pass).toBe(false)
    const noSubmit = gradeDecision(kase, page, {
      action: 'type',
      selector: 'input[name="q"]',
      text: 'wireless headphones',
      step_description: 'x'
    }, null)
    expect(noSubmit.reasons.join(' ')).toContain('submit')
    const avoided = gradeDecision(kase, page, {
      action: 'click',
      selector: 'button#go',
      step_description: 'x'
    }, null)
    expect(avoided.reasons.join(' ')).toContain('avoid list')
  })

  it('fails machine-generated selectors by pattern', () => {
    const grade = gradeDecision(kase, page, {
      action: 'type',
      selector: '#\\:r1\\:',
      text: 'wireless headphones',
      submit: true,
      step_description: 'x'
    }, null)
    expect(grade.reasons.join(' ')).toContain('forbidden pattern')
  })

  it('accepts navigate through urlMatches when target and url are alternatives', () => {
    const alt: DecisionCase = {
      ...kase,
      avoid: [],
      expect: { action: ['click', 'navigate'], target: 'search-button', urlMatches: 'quokka\\.example/search' },
      forbid: {}
    }
    const grade = gradeDecision(alt, page, {
      action: 'navigate',
      text: 'https://search.quokka.example/search?q=headphones',
      step_description: 'x'
    }, null)
    expect(grade).toEqual({ pass: true, reasons: [] })
  })

  it('fails a prose reply that never called the tool', () => {
    const grade = gradeDecision(kase, page, null, 'I would type into the box.')
    expect(grade.pass).toBe(false)
  })
})

describe('gradeRepair', () => {
  const kase: RepairCase = {
    id: 'T-repair',
    note: '',
    goal: 'Subscribe',
    steps: [{ kind: 'click', selector: 'button.old', intent: 'Subscribe' }],
    failingIndex: 0,
    problem: 'covered',
    page: { file: 'cookie-consent.html', url: 'https://morningpost.example/' },
    expect: { verdict: 'repair', firstTarget: ['consent-accept', 'consent-reject'], lastTarget: 'subscribe' }
  }
  const page = loadPage(pagesDir, kase.page)

  it('passes a dismissal followed by the real click', () => {
    const grade = gradeRepair(kase, page, {
      verdict: 'repair',
      reason: 'a consent dialog covers the button',
      actions: [
        { action: 'click', selector: 'button:has-text("Reject non-essential")', step_description: 'Dismiss' },
        { action: 'click', selector: 'button:has-text("Subscribe")', step_description: 'Subscribe' }
      ]
    })
    expect(grade).toEqual({ pass: true, reasons: [] })
  })

  it('fails the wrong verdict and an empty repair', () => {
    expect(gradeRepair(kase, page, { verdict: 'proceed', reason: 'fine' }).pass).toBe(false)
    expect(gradeRepair(kase, page, { verdict: 'repair', reason: 'r', actions: [] }).pass).toBe(false)
  })
})

const world: GoalCase = {
  id: 'T-goal',
  note: '',
  goal: 'search then open',
  start: 'home',
  pages: {
    home: { file: 'search-home.html', url: 'https://search.quokka.example/' },
    post: { file: 'cookie-consent.html', url: 'https://morningpost.example/', covered: ['subscribe'] },
    results: { file: 'search-results.html', url: 'https://search.quokka.example/search?q=x' }
  },
  transitions: [
    { on: { kind: 'type', target: 'search-box', submit: true, textMatches: 'headphone' }, goto: 'results' },
    { on: { kind: 'navigate', urlMatches: 'morningpost' }, goto: 'post' }
  ],
  onHold: { goto: 'results' },
  stepCap: 2,
  expect: { status: 'done', finalPage: 'results' }
}

describe('FakeSession', () => {
  it('mirrors typed text into the next snapshot, then transitions on submit', async () => {
    const session = new FakeSession(pagesDir, world)
    await session.runStep({ kind: 'type', selector: 'input[name="q"]', text: 'wireless headphones' })
    expect((await session.snapshot()).dom).toContain('value="wireless headphones"')
    expect(session.currentPageId()).toBe('home')

    await session.runStep({ kind: 'type', selector: 'input[name="q"]', text: 'headphones', submit: true })
    expect(session.currentPageId()).toBe('results')
  })

  it('throws a healable error for a missing selector and reports a click no-op', async () => {
    const session = new FakeSession(pagesDir, world)
    await expect(session.runStep({ kind: 'click', selector: '#nope' })).rejects.toSatisfy(isHealable)
    await expect(session.runStep({ kind: 'click', selector: 'button:has-text("Quokka Search")' })).resolves.toEqual({
      changed: false
    })
  })

  it('refuses a covered target the way a timed-out click would', async () => {
    const session = new FakeSession(pagesDir, world)
    await session.runStep({ kind: 'navigate', url: 'https://morningpost.example/' })
    expect(session.currentPageId()).toBe('post')
    await expect(
      session.runStep({ kind: 'click', selector: 'button:has-text("Subscribe")' })
    ).rejects.toThrow('covered')
  })

  it('lands on a built-in empty page for an unmapped navigate', async () => {
    const session = new FakeSession(pagesDir, world)
    await session.runStep({ kind: 'navigate', url: 'https://elsewhere.example/' })
    expect(session.currentPageId()).toBe('nowhere')
    expect((await session.snapshot()).url).toBe('https://elsewhere.example/')
  })

  it('spends its snapshot budget, then throws an unhealable error', async () => {
    const session = new FakeSession(pagesDir, world)
    await session.snapshot()
    await session.snapshot()
    await expect(session.snapshot()).rejects.toThrow('budget')
  })

  it('moves the page a hand-off cleared', async () => {
    const session = new FakeSession(pagesDir, world)
    await session.holdForHuman()
    expect(session.holds).toBe(1)
    expect(session.currentPageId()).toBe('results')
  })

  it('reads text back for an extract', async () => {
    const session = new FakeSession(pagesDir, world)
    await expect(session.extractText('h1')).resolves.toBe('Quokka Search')
  })
})

describe('gradeGoal', () => {
  it('grades status, final page, holds and typed values', async () => {
    const session = new FakeSession(pagesDir, world)
    await session.runStep({ kind: 'type', selector: 'input[name="q"]', text: 'wireless headphones', submit: true })
    const grade = gradeGoal(world, session, { status: 'done' })
    expect(grade).toEqual({ pass: true, reasons: [] })

    const wrong = gradeGoal(world, session, { status: 'error', error: 'boom' })
    expect(wrong.reasons.join(' ')).toContain('boom')

    const wantsValues: GoalCase = {
      ...world,
      expect: { status: 'done', values: [{ target: 'search-box', matches: '^nope$' }] }
    }
    expect(gradeGoal(wantsValues, session, { status: 'done' }).pass).toBe(false)
  })

  async function onResults(expectation: GoalCase['expect']): Promise<{
    kase: GoalCase
    session: FakeSession
  }> {
    const session = new FakeSession(pagesDir, world)
    await session.runStep({ kind: 'type', selector: 'input[name="q"]', text: 'wireless headphones', submit: true })
    return { kase: { ...world, expect: expectation }, session }
  }

  it('fails a run whose sign-off claims what the case forbids', async () => {
    const { kase, session } = await onResults({
      status: 'done',
      finalPage: 'results',
      forbidFinalMatches: 'only the executive team'
    })

    const grade = gradeGoal(kase, session, {
      status: 'done',
      description: 'NAMES_STAFF=no DETAIL=the page lists only the executive team'
    })

    expect(grade.pass).toBe(false)
    expect(grade.reasons.join(' ')).toContain('forbids')
  })

  it('passes the same run when its sign-off says what the page really showed', async () => {
    const { kase, session } = await onResults({
      status: 'done',
      finalPage: 'results',
      forbidFinalMatches: 'only the executive team'
    })

    const grade = gradeGoal(kase, session, {
      status: 'done',
      description: 'NAMES_STAFF=no DETAIL=the page returned "Sorry, A Problem Occurred"'
    })

    expect(grade).toEqual({ pass: true, reasons: [] })
  })

  it('accepts any of the endings a case lists, and nothing else', async () => {
    const { kase, session } = await onResults({ status: ['done', 'assisted'], finalPage: 'results' })

    expect(gradeGoal(kase, session, { status: 'assisted' }).pass).toBe(true)
    expect(gradeGoal(kase, session, { status: 'error', error: 'boom' }).pass).toBe(false)
  })
})

describe('decisionThread', () => {
  const page = loadPage(pagesDir, { file: 'search-home.html', url: 'https://search.quokka.example/' })
  const snapshot = toSnapshot(page)

  it('sends goal and page as two text blocks on a first look', () => {
    const thread = decisionThread('Search', snapshot, [], [])
    expect(thread).toHaveLength(1)
    const content = thread[0]!.content as Array<{ type: string; text: string }>
    expect(content[0]!.text).toBe('Goal: Search')
    expect(content[1]!.text).toContain('Filtered page DOM')
  })

  it('replays prior turns pruned, with the page only on the last tool_result', () => {
    const thread = decisionThread(
      'Search',
      snapshot,
      [
        { decision: { action: 'click', selector: 'a', step_description: 'x' }, outcome: 'x — FAILED' },
        { decision: { action: 'click', selector: 'b', step_description: 'y' }, outcome: 'y — it ran' }
      ],
      ['click a']
    )
    expect(thread).toHaveLength(5)
    const older = (thread[2]!.content as Array<{ content: unknown[] }>)[0]!
    const latest = (thread[4]!.content as Array<{ content: unknown[]; tool_use_id: string }>)[0]!
    expect(older.content).toHaveLength(1)
    expect(latest.content).toHaveLength(2)
    expect(latest.tool_use_id).toBe('eval-prior-1')
  })
})

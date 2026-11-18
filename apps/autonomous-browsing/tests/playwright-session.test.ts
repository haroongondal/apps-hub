import { describe, expect, it, vi } from 'vitest'
import type { ChromeProcess } from '../src/main/automation/chrome-process'
import {
  PlaywrightSession,
  assertNavigable,
  navAllowlist,
  type DriverBindingSource,
  type DriverBrowser,
  type DriverContext,
  type DriverFrame,
  type DriverPage
} from '../src/main/automation/playwright-session'
import { isHealable, RunCancelledError, RunPausedError, StepExecutionError } from '../src/main/automation/session'
import type { ActionStep } from '../src/shared/types'

type Binding = (source: DriverBindingSource, ...args: unknown[]) => unknown

interface World {
  scanQueue: Array<string | null>
  scans: number
  execHandler: (step: ActionStep, frame: FakeFrame) => Promise<unknown> | unknown
  domHandler: () => unknown
  findHandler: (selector: string, frame: FakeFrame) => unknown
  renders: Array<{ page: FakePage; state: unknown }>
  bindings: Map<string, Binding>
  initScripts: string[]
  pageListeners: Array<(page: DriverPage) => void>
  input: string[]
  chromeCalls: string[]
  adoptResult: { port: number; pid: number } | null
}

class FakeFrame implements DriverFrame {
  injected = false
  answerNonce: string | null = null

  constructor(
    private readonly world: World,
    readonly page: FakePage,
    private readonly isMain: boolean
  ) {}

  parentFrame(): DriverFrame | null {
    return this.isMain ? null : this.page.mainFrame()
  }

  async evaluate(script: unknown, arg?: unknown): Promise<unknown> {
    if (typeof script === 'string') {
      this.injected = true
      return undefined
    }
    if (!this.injected) return { __missing: true }

    const payload = arg as { method: string; arg?: unknown }
    return { __nonce: this.answerNonce ?? nonceOf(this.world), value: await this.answer(payload) }
  }

  private async answer(payload: { method: string; arg?: unknown }): Promise<unknown> {
    if (payload.method === 'scanSensitive') {
      this.world.scans += 1
      return this.world.scanQueue.shift() ?? null
    }
    if (payload.method === 'exec') return this.world.execHandler(payload.arg as ActionStep, this)
    if (payload.method === 'dom') return this.world.domHandler()
    if (payload.method === 'find') return this.world.findHandler(payload.arg as string, this)
    if (payload.method === 'render') {
      this.world.renders.push({ page: this.page, state: payload.arg })
      return undefined
    }
    throw new Error(`fake page got an unexpected method: ${payload.method}`)
  }
}

class FakePage implements DriverPage {
  readonly main: FakeFrame
  readonly children: FakeFrame[] = []
  readonly gotos: string[] = []
  readonly listeners = new Map<string, Array<() => void>>()
  openerPage: FakePage | null = null
  screenshotHandler: () => Buffer = () => {
    throw new Error('no frame was captured in this fake')
  }

  readonly mouse = {
    move: async (): Promise<void> => void this.world.input.push('move'),
    down: async (): Promise<void> => void this.world.input.push('down'),
    up: async (): Promise<void> => void this.world.input.push('up')
  }

  readonly keyboard = {
    insertText: async (text: string): Promise<void> => void this.world.input.push(`insert:${text}`),
    press: async (key: string): Promise<void> => void this.world.input.push(`press:${key}`)
  }

  constructor(
    private readonly world: World,
    private readonly address = 'https://example.com/',
    injected = true
  ) {
    this.main = new FakeFrame(world, this, true)
    this.main.injected = injected
  }

  url(): string {
    return this.address
  }

  mainFrame(): DriverFrame {
    return this.main
  }

  frames(): DriverFrame[] {
    return [this.main, ...this.children]
  }

  async screenshot(): Promise<Buffer> {
    return this.screenshotHandler()
  }

  async goto(url: string): Promise<unknown> {
    this.gotos.push(url)
    return null
  }

  async bringToFront(): Promise<void> {}

  async opener(): Promise<DriverPage | null> {
    return this.openerPage
  }

  on(event: 'close' | 'domcontentloaded', listener: () => void): void {
    const existing = this.listeners.get(event) ?? []
    existing.push(listener)
    this.listeners.set(event, existing)
  }

  emit(event: 'close' | 'domcontentloaded'): void {
    for (const listener of this.listeners.get(event) ?? []) listener()
  }

  addChildFrame(): FakeFrame {
    const frame = new FakeFrame(this.world, this, false)
    frame.injected = true
    this.children.push(frame)
    return frame
  }
}

class FakeContext implements DriverContext {
  readonly openPages: FakePage[] = []

  constructor(private readonly world: World) {}

  pages(): DriverPage[] {
    return this.openPages
  }

  async newPage(): Promise<DriverPage> {
    const page = new FakePage(this.world)
    this.openPages.push(page)
    return page
  }

  async exposeBinding(name: string, binding: Binding): Promise<void> {
    this.world.bindings.set(name, binding)
  }

  async addInitScript(script: string): Promise<void> {
    this.world.initScripts.push(script)
  }

  on(_event: 'page', listener: (page: DriverPage) => void): void {
    this.world.pageListeners.push(listener)
  }

  openPage(page: FakePage): void {
    this.openPages.push(page)
    for (const listener of this.world.pageListeners) listener(page)
  }

  closePage(page: FakePage): void {
    const at = this.openPages.indexOf(page)
    if (at >= 0) this.openPages.splice(at, 1)
    page.emit('close')
  }
}

function nonceOf(world: World): string {
  const match = /const NONCE = (\"[0-9a-f-]+\")/.exec(world.initScripts[0] ?? '')
  if (!match) throw new Error('the adapter nonce was not found in the init script')
  return JSON.parse(match[1]!) as string
}

function makeWorld(
  inputMode = 'auto'
): { world: World; session: PlaywrightSession; context: FakeContext; chrome: ChromeProcess } {
  const world: World = {
    scanQueue: [],
    scans: 0,
    execHandler: () => ({ ok: true, changed: true, committing: false, via: 'synthetic' }),
    domHandler: () => ({ dom: '<html><body><h1>Fixture</h1></body></html>', title: 'Fixture', blockedBy: null }),
    findHandler: () => ({ count: 1, winningRank: 4 }),
    renders: [],
    bindings: new Map(),
    initScripts: [],
    pageListeners: [],
    input: [],
    chromeCalls: [],
    adoptResult: null
  }

  const context = new FakeContext(world)
  const browser: DriverBrowser = {
    contexts: () => [context],
    newContext: async () => context,
    close: async () => void world.chromeCalls.push('browser.close')
  }

  const chrome = {
    adopt: async () => {
      world.chromeCalls.push('adopt')
      return world.adoptResult
    },
    launch: async () => {
      world.chromeCalls.push('launch')
      return { port: 9555, pid: 12 }
    },
    stop: async () => {
      world.chromeCalls.push('stop')
    },
    killNow: () => {
      world.chromeCalls.push('killNow')
    }
  } as unknown as ChromeProcess

  const session = new PlaywrightSession(chrome, inputMode, async () => browser)
  return { world, session, context, chrome }
}

async function connected(): Promise<ReturnType<typeof makeWorld> & { page: FakePage }> {
  const made = makeWorld()
  const page = new FakePage(made.world)
  made.context.openPages.push(page)
  await made.session.connect()
  return { ...made, page }
}

const CLICK: ActionStep = { kind: 'click', selector: '#go' }

describe('running steps through the injected engine', () => {
  it('passes the engine outcome through, flags and all', async () => {
    const { session, world } = await connected()
    world.execHandler = () => ({ ok: true, changed: false, committing: true, via: 'cdp' })

    expect(await session.runStep(CLICK)).toEqual({ changed: false, committing: true, via: 'cdp' })
  })

  it('turns an engine failure into a healable StepExecutionError', async () => {
    const { session, world } = await connected()
    world.execHandler = () => ({ ok: false, error: 'timed out waiting for #go — nothing on this page matches it' })

    const failure = await session.runStep(CLICK).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(StepExecutionError)
    expect(isHealable(failure)).toBe(true)
  })

  it('keeps the credential refusal non-healable', async () => {
    const { session, world } = await connected()
    world.execHandler = () => ({
      ok: false,
      error: 'refusing to write into a password field — fill it in yourself, then run this again'
    })

    const failure = await session
      .runStep({ kind: 'type', selector: '#pw', text: 'x' })
      .catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(StepExecutionError)
    expect(isHealable(failure)).toBe(false)
  })

  it('substitutes {{params}} before the engine sees the step', async () => {
    const { session, world } = await connected()
    let seen: ActionStep | null = null
    world.execHandler = (step) => {
      seen = step
      return { ok: true }
    }

    await session.runStep({ kind: 'type', selector: '#q', text: '{{query}}' }, { query: 'oat milk' })
    expect(seen).toMatchObject({ text: 'oat milk' })
  })

  it('answers extract steps without touching the page — the caller stores values via extractText', async () => {
    const { session, world } = await connected()
    world.execHandler = () => {
      throw new Error('the engine must not run for extract steps')
    }

    expect(await session.runStep({ kind: 'extract', selector: '#price', into: 'price' })).toEqual({})
  })

  it('trims and caps extractText', async () => {
    const { session, world } = await connected()
    world.execHandler = () => ({ ok: true, value: `  ${'x'.repeat(20_000)}  ` })

    const text = await session.extractText('#body')
    expect(text).toHaveLength(10_000)
  })
})

describe('the sensitive-field hold loop', () => {
  it('parks on a scan hit, reports the hold once, and runs after resume without re-scanning', async () => {
    const { session, world } = await connected()
    world.scanQueue = ['password field']
    const holds: string[] = []
    const pauses: Array<{ reason: string; automatic: boolean }> = []
    session.setHoldReporter((reason) => holds.push(reason))
    session.on('paused', (reason, automatic) => pauses.push({ reason: reason as string, automatic: automatic as boolean }))

    const running = session.runStep(CLICK)
    await vi.waitFor(() => expect(session.isPaused).toBe(true))
    expect(holds).toEqual(['password field'])
    expect(pauses).toEqual([{ reason: 'password field', automatic: true }])

    session.resume()
    expect(await running).toMatchObject({ changed: true })
    expect(world.scans).toBe(1)
  })

  // A checkout confirmation keeps the card form mounted, so scanning an assert
  // would report a sensitive field instead of the verdict the Author asked for.
  it('never holds an assert, so a card field cannot fake an assertion failure', async () => {
    const { session, world } = await connected()
    world.scanQueue = ['payment field', 'payment field', 'payment field']

    await session.runStep({ kind: 'assert', selector: '#done' })

    expect(world.scans).toBe(0)
    expect(session.isPaused).toBe(false)
  })

  it('leaves the resume grace intact for the next step that does scan', async () => {
    const { session, world } = await connected()
    world.scanQueue = ['password field']
    session.on('paused', () => queueMicrotask(() => session.resume()))

    await session.runStep(CLICK)
    await session.runStep({ kind: 'assert', selector: '#done' })
    await session.runStep(CLICK)
    expect(world.scans).toBe(2)
  })

  it('scans again on later steps once the resume grace is spent', async () => {
    const { session, world } = await connected()
    world.scanQueue = ['one-time code']
    session.on('paused', () => queueMicrotask(() => session.resume()))

    await session.runStep(CLICK)
    await session.runStep(CLICK)
    expect(world.scans).toBe(2)
  })
})

describe('pause, resume, and cancel', () => {
  it('abandons a step dispatched while paused, as the extension backend does', async () => {
    const { session } = await connected()
    session.pause('the user hit pause')

    const running = session.runStep(CLICK)
    session.resume()
    await expect(running).rejects.toThrow(RunPausedError)
  })

  it('announces the hold is over when a cancel clears it', async () => {
    const { session } = await connected()
    session.pause('a password field')
    let resumes = 0
    session.on('resumed', () => resumes++)

    session.cancel()

    expect(resumes).toBe(1)
  })

  it('does not announce a resume when a cancel had no hold to clear', async () => {
    const { session } = await connected()
    let resumes = 0
    session.on('resumed', () => resumes++)

    session.cancel()

    expect(resumes).toBe(0)
  })

  it('rejects a parked step when the run is cancelled', async () => {
    const { session, world } = await connected()
    world.scanQueue = ['password field']

    const running = session.runStep(CLICK)
    await vi.waitFor(() => expect(session.isPaused).toBe(true))
    session.cancel()

    await expect(running).rejects.toThrow(RunCancelledError)
  })

  it('rejects a step whose page call never returns when the run is cancelled', async () => {
    const { session, world } = await connected()
    world.execHandler = () => new Promise(() => {})

    const running = session.runStep(CLICK)
    await vi.waitFor(() => expect(world.scans).toBe(1))
    session.cancel()

    await expect(running).rejects.toThrow(RunCancelledError)
  })

  it('parks snapshots while held and releases them on resume', async () => {
    const { session } = await connected()
    session.pause('checking something')

    let landed = false
    const taking = session.snapshot().then((snapshot) => {
      landed = true
      return snapshot
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(landed).toBe(false)

    session.resume()
    const snapshot = await taking
    expect(snapshot.dom).toContain('Fixture')
  })

  it('refuses to connect while paused, so a queued entry cannot clear a hold', async () => {
    const { session } = await connected()
    session.pause('a password field')

    await expect(session.connect()).rejects.toThrow(
      'the browser is paused — resume or cancel before starting another run'
    )
    expect(session.isPaused).toBe(true)
  })

  it('holdForHuman emits a non-automatic pause and waits for resume', async () => {
    const { session } = await connected()
    const pauses: boolean[] = []
    session.on('paused', (_reason, automatic) => pauses.push(automatic as boolean))

    const holding = session.holdForHuman('log in, then resume')
    expect(session.pausedBecause).toBe('log in, then resume')
    session.resume()
    await holding

    expect(pauses).toEqual([false])
  })
})

describe('navigation', () => {
  it('refuses non-web protocols before the browser sees them', async () => {
    const { session, page } = await connected()

    await expect(session.runStep({ kind: 'navigate', url: 'javascript:alert(1)' })).rejects.toThrow(
      /javascript: is not allowed/
    )
    expect(page.gotos).toEqual([])
  })

  it('navigates to web URLs through the active page', async () => {
    const { session, page } = await connected()

    await session.runStep({ kind: 'navigate', url: 'https://example.org/cart' })
    expect(page.gotos).toEqual(['https://example.org/cart'])
  })

  it('rejects malformed URLs with the message the model can act on', () => {
    expect(() => assertNavigable('not a url')).toThrow(/is not a valid URL/)
  })

  it('refuses credentials smuggled into the authority', () => {
    expect(() => assertNavigable('https://user:secret@evil.example/')).toThrow(/credentials embedded/)
  })

  it('allows any host when no allowlist is configured', () => {
    expect(() => assertNavigable('https://anywhere.example/', [])).not.toThrow()
  })

  it('holds an allowlisted run to its hosts and their subdomains', () => {
    const allowed = ['example.com']

    expect(() => assertNavigable('https://example.com/orders', allowed)).not.toThrow()
    expect(() => assertNavigable('https://shop.example.com/orders', allowed)).not.toThrow()
    expect(() => assertNavigable('https://evil.example/collect?d=stolen', allowed)).toThrow(
      /evil\.example is not in AUTOMATION_NAV_ALLOWLIST/
    )
  })

  it('does not let a lookalike host pass as a suffix of an allowed one', () => {
    expect(() => assertNavigable('https://notexample.com/', ['example.com'])).toThrow(/is not in/)
  })

  it('reads the allowlist from the environment as a comma-separated list', () => {
    expect(navAllowlist('example.com, Shop.Example.org ,')).toEqual(['example.com', 'shop.example.org'])
    expect(navAllowlist(undefined)).toEqual([])
  })
})

describe('a page that impersonates the injected engine', () => {
  it('refuses an answer that does not carry the session key', async () => {
    const { session, page } = await connected()
    page.main.answerNonce = 'not-the-session-key'

    await expect(session.snapshot()).rejects.toThrow(/without the session key/)
  })

  it('never sends the session key into the page', async () => {
    const { session, world, page } = await connected()
    const seen: unknown[] = []
    const realEvaluate = page.main.evaluate.bind(page.main)
    page.main.evaluate = async (script: unknown, arg?: unknown): Promise<unknown> => {
      if (typeof script !== 'string') seen.push(arg)
      return realEvaluate(script, arg)
    }

    world.domHandler = () => ({ dom: '<p>hi</p>', title: 'ok', blockedBy: null })
    await session.snapshot()

    expect(seen.length).toBeGreaterThan(0)
    expect(JSON.stringify(seen)).not.toContain(nonceOf(world))
  })

  it('locks its hooks against replacement rather than trusting a name', async () => {
    const { world } = await connected()

    expect(world.initScripts[0]).toContain("Object.defineProperty(window, '__oaHooks'")
    expect(world.initScripts[0]).toContain('configurable: false')
    expect(world.initScripts[0]).toContain('delete window.__oaCore')
  })
})

describe('a step that navigates its own page away', () => {
  it('reports a destroyed context as the click having worked', async () => {
    const { session, world } = await connected()
    world.execHandler = () => {
      throw new Error('Execution context was destroyed, most likely because of a navigation')
    }

    expect(await session.runStep(CLICK)).toMatchObject({ changed: true })
  })

  it('fails a wait that lost its page, so the loop retries on the new one', async () => {
    const { session, world } = await connected()
    world.execHandler = () => {
      throw new Error('Execution context was destroyed, most likely because of a navigation')
    }

    const failure = await session.runStep({ kind: 'wait', forSelector: '#done' }).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(StepExecutionError)
    expect((failure as Error).message).toMatch(/navigated away/)
  })
})

describe('snapshots', () => {
  it('filters the captured DOM and carries the wall verdict', async () => {
    const { session, world } = await connected()
    world.domHandler = () => ({
      dom: '<html><body><h1>Checkout</h1><script>tracking()</script></body></html>',
      title: 'Checkout',
      blockedBy: 'Cloudflare check'
    })

    const snapshot = await session.snapshot()
    expect(snapshot.title).toBe('Checkout')
    expect(snapshot.blockedBy).toBe('Cloudflare check')
    expect(snapshot.dom).toContain('Checkout')
    expect(snapshot.dom).not.toContain('tracking()')
    expect(snapshot.screenshotError).toMatch(/no frame was captured/)
  })

  it('keeps the URL and the screenshot error when the DOM cannot be read', async () => {
    const { session, world } = await connected()
    world.domHandler = () => {
      throw new Error('Execution context was destroyed')
    }

    const snapshot = await session.snapshot()
    expect(snapshot.url).toBe('https://example.com/')
    expect(snapshot.dom).toBe('')
    expect(snapshot.domError).toMatch(/context was destroyed/)
  })
})

describe('reaching pages the init script never saw', () => {
  it('injects the agent into an already-open page and then runs the step', async () => {
    const made = makeWorld()
    const page = new FakePage(made.world, 'https://example.com/', false)
    made.context.openPages.push(page)
    await made.session.connect()

    expect(await made.session.runStep(CLICK)).toMatchObject({ changed: true })
    expect(page.main.injected).toBe(true)
  })
})

describe('frames', () => {
  it('runs the step inside the frame that has the selector when the top document does not', async () => {
    const { session, page, world } = await connected()
    const child = page.addChildFrame()
    const ranIn: DriverFrame[] = []
    world.findHandler = (_selector, frame) => ({ count: frame === child ? 1 : 0, winningRank: 4 })
    world.execHandler = (_step, frame) => {
      ranIn.push(frame)
      return { ok: true, changed: true }
    }

    await session.runStep(CLICK)
    expect(ranIn).toEqual([child])
  })
})

describe('tabs', () => {
  it('follows a popup the active page opened and falls back when it closes', async () => {
    const { session, world, context, page } = await connected()
    const popup = new FakePage(world, 'https://accounts.example/oauth')
    popup.openerPage = page
    context.openPage(popup)
    await vi.waitFor(async () => {
      const snapshot = await session.snapshot()
      expect(snapshot.url).toBe('https://accounts.example/oauth')
    })

    context.closePage(popup)
    expect((await session.snapshot()).url).toBe('https://example.com/')
  })

  it('ignores a tab the user opened themselves mid-run', async () => {
    const { session, world, context } = await connected()
    const unrelated = new FakePage(world, 'https://news.example/')
    context.openPage(unrelated)

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect((await session.snapshot()).url).toBe('https://example.com/')
  })

  it('does not retarget to an unrelated tab when the automated page closes', async () => {
    const { session, world, context, page } = await connected()
    const unrelated = new FakePage(world, 'https://news.example/')
    context.openPage(unrelated)

    context.closePage(page)
    await expect(session.snapshot()).rejects.toThrow(/not connected/)
  })
})

describe('trusted input over the bindings', () => {
  async function midStep(
    made: Awaited<ReturnType<typeof connected>>,
    request: Record<string, unknown>,
    source?: Partial<DriverBindingSource>
  ): Promise<string> {
    const { session, world, page } = made
    let verdict = ''
    world.execHandler = async () => {
      const input = world.bindings.get('__oaInput')!
      verdict = (await input(
        { page: source?.page ?? page, frame: source?.frame ?? page.mainFrame() },
        nonceOf(world),
        request
      )) as string
      return { ok: true, via: verdict === 'ok' ? 'cdp' : 'synthetic' }
    }
    await session.runStep(CLICK)
    return verdict
  }

  it('performs a click as move, down, up — the same sequence the extension sends', async () => {
    const made = await connected()
    expect(await midStep(made, { action: 'click', x: 10, y: 20 })).toBe('ok')
    expect(made.world.input).toEqual(['move', 'down', 'up'])
  })

  it('types by inserting text and pressing Enter only when the step submits', async () => {
    const made = await connected()
    expect(await midStep(made, { action: 'type', text: 'oat milk', submit: true })).toBe('ok')
    expect(made.world.input).toEqual(['insert:oat milk', 'press:Enter'])
  })

  it('answers unavailable to a wrong nonce', async () => {
    const made = await connected()
    let verdict = ''
    made.world.execHandler = async () => {
      const input = made.world.bindings.get('__oaInput')!
      verdict = (await input({ page: made.page, frame: made.page.mainFrame() }, 'forged', {
        action: 'click',
        x: 1,
        y: 1
      })) as string
      return { ok: true }
    }

    await made.session.runStep(CLICK)
    expect(verdict).toBe('unavailable')
    expect(made.world.input).toEqual([])
  })

  it('answers unavailable outside a step, so a page cannot forge user gestures at rest', async () => {
    const made = await connected()
    const input = made.world.bindings.get('__oaInput')!
    const verdict = await input({ page: made.page, frame: made.page.mainFrame() }, nonceOf(made.world), {
      action: 'click',
      x: 1,
      y: 1
    })
    expect(verdict).toBe('unavailable')
  })

  it('answers unavailable from a child frame, whose coordinates would land in the wrong place', async () => {
    const made = await connected()
    const child = made.page.addChildFrame()
    expect(await midStep(made, { action: 'click', x: 1, y: 1 }, { frame: child })).toBe('unavailable')
  })

  it('answers unavailable when input is pinned synthetic', async () => {
    const made = makeWorld('synthetic')
    const page = new FakePage(made.world)
    made.context.openPages.push(page)
    await made.session.connect()

    let verdict = ''
    made.world.execHandler = async () => {
      const input = made.world.bindings.get('__oaInput')!
      verdict = (await input({ page, frame: page.mainFrame() }, nonceOf(made.world), {
        action: 'click',
        x: 1,
        y: 1
      })) as string
      return { ok: true }
    }

    await made.session.runStep(CLICK)
    expect(verdict).toBe('unavailable')
  })
})

describe('the banner control binding', () => {
  it('pauses as the user when the banner button asks, and reports state per page', async () => {
    const { session, world, page } = await connected()
    const control = world.bindings.get('__oaControl')!
    const source = { page, frame: page.mainFrame() }
    const parsed = nonceOf(world)

    control(source, parsed, 'pause')
    expect(session.isPaused).toBe(true)
    expect(session.pausedBecause).toBe('paused by the user')
    expect(control(source, parsed, 'state')).toEqual({ state: 'paused', reason: 'paused by the user' })

    control(source, parsed, 'resume')
    expect(session.isPaused).toBe(false)
    expect(control(source, parsed, 'state')).toEqual({ state: 'active', reason: null })

    const other = new FakePage(world, 'https://other.example/')
    expect(control({ page: other, frame: other.mainFrame() }, parsed, 'state')).toEqual({
      state: 'idle',
      reason: null
    })

    expect(control(source, 'forged', 'state')).toBeNull()

    const bg = new FakePage(world, 'https://bg.example/')
    control({ page: bg, frame: bg.mainFrame() }, parsed, 'pause')
    expect(session.isPaused).toBe(false)
  })
})

describe('browser lifecycle', () => {
  it('leaves the browser it launched open when the run ends', async () => {
    const { session, world } = await connected()
    world.chromeCalls.length = 0

    await session.disconnect()
    expect(world.chromeCalls).toEqual(['browser.close'])
  })

  it('forgets the browser once a run ends, so quitting no longer kills it', async () => {
    const { session, world } = await connected()
    await session.disconnect()
    world.chromeCalls.length = 0

    session.shutdownSync()
    expect(world.chromeCalls).toEqual([])
  })

  it('leaves an adopted browser running for the user', async () => {
    const made = makeWorld()
    made.world.adoptResult = { port: 9555, pid: 12 }
    const page = new FakePage(made.world)
    made.context.openPages.push(page)
    await made.session.connect()
    made.world.chromeCalls.length = 0

    await made.session.disconnect()
    expect(made.world.chromeCalls).toEqual(['browser.close'])
  })

  it('opens the pre-login browser only when none is running', async () => {
    const made = makeWorld()

    made.world.adoptResult = null
    await made.session.openBrowser()
    expect(made.world.chromeCalls).toEqual(['adopt', 'launch'])

    made.world.chromeCalls.length = 0
    made.world.adoptResult = { port: 9555, pid: 12 }
    await made.session.openBrowser()
    expect(made.world.chromeCalls).toEqual(['adopt'])
  })

  it('answers the status question from the run that holds the browser, without probing for a window', async () => {
    const { session, world } = await connected()
    world.chromeCalls.length = 0

    expect(await session.browserRunning()).toBe(true)
    expect(world.chromeCalls).toEqual([])
  })

  it('refuses to open or close the pre-login browser while a run holds it', async () => {
    const { session } = await connected()
    await expect(session.openBrowser()).rejects.toThrow(/a run is using/)
    await expect(session.closeBrowser()).rejects.toThrow(/a run is using/)
  })

  it('shutdownSync kills a launched browser and cancels in-flight work', async () => {
    const { session, world } = await connected()
    world.chromeCalls.length = 0
    world.execHandler = () => new Promise(() => {})

    const running = session.runStep(CLICK)
    await vi.waitFor(() => expect(world.scans).toBe(1))
    session.shutdownSync()
    await expect(running).rejects.toThrow(RunCancelledError)
    expect(world.chromeCalls).toContain('killNow')
  })
})

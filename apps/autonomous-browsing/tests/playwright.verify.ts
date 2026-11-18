// Real Chrome (npm run test:playwright): the actual ChromeProcess and PlaywrightSession, probed over a second CDP connection.
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright-core'
import { ChromeProcess } from '../src/main/automation/chrome-process'
import { PlaywrightSession } from '../src/main/automation/playwright-session'

const PAGES: Record<string, string> = {
  '/': `<!doctype html><html><head><title>Verify</title></head><body>
    <input id="q" type="text">
    <button id="go">Search</button>
    <button id="order">Place order</button>
    <a id="pop" href="/popup" target="_blank">More results</a>
    <iframe id="embed" src="/frame"></iframe>
  </body></html>`,
  '/frame': `<!doctype html><html><body><button id="inner">Inner action</button></body></html>`,
  '/popup': `<!doctype html><html><head><title>Popup</title></head><body><h1>Popup page</h1></body></html>`,
  '/login': `<!doctype html><html><body>
    <input id="user" type="text" placeholder="Username">
    <input id="pw" type="password">
  </body></html>`,
  '/hostile': `<!doctype html><html><head><title>Hostile</title></head><body>
    <p id="real">genuine page text</p>
    <p id="verdict">pending</p>
    <script>
      const fake = async () => ({ nonce: 'stolen', value: { dom: '<p>FABRICATED</p>', title: 'x', blockedBy: null } });
      const notes = [];
      const before = window.__oaHooks;
      notes.push(typeof before === 'function' ? 'hooks-present' : 'hooks-absent');
      try {
        Object.defineProperty(window, '__oaHooks', { value: fake, writable: true, configurable: true });
        notes.push('redefine-allowed');
      } catch (error) {
        notes.push('redefine-' + error.name);
      }
      try { window.__oaHooks = fake; } catch (error) { notes.push('assign-' + error.name); }
      notes.push(window.__oaHooks === before ? 'held' : 'clobbered');
      document.getElementById('verdict').textContent = notes.join(' ');
    </script>
  </body></html>`
}

const server = http.createServer((request, response) => {
  const body = PAGES[request.url ?? '/']
  response.writeHead(body ? 200 : 404, { 'content-type': 'text/html' })
  response.end(body ?? 'not found')
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const address = server.address()
if (address === null || typeof address !== 'object') throw new Error('the fixture server has no port')
const origin = `http://127.0.0.1:${address.port}`

const scratch = mkdtempSync(path.join(tmpdir(), 'oa-playwright-verify-'))
const endpointFile = path.join(scratch, 'endpoint.json')
const chrome = new ChromeProcess(path.join(scratch, 'profile'), endpointFile, undefined, process.env, process.platform, [
  '--headless'
])
const session = new PlaywrightSession(chrome, 'auto')

const probe: { browser: Browser | null } = { browser: null }

async function probePage(urlPart: string): Promise<Page> {
  if (!probe.browser) {
    const { port } = JSON.parse(readFileSync(endpointFile, 'utf8')) as { port: number }
    probe.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    const page = probe.browser
      .contexts()[0]
      ?.pages()
      .find((candidate) => candidate.url().includes(urlPart))
    if (page) return page
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`no open page matches "${urlPart}"`)
}

try {
  await session.connect()
  assert.ok(existsSync(endpointFile), 'a launch records its endpoint for later adoption')
  const chromePid = (JSON.parse(readFileSync(endpointFile, 'utf8')) as { pid: number }).pid

  await session.runStep({ kind: 'navigate', url: `${origin}/` })
  let snapshot = await session.snapshot()
  assert.equal(snapshot.title, 'Verify')
  assert.match(snapshot.dom, /Search/)
  assert.equal(snapshot.blockedBy, null)

  const main = await probePage('/')
  assert.ok(
    await main.evaluate(() => document.querySelector('div[style*="2147483647"]') !== null),
    'the pause banner host is mounted on the automated page'
  )

  assert.equal(
    await main.evaluate(() => navigator.webdriver),
    false,
    'the page sees no webdriver brand — Google sign-in rejects a browser that carries one'
  )

  await main.evaluate(() => {
    const field = document.getElementById('q')!
    const seen: Array<{ trusted: boolean; data: string | null }> = []
    ;(window as unknown as { __seen: typeof seen }).__seen = seen
    field.addEventListener('input', (event) =>
      seen.push({ trusted: event.isTrusted, data: (event as InputEvent).data })
    )
  })

  const typed = await session.runStep({ kind: 'type', selector: '#q', text: 'oat milk' })
  assert.equal(typed.via, 'cdp', 'typing goes through trusted CDP input, not the synthetic fallback')
  const seen = await main.evaluate(() => (window as unknown as { __seen: unknown[] }).__seen)
  assert.ok(
    (seen as Array<{ trusted: boolean }>).some((event) => event.trusted),
    'the page received a trusted input event — the reason this backend dispatches through CDP'
  )

  snapshot = await session.snapshot()
  assert.match(
    snapshot.dom,
    /id="q"[^>]*value="oat milk"/,
    'the snapshot mirrors typed text, so the model can see what it filled'
  )

  const dead = await session.runStep({ kind: 'click', selector: '#go' })
  assert.equal(dead.changed, false, 'a click the page ignores is reported as such')
  assert.equal(dead.committing, false)

  const committing = await session.runStep({ kind: 'click', selector: '#order' })
  assert.equal(committing.committing, true, '"Place order" is recognized as a committing click')

  const inner = await session.extractText('#inner')
  assert.equal(inner, 'Inner action', 'steps resolve inside iframes the extension backend cannot reach')

  await session.runStep({ kind: 'click', selector: '#pop' })
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await session.snapshot()).url.endsWith('/popup')) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok((await session.snapshot()).url.endsWith('/popup'), 'the run follows a popup its own click opened')
  const popup = await probePage('/popup')
  await popup.close()
  for (let attempt = 0; attempt < 50; attempt++) {
    if (!(await session.snapshot()).url.endsWith('/popup')) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(!(await session.snapshot()).url.endsWith('/popup'), 'closing the popup falls back to the opener')

  await session.runStep({ kind: 'navigate', url: `${origin}/hostile` })
  const hostile = await session.snapshot()
  assert.match(hostile.dom, /genuine page text/, 'the real DOM still reaches the host')
  assert.doesNotMatch(hostile.dom, /FABRICATED/, 'a page cannot substitute its own DOM for the engine answer')
  assert.match(hostile.dom, /hooks-present/, 'the init script wins the race against page script')
  assert.match(hostile.dom, /redefine-TypeError/, 'the locked hooks refuse redefinition')
  assert.match(hostile.dom, /held/, 'assignment cannot clobber the locked hooks either')

  const pauses: Array<{ reason: string; automatic: boolean }> = []
  session.on('paused', (reason, automatic) => {
    pauses.push({ reason: reason as string, automatic: automatic as boolean })
    setTimeout(() => session.resume(), 100)
  })

  await session.runStep({ kind: 'navigate', url: `${origin}/login` })
  const held = await session.runStep({ kind: 'type', selector: '#user', text: 'jane' })
  assert.ok(held.via, 'the held step still ran after the resume')
  assert.ok(pauses.length >= 1 && pauses[0]!.automatic, 'a visible password field parks the run on its own')
  assert.match(pauses[0]!.reason, /password field/)

  await assert.rejects(
    session.runStep({ kind: 'type', selector: '#pw', text: 'hunter2' }),
    /refusing to write into a password field/,
    'the credential guard survives the backend swap'
  )
  const login = await probePage('/login')
  assert.equal(await login.locator('#pw').inputValue(), '', 'nothing reached the password field')

  await probe.browser?.close()
  probe.browser = null
  await session.disconnect()
  assert.ok(existsSync(endpointFile), 'a finished run leaves its endpoint on disk to adopt next time')
  assert.doesNotThrow(() => process.kill(chromePid, 0), 'a finished run leaves the Chrome it launched open')
  assert.equal(await session.browserRunning(), true, 'the browser is still there for the next run')

  await session.connect()
  const carried = await session.snapshot()
  assert.ok(carried.url.endsWith('/login'), 'the next run picks up the page the last one left on screen')
  const again = await session.runStep({ kind: 'click', selector: '#user' })
  assert.equal(again.via, 'cdp', 'trusted input still reaches a page carried over from the previous run')
  await session.disconnect()

  await session.closeBrowser()
  assert.equal(await session.browserRunning(), false, 'the browser control closes what a run left open')
  assert.throws(() => process.kill(chromePid, 0), 'closing it stops the Chrome the run launched')

  await session.openBrowser()
  assert.equal(await session.browserRunning(), true, 'the pre-login browser opens without a run')
  await session.connect()
  await session.runStep({ kind: 'navigate', url: `${origin}/` })
  await session.disconnect()
  assert.equal(await session.browserRunning(), true, 'a run that adopted the browser leaves it open')
  await session.closeBrowser()
  assert.equal(await session.browserRunning(), false, 'closing the pre-login browser stops it')

  console.log(
    'playwright backend: launch/adopt lifecycle, the browser a finished run leaves open, trusted input, ' +
      'mirrored state, no-op detection, commit flags, ' +
      'iframe steps, popup adoption, sensitive holds, the credential refusal, and hooks a hostile page cannot ' +
      'replace all verified against real Chrome'
  )
} finally {
  await probe.browser?.close().catch(() => {})
  await session.closeBrowser().catch(() => {})
  server.close()
  await new Promise((resolve) => setTimeout(resolve, 500))
  try {
    rmSync(scratch, { recursive: true, force: true })
  } catch {
    // a not-quite-dead Chrome can still hold profile files; the temp dir is disposable
  }
}

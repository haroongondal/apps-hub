// Real Chrome (npm run test:extension): jsdom models none of the setter brand-checking this covers.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { chromium } from 'playwright-core'

const extensionDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension')
const pageCore = path.join(extensionDir, 'page-core.js')
const contentScript = path.join(extensionDir, 'content.js')
const { version } = JSON.parse(readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'))

const FIXTURE = `
  <div id="composer" contenteditable="true" class="ProseMirror" role="textbox"><p><br></p></div>
  <textarea id="area"></textarea>
  <input id="field" type="text">
  <input id="secret" type="password">
  <input id="chk-state" type="checkbox">
  <div id="dialog">
    <button id="save">Save</button>
    <button id="send"><span>Send</span> invitation emails</button>
  </div>
`

const CHROME_STUB = `
  const VERSION = ${JSON.stringify(version)};
  window.__events = [];
  window.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => { window.__listener = fn } },
      sendMessage: (message) =>
        message && message.type === 'INPUT' ? window.__dispatchInput(message) : Promise.resolve(null),
      getManifest: () => ({ version: VERSION })
    }
  };
  window.__exec = (step) => new Promise((resolve) => window.__listener({ type: 'EXEC', step }, null, resolve));
  window.__dom = () => new Promise((resolve) => window.__listener({ type: 'DOM' }, null, resolve));
`

const backgroundGlobal = { console }
const listener = { addListener: () => {} }
backgroundGlobal.chrome = {
  runtime: {
    onStartup: listener,
    onInstalled: listener,
    onMessage: listener,
    connectNative: () => ({ onMessage: listener, onDisconnect: listener, postMessage: () => {} }),
    getManifest: () => ({ version }),
    lastError: null
  },
  alarms: { create: () => {}, onAlarm: listener },
  tabs: { onRemoved: listener },
  debugger: { onDetach: listener },
  storage: { session: { get: async () => ({}), set: async () => {} } }
}
vm.createContext(backgroundGlobal)
vm.runInContext(readFileSync(path.join(extensionDir, 'background.js'), 'utf8'), backgroundGlobal)
const { inputCommands } = backgroundGlobal
assert.equal(
  typeof inputCommands,
  'function',
  'the harness runs the real background.js so it dispatches the real command sequences rather than a copy of them'
)

let commandsSent = 0
let failAfter = Infinity
backgroundGlobal.chrome.debugger.attach = async () => {}
backgroundGlobal.chrome.debugger.sendCommand = async () => {
  if (commandsSent >= failAfter) throw new Error('Detached while handling command.')
  commandsSent += 1
}

const typed = { action: 'type', text: 'x', submit: true }
assert.equal(await backgroundGlobal.dispatchInput(1, typed), 'ok', 'a clean sequence reports ok')

failAfter = 0
commandsSent = 0
assert.equal(
  await backgroundGlobal.dispatchInput(2, typed),
  'unavailable',
  'a sequence that sent nothing is safe to retry the synthetic way'
)

failAfter = 1
commandsSent = 0
assert.equal(
  await backgroundGlobal.dispatchInput(3, typed),
  'failed',
  'a sequence that already sent something must be told apart from one that did not: the caller falls back on ' +
    'unavailable, and falling back here would type the text a second time'
)
backgroundGlobal.chrome.debugger.sendCommand = async () => {}

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()

let inputVerdict = 'unavailable'
let inputRequests = 0
const cdp = await page.context().newCDPSession(page)
await page.exposeBinding('__dispatchInput', async (_source, request) => {
  inputRequests += 1
  if (inputVerdict !== 'ok') return inputVerdict
  for (const [method, params] of inputCommands(request)) await cdp.send(method, params)
  return 'ok'
})

await page.addInitScript(CHROME_STUB)
await page.goto('about:blank')
await page.setContent(FIXTURE)
await page.addScriptTag({ path: pageCore })
await page.addScriptTag({ path: contentScript })

for (const id of ['composer', 'area', 'field']) {
  await page.evaluate((target) => {
    const el = document.getElementById(target)
    for (const name of ['input', 'change']) {
      el.addEventListener(name, (event) => {
        window.__events.push({
          target,
          name,
          type: event.constructor.name,
          inputType: event.inputType ?? null,
          data: event.data ?? null
        })
      })
    }
  }, id)
}

const exec = (step) => page.evaluate((s) => window.__exec(s), step)
const readEvents = (target) => page.evaluate((t) => window.__events.filter((e) => e.target === t), target)

let result = await exec({ kind: 'type', selector: '#composer', text: 'hello from the agent' })
assert.equal(result.ok, true, `typing into a contenteditable must succeed, got: ${result.error}`)
assert.equal(await page.locator('#composer').innerText(), 'hello from the agent', 'text lands in the composer')

let events = await readEvents('composer')
assert.ok(
  events.some(
    (e) => e.name === 'input' && e.type === 'InputEvent' && e.inputType === 'insertText' && e.data === 'hello from the agent'
  ),
  'the composer must see a real InputEvent carrying the text — rich text editors rebuild their state from it, ' +
    'and a plain textContent write emits nothing at all'
)

result = await exec({ kind: 'type', selector: '#composer', text: 'second prompt' })
assert.equal(result.ok, true, `retyping must succeed, got: ${result.error}`)
assert.equal(await page.locator('#composer').innerText(), 'second prompt', 'retyping replaces rather than appends')

result = await exec({ kind: 'type', selector: '#area', text: 'in the textarea' })
assert.equal(result.ok, true, `typing into a textarea must succeed, got: ${result.error}`)
assert.equal(await page.locator('#area').inputValue(), 'in the textarea', 'text lands in the textarea')

result = await exec({ kind: 'type', selector: '#field', text: 'in the field' })
assert.equal(result.ok, true, `typing into an input must succeed, got: ${result.error}`)
assert.equal(await page.locator('#field').inputValue(), 'in the field', 'text lands in the input')

events = await readEvents('area')
assert.ok(events.some((e) => e.name === 'input'), 'the textarea still gets an input event')
assert.ok(events.some((e) => e.name === 'change'), 'the textarea still gets a change event')

result = await exec({ kind: 'type', selector: '#secret', text: 'hunter2' })
assert.equal(result.ok, false, 'a password field is still refused')
assert.match(result.error, /password field/)
assert.equal(await page.locator('#secret').inputValue(), '', 'nothing was written to the password field')

// cloneNode copies attributes; a page keeps typed text in the value property, so
// without mirroring, every field the model has filled reads back empty forever.
await page.evaluate(() => {
  document.getElementById('chk-state').checked = true
  document.getElementById('secret').value = 'hunter2'
})

const filled = await page.evaluate(() => window.__dom())

assert.match(
  filled.dom,
  /<input[^>]*id="field"[^>]*value="in the field"/,
  'a typed input must carry its live value into the snapshot, or the model cannot tell a filled field from an empty one'
)
assert.match(
  filled.dom,
  /<textarea[^>]*id="area"[^>]*>in the textarea<\/textarea>/,
  'a typed textarea carries its value as text, which cloneNode does not copy either'
)
assert.match(
  filled.dom,
  /<input[^>]*id="chk-state"[^>]*checked/,
  'a checkbox ticked by the page must read as checked'
)
assert.ok(
  filled.dom.includes('second prompt'),
  'a contenteditable keeps its text in child nodes, which must still survive'
)
assert.ok(
  !filled.dom.includes('hunter2'),
  'a password the human typed must never reach the snapshot — it would be sent to the model'
)

await page.evaluate(() => {
  window.__clicks = []
  for (const el of document.querySelectorAll('#dialog button')) {
    el.addEventListener('click', () => window.__clicks.push(el.id))
  }
})
const readClicks = () => page.evaluate(() => window.__clicks)

result = await exec({ kind: 'click', selector: 'button:has-text("Send")' })
assert.equal(result.ok, true, `:has-text must resolve, got: ${result.error}`)
assert.deepEqual(await readClicks(), ['send'], 'matches the button whose text lives in a child span, not the first button')

result = await exec({ kind: 'click', selector: 'button:has-text("Save")' })
assert.equal(result.ok, true, `:has-text must pick by text, got: ${result.error}`)
assert.deepEqual(await readClicks(), ['send', 'save'], 'a different text picks a different button')

result = await exec({ kind: 'click', selector: '#save' })
assert.equal(result.ok, true, `plain CSS must still work, got: ${result.error}`)
assert.deepEqual(await readClicks(), ['send', 'save', 'save'], 'plain CSS selectors are unaffected')

result = await exec({ kind: 'click', selector: 'button:has-text("Nothing here")', timeout: 300 })
assert.equal(result.ok, false, 'unmatched text times out rather than clicking something arbitrary')
assert.match(result.error, /timed out/)

result = await exec({ kind: 'click', selector: 'button:has-text(Send)' })
assert.equal(result.ok, false, 'unquoted text is not valid CSS and must report as such')
assert.match(result.error, /not a valid selector/)

await page.evaluate(() => {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div id="sticky" style="position:fixed;top:0;left:0;right:0;height:60px;background:#333;z-index:10"></div>
     <div style="height:3000px"></div>
     <button id="under-sticky" style="position:absolute;top:1000px;left:0">Continue</button>`
  )
  document.getElementById('under-sticky').addEventListener('click', () => window.__clicks.push('under-sticky'))
  scrollTo(0, 980)
})

result = await exec({ kind: 'click', selector: '#under-sticky', timeout: 2000 })
assert.equal(result.ok, true, `a control under a sticky header must be scrolled clear, not refused: ${result.error}`)
assert.ok((await readClicks()).includes('under-sticky'), 'the click landed on the control the sticky header was over')

await page.evaluate(() => {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div id="overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:20"></div>`
  )
  scrollTo(0, 0)
})

result = await exec({ kind: 'click', selector: '#save', timeout: 1000 })
assert.equal(result.ok, false, 'a control under a full-page overlay is still refused — scrolling cannot clear a modal')
assert.match(result.error, /covered by <div#overlay>/)
assert.deepEqual(await readClicks(), ['send', 'save', 'save', 'under-sticky'], 'and nothing was clicked through it')

assert.equal(
  await page.evaluate(() => window.__oaVersion),
  version,
  'the script records which build is serving the tab so a stale one can be reported'
)


// Second fixture: the cross-site failure modes the resolver has to survive.
const HARD_FIXTURE = `
  <button id="icon" aria-label="Send message"></button>
  <button id="ghost" style="display:none">Submit form</button>
  <button id="real">Submit form</button>
  <button id="locked" disabled>Continue</button>
  <button id="dead">Do nothing</button>
  <button id="live">Reveal more</button>
  <form id="checkout"><button id="pay" type="submit">Pay now</button></form>
  <div style="position:relative;width:220px;height:44px">
    <button id="under">Accept cookies</button>
    <div id="veil" style="position:absolute;inset:0;background:#000"></div>
  </div>
  <my-widget></my-widget>
`

await page.setContent(HARD_FIXTURE)
await page.addScriptTag({ path: pageCore })
await page.addScriptTag({ path: contentScript })
await page.evaluate(() => {
  window.__clicks = []
  const shadow = document.querySelector('my-widget').attachShadow({ mode: 'open' })
  shadow.innerHTML = '<button id="deep">Deliver package</button>'
  shadow.getElementById('deep').addEventListener('click', () => window.__clicks.push('deep'))
  for (const el of document.querySelectorAll('button')) {
    el.addEventListener('click', () => window.__clicks.push(el.id))
  }
  document.getElementById('live').addEventListener('click', () => document.body.append(document.createElement('span')))
  document.getElementById('checkout').addEventListener('submit', (event) => event.preventDefault())
})

const clicked = () => page.evaluate(() => window.__clicks)

result = await exec({ kind: 'click', selector: 'button:has-text("Send")' })
assert.equal(result.ok, true, `an icon-only button must match on its aria-label, got: ${result.error}`)
assert.deepEqual(await clicked(), ['icon'], 'aria-label counts as the button text when there is no text node')

result = await exec({ kind: 'click', selector: 'button:has-text("Deliver")' })
assert.equal(result.ok, true, `a control inside an open shadow root must be reachable, got: ${result.error}`)
assert.ok((await clicked()).includes('deep'), 'the resolver pierces open shadow roots')

result = await exec({ kind: 'click', selector: 'button:has-text("Submit form")' })
assert.equal(result.ok, true, `a hidden duplicate must not block the visible one, got: ${result.error}`)
assert.ok((await clicked()).includes('real'), 'the visible match wins')
assert.ok(!(await clicked()).includes('ghost'), 'the display:none match is never clicked')

result = await exec({ kind: 'click', selector: '#locked', timeout: 400 })
assert.equal(result.ok, false, 'a disabled button is not a successful click')
assert.match(result.error, /disabled/, `the error must name why, got: ${result.error}`)

result = await exec({ kind: 'click', selector: '#under', timeout: 400 })
assert.equal(result.ok, false, 'a covered button is not a successful click')
assert.match(result.error, /covered by <div#veil>/, `the error must name the blocker, got: ${result.error}`)

result = await exec({ kind: 'click', selector: '#dead' })
assert.equal(result.ok, true, 'a click that lands is still reported as ok')
assert.equal(result.changed, false, 'a click the page ignored must report changed:false')

result = await exec({ kind: 'click', selector: '#live' })
assert.equal(result.changed, true, 'a click the page reacted to must report changed:true')

result = await exec({ kind: 'click', selector: '#pay' })
assert.equal(result.committing, true, 'a submit button in a form is a committing action')

result = await exec({ kind: 'click', selector: '#dead' })
assert.equal(result.committing, false, 'an ordinary button is not a committing action')

// assert: the two rank traps that would pass an absence check open, plus the
// late-render trap that a single synchronous look would sail straight past.
result = await exec({ kind: 'assert', selector: '#live' })
assert.equal(result.ok, true, `a rendered element satisfies a presence assertion, got: ${result.error}`)
assert.equal(result.changed, undefined, 'an assertion reports no change, or layer 1 would send it to the healer')
assert.equal(result.committing, undefined, 'an assertion is never a committing action')

result = await exec({ kind: 'assert', selector: '#nowhere', timeout: 300 })
assert.equal(result.ok, false, 'a missing element fails a presence assertion')
assert.match(result.error, /nothing on this page matches it/, `the error must say why, got: ${result.error}`)

result = await exec({ kind: 'assert', selector: '#nowhere', expect: 'absent' })
assert.equal(result.ok, true, `a selector matching nothing is absent, got: ${result.error}`)

result = await exec({ kind: 'assert', selector: '#ghost', expect: 'absent' })
assert.equal(result.ok, true, 'a display:none match is genuinely not rendered, so it is absent')

result = await exec({ kind: 'assert', selector: '#locked', expect: 'absent' })
assert.equal(result.ok, false, 'a DISABLED element is still on screen — rank 2 must not read as absent')
assert.match(result.error, /is on the page/, `the error must name what it found, got: ${result.error}`)

result = await exec({ kind: 'assert', selector: '#under', expect: 'absent' })
assert.equal(result.ok, false, 'a COVERED element is still on screen — rank 3 must not read as absent')

result = await exec({ kind: 'assert', selector: '#live', containsText: 'Reveal' })
assert.equal(result.ok, true, `matching innerText satisfies the claim, got: ${result.error}`)

result = await exec({ kind: 'assert', selector: '#live', containsText: 'Not this' })
assert.equal(result.ok, false, 'text the element does not contain fails the assertion')
assert.match(result.error, /Not this/, 'the error carries the expected text')

result = await exec({
  kind: 'assert',
  selector: '#nowhere',
  timeout: 300,
  message: 'the receipt never rendered'
})
assert.match(result.error, /^the receipt never rendered — /, `the author's words come first, got: ${result.error}`)

await page.evaluate(() => {
  setTimeout(() => {
    const late = document.createElement('div')
    late.id = 'late-banner'
    late.textContent = 'Card declined'
    document.body.appendChild(late)
  }, 200)
})
result = await exec({ kind: 'assert', selector: '#late-banner', expect: 'absent' })
assert.equal(result.ok, false, 'an error banner that renders 200ms later must still fail an absence assertion')

const snapshot = await page.evaluate(() => new Promise((resolve) => window.__listener({ type: 'DOM' }, null, resolve)))
assert.match(
  snapshot.dom,
  /Deliver package/,
  'the DOM sent to the model must include shadow content, or it cannot repair what the resolver can reach'
)


// Third fixture: what the model is shown has to be what the executor can act on.
const SNAPSHOT_FIXTURE = `
  <div id="menu-closed" style="visibility:hidden"><li role="menuitem">Create an event</li></div>
  <div id="faded" style="opacity:0"><button>Ghost action</button></div>
  <div id="collapsed" style="display:none"><button>Collapsed action</button></div>
  <select id="currency"><option value="eur">Euro</option><option value="usd">Dollar</option></select>
  <button id="opener">Open the menu</button>
`

await page.setContent(SNAPSHOT_FIXTURE)
await page.addScriptTag({ path: pageCore })
await page.addScriptTag({ path: contentScript })

const shown = await page.evaluate(() => new Promise((resolve) => window.__listener({ type: 'DOM' }, null, resolve)))

for (const unreachable of ['Create an event', 'Ghost action', 'Collapsed action']) {
  assert.ok(
    !shown.dom.includes(unreachable),
    `the model must not be shown "${unreachable}": the resolver passes over anything the page is not rendering, ` +
      'so offering it only produces steps that time out'
  )
}
assert.match(shown.dom, /Open the menu/, 'what the page does render is still there')
assert.match(shown.dom, /value="eur"/, 'an <option> has no box of its own yet still carries what a select step needs')


// Fourth fixture: a bot wall a goal run has to park on rather than decide against.
const WALL_FIXTURE = `
  <iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=x" style="width:600px;height:400px"></iframe>
  <input id="secret" type="password">
`

await page.setContent(WALL_FIXTURE)
await page.addScriptTag({ path: pageCore })
await page.addScriptTag({ path: contentScript })

const walled = await page.evaluate(() => new Promise((resolve) => window.__listener({ type: 'DOM' }, null, resolve)))
assert.equal(walled.blockedBy, 'DataDome bot check', 'a snapshot of a bot wall must name the wall it saw')

const scanned = await page.evaluate(() => new Promise((resolve) => window.__listener({ type: 'SCAN' }, null, resolve)))
assert.equal(scanned.reason, 'password field', 'a wall does not displace the credential holds a step-level scan finds')

await page.setContent('<input id="secret" type="password">')
await page.addScriptTag({ path: pageCore })
await page.addScriptTag({ path: contentScript })

const credentialsOnly = await page.evaluate(
  () => new Promise((resolve) => window.__listener({ type: 'DOM' }, null, resolve))
)
assert.equal(
  credentialsOnly.blockedBy,
  null,
  'a password field is not a wall: parking every login page before the model looks at it would strand ' +
    'every run whose next move is a button beside the field'
)

// The two walls a live run met that none of the vendor-widget selectors above see:
// Cloudflare's terminal block page and an F5 rejection. Both are whole-page
// interstitials, so both belong in WALL rather than in the model's lap.
const CLOUDFLARE_BLOCK = `
  <div id="cf-wrapper">
    <div id="cf-error-details" class="cf-error-details-wrapper">
      <h1>Sorry, you have been blocked</h1>
      <h2>You are unable to access staterbros.com</h2>
      <h2>Why have I been blocked?</h2>
      <p>This website is using a security service to protect itself from online attacks.</p>
    </div>
  </div>
`

const F5_REJECTION = `
  The requested URL was rejected. Please consult with your administrator.<br><br>
  Your support ID is 95789ffb-74b0-429a-b20e-671e21c9239d<br><br>
  <h2>Error 403 - Forbidden</h2>
  F5 site: sg3-sin<br><br>
  <a href="javascript:history.back();">[Go Back]</a>
`

const CLOUDFLARE_OUTAGE = `
  <div id="cf-wrapper">
    <div id="cf-error-details" class="cf-error-details-wrapper">
      <h1>Web server is down</h1>
      <h2>Error code 521</h2>
      <p>The web server is not returning a connection. As a result, the web page is not displaying.</p>
    </div>
  </div>
`

const SERVED_ERROR = `
  <h1>Sorry, A Problem Occurred</h1>
  <p>We're having trouble displaying the information. Please contact the Service Center at 1 (800) 925-9989.</p>
  <p>[<span id="request-id">e9bf53b6-1093-4dbf-929d-66e22a3a9290</span>]</p>
`

const blockedByOn = async (html) => {
  await page.setContent(html)
  await page.addScriptTag({ path: pageCore })
  await page.addScriptTag({ path: contentScript })
  const snapshot = await page.evaluate(() => new Promise((resolve) => window.__listener({ type: 'DOM' }, null, resolve)))
  return snapshot.blockedBy
}

assert.equal(
  await blockedByOn(CLOUDFLARE_BLOCK),
  'Cloudflare block',
  "Cloudflare's block page must be named as a wall: #challenge-running only covers the interstitial that " +
    'resolves on its own, and a run that cannot see the terminal page spends its budget re-navigating into it'
)

assert.equal(
  await blockedByOn(F5_REJECTION),
  'firewall block',
  'a WAF rejection is a wall the person can often clear in their own browser, and it carries no vendor widget ' +
    'at all — only its wording identifies it'
)

assert.equal(
  await blockedByOn(CLOUDFLARE_OUTAGE),
  null,
  "Cloudflare's 5xx pages share #cf-error-details with the block page but are an origin outage: nobody can " +
    'clear one by hand, so parking on one burns hand-offs to reach the same dead end'
)

assert.equal(
  await blockedByOn(SERVED_ERROR),
  null,
  'a served error page is not a wall — only the model can judge one from its text, and parking on every ' +
    'broken page would hand off runs a reload or a second URL would have fixed'
)

// Fifth fixture: the same actions driven by real CDP input rather than synthetic events.
const TRUSTED_FIXTURE = `
  <form id="search"><input id="q" name="q" type="text"></form>
  <input id="plain" type="text">
  <input id="secret" type="password">
  <button id="go">Continue</button>
`

await page.setContent(TRUSTED_FIXTURE)
await page.addScriptTag({ path: pageCore })
await page.addScriptTag({ path: contentScript })
await page.evaluate(() => {
  window.__clicks = []
  window.__submits = 0
  document.getElementById('go').addEventListener('click', (event) => window.__clicks.push(event.isTrusted))
  document.getElementById('search').addEventListener('submit', (event) => {
    event.preventDefault()
    window.__submits += 1
  })
})

inputVerdict = 'ok'

result = await exec({ kind: 'click', selector: '#go' })
assert.equal(result.ok, true, `a CDP click must succeed, got: ${result.error}`)
assert.equal(result.via, 'cdp', 'the step must report which input path ran it')
assert.deepEqual(
  await page.evaluate(() => window.__clicks),
  [true],
  'the click must arrive as a trusted event — that is the entire point of dispatching it through the debugger'
)

result = await exec({ kind: 'type', selector: '#plain', text: 'typed by CDP' })
assert.equal(result.ok, true, `a CDP type must succeed, got: ${result.error}`)
assert.equal(result.via, 'cdp', 'a typed step reports the CDP path too')
assert.equal(await page.locator('#plain').inputValue(), 'typed by CDP', 'insertText puts the text in the field')

result = await exec({ kind: 'type', selector: '#plain', text: 'replaced' })
assert.equal(result.ok, true, `retyping over existing text must succeed, got: ${result.error}`)
assert.equal(
  await page.locator('#plain').inputValue(),
  'replaced',
  'typing replaces what the field held: insertText overwrites the selection content.js leaves selected, and a run ' +
    'that appended instead would search for the last two queries concatenated'
)

result = await exec({ kind: 'type', selector: '#q', text: 'a query', submit: true })
assert.equal(result.ok, true, `submitting must succeed, got: ${result.error}`)
assert.equal(await page.locator('#q').inputValue(), 'a query', 'the text lands before Enter is pressed')
assert.equal(
  await page.evaluate(() => window.__submits),
  1,
  'a trusted Enter submits the form exactly once — the synthetic path also calls requestSubmit, and doing both ' +
    'would place two orders'
)

const requestsBeforeSecret = inputRequests
result = await exec({ kind: 'type', selector: '#secret', text: 'hunter2' })
assert.equal(result.ok, false, 'the credential guard still refuses under CDP')
assert.match(result.error, /password field/)
assert.equal(
  inputRequests,
  requestsBeforeSecret,
  'the guard must refuse before any dispatch is requested: CDP types at coordinates and would not check the target'
)

inputVerdict = 'failed'
result = await exec({ kind: 'type', selector: '#plain', text: 'must not land twice' })
assert.equal(result.ok, false, 'a partly-dispatched input is an error, not something to retry a different way')
assert.equal(
  await page.locator('#plain').inputValue(),
  'replaced',
  'a dispatch that already sent something must never fall back to the synthetic path — the field would take the ' +
    'text twice and a submitted form would go twice with it'
)

inputVerdict = 'unavailable'
result = await exec({ kind: 'type', selector: '#plain', text: 'fell back' })
assert.equal(result.ok, true, `losing the debugger must not fail the step, got: ${result.error}`)
assert.equal(result.via, 'synthetic', 'a step that fell back says so, so a run can be read back path by path')
assert.equal(await page.locator('#plain').inputValue(), 'fell back', 'the synthetic path still writes the field')

const LOCK_FIXTURE = `
  <div style="height:4000px">
    <button id="target">Change the seats</button>
    <input id="typed" type="text">
  </div>
`

await page.setContent(LOCK_FIXTURE)
await page.addScriptTag({ path: pageCore })
await page.addScriptTag({ path: contentScript })
await page.evaluate(() => {
  window.__hits = 0
  window.__control = []
  document.getElementById('target').addEventListener('click', () => (window.__hits += 1))
  const send = chrome.runtime.sendMessage
  chrome.runtime.sendMessage = (message) => {
    if (message && message.type !== 'INPUT') window.__control.push(message.type)
    return send(message)
  }
})

const render = (state, reason = null) =>
  page.evaluate((message) => window.__listener(message, null, () => {}), { type: 'AGENT_STATE', state, reason })

await render('active')
await page.waitForTimeout(300)

await page.locator('#target').click()
assert.equal(await page.evaluate(() => window.__hits), 0, 'a locked page must not pass a click to the page under it')

await page.mouse.wheel(0, 600)
await page.waitForTimeout(200)
assert.equal(await page.evaluate(() => window.scrollY), 0, 'a locked page must not scroll under the wheel')

await page.focus('#typed')
await page.keyboard.type('interference')
assert.equal(await page.locator('#typed').inputValue(), '', 'a locked page must not take typing')

inputVerdict = 'ok'
result = await exec({ kind: 'click', selector: '#target' })
assert.equal(result.ok, true, `the agent must still reach the page it locked, got: ${result.error}`)
assert.equal(result.via, 'cdp', 'and it must still reach it over trusted input, not the synthetic fallback')
assert.equal(
  await page.evaluate(() => window.__hits),
  1,
  "the lock swallows trusted input by default, so a window that does not open around page-core's own dispatch " +
    'locks the agent out of every page it drives'
)

await page.waitForTimeout(300)
await page.keyboard.press('Escape')
assert.deepEqual(
  await page.evaluate(() => window.__control),
  ['PAUSE_REQUESTED'],
  'Escape must ask the app to pause — a lock a person cannot leave is a browser they have lost'
)
await page.locator('#target').click()
assert.equal(await page.evaluate(() => window.__hits), 2, 'Escape releases the page without waiting for the app')

await render('paused', 'sign in yourself')
await page.waitForTimeout(300)
await page.focus('#typed')
await page.keyboard.type('mine now')
assert.equal(
  await page.locator('#typed').inputValue(),
  'mine now',
  'a paused run hands the page back — the hold exists so a person can finish the step'
)

inputVerdict = 'unavailable'

await browser.close()
console.log(
  'content script: resolution, shadow DOM, visibility, no-op detection, password refusal, wall detection, ' +
    'trusted CDP input with its fallback, and the view lock all verified'
)

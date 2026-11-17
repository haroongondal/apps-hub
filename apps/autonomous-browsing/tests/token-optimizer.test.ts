import { describe, expect, it } from 'vitest'
import { filterDom } from '../src/main/lib/TokenOptimizer'

const PAGE = `<!doctype html>
<html>
  <head>
    <title>Checkout — Acme</title>
    <meta name="viewport" content="width=device-width" />
    <style>.btn { color: red; }</style>
    <script>window.analytics = { track() {} }</script>
  </head>
  <body>
    <div class="wrapper mx-auto flex items-center justify-between px-4 py-2">
      <div>
        <div>
          <form id="checkout" action="/pay" method="post">
            <input type="hidden" name="csrf" value="abc123" />
            <input type="email" name="email" placeholder="you@example.com" class="border rounded p-2" />
            <button type="submit" class="btn btn-primary" data-testid="pay-now">Pay now</button>
          </form>
        </div>
      </div>
    </div>
    <div aria-hidden="true">screen-reader duplicate</div>
    <div style="display: none">invisible</div>
    <nav role="navigation"><a href="/cart">Cart</a></nav>
    <!-- tracking pixel below -->
    <img src="data:image/png;base64,${'A'.repeat(2000)}" alt="pixel" />
  </body>
</html>`

describe('filterDom', () => {
  it('strips scripts, styles, and comments', () => {
    const result = filterDom(PAGE)
    expect(result.html).not.toContain('<script')
    expect(result.html).not.toContain('<style')
    expect(result.html).not.toContain('analytics')
    expect(result.html).not.toContain('tracking pixel')
  })

  it('keeps interactive elements with functional attributes only', () => {
    const result = filterDom(PAGE)
    expect(result.html).toContain('action="/pay"')
    expect(result.html).toContain('placeholder="you@example.com"')
    expect(result.html).toContain('data-testid="pay-now"')
    expect(result.html).not.toContain('class=')
    expect(result.html).not.toContain('btn-primary')
  })

  it('unwraps non-semantic wrapper elements', () => {
    const result = filterDom('<div><div><div><button id="go">Go</button></div></div></div>')
    expect(result.html).toBe('<button id="go">Go</button>')
  })

  it('drops hidden content and hidden inputs', () => {
    const result = filterDom(PAGE)
    expect(result.html).not.toContain('screen-reader duplicate')
    expect(result.html).not.toContain('invisible')
    expect(result.html).not.toContain('csrf')
  })

  it('replaces handler bodies with an empty clickability marker', () => {
    const result = filterDom('<div onclick="track(); openModal()">Buy</div>')
    expect(result.html).toBe('<div onclick="">Buy</div>')
  })

  it('keeps aria attributes and roles', () => {
    const result = filterDom('<span role="button" aria-label="Close dialog" class="x">×</span>')
    expect(result.html).toBe('<span role="button" aria-label="Close dialog">×</span>')
  })

  it('truncates oversized attribute values', () => {
    const result = filterDom(PAGE)
    expect(result.html).not.toContain('A'.repeat(300))
    expect(result.html).toContain('alt="pixel"')
  })

  it('truncates long text runs', () => {
    const result = filterDom(`<p>${'word '.repeat(200)}</p>`, { maxTextLength: 50 })
    expect(result.html.length).toBeLessThan(80)
    expect(result.html).toContain('…')
  })

  it('extracts the title and reports savings', () => {
    const result = filterDom(PAGE)
    expect(result.title).toBe('Checkout — Acme')
    expect(result.filteredChars).toBeLessThan(result.originalChars)
  })

  it('preserves word boundaries around <br>', () => {
    const result = filterDom('<p>line one<br>line two</p>')
    expect(result.html).toContain('line one line two')
  })

  it('preserves word boundaries when block wrappers vanish', () => {
    const result = filterDom('<div>foo</div><div>bar</div>')
    expect(result.html.replace(/\s+/g, ' ')).toBe('foo bar')
  })

  it('does not add spaces when inline wrappers vanish', () => {
    const result = filterDom('<p>Hel<span>lo</span> world<wbr>wide</p>')
    expect(result.html).toBe('<p>Hello worldwide</p>')
  })

  it('does not treat non-handler on* attributes as interactive', () => {
    const result = filterDom('<div one-time="x">Text</div>')
    expect(result.html).toBe('Text')
    expect(result.html).not.toContain('onclick')
  })

  it('never slices a surrogate pair at the truncation point', () => {
    const result = filterDom(`<p>${'😀'.repeat(200)}</p>`, { maxTextLength: 51 })
    expect(result.html.isWellFormed()).toBe(true)
    const attr = filterDom(`<a href="/x?q=${'😀'.repeat(200)}">link</a>`, { maxAttributeLength: 51 })
    expect(attr.html.isWellFormed()).toBe(true)
  })
})

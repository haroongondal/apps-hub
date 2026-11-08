import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addHideFilter, parsePick, selectorFor, simpleSelector, type ElementInfo } from '../picker.ts';

const el = (tag: string, parts: Partial<ElementInfo> = {}): ElementInfo => ({ tag, id: '', classes: [], nth: 1, ...parts });

test('an id is the selector when it is a plain identifier', () => {
  assert.equal(simpleSelector({ tag: 'div', id: 'main-ad', classes: [], nth: 1 }), '#main-ad');
});

test('classes with 3 or more digits are treated as generated and skipped', () => {
  assert.equal(simpleSelector({ tag: 'div', id: '', classes: ['promo', 'css-1q2w3e'], nth: 2 }), 'div.promo');
  assert.equal(simpleSelector({ tag: 'div', id: '', classes: ['col-12', 'a1b2'], nth: 2 }), 'div.col-12.a1b2');
});

test('with no usable id or class, the selector counts the tag among its siblings', () => {
  assert.equal(simpleSelector({ tag: 'a', id: '', classes: [], nth: 3 }), 'a:nth-of-type(3)');
  assert.equal(simpleSelector({ tag: 'a', id: '', classes: ['x1y2z3'], nth: 3 }), 'a:nth-of-type(3)');
});

test('an id that is not a plain identifier is skipped, and classes are CSS-escaped', () => {
  assert.equal(simpleSelector({ tag: 'div', id: '1bad', classes: ['a:b'], nth: 1 }), 'div.a\\:b');
  assert.equal(simpleSelector(el('div', { classes: ['1a', 'w-1/2', 'x y'] })), 'div.\\31 a.w-1\\/2.x\\ y');
  assert.equal(simpleSelector(el('div', { classes: ['a\nb'] })), 'div.a\\a b');
  assert.equal(simpleSelector(el('a:b')), 'a\\:b:nth-of-type(1)');
});

test('selectorFor joins the target and its ancestors with child combinators', () => {
  const chain = [el('a', { classes: ['promo'] }), el('div', { classes: ['wrap'] })];
  assert.equal(selectorFor(chain, 2), 'div.wrap > a.promo');
  assert.equal(selectorFor(chain, 1), 'a.promo');
  assert.equal(selectorFor(chain, 9), 'div.wrap > a.promo', 'more levels than there are ancestors');
});

test('selectorFor stops at the nearest #id, which is already unique', () => {
  const chain = [el('a', { classes: ['promo'] }), el('div', { id: 'box' }), el('section', { id: 'root' })];
  assert.equal(selectorFor(chain, 1), 'a.promo');
  assert.equal(selectorFor(chain, 2), '#box > a.promo');
  assert.equal(selectorFor(chain, 3), '#box > a.promo');
  assert.equal(selectorFor([el('p', { id: 'me' }), el('div')], 2), '#me');
});

test('addHideFilter puts the filter on its own line', () => {
  assert.equal(addHideFilter('x', 'example.com', '.a'), 'x\nexample.com##.a');
  assert.equal(addHideFilter('', 'example.com', '.a'), 'example.com##.a');
  assert.equal(addHideFilter('x\n\n', 'example.com', '.a'), 'x\nexample.com##.a');
  assert.equal(addHideFilter('example.com##.a\ny', 'example.com', '.a'), 'example.com##.a\ny', 'a filter that is already there is not added twice');
});

const PAGE = 'https://www.example.com/shop?x=1#top';
const pick = (selector: string, host = 'x') => ({ type: 'pick', host, selector });

test('parsePick takes the host from the sender page, with its www. and without a trailing dot, never from the message', () => {
  assert.deepEqual(parsePick(pick('div.wrap > a.promo', 'www.example.com'), PAGE), { host: 'www.example.com', selector: 'div.wrap > a.promo' });
  assert.deepEqual(parsePick(pick('div.a', 'evil.com'), PAGE), { host: 'www.example.com', selector: 'div.a' });
  assert.deepEqual(parsePick(pick('div.a'), 'https://www.google.com/'), { host: 'www.google.com', selector: 'div.a' });
  assert.deepEqual(parsePick(pick('div.a'), 'https://mail.google.com/'), { host: 'mail.google.com', selector: 'div.a' });
  assert.deepEqual(parsePick(pick('div.a'), 'https://example.com./x'), { host: 'example.com', selector: 'div.a' });
  assert.deepEqual(parsePick(pick('div.a'), 'HTTPS://WWW.Example.COM/'), { host: 'www.example.com', selector: 'div.a' });
  assert.deepEqual(parsePick(pick('div.a'), 'http://www.localhost:8080/'), { host: 'www.localhost', selector: 'div.a' });
  assert.deepEqual(parsePick(pick('div.a'), 'http://localhost:3000/'), { host: 'localhost', selector: 'div.a' });
  assert.deepEqual(parsePick(pick('div.a'), 'http://192.168.1.2/'), { host: '192.168.1.2', selector: 'div.a' });
});

test('parsePick refuses a sender that is not a web page with a host Sieve can use', () => {
  for (const url of [undefined, '', 'chrome://extensions', 'file:///tmp/x.html', 'chrome-extension://abc/popup.html', 'http://[::1]:8080/', 'http://my_host.test/', 'about:blank']) {
    assert.equal(parsePick(pick('div.a'), url), null, String(url));
  }
});

test('parsePick refuses a message that is not a well-formed pick', () => {
  for (const msg of [null, undefined, 'pick', [], {}, { type: 'pick' }, { type: 'pick', host: 'x' }, { type: 'pick', selector: 'div.a' }, { type: 'other', host: 'x', selector: 'div.a' }, { type: 'pick', host: 1, selector: 'div.a' }, { type: 'pick', host: 'x', selector: 1 }]) {
    assert.equal(parsePick(msg, PAGE), null, JSON.stringify(msg));
  }
  assert.equal(parsePick(pick('div.a', 'x'.repeat(300)), PAGE), null);
  assert.equal(parsePick(pick(`div.${'a'.repeat(1000)}`), PAGE), null);
});

test('parsePick refuses a selector that is not what the picker builds', () => {
  const bad = [
    '',
    'div.a\n.b',
    'div.a\r\nexample.com#%#//scriptlet("x")',
    'div.a\\\ndiv.b',
    'div.a\\\u0001',
    'div.a\u0000',
    'div.a, body',
    'div.a{}',
    'div.a}body{display:none',
    'div.a;',
    '}',
    ';',
    '/*',
    'div.a/*x*/',
    'div.a"b',
    "div.a'b",
    "a[href='x']",
    '*',
    'div.a ~ div.b',
    'div.a + div.b',
    'div.a\\',
    ' div.a',
    'div.a ',
    '>',
    'div.a >',
    'div.a >  div.b',
    'div.a > > div.b',
    '.a(',
    '.a:not(',
    'div.a(',
    'div.a:not(.b)',
    'div:has(.x)',
    'body:has(.x)',
    'div.a:nth-of-type(1)',
    'div:nth-of-type(x)',
    'div:nth-of-type(1',
    'div:nth-of-type(1)(',
    'div:nth-of-type(2n+1)',
    'html',
    'body',
    'div',
    'div p',
    'div > p',
    '.promo',
    '.a.b',
    'a#b',
    '#a#b',
    '#a.b',
    '#1a',
    'div.1a',
    '1div.a',
    '@import "x"',
    'url(x)',
    'div.a { x',
    'html:nth-of-type(1)',
    'body.x',
    'body:nth-of-type(1)',
    'div.a > body:nth-of-type(1)',
    'HTML.x',
  ];
  for (const selector of bad) assert.equal(parsePick(pick(selector), PAGE), null, JSON.stringify(selector));
});

test('parsePick accepts every selector shape the picker builds', () => {
  const ok = ['#main-ad', 'div.promo', 'a:nth-of-type(3)', 'div.a\\:b', 'div.\\31 a.w-1\\/2.x\\ y', 'div.a\\a b', '#box > a.promo', 'body:nth-of-type(1) > section.x > p:nth-of-type(2)', 'div.café', 'my-element:nth-of-type(12)'];
  for (const selector of ok) assert.deepEqual(parsePick(pick(selector), PAGE), { host: 'www.example.com', selector }, selector);
  assert.equal(selectorFor([el('div', { classes: ['a\nb'] })], 1), 'div.a\\a b');
});

test('parsePick accepts every selector selectorFor makes, whatever the page calls its tags, ids and classes', () => {
  const nasty = ['a', 'x', 'Z', '1', '-', '_', ':', '.', '#', ' ', '\\', '/', '*', '(', ')', '{', '}', ';', '"', "'", '@', '<', '>', ',', '+', '~', '[', ']', '=', '!', '%', '&', '\n', '\t', '\u0001', '\u007f', '\u0000', 'é', '\u{1f600}', '￿', '-1', '--', '/*', '*/'];
  let seed = 12345;
  const next = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
  const word = () => Array.from({ length: 1 + next(6) }, () => nasty[next(nasty.length)]).join('');
  const names = ['promo', 'wrap', 'id-1', 'css-1q2w3e'];
  const chain = (): ElementInfo[] =>
    Array.from({ length: 1 + next(4) }, () => ({
      tag: next(3) === 0 ? word() : 'div',
      id: next(3) === 0 ? names[next(2) + 2] : next(4) === 0 ? word() : '',
      classes: Array.from({ length: next(4) }, () => (next(2) ? word() : names[next(names.length)])),
      nth: 1 + next(9),
    }));
  let made = 0;
  for (let i = 0; i < 400; i++) {
    const c = chain();
    for (let levels = 1; levels <= c.length; levels++) {
      const selector = selectorFor(c, levels);
      assert.deepEqual(parsePick(pick(selector), PAGE), { host: 'www.example.com', selector }, JSON.stringify(selector));
      made++;
    }
  }
  assert.ok(made > 300, 'the generator made selectors');
});

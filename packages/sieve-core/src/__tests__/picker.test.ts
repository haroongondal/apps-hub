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

test('parsePick takes the host from the sender, not from the message', () => {
  assert.deepEqual(parsePick({ type: 'pick', host: 'www.example.com', selector: 'div.wrap > a.promo' }, PAGE), { host: 'example.com', selector: 'div.wrap > a.promo' });
  assert.deepEqual(parsePick({ type: 'pick', host: 'evil.com', selector: '.a' }, PAGE), { host: 'example.com', selector: '.a' });
  assert.deepEqual(parsePick({ type: 'pick', host: 'x', selector: '.a' }, 'http://localhost:3000/'), { host: 'localhost', selector: '.a' });
  assert.deepEqual(parsePick({ type: 'pick', host: 'x', selector: '.a' }, 'http://192.168.1.2/'), { host: '192.168.1.2', selector: '.a' });
});

test('parsePick refuses a sender that is not a web page with a host Sieve can use', () => {
  const msg = { type: 'pick', host: 'x', selector: '.a' };
  for (const url of [undefined, '', 'chrome://extensions', 'file:///tmp/x.html', 'chrome-extension://abc/popup.html', 'http://[::1]:8080/', 'http://my_host.test/', 'about:blank']) {
    assert.equal(parsePick(msg, url), null, String(url));
  }
});

test('parsePick refuses a message that is not a well-formed pick', () => {
  for (const msg of [null, undefined, 'pick', [], {}, { type: 'pick' }, { type: 'pick', host: 'x' }, { type: 'pick', selector: '.a' }, { type: 'other', host: 'x', selector: '.a' }, { type: 'pick', host: 1, selector: '.a' }, { type: 'pick', host: 'x', selector: 1 }]) {
    assert.equal(parsePick(msg, PAGE), null, JSON.stringify(msg));
  }
  assert.equal(parsePick({ type: 'pick', host: 'x'.repeat(300), selector: '.a' }, PAGE), null);
  assert.equal(parsePick({ type: 'pick', host: 'x', selector: `.${'a'.repeat(1000)}` }, PAGE), null);
});

test('parsePick refuses a selector that is not what the picker builds', () => {
  const bad = [
    '',
    '.a\n.b',
    '.a\r\nexample.com#%#//scriptlet("x")',
    '.a\\\n.b',
    '.a\u0000',
    '.a, body',
    '.a{}',
    '.a}body{display:none',
    '.a;',
    '/*',
    '.a/*x*/',
    '.a"b',
    "a[href='x']",
    '*',
    '.a ~ .b',
    '.a + .b',
    '.a\\',
    ' .a',
    '>',
  ];
  for (const selector of bad) assert.equal(parsePick({ type: 'pick', host: 'x', selector }, PAGE), null, JSON.stringify(selector));
});

test('parsePick accepts every selector shape the picker builds', () => {
  const ok = ['#main-ad', 'div.promo', 'a:nth-of-type(3)', 'div.a\\:b', 'div.\\31 a.w-1\\/2.x\\ y', 'div.a\\a b', '#box > a.promo', 'body > section.x > p:nth-of-type(2)', '.café'];
  for (const selector of ok) assert.deepEqual(parsePick({ type: 'pick', host: 'x', selector }, PAGE), { host: 'example.com', selector }, selector);
  assert.equal(selectorFor([el('div', { classes: ['a\nb'] })], 1), 'div.a\\a b');
});

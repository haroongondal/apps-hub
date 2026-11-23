import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { extractPalette, contrastRatio, contrastOf } = createRequire(import.meta.url)('../image-maths.js');

const make = (n, fn) => {
  const px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) px.set(fn(i).length === 3 ? [...fn(i), 255] : fn(i), i * 4);
  return px;
};
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} is not within ${eps} of ${b}`);
const sum = (list) => list.reduce((s, c) => s + c.share, 0);

test('two colours: exact hex and shares, biggest first', () => {
  const px = make(100, (i) => (i < 70 ? [255, 0, 0] : [0, 0, 255]));
  const out = extractPalette(px, { count: 2, width: 10, height: 10 });
  assert.deepEqual(out.map((c) => c.hex), ['#ff0000', '#0000ff']);
  near(out[0].share, 0.7); near(out[1].share, 0.3);
});

test('a gradient gives spread-out colours that sum to one', () => {
  const px = make(256, (i) => [i, i, i]);
  const out = extractPalette(px, { count: 5 });
  assert.equal(out.length, 5);
  near(sum(out), 1, 1e-9);
  const lights = out.map((c) => parseInt(c.hex.slice(1, 3), 16)).sort((a, b) => a - b);
  for (let i = 1; i < lights.length; i++) assert.ok(lights[i] - lights[i - 1] >= 24, lights.join());
  assert.ok(lights[0] < 64 && lights.at(-1) > 192, lights.join());
});

test('transparent pixels are skipped and an invisible image gives nothing', () => {
  const px = make(100, (i) => (i < 60 ? [0, 255, 0, 0] : i < 90 ? [255, 255, 0, 255] : [9, 9, 9, 127]));
  const out = extractPalette(px, { count: 4 });
  assert.deepEqual(out, [{ hex: '#ffff00', share: 1 }]);
  assert.deepEqual(extractPalette(make(4, () => [1, 2, 3, 0]), { count: 3 }), []);
  assert.deepEqual(extractPalette(new Uint8ClampedArray(0)), []);
});

test('asking for more colours than the image has returns only the ones it has', () => {
  const colours = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];
  const out = extractPalette(make(90, (i) => colours[i % 3]), { count: 8 });
  assert.equal(out.length, 3);
  near(out[0].share, 1 / 3);
});

test('near-duplicate colours merge into the bigger one', () => {
  const px = make(100, (i) => (i < 60 ? [200, 30, 30] : i < 90 ? [204, 32, 28] : [20, 20, 200]));
  const out = extractPalette(px, { count: 6 });
  assert.equal(out.length, 2);
  near(out[0].share, 0.9);
});

test('the same pixels always give the same palette', () => {
  let s = 7;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) % 256;
  const px = make(5000, () => [rnd(), rnd(), rnd()]);
  const a = extractPalette(px, { count: 6 });
  assert.deepEqual(extractPalette(px.slice(), { count: 6 }), a);
  assert.equal(a.length, 6);
  near(sum(a), 1, 1e-9);
  assert.ok(a.every((c, i) => i === 0 || a[i - 1].share >= c.share));
});

test('pixels that do not match the size are refused', () => {
  assert.throws(() => extractPalette(new Uint8ClampedArray(12), { width: 2, height: 2 }), RangeError);
});

test('contrast ratios match the WCAG values', () => {
  near(contrastRatio('#000000', '#ffffff'), 21, 1e-9);
  near(contrastRatio('#ffffff', '#000000'), 21, 1e-9);
  near(contrastRatio('#336699', '#336699'), 1, 1e-9);
  near(contrastRatio('#767676', '#ffffff'), 4.54, 0.005);
  near(contrastRatio('#ff0000', '#ffffff'), 3.998, 0.005);
  near(contrastRatio('#0000ff', '#ffffff'), 8.592, 0.005);
});

test('readable text is the better of white and black', () => {
  assert.deepEqual(contrastOf('#ffffff'), { white: 1, black: 21, text: '#000000', ratio: 21, aa: true });
  assert.equal(contrastOf('#000000').text, '#ffffff');
  assert.equal(contrastOf('#1d2433').text, '#ffffff');
  assert.equal(contrastOf('#ffd43b').text, '#000000');
  const mid = contrastOf('#808080');
  assert.equal(mid.text, '#000000');
  assert.equal(mid.aa, true);
});

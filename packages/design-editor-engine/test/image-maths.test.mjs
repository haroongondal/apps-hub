import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { paletteFromPixels, enhanceValues, upscaleEstimate } = createRequire(import.meta.url)('../image-maths.js');

// RGBA array from fn(i) -> [r, g, b, a?]
const make = (n, fn) => {
  const px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const [r, g, b, a = 255] = fn(i);
    px.set([r, g, b, a], i * 4);
  }
  return px;
};
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const dist = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
const distinct = (list) => list.every((a, i) => list.every((b, j) => i === j || dist(a, b) >= 16));
const grey = (v) => [v, v, v];

test('palette: six distinct colours for a busy image', () => {
  let s = 12345;
  const noise = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) % 40) - 20;
  const px = make(128 * 96, (i) => {
    const h = ((i % 128) / 128) * 6, x = 1 - Math.abs((h % 2) - 1);
    const [r, g, b] = [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]][Math.floor(h) % 6];
    const l = 60 + (i / (128 * 96)) * 150;
    return [r, g, b].map((c) => Math.max(0, Math.min(255, c * l + noise())));
  });
  const p = paletteFromPixels(px);
  assert.equal(p.length, 6);
  assert.ok(p.every((c) => /^#[0-9a-f]{6}$/.test(c)));
  assert.ok(distinct(p));
});

test('palette: same input, same output', () => {
  const px = make(5000, (i) => [i % 256, (i * 7) % 256, (i * 13) % 256]);
  assert.deepEqual(paletteFromPixels(px), paletteFromPixels(px));
});

test('palette: biggest cluster first', () => {
  const px = make(1000, (i) => (i < 700 ? rgb('#2040c0') : rgb('#e0e0e0')));
  const p = paletteFromPixels(px);
  assert.ok(dist(p[0], '#2040c0') <= 16);
  assert.equal(p.length, 6);
  assert.ok(distinct(p));
});

test('palette: one-colour image still gives six', () => {
  const p = paletteFromPixels(make(1000, () => rgb('#808080')));
  assert.equal(p.length, 6);
  assert.ok(distinct(p));
  assert.ok(dist(p[0], '#808080') <= 16);
});

test('palette: transparent pixels are ignored', () => {
  const px = make(1000, (i) => (i < 500 ? [255, 0, 0, 0] : [0, 0, 255, 255]));
  assert.ok(paletteFromPixels(px).every((c) => dist(c, '#ff0000') >= 40));
  assert.deepEqual(paletteFromPixels(make(100, () => [10, 20, 30, 0])), []);
});

test('palette: under 200 ms on 128x128', () => {
  let s = 99;
  const px = make(128 * 128, () => [0, 0, 0].map(() => (s = (s * 1103515245 + 12345) & 0x7fffffff) % 256));
  const t = performance.now();
  paletteFromPixels(px);
  const ms = performance.now() - t;
  console.log(`palette 128x128: ${ms.toFixed(1)} ms`);
  assert.ok(ms < 200);
});

const ramp = (lo, hi) => make(2560, (i) => grey(lo + ((hi - lo) * (i % 256)) / 255));
const cases = {
  full: ramp(0, 255),
  flat: make(100, () => grey(120)),
  dull: ramp(100, 150),
  dark: ramp(0, 80),
};

test('enhance: full-range image is left alone', () => {
  assert.deepEqual(enhanceValues(cases.full), { brightness: 0, contrast: 0 });
});

test('enhance: flat image is left alone', () => {
  assert.deepEqual(enhanceValues(cases.flat), { brightness: 0, contrast: 0 });
});

test('enhance: dull image gets more contrast', () => {
  const { brightness, contrast } = enhanceValues(cases.dull);
  assert.ok(contrast > 0 && contrast <= 0.3);
  assert.ok(Math.abs(brightness) <= 0.25);
});

test('enhance: dark image gets brighter', () => {
  assert.ok(enhanceValues(cases.dark).brightness > 0);
});

test('enhance: values sit on the slider steps', () => {
  for (const px of Object.values(cases)) {
    for (const v of Object.values(enhanceValues(px))) {
      assert.equal(Math.round(v * 50), v * 50);
      assert.ok(!Object.is(v, -0));
    }
  }
  assert.deepEqual(enhanceValues(make(10, () => [1, 2, 3, 0])), { brightness: 0, contrast: 0 });
});

test('enhance: brightness is capped at the same size both ways', () => {
  assert.equal(enhanceValues(ramp(0, 40)).brightness, 0.24);
  assert.equal(enhanceValues(ramp(215, 255)).brightness, -0.24);
});

test('enhance: a dull ramp gets the capped contrast', () => {
  assert.equal(enhanceValues(cases.dull).contrast, 0.24);
});

test('palette: a noisy three-colour image comes back in order of weight', () => {
  let s = 4242;
  const noise = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) % 9) - 4;
  const base = [rgb('#c03020'), rgb('#2060c0'), rgb('#30a050')];
  const px = make(1000, (i) => base[i < 500 ? 0 : i < 800 ? 1 : 2].map((v) => v + noise()));
  const p = paletteFromPixels(px);
  base.forEach((c, i) => assert.ok(dist(p[i], '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')) <= 12, `swatch ${i} is ${p[i]}`));
});

test('palette: alpha 128 is visible, alpha 127 is not', () => {
  assert.deepEqual(paletteFromPixels(make(100, () => [200, 10, 10, 127])), []);
  assert.equal(paletteFromPixels(make(100, () => [200, 10, 10, 128])).length, 6);
});

test('upscale: sizes follow the owner rule (same table as UpscaleMathsTest.kt)', () => {
  const size = (w, h, s) => { const e = upscaleEstimate(w, h, s); return e && [e.inW, e.inH, e.outW, e.outH]; };
  assert.deepEqual(size(1080, 1080, 2), [540, 540, 2160, 2160]);
  assert.deepEqual(size(1080, 1080, 4), [1024, 1024, 4096, 4096]);
  assert.deepEqual(size(300, 200, 2), [150, 100, 600, 400]);
  assert.deepEqual(size(300, 200, 4), [300, 200, 1200, 800]);
  assert.deepEqual(size(2000, 1000, 2), [1000, 500, 4000, 2000]);
  assert.deepEqual(size(2000, 1000, 4), [1024, 512, 4096, 2048]);
  assert.deepEqual(size(1, 1, 2), [1, 1, 4, 4]);
  assert.deepEqual(size(5, 3, 2), [2, 2, 8, 8], 'rint: 2.5 -> 2, 1.5 -> 2');
  assert.equal(upscaleEstimate(4096, 10, 2), null);
  assert.equal(upscaleEstimate(10, 5000, 4), null);
  assert.notEqual(upscaleEstimate(4095, 10, 4), null);
});

test('upscale: the time estimate and its label', () => {
  const est = (w, h, s) => { const e = upscaleEstimate(w, h, s); return [e.tiles, e.label]; };
  assert.deepEqual(est(1080, 1080, 2), [25, 'About 50 seconds']);
  assert.deepEqual(est(1080, 1080, 4), [64, 'About 2 minutes']);
  assert.deepEqual(est(300, 200, 2), [2, 'A few seconds']);
  assert.deepEqual(est(2000, 1000, 4), [32, 'About 1 minute']);
  assert.deepEqual(est(640, 128, 4), [5, 'A few seconds'], '9.5 s is under 10');
  assert.deepEqual(est(768, 128, 4), [6, 'About 10 seconds'], '11.4 s');
  assert.equal(upscaleEstimate(1080, 1080, 2).seconds, 25 * 1.9);
});

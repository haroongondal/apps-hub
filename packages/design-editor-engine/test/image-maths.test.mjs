import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { upscaleEstimate } = createRequire(import.meta.url)('../image-maths.js');

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
  assert.deepEqual(est(896, 512, 4), [28, 'About 50 seconds'], '53.2 s');
  assert.deepEqual(est(768, 640, 4), [30, 'About 1 minute'], '57 s rounds to a minute, not "About 60 seconds"');
  assert.equal(upscaleEstimate(1080, 1080, 2).seconds, 25 * 1.9);
});

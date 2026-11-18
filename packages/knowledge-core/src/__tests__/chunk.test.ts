import test from 'node:test';
import assert from 'node:assert/strict';

import { chunkSegments } from '../chunk.ts';

test('short segments on the same page join; a new page starts a new chunk', () => {
  const out = chunkSegments([
    { text: 'one', locator: { page: 1 } },
    { text: 'two', locator: { page: 1 } },
    { text: 'three', locator: { page: 2 } },
  ]);
  assert.deepEqual(out, [
    { text: 'one two', locator: { page: 1 } },
    { text: 'three', locator: { page: 2 } },
  ]);
});

test('consecutive transcript segments join into one time range', () => {
  const out = chunkSegments([
    { text: 'hello', locator: { startSec: 0, endSec: 4 } },
    { text: 'world', locator: { startSec: 4, endSec: 9 } },
  ]);
  assert.deepEqual(out, [{ text: 'hello world', locator: { startSec: 0, endSec: 9 } }]);
});

test('long text splits at a space and no chunk exceeds the limit', () => {
  const text = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ');
  const out = chunkSegments([{ text, locator: null }], 40);
  assert.ok(out.length > 1);
  assert.ok(out.every((c) => c.text.length <= 40 && !c.text.startsWith(' ')));
  assert.equal(out.map((c) => c.text).join(' '), text);
});

test('a word longer than the limit is cut hard', () => {
  const out = chunkSegments([{ text: 'x'.repeat(25), locator: null }], 10);
  assert.deepEqual(out.map((c) => c.text.length), [10, 10, 5]);
});

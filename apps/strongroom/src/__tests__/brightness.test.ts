import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serialBrightness } from '../brightness.ts';

const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('a slow bright(true) cannot land after a later bright(false)', async () => {
  const done: boolean[] = [];
  const bright = serialBrightness(async (on) => {
    await later(on ? 30 : 0);
    done.push(on);
  });
  bright(true);
  bright(false);
  await later(80);
  assert.deepEqual(done, [true, false]);
});

test('a failed bright(false) is retried once, a failed bright(true) is not', async () => {
  const calls: boolean[] = [];
  let failOff = 1;
  const bright = serialBrightness(async (on) => {
    calls.push(on);
    if (on || failOff-- > 0) throw new Error('native');
  });
  bright(true);
  bright(false);
  await later(20);
  assert.deepEqual(calls, [true, false, false]);
});

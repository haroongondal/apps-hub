import assert from 'node:assert/strict';
import { test } from 'node:test';

import { changedWriter, createHeartbeat } from '../nexus/share-files.ts';

test('the writer writes only when the text changed, and tries again after a failed write', () => {
  const written: string[] = [];
  let fail = true;
  const write = changedWriter((t) => {
    if (fail) throw new Error('disk');
    written.push(t);
  });
  assert.throws(() => write('a'));
  fail = false;
  assert.equal(write('a'), true);
  assert.equal(write('a'), false);
  assert.equal(write('b'), true);
  assert.equal(write('a'), true);
  assert.deepEqual(written, ['a', 'b', 'a']);
});

test('the heartbeat writes decimal epoch ms, at most once a minute', () => {
  let now = 1_732_400_000_123;
  const written: string[] = [];
  const hb = createHeartbeat({ now: () => now, write: (t) => written.push(t) });
  assert.equal(hb.beat(), true);
  now += 59_999;
  assert.equal(hb.beat(), false);
  now += 1;
  assert.equal(hb.beat(), true);
  assert.deepEqual(written, ['1732400000123', '1732400060123']);
  assert.ok(written.every((w) => /^[0-9]+$/.test(w)));
});

test('a failed heartbeat write is not counted, so the next call tries again', () => {
  let fail = true;
  const written: string[] = [];
  const hb = createHeartbeat({
    now: () => 5000,
    write: (t) => {
      if (fail) throw new Error('disk');
      written.push(t);
    },
  });
  assert.equal(hb.beat(), false);
  fail = false;
  assert.equal(hb.beat(), true);
  assert.deepEqual(written, ['5000']);
});

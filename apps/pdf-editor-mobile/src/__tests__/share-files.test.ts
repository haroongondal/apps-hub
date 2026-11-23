import assert from 'node:assert/strict';
import { test } from 'node:test';

import { closedFile, createHeartbeat } from '../nexus/share-files.ts';

function fakeFile(content: string | null = null) {
  const f = {
    content,
    failWrite: false,
    failRemove: false,
    written: [] as string[],
    write(t: string) {
      if (f.failWrite) throw new Error('disk full');
      f.written.push(t);
      f.content = t;
    },
    remove() {
      if (f.failRemove) throw new Error('read-only');
      f.content = null;
    },
  };
  return f;
}

test('the file is written only when the text changed, and a failed write is tried again', () => {
  const f = fakeFile();
  const file = closedFile(f);
  f.failWrite = true;
  assert.throws(() => file.put('a'));
  f.failWrite = false;
  assert.equal(file.put('a'), true);
  assert.equal(file.put('a'), false);
  assert.equal(file.put('b'), true);
  assert.equal(file.put('a'), true);
  assert.deepEqual(f.written, ['a', 'b', 'a']);
});

test('a failed write removes the old file, so an older "on" never keeps serving', () => {
  const f = fakeFile();
  const file = closedFile(f);
  file.put('{"on":true}');
  f.failWrite = true;
  assert.throws(() => file.put('{"on":false}'), /disk full/);
  assert.equal(f.content, null);
});

test('clear removes the file, throws when it cannot, and the next write is not skipped', () => {
  const f = fakeFile();
  const file = closedFile(f);
  file.put('on');
  f.failRemove = true;
  assert.throws(() => file.clear(), /read-only/);
  assert.equal(f.content, 'on');
  f.failRemove = false;
  file.clear();
  assert.equal(f.content, null);
  assert.equal(file.put('on'), true);
  assert.equal(f.content, 'on');
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

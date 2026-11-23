import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InboxItem } from '../media/share-intake.ts';
import { defaultTicked, handOff, mixedKinds, takeHandoff, toolsFor } from '../media/share-tools.ts';

const pic = (n: number): InboxItem => ({ uri: `p${n}`, name: `p${n}.jpg`, kind: 'image', bytes: 1 });
const vid = (n: number): InboxItem => ({ uri: `v${n}`, name: `v${n}.mp4`, kind: 'video', bytes: 1 });
const keys = (items: InboxItem[]) => toolsFor(items).map(t => t.key);

test('a picture can only be shrunk, one or several', () => {
  assert.deepEqual(keys([pic(1)]), ['image']);
  assert.deepEqual(keys([pic(1), pic(2)]), ['image']);
});

test('one video gets every video tool; several lose the tools that work on one video', () => {
  assert.ok(keys([vid(1)]).includes('trim'));
  assert.ok(keys([vid(1)]).includes('gif'));
  const many = keys([vid(1), vid(2)]);
  assert.ok(many.includes('smaller') && many.includes('format'));
  assert.ok(!many.includes('trim') && !many.includes('gif') && !many.includes('picture'));
});

test('pictures and videos together, or nothing chosen, give no tools', () => {
  assert.deepEqual(keys([pic(1), vid(1)]), []);
  assert.deepEqual(keys([]), []);
  assert.equal(mixedKinds([pic(1), vid(1)]), true);
  assert.equal(mixedKinds([pic(1), pic(2)]), false);
});

test('a mixed share starts with the first kind chosen', () => {
  assert.deepEqual(defaultTicked([vid(1), pic(1), vid(2)]), ['v1', 'v2']);
  assert.deepEqual(defaultTicked([]), []);
});

test('the hand-off to a tool is taken once', () => {
  handOff([pic(1)]);
  assert.equal(takeHandoff().length, 1);
  assert.equal(takeHandoff().length, 0);
});

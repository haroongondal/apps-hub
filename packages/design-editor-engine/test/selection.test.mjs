import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { idsToReselect } = createRequire(import.meta.url)('../selection.js');

const objs = ['a', 'b', 'c'].map(id => ({ id }));

test('reselect: finds the object with the same id', () => {
  assert.deepEqual(idsToReselect(['b'], objs), [objs[1]]);
});
test('reselect: an id that is gone gives nothing', () => {
  assert.deepEqual(idsToReselect(['z'], objs), []);
  assert.deepEqual(idsToReselect(['a', 'z'], objs), [objs[0]]);
});
test('reselect: keeps the order of the selected ids', () => {
  assert.deepEqual(idsToReselect(['c', 'a'], objs), [objs[2], objs[0]]);
});
test('reselect: a duplicate id is selected once', () => {
  assert.deepEqual(idsToReselect(['a', 'a'], objs), [objs[0]]);
  const twins = [{ id: 'a' }, { id: 'a' }];
  assert.deepEqual(idsToReselect(['a'], twins), [twins[0]]);
});
test('reselect: empty or missing ids select nothing', () => {
  assert.deepEqual(idsToReselect([], objs), []);
  assert.deepEqual(idsToReselect([undefined], [{}]), []);
  assert.deepEqual(idsToReselect(['a'], []), []);
});

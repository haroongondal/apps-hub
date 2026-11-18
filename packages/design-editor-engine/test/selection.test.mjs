import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { idsToReselect, giveIds } = createRequire(import.meta.url)('../selection.js');

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

const counter = () => { let n = 0; return () => 'n' + ++n; };
test('ids: an object without an id gets one', () => {
  assert.deepEqual(giveIds([{}, { id: '' }], counter()).map(o => o.id), ['n1', 'n2']);
});
test('ids: a duplicate on the same page gets a new one, the first keeps its id', () => {
  assert.deepEqual(giveIds([{ id: 'a' }, { id: 'a' }], counter()).map(o => o.id), ['a', 'n1']);
});
test('ids: unique ids are kept', () => {
  const objs = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(giveIds(objs, counter()).map(o => o.id), ['a', 'b']);
});
test('ids: a made id that is taken is made again', () => {
  const ids = ['a', 'b'];
  assert.deepEqual(giveIds([{ id: 'a' }, {}], () => ids.shift()).map(o => o.id), ['a', 'b']);
});
test('ids: an empty page stays empty', () => {
  assert.deepEqual(giveIds([], counter()), []);
});

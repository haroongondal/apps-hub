import assert from 'node:assert/strict';
import { test } from 'node:test';
import { outputName } from '../names.ts';

const none = () => false;

test('names: size outputs are "<name> (compressed).mp4"', () => {
  assert.equal(outputName('Trip.mov', none), 'Trip (compressed).mp4');
});

test('names: a taken name gets " 2", then " 3" (PRD FR-10)', () => {
  const taken = new Set(['Trip (compressed).mp4', 'Trip (compressed) 2.mp4']);
  assert.equal(outputName('Trip.mp4', n => taken.has(n)), 'Trip (compressed) 3.mp4');
});

test('names: path separators and control characters never reach the file name', () => {
  assert.equal(outputName('a/b:c*d?.mp4', none), 'a_b_c_d_ (compressed).mp4');
});

test('names: a name without an extension keeps all of it; a dotfile keeps its dot', () => {
  assert.equal(outputName('Holiday', none), 'Holiday (compressed).mp4');
  assert.equal(outputName('.clip', none), '.clip (compressed).mp4');
});

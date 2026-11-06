import assert from 'node:assert/strict';
import { test } from 'node:test';
import { outputName } from '../names.ts';

const none = () => false;

test('names: a size output is "<name> (compressed).mp4"', () => {
  assert.equal(outputName('Trip.mov', 'compressed', 'mp4', none), 'Trip (compressed).mp4');
});

test('names: a taken name gets " 2", then " 3" (PRD FR-10)', () => {
  const taken = new Set(['Trip (compressed).mp4', 'Trip (compressed) 2.mp4']);
  assert.equal(outputName('Trip.mp4', 'compressed', 'mp4', n => taken.has(n)), 'Trip (compressed) 3.mp4');
});

test('names: path separators and control characters never reach the file name', () => {
  assert.equal(outputName('a/b:c*d?.mp4', 'compressed', 'mp4', none), 'a_b_c_d_ (compressed).mp4');
});

test('names: a name without an extension keeps all of it; a dotfile keeps its dot', () => {
  assert.equal(outputName('Holiday', 'compressed', 'mp4', none), 'Holiday (compressed).mp4');
  assert.equal(outputName('.clip', 'compressed', 'mp4', none), '.clip (compressed).mp4');
});

test('names: a label cannot carry path separators', () => {
  assert.equal(outputName('Trip.mp4', 'audio 1 fra/../../x', 'm4a', none), 'Trip (audio 1 fra_.._.._x).m4a');
});

test('names: audio labels and a GIF with no label', () => {
  assert.equal(outputName('Film.mkv', 'audio 2 fra', 'm4a', none), 'Film (audio 2 fra).m4a');
  assert.equal(outputName('Clip.mp4', '', 'gif', none), 'Clip.gif');
});

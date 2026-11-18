import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isConvex, moveCorner } from '../scan/quad-math.ts';

type Quad = [number, number, number, number, number, number, number, number];
const unit: Quad = [0, 0, 1, 0, 1, 1, 0, 1];

test('moveCorner clamps to 0..1', () => {
  assert.deepEqual(moveCorner(unit, 1, 1.4, -0.2), [0, 0, 1, 0, 1, 1, 0, 1]);
  assert.deepEqual(moveCorner([0.2, 0.2, 0.8, 0.2, 0.8, 0.8, 0.2, 0.8], 2, 1.4, 0.9), [0.2, 0.2, 0.8, 0.2, 1, 0.9, 0.2, 0.8]);
});

test('a move that makes the quad non-convex is refused', () => {
  assert.equal(moveCorner(unit, 0, 0.9, 0.9), unit);
});

test('a move that keeps the quad convex changes only that corner', () => {
  assert.deepEqual(moveCorner(unit, 0, 0.1, 0.1), [0.1, 0.1, 1, 0, 1, 1, 0, 1]);
});

test('a move that flips the winding is refused', () => {
  assert.equal(moveCorner(unit, 0, 1.2, 1.2), unit);
  assert.equal(moveCorner(unit, 1, 0, 1), unit);
});

test('isConvex is false for a bow-tie and for a short array, true for a square', () => {
  assert.equal(isConvex(unit), true);
  assert.equal(isConvex([0, 0, 1, 1, 1, 0, 0, 1]), false);
  assert.equal(isConvex([0, 0, 1, 0, 1, 1] as unknown as Quad), false);
});

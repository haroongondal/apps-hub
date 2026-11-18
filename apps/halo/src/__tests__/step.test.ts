import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepValue } from '../step.ts';

test('steps land on clean values and stay in range', () => {
  assert.equal(stepValue(0.5, 1, 0, 1, 0.1), 0.6);
  assert.equal(stepValue(0.7, -1, 0, 1, 0.1), 0.6);
  assert.equal(stepValue(1, 1, 0, 1, 0.1), 1);
  assert.equal(stepValue(0, -1, 0, 32, 2), 0);
  assert.equal(stepValue(3, 1, 0, 32, 2), 6);
  assert.equal(stepValue(398, 1, 0, 400, 4), 400);
});

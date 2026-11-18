import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSwipe, swipeDirection } from '../swipe.ts';

test('a short slow drag springs back', () => {
  assert.equal(swipeDirection(100, 0.2, 400), 0);
  assert.equal(swipeDirection(-100, -0.2, 400), 0);
});

test('past a third of the row deletes toward the drag', () => {
  assert.equal(swipeDirection(150, 0, 400), 1);
  assert.equal(swipeDirection(-150, 0, 400), -1);
});

test('a fling deletes even when short', () => {
  assert.equal(swipeDirection(40, 1.5, 400), 1);
  assert.equal(swipeDirection(-40, -1.5, 400), -1);
  assert.equal(swipeDirection(0, -1.5, 400), -1);
});

test('only clearly sideways drags count as a swipe', () => {
  assert.equal(isSwipe(30, 5), true);
  assert.equal(isSwipe(8, 0), false);
  assert.equal(isSwipe(30, 20), false);
});

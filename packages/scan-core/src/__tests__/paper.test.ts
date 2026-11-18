import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pageSizePt } from '../paper.ts';

const near = (a: number, b: number, tol = 0.2) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('A4, Letter and landscape', () => {
  assert.deepEqual(pageSizePt(2480, 3508), { w: 595.28, h: 841.89 });
  assert.deepEqual(pageSizePt(3508, 2480), { w: 841.89, h: 595.28 });
  assert.deepEqual(pageSizePt(1700, 2200), { w: 612, h: 792 });
  assert.deepEqual(pageSizePt(2200, 1700), { w: 792, h: 612 });
});

test('anything else keeps its aspect on a long side of 841.89', () => {
  const card = pageSizePt(1600, 1009);
  near(card.w, 841.89);
  near(card.h, 530.8);
  const tall = pageSizePt(1009, 1600);
  near(tall.h, 841.89);
  near(tall.w, 530.8);
  assert.deepEqual(pageSizePt(1000, 1000), { w: 841.89, h: 841.89 });
});

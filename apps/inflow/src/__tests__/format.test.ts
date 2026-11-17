import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keepLabel, whenLabel } from '../format.ts';

// The test script sets TZ=Asia/Karachi (UTC+5, no daylight saving), so these local times are fixed.
const KARACHI = 5 * 3600 * 1000;
const at = (y: number, month: number, d: number, h: number, min: number) => Date.UTC(y, month - 1, d, h, min) - KARACHI;

const now = at(2026, 11, 13, 12, 30);

test('the same day shows the time', () => {
  assert.equal(whenLabel(at(2026, 11, 13, 12, 2), now), '12:02');
  assert.equal(whenLabel(at(2026, 11, 13, 0, 5), now), '00:05');
});

test('the previous day says Yesterday, even across midnight by minutes', () => {
  assert.equal(whenLabel(at(2026, 11, 12, 23, 59), now), 'Yesterday');
  assert.equal(whenLabel(at(2026, 11, 12, 0, 1), now), 'Yesterday');
  assert.equal(whenLabel(at(2026, 11, 13, 0, 1), at(2026, 11, 13, 0, 2)), '00:01');
});

test('an earlier day this year shows day and month', () => {
  assert.equal(whenLabel(at(2026, 11, 11, 12, 0), now), '11 Nov');
  assert.equal(whenLabel(at(2026, 1, 3, 9, 0), now), '3 Jan');
});

test('an earlier year shows the year too', () => {
  assert.equal(whenLabel(at(2025, 11, 12, 12, 0), now), '12 Nov 2025');
});

test('yesterday works across a month and a year boundary', () => {
  assert.equal(whenLabel(at(2026, 2, 28, 20, 0), at(2026, 3, 1, 8, 0)), 'Yesterday');
  assert.equal(whenLabel(at(2025, 12, 31, 20, 0), at(2026, 1, 1, 8, 0)), 'Yesterday');
});

test('keepLabel names the retention choices', () => {
  assert.equal(keepLabel(null), 'Forever');
  assert.equal(keepLabel(365), '1 year');
  assert.equal(keepLabel(90), '90 days');
  assert.equal(keepLabel(30), '30 days');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysFor, describeDays, describeWhen, parseTime, presetOf, toggleDay } from '../repeat.ts';

test('a typed time reads with or without a separator, and out-of-range times are refused', () => {
  assert.deepEqual(parseTime('8'), { hour: 8, minute: 0 });
  assert.deepEqual(parseTime(' 8:05 '), { hour: 8, minute: 5 });
  assert.deepEqual(parseTime('21.30'), { hour: 21, minute: 30 });
  assert.deepEqual(parseTime('0745'), { hour: 7, minute: 45 });
  for (const bad of ['', '24:00', '7:60', '7:5', 'seven', '7pm']) assert.equal(parseTime(bad), null, bad);
});

test('day sets read in plain words', () => {
  assert.equal(describeDays([7, 6, 5, 4, 3, 2, 1]), 'Every day');
  assert.equal(describeDays([1, 2, 3, 4, 5]), 'Weekdays');
  assert.equal(describeDays([6, 7]), 'Weekends');
  assert.equal(describeDays([1]), 'Mondays');
  assert.equal(describeDays([5, 1, 3]), 'Mon, Wed and Fri');
  assert.equal(describeWhen({ hour: 8, minute: 5, days: [1] }), 'Mondays at 08:05');
});

test('presets pick their days, and choosing days keeps what was picked', () => {
  assert.equal(presetOf([1, 2, 3, 4, 5]), 'weekdays');
  assert.equal(presetOf([1, 3]), 'days');
  assert.deepEqual(daysFor('daily', [1]), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(daysFor('days', [3, 1, 3]), [1, 3]);
  assert.deepEqual(toggleDay([1, 3], 3), [1]);
  assert.deepEqual(toggleDay([3], 1), [1, 3]);
});

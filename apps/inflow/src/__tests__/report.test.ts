import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ReportRow } from 'inflow-core';
import { barFraction, changeLabel, reportTitle } from '../report.ts';

const row = (kind: 'weekly' | 'monthly', start: Date, end: Date, partial = false): ReportRow => ({
  id: 1,
  kind,
  periodStart: start.getTime(),
  periodEnd: end.getTime(),
  partial,
  createdAt: end.getTime(),
  status: 'ready',
  message: null,
  headline: null,
});

test('barFraction scales to 0..1 and is 0 without a maximum', () => {
  assert.equal(barFraction(5, 10), 0.5);
  assert.equal(barFraction(3, 0), 0);
  assert.equal(barFraction(3, -1), 0);
  assert.equal(barFraction(12, 10), 1);
  assert.equal(barFraction(-4, 10), 0);
  assert.equal(barFraction(0, 10), 0);
});

test('changeLabel words the change against the last report', () => {
  assert.equal(changeLabel(38), 'Up 38%');
  assert.equal(changeLabel(-12.4), 'Down 12%');
  assert.equal(changeLabel(0.2), 'Same as before');
  assert.equal(changeLabel(-0.4), 'Same as before');
  assert.equal(changeLabel(null), null);
});

test('reportTitle names a week by its Monday to Sunday dates', () => {
  // Sunday 9 Nov 2025 21:00 to Sunday 16 Nov 2025 21:00 (Karachi).
  const w = row('weekly', new Date(2025, 10, 9, 21), new Date(2025, 10, 16, 21));
  assert.equal(reportTitle(w), 'Week of 10–16 Nov');
});

test('reportTitle spells both months when a week crosses a month end', () => {
  const w = row('weekly', new Date(2025, 9, 26, 21), new Date(2025, 10, 2, 21));
  assert.equal(reportTitle(w), 'Week of 27 Oct – 2 Nov');
});

test('reportTitle names a month and marks a partial week', () => {
  assert.equal(reportTitle(row('monthly', new Date(2026, 10, 1), new Date(2026, 11, 1))), 'November 2026');
  // Made on Wednesday 12 Nov 2025: the period still starts the Sunday before, the label is still the whole week.
  const p = row('weekly', new Date(2025, 10, 9, 21), new Date(2025, 10, 12, 15), true);
  assert.equal(reportTitle(p), 'Week of 10–16 Nov (so far)');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { HealthDay, HealthStatus } from 'inflow-core';
import { average, barFraction, dayLabel, fillSeries, formatBpm, formatSleep, formatSteps, lastDays, partialAccessNote, shouldRefresh, summaryLine, vitalsCopy, vitalsState } from '../vitals.ts';

const ALLOWED: HealthStatus = { availability: 'available', steps: true, sleep: true, heartRate: true };
const none: HealthStatus = { ...ALLOWED, steps: false, sleep: false, heartRate: false };
const day = (d: string, steps: number | null, sleepMinutes: number | null, hrAvg: number | null): HealthDay => ({ day: d, steps, sleepMinutes, hrAvg, hrLow: null });
const NOW = new Date(2026, 10, 23, 9, 30).getTime(); // 23 Nov 2026, 09:30 local (Asia/Karachi in the test script)

test('state: missing, update, not allowed, empty, data', () => {
  const rows = [day('2026-11-23', 4210, 445, 70)];
  assert.equal(vitalsState({ ...ALLOWED, availability: 'missing' }, rows), 'missing');
  assert.equal(vitalsState({ ...ALLOWED, availability: 'update' }, rows), 'update');
  assert.equal(vitalsState(none, rows), 'not-allowed');
  assert.equal(vitalsState(ALLOWED, []), 'empty');
  assert.equal(vitalsState(ALLOWED, [day('2026-11-22', null, null, null)]), 'empty');
  assert.equal(vitalsState(ALLOWED, rows), 'data');
  assert.equal(vitalsState({ ...ALLOWED, sleep: false }, rows), 'data');
});

test('partial access names what is missing; all or none gives no note', () => {
  assert.equal(partialAccessNote(ALLOWED), null);
  assert.equal(partialAccessNote(none), null);
  assert.equal(partialAccessNote({ ...ALLOWED, sleep: false }), "Inflow can't read your sleep yet. Allow access to add it.");
  assert.equal(partialAccessNote({ ...ALLOWED, steps: false, heartRate: false }), "Inflow can't read your steps and heart rate yet. Allow access to add them.");
});

test('copy: each empty state has plain words and the right action, no link', () => {
  assert.equal(vitalsCopy('missing').title, "Health Connect isn't on this phone");
  assert.equal(vitalsCopy('missing').action, null);
  assert.equal(vitalsCopy('update').action, null);
  assert.equal(vitalsCopy('not-allowed').action, 'allow');
  assert.equal(vitalsCopy('empty').title, 'No steps, sleep or heart rate saved in Health Connect for these days yet');
  for (const s of ['missing', 'update', 'not-allowed', 'empty'] as const) {
    const { title, body } = vitalsCopy(s);
    assert.doesNotMatch(`${title} ${body}`, /https?:|play\.google|normal|healthy|low risk|you should/i);
  }
});

test('last 7 days end today, oldest first, across a month and a year change', () => {
  assert.deepEqual(lastDays(NOW, 7), ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23']);
  assert.deepEqual(lastDays(new Date(2026, 0, 2, 0, 5).getTime(), 4), ['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']);
});

test('series fills missing days and keeps stored ones', () => {
  const s = fillSeries(lastDays(NOW, 3), [day('2026-11-22', 900, null, null)]);
  assert.deepEqual(s.map((d) => d.steps), [null, 900, null]);
  assert.equal(s[2].day, '2026-11-23');
});

test('average counts only days with a value and rounds', () => {
  const s = fillSeries(lastDays(NOW, 3), [day('2026-11-21', 1000, 400, null), day('2026-11-22', 2001, null, 61)]);
  assert.equal(average(s, 'steps'), 1501);
  assert.equal(average(s, 'sleepMinutes'), 400);
  assert.equal(average(s, 'hrAvg'), 61);
  assert.equal(average(fillSeries(lastDays(NOW, 3), []), 'steps'), null);
});

test('formatting: steps with commas, sleep as h and min, heart rate in bpm', () => {
  assert.equal(formatSteps(0), '0');
  assert.equal(formatSteps(999), '999');
  assert.equal(formatSteps(1000), '1,000');
  assert.equal(formatSteps(12345678), '12,345,678');
  assert.equal(formatSleep(445), '7 h 25 min');
  assert.equal(formatSleep(480), '8 h');
  assert.equal(formatSleep(45), '45 min');
  assert.equal(formatBpm(61.6), '62 bpm');
});

test('day labels: today, yesterday, then weekday and date', () => {
  assert.equal(dayLabel('2026-11-23', NOW), 'Today');
  assert.equal(dayLabel('2026-11-22', NOW), 'Yesterday');
  assert.equal(dayLabel('2026-11-20', NOW), 'Fri 20 Nov');
});

test('bars are relative to the biggest day; no value is no bar', () => {
  const s = fillSeries(lastDays(NOW, 3), [day('2026-11-21', 1000, null, null), day('2026-11-22', 4000, null, null)]);
  assert.equal(barFraction(4000, s, 'steps'), 1);
  assert.equal(barFraction(1000, s, 'steps'), 0.25);
  assert.equal(barFraction(null, s, 'steps'), 0);
  assert.equal(barFraction(0, fillSeries(lastDays(NOW, 1), []), 'steps'), 0);
});

test('refresh throttle: first run, 15 minute gap, manual always, clock set back', () => {
  const MIN = 60 * 1000;
  assert.equal(shouldRefresh(null, NOW, false), true);
  assert.equal(shouldRefresh(NOW - 14 * MIN, NOW, false), false);
  assert.equal(shouldRefresh(NOW - 15 * MIN, NOW, false), true);
  assert.equal(shouldRefresh(NOW - 1 * MIN, NOW, true), true);
  assert.equal(shouldRefresh(NOW + 5 * MIN, NOW, false), true);
});

test('summary line for the Health screen row', () => {
  assert.equal(summaryLine('data', day('2026-11-23', 4210, null, null)), 'Today: 4,210 steps');
  assert.equal(summaryLine('data', day('2026-11-23', null, 400, null)), 'See the last 7 days');
  assert.equal(summaryLine('empty', undefined), 'Nothing saved for these days yet');
  assert.equal(summaryLine('not-allowed', undefined), 'Allow access to see them');
  assert.equal(summaryLine('missing', undefined), "Health Connect isn't ready");
});

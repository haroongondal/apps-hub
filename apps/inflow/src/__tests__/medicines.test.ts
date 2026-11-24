import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AdherenceReport, AdherenceRow, DoseRow, Medicine } from 'inflow-core';
import { EARLY_MS, adherenceLines, buildMedicine, clockTime, daysSummary, doseView, emptyForm, formFromMedicine, medicineSubtitle, normalizeTime, splitMedicines, streakText, timesSummary, todayKey, validDay, type MedicineForm } from '../medicines.ts';

// TZ is Asia/Karachi (UTC+5, no daylight saving) in the test script.
const KARACHI = 5 * 3600 * 1000;
const at = (y: number, month: number, d: number, h: number, min: number) => Date.UTC(y, month - 1, d, h, min) - KARACHI;

const med = (over: Partial<Medicine> = {}): Medicine => ({ id: 1, name: 'Vitamin D', dose: '1 tablet', times: ['20:00', '08:00'], days: [5, 1, 3], startDay: '2026-11-01', endDay: null, active: true, createdAt: 0, ...over });
const dose = (status: DoseRow['status'], dueAt: number): DoseRow => ({ medicineId: 1, dueAt, windowEnd: dueAt + 4 * 3600 * 1000, status, markedAt: null });
const form = (over: Partial<MedicineForm> = {}): MedicineForm => ({ name: ' Vitamin D ', dose: '1 tablet', times: ['8:30', '20:00'], days: [3, 1], startDay: '2026-11-20', endDay: '', ...over });

test('daysSummary says Every day for all seven and short names otherwise', () => {
  assert.equal(daysSummary([1, 2, 3, 4, 5, 6, 7]), 'Every day');
  assert.equal(daysSummary([5, 1, 3]), 'Mon, Wed, Fri');
  assert.equal(daysSummary([7]), 'Sun');
  assert.equal(daysSummary([1, 1, 2]), 'Mon, Tue');
});

test('medicine lines sort times and split stopped ones out', () => {
  assert.equal(timesSummary(['20:00', '08:00']), '08:00, 20:00');
  assert.equal(medicineSubtitle(med()), '1 tablet. 08:00, 20:00. Mon, Wed, Fri.');
  const { active, stopped } = splitMedicines([med({ id: 1 }), med({ id: 2, active: false }), med({ id: 3 })]);
  assert.deepEqual(active.map((m) => m.id), [1, 3]);
  assert.deepEqual(stopped.map((m) => m.id), [2]);
});

test('today and clock time use the local day', () => {
  const late = at(2026, 11, 20, 23, 30);
  assert.equal(todayKey(late), '2026-11-20');
  assert.equal(todayKey(late + 31 * 60 * 1000), '2026-11-21');
  assert.equal(clockTime(at(2026, 11, 20, 8, 5)), '08:05');
});

test('doseView picks the status and which buttons show', () => {
  const now = at(2026, 11, 20, 12, 0);
  assert.deepEqual(doseView(dose('pending', now - 30 * 60 * 1000), now), { label: 'Due now', tone: 'accent', actions: ['taken', 'skipped'] });
  assert.deepEqual(doseView(dose('upcoming', now + EARLY_MS), now).actions, ['taken', 'skipped']);
  assert.deepEqual(doseView(dose('upcoming', now + EARLY_MS + 60_000), now), { label: 'Coming up', tone: 'neutral', actions: [] });
  assert.deepEqual(doseView(dose('taken', now - 60_000), now), { label: 'Taken', tone: 'ok', actions: [] });
  assert.deepEqual(doseView(dose('skipped', now - 60_000), now).actions, ['taken']);
  assert.deepEqual(doseView(dose('missed', now - 5 * 3600 * 1000), now), { label: 'Missed', tone: 'warn', actions: ['taken'] });
});

const row = (over: Partial<AdherenceRow>): AdherenceRow => ({ medicineId: 1, taken: 5, skipped: 1, missed: 1, percent: 71, streak: 5, ...over });

test('streakText counts days in a row without judging', () => {
  assert.equal(streakText(0), 'No days in a row yet');
  assert.equal(streakText(1), '1 day in a row');
  assert.equal(streakText(5), '5 days in a row');
});

test('adherenceLines show counts, percent and streak per medicine', () => {
  const report: AdherenceReport = { period: 'week', fromDay: '2026-11-14', toDay: '2026-11-20', all: row({ medicineId: null, taken: 6, skipped: 1, missed: 1, percent: 75, streak: 2 }), medicines: [row({ medicineId: 1 }), row({ medicineId: 2, taken: 0, skipped: 0, missed: 0, percent: null, streak: 0 })] };
  const lines = adherenceLines(report, [med({ id: 1 }), med({ id: 2, name: 'Iron' })]);
  assert.deepEqual(lines.map((l) => l.name), ['All medicines', 'Vitamin D', 'Iron']);
  assert.deepEqual(lines[1], { key: '1', name: 'Vitamin D', percent: '71%', counts: 'Taken 5 of 7', streak: '5 days in a row' });
  assert.equal(lines[2].percent, 'Nothing counted yet');
  assert.equal(lines[2].counts, 'Taken 0 of 0');
  assert.equal(lines[0].streak, '2 days in a row');
});

test('adherenceLines skips the all row for one medicine and names a removed one', () => {
  const report: AdherenceReport = { period: 'month', fromDay: '', toDay: '', all: row({ medicineId: null }), medicines: [row({ medicineId: 9 })] };
  assert.deepEqual(adherenceLines(report, []).map((l) => l.name), ['A removed medicine']);
});

test('time and day text is checked like the native side', () => {
  assert.equal(normalizeTime('8:30'), '08:30');
  assert.equal(normalizeTime(' 23:59 '), '23:59');
  for (const bad of ['24:00', '8:60', '830', '8.30', '', '08:5']) assert.equal(normalizeTime(bad), null, bad);
  assert.equal(validDay('2026-02-28'), true);
  for (const bad of ['2026-02-30', '2026-13-01', '26-11-20', '2026-1-5', '']) assert.equal(validDay(bad), false, bad);
});

test('buildMedicine returns a clean input', () => {
  assert.deepEqual(buildMedicine(null, form()), { id: null, name: 'Vitamin D', dose: '1 tablet', times: ['08:30', '20:00'], days: [1, 3], startDay: '2026-11-20', endDay: null });
  assert.deepEqual(buildMedicine(4, form({ endDay: '2026-11-20' })), { id: 4, name: 'Vitamin D', dose: '1 tablet', times: ['08:30', '20:00'], days: [1, 3], startDay: '2026-11-20', endDay: '2026-11-20' });
});

test('buildMedicine names the problem in plain words', () => {
  const says = (over: Partial<MedicineForm>) => buildMedicine(null, form(over));
  assert.equal(says({ name: '  ' }), "Write the medicine's name.");
  assert.equal(says({ name: 'x'.repeat(81) }), 'Keep the name to 80 characters or fewer.');
  assert.equal(says({ name: 'x'.repeat(80) }) instanceof Object, true);
  assert.equal(says({ dose: '' }), 'Write the dose, for example 1 tablet.');
  assert.equal(says({ dose: 'x'.repeat(81) }), 'Keep the dose to 80 characters or fewer.');
  assert.equal(says({ times: [] }), 'Add at least one time of day.');
  assert.equal(says({ times: ['8:30', '25:00'] }), 'Write times as hours and minutes, like 08:30.');
  assert.equal(says({ times: Array.from({ length: 13 }, (_, i) => `${String(i).padStart(2, '0')}:00`) }), 'Add at most 12 times a day.');
  assert.equal(says({ times: Array.from({ length: 12 }, (_, i) => `${String(i).padStart(2, '0')}:00`) }) instanceof Object, true);
  assert.equal(says({ times: ['8:00', '08:00'] }), 'Each time can be added once.');
  assert.equal(says({ days: [] }), 'Pick at least one day of the week.');
  assert.equal(says({ startDay: '20 Nov' }), 'Write the start date as year-month-day, like 2026-11-20.');
  assert.equal(says({ endDay: 'soon' }), 'Write the end date as year-month-day, or leave it empty.');
  assert.equal(says({ endDay: '2026-11-19' }), "The end date can't be before the start date.");
});

test('a new form starts today, every day, at 08:00, and an existing one round-trips', () => {
  const now = at(2026, 11, 20, 12, 0);
  assert.deepEqual(emptyForm(now), { name: '', dose: '', times: ['08:00'], days: [1, 2, 3, 4, 5, 6, 7], startDay: '2026-11-20', endDay: '' });
  const m = med({ endDay: '2026-12-01' });
  const built = buildMedicine(m.id, formFromMedicine(m));
  assert.deepEqual(built, { id: 1, name: 'Vitamin D', dose: '1 tablet', times: ['08:00', '20:00'], days: [1, 3, 5], startDay: '2026-11-01', endDay: '2026-12-01' });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DlRecord, DlState } from '../dl-record.ts';
import type { QueueSetting, Schedule } from '../dl-settings.ts';
import { isOpen, minutesOf, nextChange, nextWake, queueOf, schedulePlan } from '../dl-queue.ts';

const D = (day: number, h = 0, m = 0) => new Date(2026, 10, day, h, m);   // Mon 9 Nov 2026; 8 is a Sunday
const ALL = [0, 1, 2, 3, 4, 5, 6];
const S1: Schedule = { on: true, days: [1, 2, 3, 4, 5], start: '22:00', stop: '06:00' };
const S2: Schedule = { on: true, days: ALL, start: '09:00', stop: '17:00' };
const S3: Schedule = { on: true, days: ALL, start: '20:00', stop: null };
const S4: Schedule = { on: true, days: ALL, start: '22:00', stop: '22:00' };
const OFF: Schedule = { on: false, days: ALL, start: '01:00', stop: '07:00' };

test('minutesOf: 00:00, 22:30, 23:59', () => {
  assert.equal(minutesOf('00:00'), 0);
  assert.equal(minutesOf('22:30'), 1350);
  assert.equal(minutesOf('23:59'), 1439);
});

test('isOpen: S1 examples (overnight weekdays, started Friday, Sun and Mon closed)', () => {
  assert.equal(isOpen(S1, D(10, 23)), true);
  assert.equal(isOpen(S1, D(11, 5, 59)), true);
  assert.equal(isOpen(S1, D(11, 6)), false);
  assert.equal(isOpen(S1, D(11, 21, 59)), false);
  assert.equal(isOpen(S1, D(14, 5)), true);
  assert.equal(isOpen(S1, D(14, 23)), false);
  assert.equal(isOpen(S1, D(8, 5)), false);
  assert.equal(isOpen(S1, D(9, 5)), false);
});

test('isOpen: S2 same-day window and its edges', () => {
  assert.equal(isOpen(S2, D(10, 10)), true);
  assert.equal(isOpen(S2, D(10, 17)), false);
  assert.equal(isOpen(S2, D(10, 8, 59)), false);
  assert.equal(isOpen(S2, D(10, 9)), true);
});

test('isOpen: S3 no stop closes at midnight', () => {
  assert.equal(isOpen(S3, D(10, 23, 59)), true);
  assert.equal(isOpen(S3, D(10, 19, 59)), false);
  assert.equal(isOpen(S3, D(11, 0)), false);
});

test('isOpen: S4 equal times are open all day', () => {
  for (const [h, m] of [[0, 0], [12, 0], [21, 59], [22, 0], [23, 59]]) assert.equal(isOpen(S4, D(10, h, m)), true);
});

test('isOpen: Saturday-only overnight window runs into Sunday', () => {
  const s: Schedule = { on: true, days: [6], start: '22:00', stop: '06:00' };
  assert.equal(isOpen(s, D(14, 23)), true);
  assert.equal(isOpen(s, D(15, 5)), true);
  assert.equal(isOpen(s, D(15, 7)), false);
  assert.equal(isOpen(s, D(13, 23)), false);
});

test('isOpen: a schedule that is off is always open', () => {
  assert.equal(isOpen(OFF, D(10, 12)), true);
  assert.equal(isOpen({ ...S1, on: false }, D(9, 5)), true);
});

test('nextChange: every fixed example', () => {
  assert.equal(nextChange(S1, D(10, 12)), D(10, 22).getTime());
  assert.equal(nextChange(S1, D(10, 23)), D(11, 6).getTime());
  assert.equal(nextChange(S1, D(11, 3)), D(11, 6).getTime());
  assert.equal(nextChange(S1, D(13, 23)), D(14, 6).getTime());
  assert.equal(nextChange(S1, D(14, 6)), D(16, 22).getTime());
  assert.equal(nextChange(S3, D(10, 12)), D(10, 20).getTime());
  assert.equal(nextChange(S3, D(10, 21)), D(11, 0).getTime());
  assert.equal(nextChange(S2, D(10, 12)), D(10, 17).getTime());
});

test('nextChange: off and S4 give null', () => {
  for (const at of [D(10, 12), D(14, 3), D(8, 0)]) {
    assert.equal(nextChange(S4, at), null);
    assert.equal(nextChange({ ...S1, on: false }, at), null);
  }
});

const q = (id: string, maxParallel: number, schedule: Schedule): QueueSetting => ({ id, name: id, maxParallel, schedule });

test('nextWake: off, one scheduled, two scheduled', () => {
  assert.equal(nextWake([q('a', 1, OFF), q('b', 1, OFF)], D(10, 12)), null);
  assert.equal(nextWake([q('a', 1, OFF), q('b', 1, S1)], D(10, 12)), D(10, 22).getTime());
  assert.equal(nextWake([q('a', 1, S1), q('b', 1, S2)], D(10, 12)), D(10, 17).getTime());
});

test('queueOf: unknown id falls back to the first queue', () => {
  const qs = [q('a', 1, OFF), q('b', 1, OFF)];
  assert.equal(queueOf(qs, 'b'), qs[1]);
  assert.equal(queueOf(qs, 'zzz'), qs[0]);
});

const rec = (id: string, queue: string, state: DlState, addedAt: number, force = false) => ({ id, queue, state, addedAt, force }) as DlRecord;
const worked = (): DlRecord[] => [
  rec('a', 'main', 'running', 1), rec('b', 'main', 'queued', 2), rec('c', 'main', 'queued', 3),
  rec('d', 'night', 'queued', 4), rec('e', 'night', 'running', 1), rec('f', 'main', 'queued', 5, true),
];
const wq = [q('main', 2, OFF), q('night', 1, S1)];

test('schedulePlan: worked example four ways', () => {
  assert.deepEqual(schedulePlan(worked(), wq, D(10, 12), true), { start: ['f'], stop: ['e'] });
  assert.deepEqual(schedulePlan(worked(), wq, D(10, 23), true), { start: ['f'], stop: [] });
  assert.deepEqual(schedulePlan(worked(), wq, D(10, 12), false), { start: ['f'], stop: ['a', 'e'] });
  const recs = worked().filter((r) => r.id !== 'f').map((r) => (r.id === 'a' ? { ...r, state: 'done' as const } : r));
  assert.deepEqual(schedulePlan(recs, wq, D(10, 12), true), { start: ['b', 'c'], stop: ['e'] });
});

test('schedulePlan: maxParallel 3 starts the three oldest', () => {
  const recs = [5, 4, 3, 2, 1].map((n) => rec(`r${n}`, 'main', 'queued', n));
  assert.deepEqual(schedulePlan(recs, [q('main', 3, OFF)], D(10, 12), true).start, ['r1', 'r2', 'r3']);
});

test('schedulePlan: equal addedAt ties break by id', () => {
  const recs = [rec('z', 'main', 'queued', 1), rec('a', 'main', 'queued', 1), rec('m', 'main', 'queued', 1)];
  assert.deepEqual(schedulePlan(recs, [q('main', 2, OFF)], D(10, 12), true).start, ['a', 'm']);
});

test('schedulePlan: paused, failed, saving and done are never listed', () => {
  const recs = (['paused', 'failed', 'saving', 'done'] as const).map((s, i) => rec(s, 'main', s, i));
  assert.deepEqual(schedulePlan(recs, [q('main', 3, OFF)], D(10, 12), true), { start: [], stop: [] });
  assert.deepEqual(schedulePlan(recs, [q('main', 3, OFF)], D(10, 12), false), { start: [], stop: [] });
});

test('schedulePlan: unknown queue id counts toward the first queue', () => {
  const recs = [rec('a', 'gone', 'running', 1), rec('b', 'main', 'queued', 2), rec('c', 'gone', 'queued', 3)];
  assert.deepEqual(schedulePlan(recs, [q('main', 2, OFF)], D(10, 12), true), { start: ['b'], stop: [] });
});

test('schedulePlan: nothing is mutated', () => {
  const recs = worked();
  const qs = structuredClone(wq);
  const before = structuredClone(recs);
  schedulePlan(recs, qs, D(10, 12), true);
  assert.deepEqual(recs, before);
  assert.deepEqual(qs, wq);
});

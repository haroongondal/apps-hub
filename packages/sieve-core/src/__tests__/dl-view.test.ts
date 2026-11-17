import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DlRecord, DlState } from '../dl-record.ts';
import type { CategoryId, QueueSetting } from '../dl-settings.ts';
import { etaSeconds, filterRecords, formatBytes, formatEta, formatSpeed, parseAddInput, plural, progressOf, sortRecords, statusText } from '../dl-view.ts';

let n = 0;
const rec = (over: Partial<DlRecord> = {}): DlRecord => ({
  id: `d${++n}`, url: 'https://a.com/f.zip', finalUrl: 'https://a.com/f.zip', referrer: '', name: 'f.zip', category: 'archives', categoryFixed: false,
  queue: 'main', state: 'queued', force: false, size: null, rangeOk: true, validator: null, mime: '', parts: [], partsWanted: 1,
  addedAt: n, startedAt: null, finishedAt: null, error: null, saveOnly: false, savedPath: null, savedId: null, chromeId: null, source: 'manual', ...over,
});

test('plural: one and thousands separators (re-export from dl-text)', () => {
  assert.equal(plural(1, 'download', 'downloads'), '1 download');
  assert.equal(plural(1234, 'download', 'downloads'), '1,234 downloads');
});

test('formatBytes: table values, 0, 999, NaN, -5', () => {
  const cases: [number, string][] = [
    [999_999, '1.0 MB'], [9_999, '10 KB'], [9_949, '9.9 KB'], [1_000, '1.0 KB'], [1_500, '1.5 KB'], [15_000, '15 KB'], [1_048_576, '1.0 MB'],
    [5_242_880, '5.2 MB'], [412_000_000, '412 MB'], [2_500_000_000, '2.5 GB'], [0, '0 B'], [999, '999 B'], [NaN, '0 B'], [-5, '0 B'], [999_500, '1.0 MB'],
  ];
  for (const [v, s] of cases) assert.equal(formatBytes(v), s, String(v));
});

test('formatSpeed: table values, 0, NaN', () => {
  assert.equal(formatSpeed(2_400_000), '2.4 MB/s');
  assert.equal(formatSpeed(0), '');
  assert.equal(formatSpeed(NaN), '');
});

test('formatEta: table values, null, Infinity', () => {
  const cases: [number | null, string][] = [[0, '0 sec'], [59, '59 sec'], [60, '1 min'], [3599, '59 min'], [3600, '1 h 0 min'], [3725, '1 h 2 min'], [86400, '1 d 0 h'], [90000, '1 d 1 h'], [null, ''], [Infinity, '']];
  for (const [v, s] of cases) assert.equal(formatEta(v), s, String(v));
});

test('progressOf: percent, null size, done record, clamp', () => {
  const parts = (done: number) => [{ start: 0, end: 999, done }];
  assert.deepEqual(progressOf(rec({ size: 1000, parts: [{ start: 0, end: 499, done: 100 }, { start: 500, end: 999, done: 155 }] })), { done: 255, total: 1000, percent: 25 });
  assert.equal(progressOf(rec({ size: null, parts: parts(10) })).percent, null);
  assert.equal(progressOf(rec({ size: 1000, state: 'done', parts: [] })).percent, 100);
  assert.equal(progressOf(rec({ size: 1000, parts: parts(5000) })).percent, 100);
});

test('etaSeconds: normal, speed 0, size null', () => {
  assert.equal(etaSeconds(rec({ size: 1000, parts: [{ start: 0, end: 999, done: 500 }] }), 100), 5);
  assert.equal(etaSeconds(rec({ size: 1000 }), 0), null);
  assert.equal(etaSeconds(rec({ size: null }), 100), null);
});

test('filterRecords: every filter kind, order kept', () => {
  const states: DlState[] = ['queued', 'running', 'paused', 'saving', 'done', 'failed'];
  const cats: CategoryId[] = ['video', 'music', 'programs', 'archives', 'documents', 'other'];
  const rs = states.map((state, i) => rec({ state, category: cats[i], queue: i % 2 ? 'night' : 'main' }));
  const ids = (f: Parameters<typeof filterRecords>[1]) => filterRecords(rs, f).map((r) => r.state);
  assert.equal(filterRecords(rs, { kind: 'all' }).length, 6);
  assert.deepEqual(ids({ kind: 'unfinished' }), ['queued', 'running', 'paused', 'saving', 'failed']);
  assert.deepEqual(ids({ kind: 'finished' }), ['done']);
  assert.deepEqual(ids({ kind: 'category', id: 'music' }), ['running']);
  assert.deepEqual(ids({ kind: 'queue', id: 'night' }), ['running', 'saving', 'failed']);
  assert.deepEqual(ids({ kind: 'queue', id: 'main' }), ['queued', 'paused', 'done']);
});

test('sortRecords: name, size with nulls last both ways, speed and eta from the map, stable, no mutation', () => {
  const names = ['b10', 'B2', 'a'].map((name) => rec({ name }));
  assert.deepEqual(sortRecords(names, 'name', 'asc', {}).map((r) => r.name), ['a', 'B2', 'b10']);
  assert.deepEqual(sortRecords(names, 'name', 'desc', {}).map((r) => r.name), ['b10', 'B2', 'a']);
  assert.deepEqual(names.map((r) => r.name), ['b10', 'B2', 'a']);

  const sizes = [5, null, 1].map((size) => rec({ size }));
  assert.deepEqual(sortRecords(sizes, 'size', 'asc', {}).map((r) => r.size), [1, 5, null]);
  assert.deepEqual(sortRecords(sizes, 'size', 'desc', {}).map((r) => r.size), [5, 1, null]);

  const [a, b, c] = [rec(), rec(), rec()];
  const speeds = { [a.id]: 10, [c.id]: 30 };
  assert.deepEqual(sortRecords([a, b, c], 'speed', 'desc', speeds).map((r) => r.id), [c.id, a.id, b.id]);

  const e1 = rec({ size: 1000, parts: [{ start: 0, end: 999, done: 0 }] });
  const e2 = rec({ size: 1000, parts: [{ start: 0, end: 999, done: 0 }] });
  const e3 = rec({ size: 1000 });
  const sp = { [e1.id]: 10, [e2.id]: 100, [e3.id]: 0 };
  assert.deepEqual(sortRecords([e1, e2, e3], 'eta', 'asc', sp).map((r) => r.id), [e2.id, e1.id, e3.id]);
  assert.deepEqual(sortRecords([e1, e2, e3], 'eta', 'desc', sp).map((r) => r.id), [e1.id, e2.id, e3.id]);

  const p = [rec({ size: 100, parts: [{ start: 0, end: 99, done: 50 }] }), rec({ size: 100, parts: [{ start: 0, end: 99, done: 10 }] }), rec({ size: null })];
  assert.deepEqual(sortRecords(p, 'progress', 'asc', {}).map((r) => r.id), [p[1].id, p[0].id, p[2].id]);
  assert.deepEqual(sortRecords([rec({ addedAt: 3 }), rec({ addedAt: 1 })], 'added', 'asc', {}).map((r) => r.addedAt), [1, 3]);

  const eq = [rec({ size: 1 }), rec({ size: 1 }), rec({ size: 1 })];
  assert.deepEqual(sortRecords(eq, 'size', 'desc', {}).map((r) => r.id), eq.map((r) => r.id));
});

test('parseAddInput: mixed input, max, empty', () => {
  const text = '  https://a.com/x\n\nftp://b\nnot a url\nhttps://a.com/x\nhttp://c.org';
  assert.deepEqual(parseAddInput(text), { urls: ['https://a.com/x', 'http://c.org/'], skipped: 2, truncated: false });
  assert.deepEqual(parseAddInput(text, 1).urls, ['https://a.com/x']);
  assert.equal(parseAddInput(text, 1).truncated, true);
  assert.deepEqual(parseAddInput(text, 2), { urls: ['https://a.com/x', 'http://c.org/'], skipped: 2, truncated: false });
  assert.deepEqual(parseAddInput(''), { urls: [], skipped: 0, truncated: false });
  assert.deepEqual(parseAddInput('   \n\t\n'), { urls: [], skipped: 0, truncated: false });
  assert.equal(parseAddInput(Array.from({ length: 250 }, (_, i) => `https://a.com/${i}`).join('\n')).urls.length, 200);
});

test('statusText: every state, queue schedule, done folder, failed error', () => {
  const queues: QueueSetting[] = [
    { id: 'main', name: 'Main queue', maxParallel: 3, schedule: { on: false, days: [0, 1, 2, 3, 4, 5, 6], start: '01:00', stop: '07:00' } },
    { id: 'night', name: 'Night', maxParallel: 2, schedule: { on: true, days: [0, 1, 2, 3, 4, 5, 6], start: '22:00', stop: '06:00' } },
  ];
  const categories = [{ id: 'video' as const, folder: 'Movies', extensions: [] }, { id: 'other' as const, folder: 'Other', extensions: [] }] as never;
  const at = new Date(2026, 10, 10, 12, 0);
  const open = new Date(2026, 10, 10, 22, 0).getTime();
  const next = (q: QueueSetting) => (q.id === 'night' ? open : null);
  const st = (r: DlRecord) => statusText(r, queues, categories, at, next);
  assert.equal(st(rec({ queue: 'main' })), 'Waiting in Main queue');
  assert.equal(st(rec({ queue: 'night' })), 'Scheduled for Tue 22:00');
  assert.equal(st(rec({ queue: 'gone' })), 'Waiting in Main queue');
  assert.equal(statusText(rec({ queue: 'gone' }), [queues[1], queues[0]], categories, at, next), 'Scheduled for Tue 22:00');
  assert.equal(st(rec({ state: 'running', size: null })), 'Starting');
  assert.equal(st(rec({ state: 'running', size: 10 })), 'Downloading');
  assert.equal(st(rec({ state: 'paused' })), 'Paused');
  assert.equal(st(rec({ state: 'saving' })), 'Saving to Downloads');
  assert.equal(st(rec({ state: 'done', category: 'video' })), 'Saved to Downloads/Movies');
  const err = "The connection dropped and Sieve couldn't reconnect. Check your network, then press Resume.";
  assert.equal(st(rec({ state: 'failed', error: err })), err);
  assert.equal(st(rec({ state: 'failed', error: null })), 'Failed');
});

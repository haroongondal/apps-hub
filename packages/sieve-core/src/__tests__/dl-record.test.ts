import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERRORS, applyEvent, bytesDone, isComplete, newId, newRecord, nextState, partName } from '../dl-record.ts';
import type { DlEvent, DlRecord, DlState, NewRecord } from '../dl-record.ts';

const init: NewRecord = { url: 'https://e.test/a.zip', referrer: '', name: 'a.zip', category: 'archives', categoryFixed: false, queue: 'main', source: 'manual', partsWanted: 1 };
const rec = (over: Partial<DlRecord> = {}): DlRecord => ({ ...newRecord(init, 1000, 'dtest'), ...over });
const whole = (size: number, done = size) => [{ start: 0, end: size - 1, done }];

test('newId matches the pattern and 1000 ids are distinct, 20 times over', () => {
  assert.match(newId(1_700_000_000_000, () => 0.5), /^d[a-z0-9]{16,}$/);
  assert.match(newId(1_700_000_000_000, () => 0), /^d[a-z0-9]{16,}$/);
  assert.match(newId(1_700_000_000_000, () => 0.9999999999), /^d[a-z0-9]{16,}$/);
  for (let run = 0; run < 20; run++) {
    const ids = new Set(Array.from({ length: 1000 }, () => newId(1_700_000_000_000, Math.random)));
    assert.equal(ids.size, 1000);
  }
});

test('newRecord fills every default', () => {
  const r = newRecord(init, 1234, 'dx');
  assert.deepEqual(r, {
    id: 'dx', url: init.url, finalUrl: init.url, referrer: '', name: 'a.zip', category: 'archives', categoryFixed: false,
    queue: 'main', state: 'queued', force: false, size: null, rangeOk: false, validator: null, mime: '', parts: [],
    partsWanted: 1, addedAt: 1234, startedAt: null, finishedAt: null, error: null, saveOnly: false, savedPath: null,
    savedId: null, chromeId: null, source: 'manual',
  });
  const g = newRecord({ ...init, finalUrl: 'https://cdn.test/a.zip', size: 10, mime: 'application/zip', validator: '"v"', rangeOk: true, chromeId: 7, source: 'takeover' }, 1, 'dy');
  assert.equal(g.finalUrl, 'https://cdn.test/a.zip');
  assert.equal(g.size, 10);
  assert.equal(g.mime, 'application/zip');
  assert.equal(g.validator, '"v"');
  assert.equal(g.rangeOk, true);
  assert.equal(g.chromeId, 7);
  assert.equal(g.source, 'takeover');
});

test('nextState gives null for the 41 illegal pairs and the table for the 13 legal ones', () => {
  const states: DlState[] = ['queued', 'running', 'paused', 'saving', 'done', 'failed'];
  const events: DlEvent[] = ['start', 'pause', 'resume', 'stop', 'partsDone', 'fail', 'saved', 'saveFailed', 'restart'];
  const legal: Record<string, DlState> = {
    'queued start': 'running', 'queued pause': 'paused', 'queued fail': 'failed',
    'running pause': 'paused', 'running stop': 'queued', 'running partsDone': 'saving', 'running fail': 'failed', 'running restart': 'queued',
    'paused resume': 'queued', 'saving saved': 'done', 'saving saveFailed': 'failed', 'saving restart': 'saving', 'failed resume': 'queued',
  };
  let illegal = 0;
  for (const s of states) for (const e of events) {
    const want = legal[`${s} ${e}`] ?? null;
    assert.equal(nextState(s, e), want, `${s} ${e}`);
    if (want === null) illegal++;
  }
  assert.equal(Object.keys(legal).length, 13);
  assert.equal(illegal, 41);
});

test('applyEvent start, pause, stop and partsDone', () => {
  const started = applyEvent(rec({ error: 'x' }), 'start', 2000);
  assert.equal(started.state, 'running');
  assert.equal(started.startedAt, 2000);
  assert.equal(started.error, null);
  assert.equal(applyEvent({ ...started, force: true, state: 'queued' }, 'start', 3000).startedAt, 2000, 'kept');
  const paused = applyEvent(rec({ force: true, state: 'running' }), 'pause', 1);
  assert.deepEqual([paused.state, paused.force], ['paused', false]);
  assert.equal(applyEvent(rec({ force: true, state: 'queued' }), 'pause', 1).state, 'paused');
  const stopped = applyEvent(rec({ force: true, state: 'running' }), 'stop', 1);
  assert.deepEqual([stopped.state, stopped.force], ['queued', false]);
  const pd = applyEvent(rec({ state: 'running', error: 'x' }), 'partsDone', 1);
  assert.deepEqual([pd.state, pd.saveOnly, pd.error], ['saving', true, null]);
});

test('applyEvent resume picks queued or saving', () => {
  const failedSaveOnly = applyEvent(rec({ state: 'failed', saveOnly: true, error: 'x', size: 100, parts: whole(100, 50) }), 'resume', 1);
  assert.deepEqual([failedSaveOnly.state, failedSaveOnly.saveOnly, failedSaveOnly.force, failedSaveOnly.error], ['saving', true, true, null]);
  const failedComplete = applyEvent(rec({ state: 'failed', size: 100, parts: whole(100) }), 'resume', 1);
  assert.deepEqual([failedComplete.state, failedComplete.saveOnly], ['saving', true]);
  const failedPartial = applyEvent(rec({ state: 'failed', size: 100, parts: whole(100, 40), error: 'x' }), 'resume', 1);
  assert.deepEqual([failedPartial.state, failedPartial.saveOnly, failedPartial.force, failedPartial.error], ['queued', false, true, null]);
  const paused = applyEvent(rec({ state: 'paused' }), 'resume', 1);
  assert.deepEqual([paused.state, paused.force], ['queued', true]);
});

test('applyEvent fail, saved, saveFailed and restart', () => {
  const f = applyEvent(rec({ state: 'running', force: true }), 'fail', 1, { error: 'boom' });
  assert.deepEqual([f.state, f.error, f.force], ['failed', 'boom', false]);
  const g = applyEvent(rec({ state: 'queued', force: true }), 'fail', 1);
  assert.deepEqual([g.state, g.error, g.force], ['failed', ERRORS.unknown, false]);
  const s = applyEvent(rec({ state: 'saving', saveOnly: true, force: true, error: 'x' }), 'saved', 9);
  assert.deepEqual([s.state, s.finishedAt, s.saveOnly, s.force, s.error], ['done', 9, false, false, null]);
  const sf = applyEvent(rec({ state: 'saving', force: true }), 'saveFailed', 1, { error: 'no' });
  assert.deepEqual([sf.state, sf.error, sf.saveOnly, sf.force], ['failed', 'no', true, false]);
  assert.equal(applyEvent(rec({ state: 'saving' }), 'saveFailed', 1).error, ERRORS.unknown);
  const r = applyEvent(rec({ state: 'running', force: true }), 'restart', 1);
  assert.deepEqual([r.state, r.force], ['queued', true]);
  const rs = applyEvent(rec({ state: 'saving', saveOnly: true }), 'restart', 1);
  assert.deepEqual([rs.state, rs.saveOnly], ['saving', true]);
});

test('an illegal event returns the same object', () => {
  const r = rec({ state: 'done' });
  assert.equal(applyEvent(r, 'start', 1), r);
  const q = rec();
  assert.equal(applyEvent(q, 'saved', 1), q);
  assert.equal(applyEvent(q, 'restart', 1), q);
});

test('applyEvent does not change its input', () => {
  const r = rec({ state: 'running', force: true });
  const copy = structuredClone(r);
  applyEvent(r, 'pause', 5);
  assert.deepEqual(r, copy);
});

test('bytesDone and isComplete', () => {
  assert.equal(bytesDone(rec()), 0);
  assert.equal(isComplete(rec()), false);
  assert.equal(isComplete(rec({ size: 0 })), true);
  assert.equal(isComplete(rec({ size: 100, parts: whole(100) })), true);
  assert.equal(isComplete(rec({ size: 100, parts: whole(100, 99) })), false);
  assert.equal(isComplete(rec({ size: null, parts: whole(100) })), false);
  assert.equal(isComplete(rec({ size: 100, parts: [] })), false);
  assert.equal(isComplete(rec({ size: 100, parts: [{ start: 0, end: null, done: 100 }] })), false);
  const two = rec({ size: 100, parts: [{ start: 0, end: 49, done: 50 }, { start: 50, end: 99, done: 20 }] });
  assert.equal(bytesDone(two), 70);
  assert.equal(isComplete(two), false);
  assert.equal(isComplete({ ...two, parts: [{ start: 0, end: 49, done: 50 }, { start: 50, end: 99, done: 50 }] }), true);
});

test('partName', () => {
  assert.equal(partName('dabc'), 'dabc.part');
});

test('every ERRORS sentence passes the wording rules', () => {
  const all = [
    ERRORS.network, ERRORS.refused, ERRORS.changed, ERRORS.length, ERRORS.space, ERRORS.storage, ERRORS.saveCanceled,
    ERRORS.unknown, ERRORS.probe, ERRORS.status(404), ERRORS.status(503), ERRORS.save('x'), ERRORS.save('FILE_NO_SPACE'),
  ];
  for (const s of all) {
    assert.doesNotMatch(s, /faster|accelerat|boost|turbo|speed up/i, s);
    assert.doesNotMatch(s, /\p{Extended_Pictographic}/u, s);
    assert.doesNotMatch(s, /[A-Z]{4,}/, s);
    assert.match(s, /^[A-Z]/, s);
    assert.match(s, /\.$/, s);
  }
});

test('ERRORS.status and ERRORS.save mapping', () => {
  assert.ok(ERRORS.status(404).includes('404'));
  assert.equal(ERRORS.save('FILE_NO_SPACE'), ERRORS.space);
  assert.equal(ERRORS.save('USER_CANCELED'), ERRORS.saveCanceled);
  assert.equal(ERRORS.save('boom'), "Chrome couldn't save the finished file. Press Resume to save it again.");
  assert.ok(!ERRORS.save('boom').includes('boom'));
});

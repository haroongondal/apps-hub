import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMIT_MS, IDLE_MS } from '../dl-engine.ts';
import { ERRORS, partName } from '../dl-record.ts';
import type { AddItem } from '../dl-record.ts';
import { SPACE_MARGIN } from '../dl-takeover.ts';
import { flush, makeRig, rec, settingsWith } from './dl-engine-fakes.ts';

const take = (over: Partial<AddItem> = {}): AddItem => ({
  url: 'https://example.com/big.zip', source: 'takeover', chromeId: 7, referrer: 'https://example.com/',
  probed: { finalUrl: 'https://cdn.example.com/big.zip', size: 9_000_000, mime: 'application/zip', validator: '"abc"', name: 'big.zip' },
  ...over,
});

test('add: a manual add creates a queued record, persisted before add resolves', async () => {
  const r = await makeRig({ settings: settingsWith({ parts: 4, on: false }) });
  const release = r.store.hold();
  let resolved = false;
  const p = r.engine.add([{ url: 'https://example.com/files/App.dmg', source: 'manual' }]).then((x) => ((resolved = true), x));
  await flush();
  assert.equal(resolved, false, 'add waits for the store');
  release();
  const { ids } = await p;
  assert.equal(ids.length, 1);
  const stored = r.stored(ids[0])!;
  assert.equal(stored.state, 'queued');
  assert.equal(stored.name, 'App.dmg');
  assert.equal(stored.category, 'programs');
  assert.equal(stored.queue, 'main');
  assert.equal(stored.partsWanted, 4);
  assert.equal(stored.source, 'manual');
  assert.equal(stored.force, false);
});

test('add: a probed take-over item fills finalUrl, size, mime, validator, rangeOk, chromeId', async () => {
  const r = await makeRig({ settings: settingsWith({ on: false }) });
  const { ids } = await r.engine.add([take()]);
  const s = r.stored(ids[0])!;
  assert.equal(s.finalUrl, 'https://cdn.example.com/big.zip');
  assert.equal(s.size, 9_000_000);
  assert.equal(s.mime, 'application/zip');
  assert.equal(s.validator, '"abc"');
  assert.equal(s.rangeOk, true);
  assert.equal(s.chromeId, 7);
  assert.equal(s.referrer, 'https://example.com/');
  assert.equal(s.name, 'big.zip');
  assert.equal(s.category, 'archives');
});

test('add: an ftp URL is skipped', async () => {
  const r = await makeRig();
  const { ids } = await r.engine.add([{ url: 'ftp://example.com/a.zip', source: 'manual' }, { url: 'not a url', source: 'manual' }]);
  assert.deepEqual(ids, []);
  assert.equal(r.engine.records().length, 0);
});

test('add: a given name is sanitised', async () => {
  const r = await makeRig();
  const { ids } = await r.engine.add([{ url: 'https://example.com/get', name: '../x<y>.zip', source: 'manual' }]);
  assert.equal(r.stored(ids[0])!.name, 'x_y_.zip');
});

test('add: a caller category sets categoryFixed', async () => {
  const r = await makeRig();
  const { ids } = await r.engine.add([{ url: 'https://example.com/a.zip', category: 'video', source: 'manual' }]);
  const s = r.stored(ids[0])!;
  assert.equal(s.category, 'video');
  assert.equal(s.categoryFixed, true);
});

test('add: an unknown queue falls back to the first', async () => {
  const r = await makeRig();
  const { ids } = await r.engine.add([{ url: 'https://example.com/a.zip', queue: 'nope', source: 'manual' }]);
  assert.equal(r.stored(ids[0])!.queue, 'main');
});

test('add: an unknown category is ignored', async () => {
  const r = await makeRig();
  const { ids } = await r.engine.add([{ url: 'https://example.com/a.zip', category: 'nope' as never, source: 'manual' }]);
  const s = r.stored(ids[0])!;
  assert.equal(s.category, 'archives');
  assert.equal(s.categoryFixed, false);
});

test('add: a take-over item makes a forced record, put with strict durability', async () => {
  const r = await makeRig({ settings: settingsWith({ on: false }) });
  const { ids } = await r.engine.add([take()]);
  assert.equal(r.stored(ids[0])!.force, true);
  assert.ok(r.store.puts.length > 0 && r.store.puts.every((p) => p.strict));
  await flush();
  assert.deepEqual(r.transfer.started(), ids, 'a closed switch cannot park it');
  const m = await r.engine.add([{ url: 'https://example.com/m.zip', source: 'manual' }]);
  assert.equal(r.store.puts.find((p) => p.record.id === m.ids[0])!.strict, false);
});

test('ids: 500 items with a constant random and a frozen clock give 500 distinct ids and terminate', async () => {
  const r = await makeRig({ settings: settingsWith({ on: false }), random: () => 0.5 });
  const items = Array.from({ length: 500 }, (_, i) => ({ url: `https://example.com/f${i}.zip`, source: 'manual' as const }));
  const { ids } = await r.engine.add(items);
  assert.equal(new Set(ids).size, 500);
  for (const id of ids) assert.match(id, /^d[a-z0-9]{16,}$/);
  assert.equal(r.store.rows.size, 500);
});

test('replay: the same take-over item twice gives one record, even when it is already running', async () => {
  const r = await makeRig();
  const a = await r.engine.add([take()]);
  await flush();
  const b = await r.engine.add([take()]);
  assert.deepEqual(b.ids, a.ids);
  assert.equal(r.engine.records().length, 1);
  assert.equal(r.transfer.runs.length, 1);
  assert.equal(r.state(a.ids[0]), 'running');
});

test('replay: a stale done record or another url does not match', async () => {
  const r = await makeRig({
    settings: settingsWith({ on: false }),
    records: [rec('old', { chromeId: 7, url: 'https://example.com/big.zip', state: 'done' }), rec('live', { chromeId: 8, url: 'https://example.com/other.zip' })],
  });
  const a = await r.engine.add([take()]);
  assert.notEqual(a.ids[0], 'old');
  const b = await r.engine.add([take({ chromeId: 8 })]);
  assert.notEqual(b.ids[0], 'live');
  assert.equal(r.engine.records().length, 4);
});

test('start and slots: maxParallel limits running transfers, config raises it', async () => {
  const r = await makeRig({ records: [rec('a', { addedAt: 1 }), rec('b', { addedAt: 2 }), rec('c', { addedAt: 3 })], settings: settingsWith({}, 2) });
  assert.deepEqual(r.transfer.started(), ['a', 'b']);
  r.transfer.of('a').done({ size: null });
  await flush();
  assert.deepEqual(r.transfer.started(), ['a', 'b', 'c']);
  r.transfer.of('c').finish({ kind: 'paused', record: r.transfer.of('c').record });
  const r2 = await makeRig({ records: [rec('a', { addedAt: 1 }), rec('b', { addedAt: 2 }), rec('c', { addedAt: 3 })], settings: settingsWith({}, 2) });
  assert.deepEqual(r2.transfer.started(), ['a', 'b']);
  r2.engine.config(settingsWith({}, 3));
  await flush();
  assert.deepEqual(r2.transfer.started(), ['a', 'b', 'c']);
});

test('on false: nothing starts, resume forces, config stops non-forced', async () => {
  const r = await makeRig({ records: [rec('a')], settings: settingsWith({ on: false }) });
  assert.deepEqual(r.transfer.started(), []);
  await r.engine.act('resume', ['a']);
  await flush();
  assert.deepEqual(r.transfer.started(), ['a']);

  const s = await makeRig({ records: [rec('a'), rec('f', { force: true, addedAt: 2 })] });
  assert.deepEqual(s.transfer.started().sort(), ['a', 'f']);
  s.engine.config(settingsWith({ on: false }));
  await flush();
  assert.equal(s.transfer.of('a').signal.reason, 'stop');
  assert.equal(s.state('a'), 'queued');
  assert.equal(s.state('f'), 'running');
  assert.equal(s.transfer.of('f').signal.aborted, false);
});

test('pause and resume', async () => {
  const r = await makeRig({ records: [rec('a', { addedAt: 1 }), rec('b', { addedAt: 2 })], settings: settingsWith({}, 1) });
  assert.deepEqual(r.transfer.started(), ['a']);
  await r.engine.act('pause', ['a']);
  await flush();
  assert.equal(r.transfer.of('a').signal.reason, 'pause');
  assert.equal(r.state('a'), 'paused');
  assert.equal(r.stored('a')!.state, 'paused');
  assert.deepEqual(r.transfer.started(), ['a', 'b'], 'the slot is free');
  // a closed window does not stop a forced resume
  const never = settingsWith({ on: false }, 1);
  r.engine.config(never);
  await flush();
  await r.engine.act('resume', ['a']);
  await flush();
  assert.equal(r.stored('a')!.force, true);
  assert.equal(r.state('a'), 'running');
});

test('remove with the real queue does not deadlock', async () => {
  const r = await makeRig({ records: [rec('a')], files: ['a.part'] });
  assert.deepEqual(r.transfer.started(), ['a']);
  await Promise.race([r.engine.act('remove', ['a']), new Promise((_, no) => setTimeout(() => no(new Error('deadlock')), 1000))]);
  assert.equal(r.engine.records().length, 0);
  assert.equal(r.store.rows.size, 0);
  assert.equal(r.files.map.has('a.part'), false);
  r.engine.tick();
  await flush();
  assert.equal(r.transfer.runs.length, 1, 'not restarted');
});

test('remove: aborts, deletes part and record, lists removed', async () => {
  const r = await makeRig({ records: [rec('a'), rec('d', { state: 'done' })], files: ['a.part', 'd.part'] });
  await r.engine.act('remove', ['a', 'd', 'nope']);
  assert.equal(r.transfer.of('a').signal.reason, 'remove');
  assert.deepEqual([...new Set(r.files.removed)].sort(), ['a.part', 'd.part']);
  assert.deepEqual(r.store.deleted.sort(), ['a', 'd']);
  await r.clock.advance(EMIT_MS);
  const last = r.host.changes.at(-1)!;
  assert.deepEqual(last.removed.sort(), ['a', 'd']);
  assert.equal(r.state('a'), undefined);
});

test('finishing: saving, host.save, save failure, saveEvent path, done, failed, resume', async () => {
  const r = await makeRig({ records: [rec('a', { size: 100 })], files: ['a.part'] });
  r.transfer.of('a').done();
  await flush();
  assert.equal(r.state('a'), 'saving');
  assert.equal(r.stored('a')!.saveOnly, true);
  assert.equal(r.host.saves.length, 1);

  await r.engine.saveEvent({ id: 'a', kind: 'path', filename: '/dl/Archives/a.zip', chromeId: 9 });
  assert.equal(r.state('a'), 'saving');
  assert.equal(r.stored('a')!.savedPath, '/dl/Archives/a.zip');
  assert.equal(r.stored('a')!.savedId, 9);

  await r.engine.saveEvent({ id: 'a', kind: 'failed', error: 'USER_CANCELED' });
  assert.equal(r.state('a'), 'failed');
  assert.equal(r.stored('a')!.error, ERRORS.saveCanceled);

  await r.engine.act('resume', ['a']);
  await flush();
  assert.equal(r.state('a'), 'saving');
  assert.equal(r.host.saves.length, 2);
  assert.equal(r.transfer.runs.length, 1, 'the transfer is not run again');

  await r.engine.saveEvent({ id: 'a', kind: 'done', filename: '/dl/Archives/a.zip', chromeId: 10 });
  const done = r.stored('a')!;
  assert.equal(done.state, 'done');
  assert.equal(done.savedId, 10);
  assert.equal(done.finishedAt, r.clock.now());
  assert.equal(r.files.map.has('a.part'), false);
  await r.engine.saveEvent({ id: 'zzz', kind: 'done', filename: 'x', chromeId: 1 });
});

test('finishing: a failed host.save ends failed with saveOnly', async () => {
  const r = await makeRig({ records: [rec('a', { size: 100 })] });
  r.host.saveAnswer = { ok: false, message: 'FILE_NO_SPACE' };
  r.transfer.of('a').done();
  await flush();
  const s = r.stored('a')!;
  assert.equal(s.state, 'failed');
  assert.equal(s.error, ERRORS.save('FILE_NO_SPACE'));
  assert.equal(s.saveOnly, true);
});

test('completeness: an incomplete done fails with ERRORS.length', async () => {
  const r = await makeRig({ records: [rec('a', { size: 100 })] });
  r.transfer.of('a').done({ parts: [{ start: 0, end: 99, done: 60 }] });
  await flush();
  assert.equal(r.state('a'), 'failed');
  assert.equal(r.stored('a')!.error, ERRORS.length);
  assert.equal(r.host.saves.length, 0);
});

test('transfer failure keeps the error and parts', async () => {
  const r = await makeRig({ records: [rec('a', { size: 100 })] });
  r.transfer.of('a').fail(ERRORS.network, { parts: [{ start: 0, end: 99, done: 40 }] });
  await flush();
  const s = r.stored('a')!;
  assert.equal(s.state, 'failed');
  assert.equal(s.error, ERRORS.network);
  assert.equal(s.parts[0].done, 40);
});

test('start-up: restart, saving, done part, orphan sweep', async () => {
  const records = [
    rec('r1', { state: 'running', addedAt: 1 }),
    rec('r2', { state: 'running', force: true, addedAt: 2 }),
    rec('s1', { state: 'saving', saveOnly: true }),
    rec('dn', { state: 'done' }),
  ];
  const files = ['dn.part', 'dorphan.part', 'notes.txt', 'r1.part', 's1.part'];
  const off = await makeRig({ records, files, settings: settingsWith({ on: false }) });
  assert.equal(off.stored('r1')!.state, 'queued');
  assert.equal(off.stored('r2')!.state, 'running', 'queued by the restart, then started because it is forced');
  assert.equal(off.stored('r2')!.force, true);
  assert.deepEqual(off.transfer.started(), ['r2']);
  assert.equal(off.host.saves.length, 1);
  assert.equal(off.host.saves[0].id, 's1');
  assert.deepEqual(off.files.removed.sort(), ['dn.part', 'dorphan.part']);
  assert.ok(off.files.map.has('notes.txt') && off.files.map.has('r1.part') && off.files.map.has('s1.part'));

  const on = await makeRig({ records, files });
  assert.deepEqual(on.transfer.started().sort(), ['r1', 'r2']);
});

test('space: refusal and pass, partly done needs only the rest', async () => {
  const tight = await makeRig({ records: [rec('a', { size: 1_000_000_000 })], noStart: true });
  tight.files.free = { quota: 1_040_000_000, usage: 0 };
  await tight.engine.start(tight.settings);
  await flush();
  assert.equal(tight.state('a'), 'failed');
  assert.equal(tight.stored('a')!.error, ERRORS.space);
  assert.equal(tight.transfer.runs.length, 0);

  const ok = await makeRig({ records: [rec('a', { size: 1_000_000_000 })], noStart: true });
  ok.files.free = { quota: 1_000_000_000 + SPACE_MARGIN, usage: 0 };
  await ok.engine.start(ok.settings);
  await flush();
  assert.equal(ok.transfer.runs.length, 1);

  const partly = await makeRig({ records: [rec('a', { size: 1_000_000_000, parts: [{ start: 0, end: 999_999_999, done: 600_000_000 }] })], noStart: true });
  partly.files.free = { quota: 400_000_000 + SPACE_MARGIN, usage: 0 };
  await partly.engine.start(partly.settings);
  await flush();
  assert.equal(partly.transfer.runs.length, 1);
});

test('space failure: ends failed, does not loop, resume checks again', async () => {
  const r = await makeRig({ records: [rec('a', { size: 1_000_000_000 })], noStart: true });
  r.files.free = { quota: 10, usage: 0 };
  await r.engine.start(r.settings);
  await flush();
  r.engine.tick();
  await flush();
  assert.equal(r.state('a'), 'failed');
  assert.equal(r.transfer.runs.length, 0);
  r.files.free = { quota: 1e12, usage: 0 };
  await r.engine.act('resume', ['a']);
  await flush();
  assert.equal(r.transfer.runs.length, 1);
  assert.equal(r.state('a'), 'running');
});

test('emit: batching, speeds, copies', async () => {
  const r = await makeRig({ records: [rec('a', { size: 1000 }), rec('b', { size: 1000, addedAt: 2 })] });
  await r.clock.advance(EMIT_MS); // first emission carries the start
  r.host.changes.length = 0;
  const run = r.transfer.of('a');
  for (let i = 0; i < 100; i++) run.hooks.update({ ...run.record, parts: [{ start: 0, end: 999, done: i }] });
  run.hooks.bytes(5_000);
  await r.clock.advance(EMIT_MS);
  assert.equal(r.host.changes.length, 1);
  const c = r.host.changes[0];
  assert.deepEqual(c.records.map((x) => x.id), ['a']);
  assert.equal(c.records[0].parts[0].done, 99);
  assert.ok(c.speeds.a > 0 && c.speeds.b === undefined);
  assert.equal(c.total, c.speeds.a);
  c.records[0].name = 'mutated';
  assert.notEqual(r.engine.records().find((x) => x.id === 'a')!.name, 'mutated');
});

test('idle: host.idle after 60 s, cancelled by a start, not blocked by a closed window', async () => {
  const r = await makeRig({ records: [rec('a', { size: 100 })] });
  r.transfer.of('a').done();
  await flush();
  await r.engine.saveEvent({ id: 'a', kind: 'done', filename: 'x', chromeId: 1 });
  await flush();
  await r.clock.advance(IDLE_MS - 1);
  assert.equal(r.host.idles, 0);
  await r.clock.advance(1);
  assert.equal(r.host.idles, 1);

  const s = await makeRig({ records: [] });
  await s.clock.advance(IDLE_MS - 1000);
  await s.engine.add([{ url: 'https://example.com/a.zip', source: 'manual' }]);
  await flush();
  await s.clock.advance(IDLE_MS);
  assert.equal(s.host.idles, 0, 'the running download keeps it awake');

  const closed = settingsWith();
  const today = new Date(1_700_000_000_000).getDay();
  closed.queues[0].schedule = { on: true, days: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== today), start: '09:00', stop: '17:00' };
  const w = await makeRig({ settings: closed, records: [rec('q')] });
  assert.equal(w.transfer.runs.length, 0, 'the window is closed');
  await w.clock.advance(IDLE_MS);
  assert.equal(w.host.idles, 1);
});

test('stop: shutdown leaves records running, second start queues them', async () => {
  const r = await makeRig({ records: [rec('a')] });
  await r.engine.stop();
  assert.equal(r.transfer.of('a').signal.reason, 'shutdown');
  assert.equal(r.stored('a')!.state, 'running');
  const again = await makeRig({ records: [r.stored('a')!], settings: settingsWith({ on: false }) });
  assert.equal(again.stored('a')!.state, 'queued');
});

test('serialisation: add, resume and config in one tick start a record once', async () => {
  const r = await makeRig({ records: [rec('p', { state: 'paused' })] });
  const a = r.engine.add([{ url: 'https://example.com/n.zip', source: 'manual' }]);
  const b = r.engine.act('resume', ['p']);
  r.engine.config(settingsWith({}, 3));
  await Promise.all([a, b]);
  await flush();
  const ids = r.transfer.started();
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2);
});

test('serialisation: a remove or pause issued while a start waits on space wins', async () => {
  for (const op of ['remove', 'pause'] as const) {
    const r = await makeRig({ records: [rec('a', { size: 1000 })], noStart: true });
    const release = r.files.holdSpace();
    await r.engine.start(r.settings);
    await flush();
    const acting = r.engine.act(op, ['a']);
    await flush();
    release();
    await acting;
    await flush();
    assert.equal(r.transfer.runs.length, 0, op);
    if (op === 'remove') assert.equal(r.state('a'), undefined);
    else assert.equal(r.state('a'), 'paused');
  }
});

test('serialisation: saveEvent and act in the same tick apply in call order', async () => {
  const r = await makeRig({ records: [rec('a', { state: 'saving', saveOnly: true, size: 10 })] });
  const e = r.engine.saveEvent({ id: 'a', kind: 'failed', error: 'X' });
  const a = r.engine.act('resume', ['a']);
  await Promise.all([e, a]);
  await flush();
  assert.equal(r.state('a'), 'saving');
  assert.equal(r.host.saves.length, 2, 'once at start, once after the resume');
  assert.ok(r.store.puts.some((p) => p.record.error === ERRORS.save('X')));
});

test('partName stays the shared file name', () => {
  assert.equal(partName('dabc'), 'dabc.part');
});

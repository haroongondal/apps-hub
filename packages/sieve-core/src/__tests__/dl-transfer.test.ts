import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GIVE_UP_MS, HOST_CAP_TTL_MS, STALL_MS } from '../dl-plan.ts';
import type { HostCaps } from '../dl-plan.ts';
import type { TransferHooks, TransferResult } from '../dl-ports.ts';
import { ERRORS, newRecord } from '../dl-record.ts';
import type { DlRecord } from '../dl-record.ts';
import { DEFAULT_DOWNLOADS } from '../dl-settings.ts';
import { CHECKPOINT_BYTES, CHECKPOINT_MS, PROBE_TIMEOUT_MS, createTransfer, probe } from '../dl-transfer.ts';
import { FakeFiles, FakeNet, FakeStore, ManualClock, MiB, pattern } from './dl-transfer-fakes.ts';
import type { LogEntry, Override, RuleCtx, Spec } from './dl-transfer-fakes.ts';

const U = 'https://h.test/a.bin';
const PART = 'dtest.part';

function setup() {
  const clock = new ManualClock();
  const log: LogEntry[] = [];
  const files = new FakeFiles(clock, log);
  const store = new FakeStore();
  const net = new FakeNet(clock);
  const transfer = createTransfer({ net, files, store, clock });
  transfer.config(DEFAULT_DOWNLOADS);
  const persisted: DlRecord[] = [];
  let total = 0;
  let onBytes: ((total: number) => void) | null = null;
  const hooks: TransferHooks = {
    persist: async (r) => { log.push({ op: 'persist', t: clock.t }); persisted.push(r); },
    update: () => {},
    bytes: (n) => { total += n; onBytes?.(total); },
  };
  const run = (r: DlRecord, signal: AbortSignal = new AbortController().signal) => clock.drive(transfer.run(r, signal, hooks));
  return {
    clock, log, files, store, net, transfer, persisted, hooks, run,
    setOnBytes(fn: (total: number) => void) { onBytes = fn; },
    resetTotal() { total = 0; },
  };
}

function rec(url: string, over: Partial<DlRecord> = {}): DlRecord {
  const base = newRecord({ url, referrer: '', name: 'x.bin', category: 'other', categoryFixed: false, queue: 'main', source: 'manual', partsWanted: 1 }, 0, 'dtest');
  return { ...base, ...over };
}

// A record the take-over (or an earlier run) already probed.
function probed(url: string, size: number, over: Partial<DlRecord> = {}): DlRecord {
  return rec(url, { size, rangeOk: true, validator: '"e1"', mime: 'application/octet-stream', ...over });
}

function assertFile(files: FakeFiles, size: number, name = PART): void {
  const got = files.data.get(name);
  assert.ok(got, 'file exists');
  assert.equal(got.length, size);
  assert.equal(Buffer.compare(got, pattern(0, size)), 0, 'file content equals the pattern');
}

function failed(res: TransferResult): string {
  assert.equal(res.kind, 'failed');
  return res.kind === 'failed' ? res.error : '';
}

const writtenBytes = (log: LogEntry[]) => log.reduce((n, e) => n + (e.op === 'write' ? e.n! : 0), 0);

test('1 probe, manual add: Range bytes=0-0 first, record filled, one ranged request with If-Range, file correct', async () => {
  const s = setup();
  s.net.add(U, { size: 3 * MiB, disposition: 'attachment; filename="named.bin"', mime: 'application/x-test; charset=x' });
  const res = await s.run(rec(U));
  assert.equal(res.kind, 'done');
  assert.equal(s.net.log.length, 2);
  assert.equal(s.net.log[0].range, 'bytes=0-0');
  assert.equal(s.net.log[1].range, 'bytes=0-');
  assert.equal(s.net.log[1].ifRange, '"e1"');
  assert.equal(res.record.size, 3 * MiB);
  assert.equal(res.record.rangeOk, true);
  assert.equal(res.record.validator, '"e1"');
  assert.equal(res.record.mime, 'application/x-test');
  assert.equal(res.record.name, 'named.bin');
  assert.equal(res.record.parts.length, 1);
  assertFile(s.files, 3 * MiB);
});

test('2 probe, no range (200): rangeOk false, no Range on download, size from Content-Length or received bytes', async () => {
  const s = setup();
  s.net.add(U, { size: 3 * MiB, ranges: false });
  const res = await s.run(rec(U));
  assert.equal(res.kind, 'done');
  assert.equal(res.record.rangeOk, false);
  assert.equal(res.record.size, 3 * MiB);
  assert.equal(s.net.log[1].range, undefined);
  assert.equal(s.net.log[1].ifRange, undefined);
  assertFile(s.files, 3 * MiB);

  const t = setup();
  t.net.add(U, { size: 2 * MiB, ranges: false, lengthKnown: false });
  const res2 = await t.run(rec(U));
  assert.equal(res2.kind, 'done');
  assert.equal(res2.record.size, 2 * MiB);
  assert.equal(res2.record.parts[0].end, 2 * MiB - 1);
  assertFile(t.files, 2 * MiB);
});

test('3 take-over record already probed: no probe request, name unchanged', async () => {
  const s = setup();
  s.net.add(U, { size: 2 * MiB, disposition: 'attachment; filename="other.bin"' });
  const res = await s.run(probed(U, 2 * MiB, { source: 'takeover', name: 'keep.bin' }));
  assert.equal(res.kind, 'done');
  assert.deepEqual(s.net.log.map((l) => l.range), ['bytes=0-']);
  assert.equal(res.record.name, 'keep.bin');
  assertFile(s.files, 2 * MiB);
});

test('4 three parts over 10 MiB: exact ranges with If-Range, file correct', async () => {
  const s = setup();
  s.net.add(U, { size: 10_485_760 });
  const res = await s.run(probed(U, 10_485_760, { partsWanted: 3 }));
  assert.equal(res.kind, 'done');
  assert.deepEqual(s.net.log.map((l) => l.range).sort(), ['bytes=0-3495253', 'bytes=3495254-6990506', 'bytes=6990507-10485759']);
  assert.ok(s.net.log.every((l) => l.ifRange === '"e1"'));
  assertFile(s.files, 10_485_760);
});

test('5 re-split: a finished part frees a slot and the slow part is cut in half', async () => {
  const s = setup();
  const size = 12 * MiB;
  s.net.add(U, { size, rule: (c: RuleCtx): Override | undefined => (c.start === 6 * MiB ? { delayMs: 50 } : undefined) });
  const res = await s.run(probed(U, size, { partsWanted: 2 }));
  assert.equal(res.kind, 'done');
  const newStart = 6 * MiB + Math.ceil((6 * MiB) / 2);
  assert.ok(s.net.log.some((l) => l.range === `bytes=${newStart}-${size - 1}`), 'the second half of the slow part starts');
  assert.ok(res.record.parts.length >= 3);
  assert.equal(s.net.maxInflight.get('h.test'), 2);
  assert.equal(writtenBytes(s.log), size, 'no byte is written twice');
  assertFile(s.files, size);
});

test('6 429 with four parts: hostCaps cap 2, Retry-After honoured, caps expire after HOST_CAP_TTL_MS', async () => {
  const s = setup();
  const size = 20 * MiB;
  s.net.add(U, { size, script: [{}, {}, { status: 429, retryAfter: '3' }] });
  const res = await s.run(probed(U, size, { partsWanted: 4 }));
  assert.equal(res.kind, 'done');
  const caps = s.store.meta.get('hostCaps') as HostCaps;
  assert.equal(caps['h.test'].cap, 2);
  const refused = s.net.log.find((l) => l.status === 429)!;
  const refusedStart = refused.range!.split('-')[0];
  const retry = s.net.log.find((l) => l !== refused && l.range!.startsWith(`${refusedStart}-`))!;
  assert.ok(retry.at >= refused.at + 3000, `retried ${retry.at - refused.at} ms after the refusal`);
  assert.equal(s.net.log.filter((l) => l.range!.startsWith(`${refusedStart}-`)).length, 2, 'the refused part retries from its offset');
  assertFile(s.files, size);

  const U2 = 'https://h.test/b.bin';
  s.net.add(U2, { size: 8 * MiB });
  const second = await s.run(probed(U2, 8 * MiB, { partsWanted: 4 }));
  assert.equal(second.record.parts.length, 2);

  s.clock.t = HOST_CAP_TTL_MS + 5000;
  const third = await s.run(probed(U2, 8 * MiB, { partsWanted: 4 }));
  assert.equal(third.record.parts.length, 4);
});

test('7 a 429 on one connection retries after 2000 ms', async () => {
  const s = setup();
  s.net.add(U, { size: 2 * MiB, script: [{}, { status: 429 }] });
  const res = await s.run(rec(U));
  assert.equal(res.kind, 'done');
  assert.ok(s.clock.sleeps.includes(2000));
  assert.ok(s.clock.t >= 2000);
  assert.equal((s.store.meta.get('hostCaps') as HostCaps)['h.test'].cap, 1);
  assertFile(s.files, 2 * MiB);
});

test('7b five 429s in a row fail with ERRORS.refused after sleeps 2, 4, 8, 16 s; counter resets; 503 on the probe retried', async () => {
  const five = setup();
  five.net.add(U, { size: 2 * MiB, script: Array.from({ length: 5 }, () => ({ status: 429 })) });
  const res = await five.run(probed(U, 2 * MiB));
  assert.equal(failed(res), ERRORS.refused);
  assert.deepEqual(five.clock.sleeps, [2000, 4000, 8000, 16000]);
  assert.equal(five.net.log.length, 5);
  assert.equal(five.net.inflight.get('h.test'), 0, 'refused responses were closed');

  const reset = setup();
  const four = Array.from({ length: 4 }, (): Override => ({ status: 429 }));
  reset.net.add(U, { size: 2 * MiB, script: [...four, { failAfter: 100_000 }, ...four] });
  const ok = await reset.run(probed(U, 2 * MiB));
  assert.equal(ok.kind, 'done');
  assertFile(reset.files, 2 * MiB);

  const timed = setup();
  timed.net.add(U, { size: MiB, script: [{ status: 429, retryAfter: '30' }] });
  const t30 = await timed.run(rec(U));
  assert.equal(t30.kind, 'done');
  assert.ok(timed.net.log[1].at >= 30_000, `second probe at ${timed.net.log[1].at} ms`);

  const probe503 = setup();
  probe503.net.add(U, { size: MiB, script: [{ status: 503 }] });
  const p = await probe503.run(rec(U));
  assert.equal(p.kind, 'done');
  assert.ok(probe503.clock.sleeps.includes(2000));
});

test('8 hard errors 403, 404, 410 on probe and part fail at once', async () => {
  for (const code of [403, 404, 410]) {
    const onProbe = setup();
    onProbe.net.add(U, { size: MiB, script: [{ status: code }] });
    assert.equal(failed(await onProbe.run(rec(U))), ERRORS.status(code));
    assert.equal(onProbe.net.log.length, 1);

    const onPart = setup();
    onPart.net.add(U, { size: MiB, script: [{ status: code }] });
    assert.equal(failed(await onPart.run(probed(U, MiB))), ERRORS.status(code));
    assert.equal(onPart.net.log.length, 1);
    assert.equal(onPart.net.inflight.get('h.test'), 0, 'the error response was closed');
  }
});

test('9 dropped connection resumes at the saved offset; 90 s outage survives; 15 minutes without a byte fails; bytes reset the clock', async () => {
  const drop = setup();
  drop.net.add(U, { size: 4 * MiB, script: [{ failAfter: MiB }] });
  const res = await drop.run(probed(U, 4 * MiB));
  assert.equal(res.kind, 'done');
  assert.equal(drop.net.log[1].range, `bytes=${MiB}-`);
  assertFile(drop.files, 4 * MiB);

  const outage = setup();
  outage.net.add(U, { size: MiB, rule: (c) => (c.now < 90_000 ? { throw: true } : undefined) });
  const survived = await outage.run(probed(U, MiB));
  assert.equal(survived.kind, 'done');
  assert.deepEqual(outage.clock.sleeps.slice(0, 6), [2000, 4000, 8000, 16000, 30000, 30000]);

  const dead = setup();
  dead.net.add(U, { size: MiB, rule: () => ({ throw: true }) });
  assert.equal(failed(await dead.run(probed(U, MiB))), ERRORS.network);
  assert.ok(dead.clock.t >= GIVE_UP_MS);

  const byte = setup();
  let gave = false;
  byte.net.add(U, {
    size: MiB,
    rule: (c) => {
      if (c.now < 800_000) return { throw: true };
      if (!gave) { gave = true; return { deliver: 65_536 }; }
      return c.now < 1_650_000 ? { throw: true } : undefined;
    },
  });
  const resumed = await byte.run(probed(U, MiB));
  assert.equal(resumed.kind, 'done');
  assert.ok(byte.clock.t > GIVE_UP_MS * 1.5, 'it ran past 15 minutes in total');

  const flaky = setup();
  flaky.net.add(U, { size: 4 * MiB, rule: (c) => (c.n <= 10 ? { failAfter: 131_072 } : undefined) });
  const many = await flaky.run(probed(U, 4 * MiB));
  assert.equal(many.kind, 'done');
  assertFile(flaky.files, 4 * MiB);
});

test('9b stall: aborted after STALL_MS and retried; speed limit sleep is not a stall', async () => {
  const s = setup();
  s.net.add(U, { size: 3 * MiB, script: [{ stopAfter: MiB }] });
  const res = await s.run(probed(U, 3 * MiB));
  assert.equal(res.kind, 'done');
  assert.equal(s.net.log[1].range, `bytes=${MiB}-`);
  assert.ok(s.clock.t >= STALL_MS);
  assertFile(s.files, 3 * MiB);

  const limited = setup();
  limited.transfer.config({ ...DEFAULT_DOWNLOADS, speedLimit: { on: true, kbPerSecond: 1 } }); // 1000 B/s: one chunk drains in about 65 s
  limited.net.add(U, { size: 524_288 });
  const slow = await limited.run(probed(U, 524_288));
  assert.equal(slow.kind, 'done');
  assert.equal(limited.net.log.length, 1, 'no request was aborted');
  assert.ok(limited.clock.t > 400_000);
});

test('9c probe error three times fails with ERRORS.probe', async () => {
  const s = setup();
  s.net.add(U, { size: MiB, script: [{ throw: true }, { throw: true }, { throw: true }] });
  assert.equal(failed(await s.run(rec(U))), ERRORS.probe);
  assert.equal(s.net.log.length, 3);
  assert.deepEqual(s.clock.sleeps.filter((ms) => ms !== PROBE_TIMEOUT_MS), [2000, 4000]);

  const slow = setup();
  slow.net.add(U, { size: MiB, script: [{ responseDelayMs: 20_000 }] });
  const facts = await slow.clock.drive(probe(slow.net, U, slow.clock));
  assert.equal(facts.status, 0);
  assert.ok(facts.error);
  assert.equal(slow.clock.t, PROBE_TIMEOUT_MS);
});

test('9d host total: HOST_MAX connections per host across records, cap after 429, second host unaffected', async () => {
  const s = setup();
  const slow = (): Spec => ({ size: 12 * MiB, rule: () => ({ delayMs: 10 }) });
  s.net.add('https://h.test/a.bin', slow());
  s.net.add('https://h.test/b.bin', slow());
  s.net.add('https://other.test/c.bin', slow());
  const results = await s.clock.drive(Promise.all([
    s.transfer.run(probed('https://h.test/a.bin', 12 * MiB, { id: 'da', partsWanted: 6 }), new AbortController().signal, s.hooks),
    s.transfer.run(probed('https://h.test/b.bin', 12 * MiB, { id: 'db', partsWanted: 6 }), new AbortController().signal, s.hooks),
    s.transfer.run(probed('https://other.test/c.bin', 12 * MiB, { id: 'dc', partsWanted: 6 }), new AbortController().signal, s.hooks),
  ]));
  assert.ok(results.every((r) => r.kind === 'done'));
  assert.equal(s.net.maxInflight.get('h.test'), 6);
  assert.equal(s.net.maxInflight.get('other.test'), 6);

  const real = setup();
  const delayed: Override = { delayMs: 10 };
  real.net.add(U, { size: 12 * MiB, script: [delayed, delayed, delayed, delayed, delayed, { status: 429, retryAfter: '5' }], rule: () => delayed });
  const refusedRun = await real.run(probed(U, 12 * MiB, { partsWanted: 6 }));
  assert.equal(refusedRun.kind, 'done');
  assert.equal((real.store.meta.get('hostCaps') as HostCaps)['h.test'].cap, 3);
  const at = real.net.log.findIndex((l) => l.status === 429);
  assert.ok(real.net.log.length > at + 1);
  assert.ok(real.net.log.slice(at + 1).every((l) => l.open < 3), 'no connection opens while 3 are open');

  const capped = setup();
  capped.store.meta.set('hostCaps', { 'h.test': { cap: 3, until: 1e12 } });
  capped.net.add('https://h.test/a.bin', slow());
  capped.net.add('https://h.test/b.bin', slow());
  const two = await capped.clock.drive(Promise.all([
    capped.transfer.run(probed('https://h.test/a.bin', 12 * MiB, { id: 'da', partsWanted: 6 }), new AbortController().signal, capped.hooks),
    capped.transfer.run(probed('https://h.test/b.bin', 12 * MiB, { id: 'db', partsWanted: 3 }), new AbortController().signal, capped.hooks),
  ]));
  assert.ok(two.every((r) => r.kind === 'done'));
  assert.equal(capped.net.maxInflight.get('h.test'), 3);
});

test('10 changed file: 200 to ranged request, 416, wrong Content-Range start, total differs, ETag differs, null validator continues', async () => {
  const cases: { script: Override[]; error: string; validator?: string | null; etag?: string | null }[] = [
    { script: [{ status: 200 }], error: ERRORS.changed },
    { script: [{ status: 416 }], error: ERRORS.changed },
    { script: [{ startShift: 1 }], error: ERRORS.length },
    { script: [{ totalOverride: 2 * MiB + 1 }], error: ERRORS.changed, validator: null, etag: null },
    { script: [{ headerEtag: '"e2"' }], error: ERRORS.changed },
  ];
  for (const c of cases) {
    const s = setup();
    s.net.add(U, { size: 2 * MiB, script: c.script, etag: c.etag });
    const res = await s.run(probed(U, 2 * MiB, c.validator === undefined ? {} : { validator: c.validator }));
    assert.equal(failed(res), c.error, JSON.stringify(c.script));
    assert.equal(s.net.inflight.get('h.test'), 0, 'no response body is left open');
  }
  const s = setup();
  s.net.add(U, { size: 2 * MiB, etag: null });
  const res = await s.run(probed(U, 2 * MiB, { validator: null }));
  assert.equal(res.kind, 'done');
  assertFile(s.files, 2 * MiB);
});

test('11 no range, restart: second run starts at 0 and the file is correct', async () => {
  const s = setup();
  s.net.add(U, { size: 3 * MiB, ranges: false });
  const ac = new AbortController();
  s.setOnBytes((n) => { if (n >= MiB) ac.abort(); });
  const first = await s.run(probed(U, 3 * MiB, { rangeOk: false, validator: null }), ac.signal);
  assert.equal(first.kind, 'paused');
  assert.ok(first.record.parts[0].done >= MiB);
  s.setOnBytes(() => {});
  const mark = s.log.length;
  const second = await s.run(first.record);
  assert.equal(second.kind, 'done');
  assert.equal(s.net.log.at(-1)!.range, undefined);
  assert.equal(s.log.slice(mark).find((e) => e.op === 'write')!.at, 0);
  assertFile(s.files, 3 * MiB);
});

test('12 pause and resume: flush before persist, resumed request starts at persisted done', async () => {
  const s = setup();
  s.net.add(U, { size: 10 * MiB });
  const ac = new AbortController();
  s.setOnBytes((n) => { if (n >= 2.5 * MiB) ac.abort(); });
  const first = await s.run(probed(U, 10 * MiB), ac.signal);
  assert.equal(first.kind, 'paused');
  const done = first.record.parts[0].done;
  assert.ok(done >= 2.5 * MiB);
  assert.equal(done, writtenBytes(s.log));
  const lastPersist = s.persisted.at(-1)!;
  assert.equal(lastPersist.parts[0].done, done);
  s.log.forEach((e, i) => { if (e.op === 'persist') assert.equal(s.log[i - 1].op, 'flush'); });
  assert.ok(s.log.at(-1)!.op === 'close');

  s.setOnBytes(() => {});
  const second = await s.run(first.record);
  assert.equal(second.kind, 'done');
  assert.equal(s.net.log.at(-1)!.range, `bytes=${done}-`);
  assertFile(s.files, 10 * MiB);
});

// A paused download of `size` bytes with a persisted `done`; `damage` runs before the resume.
async function pausedThenDamaged(damage: (s: ReturnType<typeof setup>) => void, size = 10 * MiB) {
  const s = setup();
  s.net.add(U, { size });
  const ac = new AbortController();
  s.setOnBytes((n) => { if (n >= 2.5 * MiB) ac.abort(); });
  const first = await s.run(probed(U, size), ac.signal);
  assert.equal(first.kind, 'paused');
  const done = first.record.parts[0].done;
  assert.ok(done > 0);
  s.setOnBytes(() => {});
  damage(s);
  const second = await s.run(first.record);
  return { s, done, second };
}

test('12a resume with the part file gone: every part restarts from its start and the bytes equal the source', async () => {
  const { s, second } = await pausedThenDamaged((x) => x.files.data.delete(PART));
  assert.equal(second.kind, 'done');
  assert.equal(s.net.log.at(-1)!.range, 'bytes=0-');
  assert.ok(s.persisted.some((r, i) => i > 0 && r.parts[0].done === 0 && s.persisted[i - 1].parts[0].done > 0), 'the reset is persisted');
  assertFile(s.files, 10 * MiB);
});

test('12b resume with a truncated part file keeps what is below the cut; one that still holds the done bytes keeps them', async () => {
  const cut = await pausedThenDamaged((x) => x.files.data.set(PART, x.files.data.get(PART)!.slice(0, 1 * MiB)));
  assert.equal(cut.second.kind, 'done');
  assert.equal(cut.s.net.log.at(-1)!.range, `bytes=${1 * MiB}-`, 'what lies below the cut is kept');
  assertFile(cut.s.files, 10 * MiB);

  // healthy resume: the file keeps its size, so done stays
  const ok = await pausedThenDamaged(() => {});
  assert.equal(ok.second.kind, 'done');
  assert.equal(ok.s.net.log.at(-1)!.range, `bytes=${ok.done}-`);
  assertFile(ok.s.files, 10 * MiB);
});

test('12c unknown size: a file shorter than the written bytes resumes at its length, one that holds them resumes there', async () => {
  const requested = async (fileSize: number) => {
    const s = setup();
    s.net.add(U, { size: 6 * MiB, lengthKnown: false });
    s.files.data.set(PART, new Uint8Array(fileSize));
    const open = rec(U, { rangeOk: true, parts: [{ start: 0, end: null, done: 2 * MiB }] });
    await s.run(open); // the outcome does not matter, the first request does
    return s.net.log.find((l) => l.range !== 'bytes=0-0')!.range;
  };
  assert.equal(await requested(1 * MiB), `bytes=${1 * MiB}-`);
  assert.equal(await requested(2 * MiB), `bytes=${2 * MiB}-`);
});

test('12e the reset is not stored (store down): the next run still restarts, no zero holes', async () => {
  const s = setup();
  s.net.add(U, { size: 10 * MiB });
  let storeDown = false;
  let stored: DlRecord | null = null;
  let total = 0;
  const ac = new AbortController();
  const hooks: TransferHooks = {
    persist: async (r) => { if (storeDown) throw new Error('QuotaExceededError'); stored = structuredClone(r); },
    update: () => {},
    bytes: (n) => { total += n; if (total >= 2.5 * MiB) ac.abort(); },
  };
  const first = await s.clock.drive(s.transfer.run(probed(U, 10 * MiB), ac.signal, hooks));
  assert.equal(first.kind, 'paused');
  const keep = structuredClone(stored!);
  assert.ok(keep.parts[0].done > 0);
  hooks.bytes = () => {};
  s.files.data.delete(PART);
  storeDown = true;
  const second = await s.clock.drive(s.transfer.run(keep, new AbortController().signal, hooks));
  assert.equal(second.kind, 'failed');
  storeDown = false;
  const third = await s.clock.drive(s.transfer.run(keep, new AbortController().signal, hooks));
  assert.equal(third.kind, 'done');
  assertFile(s.files, 10 * MiB);
});

test('13 checkpoints: every 4 MiB or 2000 ms, each preceded by flush', async () => {
  const s = setup();
  s.net.add(U, { size: 10 * MiB });
  assert.equal((await s.run(probed(U, 10 * MiB))).kind, 'done');
  let since = 0;
  const gaps: number[] = [];
  s.log.forEach((e, i) => {
    if (e.op === 'write') since += e.n!;
    if (e.op === 'persist' && s.log[i - 1].op === 'flush') { gaps.push(since); since = 0; }
  });
  assert.equal(gaps.length, 2);
  assert.ok(gaps.every((g) => g >= CHECKPOINT_BYTES));

  const t = setup();
  t.net.chunk = 1000;
  t.net.add(U, { size: 20_000, rule: () => ({ delayMs: 500 }) });
  assert.equal((await t.run(probed(U, 20_000))).kind, 'done');
  const times: number[] = [];
  t.log.forEach((e, i) => { if (e.op === 'persist' && t.log[i - 1].op === 'flush') times.push(e.t); });
  assert.ok(times.length >= 4);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= CHECKPOINT_MS);
});

test('14 speed limit: 5,000,000 bytes take 4.5 to 5.0 s; off takes none', async () => {
  const s = setup();
  s.transfer.config({ ...DEFAULT_DOWNLOADS, speedLimit: { on: true, kbPerSecond: 1000 } });
  s.net.add(U, { size: 5_000_000 });
  assert.equal((await s.run(probed(U, 5_000_000))).kind, 'done');
  assert.ok(s.clock.t >= 4500 && s.clock.t <= 5000, `took ${s.clock.t} ms`);
  const at = s.clock.t;
  s.transfer.config({ ...DEFAULT_DOWNLOADS, speedLimit: { on: false, kbPerSecond: 1000 } });
  assert.equal((await s.run(probed(U, 5_000_000))).kind, 'done');
  assert.equal(s.clock.t, at);
});

test('15 write errors: ERRORS.storage, ERRORS.space, handle closed and record persisted', async () => {
  for (const [free, error] of [[100 * 1024 * MiB, ERRORS.storage], [5_000_000, ERRORS.space]] as const) {
    const s = setup();
    s.net.add(U, { size: 2 * MiB });
    s.files.failWrite = true;
    s.files.free = free;
    assert.equal(failed(await s.run(probed(U, 2 * MiB))), error);
    assert.ok(s.log.some((e) => e.op === 'close'));
    assert.ok(s.persisted.length > 0);
    assert.equal(s.persisted.at(-1)!.error, error);
  }
});

test('16 length check: missing last byte keeps retrying then ERRORS.network; short file fails with ERRORS.length', async () => {
  const s = setup();
  const size = 2 * MiB;
  s.net.add(U, { size, rule: (c) => (c.start === 0 ? { deliver: size - 1 } : { deliver: 0 }) });
  assert.equal(failed(await s.run(probed(U, size))), ERRORS.network);
  assert.ok(s.clock.t >= GIVE_UP_MS);

  const t = setup();
  t.net.add(U, { size });
  t.files.shortBy = 1;
  assert.equal(failed(await t.run(probed(U, size))), ERRORS.length);
});

test('17 memory: no write above 1 MiB and at most one unread chunk per active part', async () => {
  const s = setup();
  s.net.add(U, { size: 6 * MiB });
  s.net.consumed = () => s.files.writeCount;
  assert.equal((await s.run(probed(U, 6 * MiB, { partsWanted: 3 }))).kind, 'done');
  assert.ok(s.files.maxWrite > 0 && s.files.maxWrite <= MiB);
  assert.ok(s.net.maxHeld >= 1 && s.net.maxHeld <= 3, `held ${s.net.maxHeld} chunks for 3 parts`);
});

test('7c the slot is released before the 429 back-off: another download starts during the sleep', async () => {
  const s = setup();
  const B = 'https://h.test/b.bin';
  s.net.add(U, { size: MiB, script: [{ status: 429 }] });
  s.net.add(B, { size: MiB });
  const never = new AbortController().signal;
  const second = (async () => {
    await s.clock.sleep(500);
    return s.transfer.run(probed(B, MiB, { id: 'db' }), never, s.hooks);
  })();
  const [a, b] = await s.clock.drive(Promise.all([s.transfer.run(probed(U, MiB), never, s.hooks), second]));
  assert.equal(a.kind, 'done');
  assert.equal(b.kind, 'done');
  const started = s.net.log.find((l) => l.url === B)!;
  assert.equal(started.at, 500, 'the second download did not wait for the first one back-off');
});

test('3 a received byte resets the failure count: back-off stays at 2000 ms', async () => {
  const s = setup();
  s.net.add(U, { size: MiB, script: [{ failAfter: 65_536 }, { failAfter: 65_536 }, { failAfter: 65_536 }] });
  assert.equal((await s.run(probed(U, MiB))).kind, 'done');
  assert.deepEqual(s.clock.sleeps.filter((ms) => ms !== STALL_MS).slice(0, 3), [2000, 2000, 2000]);
});

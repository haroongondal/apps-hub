import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planSource, stitchTranscripts, transcribeInChunks, type ChunkWindow, type PieceStore, type SourceFile } from '../audio-chunks.ts';
import { AiError, type Segment } from '../types.ts';
import { setup } from './helpers.ts';

const LIMIT = 25 * 1024 * 1024;
const RATE = 8; // bytes per ms at 64 kbps
const seg = (text: string, startSec: number, endSec: number): Segment => ({ text, locator: { startSec, endSec } });
const file = (key: string, minutes: number, offsetMs = 0): SourceFile => ({ key, bytes: minutes * 60_000 * RATE, durationMs: minutes * 60_000, offsetMs });

function memoryStore() {
  const records = new Map<number, string>();
  const store: PieceStore = {
    read: async (i) => records.get(i) ?? null,
    write: async (i, record) => void records.set(i, record),
    clear: async () => void records.clear(),
  };
  return { records, store };
}

/** Pieces 0..n-1 of `windows` answer `replies[i]`; `failAt` makes that piece throw until `fix()` is called. */
function harness(windows: ChunkWindow[], store: PieceStore) {
  const sent: number[] = [];
  const cut: number[] = [];
  let failure: AiError | null = null;
  let failAt = -1;
  const run = () =>
    transcribeInChunks<number>({
      windows,
      store,
      retryDelayMs: 0,
      cut: async (_w, i) => (cut.push(i), i),
      transcribe: async (i) => {
        sent.push(i);
        if (i === failAt && failure) throw failure;
        const lead = (windows[i].keepFromMs - windows[i].startMs) / 1000; // the piece's own clock: keep range starts after the lead-in
        return [seg(`piece ${i}`, lead + 1, lead + 2)];
      },
      release: () => {},
    });
  return {
    run,
    sent,
    cut,
    failFrom: (i: number, err: AiError) => ((failAt = i), (failure = err)),
    fix: () => (failure = null),
  };
}

const three = planSource([file('a', 100)], LIMIT); // 100 min at 64 kbps is three pieces
test('the fixture plans three pieces', () => assert.equal(three.length, 3));

test('a retry after a failure at piece 2 sends only piece 2 onward', async () => {
  const { store } = memoryStore();
  const h = harness(three, store);
  h.failFrom(1, new AiError('rate', 'Too many requests'));
  await assert.rejects(h.run(), (err: unknown) => err instanceof AiError && err.kind === 'rate' && /part 2 of 3/.test(err.message));
  assert.deepEqual(h.sent, [0, 1]);
  h.fix();
  const out = await h.run();
  assert.deepEqual(h.sent, [0, 1, 1, 2], 'piece 0 is not sent again');
  assert.deepEqual(h.cut, [0, 1, 1, 2], 'and not cut again');
  assert.equal(out.length, 3);
});

test('pausing errors keep their kind and the finished pieces stay saved', async () => {
  for (const kind of ['auth', 'rate', 'offline'] as const) {
    const { store, records } = memoryStore();
    const h = harness(three, store);
    h.failFrom(2, new AiError(kind, 'x'));
    await assert.rejects(h.run(), (err: unknown) => err instanceof AiError && err.kind === kind);
    assert.deepEqual([...records.keys()], [0, 1], kind);
  }
});

test('a resumed run gives the same transcript as an uninterrupted one', async () => {
  const whole = await harness(three, memoryStore().store).run();
  const { store } = memoryStore();
  const h = harness(three, store);
  h.failFrom(1, new AiError('server', 'HTTP 500'));
  await assert.rejects(h.run());
  h.fix();
  assert.deepEqual(await h.run(), whole);
});

test('a changed source throws the saved pieces away', async () => {
  const { store } = memoryStore();
  const first = harness(planSource([file('a', 100)], LIMIT), store);
  await first.run();
  const changed = harness(planSource([file('a-longer', 100)], LIMIT), store);
  await changed.run();
  assert.deepEqual(changed.sent, [0, 1, 2]);
  const smallerLimit = harness(planSource([file('a-longer', 100)], LIMIT / 2), store);
  await smallerLimit.run();
  assert.equal(smallerLimit.sent.length, planSource([file('a-longer', 100)], LIMIT / 2).length);
});

test('an unreadable or foreign saved piece is ignored and done again', async () => {
  const { store, records } = memoryStore();
  await harness(three, store).run();
  records.set(0, '{"identity": "tru');
  records.set(1, JSON.stringify({ identity: three[1].identity, segments: [{ text: 5, locator: null }] }));
  records.set(2, JSON.stringify({ identity: three[1].identity, segments: [] }));
  const h = harness(three, store);
  await h.run();
  assert.deepEqual(h.sent, [0, 1, 2]);
  const broken: PieceStore = { ...store, read: async () => { throw new Error('disk'); } };
  const h2 = harness(three, broken);
  await h2.run();
  assert.deepEqual(h2.sent, [0, 1, 2]);
});

test('a store that cannot write does not stop the run', async () => {
  const { store } = memoryStore();
  const h = harness(three, { ...store, write: async () => { throw new Error('full'); } });
  assert.equal((await h.run()).length, 3);
});

test('saving pieces needs an identity on every window', async () => {
  await assert.rejects(
    transcribeInChunks({ windows: [{ startMs: 0, endMs: 1, keepFromMs: 0, keepToMs: 1 }], store: memoryStore().store, cut: async () => 0, transcribe: async () => [], release: () => {} }),
    RangeError,
  );
});

test('segment times are absolute across several files', async () => {
  const minute = 60_000;
  const source = [file('f0', 5, 0), file('f1', 5, 5 * minute), file('f2', 5, 10 * minute + 30_000)]; // a 30 s gap before the third
  const windows = planSource(source, LIMIT);
  assert.deepEqual(windows.map((w) => [w.file, w.offsetMs]), [[0, 0], [1, 300_000], [2, 630_000]]);
  const out = await transcribeInChunks<number>({
    windows,
    store: memoryStore().store,
    cut: async (_w, i) => i,
    transcribe: async (i) => [seg(`file ${i}`, 10, 12.5)],
    release: () => {},
  });
  assert.deepEqual(out, [seg('file 0', 10, 12.5), seg('file 1', 310, 312.5), seg('file 2', 640, 642.5)]);
});

test('a long file inside a multi-file source keeps its own cuts and offset', () => {
  const windows = planSource([file('short', 5), file('long', 100, 300_000)], LIMIT);
  assert.deepEqual(windows.map((w) => w.file), [0, 1, 1, 1]);
  const parts = windows.map((window, i) => ({ window, segments: [seg(`p${i}`, (window.keepFromMs - window.startMs) / 1000 + 1, (window.keepFromMs - window.startMs) / 1000 + 2)] }));
  const times = stitchTranscripts(parts).map((s) => (s.locator as { startSec: number }).startSec);
  assert.deepEqual(times, [1, 301, 300 + windows[2].keepFromMs / 1000 + 1, 300 + windows[3].keepFromMs / 1000 + 1]);
});

test('a source that is empty or out of order is refused', () => {
  assert.throws(() => planSource([], LIMIT), RangeError);
  assert.throws(() => planSource([file('a', 5, 60_000), file('b', 5, 0)], LIMIT), RangeError);
});

test('a single file source plans the same pieces as before, with an offset of zero', () => {
  const [w] = planSource([file('a', 1)], LIMIT);
  assert.deepEqual({ ...w, identity: undefined }, { startMs: 0, endMs: 60_000, keepFromMs: 0, keepToMs: 60_000, file: 0, offsetMs: 0, identity: undefined });
});

test('saved pieces are removed once the stitched transcript is saved', async () => {
  const { db, kn, lib, content, add, drain } = await setup();
  void db; void lib;
  const { store, records } = memoryStore();
  const windows = planSource([file('a', 100)], LIMIT);
  const h = harness(windows, store);
  h.failFrom(1, new AiError('rate', 'Too many requests'));
  const item = await add('Meeting', [], 'audio');
  let cleared = 0;
  content.segments = async () => h.run();
  content.saved = async () => {
    cleared++;
    await store.clear();
  };
  assert.equal(await kn.runNext(), 'paused');
  assert.equal(cleared, 0);
  assert.deepEqual([...records.keys()], [0], 'the failed run keeps its finished piece');
  h.fix();
  await drain();
  assert.equal(cleared, 1);
  assert.equal(records.size, 0);
  assert.equal((await kn.segmentsOf(item.id)).length, 3);
  assert.deepEqual(h.sent, [0, 1, 1, 2]);
});

test('a failing cleanup does not fail the transcript', async () => {
  const { kn, content, add, drain } = await setup();
  const item = await add('Voice', [{ text: 'hello', locator: null }], 'audio');
  content.saved = async () => {
    throw new Error('could not delete');
  };
  await drain();
  assert.equal((await kn.segmentsOf(item.id)).length, 1);
  assert.equal((await kn.job(item.id))?.status, 'done');
});

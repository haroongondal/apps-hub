import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHUNK_OVERLAP_MS, planChunks, stitchTranscripts, transcribeInChunks, type ChunkWindow } from '../audio-chunks.ts';
import { AiError, type Segment } from '../types.ts';

const LIMIT = 25 * 1024 * 1024;
const RATE = 8; // bytes per ms at 64 kbps
const seg = (text: string, startSec: number, endSec: number): Segment => ({ text, locator: { startSec, endSec } });

test('a recording under the limit is one piece', () => {
  assert.deepEqual(planChunks(60_000, 480_000, LIMIT), [{ startMs: 0, endMs: 60_000, keepFromMs: 0, keepToMs: 60_000 }]);
});

for (const minutes of [60, 100, 240]) {
  test(`a ${minutes} min recording splits into pieces under the limit that cover it once`, () => {
    const durationMs = minutes * 60_000;
    const windows = planChunks(durationMs, durationMs * RATE, LIMIT);
    assert.ok(windows.length >= 2);
    assert.equal(windows[0].keepFromMs, 0);
    assert.equal(windows.at(-1)!.keepToMs, durationMs);
    windows.forEach((w, i) => {
      assert.ok((w.endMs - w.startMs) * RATE <= LIMIT * 0.9, `piece ${i} fits`);
      assert.ok(w.startMs <= w.keepFromMs && w.keepToMs <= w.endMs);
      assert.ok(w.keepFromMs - w.startMs <= CHUNK_OVERLAP_MS && w.endMs - w.keepToMs <= CHUNK_OVERLAP_MS);
      if (i > 0) assert.equal(w.keepFromMs, windows[i - 1].keepToMs, 'keep ranges touch');
    });
  });
}

test('a 60 min recording at 64 kbps is two pieces with a 2 s overlap each side', () => {
  assert.deepEqual(planChunks(3_600_000, 28_800_000, LIMIT), [
    { startMs: 0, endMs: 1_802_000, keepFromMs: 0, keepToMs: 1_800_000 },
    { startMs: 1_798_000, endMs: 3_600_000, keepFromMs: 1_800_000, keepToMs: 3_600_000 },
  ]);
});

test('nonsense input and a limit smaller than the overlap are refused', () => {
  assert.throws(() => planChunks(0, 100, LIMIT), RangeError);
  assert.throws(() => planChunks(1000, 0, LIMIT), RangeError);
  assert.throws(() => planChunks(1000, 100, 0), RangeError);
  assert.throws(() => planChunks(3_600_000, 28_800_000, 20_000), RangeError);
});

const [first, second] = planChunks(3_600_000, 28_800_000, LIMIT);

test('segments move to the whole recording clock and the overlap counts once', () => {
  const out = stitchTranscripts([
    { window: first, segments: [seg('Opening', 0, 5), seg('Boundary one', 1795, 1799)] },
    { window: second, segments: [seg('Boundary one', 0, 1), seg('Second half', 3, 8.25)] },
  ]);
  assert.deepEqual(out, [seg('Opening', 0, 5), seg('Boundary one', 1795, 1799), seg('Second half', 1801, 1806.25)]);
});

test('a repeat that straddles the cut is dropped by its text', () => {
  const out = stitchTranscripts([
    { window: first, segments: [seg('Hello there', 1797, 1802)] },
    { window: second, segments: [seg(' hello there ', 1.9, 4.5), seg('Next', 4.5, 9)] },
  ]);
  assert.deepEqual(out, [seg('Hello there', 1797, 1802), seg('Next', 1802.5, 1807)]);
});

test('text without times is kept as it came', () => {
  assert.deepEqual(stitchTranscripts([{ window: first, segments: [{ text: 'All of it', locator: null }] }]), [{ text: 'All of it', locator: null }]);
});

function run(windows: ChunkWindow[], replies: ((i: number) => Segment[])[]) {
  const log: string[] = [];
  const calls = new Map<number, number>();
  const result = transcribeInChunks<number>({
    windows,
    cut: async (_w, i) => {
      log.push(`cut ${i}`);
      return i;
    },
    transcribe: async (i) => {
      const n = (calls.get(i) ?? 0) + 1;
      calls.set(i, n);
      log.push(`send ${i}#${n}`);
      return replies[i](n);
    },
    release: (i) => {
      log.push(`free ${i}`);
    },
    retryDelayMs: 0,
  });
  return { result, log };
}

test('pieces go one at a time and each file is freed', async () => {
  const { result, log } = run([first, second], [() => [seg('A', 0, 1)], () => [seg('B', 3, 4)]]);
  assert.deepEqual(await result, [seg('A', 0, 1), seg('B', 1801, 1802)]);
  assert.deepEqual(log, ['cut 0', 'send 0#1', 'free 0', 'cut 1', 'send 1#1', 'free 1']);
});

test('a server error is retried, up to three tries', async () => {
  const flaky = (n: number) => {
    if (n < 3) throw new AiError('server', 'HTTP 503');
    return [seg('B', 3, 4)];
  };
  const { result, log } = run([first, second], [() => [], flaky]);
  assert.deepEqual(await result, [seg('B', 1801, 1802)]);
  assert.equal(log.filter((l) => l.startsWith('send 1')).length, 3);
});

test('a piece that keeps failing fails the recording, keeps the error kind and frees its file', async () => {
  const { result, log } = run([first, second], [() => [], () => { throw new AiError('server', 'HTTP 500'); }]);
  await assert.rejects(result, (err: unknown) => err instanceof AiError && err.kind === 'server' && /part 2 of 2/.test(err.message));
  assert.equal(log.filter((l) => l.startsWith('send 1')).length, 3);
  assert.equal(log.at(-1), 'free 1');
});

test('a missing key pauses at once, without retries', async () => {
  const { result, log } = run([first], [() => { throw new AiError('auth', 'No key'); }]);
  await assert.rejects(result, (err: unknown) => err instanceof AiError && err.kind === 'auth');
  assert.equal(log.filter((l) => l.startsWith('send')).length, 1);
});

test('a piece that cannot be cut fails with a plain message', async () => {
  const result = transcribeInChunks({
    windows: [first],
    cut: async () => { throw new Error('The recording could not be read.'); },
    transcribe: async () => [],
    release: () => {},
  });
  await assert.rejects(result, /could not split this recording at part 1 of 1\. The recording could not be read\./);
});

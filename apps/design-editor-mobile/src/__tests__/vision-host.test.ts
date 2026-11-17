import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SearchToolResult } from '../photos/search-tool.ts';
import { createVisionHost, PIECE_BYTES, VISION_ID, type VisionHostDeps, type VisionProgress } from '../editor/vision-host.ts';

const DIR = 'file:///cache/vision/';

function fake(opts: { tool?: SearchToolResult; out?: Buffer; runFails?: Error; readFails?: boolean; onRun?: () => Promise<void>; onTool?: (p: (f: number) => void) => Promise<void> } = {}) {
  const files = new Map<string, Buffer>();
  const sent: VisionProgress[] = [];
  const calls = { writes: 0, runs: [] as string[][], cancels: [] as string[] };
  let progress: ((e: { id: string; fraction: number }) => void) | null = null;
  const deps: VisionHostDeps = {
    dir: DIR,
    makeDir: async () => {},
    async writeBase64(uri, b64) { calls.writes++; files.set(uri, Buffer.from(b64, 'base64')); },
    async readBase64(uri, position, length) {
      if (opts.readFails) throw new Error('Could not read the file.');
      return files.get(uri)!.subarray(position, position + length).toString('base64');
    },
    size: async uri => files.get(uri)!.length,
    remove: async uri => { files.delete(uri); },
    async getTool(_tool, onProgress) {
      if (opts.onTool) await opts.onTool(onProgress);
      else onProgress(1);
      return opts.tool ?? 'ready';
    },
    tools: async () => [{ tool: 'person' }, { tool: 'object' }, { tool: 'upscale' }],
    async runVision(id, op, path, option) {
      calls.runs.push([id, op, path, option]);
      assert.ok(files.has(`file://${path}`), 'the source is on disk while Kotlin runs');
      progress?.({ id, fraction: 0.5 });
      progress?.({ id: 'other', fraction: 0.9 });
      if (opts.onRun) await opts.onRun();
      if (opts.runFails) throw opts.runFails;
      files.set(`${DIR}${id}.png`, opts.out ?? Buffer.from('png'));
      return `/cache/vision/${id}.png`;
    },
    async cancelVision(id) { calls.cancels.push(id); },
    onRunProgress(fn) { progress = fn; return { remove: () => { progress = null; } }; },
    send: p => { sent.push(p); },
  };
  return { host: createVisionHost(deps), files, sent, calls, listening: () => progress !== null };
}

// the page's side of the transport: slice bytes into pieces as base64
const send = (host: ReturnType<typeof fake>['host'], id: string, bytes: Buffer) => {
  const n = Math.ceil(bytes.length / PIECE_BYTES);
  for (let i = 0; i < n; i++) host.chunk(id, i, bytes.subarray(i * PIECE_BYTES, (i + 1) * PIECE_BYTES).toString('base64'));
  return n;
};
const bytesOf = (n: number, seed: number) => Buffer.from(Array.from({ length: n }, (_, i) => (i * seed + (i >> 9)) & 255));

test('pieces are 1 MB of base64 and join cleanly', () => {
  assert.equal(PIECE_BYTES % 3, 0);
  assert.equal(Buffer.alloc(PIECE_BYTES).toString('base64').length, 1_048_576);
  assert.ok(VISION_ID.test('vlq3x9k2abc_-'));
  for (const bad of ['', '../x', 'a/b', 'a.src', 'x'.repeat(65)]) assert.ok(!VISION_ID.test(bad), bad);
});

test('aRoundTripRebuildsBothFilesByteForByteAndLeavesNothing', async () => {
  const image = bytesOf(2_500_000, 7);
  const out = bytesOf(1_700_000, 13);
  const f = fake({ out });
  const n = send(f.host, 'v1', image);
  assert.equal(n, 4);
  assert.deepEqual(await f.host.run('v1', 'cutout', 'person', n), { bytes: out.length });
  assert.equal(f.calls.writes, 1, 'the source is written once');
  assert.deepEqual(f.calls.runs, [['v1', 'cutout', '/cache/vision/v1.src', 'person']]);
  assert.ok(!f.files.has(`${DIR}v1.src`), 'the source is deleted after the run');
  assert.deepEqual(f.sent, [{ id: 'v1', phase: 'run', fraction: 0.5 }], 'only this run\'s progress is relayed');
  assert.equal(f.listening(), false, 'progress listener removed');
  const back: Buffer[] = [];
  for (let i = 0; ; i++) {
    const { data, done } = await f.host.read('v1', i);
    assert.ok(data.length <= 1_048_576);
    back.push(Buffer.from(data, 'base64'));
    if (done) break;
  }
  assert.equal(back.length, 3);
  assert.ok(Buffer.concat(back).equals(out), 'result bytes identical');
  assert.equal(f.files.size, 0, 'the result is deleted after the last piece');
  await assert.rejects(f.host.read('v1', 0), /no longer here/);
});

test('downloadProgressIsRelayedOnlyForARealDownload', async () => {
  const f = fake({ onTool: async p => { p(0.25); p(1); } });
  send(f.host, 'v2', Buffer.from('img'));
  await f.host.run('v2', 'upscale', '4', 1);
  assert.deepEqual(f.sent.filter(s => s.phase === 'download'), [
    { id: 'v2', phase: 'download', fraction: 0.25 },
    { id: 'v2', phase: 'download', fraction: 1 },
  ]);
  const g = fake();
  send(g.host, 'v3', Buffer.from('img'));
  await g.host.run('v3', 'cutout', 'object', 1);
  assert.equal(g.sent.filter(s => s.phase === 'download').length, 0);
});

test('offlineRejectsWithThePlainMessageAndCleansUp', async () => {
  const f = fake({ tool: 'offline' });
  send(f.host, 'v4', Buffer.from('img'));
  await assert.rejects(f.host.run('v4', 'cutout', 'person', 1), { message: 'Connect to the internet once to get this tool.' });
  assert.equal(f.calls.runs.length, 0);
  assert.equal(f.files.size, 0);
});

test('cancelDuringDownloadStopsBeforeTheRunAndResolvesNull', async () => {
  let host!: ReturnType<typeof fake>['host'];
  const f = fake({ onTool: async () => { await host.cancel('v5'); } });
  host = f.host;
  send(f.host, 'v5', Buffer.from('img'));
  assert.equal(await f.host.run('v5', 'cutout', 'person', 1), null);
  assert.equal(f.calls.runs.length, 0, 'Kotlin never ran');
  assert.deepEqual(f.calls.cancels, ['v5']);
  assert.equal(f.files.size, 0);
});

test('aKotlinCancelResolvesNullAndLeavesNoFile', async () => {
  const f = fake({ runFails: Object.assign(new Error('Stopped.'), { code: 'CANCELLED' }) });
  send(f.host, 'v6', Buffer.from('img'));
  assert.equal(await f.host.run('v6', 'upscale', '2', 1), null);
  assert.equal(f.files.size, 0);
});

test('aCancelThatLosesTheRaceStillDeletesTheResult', async () => {
  let host!: ReturnType<typeof fake>['host'];
  const f = fake({ onRun: async () => { await host.cancel('v7'); } });
  host = f.host;
  send(f.host, 'v7', Buffer.from('img'));
  assert.equal(await f.host.run('v7', 'cutout', 'object', 1), null);
  assert.equal(f.files.size, 0);
});

test('cancelBetweenRunAndReadDeletesTheResult', async () => {
  const f = fake();
  send(f.host, 'v8', Buffer.from('img'));
  await f.host.run('v8', 'cutout', 'person', 1);
  assert.equal(f.files.size, 1);
  await f.host.cancel('v8');
  assert.equal(f.files.size, 0);
});

test('cancelDuringUploadDropsHeldPiecesAndRefusesMore', async () => {
  const f = fake();
  f.host.chunk('v9', 0, 'AAAA');
  await f.host.cancel('v9');
  assert.equal(f.host.chunk('v9', 1, 'AAAA'), false);
  assert.equal(await f.host.run('v9', 'cutout', 'person', 2), null);
  assert.equal(f.calls.writes, 0);
});

test('aRunErrorKeepsItsMessageAndCleansUp', async () => {
  const f = fake({ runFails: new Error('This image is already as big as it can be.') });
  send(f.host, 'v10', Buffer.from('img'));
  await assert.rejects(f.host.run('v10', 'upscale', '4', 1), { message: 'This image is already as big as it can be.' });
  assert.equal(f.files.size, 0);
});

test('aFailedReadDeletesTheResult', async () => {
  const f = fake({ readFails: true });
  send(f.host, 'v11', Buffer.from('img'));
  await f.host.run('v11', 'cutout', 'person', 1);
  await assert.rejects(f.host.read('v11', 0));
  assert.equal(f.files.size, 0);
});

test('aMissingPieceOrBadRequestIsRefusedBeforeAnythingIsWritten', async () => {
  const f = fake();
  f.host.chunk('v12', 0, 'AAAA');
  f.host.chunk('v12', 2, 'AAAA');
  await assert.rejects(f.host.run('v12', 'cutout', 'person', 3), /didn't arrive in full/);
  f.host.chunk('v13', 0, 'AAAA');
  await assert.rejects(f.host.run('v13', 'cutout', 'everything', 1), /didn't start properly/);
  assert.throws(() => f.host.chunk('../models/x', 0, 'AAAA'), /didn't start properly/);
  await assert.rejects(f.host.run('../models/x', 'cutout', 'person', 1), /didn't start properly/);
  assert.equal(f.calls.writes, 0);
  assert.equal(f.files.size, 0);
});

test('toolsListsOnlyTheCutOutKindsKotlinOffers', async () => {
  assert.deepEqual(await fake().host.tools(), ['person', 'object']);
});

test('disposeCancelsAndCleansEverythingStillHeld', async () => {
  const f = fake();
  send(f.host, 'v14', Buffer.from('img'));
  await f.host.run('v14', 'cutout', 'person', 1);
  f.host.chunk('v15', 0, 'AAAA');
  await f.host.dispose();
  assert.deepEqual(f.calls.cancels.sort(), ['v14', 'v15']);
  assert.equal(f.files.size, 0);
  assert.equal(await f.host.run('v15', 'cutout', 'person', 1), null);
});

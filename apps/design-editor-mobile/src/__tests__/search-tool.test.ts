import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSearchTool, type PhotoModel } from '../photos/search-tool.ts';

const MB = 1024 * 1024;
const vision: PhotoModel = { name: 'vision.onnx', url: 'https://x/vision', bytes: 100 * MB, ready: false };
const text: PhotoModel = { name: 'text.onnx', url: 'https://x/text', bytes: 100 * MB, ready: false };

function fakes(models: PhotoModel[], free = 10_000 * MB, installOk = true, downloadFails = false, hangs: boolean | 'resolves' = false) {
  const state = { hangs };
  const calls = { downloaded: [] as string[], installed: [] as string[], removed: [] as string[] };
  const deps = {
    models: async () => models,
    freeBytes: async () => free,
    remove: async (path: string) => { calls.removed.push(path); },
    install: async (name: string) => { calls.installed.push(name); return installOk; },
    async download(url: string, to: string, onBytes: (n: number) => void, signal?: AbortSignal) {
      calls.downloaded.push(to);
      if (state.hangs) {
        onBytes(1);
        // the real expo download resolves (null) after cancelAsync instead of rejecting
        await new Promise<void>((resolve, reject) => signal?.addEventListener('abort', () => (state.hangs === 'resolves' ? resolve() : reject(new Error('Download canceled'))), { once: true }));
      }
      if (downloadFails) throw new Error('Network request failed');
      const m = models.find(x => x.url === url)!;
      onBytes(m.bytes / 2);
      onBytes(m.bytes);
    },
  };
  return { deps, calls, state };
}

test('skipsReadyModels: a model already on the phone is not fetched again', async () => {
  const { deps, calls } = fakes([{ ...vision, ready: true }, text]);
  assert.equal(await getSearchTool(deps, () => {}), 'ready');
  assert.deepEqual(calls.downloaded, ['models/text.onnx.part']);
  assert.deepEqual(calls.installed, ['text.onnx']);
});

test('stopsWhenNoRoom: needs the missing bytes plus 50 MB, and downloads nothing otherwise', async () => {
  const { deps, calls } = fakes([vision, text], 249 * MB);
  assert.equal(await getSearchTool(deps, () => {}), 'no-room');
  assert.deepEqual(calls.downloaded, []);
  const enough = fakes([vision, text], 250 * MB);
  assert.equal(await getSearchTool(enough.deps, () => {}), 'ready');
});

test('reportsBadDownload: a file that fails the check stops the job', async () => {
  const { deps, calls } = fakes([vision, text], undefined, false);
  assert.equal(await getSearchTool(deps, () => {}), 'bad-download');
  assert.deepEqual(calls.downloaded, ['models/vision.onnx.part']);
});

test('progressReachesOne: progress only rises and ends at 1', async () => {
  const { deps } = fakes([vision, text]);
  const seen: number[] = [];
  await getSearchTool(deps, f => seen.push(f));
  assert.equal(seen.at(-1), 1);
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
  assert.ok(seen.every(f => f >= 0 && f <= 1));
});

test('reportsInterruptedDownload: a download that fails midway gives offline and clears the partial file', async () => {
  const { deps, calls } = fakes([vision, text], undefined, true, true);
  assert.equal(await getSearchTool(deps, () => {}), 'offline');
  assert.deepEqual(calls.removed, ['models/vision.onnx.part']);
  assert.deepEqual(calls.installed, []);
});

test('removeFailureStillReportsOffline: a failed clean-up does not hide the offline result', async () => {
  const { deps } = fakes([vision, text], undefined, true, true);
  deps.remove = async () => { throw new Error('No such file'); };
  assert.equal(await getSearchTool(deps, () => {}), 'offline');
});

// the fake download never finishes on its own: only the abort ends it
test('cancelMidDownload: aborting settles at once, deletes the partial file and skips the install', async () => {
  const { deps, calls } = fakes([vision, text], undefined, true, false, true);
  const abort = new AbortController();
  const run = getSearchTool(deps, () => {}, abort.signal);
  await new Promise(r => setImmediate(r));
  abort.abort();
  const winner = await Promise.race([run, new Promise(r => setTimeout(() => r('hung'), 500))]);
  assert.notEqual(winner, 'hung');
  assert.deepEqual(calls.removed, ['models/vision.onnx.part']);
  assert.deepEqual(calls.installed, []);
  assert.deepEqual(calls.downloaded, ['models/vision.onnx.part'], 'the second model is never started');
});

test('cancelBeforeTheDownload: an aborted signal downloads nothing', async () => {
  const { deps, calls } = fakes([vision]);
  const abort = new AbortController();
  abort.abort();
  await getSearchTool(deps, () => {}, abort.signal);
  assert.deepEqual(calls.downloaded, []);
  assert.deepEqual(calls.installed, []);
});

test('cancelAfterFinishAndTwice: aborting a finished run or aborting twice changes nothing', async () => {
  const { deps, calls } = fakes([vision]);
  const abort = new AbortController();
  assert.equal(await getSearchTool(deps, () => {}, abort.signal), 'ready');
  abort.abort();
  abort.abort();
  assert.deepEqual(calls.installed, ['vision.onnx']);
  assert.deepEqual(calls.removed, []);
});

test('laterRunAfterCancel: a new run downloads the model again from scratch', async () => {
  const { deps, calls, state } = fakes([vision], undefined, true, false, true);
  const abort = new AbortController();
  const first = getSearchTool(deps, () => {}, abort.signal);
  await new Promise(r => setImmediate(r));
  abort.abort();
  await first;
  state.hangs = false;
  assert.equal(await getSearchTool(deps, () => {}, new AbortController().signal), 'ready');
  assert.deepEqual(calls.downloaded, ['models/vision.onnx.part', 'models/vision.onnx.part']);
  assert.deepEqual(calls.installed, ['vision.onnx']);
});

test('cancelWhenTheDownloadResolvesNormally: a cancelled download that resolves still removes the partial file and installs nothing', async () => {
  const { deps, calls } = fakes([vision, text], undefined, true, false, 'resolves');
  const abort = new AbortController();
  const run = getSearchTool(deps, () => {}, abort.signal);
  await new Promise(r => setImmediate(r));
  abort.abort();
  const winner = await Promise.race([run, new Promise(r => setTimeout(() => r('hung'), 500))]);
  assert.notEqual(winner, 'hung');
  assert.notEqual(winner, 'ready');
  assert.deepEqual(calls.removed, ['models/vision.onnx.part']);
  assert.deepEqual(calls.installed, []);
  assert.deepEqual(calls.downloaded, ['models/vision.onnx.part']);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSearchTool, type PhotoModel } from '../photos/search-tool.ts';

const MB = 1024 * 1024;
const vision: PhotoModel = { name: 'vision.onnx', url: 'https://x/vision', bytes: 100 * MB, ready: false };
const text: PhotoModel = { name: 'text.onnx', url: 'https://x/text', bytes: 100 * MB, ready: false };

function fakes(models: PhotoModel[], free = 10_000 * MB, installOk = true, downloadFails = false) {
  const calls = { downloaded: [] as string[], installed: [] as string[], removed: [] as string[] };
  const deps = {
    models: async () => models,
    freeBytes: async () => free,
    remove: async (path: string) => { calls.removed.push(path); },
    install: async (name: string) => { calls.installed.push(name); return installOk; },
    async download(url: string, to: string, onBytes: (n: number) => void) {
      calls.downloaded.push(to);
      if (downloadFails) throw new Error('Network request failed');
      const m = models.find(x => x.url === url)!;
      onBytes(m.bytes / 2);
      onBytes(m.bytes);
    },
  };
  return { deps, calls };
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

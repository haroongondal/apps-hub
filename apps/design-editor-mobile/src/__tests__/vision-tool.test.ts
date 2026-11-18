import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSearchTool } from '../photos/search-tool.ts';
import { visionToolDeps, visionToolMessage, type VisionModel } from '../photos/vision-tool.ts';

const MB = 1024 * 1024;
const model = (tool: string, name: string, ready = false): VisionModel => ({ tool, name, url: `https://x/${name}`, bytes: 10 * MB, ready });
const all = (ready = false) => [model('person', 'modnet.onnx', ready), model('object', 'u2netp.onnx'), model('upscale', 'esrgan.onnx')];

function fakes(models: VisionModel[], downloadFails = false) {
  const downloaded: string[] = [];
  const base = {
    models: async () => models,
    freeBytes: async () => 10_000 * MB,
    remove: async () => {},
    install: async () => true,
    async download(_url: string, to: string, onBytes: (n: number) => void) {
      downloaded.push(to);
      if (downloadFails) throw new Error('Network request failed');
      onBytes(10 * MB);
    },
  };
  return { base, downloaded };
}

test('onlyTheAskedToolDownloads: asking for the person cut-out fetches only that model', async () => {
  const { base, downloaded } = fakes(all());
  assert.equal(await getSearchTool(visionToolDeps('person', base), () => {}), 'ready');
  assert.deepEqual(downloaded, ['models/modnet.onnx.part']);
});

test('readyToolNeedsNoNetwork: a model already on the phone is ready even with no connection', async () => {
  const { base, downloaded } = fakes(all(true), true);
  assert.equal(await getSearchTool(visionToolDeps('person', base), () => {}), 'ready');
  assert.deepEqual(downloaded, []);
});

test('offlineSaysConnectOnce: a failed download asks the person to connect once', async () => {
  const { base } = fakes(all(), true);
  const r = await getSearchTool(visionToolDeps('upscale', base), () => {});
  assert.equal(r, 'offline');
  assert.equal(visionToolMessage(r), 'Connect to the internet once to get this tool.');
});

test('messages: ready says nothing; the others are plain sentences (plain-words.test.ts scans the source strings)', () => {
  assert.equal(visionToolMessage('ready'), null);
  assert.equal(visionToolMessage('no-room'), "There isn't enough free space for this tool. Free up some space and try again.");
  assert.equal(visionToolMessage('bad-download'), "The download didn't finish properly. Try again.");
});

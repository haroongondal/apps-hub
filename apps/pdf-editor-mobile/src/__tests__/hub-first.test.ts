import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AiError, EMBED_DIMS, IMAGE_PROMPT, type CompatPort, type Segment } from '@apps-hub/knowledge-core';
import { AiHubError, type ErrorKind } from 'ai-hub-client/src/contract.ts';

import { HUB_MAX_IMAGE, HUB_MAX_TOKENS, hubFirst, jsonPart, NOT_ALLOWED_MS, type AiSource, type Hub } from '../nexus/hub-first.ts';

const OWN_SEGMENTS: Segment[] = [{ text: 'own', locator: { startSec: 0, endSec: 1 } }];

function ownPort() {
  const calls: string[] = [];
  const port: CompatPort = {
    embed: async (texts) => (calls.push('embed'), texts.map(() => new Float32Array(EMBED_DIMS).fill(1))),
    extract: async () => (calls.push('extract'), { own: true }),
    answer: async () => (calls.push('answer'), 'own answer'),
    readImage: async (b64) => (calls.push(`readImage:${b64}`), 'own image'),
    transcribe: async () => (calls.push('transcribe'), OWN_SEGMENTS),
    complete: async () => (calls.push('complete'), 'own complete'),
  };
  return { calls, port };
}

function vector(dims: number, value = 3): Float32Array {
  return new Float32Array(dims).fill(value);
}

type Overrides = { [K in keyof Hub]?: (req: Parameters<Hub[K]>[0]) => unknown };

function fakeHub(over: Overrides = {}) {
  const requests: { job: string; req: unknown }[] = [];
  const hub: Hub = {
    chat: async (req) => (requests.push({ job: 'chat', req }), { text: 'hub text', toolCalls: [], usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0 }, model: 'm' }),
    vision: async (req) => (requests.push({ job: 'vision', req }), { text: 'hub image', toolCalls: [], usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0 }, model: 'm' }),
    embed: async (req) => (requests.push({ job: 'embed', req }), { vectors: req.texts.map(() => vector(EMBED_DIMS)), dims: EMBED_DIMS, model: 'gemini-embedding-001' }),
    transcribe: async (req) => (requests.push({ job: 'transcribe', req }), { text: 'hi there', segments: [{ start: 0.5, end: 1.5, text: ' hi ' }] }),
  };
  for (const [k, v] of Object.entries(over)) Object.assign(hub, { [k]: async (req: unknown) => (requests.push({ job: k, req }), (v as (r: unknown) => unknown)(req)) });
  return { hub, requests };
}

function setup(over: Overrides = {}, clock = { t: 1_000 }) {
  const own = ownPort();
  const fake = fakeHub(over);
  const sources: AiSource[] = [];
  const ai = hubFirst({ hub: fake.hub, own: () => own.port, now: () => clock.t, served: (s) => sources.push(s) });
  return { ai, own: own.calls, requests: fake.requests, sources, clock };
}

const fail = (kind: ErrorKind) => () => {
  throw new AiHubError(kind, `hub said ${kind}`);
};

test('hub not installed: the own key path serves the call', async () => {
  const s = setup({ chat: fail('hub-missing') });
  assert.equal(await s.ai.answer('q', ['a']), 'own answer');
  assert.deepEqual(s.own, ['answer']);
  assert.deepEqual(s.sources, ['own']);
});

test('hub served: the own key path is never called', async () => {
  const s = setup();
  assert.equal(await s.ai.answer('q', ['a']), 'hub text');
  assert.deepEqual(s.own, []);
  assert.deepEqual(s.sources, ['hub']);
});

test('a fall-back error in the middle of a hub call uses the own key path exactly once', async () => {
  let sent = 0;
  const s = setup({
    // like aiHub.embed: batches of 8 sent one after another; the key runs out on the second
    embed: (req) => {
      const { texts } = req;
      for (let i = 0; i < texts.length; i += 8) {
        sent++;
        if (i > 0) throw new AiHubError('no-key', 'no key');
      }
      return { vectors: texts.map(() => vector(EMBED_DIMS)), dims: EMBED_DIMS, model: 'gemini-embedding-001' };
    },
  });
  const out = await s.ai.embed(Array.from({ length: 12 }, (_, i) => `t${i}`));
  assert.equal(sent, 2);
  assert.equal(out.length, 12);
  assert.deepEqual(s.own, ['embed']);
  assert.deepEqual(s.sources, ['own']);
});

test('a native rejection with a fall-back code falls back too', async () => {
  const s = setup({
    chat: () => {
      throw Object.assign(new Error('Caused by: not installed'), { code: 'hub-missing' });
    },
  });
  assert.equal(await s.ai.complete('sys', 'user', false), 'own complete');
});

test('embed asks for 512 dimensions and returns unit vectors', async () => {
  const s = setup();
  const [v] = await s.ai.embed(['a']);
  assert.deepEqual(s.requests[0], { job: 'embed', req: { texts: ['a'], dimensions: EMBED_DIMS } });
  assert.equal(v.length, EMBED_DIMS);
  assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-5);
});

test('embed with another vector size or model falls back to the own key', async () => {
  for (const reply of [
    { dims: 768, model: 'gemini-embedding-001' },
    { dims: EMBED_DIMS, model: 'text-embedding-004' },
  ]) {
    const s = setup({ embed: (req) => ({ vectors: (req as { texts: string[] }).texts.map(() => vector(reply.dims)), ...reply }) });
    const out = await s.ai.embed(['a', 'b']);
    assert.equal(out[0][0], 1);
    assert.deepEqual(s.own, ['embed']);
  }
});

test('errors the own key cannot fix become AiErrors and never reach the own path', async () => {
  const cases: [ErrorKind, AiError['kind']][] = [
    ['busy', 'rate'],
    ['timeout', 'server'],
    ['provider-error', 'server'],
    ['too-large', 'bad_request'],
  ];
  for (const [hubKind, aiKind] of cases) {
    const s = setup({ chat: fail(hubKind) });
    await assert.rejects(s.ai.answer('q', ['a']), (e: unknown) => e instanceof AiError && e.kind === aiKind && e.message === `hub said ${hubKind}`);
    assert.deepEqual(s.own, []);
  }
});

test('not-allowed is remembered for a while, then the hub is asked again', async () => {
  const s = setup({ chat: fail('not-allowed') });
  await s.ai.answer('q', ['a']);
  assert.equal(s.ai.hubBlocked(), true);
  await s.ai.answer('q', ['a']);
  assert.equal(s.requests.length, 1);
  s.clock.t += NOT_ALLOWED_MS;
  assert.equal(s.ai.hubBlocked(), false);
  await s.ai.answer('q', ['a']);
  assert.equal(s.requests.length, 2);
  assert.deepEqual(s.own, ['answer', 'answer', 'answer']);
});

test('transcribe asks for segments and returns them in the own path shape', async () => {
  const s = setup();
  const out = await s.ai.transcribe({ uri: 'file:///x/audio.m4a', name: 'audio.m4a', type: 'audio/mp4' });
  assert.deepEqual(s.requests[0].req, { file: 'file:///x/audio.m4a', fileName: 'audio.m4a', mime: 'audio/mp4', segments: true });
  assert.deepEqual(out, [{ text: 'hi', locator: { startSec: 0.5, endSec: 1.5 } }]);
  assert.deepEqual(s.own, []);
});

test('transcribe on a hub too old for segments uses the own key', async () => {
  const s = setup({ transcribe: fail('version') });
  assert.deepEqual(await s.ai.transcribe({ uri: 'file:///a.m4a', name: 'audio.m4a', type: 'audio/mp4' }), OWN_SEGMENTS);
  assert.deepEqual(s.own, ['transcribe']);
});

test('readImage sends the file to the hub when it fits and reads base64 only for the own key', async () => {
  let reads = 0;
  const file = (size: number) => ({ uri: 'file:///i/image.jpg', size, base64: async () => (reads++, 'B64') });
  const s = setup();
  assert.equal(await s.ai.readImage(file(1000)), 'hub image');
  assert.deepEqual(s.requests[0].req, { messages: [{ role: 'user', content: IMAGE_PROMPT }], image: 'file:///i/image.jpg', mime: 'image/jpeg', maxTokens: HUB_MAX_TOKENS });
  assert.equal(reads, 0);
  assert.equal(await s.ai.readImage(file(HUB_MAX_IMAGE + 1)), 'own image');
  assert.equal(s.requests.length, 1);
  assert.deepEqual(s.own, ['readImage:B64']);
});

test('extract reads a fenced JSON reply, runs in the background and asks for the full token budget', async () => {
  const s = setup({ chat: () => ({ text: '```json\n{"concepts":[]}\n```', toolCalls: [], usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0 }, model: 'm' }) });
  assert.deepEqual(await s.ai.extract(['seg']), { concepts: [] });
  const req = s.requests[0].req as { priority: string; maxTokens: number; messages: { role: string }[] };
  assert.equal(req.priority, 'background');
  assert.equal(req.maxTokens, HUB_MAX_TOKENS);
  assert.deepEqual(req.messages.map((m) => m.role), ['system', 'user']);
});

test('an unreadable graph from the hub is a bad_reply and does not go to the own key', async () => {
  const s = setup({ chat: () => ({ text: 'no json here', toolCalls: [], usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0 }, model: 'm' }) });
  await assert.rejects(s.ai.extract(['seg']), (e: unknown) => e instanceof AiError && e.kind === 'bad_reply');
  assert.deepEqual(s.own, []);
});

test('jsonPart keeps the object and leaves other text alone', () => {
  assert.equal(jsonPart('Here: {"a":{"b":1}} done'), '{"a":{"b":1}}');
  assert.equal(jsonPart('plain'), 'plain');
});

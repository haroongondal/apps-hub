import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AiError, BOUNDED_PAUSE, EMBED_DIMS, IMAGE_PROMPT, PAUSING } from '@apps-hub/knowledge-core';
import { AiHubError, ERROR_KINDS, type ErrorKind } from 'ai-hub-client/src/contract.ts';

import { HUB_MAX_IMAGE, HUB_MAX_TOKENS, hubAi, jsonPart, toAiError, type Hub } from '../nexus/hub-ai.ts';
import type { HubState } from '../nexus/hub-state.ts';

const usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
const reply = (text: string) => ({ text, toolCalls: [], usage, model: 'm' });

function vector(dims: number, value = 3): Float32Array {
  return new Float32Array(dims).fill(value);
}

type Overrides = { [K in keyof Hub]?: (req: Parameters<Hub[K]>[0]) => unknown };

function fakeHub(over: Overrides = {}) {
  const requests: { job: string; req: unknown }[] = [];
  const hub: Hub = {
    chat: async (req) => (requests.push({ job: 'chat', req }), reply('hub text')),
    vision: async (req) => (requests.push({ job: 'vision', req }), reply('hub image')),
    embed: async (req) => (requests.push({ job: 'embed', req }), { vectors: req.texts.map(() => vector(EMBED_DIMS)), dims: EMBED_DIMS, model: 'gemini-embedding-001' }),
    transcribe: async (req) => (requests.push({ job: 'transcribe', req }), { text: 'hi there', segments: [{ start: 0.5, end: 1.5, text: ' hi ' }] }),
  };
  for (const [k, v] of Object.entries(over)) Object.assign(hub, { [k]: async (req: unknown) => (requests.push({ job: k, req }), (v as (r: unknown) => unknown)(req)) });
  return { hub, requests };
}

function setup(over: Overrides = {}) {
  const fake = fakeHub(over);
  const states: HubState[] = [];
  const ai = hubAi({ hub: fake.hub, onState: (s) => states.push(s) });
  return { ai, requests: fake.requests, states };
}

const fail = (kind: ErrorKind) => () => {
  throw new AiHubError(kind, `hub said ${kind}`);
};

const auth = (message: string) => (e: unknown) => e instanceof AiError && e.kind === 'auth' && e.message === message;

test('a hub that is missing, not allowed, out of keys or too old becomes the one thing the owner does, and the queue pauses', async () => {
  const cases: [ErrorKind, HubState, string][] = [
    ['hub-missing', 'missing', 'AI needs AI hub'],
    ['not-allowed', 'not-allowed', 'Allow Nexus in AI hub'],
    ['no-key', 'no-key', 'Add a key in AI hub'],
    ['version', 'version', 'Update AI hub'],
  ];
  for (const [kind, state, line] of cases) {
    const s = setup({ chat: fail(kind) });
    await assert.rejects(s.ai.answer('q', ['a']), auth(line));
    assert.deepEqual(s.states, [state]);
    assert.equal(s.requests.length, 1, 'one hub call, no second try and no other service');
  }
});

test('a native rejection that carries a code is read like an AiHubError', async () => {
  const s = setup({
    chat: () => {
      throw Object.assign(new Error('Caused by: not installed'), { code: 'hub-missing' });
    },
  });
  await assert.rejects(s.ai.complete('sys', 'user', false), auth('AI needs AI hub'));
});

test('no hub wording or error kind reaches the owner', () => {
  for (const kind of ERROR_KINDS) {
    const err = toAiError(new AiHubError(kind, 'RAW hub text, stack at com.haroon.aihub.Foo'));
    assert.doesNotMatch(err.message, /RAW|com\.haroon|stack|provider-error|no-key|not-allowed|hub-missing|Groq|Gemini/, kind);
    assert.ok(err.message.length > 0 && /^[A-Z]/.test(err.message), kind);
  }
});

test('errors the owner cannot fix map to what the queue understands', async () => {
  const cases: [ErrorKind, AiError['kind']][] = [
    ['busy', 'rate'],
    ['timeout', 'server'],
    ['provider-error', 'unanswered'],
    ['too-large', 'bad_request'],
    ['invalid', 'bad_request'],
  ];
  for (const [hubKind, aiKind] of cases) {
    const s = setup({ chat: fail(hubKind) });
    await assert.rejects(s.ai.answer('q', ['a']), (e: unknown) => e instanceof AiError && e.kind === aiKind);
    assert.deepEqual(s.states, [], 'a problem the owner cannot fix leaves the hub state alone');
  }
});

test('a hub service that did not answer pauses the queue (bounded); a timeout is billed and counts, like a real bad request', () => {
  const err = toAiError(new AiHubError('provider-error', 'AI hub couldn\'t reach Groq. Check the phone\'s connection and try again.'));
  assert.ok(PAUSING.includes(err.kind) && BOUNDED_PAUSE.includes(err.kind), 'provider-error pauses, bounded');
  assert.equal(err.message, 'Waiting for AI hub to answer');
  for (const kind of ['timeout', 'too-large', 'invalid', 'cancelled'] as const) assert.ok(!PAUSING.includes(toAiError(new AiHubError(kind, 'x')).kind), `${kind} counts`);
  assert.ok(!PAUSING.includes(new AiError('bad_reply', 'x').kind));
});

test('a call that works says AI hub is ready', async () => {
  const s = setup();
  assert.equal(await s.ai.answer('q', ['a']), 'hub text');
  assert.deepEqual(s.states, ['ready']);
});

test('embed asks for 512 dimensions and returns unit vectors', async () => {
  const s = setup();
  const [v] = await s.ai.embed(['a']);
  assert.deepEqual(s.requests[0], { job: 'embed', req: { texts: ['a'], dimensions: EMBED_DIMS } });
  assert.equal(v.length, EMBED_DIMS);
  assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-5);
});

test('embed with another vector size or model pauses and tells the owner to set Embeddings in AI hub', async () => {
  for (const other of [
    { dims: 768, model: 'gemini-embedding-001' },
    { dims: EMBED_DIMS, model: 'text-embedding-004' },
  ]) {
    const s = setup({ embed: (req) => ({ vectors: (req as { texts: string[] }).texts.map(() => vector(other.dims)), ...other }) });
    await assert.rejects(s.ai.embed(['a', 'b']), (e: unknown) => e instanceof AiError && e.kind === 'auth' && /set Embeddings to gemini-embedding-001/.test(e.message));
  }
});

test('the wrong number of vectors is a hub fault that counts attempts instead of waiting for the owner', async () => {
  const s = setup({ embed: () => ({ vectors: [vector(EMBED_DIMS)], dims: EMBED_DIMS, model: 'gemini-embedding-001' }) });
  await assert.rejects(s.ai.embed(['a', 'b']), (e: unknown) => e instanceof AiError && e.kind === 'bad_reply' && !PAUSING.includes(e.kind));
});

test('transcribe asks for segments and returns them with their times', async () => {
  const s = setup();
  const out = await s.ai.transcribe({ uri: 'file:///x/audio.m4a', name: 'audio.m4a', type: 'audio/mp4' });
  assert.deepEqual(s.requests[0].req, { file: 'file:///x/audio.m4a', fileName: 'audio.m4a', mime: 'audio/mp4', segments: true });
  assert.deepEqual(out, [{ text: 'hi', locator: { startSec: 0.5, endSec: 1.5 } }]);
});

test('transcribe on a hub too old for segments says to update it', async () => {
  const s = setup({ transcribe: fail('version') });
  await assert.rejects(s.ai.transcribe({ uri: 'file:///a.m4a', name: 'audio.m4a', type: 'audio/mp4' }), auth('Update AI hub'));
});

test('readImage sends the file to the hub, and a photo over the hub limit is refused before anything is sent', async () => {
  const file = (size: number) => ({ uri: 'file:///i/image.jpg', size });
  const s = setup();
  assert.equal(await s.ai.readImage(file(1000)), 'hub image');
  assert.deepEqual(s.requests[0].req, { messages: [{ role: 'user', content: IMAGE_PROMPT }], image: 'file:///i/image.jpg', mime: 'image/jpeg', maxTokens: HUB_MAX_TOKENS });
  await assert.rejects(s.ai.readImage(file(HUB_MAX_IMAGE + 1)), (e: unknown) => e instanceof AiError && e.kind === 'bad_request' && /too large/.test(e.message));
  assert.equal(s.requests.length, 1);
});

test('extract reads a fenced JSON reply, runs in the background and asks for the full token budget', async () => {
  const s = setup({ chat: () => reply('```json\n{"concepts":[]}\n```') });
  assert.deepEqual(await s.ai.extract(['seg']), { concepts: [] });
  const req = s.requests[0].req as { priority: string; maxTokens: number; messages: { role: string }[] };
  assert.equal(req.priority, 'background');
  assert.equal(req.maxTokens, HUB_MAX_TOKENS);
  assert.deepEqual(req.messages.map((m) => m.role), ['system', 'user']);
});

test('an unreadable graph from the hub is a bad_reply', async () => {
  const s = setup({ chat: () => reply('no json here') });
  await assert.rejects(s.ai.extract(['seg']), (e: unknown) => e instanceof AiError && e.kind === 'bad_reply');
});

test('jsonPart keeps the object and leaves other text alone', () => {
  assert.equal(jsonPart('Here: {"a":{"b":1}} done'), '{"a":{"b":1}}');
  assert.equal(jsonPart('plain'), 'plain');
});

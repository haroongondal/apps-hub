import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanExtraction } from '../extraction.ts';
import { openAiCompatPort } from '../openai.ts';
import { AiError } from '../types.ts';

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function stub(status: number, reply: unknown) {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
    return new Response(typeof reply === 'string' ? reply : JSON.stringify(reply), { status });
  }) as unknown as typeof globalThis.fetch;
  return { sent, fetch };
}

const kind = (k: string) => (e: unknown) => e instanceof AiError && e.kind === k;
const BASE = 'https://example.test/v1/';

test('embed sends the model and 512 dimensions, and returns vectors in input order', async () => {
  const { sent, fetch } = stub(200, { data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] });
  const ai = openAiCompatPort({ apiKey: ' key-test ', baseUrl: BASE, embedModel: 'm-embed', fetch });
  const out = await ai.embed(['a', 'b']);
  assert.deepEqual(out.map((v) => [...v]), [[1, 0], [0, 1]]);
  assert.equal(sent[0].url, 'https://example.test/v1/embeddings');
  assert.equal(sent[0].headers.Authorization, 'Bearer key-test');
  assert.deepEqual(sent[0].body, { model: 'm-embed', input: ['a', 'b'], dimensions: 512 });
});

test('embed cuts a longer vector to 512 dimensions and normalises it', async () => {
  const long = Array.from({ length: 600 }, (_, i) => (i === 0 ? 3 : i === 1 ? 4 : i === 599 ? 100 : 0)); // 100 sits past the cut
  const { fetch } = stub(200, { data: [{ index: 0, embedding: long }] });
  const [v] = await openAiCompatPort({ apiKey: 'k', baseUrl: BASE, fetch }).embed(['a']);
  assert.equal(v.length, 512);
  assert.ok(Math.abs(v[0] - 0.6) < 1e-6 && Math.abs(v[1] - 0.8) < 1e-6);
  assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-6);
});

test('extract asks for a JSON object, and a reply missing fields still cleans to empty lists', async () => {
  const { sent, fetch } = stub(200, { choices: [{ message: { content: '{"atoms":[{"text":"A point"}]}' } }] });
  const reply = await openAiCompatPort({ apiKey: 'k', baseUrl: BASE, chatModel: 'm-chat', fetch }).extract(['first', 'second']);
  const ex = cleanExtraction(reply, 2);
  assert.deepEqual(ex, { concepts: [], atoms: [{ text: 'A point', segment: 0, concepts: [] }], relations: [] });
  const body = sent[0].body as { model: string; response_format: unknown; messages: { content: string }[] };
  assert.equal(body.model, 'm-chat');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.messages[1].content, '[0] first\n\n[1] second');
});

test('answer numbers the sources from 1 and passes reasoning effort only when set', async () => {
  const { sent, fetch } = stub(200, { choices: [{ message: { content: 'It is [1].' } }] });
  assert.equal(await openAiCompatPort({ apiKey: 'k', baseUrl: BASE, chatModel: 'm', reasoningEffort: 'low', fetch }).answer('Why?', ['A: x']), 'It is [1].');
  const body = sent[0].body as { messages: { content: string }[]; reasoning_effort?: string };
  assert.equal(body.messages[1].content, '[1] A: x\n\nQuestion: Why?');
  assert.equal(body.reasoning_effort, 'low');

  await openAiCompatPort({ apiKey: 'k', baseUrl: BASE, chatModel: 'm', fetch }).answer('Why?', []);
  assert.equal('reasoning_effort' in (sent[1].body as object), false);
});

test('transcribe uploads the file with its model and keeps segment timestamps', async () => {
  const { sent, fetch } = stub(200, { text: 'hi there', segments: [{ start: 0, end: 1.5, text: ' hi' }, { start: 1.5, end: 3, text: ' there' }] });
  const out = await openAiCompatPort({ apiKey: 'k', baseUrl: BASE, transcribeModel: 'whisper-large-v3-turbo', fetch }).transcribe(
    new Blob(['audio'], { type: 'audio/m4a' }),
  );
  assert.deepEqual(out, [
    { text: 'hi', locator: { startSec: 0, endSec: 1.5 } },
    { text: 'there', locator: { startSec: 1.5, endSec: 3 } },
  ]);
  assert.ok(sent[0].body instanceof FormData);
  assert.equal((sent[0].body as FormData).get('model'), 'whisper-large-v3-turbo');
  assert.equal((sent[0].body as FormData).get('response_format'), 'verbose_json');
  assert.equal(sent[0].headers['Content-Type'], undefined); // fetch sets the multipart boundary
});

test('HTTP failures map to error kinds the queue understands', async () => {
  for (const [status, k] of [
    [401, 'auth'],
    [429, 'rate'],
    [503, 'server'],
    [400, 'bad_request'],
  ] as const) {
    await assert.rejects(openAiCompatPort({ apiKey: 'k', baseUrl: BASE, fetch: stub(status, 'nope').fetch }).embed(['a']), kind(k));
  }
  await assert.rejects(openAiCompatPort({ apiKey: 'k', baseUrl: BASE, fetch: stub(200, 'not json').fetch }).embed(['a']), kind('bad_reply'));
  const down = (async () => {
    throw new TypeError('Network request failed');
  }) as unknown as typeof fetch;
  await assert.rejects(openAiCompatPort({ apiKey: 'k', baseUrl: BASE, fetch: down }).embed(['a']), kind('offline'));
});

test('no key fails as auth without touching the network', async () => {
  const { sent, fetch } = stub(200, {});
  await assert.rejects(openAiCompatPort({ apiKey: '  ', baseUrl: BASE, fetch }).answer('q', []), kind('auth'));
  assert.equal(sent.length, 0);
});

test('a key that is refused or at its limit hands over to the next, and the next call starts there', async () => {
  for (const status of [401, 403, 429]) {
    const seen: string[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      const key = (init.headers as Record<string, string>).Authorization;
      seen.push(key);
      return new Response(JSON.stringify(key === 'Bearer a' ? {} : { data: [{ index: 0, embedding: [1, 0] }] }), { status: key === 'Bearer a' ? status : 200 });
    }) as unknown as typeof globalThis.fetch;
    const ai = openAiCompatPort({ apiKey: ['a', 'b'], baseUrl: BASE, fetch });
    await ai.embed(['x']);
    await ai.embed(['x']);
    assert.deepEqual(seen, ['Bearer a', 'Bearer b', 'Bearer b'], String(status));
  }
});

test('Gemini answering 400 for an unknown key counts as refused; any other 400 stops at once', async () => {
  const seen: string[] = [];
  const reply = (key: string, bad: string) => (key === 'Bearer a' ? new Response(bad, { status: 400 }) : new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }] }), { status: 200 }));
  const fetchWith = (bad: string) => (async (_u: string, init: RequestInit) => { const k = (init.headers as Record<string, string>).Authorization; seen.push(k); return reply(k, bad); }) as unknown as typeof globalThis.fetch;
  await openAiCompatPort({ apiKey: ['a', 'b'], baseUrl: BASE, fetch: fetchWith('API key not valid. Please pass a valid API key.') }).embed(['x']);
  assert.deepEqual(seen, ['Bearer a', 'Bearer b']);
  seen.length = 0;
  await assert.rejects(openAiCompatPort({ apiKey: ['a', 'b'], baseUrl: BASE, fetch: fetchWith('bad body') }).embed(['x']), kind('bad_request'));
  assert.deepEqual(seen, ['Bearer a']);
});

test('every key out: a limit is reported over a refusal, and a server error does not move to another key', async () => {
  const run = (statuses: Record<string, number>) => {
    const seen: string[] = [];
    const fetch = (async (_u: string, init: RequestInit) => { const k = (init.headers as Record<string, string>).Authorization.slice(7); seen.push(k); return new Response('{}', { status: statuses[k] }); }) as unknown as typeof globalThis.fetch;
    return { seen, ai: openAiCompatPort({ apiKey: ['a', 'b'], baseUrl: BASE, fetch }) };
  };
  const mixed = run({ a: 401, b: 429 });
  await assert.rejects(mixed.ai.embed(['x']), kind('rate'));
  const refused = run({ a: 401, b: 403 });
  await assert.rejects(refused.ai.embed(['x']), (e: unknown) => e instanceof AiError && e.kind === 'auth' && /every API key/.test(e.message));
  const broken = run({ a: 500, b: 200 });
  await assert.rejects(broken.ai.embed(['x']), kind('server'));
  assert.deepEqual(broken.seen, ['a']);
});

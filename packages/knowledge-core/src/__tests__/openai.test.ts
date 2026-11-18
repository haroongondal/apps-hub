import test from 'node:test';
import assert from 'node:assert/strict';

import { openAiPort } from '../openai.ts';
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

test('embed asks for 512 dimensions and returns vectors in input order', async () => {
  const { sent, fetch } = stub(200, { data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] });
  const ai = openAiPort({ apiKey: ' sk-test ', baseUrl: 'https://example.test/v1/', fetch });
  const out = await ai.embed(['a', 'b']);
  assert.deepEqual(out.map((v) => [...v]), [[1, 0], [0, 1]]);
  assert.equal(sent[0].url, 'https://example.test/v1/embeddings');
  assert.equal(sent[0].headers.Authorization, 'Bearer sk-test');
  assert.deepEqual(sent[0].body, { model: 'text-embedding-3-small', input: ['a', 'b'], dimensions: 512 });
});

test('extract sends a strict JSON schema and returns the parsed reply', async () => {
  const graph = { concepts: [], atoms: [], relations: [] };
  const { sent, fetch } = stub(200, { choices: [{ message: { content: JSON.stringify(graph) } }] });
  const out = await openAiPort({ apiKey: 'k', fetch }).extract(['first', 'second']);
  assert.deepEqual(out, graph);
  const body = sent[0].body as { response_format: { json_schema: { strict: boolean } }; messages: { content: string }[] };
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.messages[1].content, '[0] first\n\n[1] second');
});

test('answer numbers the sources from 1', async () => {
  const { sent, fetch } = stub(200, { choices: [{ message: { content: 'It is [1].' } }] });
  assert.equal(await openAiPort({ apiKey: 'k', fetch }).answer('Why?', ['A: x']), 'It is [1].');
  const body = sent[0].body as { messages: { content: string }[] };
  assert.equal(body.messages[1].content, '[1] A: x\n\nQuestion: Why?');
});

test('transcribe uploads the file and keeps segment timestamps', async () => {
  const { sent, fetch } = stub(200, { text: 'hi there', segments: [{ start: 0, end: 1.5, text: ' hi' }, { start: 1.5, end: 3, text: ' there' }] });
  const out = await openAiPort({ apiKey: 'k', fetch }).transcribe(new Blob(['audio'], { type: 'audio/m4a' }));
  assert.deepEqual(out, [
    { text: 'hi', locator: { startSec: 0, endSec: 1.5 } },
    { text: 'there', locator: { startSec: 1.5, endSec: 3 } },
  ]);
  assert.ok(sent[0].body instanceof FormData);
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
    await assert.rejects(openAiPort({ apiKey: 'k', fetch: stub(status, 'nope').fetch }).embed(['a']), kind(k));
  }
  await assert.rejects(openAiPort({ apiKey: 'k', fetch: stub(200, 'not json').fetch }).embed(['a']), kind('bad_reply'));
  const down = (async () => {
    throw new TypeError('Network request failed');
  }) as unknown as typeof fetch;
  await assert.rejects(openAiPort({ apiKey: 'k', fetch: down }).embed(['a']), kind('offline'));
});

test('no key fails as auth without touching the network', async () => {
  const { sent, fetch } = stub(200, {});
  await assert.rejects(openAiPort({ apiKey: '  ', fetch }).answer('q', []), kind('auth'));
  assert.equal(sent.length, 0);
});

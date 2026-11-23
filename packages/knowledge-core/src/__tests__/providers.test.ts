import test from 'node:test';
import assert from 'node:assert/strict';

import { AiError } from '../types.ts';
import { EMBED_TAG, GEMINI_URL, GROQ_URL, nexusPort } from '../providers.ts';

interface Sent {
  url: string;
  auth: string;
  body: Record<string, unknown> | null;
}

/** Answers each key with its own status; a key not in `status` gets a good reply. */
function stubFetch(status: Record<string, number> = {}) {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const auth = (init.headers as Record<string, string>).Authorization;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    sent.push({ url, auth, body });
    const code = status[auth] ?? 200;
    if (code !== 200) return new Response('{"error":"nope"}', { status: code });
    const reply = url.endsWith('/embeddings')
      ? { data: [{ index: 0, embedding: [1, 0] }] }
      : url.endsWith('/audio/transcriptions')
        ? { text: 'hello', segments: [{ start: 0, end: 1, text: 'hello' }] }
        : { choices: [{ message: { content: '{"ok":true}' } }] };
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { sent, fetch };
}

test('embeddings and images go to Gemini; answers, graphs and transcripts go to Groq', async () => {
  const { sent, fetch } = stubFetch();
  const ai = nexusPort({ gemini: ['gem-key'], groq: ['groq-key'], fetch });
  await ai.embed(['a']);
  await ai.readImage('AAAA');
  await ai.extract(['segment']);
  await ai.answer('q', ['source']);
  await ai.transcribe(new Blob(['audio'], { type: 'audio/mp4' }));

  assert.deepEqual(
    sent.map((s) => [s.url, s.auth, s.body?.model]),
    [
      [`${GEMINI_URL}embeddings`, 'Bearer gem-key', 'gemini-embedding-001'],
      [`${GEMINI_URL}chat/completions`, 'Bearer gem-key', 'gemini-3.5-flash-lite'],
      [`${GROQ_URL}chat/completions`, 'Bearer groq-key', 'openai/gpt-oss-120b'],
      [`${GROQ_URL}chat/completions`, 'Bearer groq-key', 'openai/gpt-oss-120b'],
      [`${GROQ_URL}audio/transcriptions`, 'Bearer groq-key', undefined],
    ],
  );
  assert.equal(sent[2].body?.reasoning_effort, 'low');
  assert.deepEqual(sent[2].body?.response_format, { type: 'json_object' });
  assert.equal(EMBED_TAG, 'gemini-embedding-001@512');
});

test('a rate-limited Groq key hands the call to the next Groq key', async () => {
  const { sent, fetch } = stubFetch({ 'Bearer groq-1': 429 });
  const reply = await nexusPort({ gemini: ['gem'], groq: ['groq-1', 'groq-2'], fetch }).complete('sys', 'user', true);
  assert.equal(reply, '{"ok":true}');
  assert.deepEqual(
    sent.map((s) => s.auth),
    ['Bearer groq-1', 'Bearer groq-2'],
  );
});

test('chat falls back from Groq to Gemini when every Groq key fails', async () => {
  const { sent, fetch } = stubFetch({ 'Bearer groq-1': 401, 'Bearer groq-2': 503 });
  const reply = await nexusPort({ gemini: ['gem'], groq: ['groq-1', 'groq-2'], fetch }).complete('sys', 'user', false);
  assert.equal(reply, '{"ok":true}');
  assert.deepEqual(
    sent.map((s) => [s.url, s.auth]),
    [
      [`${GROQ_URL}chat/completions`, 'Bearer groq-1'],
      [`${GROQ_URL}chat/completions`, 'Bearer groq-2'],
      [`${GEMINI_URL}chat/completions`, 'Bearer gem'],
    ],
  );
  assert.equal(sent[2].body?.model, 'gemini-3.5-flash-lite');
  assert.equal(sent[2].body?.reasoning_effort, undefined);
});

test('transcription and embeddings never fall back to the other provider', async () => {
  const { sent, fetch } = stubFetch({ 'Bearer groq': 429, 'Bearer gem': 429 });
  const ai = nexusPort({ gemini: ['gem'], groq: ['groq'], fetch });
  await assert.rejects(ai.transcribe(new Blob(['a'])), (err) => err instanceof AiError && err.kind === 'rate');
  await assert.rejects(ai.embed(['a']), (err) => err instanceof AiError && err.kind === 'rate');
  assert.deepEqual(
    sent.map((s) => s.url),
    [`${GROQ_URL}audio/transcriptions`, `${GEMINI_URL}embeddings`],
  );
});

test('with no usable key, every call fails with an auth error that pauses the queue', async () => {
  const { sent, fetch } = stubFetch();
  const ai = nexusPort({ gemini: ['  '], groq: [], fetch });
  await assert.rejects(ai.answer('q', []), (err) => err instanceof AiError && err.kind === 'auth');
  assert.equal(sent.length, 0);
});

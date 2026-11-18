import test from 'node:test';
import assert from 'node:assert/strict';

import { EMBED_TAG, GEMINI_URL, GROQ_URL, nexusPort } from '../providers.ts';

test('embeddings and images go to Gemini; answers, graphs and transcripts go to Groq', async () => {
  const sent: { url: string; auth: string; body: Record<string, unknown> | null }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    sent.push({ url, auth: (init.headers as Record<string, string>).Authorization, body });
    const reply = url.endsWith('/embeddings')
      ? { data: [{ index: 0, embedding: [1, 0] }] }
      : url.endsWith('/audio/transcriptions')
        ? { text: 'hello', segments: [{ start: 0, end: 1, text: 'hello' }] }
        : { choices: [{ message: { content: '{}' } }] };
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as unknown as typeof globalThis.fetch;

  const ai = nexusPort({ gemini: 'gem-key', groq: 'groq-key', fetch });
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

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  AiHubError,
  MAX_TEXTS,
  canFallBack,
  chatJson,
  decodeVector,
  embedJsons,
  errorFrom,
  mergeEmbeds,
  parseChat,
  parseEmbed,
  parseTranscribe,
  transcribeJson,
  type ChatMessage,
} from '../contract.ts';

const fixture = JSON.parse(fs.readFileSync(new URL('../../fixtures/contract.json', import.meta.url), 'utf8'));
const req = fixture.requests;
const reply = (name: string) => JSON.stringify(fixture.replies[name]);

test('builders write exactly the requests the hub is tested against', () => {
  const messages = [
    { role: 'system' as const, content: 'Be brief.' },
    { role: 'user' as const, content: 'Hi' },
  ];
  const tools = [{ name: 'look', description: 'Look something up', parameters: { type: 'object' } }];
  assert.deepEqual(JSON.parse(chatJson('chat', { messages, tools, maxTokens: 300 }, 'chat-1')), req.chat);
  const vision = { messages: [{ role: 'user' as const, content: 'What is this?' }], image: '/x.jpg', mime: 'image/jpeg' };
  assert.deepEqual(JSON.parse(chatJson('vision', vision, 'vision-1')), req.vision);
  assert.deepEqual(JSON.parse(embedJsons({ texts: ['a', 'b'] }, () => 'embed-1')[0]), req.embed);
  assert.deepEqual(JSON.parse(embedJsons({ texts: ['a'], dimensions: 768 }, () => 'embed-2')[0]), req.embedDimensions);
  const audio = { file: '/n.m4a', fileName: 'note.m4a', mime: 'audio/mp4' };
  assert.deepEqual(JSON.parse(transcribeJson(audio, 'audio-1')), req.transcribe);
  assert.deepEqual(JSON.parse(transcribeJson({ ...audio, segments: true }, 'audio-2')), req.transcribeSegments);
});

test('only requests that use dimensions or segments ask for apiVersion 2', () => {
  for (const name of ['chat', 'vision', 'embed', 'transcribe']) assert.equal(req[name].apiVersion, 1, name);
  for (const name of ['embedDimensions', 'transcribeSegments']) assert.equal(req[name].apiVersion, 2, name);
});

test('apiVersion 3 is asked for only by a request that needs it', () => {
  const messages: ChatMessage[] = [{ role: 'user', content: 'Hi' }];
  const version = (extra: object, msgs: ChatMessage[] = messages) => JSON.parse(chatJson('chat', { messages: msgs, ...extra }, 'r')).apiVersion;
  assert.equal(version({}), 1);
  assert.equal(version({ toolChoice: 'required' }), 3);
  assert.equal(version({ reasoningEffort: 'low' }), 3);
  assert.equal(version({ service: 'gemini' }), 3);
  assert.equal(version({ wantRaw: true }), 3);
  assert.equal(version({ wantRaw: false }), 1);
  const picture: ChatMessage = { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } }] };
  assert.equal(version({}, [picture]), 3);
  assert.equal(JSON.parse(chatJson('chat', { messages, wantRaw: true }, 'r')).toolChoice, undefined);
});

test('the version 3 chat request and reply match the hub fixture', () => {
  const r = req.chatV3;
  const built = chatJson('chat', { messages: r.messages, tools: r.tools, maxTokens: 300, toolChoice: 'required', reasoningEffort: 'low', service: 'gemini' }, 'chat-3');
  assert.deepEqual(JSON.parse(built), r);
  const out = parseChat(reply('chatV3'));
  assert.deepEqual(out.raw, fixture.replies.chatV3.raw);
  assert.equal(out.service, 'gemini');
  assert.equal(out.toolCalls[0].name, 'look');
});

test('a version 2 reply has no raw and still parses, and extra reply fields are ignored', () => {
  const v2 = parseChat(reply('chat'));
  assert.equal(v2.raw, undefined);
  assert.equal(v2.service, undefined);
  const extra = parseChat(JSON.stringify({ ...fixture.replies.chat, somethingNew: { a: 1 } }));
  assert.deepEqual(extra, v2);
  // A raw that is not an assistant message is dropped, never passed on.
  assert.equal(parseChat(JSON.stringify({ ...fixture.replies.chat, raw: { role: 'user' } })).raw, undefined);
});

test('embed splits texts into batches of at most 8, each with its own id', () => {
  const texts = Array.from({ length: 19 }, (_, i) => `t${i}`);
  let n = 0;
  const batches = embedJsons({ texts }, () => `e${n++}`).map((j) => JSON.parse(j));
  assert.deepEqual(
    batches.map((b) => b.texts.length),
    [MAX_TEXTS, MAX_TEXTS, 3],
  );
  assert.deepEqual(batches.flatMap((b) => b.texts), texts);
  assert.deepEqual(
    batches.map((b) => b.requestId),
    ['e0', 'e1', 'e2'],
  );
  assert.throws(() => embedJsons({ texts: [] }), (e: AiHubError) => e.kind === 'invalid');
});

test('a bad requestId is refused before it reaches the hub', () => {
  assert.throws(() => chatJson('chat', { messages: [{ role: 'user', content: 'x' }] }, 'a b'), (e: AiHubError) => e.kind === 'invalid');
  assert.match(JSON.parse(chatJson('chat', { messages: [{ role: 'user', content: 'x' }] })).requestId, /^[A-Za-z0-9_-]{1,64}$/);
});

test('replies from the hub parse into typed results', () => {
  const chat = parseChat(reply('chat'));
  assert.equal(chat.text, 'hello');
  assert.deepEqual(chat.toolCalls, [{ id: 'c1', name: 'look', args: { q: 'a' } }]);
  assert.deepEqual(chat.usage, { inputTokens: 10, cachedTokens: 2, outputTokens: 5 });
  assert.equal(chat.model, 'gemini-3.5-flash-lite');

  const embed = parseEmbed(reply('embed'), 2);
  assert.equal(embed.dims, 2);
  assert.deepEqual(Array.from(embed.vectors[0]), [0.5, 1]);
  assert.deepEqual(Array.from(embed.vectors[1]), [-2, 0.25]);

  assert.deepEqual(parseTranscribe(reply('transcribe'), false), { text: 'hi' });
  assert.deepEqual(parseTranscribe(reply('transcribeSegments'), true), fixture.replies.transcribeSegments);
});

test('a reply that does not match the contract is a provider error, never a silent success', () => {
  const bad = (f: () => unknown) => assert.throws(f, (e: AiHubError) => e instanceof AiHubError && e.kind === 'provider-error');
  bad(() => parseChat('not json'));
  bad(() => parseChat('{"text":"x"}'));
  bad(() => parseEmbed(reply('embed'), 3));
  bad(() => parseEmbed('{"vectorsB64":["AAAA"],"dims":2,"model":"m"}', 1));
  bad(() => parseEmbed('{"vectorsB64":["AAA"],"dims":0,"model":"m"}', 1));
  bad(() => parseTranscribe(reply('transcribe'), true));
  bad(() => parseTranscribe('{"text":"x","segments":[{"start":"0","end":1,"text":"x"}]}', true));
  bad(() => mergeEmbeds([]));
  bad(() => mergeEmbeds([{ vectors: [], dims: 2, model: 'm' }, { vectors: [], dims: 3, model: 'm' }]));
});

test('embed batches merge in order', () => {
  const a = { vectors: [decodeVector(fixture.replies.embed.vectorsB64[0])], dims: 2, model: 'm' };
  const b = { vectors: [decodeVector(fixture.replies.embed.vectorsB64[1])], dims: 2, model: 'm' };
  assert.deepEqual(
    mergeEmbeds([a, b]).vectors.map((v) => Array.from(v)),
    [
      [0.5, 1],
      [-2, 0.25],
    ],
  );
});

test('rejections become typed errors, and only some kinds mean use the app key', () => {
  const rejected = Object.assign(new Error("Call to function 'AiHubClient.submit' has been rejected.\n→ Caused by: Turn AI on for this app in AI hub."), {
    code: 'not-allowed',
  });
  const e = errorFrom(rejected);
  assert.equal(e.kind, 'not-allowed');
  assert.equal(e.message, 'Turn AI on for this app in AI hub.');
  assert.equal(errorFrom(Object.assign(new Error('x'), { code: 'ERR_SOMETHING' })).kind, 'provider-error');
  assert.equal(errorFrom('boom').kind, 'provider-error');
  assert.deepEqual(
    (['hub-missing', 'not-allowed', 'version', 'no-key', 'too-large', 'invalid', 'busy', 'cancelled', 'timeout', 'provider-error'] as const).filter(canFallBack),
    ['hub-missing', 'not-allowed', 'version', 'no-key'],
  );
});

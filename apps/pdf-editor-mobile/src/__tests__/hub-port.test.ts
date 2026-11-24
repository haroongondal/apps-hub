import assert from 'node:assert/strict';
import test from 'node:test';

import { hubComplete, hubStatus, jsonObjectIn, type HubTransport } from '../nexus/hub-port.ts';

const transport = (over: Partial<HubTransport>): HubTransport => ({
  submit: async () => JSON.stringify({ text: 'ok' }),
  status: async () => JSON.stringify({ services: { groq: { keys: 1 }, gemini: { keys: 0 } } }),
  ...over,
});

test('hubComplete sends a foreground chat request and returns the text', async () => {
  let sent: any;
  const complete = hubComplete(
    transport({
      submit: async (json) => {
        sent = JSON.parse(json);
        return JSON.stringify({ text: '{"name":"A"}', toolCalls: [], usage: {}, model: 'm' });
      },
    }),
    () => 'cv-test-1',
  );
  assert.equal(await complete('be brief', 'hello', true), '{"name":"A"}');
  assert.equal(sent.apiVersion, 1);
  assert.equal(sent.job, 'chat');
  assert.equal(sent.priority, 'foreground');
  assert.equal(sent.requestId, 'cv-test-1');
  assert.deepEqual(sent.messages, [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hello' }]);
  assert.ok(sent.maxTokens >= 1 && sent.maxTokens <= 8192);
});

test('the default request id is one the hub accepts', async () => {
  let id = '';
  await hubComplete(transport({ submit: async (json) => ((id = JSON.parse(json).requestId), JSON.stringify({ text: 'x' })) }))('s', 'u', false);
  assert.match(id, /^[A-Za-z0-9_-]{1,64}$/);
});

test('hubComplete rejects an empty or unreadable reply and passes the hub error through', async () => {
  await assert.rejects(hubComplete(transport({ submit: async () => JSON.stringify({ text: '  ' }) }))('s', 'u', true), /no text/);
  await assert.rejects(hubComplete(transport({ submit: async () => 'not json' }))('s', 'u', true), /could not read/);
  await assert.rejects(
    hubComplete(transport({ submit: async () => Promise.reject(new Error('AI hub is not installed. Install it from the Store.')) }))('s', 'u', true),
    /not installed/,
  );
});

test('hubStatus is ok with a key on either service, and says what is missing otherwise', async () => {
  assert.deepEqual(await hubStatus(transport({})), { ok: true });
  assert.deepEqual(await hubStatus(transport({ status: async () => JSON.stringify({ services: { gemini: { keys: 2 } } }) })), { ok: true });
  const none = await hubStatus(transport({ status: async () => JSON.stringify({ services: { groq: { keys: 0 }, gemini: { keys: 0 } } }) }));
  assert.equal(none.ok, false);
  const gone = await hubStatus(transport({ status: async () => Promise.reject(new Error('AI hub is not installed. Install it from the Store.')) }));
  assert.deepEqual(gone, { ok: false, message: 'AI hub is not installed. Install it from the Store.' });
});

test('jsonObjectIn takes the object out of a code fence or surrounding prose and leaves plain replies alone', () => {
  assert.equal(jsonObjectIn('{"a":1}'), '{"a":1}');
  assert.equal(jsonObjectIn('```json\n{"a":{"b":2}}\n```'), '{"a":{"b":2}}');
  assert.equal(jsonObjectIn('Here is the CV:\n{"a":1}\nDone.'), '{"a":1}');
  assert.equal(jsonObjectIn('no object here'), 'no object here');
});

test('hubComplete extracts the object only when asked for JSON', async () => {
  const fenced = transport({ submit: async () => JSON.stringify({ text: '```json\n{"name":"A"}\n```' }) });
  assert.equal(await hubComplete(fenced)('s', 'u', true), '{"name":"A"}');
  assert.equal(await hubComplete(fenced)('s', 'u', false), '```json\n{"name":"A"}\n```');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceOf, labelOf, requestFor, createSender, SERVICES } from '../ai-keys.js';

const G = 'gsk_aaaa1111', M = 'AIzabbbb2222', M2 = 'AIzacccc3333';
const ok = { ok: true, status: 200, json: { id: 1 } };
const status = s => ({ ok: false, status: s });
// a fake network: answers by key, records which keys were tried
const net = answers => { const tried = []; return { tried, post: async (url, key, body) => { tried.push(key); return answers[key]; } }; };

test('the key prefix names the service', () => {
  assert.equal(serviceOf(G), 'groq');
  assert.equal(serviceOf(M), 'gemini');
  assert.equal(serviceOf('sk-ant-nope'), null);
  assert.equal(labelOf(G), 'Groq key ending 1111');
});

test('Gemini gets its model and max_tokens, no reasoning_effort; Groq keeps the page body', () => {
  const body = { messages: [], max_completion_tokens: 8000, reasoning_effort: 'low' };
  assert.deepEqual(requestFor('gemini', body), { messages: [], max_tokens: 8000, model: SERVICES.gemini.model });
  assert.deepEqual(requestFor('groq', body), { ...body, model: SERVICES.groq.model });
});

for (const s of [429, 401, 403]) {
  test(`a ${s} hands over to the next key, and the next call starts there`, async () => {
    const n = net({ [G]: status(s), [M]: ok });
    const send = createSender();
    assert.equal(await send([G, M], {}, n.post), ok);
    assert.deepEqual(n.tried, [G, M]);
    n.tried.length = 0;
    await send([G, M], {}, n.post);
    assert.deepEqual(n.tried, [M]);
  });
}

test('Gemini answering 400 for an unknown key counts as refused', async () => {
  const n = net({ [M]: { ok: false, status: 400, json: { error: { message: 'API key not valid. Please pass a valid API key.' } } }, [M2]: ok });
  assert.equal(await createSender()([M, M2], {}, n.post), ok);
});

test('any other error stops at once: a different key will not fix it', async () => {
  for (const reply of [status(500), status(400), { ok: false, status: 0, error: 'offline' }]) {
    const n = net({ [G]: reply, [M]: ok });
    assert.equal(await createSender()([G, M], {}, n.post), reply);
    assert.deepEqual(n.tried, [G]);
  }
});

test('every key out: a limit is answered over a refusal', async () => {
  const limited = status(429), denied = status(401);
  assert.equal(await createSender()([G, M], {}, net({ [G]: denied, [M]: limited }).post), limited);
  assert.equal(await createSender()([G, M], {}, net({ [G]: denied, [M]: status(403) }).post), denied);
});

test('no keys', async () => {
  assert.deepEqual(await createSender()([], {}, net({}).post), { ok: false, status: 0, error: 'nokey' });
});

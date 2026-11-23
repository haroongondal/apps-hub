import test from 'node:test';
import assert from 'node:assert/strict';
import { AiHubError } from 'ai-hub-client/src/contract.ts';
import type { ChatReply, ChatRequest, ErrorKind } from 'ai-hub-client/src/contract.ts';
import { createAiRouter, hubRequestFor, replyFromHub, replyFromHubError, type AiSource } from '../editor/ai-hub-route.ts';
import type { AiReply } from '../editor/ai-keys.ts';
// @ts-expect-error plain JS shared with the page
import AiLayout from '../../../../packages/design-editor-engine/ai-layout.js';

const usage = { inputTokens: 1, cachedTokens: 0, outputTokens: 1 };
const reply = (r: Partial<ChatReply>): ChatReply => ({ text: null, toolCalls: [], usage, model: 'm', ...r });
// what ai.ts's aiSanitise leaves of the page's request
const sanitised = () => { const { model: _m, ...rest } = AiLayout.buildRequest('A poster', 800, 600); return rest as Record<string, unknown>; };
const ownOk: AiReply = { ok: true, status: 200, json: { own: true } };

function setup(hub: (req: ChatRequest) => Promise<ChatReply>, own: AiReply = ownOk) {
  const seen = { hub: [] as ChatRequest[], own: 0, source: [] as AiSource[], now: 0 };
  const route = createAiRouter({
    hub: { chat: async (r) => (seen.hub.push(r), hub(r)) },
    own: async () => (seen.own++, own),
    record: (s) => seen.source.push(s),
    now: () => seen.now,
  });
  return { route, seen };
}
const fail = (kind: ErrorKind) => async (): Promise<ChatReply> => { throw new AiHubError(kind, 'x'); };

test('the layout request becomes a hub chat job: messages, flat tool, 8000 tokens, no model or effort', () => {
  const req = hubRequestFor(sanitised())!;
  assert.equal(req.messages.length, 2);
  assert.equal(req.tools?.[0].name, 'make_layout');
  assert.equal(req.tools?.[0].description, 'Place the elements of the design on the page.');
  assert.equal(req.maxTokens, 8000);
  assert.deepEqual(Object.keys(req).sort(), ['maxTokens', 'messages', 'tools']);
});

test('what the hub cannot honour stays on the own key', () => {
  assert.equal(hubRequestFor({ ...sanitised(), response_format: { type: 'json_object' } }), null);
  assert.equal(hubRequestFor({ ...sanitised(), temperature: 0 }), null);
  assert.equal(hubRequestFor({ ...sanitised(), tool_choice: { type: 'function' } }), null);
  assert.equal(hubRequestFor({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:x' } }] }] }), null);
  assert.equal(hubRequestFor({ messages: [{ role: 'user', content: 'é'.repeat(300 * 1024) }] }), null); // 600 KB in UTF-8
  assert.notEqual(hubRequestFor({ messages: [{ role: 'user', content: 'é'.repeat(200 * 1024) }] }), null); // 400 KB
});

test('text only reply', () => {
  const r = replyFromHub(reply({ text: 'Hi' }));
  assert.deepEqual(r.json, { choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }], model: 'm' });
});

test('tool calls come back as OpenAI tool_calls with a JSON string, and the page parses them', () => {
  const layout = { bg: '#ffffff', items: [{ type: 'text', x: 0.5, y: 0.5, w: 0.5, h: 0.2, text: 'Hello' }] };
  const r = replyFromHub(reply({ toolCalls: [{ id: '', name: 'make_layout', args: layout }] }));
  const message = (r.json as { choices: { message: { tool_calls: { id: string; function: { arguments: string } }[] } }[] }).choices[0].message;
  assert.equal(message.tool_calls[0].id, 'call_0');
  assert.deepEqual(JSON.parse(message.tool_calls[0].function.arguments), layout);
  assert.equal(AiLayout.parseReply(r.json).items[0].text, 'Hello');
});

test('an empty reply is a reply with no content, which the page words itself', () => {
  const r = replyFromHub(reply({}));
  assert.equal(r.ok, true);
  assert.throws(() => AiLayout.parseReply(r.json), /no layout/);
});

test('hub errors that are not a fall-back map to the statuses the page words', () => {
  assert.deepEqual(replyFromHubError('busy'), { ok: false, status: 429 });
  assert.deepEqual(replyFromHubError('timeout'), { ok: false, status: 0, error: 'timeout' });
  assert.deepEqual(replyFromHubError('provider-error'), { ok: false, status: 502 });
  for (const k of ['too-large', 'invalid', 'cancelled'] as const) assert.deepEqual(replyFromHubError(k), { ok: false, status: 0, error: 'bad' });
});

test('hub served: the own key is not called and the source is hub', async () => {
  const { route, seen } = setup(async () => reply({ text: 'ok' }));
  const r = await route(sanitised());
  assert.equal(r.ok, true);
  assert.equal(seen.own, 0);
  assert.deepEqual(seen.source, ['hub']);
});

for (const kind of ['hub-missing', 'not-allowed', 'version', 'no-key'] as const) {
  test(`${kind} from the hub: the own key is used exactly once`, async () => {
    const { route, seen } = setup(fail(kind));
    assert.equal(await route(sanitised()), ownOk);
    assert.equal(seen.own, 1);
    assert.deepEqual(seen.source, ['own']);
  });
}

test('a failure that is not a fall-back does not reach the own key', async () => {
  const { route, seen } = setup(fail('busy'));
  assert.deepEqual(await route(sanitised()), { ok: false, status: 429 });
  assert.equal(seen.own, 0);
  assert.deepEqual(seen.source, []);
});

test('an error that is not the hub client is a plain failure, not a silent fall-back', async () => {
  const { route, seen } = setup(async () => { throw new Error('boom'); });
  assert.deepEqual(await route(sanitised()), { ok: false, status: 0, error: 'bad' });
  assert.equal(seen.own, 0);
});

test('not-allowed is remembered for ten minutes, then asked again', async () => {
  const { route, seen } = setup(fail('not-allowed'));
  await route(sanitised());
  seen.now = 9 * 60_000;
  await route(sanitised());
  assert.equal(seen.hub.length, 1);
  seen.now = 10 * 60_000 + 1;
  await route(sanitised());
  assert.equal(seen.hub.length, 2);
  assert.equal(seen.own, 3);
});

test('hub-missing is asked again on the next call', async () => {
  const { route, seen } = setup(fail('hub-missing'));
  await route(sanitised());
  await route(sanitised());
  assert.equal(seen.hub.length, 2);
});

test('a body the hub cannot carry goes straight to the own key', async () => {
  const { route, seen } = setup(async () => reply({ text: 'no' }));
  await route({ ...sanitised(), response_format: { type: 'json_object' } });
  assert.equal(seen.hub.length, 0);
  assert.equal(seen.own, 1);
});

test('no hub and no key records none; a refused key records nothing', async () => {
  const none = setup(fail('hub-missing'), { ok: false, status: 0, error: 'nokey' });
  await none.route(sanitised());
  assert.deepEqual(none.seen.source, ['none']);
  const refused = setup(fail('hub-missing'), { ok: false, status: 401 });
  await refused.route(sanitised());
  assert.deepEqual(refused.seen.source, []);
});

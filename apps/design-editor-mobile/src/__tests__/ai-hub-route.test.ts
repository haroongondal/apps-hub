import test from 'node:test';
import assert from 'node:assert/strict';
import { AiHubError } from 'ai-hub-client/src/contract.ts';
import type { ChatReply, ChatRequest, ErrorKind } from 'ai-hub-client/src/contract.ts';
import { createAiRouter, hubRequestFor, replyFromHub, replyFromHubError, type AiSource } from '../editor/ai-hub-route.ts';
// @ts-expect-error plain JS shared with the page
import AiLayout from '../../../../packages/design-editor-engine/ai-layout.js';

const usage = { inputTokens: 1, cachedTokens: 0, outputTokens: 1 };
const reply = (r: Partial<ChatReply>): ChatReply => ({ text: null, toolCalls: [], usage, model: 'm', ...r });
// what ai.ts's aiSanitise leaves of the page's request
const sanitised = () => { const { model: _m, ...rest } = AiLayout.buildRequest('A poster', 800, 600); return rest as Record<string, unknown>; };

function setup(hub: (req: ChatRequest) => Promise<ChatReply>) {
  const seen = { hub: [] as ChatRequest[], source: [] as AiSource[], served: 0 };
  const route = createAiRouter({
    hub: { chat: async (r) => (seen.hub.push(r), hub(r)) },
    record: (s) => seen.source.push(s),
    served: () => void seen.served++,
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

test('what the hub cannot honour is refused, not sent anywhere else', () => {
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

test('hub failures map to the statuses and errors the page words, and never carry the hub text', () => {
  assert.deepEqual(replyFromHubError('busy'), { ok: false, status: 429 });
  assert.deepEqual(replyFromHubError('timeout'), { ok: false, status: 0, error: 'timeout' });
  assert.deepEqual(replyFromHubError('provider-error'), { ok: false, status: 502 });
  for (const k of ['too-large', 'invalid', 'cancelled'] as const) assert.deepEqual(replyFromHubError(k), { ok: false, status: 0, error: 'bad' });
  for (const k of ['hub-missing', 'version'] as const) assert.deepEqual(replyFromHubError(k), { ok: false, status: 0, error: 'hubmissing' });
  assert.deepEqual(replyFromHubError('not-allowed'), { ok: false, status: 0, error: 'notallowed' });
  assert.deepEqual(replyFromHubError('no-key'), { ok: false, status: 0, error: 'nokey' });
});

test('hub served: the source is hub', async () => {
  const { route, seen } = setup(async () => reply({ text: 'ok' }));
  const r = await route(sanitised());
  assert.equal(r.ok, true);
  assert.deepEqual(seen.source, ['hub']);
});

for (const [kind, error] of [['hub-missing', 'hubmissing'], ['version', 'hubmissing'], ['not-allowed', 'notallowed'], ['no-key', 'nokey']] as const) {
  test(`${kind} from the hub: one hub call, the ${error} state, source none`, async () => {
    const { route, seen } = setup(fail(kind));
    assert.deepEqual(await route(sanitised()), { ok: false, status: 0, error });
    assert.equal(seen.hub.length, 1);
    assert.deepEqual(seen.source, ['none']);
  });
}

test('a failure that is a plain message leaves the source alone', async () => {
  const { route, seen } = setup(fail('busy'));
  assert.deepEqual(await route(sanitised()), { ok: false, status: 429 });
  assert.deepEqual(seen.source, []);
});

test('an error that is not the hub client is a plain failure', async () => {
  const { route } = setup(async () => { throw new Error('boom'); });
  assert.deepEqual(await route(sanitised()), { ok: false, status: 0, error: 'bad' });
});

test('every call asks the hub again: a hub installed or allowed a moment ago is used at once', async () => {
  const { route, seen } = setup(fail('not-allowed'));
  await route(sanitised());
  await route(sanitised());
  assert.equal(seen.hub.length, 2);
});

test('a body the hub cannot carry is refused without asking the hub', async () => {
  const { route, seen } = setup(async () => reply({ text: 'no' }));
  assert.deepEqual(await route({ ...sanitised(), response_format: { type: 'json_object' } }), { ok: false, status: 0, error: 'bad' });
  assert.equal(seen.hub.length, 0);
});

test('only a real reply counts as served (it is what lets the old keys go)', async () => {
  const real = setup(async () => reply({ text: 'ok' }));
  await real.route(sanitised());
  const tool = setup(async () => reply({ toolCalls: [{ id: 'a', name: 'make_layout', args: {} }] }));
  await tool.route(sanitised());
  const empty = setup(async () => reply({ text: '   ' }));
  await empty.route(sanitised());
  assert.deepEqual([real.seen.served, tool.seen.served, empty.seen.served], [1, 1, 0]);
});

for (const kind of ['hub-missing', 'not-allowed', 'no-key', 'busy', 'timeout', 'provider-error'] as const) {
  test(`${kind} is never served`, async () => {
    const { route, seen } = setup(fail(kind));
    await route(sanitised());
    assert.equal(seen.served, 0);
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';

import { Library, migrate, serialPort } from '@apps-hub/library-core';

import { Knowledge } from '../knowledge.ts';
import { minutesSegments, type Minutes } from '../minutes.ts';
import { KNOWLEDGE_STEPS } from '../schema.ts';
import type { Segment } from '../types.ts';
import { fakeAi, nodeRawSql, setup } from './helpers.ts';

const seg = (text: string, startSec: number): Segment => ({ text, locator: { startSec, endSec: startSec + 4 } });
const transcript = Array.from({ length: 5 }, (_, i) => seg(`Line ${i} talks about the budget and the launch plan for spring.`, i * 5));
const fast = { retryDelayMs: 0 };
const chatReplying = (o: unknown) => async () => JSON.stringify(o);
const first = {
  summary: 'They agreed the budget. قرّرنا كتابة التقرير',
  decisions: [{ text: 'Postpone the warehouse move', cite: [3] }],
  actions: [{ text: 'Email the landlord', owner: 'Sam', due: 'by Friday', cite: [2] }],
};
const second = {
  summary: 'They talked about hiring.',
  decisions: [{ text: 'Hire a designer', cite: [4] }],
  actions: [],
};

async function withMinutes() {
  const env = await setup();
  const item = await env.add('Meeting', transcript, 'audio');
  await env.drain();
  const embedded: string[] = [];
  const embed = env.ai.embed;
  env.ai.embed = async (texts) => (embedded.push(...texts), embed(texts));
  await env.kn.makeMinutes(item.id, chatReplying(first), fast);
  await env.drain();
  const ids = async (q: string) => (await env.lib.search(q)).map((h) => h.id);
  const chunks = async () =>
    (await env.db.all('SELECT text, locator FROM kn_chunks WHERE item_id = ? ORDER BY seq', [item.id])).map((r) => [r.text, r.locator]);
  return { ...env, item, embedded, ids, chunks };
}

test('minutes become one chunk per summary, decision and action, each at the time of its first cite', () => {
  const m: Minutes = {
    summary: 'S',
    decisions: [{ text: 'D', cites: [{ segment: 3, startSec: 15 }, { segment: 4, startSec: 20 }] }],
    actions: [
      { text: 'A', owner: 'Sam', due: 'by Friday', cites: [{ segment: 2, startSec: 10 }] },
      { text: 'B', owner: null, due: null, cites: [{ segment: 1, startSec: 5 }] },
    ],
  };
  assert.deepEqual(minutesSegments(m), [
    { text: 'Minutes summary: S', locator: null },
    { text: 'Decision: D', locator: { startSec: 15, endSec: 15 } },
    { text: 'Action item: A. Owner: Sam. Due: by Friday', locator: { startSec: 10, endSec: 10 } },
    { text: 'Action item: B', locator: { startSec: 5, endSec: 5 } },
  ]);
});

test('minutes are found by Library search next to the transcript, Arabic and Urdu spelled either way', async () => {
  const { item, ids } = await withMinutes();
  assert.deepEqual(await ids('budget'), [item.id]); // the transcript stays searchable
  assert.deepEqual(await ids('warehouse'), [item.id]);
  assert.deepEqual(await ids('landlord sam'), [item.id]);
  assert.deepEqual(await ids('قررنا'), [item.id]); // without the shadda
  assert.deepEqual(await ids('کتابة'), [item.id]); // Urdu kaf for the Arabic one
});

test('making minutes embeds only the minutes, through the queue, without redoing the graph', async () => {
  const { kn, item, ai, embedded, chunks } = await withMinutes();
  assert.deepEqual(embedded, [
    `Minutes summary: ${first.summary}`,
    'Decision: Postpone the warehouse move',
    'Action item: Email the landlord. Owner: Sam. Due: by Friday',
  ]);
  assert.equal(ai.calls.extract, 1); // only the first run's graph
  const job = await kn.job(item.id);
  assert.deepEqual([job?.stage, job?.status], ['done', 'done']);
  assert.deepEqual((await chunks()).slice(-2), [
    ['Decision: Postpone the warehouse move', '{"startSec":15,"endSec":15}'],
    ['Action item: Email the landlord. Owner: Sam. Due: by Friday', '{"startSec":10,"endSec":10}'],
  ]);
});

test('Ask cites a decision from the minutes with its item and time', async () => {
  const { kn, ai, item } = await withMinutes();
  ai.onAnswer = (_q, sources) => `You chose to wait [${sources.findIndex((s) => s.includes('Postpone')) + 1}].`;
  const answer = await kn.ask('postpone the warehouse move');
  assert.equal(answer.citations.length, 1);
  assert.equal(answer.citations[0].itemId, item.id);
  assert.deepEqual(answer.citations[0].locator, { startSec: 15, endSec: 15 });
  assert.equal(answer.citations[0].text, 'Decision: Postpone the warehouse move');
});

test('making the minutes again replaces them in search and in Ask', async () => {
  const { kn, item, ids, embedded, chunks, drain } = await withMinutes();
  embedded.length = 0;
  await kn.makeMinutes(item.id, chatReplying(second), fast);
  await drain();
  assert.deepEqual(await ids('warehouse'), []);
  assert.deepEqual(await ids('designer'), [item.id]);
  assert.deepEqual(embedded, ['Minutes summary: They talked about hiring.', 'Decision: Hire a designer']);
  const texts = (await chunks()).map(([t]) => t);
  assert.equal(texts.filter((t) => String(t).startsWith('Decision')).join(), 'Decision: Hire a designer');
  assert.equal(texts.some((t) => String(t).includes('landlord')), false);
});

test('a transcript made again keeps the minutes findable', async () => {
  const { kn, item, ids, chunks, drain } = await withMinutes();
  await kn.enqueue(item.id);
  await drain();
  assert.equal((await kn.minutes(item.id))?.stale, false); // same words came back
  assert.deepEqual(await ids('warehouse'), [item.id]);
  assert.ok((await chunks()).some(([t]) => t === 'Decision: Postpone the warehouse move'));
});

test('keeping an item out of Nexus removes its minutes from search and Ask, and keeps the transcript searchable', async () => {
  const { kn, item, ids, chunks } = await withMinutes();
  await kn.exclude(item.id);
  assert.deepEqual(await ids('warehouse'), []);
  assert.deepEqual(await ids('قررنا'), []);
  assert.deepEqual(await ids('budget'), [item.id]);
  assert.deepEqual(await chunks(), []);
});

test('knowledge step 5 keeps the jobs a phone already has', async () => {
  const db = serialPort(nodeRawSql());
  let n = 0;
  const deps = { now: () => 1, newId: () => (++n).toString(36).padStart(16, '0') };
  const lib = await Library.open(db, deps);
  await migrate(db, 'knowledge', KNOWLEDGE_STEPS.slice(0, 4));
  const item = await lib.createItem({ kind: 'audio', title: 'Old' });
  await db.run("INSERT INTO kn_jobs (item_id, stage, status, gen, updated_at) VALUES (?, 'done', 'done', 7, 1)", [item.id]);
  const kn = await Knowledge.open(lib, { ai: fakeAi(), content: { segments: async () => [] }, embedTag: 't', ...deps });
  assert.deepEqual(await db.first('SELECT stage, status, gen, embed_only FROM kn_jobs'), { stage: 'done', status: 'done', gen: 7, embed_only: 0 });
  assert.equal((await kn.job(item.id))?.stage, 'done');
});

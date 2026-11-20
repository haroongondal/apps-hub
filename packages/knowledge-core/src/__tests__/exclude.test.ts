import test from 'node:test';
import assert from 'node:assert/strict';

import { setup } from './helpers.ts';

const payslip = {
  concepts: [{ label: 'Salary', aliases: [] }, { label: 'Event Sourcing', aliases: [] }],
  atoms: [{ text: 'Salary goes to savings', segment: 0, concepts: ['Salary'] }],
  relations: [],
};
const notes = {
  concepts: [{ label: 'Event Sourcing', aliases: [] }],
  atoms: [{ text: 'Events are facts', segment: 0, concepts: ['Event Sourcing'] }],
  relations: [],
};

test('excluding an item removes its ideas, chunks and links, and the concepts only it supported', async () => {
  const { kn, db, ai, add, drain } = await setup();
  ai.onExtract = (segments) => (segments[0].includes('payslip') ? payslip : notes);
  const pay = await add('Pay slip', 'payslip for March');
  const note = await add('Reading notes', 'notes on event sourcing');
  await drain();

  await kn.exclude(pay.id);

  assert.deepEqual((await db.all("SELECT label FROM kn_nodes WHERE type = 'concept' ORDER BY label")).map((r) => r.label), ['Event Sourcing']);
  assert.equal((await db.first('SELECT COUNT(*) AS n FROM kn_chunks WHERE item_id = ?', [pay.id]))?.n, 0);
  assert.equal((await db.first('SELECT COUNT(*) AS n FROM kn_nodes WHERE item_id = ?', [pay.id]))?.n, 0);
  assert.equal((await db.first('SELECT COUNT(*) AS n FROM kn_edges WHERE item_id = ?', [pay.id]))?.n, 0);
  assert.deepEqual(await kn.summary(pay.id), { ideas: 0, links: 0 });
  assert.equal((await kn.ideas(note.id)).length, 1); // the other item keeps its own ideas
  assert.equal(await kn.job(pay.id), null);

  const answer = await kn.ask('salary');
  assert.ok(answer.citations.every((c) => c.itemId !== pay.id));
});

test('an excluded item is never queued again, not even by a bulk re-index', async () => {
  const { kn, lib, add, drain } = await setup();
  const pay = await add('Pay slip', 'payslip for March');
  await drain();
  await kn.exclude(pay.id);
  await lib.createItem({ kind: 'note', title: 'Unqueued' });

  await kn.enqueue(pay.id);
  assert.equal(await kn.enqueueMissing(), 1); // only the unqueued note
  await drain();
  assert.equal(await kn.job(pay.id), null);
  assert.deepEqual([...(await kn.excludedIds())], [pay.id]);
});

test('a graph stage that is running when its item is excluded writes nothing', async () => {
  const { kn, db, ai, add } = await setup();
  const pay = await add('Pay slip', 'payslip for March');
  let excluding: Promise<void> = Promise.resolve();
  ai.onExtract = () => {
    excluding = kn.exclude(pay.id); // the owner excludes it while the model is answering
    return payslip;
  };
  await kn.runNext(); // text
  await kn.runNext(); // embed
  assert.equal(await kn.runNext(), 'ran'); // graph
  await excluding;

  assert.equal((await db.first('SELECT COUNT(*) AS n FROM kn_nodes WHERE item_id = ?', [pay.id]))?.n, 0);
  assert.equal(await kn.job(pay.id), null);
});

test('taking an item back out of the exclusion list indexes it again', async () => {
  const { kn, ai, add, drain } = await setup();
  ai.onExtract = () => payslip;
  const pay = await add('Pay slip', 'payslip for March');
  await drain();
  await kn.exclude(pay.id);
  await kn.include(pay.id);
  await drain();

  assert.deepEqual(await kn.summary(pay.id), { ideas: 1, links: 3 });
  assert.equal((await kn.job(pay.id))?.status, 'done');
  assert.equal(await kn.isExcluded(pay.id), false);
});

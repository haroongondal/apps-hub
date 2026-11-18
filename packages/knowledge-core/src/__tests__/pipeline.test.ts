import test from 'node:test';
import assert from 'node:assert/strict';

import { Knowledge, pruneConcepts } from '../knowledge.ts';
import { AiError } from '../types.ts';
import { setup } from './helpers.ts';

const graph = {
  concepts: [{ label: 'Event Sourcing', aliases: ['ES'] }, { label: 'CQRS', aliases: [] }],
  atoms: [{ text: 'Store events, not state', segment: 1, concepts: ['ES'] }],
  relations: [{ from: 'CQRS', to: 'Event Sourcing', type: 'SUPPORTS', weight: 0.8, evidence: 'pairs well' }],
};

test('an item goes text → embed → graph → done and its parts are stored', async () => {
  const { kn, db, ai, add, drain } = await setup();
  ai.onExtract = () => graph;
  const item = await add('Architecture', [
    { text: 'Intro to patterns', locator: { page: 1 } },
    { text: 'Event sourcing stores events', locator: { page: 2 } },
  ]);
  await drain();

  const job = await kn.job(item.id);
  assert.equal(job?.stage, 'done');
  assert.equal(job?.status, 'done');
  assert.equal((await db.first('SELECT COUNT(*) AS n FROM kn_chunks WHERE item_id = ?', [item.id]))?.n, 2);
  const atom = await db.first("SELECT label, locator FROM kn_nodes WHERE type = 'atom'");
  assert.deepEqual(atom, { label: 'Store events, not state', locator: '{"page":2}' });
  assert.deepEqual(await kn.summary(item.id), { ideas: 1, links: 4 }); // 2 source→concept, 1 atom→concept, 1 relation
  assert.equal(await kn.runNext(), 'idle');
});

test('a voice note’s transcript becomes searchable in the Library', async () => {
  const { lib, add, drain } = await setup();
  const item = await add('Walk', [{ text: 'remember the quarterly budget', locator: { startSec: 3, endSec: 6 } }], 'audio');
  await drain();
  assert.deepEqual((await lib.search('budget')).map((h) => h.id), [item.id]);
});

test('an edit during a running stage wins: the stale run does not advance the job', async () => {
  const { kn, content, add } = await setup();
  const item = await add('Note', 'first');
  content.hook = async () => {
    content.hook = null;
    await kn.enqueue(item.id); // the owner edits while the text stage runs
  };
  assert.equal(await kn.runNext(), 'ran');
  const job = await kn.job(item.id);
  assert.equal(job?.stage, 'text');
  assert.equal(job?.status, 'queued');
});

test('a missing key pauses the queue without using up an attempt', async () => {
  const { kn, ai, add } = await setup();
  const item = await add('Note', 'text');
  await kn.runNext(); // text stage needs no AI
  ai.fail = new AiError('auth', 'No API key is set.');
  assert.equal(await kn.runNext(), 'paused');
  const job = await kn.job(item.id);
  assert.deepEqual([job?.stage, job?.status, job?.attempts, job?.error], ['embed', 'queued', 0, 'No API key is set.']);
});

test('a stage that keeps failing stops after three attempts and can be retried', async () => {
  const { kn, ai, add, drain } = await setup();
  const item = await add('Note', 'text');
  ai.fail = new AiError('server', 'HTTP 500');
  await drain();
  let job = await kn.job(item.id);
  assert.deepEqual([job?.stage, job?.status, job?.attempts], ['embed', 'failed', 3]);

  ai.fail = null;
  await kn.retry(item.id);
  await drain();
  job = await kn.job(item.id);
  assert.equal(job?.status, 'done');
});

test('recover puts back jobs the OS killed more than two minutes ago', async () => {
  const { kn, db, clock, add } = await setup();
  const a = await add('A', 'a');
  const b = await add('B', 'b');
  await db.run("UPDATE kn_jobs SET status = 'running', updated_at = ? WHERE item_id = ?", [clock.now - 130_000, a.id]);
  await db.run("UPDATE kn_jobs SET status = 'running', updated_at = ? WHERE item_id = ?", [clock.now - 10_000, b.id]);
  assert.equal(await kn.recover(), 1);
  assert.equal((await kn.job(a.id))?.status, 'queued');
  assert.equal((await kn.job(b.id))?.status, 'running');
});

test('the transcript is paid for once: a failed graph stage does not re-run text', async () => {
  const { kn, ai, content, add, drain } = await setup();
  let reads = 0;
  content.hook = async () => {
    reads++;
  };
  const item = await add('Note', 'text');
  ai.onExtract = () => {
    throw new AiError('server', 'HTTP 503');
  };
  await drain();
  ai.onExtract = () => graph;
  await kn.retry(item.id);
  await drain();
  assert.equal(reads, 1);
  assert.equal((await kn.job(item.id))?.status, 'done');
});

test('re-indexing replaces only the item’s own claims; a shared concept stays', async () => {
  const { kn, db, ai, add, drain } = await setup();
  ai.onExtract = () => graph;
  const a = await add('A', 'a');
  const b = await add('B', 'b');
  await drain();
  assert.equal((await db.first("SELECT COUNT(*) AS n FROM kn_nodes WHERE type = 'concept'"))?.n, 2);

  ai.onExtract = () => ({ concepts: [{ label: 'Kafka', aliases: [] }], atoms: [], relations: [] });
  await kn.enqueue(a.id);
  await drain();
  const labels = (await db.all("SELECT label FROM kn_nodes WHERE type = 'concept' ORDER BY label")).map((r) => r.label);
  assert.deepEqual(labels, ['CQRS', 'Event Sourcing', 'Kafka']); // still used by B
  assert.equal((await db.first("SELECT COUNT(*) AS n FROM kn_nodes WHERE type = 'atom' AND item_id = ?", [a.id]))?.n, 0);
  assert.equal((await db.first("SELECT COUNT(*) AS n FROM kn_nodes WHERE type = 'atom' AND item_id = ?", [b.id]))?.n, 1);
});

test('deleting an item removes its graph; pruneConcepts drops concepts nobody uses', async () => {
  const { lib, db, ai, add, drain } = await setup();
  ai.onExtract = () => graph;
  const a = await add('A', 'a');
  await drain();
  await lib.deleteItem(a.id);
  for (const t of ['kn_jobs', 'kn_segments', 'kn_chunks', 'kn_edges']) {
    assert.equal((await db.first(`SELECT COUNT(*) AS n FROM ${t}`))?.n, 0, t);
  }
  await pruneConcepts(db);
  assert.equal((await db.first('SELECT COUNT(*) AS n FROM kn_nodes'))?.n, 0);
});

test('a run that recover gave up on cannot move the job back when it finally returns', async () => {
  const { kn, db, clock, content, add, drain } = await setup();
  const item = await add('Voice', 'slow transcript', 'audio');
  let release = () => {};
  content.hook = () => {
    content.hook = null;
    return new Promise<void>((r) => (release = r)); // transcription hangs
  };
  const slow = kn.runNext();
  await new Promise((r) => setImmediate(r));
  clock.now += 130_000;
  assert.equal(await kn.recover(), 1);
  await drain(); // another worker finishes the item
  assert.equal((await kn.job(item.id))?.status, 'done');
  release();
  await slow;
  const job = await kn.job(item.id);
  assert.deepEqual([job?.stage, job?.status], ['done', 'done']);
  assert.equal((await db.first('SELECT COUNT(*) AS n FROM kn_segments WHERE item_id = ?', [item.id]))?.n, 1);
});

test('a stale embed run does not overwrite chunks of the edited text', async () => {
  const { kn, db, ai, texts, add, drain } = await setup();
  const item = await add('Note', 'old text');
  await kn.runNext(); // text stage
  let release = () => {};
  const embed = ai.embed;
  ai.embed = async (t) => {
    ai.embed = embed;
    await new Promise<void>((r) => (release = r));
    return embed(t);
  };
  const stale = kn.runNext(); // embed of 'old text' hangs
  await new Promise((r) => setImmediate(r));
  texts.set(item.id, [{ text: 'new text', locator: null }]);
  await kn.enqueue(item.id); // the owner edits
  await drain();
  release();
  await stale;
  assert.deepEqual((await db.all('SELECT text FROM kn_chunks WHERE item_id = ?', [item.id])).map((r) => r.text), ['new text']);
});

test('ideas come back in extraction order with their locators', async () => {
  const { kn, ai, add, drain } = await setup();
  ai.onExtract = () => ({
    concepts: [],
    atoms: [
      { text: 'First', segment: 1, concepts: [] },
      { text: 'Second', segment: 0, concepts: [] },
    ],
    relations: [],
  });
  const item = await add('P', [
    { text: 'a', locator: { page: 1 } },
    { text: 'b', locator: { page: 2 } },
  ]);
  await drain();
  assert.deepEqual(await kn.ideas(item.id), [
    { text: 'First', locator: { page: 2 } },
    { text: 'Second', locator: { page: 1 } },
  ]);
  assert.deepEqual((await kn.segmentsOf(item.id)).map((s) => s.text), ['a', 'b']);
});

test('enqueueMissing queues only items that were never processed', async () => {
  const { kn, lib, add, drain } = await setup();
  await add('Done', 'x');
  await drain();
  const old = await lib.createItem({ kind: 'pdf', title: 'Older PDF' });
  assert.equal(await kn.enqueueMissing(), 1);
  assert.equal((await kn.job(old.id))?.status, 'queued');
  assert.equal(await kn.enqueueMissing(), 0);
});

test('on a cold start every running job goes back in the queue at once', async () => {
  const { kn, db, clock, add } = await setup();
  const a = await add('A', 'a');
  await db.run("UPDATE kn_jobs SET status = 'running', updated_at = ? WHERE item_id = ?", [clock.now, a.id]);
  assert.equal(await kn.recover(), 0);
  assert.equal(await kn.recover(0), 1);
  assert.equal((await kn.job(a.id))?.status, 'queued');
});

test('a new embedding model drops the old vectors, keeps the transcript and graph, and embeds once', async () => {
  const { lib, db, ai, content, add, drain, clock } = await setup();
  ai.onExtract = () => graph;
  const item = await add('A', 'Event sourcing stores events');
  await drain();
  const before = ai.calls.embed;
  assert.equal((await db.first('SELECT COUNT(*) AS n FROM kn_chunks'))?.n, 1);

  let n = 0;
  const reopen = () => Knowledge.open(lib, { ai, content, embedTag: 'new-model', now: () => clock.now, newId: () => `x${++n}` });
  const kn = await reopen();
  assert.equal((await db.first('SELECT COUNT(*) AS n FROM kn_chunks'))?.n, 0);
  assert.equal((await db.first("SELECT COUNT(*) AS n FROM kn_nodes WHERE type = 'concept' AND embedding IS NOT NULL"))?.n, 0);
  assert.deepEqual([(await kn.job(item.id))?.stage, (await kn.job(item.id))?.status], ['embed', 'queued']);
  assert.equal((await db.first('SELECT COUNT(*) AS n FROM kn_segments WHERE item_id = ?', [item.id]))?.n, 1);

  while ((await kn.runNext()) === 'ran');
  assert.equal((await kn.job(item.id))?.status, 'done');
  assert.equal((await db.first('SELECT COUNT(*) AS n FROM kn_chunks'))?.n, 1);
  assert.equal(ai.calls.embed - before, 1);
  assert.equal((await db.first("SELECT COUNT(*) AS n FROM kn_nodes WHERE type = 'concept'"))?.n, 2); // matched by name, no duplicates

  await reopen(); // same model again: nothing to redo
  assert.equal((await db.first('SELECT COUNT(*) AS n FROM kn_chunks'))?.n, 1);
  assert.equal((await kn.job(item.id))?.status, 'done');
});

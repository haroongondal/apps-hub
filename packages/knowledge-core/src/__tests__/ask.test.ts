import test from 'node:test';
import assert from 'node:assert/strict';

import { locatorLabel } from '../knowledge.ts';
import { setup } from './helpers.ts';

const mentions = (label: string, atom: string) => () => ({
  concepts: [{ label, aliases: [] }],
  atoms: [{ text: atom, segment: 0, concepts: [label] }],
  relations: [],
});

test('Ask cites the matching page and pulls a linked idea from another item', async () => {
  const { kn, ai, add, drain } = await setup();
  ai.onExtract = mentions('Kafka', 'Kafka keeps an ordered log');
  const pdf = await add(
    'Distributed systems',
    [
      { text: 'gardening tips for spring', locator: { page: 3 } },
      { text: 'kafka partitions order events', locator: { page: 14 } },
    ],
    'pdf',
  );
  await drain();
  ai.onExtract = mentions('Kafka', 'Use Kafka for the audit trail');
  ai.vectors.set('unrelated words here', new Array(32).fill(0)); // the voice note's own text never matches
  const voice = await add('Voice Oct 12', [{ text: 'unrelated words here', locator: { startSec: 202, endSec: 210 } }], 'audio');
  await drain();

  let seen: string[] = [];
  ai.onAnswer = (_q, sources) => {
    seen = sources;
    const audit = sources.indexOf('Voice Oct 12 (3:22): Use Kafka for the audit trail') + 1;
    return `Partitions keep order [1], and you planned an audit trail [${audit}, 99].`;
  };
  const answer = await kn.ask('how does kafka order events');

  assert.equal(seen[0], 'Distributed systems (p. 14): kafka partitions order events');
  assert.deepEqual(
    answer.citations.map((c) => [c.itemId, c.locator]),
    [
      [pdf.id, { page: 14 }],
      [voice.id, { startSec: 202, endSec: 210 }],
    ],
  );
});

test('Ask with an empty library answers without calling the model', async () => {
  const { kn, ai } = await setup();
  const answer = await kn.ask('anything');
  assert.deepEqual(answer.citations, []);
  assert.equal(ai.calls.answer, 0);
});

test('related ranks items that share concepts', async () => {
  const { kn, ai, add, drain } = await setup();
  ai.onExtract = mentions('Kafka', 'Kafka idea');
  const a = await add('A', 'a');
  const b = await add('B', 'b');
  await drain();
  ai.onExtract = mentions('Gardening', 'Plant in spring');
  await add('C', 'c');
  await drain();
  assert.deepEqual((await kn.related(a.id)).map((r) => r.item.id), [b.id]);
});

test('locator labels read as page numbers and minutes:seconds', () => {
  assert.equal(locatorLabel({ page: 14 }), 'p. 14');
  assert.equal(locatorLabel({ startSec: 202.7, endSec: 210 }), '3:22');
  assert.equal(locatorLabel(null), '');
});

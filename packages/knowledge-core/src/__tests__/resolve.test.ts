import test from 'node:test';
import assert from 'node:assert/strict';

import { setup } from './helpers.ts';

const concepts = async (db: Awaited<ReturnType<typeof setup>>['db']) =>
  (await db.all("SELECT label, aliases FROM kn_nodes WHERE type = 'concept' ORDER BY label")).map((r) => [r.label, JSON.parse(r.aliases as string)]);

test('an alias seen before resolves to the same concept', async () => {
  const { db, ai, add, drain } = await setup();
  ai.onExtract = () => ({ concepts: [{ label: 'React Native', aliases: ['RN'] }], atoms: [], relations: [] });
  await add('A', 'a');
  await drain();
  ai.onExtract = () => ({ concepts: [{ label: 'RN', aliases: [] }], atoms: [], relations: [] });
  await add('B', 'b');
  await drain();
  assert.deepEqual(await concepts(db), [['React Native', ['rn']]]);
});

test('spelling and case differences resolve without an embedding call', async () => {
  const { db, ai, add, drain } = await setup();
  ai.onExtract = () => ({ concepts: [{ label: 'React Native', aliases: [] }], atoms: [], relations: [] });
  await add('A', 'a');
  await drain();
  const before = ai.calls.embed;
  ai.onExtract = () => ({ concepts: [{ label: 'react-native', aliases: [] }], atoms: [], relations: [] });
  await add('B', 'b');
  await drain();
  assert.equal(ai.calls.embed - before, 1); // the chunk only, not the label
  assert.deepEqual(await concepts(db), [['React Native', []]]);
});

test('label embeddings at or above 0.88 merge; below stay apart', async () => {
  const { db, ai, add, drain } = await setup();
  ai.vectors.set('Retrieval Augmented Generation', [1, 0]);
  ai.vectors.set('RAG pipelines', [0.9, 0.3]); // cosine ≈ 0.949
  ai.vectors.set('Graph databases', [0.5, 0.866]); // cosine 0.5
  ai.onExtract = () => ({ concepts: [{ label: 'Retrieval Augmented Generation', aliases: [] }], atoms: [], relations: [] });
  await add('A', 'a');
  await drain();
  ai.onExtract = () => ({
    concepts: [
      { label: 'RAG pipelines', aliases: [] },
      { label: 'Graph databases', aliases: [] },
    ],
    atoms: [],
    relations: [],
  });
  await add('B', 'b');
  await drain();
  assert.deepEqual(await concepts(db), [
    ['Graph databases', []],
    ['Retrieval Augmented Generation', ['rag pipelines']],
  ]);
});

test('the same new label twice in one extraction makes one concept', async () => {
  const { db, ai, add, drain } = await setup();
  ai.onExtract = () => ({
    concepts: [
      { label: 'Kafka', aliases: [] },
      { label: 'kafka', aliases: [] },
    ],
    atoms: [],
    relations: [],
  });
  await add('A', 'a');
  await drain();
  assert.equal((await concepts(db)).length, 1);
});

test('an alias that names another concept does not steal it', async () => {
  const { db, ai, add, drain } = await setup();
  ai.vectors.set('React', [1, 0]);
  ai.vectors.set('React Native', [0, 1]);
  ai.onExtract = () => ({ concepts: [{ label: 'React', aliases: [] }, { label: 'React Native', aliases: [] }], atoms: [], relations: [] });
  await add('A', 'a');
  await drain();
  ai.onExtract = () => ({ concepts: [{ label: 'React Native', aliases: ['React'] }], atoms: [], relations: [] });
  await add('B', 'b');
  await drain();
  ai.onExtract = () => ({ concepts: [{ label: 'React', aliases: [] }], atoms: [], relations: [] });
  const c = await add('C', 'c');
  await drain();
  assert.deepEqual(await concepts(db), [['React', []], ['React Native', []]]);
  const target = await db.first(
    "SELECT n.label FROM kn_edges e JOIN kn_nodes n ON n.id = e.to_id WHERE e.item_id = ? AND e.rel = 'MENTIONS'",
    [c.id],
  );
  assert.equal(target?.label, 'React');
});

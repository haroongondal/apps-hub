import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanExtraction, normLabel } from '../extraction.ts';
import { AiError } from '../types.ts';

test('normLabel folds case, punctuation and spacing', () => {
  assert.equal(normLabel('  React-Native! '), 'react native');
  assert.equal(normLabel('REACT   native'), 'react native');
  assert.equal(normLabel('...'), '');
});

test('keeps only well-formed parts that name known concepts', () => {
  const ex = cleanExtraction(
    {
      concepts: [{ label: 'Event Sourcing', aliases: ['ES', 42] }, { label: '  ' }, { label: 'CQRS', aliases: [] }],
      atoms: [
        { text: 'Events are the source of truth', segment: 1, concepts: ['es', 'Unknown'] },
        { text: 'Out of range', segment: 9, concepts: [] },
        { text: '', segment: 0, concepts: [] },
      ],
      relations: [
        { from: 'CQRS', to: 'event sourcing', type: 'SUPPORTS', weight: 3, evidence: 'q' },
        { from: 'CQRS', to: 'Nope', type: 'SUPPORTS', weight: 0.5, evidence: '' },
        { from: 'CQRS', to: 'ES', type: 'LOVES', weight: 0.5, evidence: '' },
        { from: 'ES', to: 'Event sourcing', type: 'EXTENDS', weight: 0.5, evidence: '' },
      ],
    },
    2,
  );
  assert.deepEqual(ex.concepts, [
    { label: 'Event Sourcing', aliases: ['ES'] },
    { label: 'CQRS', aliases: [] },
  ]);
  assert.deepEqual(ex.atoms, [
    { text: 'Events are the source of truth', segment: 1, concepts: ['es'] },
    { text: 'Out of range', segment: 0, concepts: [] },
  ]);
  assert.deepEqual(ex.relations, [{ from: 'CQRS', to: 'event sourcing', type: 'SUPPORTS', weight: 1, evidence: 'q' }]);
});

test('a reply that is not an object is a bad reply', () => {
  for (const raw of [null, 'text', [1]]) {
    assert.throws(() => cleanExtraction(raw, 1), (e) => e instanceof AiError && e.kind === 'bad_reply');
  }
});

test('missing lists read as empty', () => {
  assert.deepEqual(cleanExtraction({}, 1), { concepts: [], atoms: [], relations: [] });
});

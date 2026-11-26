import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Item } from '@apps-hub/library-core';

import { MAX_INDEX_BYTES, nextUnindexedPdf } from '../nexus/pdf-pick.ts';

const item = (id: string, kind: Item['kind'] = 'pdf', sizeBytes = 1000): Item => ({ id, kind, sizeBytes }) as Item;
const rules = (o: Partial<Parameters<typeof nextUnindexedPdf>[1]> = {}) => ({ hasPages: () => false, excluded: new Set<string>(), tried: new Set<string>(), ...o });

test('the first PDF without page text is picked', () => {
  const items = [item('note', 'note'), item('done'), item('shared')];
  assert.equal(nextUnindexedPdf(items, rules({ hasPages: (id) => id === 'done' }))?.id, 'shared');
});

test('kept-out, tried, too large and non-PDF items are never picked', () => {
  const items = [item('out'), item('tried'), item('big', 'pdf', MAX_INDEX_BYTES + 1), item('img', 'image')];
  assert.equal(nextUnindexedPdf(items, rules({ excluded: new Set(['out']), tried: new Set(['tried']) })), null);
});

test('nothing is picked when every PDF has its text', () => {
  assert.equal(nextUnindexedPdf([item('a'), item('b')], rules({ hasPages: () => true })), null);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canSwitchMode, nextSide, previewName, sheetChoice, sortCardPages } from '../scan/capture-rules.ts';
import { newPage, newSession } from '../scan/session-data.ts';

const page = (side: 'front' | 'back' | null = null) => newPage('cap-1.jpg', null, side);

test('document mode never assigns a side', () => {
  assert.equal(nextSide('document', []), null);
  assert.equal(nextSide('document', [page(), page()]), null);
});

test('card mode asks for the front, then the back, then refuses', () => {
  assert.equal(nextSide('card', []), 'front');
  assert.equal(nextSide('card', [page('front')]), 'back');
  assert.equal(nextSide('card', [page('front'), page('back')]), 'full');
});

test('card mode fills whichever side is missing', () => {
  assert.equal(nextSide('card', [page('back')]), 'front');
  assert.equal(nextSide('card', [page(null)]), 'back');
});

test('the mode can change only while the session has no pages', () => {
  const s = newSession(null, 1);
  assert.equal(canSwitchMode(s), true);
  assert.equal(canSwitchMode({ ...s, pages: [page()] }), false);
});

test('card pages are ordered front, back, then the rest', () => {
  const pages = [page('back'), page(null), page('front')];
  assert.deepEqual(sortCardPages(pages).map((p) => p.side), ['front', 'back', null]);
});

test('the sheet choice applies to one or two card pages only', () => {
  const s = { ...newSession(null, 1, 'card'), sheet: true };
  assert.equal(sheetChoice({ ...s, pages: [page('front')] }), true);
  assert.equal(sheetChoice({ ...s, pages: [page('front'), page('back'), page(null)] }), false);
  assert.equal(sheetChoice({ ...s, mode: 'document', pages: [page(), page()] }), false);
  assert.equal(sheetChoice({ ...s, sheet: false, pages: [page('front')] }), false);
});

test('preview names differ between sessions that restart the counter and stay cleanable', () => {
  const a = previewName(1_700_000_000_000, 1);
  const b = previewName(1_700_000_005_000, 1);
  assert.notEqual(a, b);
  assert.notEqual(previewName(1_700_000_000_000, 1), previewName(1_700_000_000_000, 2));
  for (const n of [a, b]) assert.match(`${n}.jpg`, /^prev-[0-9a-z-]+\.jpg$/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Clip } from 'clipboard-core';
import { clipSubtitle, clipTitle } from '../rows.ts';

const base: Clip = { id: 1, at: 0, kind: 'text', text: 'hello', mime: 'text/plain', source: null, via: 'app', grabMs: null };

test('hidden kinds never show text', () => {
  assert.equal(clipTitle({ ...base, kind: 'secret', text: null }), 'Password · hidden');
  assert.equal(clipTitle({ ...base, kind: 'code', text: null }), 'Code · hidden');
});

test('text, image and file titles', () => {
  assert.equal(clipTitle(base), 'hello');
  assert.equal(clipTitle({ ...base, kind: 'image', text: 'content://x' }), 'Image');
  assert.equal(clipTitle({ ...base, kind: 'file', mime: 'application/pdf' }), 'File · application/pdf');
});

test('subtitle shows age, source and how it was noticed', () => {
  assert.equal(clipSubtitle(base, 30_000), 'just now · saved on open');
  const clicked = { ...base, at: 0, source: 'com.whatsapp', via: 'TYPE_VIEW_CLICKED', grabMs: 154 };
  assert.equal(clipSubtitle(clicked, 5 * 60_000), '5 min ago · com.whatsapp · noticed in 154 ms');
  assert.equal(clipSubtitle(base, 3 * 3_600_000), '3 h ago · saved on open');
  assert.equal(clipSubtitle(base, 2 * 86_400_000), '2 d ago · saved on open');
});

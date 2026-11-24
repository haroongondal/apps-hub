import assert from 'node:assert/strict';
import test from 'node:test';

import { candidates, cleanImport, describeImport, MAX_IMPORT_CHARS, NO_TEXT_PHOTO, pdfText, photoText } from '../cv/import.ts';

test('pdfText joins the saved pages and says null when there is no text', () => {
  assert.equal(pdfText(JSON.stringify(['Page one', 'Page two'])), 'Page one\n\nPage two');
  assert.equal(pdfText(null), null);
  assert.equal(pdfText('not json'), null);
  assert.equal(pdfText('{"a":1}'), null);
  assert.equal(pdfText(JSON.stringify(['  ', ''])), null);
});

test('cleanImport tidies blank lines and control characters', () => {
  const { text, cut } = cleanImport('Ada\u0007 Lovelace  \r\n\r\n\r\n\r\nAnalyst\t\n');
  assert.equal(text, 'Ada Lovelace\n\nAnalyst');
  assert.equal(cut, false);
});

test('cleanImport cuts long text at a line, never inside a character', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `Line ${i} 😀😀😀`).join('\n');
  const { text, cut } = cleanImport(lines, 100);
  assert.equal(cut, true);
  assert.ok(Array.from(text).length <= 100);
  assert.ok(text.endsWith('😀😀😀'), 'ends on a whole line');
  assert.equal(cleanImport('x'.repeat(MAX_IMPORT_CHARS + 5)).text.length, MAX_IMPORT_CHARS);
});

test('candidates keeps items with text and marks the ones kept out', async () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const out = await candidates(items, { hasText: async (i) => i.id !== 'b', excluded: new Set(['c']) });
  assert.deepEqual(out, [
    { item: { id: 'a' }, keptOut: false },
    { item: { id: 'c' }, keptOut: true },
  ]);
});

test('photoText returns the text, or a plain message when nothing was read', async () => {
  assert.equal(await photoText('file:///p.jpg', async () => '  Ada  '), 'Ada');
  await assert.rejects(photoText('file:///p.jpg', async () => '  \n'), { message: NO_TEXT_PHOTO });
});

test('describeImport says where the text came from, and when it was kept out or cut', () => {
  assert.equal(describeImport({ text: '', cut: false, from: 'cv.pdf', keptOut: false, added: false }), 'Filled from cv.pdf.');
  const full = describeImport({ text: '', cut: true, from: 'cv.pdf', keptOut: true, added: true });
  assert.match(full, /kept out of Nexus/);
  assert.match(full, /because you picked it/);
  assert.match(full, /first 12,000 characters/);
  assert.match(full, /now in your Library/);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { snippetParts } from '../snippet.ts';

test('text without markers is one plain part', () => {
  assert.deepEqual(snippetParts('no match here'), [{ text: 'no match here', hit: false }]);
});

test('marked words become hit parts in order', () => {
  assert.deepEqual(snippetParts('your \x02parking\x03 permit \x02has\x03 expired'), [
    { text: 'your ', hit: false },
    { text: 'parking', hit: true },
    { text: ' permit ', hit: false },
    { text: 'has', hit: true },
    { text: ' expired', hit: false },
  ]);
});

test('a hit at the start or end, and adjacent hits, leave no empty parts', () => {
  assert.deepEqual(snippetParts('\x02a\x03\x02b\x03'), [
    { text: 'a', hit: true },
    { text: 'b', hit: true },
  ]);
  assert.deepEqual(snippetParts('…\x02end\x03'), [
    { text: '…', hit: false },
    { text: 'end', hit: true },
  ]);
});

test('an empty snippet has no parts', () => {
  assert.deepEqual(snippetParts(''), []);
});

test('an unclosed or stray marker never leaks into the text', () => {
  assert.deepEqual(snippetParts('x \x02open'), [
    { text: 'x ', hit: false },
    { text: 'open', hit: true },
  ]);
  assert.deepEqual(snippetParts('stray\x03 end'), [{ text: 'stray end', hit: false }]);
});

test('a real search snippet round-trips', async () => {
  const { openLibrary } = await import('./helpers.ts');
  const { lib } = await openLibrary();
  await lib.createItem({ kind: 'pdf', title: 'Doc', body: 'Dear resident, your parking permit has expired.' });
  const [hit] = await lib.search('parking');
  const parts = snippetParts(hit.snippet!);
  assert.deepEqual(parts.filter((p) => p.hit).map((p) => p.text), ['parking']);
  assert.ok(!parts.some((p) => /[\x02\x03]/.test(p.text)));
});

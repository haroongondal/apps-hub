import test from 'node:test';
import assert from 'node:assert/strict';

import { openLibrary, titles } from './helpers.ts';

const ids = (hits: readonly { id: string }[]) => hits.map((h) => h.id);

test('a prefix finds the word and accents are ignored', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'pdf', title: 'Doc', body: 'The invoice is due, see the café menu.' });
  assert.deepEqual(ids(await lib.search('invo')), [a.id]);
  assert.deepEqual(ids(await lib.search('cafe')), [a.id]);
  assert.deepEqual(ids(await lib.search('CAFÉ')), [a.id]); // unicode61 folds case too
  assert.deepEqual(await lib.search('nothing'), []);
});

test('every word must match (AND), in any order', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'pdf', title: 'Doc', body: 'parking permit for the council' });
  await lib.createItem({ kind: 'pdf', title: 'Other', body: 'parking only' });
  assert.deepEqual(ids(await lib.search('council parking')), [a.id]);
});

test('a title match outranks a body match', async () => {
  const { lib } = await openLibrary();
  const body = await lib.createItem({ kind: 'scan', title: 'Letter', body: 'parking parking parking parking' });
  const title = await lib.createItem({ kind: 'pdf', title: 'Parking permit', body: 'unrelated words here' });
  assert.deepEqual(ids(await lib.search('parking')), [title.id, body.id]);
});

test('hits carry a snippet with U+0002 and U+0003 around the matched word', async () => {
  const { lib } = await openLibrary();
  await lib.createItem({ kind: 'pdf', title: 'Doc', body: 'Dear resident, your parking permit has expired.' });
  const [hit] = await lib.search('park');
  assert.ok(hit.snippet!.includes('\u0002parking\u0003'), JSON.stringify(hit.snippet));
  assert.equal(hit.kind, 'pdf');
  assert.equal(hit.title, 'Doc');
});

test('search honours the kind and tag filters and the limit', async () => {
  const { lib } = await openLibrary();
  const pdf = await lib.createItem({ kind: 'pdf', title: 'P', body: 'shared word' });
  const scan = await lib.createItem({ kind: 'scan', title: 'S', body: 'shared word' });
  await lib.createItem({ kind: 'article', title: 'A', body: 'shared word' });
  await lib.setItemTags(scan.id, ['keep']);
  const tag = (await lib.listTags())[0];
  assert.deepEqual(ids(await lib.search('shared', { kind: 'pdf' })), [pdf.id]);
  assert.deepEqual(ids(await lib.search('shared', { tagId: tag.id })), [scan.id]);
  assert.equal((await lib.search('shared', { limit: 2 })).length, 2);
  assert.equal((await lib.search('shared')).length, 3);
});

test('blank search text returns nothing (the caller uses list)', async () => {
  const { lib } = await openLibrary();
  await lib.createItem({ kind: 'pdf', title: 'A', body: 'text' });
  assert.deepEqual(await lib.search('   '), []);
  assert.deepEqual(await lib.search('"'), []); // hostile input is harmless
});

test('a title change is searchable and keeps the body searchable', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'pdf', title: 'Alpha', body: 'bodytext' });
  await lib.updateItem(a.id, { title: 'Omega' });
  assert.deepEqual(ids(await lib.search('omega')), [a.id]);
  assert.deepEqual(ids(await lib.search('alpha')), []);
  assert.deepEqual(ids(await lib.search('bodytext')), [a.id]);
});

// Arabic and Urdu (owner, 2026-10-31): marks, tatweel, ZWNJ and the yeh/kaf variants are ignored.
const FATHA = '\u{064E}';
const MADRASA = '\u{0645}\u{062F}\u{0631}\u{0633}\u{0629}';
const KITAB_AR = '\u{0643}\u{062A}\u{0627}\u{0628}';
const KITAB_UR = '\u{06A9}\u{062A}\u{0627}\u{0628}';
const DAFTAR = '\u{062F}\u{0641}\u{062A}\u{0631}';
const withMarks = (word: string) => Array.from(word, (c) => c + FATHA).join('');

test('Arabic: a query with harakat finds text without them, and the reverse', async () => {
  const { lib } = await openLibrary();
  const plain = await lib.createItem({ kind: 'article', title: KITAB_AR, body: MADRASA });
  const marked = await lib.createItem({ kind: 'article', title: DAFTAR, body: withMarks(MADRASA) });
  assert.ok(ids(await lib.search(withMarks(MADRASA))).includes(plain.id));
  assert.ok(ids(await lib.search(MADRASA)).includes(marked.id));
  assert.deepEqual(ids(await lib.search(withMarks(KITAB_AR))), [plain.id]);
  assert.deepEqual(ids(await lib.search(withMarks(DAFTAR))), [marked.id]);
});

test('Arabic kaf finds Urdu kaf, Arabic yeh finds Persian yeh, and tatweel is ignored', async () => {
  const { lib } = await openLibrary();
  const urdu = await lib.createItem({ kind: 'article', title: `${KITAB_UR} \u{0628}\u{0646}\u{062F}` });
  const yeh = await lib.createItem({ kind: 'article', title: '\u{0645}\u{06CC}\u{0632}' });
  const tatweel = await lib.createItem({ kind: 'article', title: '\u{0642}\u{0640}\u{0644}\u{0645}' });
  assert.deepEqual(ids(await lib.search(KITAB_AR)), [urdu.id]);
  assert.deepEqual(ids(await lib.search('\u{0645}\u{064A}\u{0632}')), [yeh.id]);
  assert.deepEqual(ids(await lib.search('\u{0642}\u{0644}\u{0645}')), [tatweel.id]);
});

test('a ZWNJ in the text does not split the word', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'article', title: 'T', body: '\u{0645}\u{06CC}\u{200C}\u{062E}\u{0648}\u{0627}\u{0647}\u{0645}' });
  assert.deepEqual(ids(await lib.search('\u{0645}\u{06CC}\u{062E}\u{0648}\u{0627}\u{0647}\u{0645}')), [a.id]);
});

test('list: scope, kind, sort and paging', async () => {
  const { lib } = await openLibrary();
  const work = await lib.createFolder('Work', null);
  await lib.createItem({ kind: 'pdf', title: 'banana' });
  await lib.createItem({ kind: 'scan', title: 'Apple' });
  await lib.createItem({ kind: 'pdf', title: 'cherry', folderId: work.id });
  await lib.createItem({ kind: 'pdf', title: 'Date' });

  assert.deepEqual(titles(await lib.list({})), ['Date', 'Apple', 'banana']); // top level, newest first
  assert.deepEqual(titles(await lib.list({ sort: 'title' })), ['Apple', 'banana', 'Date']); // ignoring case
  assert.deepEqual(titles(await lib.list({ folderId: work.id })), ['cherry']);
  assert.deepEqual(titles(await lib.list({ everywhere: true, sort: 'title' })), ['Apple', 'banana', 'cherry', 'Date']);
  assert.deepEqual(titles(await lib.list({ everywhere: true, kind: 'scan' })), ['Apple']);
  assert.deepEqual(titles(await lib.list({ everywhere: true, sort: 'title', limit: 2 })), ['Apple', 'banana']);
  assert.deepEqual(titles(await lib.list({ everywhere: true, sort: 'title', limit: 2, offset: 2 })), ['cherry', 'Date']);
});

test('list: touching an item moves it to the top of recent', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'pdf', title: 'old' });
  await lib.createItem({ kind: 'pdf', title: 'new' });
  await lib.touch(a.id);
  assert.deepEqual(titles(await lib.list({})), ['old', 'new']);
});

// NFR-1 smoke bound (SPEC §12): 500 items × 20 pages of text, answered well inside 300 ms.
test('searching a word answers in under 300 ms on 500 items of 20 pages each', async () => {
  const { lib, db } = await openLibrary();
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  const vocab = Array.from({ length: 3000 }, (_, i) => `w${(i * 7919).toString(36)}`);
  const page = () => Array.from({ length: 350 }, () => vocab[rand() % vocab.length]).join(' '); // ≈ 2 KB
  await db.transaction(async () => {}); // warm the queue
  for (let i = 0; i < 500; i++) {
    await lib.createItem({
      kind: i % 2 ? 'scan' : 'pdf',
      title: `Item ${i}`,
      body: Array.from({ length: 20 }, page).join('\n\n'),
    });
  }
  const started = performance.now();
  const hits = await lib.search(vocab[42]);
  const ms = performance.now() - started;
  assert.ok(hits.length > 0);
  assert.ok(ms < 300, `search took ${ms.toFixed(0)} ms`);
});

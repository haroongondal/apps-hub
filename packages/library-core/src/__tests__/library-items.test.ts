import test from 'node:test';
import assert from 'node:assert/strict';

import { Library } from '../library.ts';
import { LibraryError } from '../errors.ts';
import { serialPort } from '../sql.ts';
import { openLibrary } from './helpers.ts';
import { nodeRawSql } from './node-sql.ts';

const code = (c: string) => (e: unknown) => e instanceof LibraryError && e.code === c;

test('createItem trims the title, fills defaults and returns the stored item', async () => {
  const { lib } = await openLibrary();
  const item = await lib.createItem({ kind: 'pdf', title: '  Council letter  ' });
  assert.equal(item.title, 'Council letter');
  assert.equal(item.kind, 'pdf');
  assert.equal(item.folderId, null);
  assert.equal(item.sizeBytes, 0);
  assert.equal(item.pageCount, null);
  assert.equal(item.createdAt, item.updatedAt);
  assert.match(item.id, /^[0-9a-z]{16}$/);
  assert.deepEqual(await lib.getItem(item.id), item);
});

test('createItem keeps a caller-supplied id, page count and size', async () => {
  const { lib } = await openLibrary();
  const item = await lib.createItem({ id: 'abcdefghij012345', kind: 'scan', title: 'S', pageCount: 3, sizeBytes: 99 });
  assert.equal(item.id, 'abcdefghij012345');
  assert.equal(item.pageCount, 3);
  assert.equal(item.sizeBytes, 99);
});

test('getItem is null for an unknown id', async () => {
  const { lib } = await openLibrary();
  assert.equal(await lib.getItem('0000000000000000'), null);
});

test('titles and ids are validated', async () => {
  const { lib } = await openLibrary();
  for (const title of ['', '   ', 'x'.repeat(201), 'bad\u0000title', 'tab\tinside']) {
    await assert.rejects(lib.createItem({ kind: 'pdf', title }), code('invalid_name'), JSON.stringify(title));
  }
  await lib.createItem({ kind: 'pdf', title: 'x'.repeat(200) });
  // The id becomes a directory name, so it must match the id pattern.
  for (const id of ['short', '../../etc/passwd0', 'ABCDEFGHIJ012345']) {
    await assert.rejects(lib.createItem({ id, kind: 'pdf', title: 'T' }), code('invalid_name'), id);
  }
});

test('a duplicate id is rejected', async () => {
  const { lib } = await openLibrary();
  await lib.createItem({ id: 'aaaaaaaaaaaaaaaa', kind: 'pdf', title: 'A' });
  await assert.rejects(lib.createItem({ id: 'aaaaaaaaaaaaaaaa', kind: 'pdf', title: 'B' }));
  assert.equal((await lib.list({ everywhere: true })).length, 1);
});

test('createItem into a missing folder is not_found and leaves no row', async () => {
  const { lib } = await openLibrary();
  await assert.rejects(lib.createItem({ kind: 'pdf', title: 'T', folderId: 'nope' }), code('not_found'));
  assert.equal((await lib.list({ everywhere: true })).length, 0);
});

test('updateItem changes fields and bumps updated_at', async () => {
  const { lib } = await openLibrary();
  const folder = await lib.createFolder('Work', null);
  const a = await lib.createItem({ kind: 'pdf', title: 'Old' });
  const b = await lib.updateItem(a.id, { title: ' New ', folderId: folder.id, pageCount: 4, sizeBytes: 10 });
  assert.equal(b.title, 'New');
  assert.equal(b.folderId, folder.id);
  assert.equal(b.pageCount, 4);
  assert.equal(b.sizeBytes, 10);
  assert.ok(b.updatedAt > a.updatedAt);
  assert.equal(b.createdAt, a.createdAt);
  assert.equal((await lib.updateItem(a.id, { folderId: null })).folderId, null);
});

test('updateItem with nothing to change does not bump updated_at; an unknown id is not_found', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'pdf', title: 'A' });
  assert.deepEqual(await lib.updateItem(a.id, {}), a);
  await assert.rejects(lib.updateItem('0000000000000000', { title: 'X' }), code('not_found'));
  await assert.rejects(lib.updateItem(a.id, { title: '' }), code('invalid_name'));
  await assert.rejects(lib.updateItem(a.id, { folderId: 'nope' }), code('not_found'));
  assert.deepEqual(await lib.getItem(a.id), a);
});

test('updateItem with the values the item already has does not bump updated_at', async () => {
  const { lib } = await openLibrary();
  const folder = await lib.createFolder('Work', null);
  const a = await lib.createItem({ kind: 'pdf', title: 'A', folderId: folder.id, pageCount: 3, sizeBytes: 10 });
  assert.deepEqual(await lib.updateItem(a.id, { title: 'A', folderId: folder.id, pageCount: 3, sizeBytes: 10 }), a);
});

test('indexing an item again with the same page count and size keeps its place in recent', async () => {
  const { lib } = await openLibrary();
  const older = await lib.createItem({ kind: 'pdf', title: 'Older', pageCount: 2, sizeBytes: 5 });
  await lib.createItem({ kind: 'pdf', title: 'Newer' });
  await lib.setBody(older.id, 'text');
  await lib.updateItem(older.id, { pageCount: 2, sizeBytes: 5 });
  assert.deepEqual((await lib.list({})).map((i) => i.title), ['Newer', 'Older']);
});

test('touch bumps updated_at', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'pdf', title: 'A' });
  await lib.touch(a.id);
  assert.ok((await lib.getItem(a.id))!.updatedAt > a.updatedAt);
  await assert.rejects(lib.touch('0000000000000000'), code('not_found'));
});

test('setBody replaces the text and does not bump updated_at', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'scan', title: 'A', body: 'first text' });
  assert.equal(await lib.getBody(a.id), 'first text');
  await lib.setBody(a.id, 'second text');
  assert.equal(await lib.getBody(a.id), 'second text');
  assert.equal((await lib.getItem(a.id))!.updatedAt, a.updatedAt);
  assert.deepEqual((await lib.search('first')).map((h) => h.id), []);
  assert.deepEqual((await lib.search('second')).map((h) => h.id), [a.id]);
});

test('getBody is empty for an item without text and not_found for an unknown id', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'pdf', title: 'A' });
  assert.equal(await lib.getBody(a.id), '');
  await assert.rejects(lib.getBody('0000000000000000'), code('not_found'));
  await assert.rejects(lib.setBody('0000000000000000', 'x'), code('not_found'));
});

test('the stored body is the normalised text', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'article', title: 'A', body: '\u{0643}\u{0650}\u{062A}\u{0627}\u{0628} \u{FB01}ne' });
  assert.equal(await lib.getBody(a.id), '\u{06A9}\u{062A}\u{0627}\u{0628} fine');
});

test('a body over 1,000,000 UTF-16 units is cut at a whitespace boundary', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'article', title: 'A' });
  await lib.setBody(a.id, 'word '.repeat(300_000));
  const stored = await lib.getBody(a.id);
  assert.ok(stored.length <= 1_000_000);
  assert.ok(stored.length > 999_990);
  assert.ok(stored.endsWith('word'), 'cut inside a word');
  // No whitespace to cut at: hard cut at the limit.
  await lib.setBody(a.id, 'x'.repeat(1_200_000));
  assert.equal((await lib.getBody(a.id)).length, 1_000_000);
  // Under the limit: untouched.
  await lib.setBody(a.id, 'short text');
  assert.equal(await lib.getBody(a.id), 'short text');
});

test('createItem applies the same cut to its body', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'article', title: 'A', body: 'word '.repeat(300_000) });
  assert.ok((await lib.getBody(a.id)).length <= 1_000_000);
});

test('a cut never splits a surrogate pair', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'article', title: 'A' });
  await lib.setBody(a.id, 'x'.repeat(999_999) + '\u{1F600}'.repeat(5)); // the 4th unit would be half an emoji
  const stored = await lib.getBody(a.id);
  const last = stored.charCodeAt(stored.length - 1);
  assert.ok(!(last >= 0xd800 && last <= 0xdbff), 'ends on a lone high surrogate');
});

test('deleteItem cascades to tags, feature rows and the search row', async () => {
  const { lib, db } = await openLibrary();
  await db.exec('CREATE TABLE feat (item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE, v TEXT)');
  const a = await lib.createItem({ kind: 'scan', title: 'Gone', body: 'uniqueword' });
  const keep = await lib.createItem({ kind: 'scan', title: 'Kept', body: 'uniqueword' });
  await lib.setItemTags(a.id, ['tax']);
  await db.run('INSERT INTO feat VALUES (?, ?)', [a.id, 'x']);
  await db.run('INSERT INTO feat VALUES (?, ?)', [keep.id, 'y']);

  await lib.deleteItem(a.id);

  assert.equal(await lib.getItem(a.id), null);
  assert.deepEqual(await db.all('SELECT item_id FROM item_tags'), []);
  assert.deepEqual(await db.all('SELECT item_id FROM feat'), [{ item_id: keep.id }]);
  assert.deepEqual((await lib.search('uniqueword')).map((h) => h.id), [keep.id]);
  assert.deepEqual(await db.first('SELECT COUNT(*) AS c FROM items_fts'), { c: 1 });
  await assert.rejects(lib.deleteItem(a.id), code('not_found'));
});

test('deleteItem removes a tag nothing else uses', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'pdf', title: 'A' });
  const b = await lib.createItem({ kind: 'pdf', title: 'B' });
  await lib.setItemTags(a.id, ['tax', 'shared']);
  await lib.setItemTags(b.id, ['shared']);
  await lib.deleteItem(a.id);
  assert.deepEqual((await lib.listTags()).map((t) => t.name), ['shared']);
});

test('allIds lists every item id', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'pdf', title: 'A' });
  const b = await lib.createItem({ kind: 'scan', title: 'B' });
  assert.deepEqual(await lib.allIds(), new Set([a.id, b.id]));
});

test('open refuses a connection with foreign keys off', async () => {
  const raw = nodeRawSql();
  raw.exec('PRAGMA foreign_keys = OFF');
  await assert.rejects(
    Library.open(serialPort(raw), { now: () => 1, newId: () => 'aaaaaaaaaaaaaaaa' }),
    /foreign_keys/,
  );
});

test('open is repeatable on the same database', async () => {
  const db = serialPort(nodeRawSql());
  const deps = { now: () => 1, newId: () => 'aaaaaaaaaaaaaaaa' };
  const first = await Library.open(db, deps);
  await first.createItem({ kind: 'pdf', title: 'Kept' });
  const second = await Library.open(db, deps);
  assert.equal((await second.list({ everywhere: true })).length, 1);
});

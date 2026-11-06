import test from 'node:test';
import assert from 'node:assert/strict';

import { LibraryError } from '../errors.ts';
import { names, openLibrary, titles } from './helpers.ts';

const code = (c: string) => (e: unknown) => e instanceof LibraryError && e.code === c;

test('tags are created on first use, trimmed, and deduped ignoring case', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'pdf', title: 'A' });
  const tags = await lib.setItemTags(a.id, ['  Tax ', 'tax', 'TAX', 'medical']);
  assert.deepEqual(names(tags), ['medical', 'Tax']); // first spelling kept, sorted ignoring case
  assert.deepEqual(names(await lib.listTags()), ['medical', 'Tax']);
});

test('an existing tag keeps its spelling when another item types it differently', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'pdf', title: 'A' });
  const b = await lib.createItem({ kind: 'pdf', title: 'B' });
  await lib.setItemTags(a.id, ['tax']);
  await lib.setItemTags(b.id, ['TAX']);
  assert.deepEqual(names(await lib.listTags()), ['tax']);
  assert.deepEqual(names(await lib.tagsFor(b.id)), ['tax']);
});

test('setItemTags replaces the set and counts items per tag', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'pdf', title: 'A' });
  const b = await lib.createItem({ kind: 'pdf', title: 'B' });
  await lib.setItemTags(a.id, ['x', 'y']);
  await lib.setItemTags(b.id, ['y']);
  assert.deepEqual((await lib.listTags()).map((t) => [t.name, t.itemCount]), [['x', 1], ['y', 2]]);
  await lib.setItemTags(a.id, ['z']);
  assert.deepEqual(names(await lib.tagsFor(a.id)), ['z']);
  assert.deepEqual((await lib.listTags()).map((t) => [t.name, t.itemCount]), [['y', 1], ['z', 1]]);
});

test('filtering by a tag shows only its items, and the tag disappears with its last item (AC-3)', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'pdf', title: 'A' });
  const b = await lib.createItem({ kind: 'scan', title: 'B' });
  await lib.createItem({ kind: 'pdf', title: 'C' });
  await lib.setItemTags(a.id, ['tax']);
  await lib.setItemTags(b.id, ['tax']);
  const tax = (await lib.listTags())[0];
  assert.deepEqual(titles(await lib.list({ everywhere: true, tagId: tax.id, sort: 'title' })), ['A', 'B']);

  await lib.setItemTags(a.id, []);
  assert.deepEqual(titles(await lib.list({ everywhere: true, tagId: tax.id })), ['B']);
  await lib.setItemTags(b.id, ['other']);
  assert.deepEqual(names(await lib.listTags()), ['other']); // "tax" is gone
  assert.deepEqual(await lib.list({ everywhere: true, tagId: tax.id }), []);
});

test('tag names are validated and the item must exist', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'pdf', title: 'A' });
  for (const bad of ['', '   ', 'x'.repeat(101), 'bad\u0000tag']) {
    await assert.rejects(lib.setItemTags(a.id, ['ok', bad]), code('invalid_name'), JSON.stringify(bad));
  }
  assert.deepEqual(await lib.listTags(), []); // the failed call left nothing behind
  await assert.rejects(lib.setItemTags('0000000000000000', ['x']), code('not_found'));
  await lib.setItemTags(a.id, ['x'.repeat(100)]);
});

test('tagsFor an item with no tags is empty', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'pdf', title: 'A' });
  assert.deepEqual(await lib.tagsFor(a.id), []);
});

test('changing tags does not bump updated_at', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createItem({ kind: 'pdf', title: 'A' });
  await lib.setItemTags(a.id, ['x']);
  assert.equal((await lib.getItem(a.id))!.updatedAt, a.updatedAt);
});

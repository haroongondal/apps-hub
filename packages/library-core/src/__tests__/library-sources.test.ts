import test from 'node:test';
import assert from 'node:assert/strict';

import { Library } from '../library.ts';
import { migrate } from '../migrate.ts';
import { LIBRARY_STEPS } from '../schema.ts';
import { serialPort } from '../sql.ts';
import { names, openLibrary, titles } from './helpers.ts';
import { nodeRawSql } from './node-sql.ts';

const msg = (sourceId: number, body = `message ${sourceId}`) => ({ app: 'inflow' as const, sourceId, sourceAt: 1_700_000_000_000, title: `Message ${sourceId}`, body });
const count = async (db: Library['db'], sql: string, params: (string | number)[] = []) => (await db.first(`SELECT COUNT(*) AS n FROM ${sql}`, params))!.n;

test('a source item is a note in that app\'s folder, found by search and by its source', async () => {
  const { lib } = await openLibrary();
  const { item, created, changed } = await lib.putSourceItem({ ...msg(7), body: 'Parcel arrives Tuesday at the depot' });
  assert.equal(created, true);
  assert.equal(changed, true);
  assert.equal(item.kind, 'note');
  assert.deepEqual(names(await lib.listFolders(null)), ['From Inflow']);
  assert.equal(item.folderId, (await lib.listFolders(null))[0].id);
  assert.deepEqual(titles(await lib.search('depot')), ['Message 7']);
  assert.deepEqual(await lib.sourceOf(item.id), { app: 'inflow', sourceId: 7, sourceAt: 1_700_000_000_000 });
  assert.deepEqual(await lib.listSourceIds('inflow'), [{ sourceId: 7, itemId: item.id }]);
  assert.deepEqual(await lib.listSourceIds('deputy'), []);
});

test('the same source id again updates the one item and never adds a second', async () => {
  const { lib, db } = await openLibrary();
  const first = await lib.putSourceItem(msg(7, 'old words'));
  const same = await lib.putSourceItem(msg(7, 'old words'));
  assert.deepEqual([same.created, same.changed, same.item.id], [false, false, first.item.id]);
  assert.equal(same.item.updatedAt, first.item.updatedAt);

  const edited = await lib.putSourceItem({ ...msg(7, 'new words'), sourceAt: 1_700_000_100_000, title: 'Message seven' });
  assert.deepEqual([edited.created, edited.changed, edited.item.id], [false, true, first.item.id]);
  assert.equal(edited.item.title, 'Message seven');
  assert.equal(await count(db, 'item_sources'), 1);
  assert.equal(await count(db, 'items'), 1);
  assert.deepEqual(titles(await lib.search('new')), ['Message seven']);
  assert.deepEqual(await lib.search('old'), []);
  assert.equal((await lib.sourceOf(first.item.id))?.sourceAt, 1_700_000_100_000);
});

test('a list of own items leaves out source items, even when they are the newest', async () => {
  const { lib } = await openLibrary();
  const own = await lib.createItem({ kind: 'note', title: 'My own note' });
  for (let id = 1; id <= 3; id++) await lib.putSourceItem(msg(id));
  assert.deepEqual(titles(await lib.list({ everywhere: true, limit: 2, ownOnly: true })), [own.title]);
  assert.equal((await lib.list({ everywhere: true, limit: 2 })).length, 2);
});

test('each app gets its own folder, made once and reused', async () => {
  const { lib } = await openLibrary();
  await lib.putSourceItem(msg(1));
  await lib.putSourceItem(msg(2));
  await lib.putSourceItem({ ...msg(1), app: 'deputy' });
  await lib.putSourceItem({ ...msg(1), app: 'clipboard' });
  assert.deepEqual(names(await lib.listFolders(null)), ['From Clipboard', 'From Deputy', 'From Inflow']);
  assert.deepEqual((await lib.listFolders(null)).map((f) => f.itemCount), [1, 1, 2]);
});

test('an unknown app, a bad id or a bad date is refused and nothing is saved', async () => {
  const { lib, db } = await openLibrary();
  await assert.rejects(lib.putSourceItem({ ...msg(1), app: 'vault' as never }), { code: 'invalid_source' });
  await assert.rejects(lib.putSourceItem({ ...msg(1), app: 'toString' as never }), { code: 'invalid_source' });
  for (const sourceId of [0, -1, 1.5, Number.NaN, 2 ** 53]) await assert.rejects(lib.putSourceItem(msg(sourceId)), { code: 'invalid_source' });
  for (const sourceAt of [-1, 1.5, Number.POSITIVE_INFINITY]) await assert.rejects(lib.putSourceItem({ ...msg(1), sourceAt }), { code: 'invalid_date' });
  await assert.rejects(lib.listSourceIds('health' as never), { code: 'invalid_source' });
  assert.equal(await count(db, 'items'), 0);
  assert.equal(await count(db, 'folders'), 0);
});

test('deleting one source item leaves the others', async () => {
  const { lib } = await openLibrary();
  await lib.putSourceItem(msg(1));
  const keep = await lib.putSourceItem(msg(2));
  assert.equal(await lib.deleteSourceItem('inflow', 1), true);
  assert.equal(await lib.deleteSourceItem('inflow', 1), false);
  assert.deepEqual(await lib.listSourceIds('inflow'), [{ sourceId: 2, itemId: keep.item.id }]);
});

test('deleting all from one app removes its items, search rows and empty folder, and nothing else', async () => {
  const { lib, db } = await openLibrary();
  const own = await lib.createItem({ kind: 'note', title: 'My own note', body: 'depot plans' });
  const a = await lib.putSourceItem({ ...msg(1), body: 'depot pickup' });
  await lib.putSourceItem(msg(2));
  const runs = await lib.putSourceItem({ ...msg(1), app: 'deputy', body: 'depot run' });
  await lib.setItemTags(a.item.id, ['bank']);
  await lib.setDue(a.item.id, 5);

  assert.equal(await lib.deleteAllFromSource('inflow'), 2);

  assert.deepEqual((await lib.list({ everywhere: true })).map((i) => i.id).sort(), [own.id, runs.item.id].sort());
  assert.deepEqual(titles(await lib.search('depot')).sort(), ['Message 1', 'My own note']); // the Deputy one and the owner's
  assert.equal(await count(db, 'items_fts'), 2);
  assert.equal(await count(db, "item_sources WHERE app = 'inflow'"), 0);
  assert.equal(await count(db, 'item_due'), 0);
  assert.deepEqual(await lib.listTags(), []);
  assert.deepEqual(names(await lib.listFolders(null)), ['From Deputy']);
});

test('deleting all keeps the app folder when the owner put something of their own in it', async () => {
  const { lib } = await openLibrary();
  const { item } = await lib.putSourceItem(msg(1));
  await lib.createItem({ kind: 'note', title: 'Mine', folderId: item.folderId });
  await lib.deleteAllFromSource('inflow');
  assert.deepEqual(names(await lib.listFolders(null)), ['From Inflow']);
  assert.equal((await lib.listFolders(null))[0].itemCount, 1);
});

test('an item the owner moved out of the app folder still goes when the app is cleared', async () => {
  const { lib } = await openLibrary();
  const { item } = await lib.putSourceItem(msg(1));
  const mine = await lib.createFolder('Keep', null);
  await lib.updateItem(item.id, { folderId: mine.id });
  assert.equal((await lib.putSourceItem(msg(1, 'edited'))).item.folderId, mine.id); // an update does not move it back
  await lib.deleteAllFromSource('inflow');
  assert.equal(await lib.getItem(item.id), null);
  assert.deepEqual(names(await lib.listFolders(null)), ['Keep']);
});

test('a library at step 3 gains the source and due tables and keeps its items', async () => {
  const db = serialPort(nodeRawSql());
  await migrate(db, 'library', LIBRARY_STEPS.slice(0, 3));
  await db.exec("INSERT INTO items (rid, id, kind, title, created_at, updated_at) VALUES (1, 'aaaaaaaaaaaaaaaa', 'note', 'Old note', 1, 1)");
  const lib = await Library.open(db, { now: () => 5, newId: () => 'bbbbbbbbbbbbbbbb' });
  assert.equal((await lib.getItem('aaaaaaaaaaaaaaaa'))?.title, 'Old note');
  await lib.setDue('aaaaaaaaaaaaaaaa', 10);
  assert.equal(await lib.getDue('aaaaaaaaaaaaaaaa'), 10);
  assert.equal(await lib.sourceOf('aaaaaaaaaaaaaaaa'), null);
});

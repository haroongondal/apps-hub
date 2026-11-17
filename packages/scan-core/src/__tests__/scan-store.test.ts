import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ScanStore } from '../scan-store.ts';
import type { Quad, ScanPage } from '../types.ts';
import { openLibrary } from './helpers.ts';

const FULL: Quad = [0, 0, 1, 0, 1, 1, 0, 1];
const page = (pageId: string, position: number, extra: Partial<ScanPage> = {}): ScanPage => ({
  pageId, position, kind: 'page', quad: FULL, rotation: 0, filter: 'auto', width: 10, height: 20,
  bitsWidth: null, bitsHeight: null, ocrState: 'pending', ...extra,
});

async function setup(count = 3) {
  const { lib, db } = await openLibrary();
  const store = await ScanStore.open(db);
  const item = await lib.createItem({ kind: 'scan', title: 'S', pageCount: count });
  await db.transaction((tx) =>
    store.insertPages(tx, item.id, Array.from({ length: count }, (_, i) => page(`p${i}`, i))),
  );
  return { lib, db, store, id: item.id };
}

test('opening twice is idempotent', async () => {
  const { db } = await setup();
  await ScanStore.open(db);
  const row = await db.first("SELECT version FROM schema_tracks WHERE track = 'scan'");
  assert.equal(row?.version, 1);
});

test('insertPages then pages round-trips quad, kind and null bits', async () => {
  const { db, store, id } = await setup(0);
  const quad: Quad = [0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9];
  await db.transaction((tx) => store.insertPages(tx, id, [page('a', 0, { quad, kind: 'card' })]));
  const [p] = await store.pages(id);
  assert.deepEqual(p.quad, quad);
  assert.equal(p.kind, 'card');
  assert.equal(p.bitsWidth, null);
  assert.equal(p.ocrState, 'pending');
  assert.equal((await store.page(id, 'a'))?.pageId, 'a');
  assert.equal(await store.page(id, 'zz'), null);
});

test('deleting the item cascades its pages', async () => {
  const { lib, store, id } = await setup();
  await lib.deleteItem(id);
  assert.deepEqual(await store.pages(id), []);
});

test('deletePage closes the gap and reorder sets positions', async () => {
  const { store, id } = await setup();
  await store.deletePage(id, 'p1');
  assert.deepEqual((await store.pages(id)).map((p) => [p.pageId, p.position]), [['p0', 0], ['p2', 1]]);
  await store.setPositions(id, ['p2', 'p0']);
  assert.deepEqual((await store.pages(id)).map((p) => p.pageId), ['p2', 'p0']);
  assert.equal(await store.nextPosition(id), 2);
});

test('updatePage changes only the given fields', async () => {
  const { store, id } = await setup();
  await store.updatePage(id, 'p0', { filter: 'bw', bitsWidth: 5, bitsHeight: 6, rotation: 90 });
  const p = (await store.page(id, 'p0'))!;
  assert.deepEqual([p.filter, p.bitsWidth, p.bitsHeight, p.rotation, p.width], ['bw', 5, 6, 90, 10]);
});

test('kind rejects an unknown value', async () => {
  const { db, store, id } = await setup(0);
  await assert.rejects(db.transaction((tx) => store.insertPages(tx, id, [page('x', 0, { kind: 'x' as never })])));
});

test('pageTexts gives an empty string for a pending page', async () => {
  const { db, store, id } = await setup(2);
  await db.run("UPDATE scan_pages SET ocr_text = 'hello' WHERE item_id = ? AND page_id = 'p1'", [id]);
  assert.deepEqual(await store.pageTexts(id), ['', 'hello']);
  assert.equal(await store.nextPosition('nope'), 0);
});

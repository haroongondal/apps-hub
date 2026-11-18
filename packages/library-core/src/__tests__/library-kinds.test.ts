import test from 'node:test';
import assert from 'node:assert/strict';

import { Library } from '../library.ts';
import { migrate } from '../migrate.ts';
import { LIBRARY_STEPS } from '../schema.ts';
import { serialPort } from '../sql.ts';
import { openLibrary } from './helpers.ts';
import { nodeRawSql } from './node-sql.ts';

test('step 2 keeps items, tags and search from a version 1 library', async () => {
  const db = serialPort(nodeRawSql());
  await migrate(db, 'library', LIBRARY_STEPS.slice(0, 1));
  await db.exec(`
    INSERT INTO folders VALUES ('f1', 'Work', NULL, 1);
    INSERT INTO items (rid, id, kind, title, folder_id, created_at, updated_at, size_bytes, page_count)
      VALUES (7, 'aaaaaaaaaaaaaaaa', 'pdf', 'Council letter', 'f1', 1, 2, 10, 3);
    INSERT INTO items_fts (rowid, title, body) VALUES (7, 'council letter', 'parking permit renewal');
    INSERT INTO tags VALUES ('t1', 'Home');
    INSERT INTO item_tags VALUES ('aaaaaaaaaaaaaaaa', 't1');
  `);
  let n = 0;
  const lib = await Library.open(db, { now: () => 5, newId: () => (++n).toString(36).padStart(16, 'n') });

  const item = await lib.getItem('aaaaaaaaaaaaaaaa');
  assert.equal(item?.folderId, 'f1');
  assert.equal(item?.pageCount, 3);
  assert.deepEqual((await lib.listTags()).map((t) => [t.name, t.itemCount]), [['Home', 1]]);
  assert.deepEqual((await lib.search('permit')).map((h) => h.id), ['aaaaaaaaaaaaaaaa']);
  assert.deepEqual(await db.first("SELECT version FROM schema_tracks WHERE track = 'library'"), {
    version: LIBRARY_STEPS.length,
  });

  await lib.deleteItem('aaaaaaaaaaaaaaaa'); // the rebuilt trigger still clears the index
  assert.equal((await db.first('SELECT COUNT(*) AS n FROM items_fts'))?.n, 0);
  assert.equal((await db.first('SELECT COUNT(*) AS n FROM item_tags'))?.n, 0);
});

test('notes, voice notes and images are items', async () => {
  const { lib } = await openLibrary();
  for (const kind of ['note', 'audio', 'image'] as const) {
    assert.equal((await lib.createItem({ kind, title: kind })).kind, kind);
  }
  await assert.rejects(lib.createItem({ kind: 'video' as never, title: 'v' }));
});

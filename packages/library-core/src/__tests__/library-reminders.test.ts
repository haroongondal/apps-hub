import test from 'node:test';
import assert from 'node:assert/strict';

import { Library } from '../library.ts';
import { migrate } from '../migrate.ts';
import { LIBRARY_STEPS } from '../schema.ts';
import { serialPort } from '../sql.ts';
import { openLibrary } from './helpers.ts';
import { nodeRawSql } from './node-sql.ts';

const place = { lat: 51.5007, lng: -0.1246, radiusM: 250, trigger: 'arrive' as const };

test('a reminder is kept with its item and leaves with it', async () => {
  const { lib } = await openLibrary();
  const item = await lib.createItem({ kind: 'note', title: 'Collect parcel' });
  const saved = await lib.addReminder({ itemId: item.id, ...place });
  assert.deepEqual(await lib.listReminders(item.id), [saved]);
  assert.deepEqual(await lib.activeReminders(), [{ ...saved, title: 'Collect parcel' }]);

  await lib.deleteItem(item.id);
  assert.deepEqual(await lib.activeReminders(), []);
});

test('removing one reminder keeps the item and its other reminders', async () => {
  const { lib } = await openLibrary();
  const item = await lib.createItem({ kind: 'note', title: 'Shops' });
  const first = await lib.addReminder({ itemId: item.id, ...place });
  const second = await lib.addReminder({ itemId: item.id, ...place, trigger: 'leave', radiusM: 500 });
  await lib.removeReminder(first.id);
  assert.deepEqual(await lib.listReminders(item.id), [second]);
  assert.ok(await lib.getItem(item.id));
});

test('a place outside the allowed range is refused and nothing is saved', async () => {
  const { lib } = await openLibrary();
  const item = await lib.createItem({ kind: 'note', title: 'Bad input' });
  const bad = [
    { ...place, lat: 91 },
    { ...place, lng: Number.NaN },
    { ...place, radiusM: 99 },
    { ...place, radiusM: 5001 },
    { ...place, radiusM: 250.5 },
    { ...place, trigger: 'both' as never },
  ];
  for (const input of bad) {
    await assert.rejects(lib.addReminder({ itemId: item.id, ...input }), { code: 'invalid_place' });
  }
  assert.deepEqual(await lib.listReminders(item.id), []);
});

test('a reminder for an item that is not there is refused', async () => {
  const { lib } = await openLibrary();
  await assert.rejects(lib.addReminder({ itemId: 'missingitemxxxxx', ...place }), { code: 'not_found' });
});

test('a library at step 2 gains the reminders table and keeps its items', async () => {
  const db = serialPort(nodeRawSql());
  await migrate(db, 'library', LIBRARY_STEPS.slice(0, 2));
  await db.exec(`
    INSERT INTO items (rid, id, kind, title, created_at, updated_at) VALUES (1, 'aaaaaaaaaaaaaaaa', 'note', 'Old note', 1, 1);
  `);
  const lib = await Library.open(db, { now: () => 5, newId: () => 'bbbbbbbbbbbbbbbb' });
  assert.equal((await lib.getItem('aaaaaaaaaaaaaaaa'))?.title, 'Old note');
  const saved = await lib.addReminder({ itemId: 'aaaaaaaaaaaaaaaa', ...place });
  assert.equal(saved.id, 'bbbbbbbbbbbbbbbb');
  assert.equal((await lib.activeReminders())[0]?.title, 'Old note');
});

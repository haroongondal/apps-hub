import test from 'node:test';
import assert from 'node:assert/strict';

import { openLibrary } from './helpers.ts';

const DAY = 86_400_000;

test('a due date is set, changed, read and cleared', async () => {
  const { lib } = await openLibrary();
  const item = await lib.createItem({ kind: 'note', title: 'Pay rent' });
  assert.equal(await lib.getDue(item.id), null);
  await lib.setDue(item.id, 3 * DAY);
  await lib.setDue(item.id, 4 * DAY);
  assert.equal(await lib.getDue(item.id), 4 * DAY);
  await lib.setDue(item.id, null);
  assert.equal(await lib.getDue(item.id), null);
  await lib.setDue(item.id, null); // clearing twice is fine
});

test('a bad date or a missing item is refused', async () => {
  const { lib } = await openLibrary();
  const item = await lib.createItem({ kind: 'note', title: 'Pay rent' });
  for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) await assert.rejects(lib.setDue(item.id, bad), { code: 'invalid_date' });
  await assert.rejects(lib.setDue('missingitemxxxxx', DAY), { code: 'not_found' });
  assert.equal(await lib.getDue(item.id), null);
});

test('dueBetween lists the owner\'s items in the window, soonest first, and leaves out items from other apps', async () => {
  const { lib } = await openLibrary();
  const rent = await lib.createItem({ kind: 'note', title: 'Pay rent' });
  const call = await lib.createItem({ kind: 'note', title: 'Call mum' });
  const later = await lib.createItem({ kind: 'note', title: 'Later' });
  const before = await lib.createItem({ kind: 'note', title: 'Before' });
  const { item: sms } = await lib.putSourceItem({ app: 'inflow', sourceId: 1, sourceAt: 0, title: 'Message from Bank', body: 'pay now' });
  await lib.setDue(rent.id, DAY + 5_000);
  await lib.setDue(call.id, DAY);
  await lib.setDue(later.id, 2 * DAY); // the end is not inside
  await lib.setDue(before.id, DAY - 1);
  await lib.setDue(sms.id, DAY + 1);

  assert.deepEqual(await lib.dueBetween(DAY, 2 * DAY), [
    { itemId: call.id, title: 'Call mum', dueAt: DAY },
    { itemId: rent.id, title: 'Pay rent', dueAt: DAY + 5_000 },
  ]);
});

test('a due date goes with its item', async () => {
  const { lib, db } = await openLibrary();
  const item = await lib.createItem({ kind: 'note', title: 'Pay rent' });
  await lib.setDue(item.id, DAY);
  await lib.deleteItem(item.id);
  assert.equal((await db.first('SELECT COUNT(*) AS n FROM item_due'))!.n, 0);
});

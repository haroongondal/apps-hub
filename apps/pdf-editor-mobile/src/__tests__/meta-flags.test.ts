import assert from 'node:assert/strict';
import { test } from 'node:test';

import { metaFlags, sourceKey, sourceSwitches, TODAY_KEY } from '../nexus/meta-flags.ts';

function fakeDb() {
  const rows = new Map<string, string>();
  return {
    rows,
    first: async (_sql: string, params?: readonly unknown[]) => (rows.has(params![0] as string) ? { value: rows.get(params![0] as string)! } : null),
    run: async (_sql: string, params?: readonly unknown[]) => void rows.set(params![0] as string, params![1] as string),
  };
}

test('every switch is off until it is turned on, and the choice is kept', async () => {
  const db = fakeDb();
  const flags = metaFlags(db as never);
  assert.equal(await flags.get(TODAY_KEY), false);
  await flags.set(TODAY_KEY, true);
  assert.equal(await metaFlags(db as never).get(TODAY_KEY), true);
  await flags.set(TODAY_KEY, false);
  assert.equal(await flags.get(TODAY_KEY), false);
});

test('each source has its own switch, all off to start', async () => {
  const db = fakeDb();
  const sw = sourceSwitches(db as never);
  for (const app of ['inflow', 'clipboard', 'deputy'] as const) assert.equal(await sw.get(app), false);
  await sw.set('deputy', true);
  assert.equal(await sw.get('deputy'), true);
  assert.equal(await sw.get('inflow'), false);
  assert.equal(db.rows.get(sourceKey('deputy')), '1');
});

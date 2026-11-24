import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanOldKeys } from '../editor/old-keys.ts';

const run = (available: () => Promise<{ ok: boolean }>) => {
  let deleted = 0;
  const done = cleanOldKeys({ hub: { available }, deleteKeyFiles: async () => void deleted++ });
  return { done, deleted: () => deleted };
};

test('the saved keys are deleted once AI hub has answered', async () => {
  const r = run(async () => ({ ok: true }));
  assert.equal(await r.done, true);
  assert.equal(r.deleted(), 1);
});

test('a hub that is missing, refuses this app or throws leaves the saved keys alone', async () => {
  for (const available of [async () => ({ ok: false }), async (): Promise<{ ok: boolean }> => { throw new Error('boom'); }]) {
    const r = run(available);
    assert.equal(await r.done, false);
    assert.equal(r.deleted(), 0);
  }
});

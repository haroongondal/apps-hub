import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as crypto from '../crypto.ts';
import { hex, LOW_FLOOR, vectors } from './vectors.ts';

// ESM bindings can't be spied on in place, so format.ts is imported only after its crypto.ts is swapped out.
let argonCalls = 0;
mock.module(new URL('../crypto.ts', import.meta.url).href, {
  namedExports: {
    ...crypto,
    argon2id: (...args: Parameters<typeof crypto.argon2id>) => {
      argonCalls++;
      return crypto.argon2id(...args);
    },
  },
});
const { KdfOutOfRange, headerFromJson, openWithPassword, unlockWithPassword } = await import('../format.ts');

test('kdfRangeStillCheckedBeforeDeriving', async () => {
  const flagged = headerFromJson(JSON.stringify(vectors.accountKey.header));
  assert.ok(flagged);
  assert.equal(flagged.kdf.memoryKiB, 1024);
  const key = hex(vectors.accountKey.key);
  await assert.rejects(unlockWithPassword(flagged, vectors.password.text, undefined, key), KdfOutOfRange);
  await assert.rejects(openWithPassword(flagged, vectors.password.text, undefined, key), KdfOutOfRange);
  await assert.rejects(unlockWithPassword(flagged, vectors.password.text), KdfOutOfRange);
  assert.equal(argonCalls, 0);
  assert.ok(await unlockWithPassword(flagged, vectors.password.text, LOW_FLOOR, key));
  assert.equal(argonCalls, 1, 'the spy sees Argon2 once the floor allows the header');
});

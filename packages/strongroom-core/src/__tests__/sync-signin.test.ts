import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as crypto from '../crypto.ts';
import type { Prelogin, PullResponse } from '../sync/protocol.ts';

// ESM bindings can't be spied on in place, so everything that derives keys is imported only after crypto.ts is swapped out.
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
const { AccountKeyRequired, KdfOutOfRange, createVault, headerToJson, openWithPassword, recoveryLoginToken, sealEntry, toBase64, tokenHash } = await import('../format.ts');
const { generateRecoveryKey } = await import('../recovery-key.ts');
const { signInWithPassword, signInWithRecovery } = await import('../sync/signin.ts');
const { SyncAuthError } = await import('../sync/transport.ts');
type Transport = import('../sync/transport.ts').Transport;

const PASSWORD = 'a master password';
const ID = '00000000-0000-4000-8000-000000000001';

async function account(o: { accountKey?: Uint8Array } = {}) {
  const recoveryKey = generateRecoveryKey();
  const { header, vaultKey } = await createVault(PASSWORD, recoveryKey, { kdf: crypto.KDF_FLOOR, accountKey: o.accountKey });
  const keys = await openWithPassword(header, PASSWORD, undefined, o.accountKey);
  assert.ok(keys);
  const sealed = await sealEntry(vaultKey, ID, { type: 'note', name: 'n', text: 't', updatedAt: 1 });
  const hashes = new Set([tokenHash(keys.loginToken), tokenHash(recoveryLoginToken(recoveryKey))]);
  const prelogin: Prelogin = { version: 1, kdf: header.kdf, salt: toBase64(header.salt), accountKey: header.accountKey === true };
  let page: PullResponse = { header: headerToJson(header), headerRev: 4, records: [{ id: ID, rev: 7, ciphertext: toBase64(sealed), updatedAt: 1 }], latestRev: 9, more: false };
  let pulls = 0;
  const t: Transport = {
    prelogin: async () => prelogin,
    async pull(token) {
      pulls++;
      if (!hashes.has(tokenHash(token))) throw new SyncAuthError();
      return page;
    },
    push: async () => {
      throw new Error('sign-in never pushes');
    },
    putAccount: async () => {
      throw new Error('sign-in never writes the account');
    },
    lostRequest: async () => {
      throw new Error('sign-in never touches escrow');
    },
    lostRelease: async () => {
      throw new Error('sign-in never touches escrow');
    },
    lostStatus: async () => {
      throw new Error('sign-in never touches escrow');
    },
    lostCancel: async () => {
      throw new Error('sign-in never touches escrow');
    },
    deleteEscrow: async () => {
      throw new Error('sign-in never touches escrow');
    },
  };
  return { t, header, vaultKey, keys, sealed, recoveryKey, prelogin, pulls: () => pulls, setPage: (p: PullResponse) => (page = p) };
}

test('signInChecksKdfBeforeDeriving', async () => {
  const a = await account({ accountKey: crypto.randomBytes(20) });
  argonCalls = 0;
  const weak: Transport = { ...a.t, prelogin: async () => ({ ...a.prelogin, kdf: { memoryKiB: 1024, iterations: 3, parallelism: 1 } }) };
  await assert.rejects(signInWithPassword(weak, PASSWORD, crypto.randomBytes(20)), KdfOutOfRange);
  await assert.rejects(signInWithPassword(a.t, PASSWORD), AccountKeyRequired);
  assert.equal(argonCalls, 0);
  assert.equal(a.pulls(), 0);
});

test('signInWithWrongAccountKeyFails', async () => {
  const key = crypto.randomBytes(20);
  const a = await account({ accountKey: key });
  await assert.rejects(signInWithPassword(a.t, PASSWORD, crypto.randomBytes(20)), SyncAuthError);
  await assert.rejects(signInWithPassword(a.t, 'not the password', key), SyncAuthError);
});

test('signInWithPasswordDerivesOnceAndOpensTheVault', async () => {
  const key = crypto.randomBytes(20);
  const a = await account({ accountKey: key });
  argonCalls = 0;
  const s = await signInWithPassword(a.t, PASSWORD, key);
  assert.equal(argonCalls, 1);
  assert.deepEqual(s, {
    header: a.header,
    headerRev: 4,
    records: [{ id: ID, sealed: a.sealed, rev: 7 }],
    quarantine: [],
    skipped: 0,
    lastRev: 9,
    vaultKey: a.vaultKey,
    loginToken: a.keys.loginToken,
    readToken: a.keys.readToken,
  });
});

test('signInRefusesAHeaderThatDoesNotMatchPrelogin', async () => {
  const a = await account();
  const page = { header: headerToJson(a.header), headerRev: 4, records: [], latestRev: 9, more: false };
  for (const header of [{ ...a.header, kdf: { ...a.header.kdf, iterations: 3 } }, { ...a.header, salt: new Uint8Array(16) }, { ...a.header, accountKey: true as const }]) {
    a.setPage({ ...page, header: headerToJson(header) });
    await assert.rejects(signInWithPassword(a.t, PASSWORD), SyncAuthError);
  }
  a.setPage({ ...page, header: 'not a header' });
  await assert.rejects(signInWithPassword(a.t, PASSWORD), SyncAuthError);
});

// As adoptHeader: a server that drops the flag from prelogin and the header, though its wrap still needs the key, is never taken.
test('signInRefusesAServerHeaderThatDroppedTheAccountKeyFlag', async () => {
  const key = crypto.randomBytes(20);
  const a = await account({ accountKey: key });
  const lying: Transport = { ...a.t, prelogin: async () => ({ ...a.prelogin, accountKey: false }) };
  a.setPage({ header: headerToJson({ ...a.header, accountKey: undefined }), headerRev: 4, records: [], latestRev: 9, more: false });
  await assert.rejects(signInWithPassword(lying, PASSWORD, key), SyncAuthError);
});

test('signInWithRecoveryOpensTheVault', async () => {
  const a = await account({ accountKey: crypto.randomBytes(20) });
  argonCalls = 0;
  const s = await signInWithRecovery(a.t, a.recoveryKey);
  assert.equal(argonCalls, 0);
  assert.deepEqual([s.vaultKey, s.loginToken, s.readToken, s.headerRev, s.lastRev], [a.vaultKey, recoveryLoginToken(a.recoveryKey), null, 4, 9]);
  await assert.rejects(signInWithRecovery(a.t, generateRecoveryKey()), SyncAuthError);
});

test('signInQuarantinesUnreadableRowsAndCountsBadOnes', async () => {
  const a = await account();
  const other = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const garbage = crypto.randomBytes(60);
  const row = (rid: string, rev: number, ciphertext: string) => ({ id: rid, rev, ciphertext, updatedAt: 1 });
  a.setPage({
    header: headerToJson(a.header),
    headerRev: 4,
    records: [
      row(ID, 5, toBase64(a.sealed)),
      row(other(2), 6, toBase64(garbage)),
      row(other(3), 7, 'A'.repeat(90_004)),
      row(other(4), 8, 'not*base64'),
      row('NOT-AN-ID', 9, toBase64(a.sealed)),
    ],
    latestRev: 9,
    more: false,
  });
  const s = await signInWithRecovery(a.t, a.recoveryKey);
  assert.deepEqual([s.records, s.quarantine, s.skipped], [[{ id: ID, sealed: a.sealed, rev: 5 }], [{ id: other(2), sealed: garbage, rev: 6 }], 3]);
});

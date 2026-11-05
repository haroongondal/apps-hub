import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  adoptHeader, createVault, fetchTransport, generateRecoveryKey, headerToJson, KDF_FLOOR, newId, openWithPassword, randomBytes,
  readEntries, recoveryLoginToken, signInWithPassword, signInWithRecovery, SyncAuthError, syncOnce, tokenHash, withNewPassword, writeEntries,
} from 'strongroom-core';
import type { Entry, Transport } from 'strongroom-core';
import { MemorySyncStore } from 'strongroom-core/src/__tests__/memory-sync-store.ts';
import { handle } from '../index.ts';
import { d1FromNodeSqlite } from './d1-fake.ts';

const SETUP = 'setup-token-for-tests-0123456789abcdef';
const PASSWORD = 'first master password';
const NEW_PASSWORD = 'second master password';
const migration = readFileSync(new URL('../../migrations/0001_init.sql', import.meta.url), 'utf8');
const login = (name: string, updatedAt: number): Entry => ({ type: 'login', name, username: 'me', password: 'pw', sites: [], apps: [], note: '', updatedAt });

type Device = { store: MemorySyncStore; vaultKey: Uint8Array; token: Uint8Array };

// The phone's part (Task 6 does it in Kotlin): a vault with an account key, the account created with SETUP_TOKEN, one login uploaded.
async function world() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migration);
  const env = { DB: d1FromNodeSqlite(sqlite), SETUP_TOKEN: SETUP };
  const t = fetchTransport('https://vault.example', (input, init) => handle(new Request(input, init), env));
  const accountKey = randomBytes(20);
  const recoveryKey = generateRecoveryKey();
  const { header, vaultKey } = await createVault(PASSWORD, recoveryKey, { kdf: KDF_FLOOR, accountKey });
  const keys = await openWithPassword(header, PASSWORD, undefined, accountKey);
  assert.ok(keys);
  const recoveryHash = tokenHash(recoveryLoginToken(recoveryKey));
  const created = await t.putAccount({ setupToken: SETUP }, { header: headerToJson(header), loginHash: tokenHash(keys.loginToken), recoveryHash, readHash: tokenHash(keys.readToken) });
  const phone: Device = { store: new MemorySyncStore(), vaultKey, token: keys.loginToken };
  await phone.store.applyPull({ header, headerRev: created.headerRev, records: [], quarantine: [], lastRev: 0 });
  const loginId = newId();
  await writeEntries(phone.store, vaultKey, [{ id: loginId, entry: login('Mail', 1000) }]);
  assert.equal((await sync(phone, t)).pushed, 1);
  return { t, accountKey, recoveryKey, loginId };
}

async function signIn(t: Transport, password: string, accountKey: Uint8Array): Promise<Device> {
  const s = await signInWithPassword(t, password, accountKey);
  const store = new MemorySyncStore();
  await store.applyPull({ header: s.header, headerRev: s.headerRev, records: s.records, quarantine: [], lastRev: s.lastRev });
  return { store, vaultKey: s.vaultKey, token: s.loginToken };
}

const sync = (d: Device, t: Transport) => syncOnce({ store: d.store, transport: t, vaultKey: d.vaultKey, token: d.token });
const entries = async (d: Device) => (await readEntries(d.store, d.vaultKey)).items.sort((a, b) => a.id.localeCompare(b.id));

test('twoDevicesEditAndDeleteTheSameLoginAndConverge', async () => {
  const { t, accountKey, loginId } = await world();
  const a = await signIn(t, PASSWORD, accountKey);
  const b = await signIn(t, PASSWORD, accountKey);
  assert.deepEqual(await entries(a), [{ id: loginId, entry: login('Mail', 1000) }]);

  await writeEntries(a.store, a.vaultKey, [{ id: loginId, entry: login('Mail (work)', 2000) }]);
  await writeEntries(b.store, b.vaultKey, [{ id: loginId, entry: { type: 'deleted', updatedAt: 3000 } }]);
  assert.equal((await sync(a, t)).pushed, 1);
  const rb = await sync(b, t);
  assert.deepEqual([rb.pulled, rb.pushed, rb.conflicts], [0, 1, 1]);
  assert.equal((await sync(a, t)).pulled, 1);

  assert.deepEqual(await entries(a), [{ id: loginId, entry: { type: 'deleted', updatedAt: 3000 } }]);
  assert.deepEqual(await entries(b), await entries(a));
  for (const d of [a, b]) assert.ok([...d.store.records.values()].every((r) => !r.dirty));
});

test('passwordChangeOnOneDeviceMeansSignInAgainOnTheOther', async () => {
  const { t, accountKey, recoveryKey } = await world();
  const a = await signIn(t, PASSWORD, accountKey);
  const b = await signIn(t, PASSWORD, accountKey);

  const old = a.store.header!;
  const changed = await withNewPassword(old, a.vaultKey, NEW_PASSWORD, { accountKey });
  const keys = await openWithPassword(changed, NEW_PASSWORD, undefined, accountKey);
  assert.ok(keys);
  const { headerRev, lastRev } = await a.store.getSyncMeta();
  const put = await t.putAccount(a.token, { header: headerToJson(changed), loginHash: tokenHash(keys.loginToken), readHash: tokenHash(keys.readToken), ifRev: headerRev });
  await a.store.applyPull({ header: changed, headerRev: put.headerRev, records: [], quarantine: [], lastRev });
  a.token = keys.loginToken;
  assert.deepEqual((await signInWithRecovery(t, recoveryKey)).vaultKey, a.vaultKey);

  const noteId = newId();
  await writeEntries(b.store, b.vaultKey, [{ id: noteId, entry: { type: 'note', name: 'Wifi', text: 'written before the 401', updatedAt: 4000 } }]);
  const writes = b.store.writes;
  await assert.rejects(sync(b, t), SyncAuthError);
  assert.equal(b.store.writes, writes);

  const again = await signInWithPassword(t, NEW_PASSWORD, accountKey);
  assert.equal(await adoptHeader(b.store.header!, again.header, PASSWORD, accountKey, b.vaultKey), 'refused');
  const adopted = await adoptHeader(b.store.header!, again.header, NEW_PASSWORD, accountKey, b.vaultKey);
  assert.notEqual(adopted, 'refused');
  if (adopted === 'refused') return;
  await b.store.applyPull({ header: adopted, headerRev: again.headerRev, records: [], quarantine: [], lastRev: (await b.store.getSyncMeta()).lastRev });
  b.token = again.loginToken;

  assert.equal((await sync(b, t)).pushed, 1);
  assert.equal((await sync(a, t)).pulled, 1);
  assert.deepEqual(await entries(a), await entries(b));
  assert.equal((await entries(a)).length, 2);
});

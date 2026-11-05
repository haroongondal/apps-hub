import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from '../crypto.ts';
import type { Entry, Login } from '../entry.ts';
import { AccountKeyRequired, createVault } from '../format.ts';
import type { Header } from '../format.ts';
import { formatRecoveryKey, generateRecoveryKey } from '../recovery-key.ts';
import { readEntries, recover, setupVault, unlock, writeEntries } from '../vault.ts';
import type { RecordStore, StoredRecord } from '../vault.ts';
import { LOW_FLOOR, LOW_KDF } from './vectors.ts';

class MemoryStore implements RecordStore {
  header: Header | null = null;
  records = new Map<string, Uint8Array>();
  commits = 0;
  async getHeader() { return this.header; }
  async getRecords(): Promise<StoredRecord[]> { return [...this.records].map(([id, sealed]) => ({ id, sealed })); }
  async commit(change: { header?: Header; records?: StoredRecord[] }) {
    this.commits++;
    if (change.header) this.header = change.header;
    for (const r of change.records ?? []) this.records.set(r.id, r.sealed);
  }
}

const opts = { kdf: LOW_KDF, floor: LOW_FLOOR };
const login = (name: string, updatedAt = 1): Login => ({ type: 'login', name, username: 'me', password: 'pw', sites: [], apps: [], note: '', updatedAt });

test('setup creates the vault and gives back a recovery key that parses', async () => {
  const store = new MemoryStore();
  const { vaultKey, recoveryKey } = await setupVault(store, 'a master password', opts);
  assert.equal(vaultKey.length, 32);
  assert.match(formatRecoveryKey(recoveryKey), /^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
  assert.ok(store.header);
});

test('setup refuses to overwrite an existing vault', async () => {
  const store = new MemoryStore();
  await setupVault(store, 'a master password', opts);
  await assert.rejects(setupVault(store, 'another password', opts), /already/i);
});

test('unlock returns the vault key for the right password and null for a wrong one', async () => {
  const store = new MemoryStore();
  const { vaultKey } = await setupVault(store, 'a master password', opts);
  assert.deepEqual(await unlock(store, 'a master password', LOW_FLOOR), vaultKey);
  assert.equal(await unlock(store, 'wrong password!!', LOW_FLOOR), null);
});

test('unlock with no vault set up throws instead of returning null', async () => {
  await assert.rejects(unlock(new MemoryStore(), 'a master password', LOW_FLOOR), /no vault/i);
});

test('recover opens the vault with the recovery key and sets a new master password', async () => {
  const store = new MemoryStore();
  const { vaultKey, recoveryKey } = await setupVault(store, 'old master password', opts);
  const text = formatRecoveryKey(recoveryKey).toLowerCase();
  assert.deepEqual(await recover(store, text, 'new master password', { floor: LOW_FLOOR }), vaultKey);
  assert.deepEqual(await unlock(store, 'new master password', LOW_FLOOR), vaultKey);
  assert.equal(await unlock(store, 'old master password', LOW_FLOOR), null);
});

test('recover with a wrong or malformed recovery key changes nothing', async () => {
  const store = new MemoryStore();
  const { vaultKey, recoveryKey } = await setupVault(store, 'old master password', opts);
  const before = store.commits;
  assert.equal(await recover(store, 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', 'new master password', { floor: LOW_FLOOR }), null);
  assert.equal(await recover(store, 'not a key', 'new master password', { floor: LOW_FLOOR }), null);
  assert.equal(store.commits, before);
  assert.deepEqual(await unlock(store, 'old master password', LOW_FLOOR), vaultKey);
  assert.ok(recoveryKey);
});

async function flaggedVault(password: string) {
  const store = new MemoryStore();
  const accountKey = randomBytes(20);
  const recoveryKey = generateRecoveryKey();
  const { header, vaultKey } = await createVault(password, recoveryKey, { ...opts, accountKey });
  await store.commit({ header });
  return { store, accountKey, recoveryKey, vaultKey };
}

test('a vault with an account key unlocks only with that key', async () => {
  const { store, accountKey, vaultKey } = await flaggedVault('a master password');
  await assert.rejects(unlock(store, 'a master password', LOW_FLOOR), AccountKeyRequired);
  assert.equal(await unlock(store, 'a master password', LOW_FLOOR, randomBytes(20)), null);
  assert.equal(await unlock(store, 'wrong password!!', LOW_FLOOR, accountKey), null);
  assert.deepEqual(await unlock(store, 'a master password', LOW_FLOOR, accountKey), vaultKey);
});

test('recover on a vault with an account key needs the key and keeps the flag', async () => {
  const { store, accountKey, recoveryKey, vaultKey } = await flaggedVault('old master password');
  const text = formatRecoveryKey(recoveryKey);
  const before = store.commits;
  await assert.rejects(recover(store, text, 'new master password', { floor: LOW_FLOOR }), AccountKeyRequired);
  assert.equal(store.commits, before);
  assert.deepEqual(await recover(store, text, 'new master password', { floor: LOW_FLOOR, accountKey }), vaultKey);
  assert.equal(store.header?.accountKey, true);
  assert.deepEqual(await unlock(store, 'new master password', LOW_FLOOR, accountKey), vaultKey);
  await assert.rejects(unlock(store, 'new master password', LOW_FLOOR), AccountKeyRequired);
  assert.equal(await unlock(store, 'old master password', LOW_FLOOR, accountKey), null);
});

test('entries written in one commit read back, deleted ones as tombstones', async () => {
  const store = new MemoryStore();
  const { vaultKey } = await setupVault(store, 'a master password', opts);
  const before = store.commits;
  await writeEntries(store, vaultKey, [{ id: 'a', entry: login('A') }, { id: 'b', entry: { type: 'deleted', updatedAt: 9 } }]);
  assert.equal(store.commits, before + 1);
  const { items, unreadable } = await readEntries(store, vaultKey);
  assert.equal(unreadable, 0);
  assert.deepEqual(Object.fromEntries(items.map((i) => [i.id, i.entry])), { a: login('A'), b: { type: 'deleted', updatedAt: 9 } } satisfies Record<string, Entry>);
});

test('a record that will not decrypt is counted and kept, and the others still read', async () => {
  const store = new MemoryStore();
  const { vaultKey } = await setupVault(store, 'a master password', opts);
  await writeEntries(store, vaultKey, [{ id: 'good', entry: login('Good') }]);
  store.records.set('bad', new Uint8Array(40).fill(7));
  const { items, unreadable } = await readEntries(store, vaultKey);
  assert.deepEqual(items.map((i) => i.id), ['good']);
  assert.equal(unreadable, 1);
  assert.ok(store.records.has('bad'));
});

test('a record sealed under another id does not read back', async () => {
  const store = new MemoryStore();
  const { vaultKey } = await setupVault(store, 'a master password', opts);
  await writeEntries(store, vaultKey, [{ id: 'a', entry: login('A') }]);
  store.records.set('b', store.records.get('a')!);
  const { items, unreadable } = await readEntries(store, vaultKey);
  assert.deepEqual(items.map((i) => i.id), ['a']);
  assert.equal(unreadable, 1);
});

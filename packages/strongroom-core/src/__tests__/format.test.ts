import assert from 'node:assert/strict';
import { test } from 'node:test';
import { open, utf8, KDF_DEFAULT } from '../crypto.ts';
import { decodeEntry, encodeEntry } from '../entry.ts';
import type { Entry } from '../entry.ts';
import {
  KdfOutOfRange,
  createVault,
  headerFromJson,
  headerToJson,
  openEntry,
  sealEntry,
  unlockWithPassword,
  unlockWithRecovery,
  withNewPassword,
} from '../format.ts';
import { hex, LOW_FLOOR, LOW_KDF, toHex, vectors } from './vectors.ts';

const header = () => {
  const h = headerFromJson(JSON.stringify(vectors.header));
  assert.ok(h);
  return h;
};

test('the vector header parses and serialises back to the same JSON', () => {
  assert.deepEqual(JSON.parse(headerToJson(header())), vectors.header);
});

test('headerFromJson refuses a wrong version, a short salt, junk and an oversized header', () => {
  const v = vectors.header;
  assert.equal(headerFromJson(JSON.stringify({ ...v, version: 2 })), null);
  assert.equal(headerFromJson(JSON.stringify({ ...v, salt: 'AAEC' })), null);
  assert.equal(headerFromJson(JSON.stringify({ ...v, kdf: { ...v.kdf, iterations: 'x' } })), null);
  assert.equal(headerFromJson(JSON.stringify({ ...v, passwordWrap: '***' })), null);
  assert.equal(headerFromJson('not json'), null);
  assert.equal(headerFromJson(JSON.stringify({ ...v, note: 'x'.repeat(5000) })), null);
});

test('the master password opens the vector header to the vector vault key', async () => {
  const key = await unlockWithPassword(header(), vectors.password.text, LOW_FLOOR);
  assert.ok(key);
  assert.equal(toHex(key), vectors.vaultKey);
});

test('a wrong master password opens nothing', async () => {
  assert.equal(await unlockWithPassword(header(), 'not the password', LOW_FLOOR), null);
});

test('the recovery key opens the vector header to the vector vault key', async () => {
  const key = await unlockWithRecovery(header(), hex(vectors.recovery.key));
  assert.ok(key);
  assert.equal(toHex(key), vectors.vaultKey);
});

test('unlock refuses a header whose KDF is below the floor, instead of trusting it', async () => {
  await assert.rejects(unlockWithPassword(header(), vectors.password.text), KdfOutOfRange);
});

test('every vector record opens to its entry, and our encoding is the plaintext the phone sealed', async () => {
  const vaultKey = hex(vectors.vaultKey);
  for (const r of vectors.records) {
    const entry = await openEntry(vaultKey, r.id, hex(r.sealed));
    assert.deepEqual(entry, r.entry, r.id);
    const plain = await open(vaultKey, hex(r.sealed), utf8(r.aad));
    assert.ok(plain);
    assert.equal(new TextDecoder().decode(plain), encodeEntry(r.entry as Entry), r.id);
  }
});

test('a record opened under another record id fails, so ciphertext cannot be moved between ids', async () => {
  const vaultKey = hex(vectors.vaultKey);
  const [a, b] = vectors.records;
  assert.equal(await openEntry(vaultKey, b.id, hex(a.sealed)), null);
});

test('sealEntry then openEntry round-trips a login', async () => {
  const vaultKey = hex(vectors.vaultKey);
  const login: Entry = {
    type: 'login', name: 'Bank', username: 'me', password: 'p"w\\', sites: [{ https: true, host: 'bank.com' }],
    apps: [], note: '', updatedAt: 5,
  };
  const sealed = await sealEntry(vaultKey, 'id-1', login);
  assert.deepEqual(await openEntry(vaultKey, 'id-1', sealed), login);
});

test('createVault gives a header the password and the recovery key both open to the same vault key', async () => {
  const recovery = hex(vectors.recovery.key);
  const { header: h, vaultKey } = await createVault('a fresh master password', recovery, { kdf: LOW_KDF, floor: LOW_FLOOR });
  assert.equal(vaultKey.length, 32);
  assert.deepEqual(await unlockWithPassword(h, 'a fresh master password', LOW_FLOOR), vaultKey);
  assert.deepEqual(await unlockWithRecovery(h, recovery), vaultKey);
  assert.equal(h.version, 1);
  assert.equal(h.salt.length, 16);
});

test('createVault refuses a KDF below the floor, so it never makes a vault it would then refuse to open', async () => {
  await assert.rejects(createVault('pw pw pw pw pw', hex(vectors.recovery.key), { kdf: LOW_KDF }), KdfOutOfRange);
  assert.deepEqual(KDF_DEFAULT, { memoryKiB: 65536, iterations: 3, parallelism: 1 });
});

test('withNewPassword re-wraps the vault key: the new password works, the old one and the salt are gone', async () => {
  const recovery = hex(vectors.recovery.key);
  const { header: h, vaultKey } = await createVault('old master password', recovery, { kdf: LOW_KDF, floor: LOW_FLOOR });
  const next = await withNewPassword(h, vaultKey, 'new master password', { floor: LOW_FLOOR });
  assert.deepEqual(await unlockWithPassword(next, 'new master password', LOW_FLOOR), vaultKey);
  assert.equal(await unlockWithPassword(next, 'old master password', LOW_FLOOR), null);
  assert.deepEqual(await unlockWithRecovery(next, recovery), vaultKey);
  assert.notEqual(toHex(next.salt), toHex(h.salt));
});

test('withNewPassword refuses a weaker KDF than the vault already uses', async () => {
  const { header: h, vaultKey } = await createVault('old master password', hex(vectors.recovery.key), { kdf: LOW_KDF, floor: LOW_FLOOR });
  await assert.rejects(
    withNewPassword(h, vaultKey, 'new master password', { kdf: { ...LOW_KDF, iterations: 0 }, floor: { ...LOW_FLOOR, iterations: 0 } }),
    KdfOutOfRange,
  );
});

test('decodeEntry returns null for anything malformed, never a half-built entry', () => {
  const login = vectors.records[0].entry;
  assert.equal(decodeEntry('{'), null);
  assert.equal(decodeEntry(JSON.stringify({ ...login, type: 'passkey' })), null);
  assert.equal(decodeEntry(JSON.stringify({ ...login, updatedAt: '1' })), null);
  assert.equal(decodeEntry(JSON.stringify({ ...login, sites: [{ https: 'yes', host: 'a.com' }] })), null);
  assert.equal(decodeEntry(JSON.stringify({ ...login, apps: [{ pkg: 'a.b', certSha256: 'ABC', domain: null }] })), null);
  assert.equal(decodeEntry(JSON.stringify({ ...login, password: undefined })), null);
  assert.deepEqual(decodeEntry(JSON.stringify(login)), login);
});

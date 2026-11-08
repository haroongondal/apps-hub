import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toBase64 } from 'strongroom-core';
import { createDeviceVault } from '../device-vault.ts';
import type { KeyStore } from '../device-vault.ts';
import type { KV } from '../service.ts';

const memKV = () => {
  const m = new Map<string, string>();
  const kv: KV = { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v), remove: async (k) => void m.delete(k) };
  return { kv, m };
};
const memKeys = (): KeyStore => {
  let k: CryptoKey | undefined;
  return {
    get: async () => k,
    put: async (n) => {
      k = n;
    },
  };
};
// Mirrors idbKeyStore: a non-extractable AES-GCM key made on first use.
const newKeys = async () => {
  const ks = memKeys();
  await ks.put(await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
  return ks;
};
const vaultKey = new Uint8Array(32).fill(7);
const loginToken = new Uint8Array(32).fill(9);
const prf = new Uint8Array(32).fill(3);
const setup = async () => {
  const { kv, m } = memKV();
  return { m, kv, vault: createDeviceVault(kv, await newKeys()) };
};

test('mode is none before any save', async () => {
  const { vault } = await setup();
  assert.equal(await vault.mode(), 'none');
  assert.equal(await vault.loadKeys(), null);
});

test('saved keys load back in device mode', async () => {
  const { vault } = await setup();
  await vault.saveKeys({ vaultKey, loginToken });
  assert.equal(await vault.mode(), 'device');
  const k = await vault.loadKeys();
  assert.deepEqual(k?.vaultKey, vaultKey);
  assert.deepEqual(k?.loginToken, loginToken);
  await vault.saveKeys({ vaultKey });
  assert.equal((await vault.loadKeys())?.loginToken, undefined);
});

test('clearKeys removes them', async () => {
  const { vault } = await setup();
  await vault.saveKeys({ vaultKey });
  await vault.clearKeys();
  assert.equal(await vault.mode(), 'none');
  assert.equal(await vault.loadKeys(), null);
});

test('the stored bytes do not contain the vault key', async () => {
  const { vault, m } = await setup();
  await vault.saveKeys({ vaultKey, loginToken });
  await vault.saveAccountKey(vaultKey);
  const all = [...m.values()].join('\n');
  assert.ok(!all.includes(toBase64(vaultKey)));
  assert.ok(!all.includes(toBase64(loginToken)));
});

test('a different wrapper cannot open the keys', async () => {
  const { kv, vault } = await setup();
  await vault.saveKeys({ vaultKey });
  await vault.saveAccountKey(vaultKey);
  const other = createDeviceVault(kv, await newKeys());
  assert.equal(await other.loadKeys(), null);
  assert.equal(await other.loadAccountKey(), null);
});

test('protect moves keys to fingerprint mode: loadKeys without prf is null, with prf returns them, no device-sealed copy remains', async () => {
  const { vault, kv, m } = await setup();
  await vault.saveKeys({ vaultKey, loginToken });
  const before = JSON.parse((await kv.get('deviceKeys'))!).sealed;
  await vault.protect(prf);
  assert.equal(await vault.mode(), 'fingerprint');
  assert.equal(await vault.loadKeys(), null);
  const k = await vault.loadKeys(prf);
  assert.deepEqual(k?.vaultKey, vaultKey);
  assert.deepEqual(k?.loginToken, loginToken);
  assert.equal(await vault.loadKeys(new Uint8Array(32).fill(4)), null);
  assert.notEqual(JSON.parse(m.get('deviceKeys')!).sealed, before);
  assert.ok(![...m.values()].some((v) => v.includes(before)));
});

test('saveKeys in fingerprint mode without prf changes nothing; with prf re-seals', async () => {
  const { vault, m } = await setup();
  await vault.saveKeys({ vaultKey });
  await vault.protect(prf);
  const stored = m.get('deviceKeys');
  await vault.saveKeys({ vaultKey: new Uint8Array(32).fill(1) });
  assert.equal(m.get('deviceKeys'), stored);
  await vault.saveKeys({ vaultKey: new Uint8Array(32).fill(1) }, prf);
  assert.equal(await vault.mode(), 'fingerprint');
  assert.deepEqual((await vault.loadKeys(prf))?.vaultKey, new Uint8Array(32).fill(1));
});

test('unprotect returns to device mode', async () => {
  const { vault } = await setup();
  await vault.saveKeys({ vaultKey, loginToken });
  await vault.protect(prf);
  await vault.unprotect(prf);
  assert.equal(await vault.mode(), 'device');
  assert.deepEqual((await vault.loadKeys())?.vaultKey, vaultKey);
  assert.deepEqual((await vault.loadKeys())?.loginToken, loginToken);
});

test('protect and unprotect with the wrong secret change nothing', async () => {
  const { vault, m } = await setup();
  await vault.saveKeys({ vaultKey });
  await vault.protect(prf);
  const stored = m.get('deviceKeys');
  await vault.unprotect(new Uint8Array(32).fill(4));
  assert.equal(m.get('deviceKeys'), stored);
  assert.equal(await vault.mode(), 'fingerprint');
});

test('account key round-trips and survives clearKeys', async () => {
  const { vault } = await setup();
  assert.equal(await vault.loadAccountKey(), null);
  const ak = new Uint8Array(32).fill(5);
  await vault.saveAccountKey(ak);
  await vault.saveKeys({ vaultKey });
  await vault.clearKeys();
  assert.deepEqual(await vault.loadAccountKey(), ak);
});

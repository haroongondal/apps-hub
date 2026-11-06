import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KDF_FLOOR, randomBytes } from '../crypto.ts';
import type { KdfParams } from '../crypto.ts';
import { createVault, withNewPassword } from '../format.ts';
import type { Header } from '../format.ts';
import { generateRecoveryKey } from '../recovery-key.ts';
import { adoptHeader } from '../sync/header-adopt.ts';

const PASSWORD = 'old master password';
const NEW_PASSWORD = 'new master password';
const fake = (kdf: KdfParams, accountKey = true): Header => {
  const h: Header = { version: 1, kdf, salt: new Uint8Array(16), passwordWrap: new Uint8Array(60), recoveryWrap: new Uint8Array(60) };
  if (accountKey) h.accountKey = true;
  return h;
};

test('refusesWeakerHeader', async () => {
  const key = randomBytes(20);
  const { header: remote, vaultKey } = await createVault(PASSWORD, generateRecoveryKey(), { kdf: KDF_FLOOR, accountKey: key });
  // The remote opens to this vault key with this password, so only the strength checks can refuse it.
  assert.deepEqual(await adoptHeader(fake(KDF_FLOOR), remote, PASSWORD, key, vaultKey), remote);
  for (const held of [{ ...KDF_FLOOR, memoryKiB: 65536 }, { ...KDF_FLOOR, iterations: 3 }, { ...KDF_FLOOR, parallelism: 2 }]) {
    assert.equal(await adoptHeader(fake(held), remote, PASSWORD, key, vaultKey), 'refused', JSON.stringify(held));
  }
  for (const kdf of [{ ...KDF_FLOOR, memoryKiB: 2 * 1048576 }, { ...KDF_FLOOR, iterations: 17 }, { ...KDF_FLOOR, memoryKiB: 32768.5 }, { ...KDF_FLOOR, memoryKiB: 1024 }]) {
    assert.equal(await adoptHeader(fake(KDF_FLOOR), { ...remote, kdf }, PASSWORD, key, vaultKey), 'refused', JSON.stringify(kdf));
  }
});

test('refusesDroppedAccountKeyFlag', async () => {
  const key = randomBytes(20);
  const { header, vaultKey } = await createVault(PASSWORD, generateRecoveryKey(), { kdf: KDF_FLOOR, accountKey: key });
  const { accountKey: _, ...stripped } = header;
  // The stripped header still opens with the key mixed in, so only the flag check refuses it.
  assert.equal(await adoptHeader(header, stripped, PASSWORD, key, vaultKey), 'refused');
  assert.equal(await adoptHeader({ ...stripped }, stripped, PASSWORD, key, vaultKey), 'refused');
});

test('adoptsHeaderOnlyWithNewPasswordAndSameVaultKey', async () => {
  const key = randomBytes(20);
  const { header: local, vaultKey } = await createVault(PASSWORD, generateRecoveryKey(), { kdf: KDF_FLOOR, accountKey: key });
  const changed = await withNewPassword(local, vaultKey, NEW_PASSWORD, { accountKey: key });
  assert.deepEqual(await adoptHeader(local, changed, NEW_PASSWORD, key, vaultKey), changed);
  assert.equal(await adoptHeader(local, changed, PASSWORD, key, vaultKey), 'refused');
  assert.equal(await adoptHeader(local, changed, NEW_PASSWORD, randomBytes(20), vaultKey), 'refused');
  const { header: other } = await createVault(NEW_PASSWORD, generateRecoveryKey(), { kdf: KDF_FLOOR, accountKey: key });
  assert.equal(await adoptHeader(local, other, NEW_PASSWORD, key, vaultKey), 'refused');
});

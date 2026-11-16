import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVault, recoveryLoginToken, rotateRecoveryKey, tokenHash, unlockWithPassword, unlockWithRecovery } from '../format.ts';
import { generateEmailCode, openEscrow, sealEscrow } from '../escrow.ts';
import { generateRecoveryKey } from '../recovery-key.ts';
import { LOW_FLOOR, LOW_KDF, hex, vectors } from './vectors.ts';

test('rotateRecoveryKey: the new key opens the header, the old one no longer does, the password still does', async () => {
  const oldRecovery = hex(vectors.recovery.key);
  const { header: h, vaultKey } = await createVault('a fresh master password', oldRecovery, { kdf: LOW_KDF, floor: LOW_FLOOR });
  const { header: next, recoveryKey } = await rotateRecoveryKey(h, vaultKey);
  assert.deepEqual(await unlockWithRecovery(next, recoveryKey), vaultKey);
  assert.equal(await unlockWithRecovery(next, oldRecovery), null);
  assert.deepEqual(await unlockWithPassword(next, 'a fresh master password', LOW_FLOOR), vaultKey);
});

test('rotateRecoveryKey changes only recoveryWrap (salt, kdf, passwordWrap equal)', async () => {
  const { header: h, vaultKey } = await createVault('a fresh master password', hex(vectors.recovery.key), { kdf: LOW_KDF, floor: LOW_FLOOR });
  const { header: next } = await rotateRecoveryKey(h, vaultKey);
  assert.deepEqual(next.salt, h.salt);
  assert.deepEqual(next.kdf, h.kdf);
  assert.deepEqual(next.passwordWrap, h.passwordWrap);
  assert.equal(next.version, h.version);
  assert.equal(next.accountKey, h.accountKey);
  assert.notDeepEqual(next.recoveryWrap, h.recoveryWrap);
});

test('rotateRecoveryKey recoveryHash matches tokenHash(recoveryLoginToken(newKey))', async () => {
  const { header: h, vaultKey } = await createVault('a fresh master password', hex(vectors.recovery.key), { kdf: LOW_KDF, floor: LOW_FLOOR });
  const { recoveryKey, recoveryHash } = await rotateRecoveryKey(h, vaultKey);
  assert.equal(recoveryHash, tokenHash(recoveryLoginToken(recoveryKey)));
});

test('escrow round-trips', async () => {
  const code = generateEmailCode();
  const recoveryKey = generateRecoveryKey();
  const accountKey = generateRecoveryKey();
  const blob = await sealEscrow(code, { recoveryKey, accountKey });
  const opened = await openEscrow(code, blob);
  assert.ok(opened);
  assert.deepEqual(opened.recoveryKey, recoveryKey);
  assert.deepEqual(opened.accountKey, accountKey);
});

test('escrow with a wrong code is null', async () => {
  const code = generateEmailCode();
  const wrong = generateEmailCode();
  const blob = await sealEscrow(code, { recoveryKey: generateRecoveryKey(), accountKey: generateRecoveryKey() });
  assert.equal(await openEscrow(wrong, blob), null);
});

test('escrow with a flipped byte is null', async () => {
  const code = generateEmailCode();
  const blob = await sealEscrow(code, { recoveryKey: generateRecoveryKey(), accountKey: generateRecoveryKey() });
  blob[blob.length - 1] ^= 1;
  assert.equal(await openEscrow(code, blob), null);
});

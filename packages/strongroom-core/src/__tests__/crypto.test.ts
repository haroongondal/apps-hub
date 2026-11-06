import assert from 'node:assert/strict';
import { test } from 'node:test';
import { argon2id, hkdf, open, randomBytes, seal, utf8 } from '../crypto.ts';
import { hex, LOW_KDF, toHex, vectors } from './vectors.ts';

const salt = hex(vectors.salt);

test('argon2id derives the master key of the shared vector', async () => {
  assert.equal(toHex(await argon2id(vectors.password.text, salt, LOW_KDF)), vectors.password.masterKey);
});

test('a master password is normalised to NFC before it is hashed', async () => {
  const nfd = toHex(await argon2id(vectors.nfdPassword.nfd, salt, LOW_KDF));
  const nfc = toHex(await argon2id(vectors.nfdPassword.nfc, salt, LOW_KDF));
  assert.equal(nfd, vectors.nfdPassword.masterKey);
  assert.equal(nfc, vectors.nfdPassword.masterKey);
});

test('Urdu and emoji passwords derive the vectors computed outside Strongroom', async () => {
  assert.equal(toHex(await argon2id(vectors.urduPassword.text, salt, LOW_KDF)), vectors.urduPassword.masterKey);
  assert.equal(toHex(await argon2id(vectors.emojiPassword.text, salt, LOW_KDF)), vectors.emojiPassword.masterKey);
});

test('hkdf splits the master key into the wrap key and the login token', () => {
  const master = hex(vectors.password.masterKey);
  assert.equal(toHex(hkdf(master, 'strongroom/v1/wrap')), vectors.password.wrapKey);
  assert.equal(toHex(hkdf(master, 'strongroom/v1/login')), vectors.password.loginToken);
});

test('hkdf of the recovery key gives the recovery wrap key and login token', () => {
  const key = hex(vectors.recovery.key);
  assert.equal(toHex(hkdf(key, 'strongroom/v1/wrap')), vectors.recovery.wrapKey);
  assert.equal(toHex(hkdf(key, 'strongroom/v1/login')), vectors.recovery.loginToken);
});

test('open decrypts a value sealed by the Android app', async () => {
  const wrapKey = hex(vectors.password.wrapKey);
  const aad = utf8(vectors.passwordWrap.aad);
  const opened = await open(wrapKey, hex(vectors.passwordWrap.sealed), aad);
  assert.ok(opened);
  assert.equal(toHex(opened), vectors.vaultKey);
});

test('seal then open returns the plaintext, with a fresh nonce each time', async () => {
  const key = randomBytes(32);
  const aad = utf8('strongroom/v1/test');
  const a = await seal(key, utf8('hello'), aad);
  const b = await seal(key, utf8('hello'), aad);
  assert.notEqual(toHex(a), toHex(b));
  assert.equal(a.length, 12 + 5 + 16);
  assert.deepEqual(await open(key, a, aad), utf8('hello'));
});

test('open returns null for the wrong key, the wrong aad, a flipped byte or a short input', async () => {
  const key = randomBytes(32);
  const aad = utf8('strongroom/v1/test');
  const sealed = await seal(key, utf8('secret'), aad);
  assert.equal(await open(randomBytes(32), sealed, aad), null);
  assert.equal(await open(key, sealed, utf8('strongroom/v1/other')), null);
  const flipped = sealed.slice();
  flipped[flipped.length - 1] ^= 1;
  assert.equal(await open(key, flipped, aad), null);
  assert.equal(await open(key, new Uint8Array(27), aad), null);
});

test('utf8 turns a lone surrogate into U+FFFD, as the Android app does', () => {
  assert.equal(toHex(utf8('a\ud800b')), '61efbfbd62');
});

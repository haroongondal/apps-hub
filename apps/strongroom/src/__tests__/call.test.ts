import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriving, isLocked, messageOf, whileDeriving } from '../call.ts';

// expo-modules-core 3.0.30 wraps every function failure: FunctionCallException (CodedException.kt) keeps the cause's code and sets
// message = "Call to function '<module>.<fn>' has been rejected.\n→ Caused by: <cause message>". Async calls reach JS through
// Promise.reject(exception.code, exception.localizedMessage) and sync calls through rethrowAsCodedError (Exceptions.cpp), the same two values.
const rejected = (code: string, message: string) =>
  Object.assign(new Error(`Call to function 'StrongroomVault.unlock' has been rejected.\n→ Caused by: ${message}`), { code });

test('messageOf shows the bridge message without the Expo wrapper', () => {
  const refused = "Strongroom won't open this vault: its security settings are weaker than it allows. The vault file may have been changed.";
  assert.equal(messageOf(rejected('KDF_OUT_OF_RANGE', refused)), refused);
  assert.equal(messageOf(Object.assign(new Error('Pick the file again.'), { code: 'IMPORT_ERROR' })), 'Pick the file again.');
});

test('messageOf hides unexpected errors behind a plain sentence', () => {
  for (const e of [rejected('ERR_UNEXPECTED', 'java.lang.NullPointerException'), new Error('boom'), 'boom', null]) {
    assert.match(messageOf(e), /^Something went wrong/);
  }
});

test('isLocked reads the LOCKED code', () => {
  assert.equal(isLocked(rejected('LOCKED', 'Strongroom is locked.')), true);
  assert.equal(isLocked(rejected('NOT_SET_UP', 'x')), false);
  assert.equal(isLocked(undefined), false);
});

test('deriving is true only while a call is pending', async () => {
  assert.equal(deriving(), false);
  let release = () => {};
  const call = whileDeriving(() => new Promise<void>((resolve) => (release = resolve)));
  assert.equal(deriving(), true);
  release();
  await call;
  assert.equal(deriving(), false);
  await assert.rejects(whileDeriving(() => Promise.reject(new Error('x'))));
  assert.equal(deriving(), false);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatRecoveryKey, generateRecoveryKey, recoveryKeyGroup, parseRecoveryKey } from '../recovery-key.ts';

test('generate gives 20 random bytes', () => {
  const a = generateRecoveryKey();
  assert.equal(a.length, 20);
  assert.notDeepEqual(a, generateRecoveryKey());
});

test('the formatted key is eight groups of four', () => {
  assert.match(formatRecoveryKey(generateRecoveryKey()), /^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
});

test('format matches the RFC 4648 base32 vectors', () => {
  const foobar = new TextEncoder().encode('foobafoobafoobafooba');
  assert.equal(formatRecoveryKey(foobar), 'MZXW-6YTB-MZXW-6YTB-MZXW-6YTB-MZXW-6YTB');
  assert.equal(formatRecoveryKey(new Uint8Array(20)), 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA');
  assert.equal(formatRecoveryKey(new Uint8Array(20).fill(255)), '7777-7777-7777-7777-7777-7777-7777-7777');
});

test('parse round-trips and tolerates case, spaces and dashes', () => {
  for (let i = 0; i < 100; i++) {
    const b = generateRecoveryKey();
    const f = formatRecoveryKey(b);
    assert.deepEqual(parseRecoveryKey(f), b);
    assert.deepEqual(parseRecoveryKey(f.toLowerCase().replaceAll('-', ' ')), b);
    assert.deepEqual(parseRecoveryKey(`  ${f.replaceAll('-', '').toLowerCase()}\n`), b);
  }
});

test('parse rejects a wrong length and characters outside the alphabet', () => {
  const f = formatRecoveryKey(generateRecoveryKey());
  for (const bad of ['', 'ABCD-EFGH', `${f}A`, f.slice(0, -1)]) assert.equal(parseRecoveryKey(bad), null, bad);
  for (const c of ['1', '8', '0', '9', '=', '!', 'ß']) assert.equal(parseRecoveryKey(c + f.slice(1)), null, c);
});

test('group returns the indexed group', () => {
  const f = 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567';
  assert.equal(recoveryKeyGroup(f, 0), 'ABCD');
  assert.equal(recoveryKeyGroup(f, 3), 'MNOP');
  assert.equal(recoveryKeyGroup(f, 7), '4567');
});

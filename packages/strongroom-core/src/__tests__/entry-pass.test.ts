import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeEntry, encodeEntry, isIsoDate } from '../entry.ts';
import type { Entry, Pass } from '../entry.ts';

// The same literal is asserted in the Kotlin EntryJsonTest, so both encoders are pinned to one string.
const PINNED = '{"type":"pass","name":"Gym \\"Club\\"","code":"1234567890128","format":"ean13","note":"desk\\nopen 6-22","updatedAt":1700000004000}';
const pass: Pass = { type: 'pass', name: 'Gym "Club"', code: '1234567890128', format: 'ean13', note: 'desk\nopen 6-22', updatedAt: 1_700_000_004_000 };

test('a pass encodes to the pinned string and reads back', () => {
  assert.equal(encodeEntry(pass), PINNED);
  assert.deepEqual(decodeEntry(PINNED), pass);
});

test('every pass format round trips', () => {
  for (const format of ['qr', 'code128', 'ean13'] as const) {
    const e: Entry = { ...pass, format, code: 'https://example.com/a?b=1', note: '' };
    assert.deepEqual(decodeEntry(encodeEntry(e)), e);
  }
});

test('a malformed pass is rejected', () => {
  const ok = JSON.parse(PINNED) as Record<string, unknown>;
  assert.notEqual(decodeEntry(JSON.stringify(ok)), null);
  const bad: Record<string, unknown>[] = [
    { ...ok, format: 'aztec' },
    { ...ok, format: 'QR' },
    { ...ok, format: 5 },
    { ...ok, format: null },
    { ...ok, code: 5 },
    { ...ok, name: null },
    { ...ok, note: undefined },
    { ...ok, updatedAt: '5' },
  ];
  for (const b of bad) assert.equal(decodeEntry(JSON.stringify(b)), null, JSON.stringify(b));
  const { format: _f, ...noFormat } = ok;
  assert.equal(decodeEntry(JSON.stringify(noFormat)), null);
});

test('a type from a newer build reads as null, not as a throw', () => {
  assert.equal(decodeEntry('{"type":"passkey","name":"n","updatedAt":5}'), null);
});

// Additive field: a pass without a date encodes to PINNED above (unchanged); one with a date adds a single key. The same literal is asserted in Kotlin's EntryJsonTest.
const PINNED_EXPIRES = '{"type":"pass","name":"Gym \\"Club\\"","code":"1234567890128","format":"ean13","note":"desk\\nopen 6-22","expiresOn":"2027-03-31","updatedAt":1700000004000}';

test('an optional expiry date is one extra key, absent when unset', () => {
  const dated: Pass = { ...pass, expiresOn: '2027-03-31' };
  assert.equal(encodeEntry(dated), PINNED_EXPIRES);
  assert.deepEqual(decodeEntry(PINNED_EXPIRES), dated);
  assert.equal('expiresOn' in decodeEntry(PINNED)!, false);
});

test('a reader ignores a key it does not know, so a field added later never makes a pass unreadable', () => {
  const o = JSON.parse(PINNED) as Record<string, unknown>;
  assert.deepEqual(decodeEntry(JSON.stringify({ ...o, someFutureKey: { a: 1 } })), pass);
});

test('a date that does not read is dropped and the pass stays', () => {
  const ok = JSON.parse(PINNED_EXPIRES) as Record<string, unknown>;
  for (const bad of ['soon', '2027-13-01', '2027-02-30', '27-03-31', '2027-3-31', '1999-12-31', 5, null]) {
    assert.deepEqual(decodeEntry(JSON.stringify({ ...ok, expiresOn: bad })), pass, String(bad));
  }
  assert.equal(isIsoDate('2028-02-29'), true);
  assert.equal(isIsoDate('2027-02-29'), false);
});

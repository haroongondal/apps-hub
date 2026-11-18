import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeEntry, encodeEntry } from '../entry.ts';
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

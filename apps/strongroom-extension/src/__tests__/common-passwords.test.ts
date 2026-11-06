import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { COMMON_PASSWORDS } from '../common-passwords.ts';

test('commonPasswordListsAgree', () => {
  const phone = readFileSync(new URL('../../../strongroom/src/common-passwords.ts', import.meta.url), 'utf8');
  const entries = [...phone.slice(phone.indexOf('new Set([')).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(entries.length, 10);
  assert.deepEqual([...COMMON_PASSWORDS].sort(), [...entries].sort());
});

test('every entry is lowercase, so a lowercased password is looked up as it is', () => {
  for (const p of COMMON_PASSWORDS) assert.equal(p, p.toLowerCase());
});

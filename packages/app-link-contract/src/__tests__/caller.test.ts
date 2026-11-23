import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { decideCaller } from '../index.ts';

const cases: { isSelf: boolean; holdsPermission: boolean; signatureMatches: boolean; allow: boolean; reason: string }[] = JSON.parse(
  fs.readFileSync(new URL('../../fixtures/caller-decisions.json', import.meta.url), 'utf8'),
);

test('fixture covers all 8 combinations', () => {
  assert.equal(cases.length, 8);
  assert.equal(new Set(cases.map((c) => `${c.isSelf}${c.holdsPermission}${c.signatureMatches}`)).size, 8);
});

test('decideCaller matches every fixture row', () => {
  for (const c of cases) {
    const { allow, reason } = decideCaller(c);
    assert.deepEqual({ allow, reason }, { allow: c.allow, reason: c.reason }, JSON.stringify(c));
  }
});

test('a fake non-signature caller is refused', () => {
  assert.deepEqual(decideCaller({ isSelf: false, holdsPermission: false, signatureMatches: false }), { allow: false, reason: 'no-permission' });
});

test('a squatter holding the permission name with another signature is refused', () => {
  assert.deepEqual(decideCaller({ isSelf: false, holdsPermission: true, signatureMatches: false }), { allow: false, reason: 'signature-mismatch' });
});

test('fails closed on missing or non-boolean fields', () => {
  const loose = decideCaller as (f: unknown) => { allow: boolean; reason: string };
  for (const facts of [{}, { isSelf: 'yes', holdsPermission: 'yes', signatureMatches: 'yes' }, { holdsPermission: true }, { isSelf: 1 }, undefined, null]) {
    assert.equal(loose(facts).allow, false, JSON.stringify(facts));
  }
  assert.deepEqual(loose({ holdsPermission: true, signatureMatches: 'yes' }), { allow: false, reason: 'signature-mismatch' });
});

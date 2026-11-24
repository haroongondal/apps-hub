import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { defineAction, validateExtras } from '../index.ts';
import type { ExtraSpec } from '../index.ts';

// fixtures/extras-cases.json is read by this test and by Inflow's AppLinkGuardTest.kt: one table, both sides.
// `{ "repeat": "x", "n": 2000 }` stands for a string of 2000 x. `reason` is a hint for readers; only ok / not ok is compared.
interface Case { name: string; spec: Record<string, ExtraSpec>; raw: Record<string, unknown>; ok: boolean; reason?: string }
const cases: Case[] = JSON.parse(fs.readFileSync(new URL('../../fixtures/extras-cases.json', import.meta.url), 'utf8'));

const expand = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(expand)
    : typeof v === 'object' && v !== null && 'repeat' in v ? (v as { repeat: string }).repeat.repeat((v as unknown as { n: number }).n)
      : v;

test('the table covers accepts and refusals', () => {
  assert.ok(cases.length >= 30);
  assert.ok(cases.some((c) => c.ok) && cases.some((c) => !c.ok));
  assert.equal(new Set(cases.map((c) => c.name)).size, cases.length, 'case names are unique');
});

for (const c of cases) {
  test(`extras case: ${c.name}`, () => {
    const action = defineAction({ app: 'deputy', name: 'CASE', screen: true, description: 'd', extras: c.spec });
    const raw = Object.fromEntries(Object.entries(c.raw).map(([k, v]) => [k, expand(v)]));
    const r = validateExtras(action, raw);
    assert.equal(r.ok, c.ok, r.ok ? 'accepted' : r.reason);
  });
}

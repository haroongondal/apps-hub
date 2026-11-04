import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { nextGifAttempt } from '../gif.ts';
import type { GifPlan } from '../types.ts';

// The same cases the Kotlin RetryRuleTest reads (SPEC §10.5), so the two rules cannot drift apart.
interface GifCase { name: string; plan: GifPlan; actualBytes: number; expect: { ok: boolean; attempt?: number; width?: number; fps?: number } }
const read = (name: string) => JSON.parse(fs.readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8'));
const { cases } = read('gif-cases.json') as { cases: GifCase[] };

for (const c of cases) {
  test(`gif retry: ${c.name}`, () => {
    const got = nextGifAttempt(c.plan, c.actualBytes);
    assert.equal(got.ok, c.expect.ok);
    if (got.ok) assert.deepEqual([got.plan.attempt, got.plan.width, got.plan.fps], [c.expect.attempt, c.expect.width, c.expect.fps]);
  });
}

test('plan examples: every tool the phone runs has one example the Kotlin decoder reads', () => {
  const { plans } = read('plan-examples.json') as { plans: Record<string, { tool: string }> };
  assert.deepEqual([...new Set(Object.values(plans).map(p => p.tool))].sort(),
    ['audio', 'clip', 'convert', 'frame', 'gif', 'quality', 'reverse', 'size', 'stabilize', 'volume']);
});

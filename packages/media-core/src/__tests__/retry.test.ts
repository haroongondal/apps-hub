import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { nextSizeAttempt } from '../retry.ts';
import type { SizePlan } from '../types.ts';

interface RetryCase {
  name: string;
  plan: SizePlan;
  actualBytes: number;
  expect: { ok: boolean; reason?: string; attempt?: number; rung?: SizePlan['rung']; videoBps?: number; videoBpsApprox?: number };
}

const { cases } = JSON.parse(
  fs.readFileSync(new URL('../../fixtures/retry-cases.json', import.meta.url), 'utf8'),
) as { cases: RetryCase[] };

for (const c of cases) {
  test(`retry: ${c.name}`, () => {
    const got = nextSizeAttempt(c.plan, c.actualBytes);
    assert.equal(got.ok, c.expect.ok);
    if (!got.ok) {
      assert.equal(got.reason, c.expect.reason);
      return;
    }
    if (c.expect.attempt !== undefined) assert.equal(got.plan.attempt, c.expect.attempt);
    if (c.expect.rung) assert.deepEqual(got.plan.rung, c.expect.rung);
    if (c.expect.videoBps !== undefined) assert.equal(got.plan.videoBps, c.expect.videoBps);
    if (c.expect.videoBpsApprox !== undefined) {
      assert.ok(Math.abs(got.plan.videoBps - c.expect.videoBpsApprox) / c.expect.videoBpsApprox < 0.001,
        `videoBps ${got.plan.videoBps} is not within 0.1% of ${c.expect.videoBpsApprox}`);
    }
  });
}

test('retry: a non-finite actual size is refused, not retried', () => {
  const plan = cases[0].plan;
  assert.equal(nextSizeAttempt(plan, Number.NaN).ok, false);
});

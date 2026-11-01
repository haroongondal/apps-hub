import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { planSize } from '../budget.ts';
import type { Encoder, MediaInfo } from '../types.ts';

interface BudgetCase {
  name: string;
  info: MediaInfo;
  targetBytes: number;
  encoder: Encoder;
  expect: Record<string, unknown>;
}

const { cases } = JSON.parse(
  fs.readFileSync(new URL('../../fixtures/budget-cases.json', import.meta.url), 'utf8'),
) as { cases: BudgetCase[] };

for (const c of cases) {
  test(`budget: ${c.name}`, () => {
    const got = planSize(c.info, c.targetBytes, c.encoder);
    if (c.expect.ok === false) {
      assert.deepEqual(got, { ok: false, reason: c.expect.reason, maxDurationS: c.expect.maxDurationS });
      return;
    }
    assert.equal(got.ok, true);
    if (!got.ok) return;
    const plan = got.plan as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(c.expect)) {
      if (key === 'ok') continue;
      assert.deepEqual(plan[key], value, key);
    }
  });
}

test('budget: no video track is refused, not planned', () => {
  const info: MediaInfo = { id: 'a', name: 'song.m4a', bytes: 5_000_000, durationS: 200, container: 'm4a',
    tracks: [{ index: 0, kind: 'audio', codec: 'aac', bitrate: 128000 }] };
  assert.deepEqual(planSize(info, 4_000_000, 'hw-h264'), { ok: false, reason: 'no-video' });
});

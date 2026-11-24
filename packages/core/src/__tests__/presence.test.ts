import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { AWAY_AFTER_MISSES, UNKNOWN_PRESENCE, nextPresence, type PresenceState } from '../presence.ts';

interface Case {
  name: string;
  awayAfter: number;
  start: PresenceState;
  steps: { answered: boolean; now: number }[];
  expect: PresenceState[];
}

const cases: Case[] = JSON.parse(fs.readFileSync(new URL('../../fixtures/presence-cases.json', import.meta.url), 'utf8'));

for (const c of cases) {
  test(`presence fixture: ${c.name}`, () => {
    let state = c.start;
    c.steps.forEach((step, i) => {
      state = nextPresence(state, step.answered, step.now, c.awayAfter);
      assert.deepEqual(state, c.expect[i], `step ${i}`);
    });
  });
}

test('the fixture covers every rule and the default is three misses', () => {
  assert.equal(cases.length, 7);
  assert.equal(AWAY_AFTER_MISSES, 3);
  assert.deepEqual(nextPresence(UNKNOWN_PRESENCE, false, 10), { present: false, misses: 4, lastSeenAt: 0 });
});

test('nextPresence never mutates its input', () => {
  const prev = { present: true, misses: 1, lastSeenAt: 5 };
  nextPresence(prev, false, 9);
  assert.deepEqual(prev, { present: true, misses: 1, lastSeenAt: 5 });
});

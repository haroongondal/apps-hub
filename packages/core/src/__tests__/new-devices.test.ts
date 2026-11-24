import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  NEW_DEVICE_WINDOW_DAYS,
  deviceGuess,
  findNewDevices,
  type AliveHost,
  type KnownHost,
  type NewDeviceAlert,
  type NewDeviceContext,
} from '../new-devices.ts';

interface Case {
  name: string;
  ctx: NewDeviceContext;
  alive: AliveHost[];
  known: KnownHost[];
  alerts: NewDeviceAlert[];
  expect: string[];
}

const cases: Case[] = JSON.parse(fs.readFileSync(new URL('../../fixtures/new-device-cases.json', import.meta.url), 'utf8'));

for (const c of cases) {
  test(`new device fixture: ${c.name}`, () => {
    assert.deepEqual(findNewDevices(c.alive, c.known, c.alerts, c.ctx).map((h) => h.ip), c.expect);
  });
}

test('the fixture has its twelve cases, seven of them false-positive guards', () => {
  assert.equal(cases.length, 12);
  assert.equal(cases.filter((c) => c.name.startsWith('false positive')).length, 7);
  assert.equal(NEW_DEVICE_WINDOW_DAYS, 30);
});

test('deviceGuess names only what a port says in plain words', () => {
  assert.equal(deviceGuess(62078), 'iPhone or iPad');
  assert.equal(deviceGuess(445), 'Computer');
  assert.equal(deviceGuess(80), 'Unknown device');
  assert.equal(deviceGuess(null), 'Unknown device');
});

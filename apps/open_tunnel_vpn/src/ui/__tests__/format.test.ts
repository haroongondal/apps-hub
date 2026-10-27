/**
 * Presentation formatter tests (node --test).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVpnNode } from 'open-tunnel-core';

import {
  countryLabel,
  fitnessLabel,
  formatBytes,
  formatDuration,
  rttLabel,
  speedLabel,
} from '../format.ts';
import { withProbe } from 'open-tunnel-core';

function node(overrides: {
  countryShort?: string;
  countryLong?: string;
  pingMs?: number;
  speedBps?: number;
  fitnessScore?: number;
  measuredRttMs?: number | null;
}) {
  const base = createVpnNode({
    hostName: 'relay-1',
    ip: '203.0.113.7',
    port: 1194,
    transportProto: 'udp',
    score: 100,
    pingMs: overrides.pingMs ?? 30,
    speedBps: overrides.speedBps ?? 50_000_000,
    countryLong: overrides.countryLong ?? 'Japan',
    countryShort: overrides.countryShort ?? 'JP',
    numSessions: 4,
    uptimeMs: 86_400_000,
    operatorName: 'testsuite',
    ovpnConfigRaw: 'client\n',
  });
  return withProbe(base, {
    measuredRttMs: overrides.measuredRttMs ?? null,
    fitnessScore: overrides.fitnessScore ?? 0,
  });
}

test('formatBytes reads like a meter', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB');
  assert.equal(formatBytes(-5), '0 B');
  assert.equal(formatBytes(Number.NaN), '0 B');
});

test('formatDuration spans seconds to hours', () => {
  assert.equal(formatDuration(45), '45 s');
  assert.equal(formatDuration(90), '1 min 30 s');
  assert.equal(formatDuration(4500), '1 h 15 min');
  assert.equal(formatDuration(-1), '0 s');
});

test('countryLabel renders the ISO code with the long name, never emoji', () => {
  assert.equal(countryLabel(node({})), 'JP · Japan');
  assert.equal(countryLabel(node({ countryLong: '' })), 'JP');
  assert.equal(countryLabel(node({ countryShort: '', countryLong: '' })), '--');
});

test('rttLabel marks provenance: listed until measured', () => {
  assert.equal(rttLabel(node({})), '30 ms listed');
  assert.equal(rttLabel(node({ measuredRttMs: 41.6 })), '42 ms measured');
});

test('speedLabel scales the bits-per-second column', () => {
  assert.equal(speedLabel(node({ speedBps: 52_400_000 })), '52 Mbps');
  assert.equal(speedLabel(node({ speedBps: 4_200_000 })), '4.2 Mbps');
});

test('fitnessLabel stays blank until a probe exists', () => {
  assert.equal(fitnessLabel(node({})), 'fitness — not probed');
  assert.equal(fitnessLabel(node({ measuredRttMs: 20, fitnessScore: 61.25 })), 'fitness 61.3');
});

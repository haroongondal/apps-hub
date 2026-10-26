/**
 * VpnNode model test suite (node --test).
 * Covers: sha256 endpoint identity, fitness formula parity with the
 * contracted weights, fallback RTT before probing, and copy/probe
 * immutability guarantees. Port of the Dart `model identity and scoring`
 * test group.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  createVpnNode,
  nodeEquals,
  nodeLabel,
  speedMbps,
  uptimeSec,
  vpnNodeIdFor,
  withProbe,
  type VpnNode,
} from '../vpn-node.ts';
import { computeFitnessScore } from '../fitness.ts';
import { makeNode } from './fixtures.ts';

test('node id is the sha256 hex of ip:port', () => {
  const expected = crypto
    .createHash('sha256')
    .update('219.100.37.110:1195')
    .digest('hex');
  assert.equal(makeNode().id, expected);
  assert.equal(
    vpnNodeIdFor('219.100.37.110', 1195),
    'baa9aca5f9aae27e0a262180dd619a6f47c0a92fdc54398f79606f084cdd6107',
  );
  // Different endpoint ⇒ different identity.
  assert.notEqual(vpnNodeIdFor('219.100.37.110', 1194), expected);
});

test('fitness formula matches the contracted weights', () => {
  // Falls back to the static ping (20 ms) because no probe ran.
  const node = makeNode();
  const speed = 183.498662;
  const rttMs = 20;
  const uptimeSeconds = 112305311;
  const sessions = 100;
  const expected =
    40 * (speed / 100) -
    0.35 * rttMs +
    10 * (Math.log(uptimeSeconds + 1) / Math.LN10) -
    0.15 * sessions;
  assert.ok(Math.abs(computeFitnessScore(node) - expected) < 0.01);
});

test('fallback RTT equals the static ping before any probe', () => {
  const node = makeNode();
  assert.equal(node.measuredRttMs, null);
  assert.equal(
    computeFitnessScore(node),
    computeFitnessScore(withProbe(node, { measuredRttMs: 20 })),
  );
});

test('probe fields replaced without mutation and copies stay distinct', () => {
  const original = makeNode();
  const probed = withProbe(original, { measuredRttMs: 42, fitnessScore: 98.5 });

  assert.equal(original.measuredRttMs, null);
  assert.equal(original.fitnessScore, 0.0);
  assert.equal(probed.measuredRttMs, 42);
  assert.equal(probed.fitnessScore, 98.5);
  assert.equal(probed.id, original.id);
  assert.ok(nodeEquals(probed, original)); // identity equality follows id
  assert.notEqual(probed, original);
  assert.ok(Object.isFrozen(original));
});

test('derived getters: speed, uptime seconds, and label', () => {
  const node = makeNode();
  assert.ok(Math.abs(speedMbps(node) - 183.498662) < 0.000001);
  assert.equal(uptimeSec(node), 112305311); // ms → sec drop
  assert.equal(nodeLabel(node), 'JP/public-vpn-155:1195');
});

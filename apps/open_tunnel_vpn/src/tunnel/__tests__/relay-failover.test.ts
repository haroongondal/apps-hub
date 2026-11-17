/**
 * Relay failover policy tests (node --test): candidate selection (skip
 * failed relays, cap per pass) and the auth-error rule the app shell
 * applies to native failure codes. Pure module, no binding needed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createVpnNode, type VpnNode } from 'open-tunnel-core';
import { OPEN_TUNNEL_ERROR_CODES } from 'open-tunnel-native';
import { MAX_ATTEMPTS, isAuthError, pickRelayCandidates } from '../relay-failover.ts';

function relay(rank: number): VpnNode {
  return createVpnNode({
    hostName: `relay-${rank}`,
    ip: `203.0.113.${rank}`,
    port: 1194 + rank,
    transportProto: 'udp',
    score: 100 - rank,
    pingMs: 20 + rank,
    speedBps: 1_000_000,
    countryLong: 'Testland',
    countryShort: 'TS',
    numSessions: 0,
    uptimeMs: 0,
    operatorName: 'testsuite',
    // Configless shape: candidate picking happens before any payload fetch.
    ovpnConfigRaw: '',
  });
}

test('candidates skip relays that already failed and keep ranked order', () => {
  const ranked = [relay(1), relay(2), relay(3), relay(4)];
  const failedIds = new Set([ranked[1]!.id, ranked[3]!.id]);
  const picks = pickRelayCandidates(ranked, failedIds, MAX_ATTEMPTS);
  assert.deepEqual(
    picks.map((node) => node.hostName),
    ['relay-1', 'relay-3'],
  );
});

test('candidates cap at maxAttempts (6) per pass', () => {
  assert.equal(MAX_ATTEMPTS, 6, 'the raised failure limit is part of the policy');
  const ranked = Array.from({ length: 10 }, (_, index) => relay(index + 1));
  const picks = pickRelayCandidates(ranked, new Set(), MAX_ATTEMPTS);
  assert.equal(picks.length, 6);
  assert.deepEqual(picks, ranked.slice(0, 6), 'the cap keeps the head of the ranking');
});

test('an empty ranked list yields no candidates', () => {
  assert.deepEqual(pickRelayCandidates([], new Set(), MAX_ATTEMPTS), []);
});

test('isAuthError is true only for the auth-failure code', () => {
  assert.equal(isAuthError(OPEN_TUNNEL_ERROR_CODES.AUTH_FAILED), true);
  assert.equal(isAuthError(OPEN_TUNNEL_ERROR_CODES.SERVICE_START_FAILED), false);
  assert.equal(isAuthError(OPEN_TUNNEL_ERROR_CODES.ENGINE_UNAVAILABLE), false);
  assert.equal(isAuthError(OPEN_TUNNEL_ERROR_CODES.INVALID_CONFIG), false);
  assert.equal(isAuthError(null), false);
});

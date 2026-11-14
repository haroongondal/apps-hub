/**
 * Shield state tests (node --test): the tone, busy-ness, and copy each
 * tunnel state renders with on the docked shield.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVpnNode } from 'open-tunnel-core';

import type { VpnNode } from 'open-tunnel-core';
import type { TunnelSnapshot } from '../../tunnel/tunnel-client.ts';
import { shieldBusy, shieldCopy, shieldTone } from '../shield-state.ts';

function node(): VpnNode {
  return createVpnNode({
    hostName: 'relay-1',
    ip: '203.0.113.7',
    port: 1194,
    transportProto: 'udp',
    score: 100,
    pingMs: 30,
    speedBps: 50_000_000,
    countryLong: 'Japan',
    countryShort: 'JP',
    numSessions: 4,
    uptimeMs: 86_400_000,
    operatorName: 'testsuite',
    ovpnConfigRaw: 'client\n',
  });
}

function snapshot(state: TunnelSnapshot['state']): TunnelSnapshot {
  return { state, message: null, code: null, traffic: null };
}

test('every contract state renders its own tone', () => {
  assert.equal(shieldTone('disconnected'), 'neutral');
  assert.equal(shieldTone('connected'), 'ok');
  assert.equal(shieldTone('error'), 'danger');
  assert.equal(shieldTone('connecting'), 'warn');
  assert.equal(shieldTone('reasserting'), 'warn');
  assert.equal(shieldTone('disconnecting'), 'warn');
});

test('only the transient states count as busy', () => {
  assert.equal(shieldBusy('connecting'), true);
  assert.equal(shieldBusy('reasserting'), true);
  assert.equal(shieldBusy('disconnecting'), true);
  assert.equal(shieldBusy('disconnected'), false);
  assert.equal(shieldBusy('connected'), false);
  assert.equal(shieldBusy('error'), false);
});

test('connected copy offers the disconnect and names the relay', () => {
  const copy = shieldCopy(snapshot('connected'), node(), false);
  assert.equal(copy.title, 'Connected');
  assert.equal(copy.subtitle, 'JP · Japan · relay-1');
  assert.equal(copy.action, 'Tap to disconnect');
});

test('connecting and reasserting copy offers cancel', () => {
  assert.equal(shieldCopy(snapshot('connecting'), node(), false).title, 'Connecting to JP · Japan');
  assert.equal(shieldCopy(snapshot('connecting'), null, false).title, 'Connecting');
  assert.equal(shieldCopy(snapshot('connecting'), node(), false).action, 'Tap to cancel');
  assert.equal(shieldCopy(snapshot('reasserting'), null, false).title, 'Reconnecting');
  assert.equal(shieldCopy(snapshot('reasserting'), null, false).action, 'Tap to cancel');
});

test('disconnecting copy states the transition instead of deferring wording', () => {
  const copy = shieldCopy(snapshot('disconnecting'), null, false);
  assert.equal(copy.title, 'Disconnecting');
  assert.equal(copy.subtitle, 'Closing the tunnel');
  assert.equal(copy.action, 'The tunnel is turning off');
});

test('error copy sends the next tap to a fresh relay', () => {
  assert.equal(shieldCopy(snapshot('error'), null, false).subtitle, 'Tap to find another relay');
  assert.equal(shieldCopy(snapshot('error'), null, true).subtitle, 'Measuring relays');
  assert.equal(shieldCopy(snapshot('error'), null, false).action, 'Connects the fastest relay that answers');
});

test('disconnected copy points at the relay to connect or a fresh scan', () => {
  assert.equal(shieldCopy(snapshot('disconnected'), node(), false).subtitle, 'Tap to connect to JP · Japan');
  assert.equal(shieldCopy(snapshot('disconnected'), null, false).subtitle, 'Tap to find the fastest relay');
  assert.equal(shieldCopy(snapshot('disconnected'), null, true).subtitle, 'Measuring relays');
  assert.equal(shieldCopy(snapshot('disconnected'), null, false).title, 'Not connected');
});

test('all copy is sentence case with no emoji', () => {
  const states: TunnelSnapshot['state'][] = [
    'disconnected',
    'connecting',
    'connected',
    'reasserting',
    'disconnecting',
    'error',
  ];
  for (const state of states) {
    for (const scanning of [false, true]) {
      for (const withNode of [false, true]) {
        const copy = shieldCopy(snapshot(state), withNode ? node() : null, scanning);
        for (const text of [copy.title, copy.subtitle, copy.action]) {
          assert.match(text, /^[A-Z]/, `${state}: "${text}" must start sentence case`);
          assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, `${state}: "${text}" must not carry emoji`);
          assert.equal(text, text.trim(), `${state}: "${text}" must have no stray whitespace`);
        }
      }
    }
  }
});

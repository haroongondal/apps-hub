import test from 'node:test';
import assert from 'node:assert/strict';

import type { VpnStatusState } from 'open-tunnel-native';
import { killSwitchView, lockdownHint } from '../kill-switch.ts';

const STATES: VpnStatusState[] = ['disconnected', 'connecting', 'connected', 'disconnecting', 'reasserting', 'error'];

test('a live tunnel reads as connected whatever the block says', () => {
  for (const blocking of [true, false]) {
    assert.equal(killSwitchView('connected', blocking, false), 'connected');
    assert.equal(killSwitchView('reasserting', blocking, false), 'connected');
  }
});

test('without the block every other state is off', () => {
  for (const state of STATES.filter((s) => s !== 'connected' && s !== 'reasserting')) {
    assert.equal(killSwitchView(state, false, true), 'off', state);
  }
});

test('the block reads as reconnecting while a relay is starting or being picked, else blocked', () => {
  assert.equal(killSwitchView('connecting', true, false), 'reconnecting');
  assert.equal(killSwitchView('error', true, true), 'reconnecting');
  assert.equal(killSwitchView('error', true, false), 'blocked');
  assert.equal(killSwitchView('disconnected', true, false), 'blocked');
});

test('the lockdown hint says what is on and what to turn on', () => {
  assert.match(lockdownHint({ alwaysOn: true, lockdown: true }).title, /Android blocks internet/);
  assert.match(lockdownHint({ alwaysOn: true, lockdown: false }).subtitle, /Also turn on Block connections without VPN/);
  for (const unknown of [{ alwaysOn: null, lockdown: null }, { alwaysOn: false, lockdown: false }]) {
    assert.match(lockdownHint(unknown).subtitle, /turn on Always-on VPN and Block connections without VPN/);
  }
});

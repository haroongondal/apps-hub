/**
 * Shield tap tests (node --test): what a tap on the connection shield does in each state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { shieldTap } from '../shield-tap.ts';

test('a tap cancels a connecting or reconnecting tunnel', () => {
  assert.equal(shieldTap('connecting'), 'stop');
  assert.equal(shieldTap('reasserting'), 'stop');
});

test('a tap disconnects a connected tunnel', () => {
  assert.equal(shieldTap('connected'), 'stop');
});

test('a tap while disconnecting does nothing', () => {
  assert.equal(shieldTap('disconnecting'), 'none');
});

test('a tap starts from disconnected and retries after an error', () => {
  assert.equal(shieldTap('disconnected'), 'connect');
  assert.equal(shieldTap('error'), 'retry');
});

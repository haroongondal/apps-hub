/**
 * Firewall status mapping tests (node --test): what the screen says about the firewall.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { FirewallStatus } from '../../../modules/open-tunnel-native/src/OpenTunnelNativeModule.ts';

import { FIREWALL_PAUSED_LINE } from '../copy.ts';
import { firewallView, serverHoldsSlot } from '../status.ts';

function status(over: Partial<FirewallStatus>): FirewallStatus {
  return { enabled: true, running: true, paused: false, usageAccess: true, ...over };
}

test('a running, enabled firewall reads On and can be changed', () => {
  const view = firewallView(status({}), false);
  assert.equal(view.label, 'On');
  assert.equal(view.detail, null);
  assert.equal(view.canStart, true);
});

test('running false reads Off, never On', () => {
  for (const enabled of [true, false]) {
    const view = firewallView(status({ enabled, running: false }), false);
    assert.equal(view.label, 'Off');
  }
});

test('an enabled firewall that is not running says traffic is unfiltered', () => {
  const view = firewallView(status({ running: false }), false);
  assert.match(view.detail ?? '', /isn't running/);
  assert.equal(view.canStart, true);
});

test('a stale running flag with the switch off reads Off', () => {
  const view = firewallView(status({ enabled: false, running: true }), false);
  assert.equal(view.label, 'Off');
  assert.equal(view.detail, null);
});

test('a stale running flag while a server connection holds the slot reads Paused, not On', () => {
  const view = firewallView(status({ running: true }), true);
  assert.equal(view.label, 'Paused');
  assert.equal(view.detail, FIREWALL_PAUSED_LINE);
});

test('a server connection shows the paused copy and blocks every start control', () => {
  for (const s of [
    status({ running: false }),
    status({ paused: true, running: false }),
    status({ enabled: false, running: false }),
  ]) {
    const view = firewallView(s, true);
    assert.equal(view.detail, FIREWALL_PAUSED_LINE);
    assert.equal(view.canStart, false);
  }
});

test('with a server connection an enabled firewall reads Paused and a disabled one reads Off', () => {
  assert.equal(firewallView(status({ running: false }), true).label, 'Paused');
  assert.equal(firewallView(status({ enabled: false, running: false }), true).label, 'Off');
});

test('the user pause reads Paused without the server copy, and Resume stays available', () => {
  const view = firewallView(status({ running: false, paused: true }), false);
  assert.equal(view.label, 'Paused');
  assert.notEqual(view.detail, FIREWALL_PAUSED_LINE);
  assert.match(view.detail ?? '', /resume/i);
  assert.equal(view.canStart, true);
});

test('a paused flag with the switch off still reads Off', () => {
  const view = firewallView(status({ enabled: false, running: false, paused: true }), false);
  assert.equal(view.label, 'Off');
});

test('serverHoldsSlot mirrors the native rule: every state except disconnected and error', () => {
  assert.equal(serverHoldsSlot('disconnected'), false);
  assert.equal(serverHoldsSlot('error'), false);
  for (const state of ['connecting', 'connected', 'disconnecting', 'reasserting'] as const) {
    assert.equal(serverHoldsSlot(state), true);
  }
});

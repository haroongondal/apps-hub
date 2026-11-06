/**
 * Firewall copy tests (node --test). The strings are user-facing and
 * verbatim from the plan, so the asserts compare literals.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FIREWALL_CONSENT_POINTS,
  FIREWALL_PAUSED_LINE,
  LAN_COVERAGE_LINE,
  privateDnsMessage,
} from '../copy.ts';

test('privateDnsMessage names the provider', () => {
  assert.equal(
    privateDnsMessage('dns.google'),
    'To see website names, set Private DNS to Automatic. Lookups will still go to dns.google.',
  );
});

test('the paused line is verbatim', () => {
  assert.equal(
    FIREWALL_PAUSED_LINE,
    "The firewall is paused while you're connected to a VPN server.",
  );
});

test('the LAN line says local and HomeNet traffic is neither logged nor blockable', () => {
  assert.equal(
    LAN_COVERAGE_LINE,
    "Traffic that stays on your local network and HomeNet's own traffic aren't logged or blockable.",
  );
});

test('the consent points keep the plan order', () => {
  assert.deepEqual(FIREWALL_CONSENT_POINTS, [
    "The firewall sees every connection's app, address or domain, and data amount.",
    'This stays on your phone and is never uploaded.',
    "The firewall pauses while you're connected to a VPN server.",
    'The firewall uses some battery.',
  ]);
});

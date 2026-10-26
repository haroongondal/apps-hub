/**
 * OpenVPN sanitizer test suite (node --test).
 * Port of the Dart `OpenVPN sanitizer` group: exactly-once cipher injection
 * after the client preamble, legacy directive stripping, idempotency.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INJECTED_CIPHER_DIRECTIVES,
  parseVpnGateCsvRow,
  sanitizeOpenVpnConfig,
  type VpnNode,
} from '../vpngate.ts';
import { csvRow, ovpnConfig } from './fixtures.ts';

function parseOne(row: string): VpnNode {
  const node = parseVpnGateCsvRow(row);
  assert.ok(node, 'fixture row must decode');
  return node;
}

test('injects compat ciphers exactly once after the client preamble', () => {
  const config = parseOne(csvRow({ ovpnConfig: ovpnConfig() })).ovpnConfigRaw;

  const lines = config.split('\n');
  const clientIndex = lines.findIndex((line) => line.trim() === 'client');
  assert.ok(clientIndex >= 0);
  assert.equal(lines[clientIndex + 1], INJECTED_CIPHER_DIRECTIVES[0]);
  assert.equal(lines[clientIndex + 2], INJECTED_CIPHER_DIRECTIVES[1]);
  assert.equal(
    lines.filter((line) => line.trim() === INJECTED_CIPHER_DIRECTIVES[0]).length,
    1,
  );
  assert.equal(
    lines.filter((line) => line.trim() === INJECTED_CIPHER_DIRECTIVES[1]).length,
    1,
  );

  const fallbackCount = (config.match(/^\s*data-ciphers-fallback\s/gm) ?? []).length;
  assert.equal(fallbackCount, 1);
});

test('strips legacy directives rejected by OpenVPN 2.6+', async () => {
  const node = parseOne(
    csvRow({
      ovpnConfig: ovpnConfig({
        port: 443,
        proto: 'tcp',
        legacyDirectives: [
          'cipher AES-256-CBC',
          'data-ciphers AES-256-CBC',
          'data-ciphers-fallback AES-128-CBC',
          'comp-lzo no',
        ],
      }),
    }),
  );

  assert.doesNotMatch(node.ovpnConfigRaw, /cipher AES-256-CBC/);
  assert.doesNotMatch(node.ovpnConfigRaw, /comp-lzo/);
  const injected = (node.ovpnConfigRaw.match(/^\s*data-ciphers\s/gm) ?? []).length;
  assert.equal(injected, 1);
});

test('is idempotent', () => {
  const raw = ovpnConfig({
    legacyDirectives: ['cipher AES-128-CBC', 'comp-lzo no'],
  });
  const once = sanitizeOpenVpnConfig(raw);
  const twice = sanitizeOpenVpnConfig(once);

  assert.equal(twice, once);
});

test('sanitizing an empty config returns it unchanged', () => {
  assert.equal(sanitizeOpenVpnConfig(''), '');
  assert.equal(sanitizeOpenVpnConfig('   \n'), '   \n');
});

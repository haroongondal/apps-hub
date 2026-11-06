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
  VPN_GATE_IDENTITY_DIRECTIVES,
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

const LIVE_SHAPED_ROW = [
  '###############################################################################',
  '# OpenVPN 2.0 Sample Configuration File',
  '# for PacketiX VPN / SoftEther VPN Server',
  'dev tun',
  'proto tcp',
  'remote 219.100.37.110 443',
  ';http-proxy-retry',
  ';http-proxy [proxy server] [proxy port]',
  'cipher AES-128-CBC',
  'data-ciphers AES-128-CBC',
  'auth SHA1',
  'resolv-retry infinite',
  'nobind',
  'persist-key',
  'persist-tun',
  'client',
  'verb 3',
  '#auth-user-pass',
  '<ca>',
  '-----BEGIN CERTIFICATE-----',
  'MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw',
  '-----END CERTIFICATE-----',
  '</ca>',
  '<cert>',
  '-----BEGIN CERTIFICATE-----',
  'MIICxjCCAa4CAQAwDQYJKoZIhvcNAQEFBQAwKTEaMBgGA1UEAxMRVlBOR2F0ZUNs',
  '-----END CERTIFICATE-----',
  '</cert>',
  '<key>',
  '-----BEGIN RSA PRIVATE KEY-----',
  'RkFLRS1URVNULUtFWS1OT1QtQS1SRUFMLUtFWQ==',
  '-----END RSA PRIVATE KEY-----',
  '</key>',
  '',
].join('\n');

test('keeps what a live VPN Gate row needs to connect, pins the relay identity, drops the rest', () => {
  assert.equal(
    sanitizeOpenVpnConfig(LIVE_SHAPED_ROW),
    [
      'dev tun',
      'proto tcp',
      'remote 219.100.37.110 443',
      'auth SHA1',
      'nobind',
      'persist-key',
      'persist-tun',
      'client',
      ...INJECTED_CIPHER_DIRECTIVES,
      ...VPN_GATE_IDENTITY_DIRECTIVES,
      '<ca>',
      '-----BEGIN CERTIFICATE-----',
      'MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw',
      '-----END CERTIFICATE-----',
      '</ca>',
      '<cert>',
      '-----BEGIN CERTIFICATE-----',
      'MIICxjCCAa4CAQAwDQYJKoZIhvcNAQEFBQAwKTEaMBgGA1UEAxMRVlBOR2F0ZUNs',
      '-----END CERTIFICATE-----',
      '</cert>',
      '<key>',
      '-----BEGIN RSA PRIVATE KEY-----',
      'RkFLRS1URVNULUtFWS1OT1QtQS1SRUFMLUtFWQ==',
      '-----END RSA PRIVATE KEY-----',
      '</key>',
      '',
    ].join('\n'),
  );
});

test('a row cannot weaken or replace the relay identity check', () => {
  const config = parseOne(
    csvRow({
      ovpnConfig: ovpnConfig({
        legacyDirectives: [
          'verify-x509-name attacker.example name',
          '  verify-x509-name attacker.example',
          '--verify-x509-name attacker.example name-prefix',
          'remote-cert-tls client',
          'tls-verify /system/bin/true',
          'tls-remote attacker.example',
          'ns-cert-type client',
          'peer-fingerprint AB:CD',
        ],
      }),
    }),
  ).ovpnConfigRaw;

  const lines = config.split('\n');
  assert.deepEqual(
    lines.filter((line) => /verify-x509-name|remote-cert-tls|tls-verify|tls-remote|ns-cert-type|fingerprint/.test(line)),
    ['remote-cert-tls server', 'verify-x509-name opengw.net name'],
  );
  const clientIndex = lines.indexOf('client');
  assert.deepEqual(lines.slice(clientIndex + 3, clientIndex + 5), [...VPN_GATE_IDENTITY_DIRECTIVES]);
});

const DANGEROUS_DIRECTIVES = [
  'writepid /data/data/com.opentunnel.open_tunnel_vpn/databases/firewall.db',
  'log /data/data/com.opentunnel.open_tunnel_vpn/databases/firewall.db',
  'log-append /data/data/com.opentunnel.open_tunnel_vpn/files/settings',
  'status /data/data/com.opentunnel.open_tunnel_vpn/cache/status 1',
  'up /system/bin/sh',
  'down /system/bin/sh',
  'script-security 2',
  'plugin /data/local/tmp/evil.so',
  'management 127.0.0.1 7505',
  'cd /data/data/com.opentunnel.open_tunnel_vpn',
  'chroot /data/data/com.opentunnel.open_tunnel_vpn',
  'tmp-dir /data/data/com.opentunnel.open_tunnel_vpn/databases',
  'frobnicate everything',
  '--writepid /data/data/com.opentunnel.open_tunnel_vpn/databases/firewall.db',
  '"log" firewall.db',
  '\tlog-append firewall.db',
  'auth-user-pass /data/data/com.opentunnel.open_tunnel_vpn/files/creds',
  'redirect-gateway def1',
  'resolv-retry infinite',
  'verb 11',
];

test('drops every directive outside the allowlist, whatever its spelling', () => {
  const config = sanitizeOpenVpnConfig(ovpnConfig({ legacyDirectives: DANGEROUS_DIRECTIVES }));

  for (const directive of DANGEROUS_DIRECTIVES) {
    assert.equal(config.includes(directive.trim()), false, `kept: ${directive}`);
  }
  assert.doesNotMatch(config, /firewall\.db|\/system\/bin|evil\.so|7505/);
  assert.match(config, /^client$/m);
  assert.match(config, /^dev tun$/m);
  assert.match(config, /^proto udp$/m);
  assert.match(config, /^remote 1\.2\.3\.4 1195$/m);
  assert.match(config, /<ca>\n-----BEGIN CERTIFICATE-----\nMIIAb2d1ZXN0Y2VydA==\n-----END CERTIFICATE-----\n<\/ca>/);
});

test('allowed directives with quotes, escapes, comments or overlong arguments are dropped', () => {
  const config = sanitizeOpenVpnConfig(
    [
      'client',
      'remote "1.2.3.4" 443',
      'remote 1.2.3.4 443 # writepid x',
      'auth SHA1\\ writepid',
      'dev\0writepid',
      `remote ${'a'.repeat(200)} writepid`,
      'remote 5.6.7.8 443',
    ].join('\n'),
  );
  const firstWord = (line: string) => line.split(/[^a-z-]/)[0];
  assert.deepEqual(config.split('\n').filter((line) => ['remote', 'auth', 'dev'].includes(firstWord(line)!)), [
    'remote 5.6.7.8 443',
  ]);
});

test('an inline block cannot smuggle a directive past its end tag', () => {
  const config = sanitizeOpenVpnConfig(
    [
      'client',
      '<ca>',
      '-----BEGIN CERTIFICATE-----',
      '</ca>writepid firewall.db',
      '  </ca> log firewall.db',
      'MIIAb2d1ZXN0Y2VydA==',
      '-----END CERTIFICATE-----',
      '\u0001</ca>',
      'writepid firewall.db',
      '</ca>',
      '<connection>',
      'remote 9.9.9.9 443',
      'log firewall.db',
      '</connection>',
      '<pkcs12>',
      'MIIAb2d1ZXN0Y2VydA==',
      '</pkcs12>',
      '<tls-auth>',
      '-----BEGIN OpenVPN Static key V1-----',
      '0123456789abcdef',
      '-----END OpenVPN Static key V1-----',
      '</tls-auth>',
      'key-direction 1',
    ].join('\n'),
  );
  assert.equal(
    config,
    [
      'client',
      ...INJECTED_CIPHER_DIRECTIVES,
      ...VPN_GATE_IDENTITY_DIRECTIVES,
      '<ca>',
      '-----BEGIN CERTIFICATE-----',
      'MIIAb2d1ZXN0Y2VydA==',
      '-----END CERTIFICATE-----',
      '</ca>',
      'remote 9.9.9.9 443',
      '<tls-auth>',
      '-----BEGIN OpenVPN Static key V1-----',
      '0123456789abcdef',
      '-----END OpenVPN Static key V1-----',
      '</tls-auth>',
      'key-direction 1',
    ].join('\n'),
  );
});

test('a `client` line inside a certificate block is not the preamble', () => {
  const out = sanitizeOpenVpnConfig(['dev tun', '<ca>', 'client', 'MIIB', '</ca>', 'remote 1.2.3.4 443'].join('\n'));
  const lines = out.split('\n');
  const caEnd = lines.indexOf('</ca>');
  for (const directive of [...INJECTED_CIPHER_DIRECTIVES, ...VPN_GATE_IDENTITY_DIRECTIVES]) {
    const at = lines.indexOf(directive);
    assert.ok(at >= 0 && (at < lines.indexOf('<ca>') || at > caEnd), `${directive} must sit outside the <ca> block`);
  }
});

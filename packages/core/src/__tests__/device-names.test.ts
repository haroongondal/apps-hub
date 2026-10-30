/**
 * Device name rules (node --test): sanitising, display order and the merge
 * that never touches a device's identity.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyDeviceNames,
  cleanMdnsInstanceName,
  displayNameFor,
  isPrivateIpv4,
  sanitizeName,
} from '../device-names.ts';
import type { StoredDevice } from '../device-repository.ts';

function fullDevice(overrides: Partial<StoredDevice> = {}): StoredDevice {
  return {
    id: 7,
    networkId: 'net_a0b0c0d0',
    identityKey: 'ip:192.168.7.5',
    lastIp: '192.168.7.5',
    hostname: 'Galaxy-S24.lan',
    customName: 'My TV',
    vendorOrModel: 'Linux UPnP/1.0',
    openPortsCsv: '80',
    mdnsServicesCsv: '',
    isTrusted: true,
    firstSeenAt: 1_000,
    lastSeenAt: 2_000,
    mdnsName: 'Living Room TV',
    friendlyName: 'Samsung Q60',
    model: 'QN60Q60',
    netbiosName: 'ALI-LAPTOP',
    ...overrides,
  };
}

test('sanitizeName trims, strips control characters and collapses whitespace', () => {
  assert.equal(sanitizeName('  Living\u0000 Room\n TV '), 'Living Room TV');
});

test('sanitizeName caps at 64 characters', () => {
  assert.equal(sanitizeName('x'.repeat(80))?.length, 64);
});

test('sanitizeName returns null for blank or missing input', () => {
  assert.equal(sanitizeName('   '), null);
  assert.equal(sanitizeName(null), null);
  assert.equal(sanitizeName(undefined), null);
});

test('sanitizeName strips bidi overrides but keeps ZWJ, ZWNJ, LRM and RLM', () => {
  assert.equal(sanitizeName('\u202Evt moor gniviL'), 'vt moor gniviL');
  assert.equal(sanitizeName('a\u2066b\u2069c\u202ad\u202ce'), 'abcde');
  assert.equal(sanitizeName('a\u200Db'), 'a\u200Db');
  assert.equal(sanitizeName('a\u200Cb\u200Ec\u200Fd'), 'a\u200Cb\u200Ec\u200Fd');
});

test('sanitizeName returns null when only invisible characters remain', () => {
  assert.equal(sanitizeName('\u200B'), null);
  assert.equal(sanitizeName('\u200D'), null);
  assert.equal(sanitizeName('\u200F'), null);
  assert.equal(sanitizeName(' \u200E '), null);
  assert.equal(sanitizeName('\u00AD\u2060\uFEFF \u200C'), null);
  assert.equal(sanitizeName('\u202E\u200B'), null);
  assert.equal(sanitizeName('a\u200Db'), 'a\u200Db');
});

test('cleanMdnsInstanceName drops a leading MAC-style prefix', () => {
  assert.equal(
    cleanMdnsInstanceName('A1B2C3D4E5F6@Living Room TV'),
    'Living Room TV',
  );
  assert.equal(cleanMdnsInstanceName('HP LaserJet'), 'HP LaserJet');
});

test('isPrivateIpv4 covers the RFC 1918 and link-local ranges only', () => {
  assert.equal(isPrivateIpv4('192.168.1.5'), true);
  assert.equal(isPrivateIpv4('10.0.0.1'), true);
  assert.equal(isPrivateIpv4('172.31.0.1'), true);
  assert.equal(isPrivateIpv4('169.254.3.4'), true);
  assert.equal(isPrivateIpv4('172.15.0.1'), false);
  assert.equal(isPrivateIpv4('172.32.0.1'), false);
  assert.equal(isPrivateIpv4('169.253.0.1'), false);
  assert.equal(isPrivateIpv4('8.8.8.8'), false);
  assert.equal(isPrivateIpv4('tv.local'), false);
});

test('displayNameFor follows custom, mDNS, friendly, NetBIOS, hostname, model, IP', () => {
  const device = fullDevice();
  assert.equal(displayNameFor(device), 'My TV');
  const noCustom = { ...device, customName: null };
  assert.equal(displayNameFor(noCustom), 'Living Room TV');
  const noMdns = { ...noCustom, mdnsName: null };
  assert.equal(displayNameFor(noMdns), 'Samsung Q60');
  const noFriendly = { ...noMdns, friendlyName: null };
  assert.equal(displayNameFor(noFriendly), 'ALI-LAPTOP');
  const noNetbios = { ...noFriendly, netbiosName: null };
  assert.equal(displayNameFor(noNetbios), 'Galaxy-S24');
  const noHostname = { ...noNetbios, hostname: null };
  assert.equal(displayNameFor(noHostname), 'Linux UPnP/1.0');
  const noModel = { ...noHostname, vendorOrModel: null };
  assert.equal(displayNameFor(noModel), '192.168.7.5');
});

test('displayNameFor ignores an IPv4-literal hostname', () => {
  const device = fullDevice({
    customName: null,
    mdnsName: null,
    friendlyName: null,
    netbiosName: null,
    hostname: '192.168.1.5',
    vendorOrModel: null,
  });
  assert.equal(displayNameFor(device), '192.168.7.5');
  assert.equal(
    displayNameFor({ ...device, vendorOrModel: 'Linux UPnP/1.0' }),
    'Linux UPnP/1.0',
  );
});

test('applyDeviceNames keeps identity and user fields and old names where new ones are null', () => {
  const existing = fullDevice({ hostname: null, mdnsName: 'Old mDNS' });
  const merged = applyDeviceNames(existing, {
    hostname: 'a.lan',
    mdnsName: null,
    friendlyName: 'Fresh friendly',
    model: null,
    netbiosName: null,
  });
  assert.equal(merged.identityKey, existing.identityKey);
  assert.equal(merged.id, existing.id);
  assert.equal(merged.customName, 'My TV');
  assert.equal(merged.isTrusted, true);
  assert.equal(merged.hostname, 'a.lan');
  assert.equal(merged.mdnsName, 'Old mDNS');
  assert.equal(merged.friendlyName, 'Fresh friendly');
  assert.equal(merged.model, 'QN60Q60');
  assert.equal(merged.netbiosName, 'ALI-LAPTOP');
});

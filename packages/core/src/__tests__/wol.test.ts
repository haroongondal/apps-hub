import test from 'node:test';
import assert from 'node:assert/strict';

import { magicPacket, parseMac, subnetBroadcast } from '../wol.ts';

test('parseMac: any separator and case normalise to AA:BB:...', () => {
  assert.equal(parseMac('aa-bb-cc-dd-ee-ff'), 'AA:BB:CC:DD:EE:FF');
  assert.equal(parseMac('aa:bb:cc:dd:ee:ff'), 'AA:BB:CC:DD:EE:FF');
  assert.equal(parseMac('AABBCCDDEEFF'), 'AA:BB:CC:DD:EE:FF');
  assert.equal(parseMac(' 00:1a:2B:3c:4D:5e '), '00:1A:2B:3C:4D:5E');
});

test('parseMac: bad input is null', () => {
  for (const bad of ['GG:BB:CC:DD:EE:FF', 'aa:bb:cc:dd:ee', 'aa:bb:cc:dd:ee:ff:00', '', 'aa:bb-cc:dd-ee:ff', 'aabbccddeef', 'aabbccddeeff00']) {
    assert.equal(parseMac(bad), null, bad);
  }
});

test('magicPacket: 102 bytes, 6 x 0xFF, then the MAC 16 times', () => {
  const p = magicPacket('aa-bb-cc-dd-ee-ff');
  const mac = [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff];
  assert.equal(p.length, 102);
  assert.deepEqual(p.slice(0, 6), [255, 255, 255, 255, 255, 255]);
  assert.deepEqual(p.slice(6, 12), mac);
  assert.deepEqual(p.slice(96, 102), mac);
  for (let i = 0; i < 16; i++) assert.deepEqual(p.slice(6 + i * 6, 12 + i * 6), mac);
});

test('magicPacket: an invalid MAC throws', () => {
  assert.throws(() => magicPacket('nope'), RangeError);
  assert.throws(() => magicPacket(''), RangeError);
});

test('magicPacket: all-zero and broadcast MACs throw (they would wake nobody or everybody)', () => {
  assert.equal(parseMac('00:00:00:00:00:00'), '00:00:00:00:00:00');
  assert.throws(() => magicPacket('00:00:00:00:00:00'), RangeError);
  assert.throws(() => magicPacket('ff-ff-ff-ff-ff-ff'), RangeError);
});

test('subnetBroadcast: examples', () => {
  assert.equal(subnetBroadcast('192.168.1.20', 24), '192.168.1.255');
  assert.equal(subnetBroadcast('10.1.2.3', 16), '10.1.255.255');
  assert.equal(subnetBroadcast('192.168.4.9', 23), '192.168.5.255');
});

test('subnetBroadcast: prefix 32 is the host itself, prefix 0 is all ones', () => {
  assert.equal(subnetBroadcast('192.168.1.20', 32), '192.168.1.20');
  assert.equal(subnetBroadcast('192.168.1.20', 0), '255.255.255.255');
});

test('subnetBroadcast: an invalid IP or prefix throws', () => {
  assert.throws(() => subnetBroadcast('300.1.1.1', 24), RangeError);
  assert.throws(() => subnetBroadcast('nope', 24), RangeError);
  for (const p of [-1, 33, 24.5, NaN]) assert.throws(() => subnetBroadcast('10.0.0.1', p), RangeError, String(p));
});

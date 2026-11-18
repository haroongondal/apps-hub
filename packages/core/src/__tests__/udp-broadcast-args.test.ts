import assert from 'node:assert/strict';
import { test } from 'node:test';
import { udpBroadcastArgsError } from '../udp-broadcast-args.ts';

const magic = Array.from({ length: 102 }, () => 255);

test('accepts a Wake-on-LAN datagram on port 7 or 9', () => {
  assert.equal(udpBroadcastArgsError(9, magic), null);
  assert.equal(udpBroadcastArgsError(7, magic), null);
  assert.equal(udpBroadcastArgsError(65535, [0]), null);
  assert.equal(udpBroadcastArgsError(1, Array.from({ length: 1024 }, () => 0)), null);
});

test('rejects ports that are not integers in 1..65535, including values that trap the iOS bridge', () => {
  for (const port of [0, 65536, -1, 9.5, NaN, Infinity, -Infinity, 1e300, 2 ** 63]) {
    assert.equal(udpBroadcastArgsError(port, magic), 'port must be in 1..65535', String(port));
  }
});

test('rejects payload length outside 1..1024', () => {
  assert.equal(udpBroadcastArgsError(9, []), 'payload must be 1..1024 bytes');
  assert.equal(udpBroadcastArgsError(9, Array.from({ length: 1025 }, () => 0)), 'payload must be 1..1024 bytes');
});

test('rejects payload bytes that are not integers in 0..255', () => {
  for (const b of [256, -1, 255.6, 0.4, NaN, Infinity, -Infinity, 1e300]) {
    assert.equal(udpBroadcastArgsError(9, [1, b]), 'payload bytes must be in 0..255', String(b));
  }
});

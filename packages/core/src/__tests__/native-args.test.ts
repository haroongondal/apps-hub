import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tcpFetchArgsError, udpRequestArgsError } from '../native-args.ts';

const trap = [NaN, Infinity, -Infinity, 1e300, 2 ** 63, 9.5, -1, 0];

test('udpRequest accepts normal arguments', () => {
  assert.equal(udpRequestArgsError(53, [0, 255], 1500), null);
  assert.equal(udpRequestArgsError(1, [], 1), null);
  assert.equal(udpRequestArgsError(65535, [1], 10_000), null);
});

test('udpRequest rejects bad port, payload bytes and timeout', () => {
  for (const n of [...trap, 65536]) assert.equal(udpRequestArgsError(n, [1], 1000), 'port must be in 1..65535', String(n));
  for (const n of [NaN, Infinity, 1e300, 256, -1, 1.5]) {
    assert.equal(udpRequestArgsError(53, [1, n], 1000), 'payload bytes must be in 0..255', String(n));
  }
  for (const n of [...trap, 10_001]) assert.equal(udpRequestArgsError(53, [1], n), 'timeoutMs must be in 1..10000', String(n));
});

test('tcpFetch accepts normal arguments', () => {
  assert.equal(tcpFetchArgsError(80, 1500, 65536), null);
  assert.equal(tcpFetchArgsError(65535, 10_000, 1), null);
});

test('tcpFetch rejects bad port, timeout and maxBytes', () => {
  for (const n of [...trap, 65536]) assert.equal(tcpFetchArgsError(n, 1000, 100), 'port must be in 1..65535', String(n));
  for (const n of [...trap, 10_001]) assert.equal(tcpFetchArgsError(80, n, 100), 'timeoutMs must be in 1..10000', String(n));
  for (const n of [NaN, Infinity, 1e300, 2 ** 63, 0.5, 1.5, -5, 0]) {
    assert.equal(tcpFetchArgsError(80, 1000, n), 'maxBytes must be positive', String(n));
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sameInterface } from '../same-interface.ts';

test('sameInterface compares the address fields', () => {
  const a = { localIp: '192.168.1.5', cidrPrefix: 24, gatewayIp: '192.168.1.1' };
  assert.equal(sameInterface(a, { ...a }), true);
  assert.equal(sameInterface(null, null), true);
  assert.equal(sameInterface(a, null), false);
  assert.equal(sameInterface(a, { ...a, localIp: '192.168.1.6' }), false);
  assert.equal(sameInterface(a, { ...a, gatewayIp: null }), false);
  assert.equal(sameInterface(a, { ...a, cidrPrefix: 16 }), false);
});

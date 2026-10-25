/**
 * SubnetCalculator / IPv4 utility test suite (node --test).
 * Covers: /24 planning, prefix clamping to the containing /24 (NFR-1),
 * network+broadcast exclusion, parse/format round trips, and input validation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { formatIpv4, parseIpv4, prefixToMask } from '../ipv4.ts';
import { computeClampedPrefix, computeSubnetForHost } from '../subnet-calculator.ts';

test('parseIpv4 formats and round-trips across the full uint32 range', () => {
  assert.equal(parseIpv4('0.0.0.0'), 0);
  assert.equal(parseIpv4('127.0.0.1'), 0x7f000001);
  assert.equal(parseIpv4('192.168.1.77'), ((192 << 24) | (168 << 16) | (1 << 8) | 77) >>> 0);
  assert.equal(parseIpv4('255.255.255.255'), 0xffffffff);
  for (const raw of ['0.0.0.0', '1.2.3.4', '169.254.0.1', '192.168.7.42', '255.255.255.255']) {
    assert.equal(formatIpv4(parseIpv4(raw) ?? -1), raw);
  }
});

test('parseIpv4 accepts at most three digits per octet and clamps >255', () => {
  assert.equal(parseIpv4('01.02.03.04'), (1 << 24) | (2 << 16) | (3 << 8) | 4); // leading zeros OK
  assert.equal(parseIpv4('1234.1.1.1'), null);
  assert.equal(parseIpv4('256.1.1.1'), null);
  assert.equal(parseIpv4('1.2.3'), null);
  assert.equal(parseIpv4('1.2.3.4.5'), null);
  assert.equal(parseIpv4('a.b.c.d'), null);
  assert.equal(parseIpv4('1.2.3.-4'), null);
  assert.equal(parseIpv4(' 1.2.3.4'), null);
  assert.equal(parseIpv4('1.2.3.4 '), null);
  assert.equal(parseIpv4(''), null);
  assert.equal(parseIpv4('.'), null);
});

test('formatIpv4 rejects non-uint32 numbers', () => {
  assert.throws(() => formatIpv4(-1), RangeError);
  assert.throws(() => formatIpv4(0x1_0000_0000), RangeError);
  assert.throws(() => formatIpv4(1.5), RangeError);
});

test('prefixToMask is the unsigned host-bit inverse of the prefix', () => {
  assert.equal(prefixToMask(0), 0);
  assert.equal(prefixToMask(8), 0xff000000);
  assert.equal(prefixToMask(24), 0xffffff00);
  assert.equal(prefixToMask(31), 0xfffffffe);
  assert.equal(prefixToMask(32), 0xffffffff);
});

test('computeSubnetForHost plans a standard /24 with 254 targets', () => {
  const plan = computeSubnetForHost('192.168.1.77', 24);
  assert.equal(plan.prefix, 24);
  assert.equal(plan.clamped, false);
  assert.equal(plan.requestedPrefix, 24);
  assert.equal(plan.networkIp, '192.168.1.0');
  assert.equal(plan.broadcastIp, '192.168.1.255');
  assert.equal(plan.hosts.length, 254);
  assert.equal(plan.hosts[0], '192.168.1.1');
  assert.equal(plan.hosts[253], '192.168.1.254');
  assert.ok(plan.hosts.includes('192.168.1.77'), 'host IP itself must be probed');
  assert.ok(!plan.hosts.includes('192.168.1.0'), 'network address excluded');
  assert.ok(!plan.hosts.includes('192.168.1.255'), 'broadcast address excluded');
});

test('a /16 request is clamped to the containing /24 to prevent stalls (NFR-1)', () => {
  const plan = computeSubnetForHost('192.168.1.77', 16);
  assert.equal(plan.clamped, true);
  assert.equal(plan.requestedPrefix, 16);
  assert.equal(plan.prefix, 24);
  assert.equal(plan.networkIp, '192.168.1.0');
  assert.equal(plan.broadcastIp, '192.168.1.255');
  assert.equal(plan.hosts.length, 254);
  const expected = computeSubnetForHost('192.168.1.77', 24);
  assert.deepEqual(
    plan.hosts,
    expected.hosts,
    'clamped /16 plan must equal the containing /24 plan',
  );
});

test('a /32 request widens to the containing /24', () => {
  const plan = computeSubnetForHost('10.0.0.152', 32);
  assert.equal(plan.clamped, true);
  assert.equal(plan.prefix, 24);
  assert.equal(plan.networkIp, '10.0.0.0');
  assert.equal(plan.broadcastIp, '10.0.0.255');
  assert.equal(plan.hosts.length, 254);
  assert.ok(plan.hosts.includes('10.0.0.152'));
});

test('narrow requests (/30, /28) also widen to the containing /24', () => {
  const plan = computeSubnetForHost('172.20.0.130', 30);
  assert.equal(plan.clamped, true);
  assert.equal(plan.prefix, 24);
  assert.equal(plan.networkIp, '172.20.0.0');
  assert.equal(plan.broadcastIp, '172.20.0.255');
  assert.equal(plan.hosts.length, 254);
});

test('a /8 request in 10.128.77.x clamps to that exact /24 window', () => {
  const plan = computeSubnetForHost('10.128.77.50', 8);
  assert.equal(plan.clamped, true);
  assert.equal(plan.networkIp, '10.128.77.0');
  assert.equal(plan.broadcastIp, '10.128.77.255');
  assert.equal(plan.hosts.length, 254);
  assert.ok(plan.hosts.includes('10.128.77.50'));
});

test('host at the last octet boundary still yields a valid window', () => {
  const plan = computeSubnetForHost('10.0.0.255', 24);
  assert.equal(plan.networkIp, '10.0.0.0');
  assert.equal(plan.broadcastIp, '10.0.0.255');
  assert.equal(plan.hosts.length, 254);
  // The requester IS the broadcast address; it is excluded like any other .255.
  assert.ok(!plan.hosts.includes('10.0.0.255'));
});

test('host at octet zero (network address) still yields a valid window', () => {
  const plan = computeSubnetForHost('10.0.0.0', 24);
  assert.equal(plan.hosts.length, 254);
  assert.ok(!plan.hosts.includes('10.0.0.0'));
});

test('every plan respects the native host bound of 256 targets', () => {
  for (const [ip, prefix] of [
    ['192.168.1.77', 24] as const,
    ['10.0.0.152', 16] as const,
    ['10.0.0.152', 32] as const,
    ['172.17.3.209', 8] as const,
  ]) {
    const plan = computeSubnetForHost(ip, prefix);
    assert.ok(plan.hosts.length <= 256, `${ip}/${prefix} kept within bound`);
    assert.equal(plan.hosts.length, 254, `${ip}/${prefix} clamps to exactly a /24`);
  }
});

test('computeClampedPrefix validates range and reports clamping', () => {
  assert.deepEqual(computeClampedPrefix(24), { prefix: 24, clamped: false });
  assert.deepEqual(computeClampedPrefix(16), { prefix: 24, clamped: true });
  assert.deepEqual(computeClampedPrefix(32), { prefix: 24, clamped: true });
  assert.throws(() => computeClampedPrefix(-1), RangeError);
  assert.throws(() => computeClampedPrefix(33), RangeError);
  assert.throws(() => computeClampedPrefix(1.5), RangeError);
  assert.throws(() => computeClampedPrefix(Number.NaN), RangeError);
});

test('computeSubnetForHost rejects malformed hosts and prefixes', () => {
  assert.throws(() => computeSubnetForHost('not-an-ip', 24), TypeError);
  assert.throws(() => computeSubnetForHost('1.2.3.999', 24), TypeError);
  assert.throws(() => computeSubnetForHost('192.168.1.77', 33), RangeError);
  assert.throws(() => computeSubnetForHost('192.168.1.77', 0.5), RangeError);
});

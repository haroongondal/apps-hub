/**
 * DnsBenchmark suite (node --test): FR-3 hop 3 (SPEC §5). The benchmark
 * fires N sequential OS-resolver attempts through the native bridge and
 * averages resolveMs over SUCCESSFUL lookups only — failures are recorded
 * as elapsed facts but never pass themselves off as latency credits, and
 * an all-failed benchmark reports resolveMs=null, success=false.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DNS_ATTEMPTS,
  DEFAULT_DNS_BENCHMARK_HOSTNAME,
  DnsBenchmark,
} from '../dns-benchmark.ts';
import type {
  DnsResolution,
  InterfaceInfo,
  ListenerHandle,
  ScanEventName,
  ScanEventListener,
  TcpHandshakeResult,
} from '../model.ts';
import type { NetLensNativeBinding } from '../native-binding.ts';

interface ResolveScript {
  status: 'resolved' | 'failed' | 'bridge-null';
  durationMs: number;
  addresses?: string[];
}

class FakeBinding implements NetLensNativeBinding {
  detectResult: InterfaceInfo | null = null;
  queue: ResolveScript[] = [];
  shutdownQueue = false;
  resolveCalls: string[] = [];
  handshakeCalls = 0;

  addListener<E extends ScanEventName>(
    event: E,
    _listener: ScanEventListener<E>,
  ): ListenerHandle {
    void event;
    void _listener;
    return { remove: () => {} };
  }

  async detectInterface(): Promise<InterfaceInfo | null> {
    return this.detectResult;
  }

  async measureTcpHandshake(): Promise<TcpHandshakeResult> {
    this.handshakeCalls += 1;
    throw new Error('not scripted in this suite');
  }

  async resolveHostname(hostname: string): Promise<DnsResolution | null> {
    this.resolveCalls.push(hostname);
    if (this.shutdownQueue || this.queue.length === 0) return null;
    const script = this.queue.shift() as ResolveScript;
    if (script.status === 'bridge-null') return null;
    return {
      hostname,
      addresses: script.status === 'resolved' ? script.addresses ?? ['93.184.216.34'] : [],
      durationMs: script.durationMs,
      success: script.status === 'resolved',
    };
  }

  async startTcpScan(): Promise<void> {}
  async stopTcpScan(): Promise<void> {}
  async startServiceDiscovery(_timeoutMs: number): Promise<void> {
    void _timeoutMs;
  }
  async stopServiceDiscovery(): Promise<void> {}
}

test('module constants pin the benchmark shape', () => {
  assert.equal(DEFAULT_DNS_BENCHMARK_HOSTNAME, 'example.com');
  assert.equal(DEFAULT_DNS_ATTEMPTS, 3);
});

test('three sequential attempts averaged over successful lookups', async () => {
  const binding = new FakeBinding();
  binding.queue = [
    { status: 'resolved', durationMs: 80, addresses: ['93.184.216.34'] },
    { status: 'resolved', durationMs: 40, addresses: ['93.184.216.34'] },
    { status: 'resolved', durationMs: 60, addresses: ['93.184.216.34'] },
  ];

  const result = await new DnsBenchmark(binding).benchmark();

  assert.equal(binding.resolveCalls.length, DEFAULT_DNS_ATTEMPTS);
  assert.equal(binding.resolveCalls[0], 'example.com');
  assert.equal(result.hostname, 'example.com');
  assert.equal(result.attemptCount, 3);
  assert.deepEqual(result.attemptDurationsMs, [80, 40, 60]);
  assert.equal(result.resolveMs, 60); // (80+40+60)/3
  assert.equal(result.success, true);
  assert.deepEqual(result.addresses, ['93.184.216.34']);
});

test('addresses dedupe across attempts; failed attempts add no latency credit', async () => {
  const binding = new FakeBinding();
  binding.queue = [
    { status: 'resolved', durationMs: 50, addresses: ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'] },
    { status: 'failed', durationMs: 900 }, // resolver exception round-trip
    { status: 'resolved', durationMs: 70, addresses: ['93.184.216.34'] },
  ];

  const result = await new DnsBenchmark(binding).benchmark();

  assert.equal(result.success, true); // at least one success
  assert.deepEqual(result.attemptDurationsMs, [50, 900, 70]);
  assert.equal(result.resolveMs, 60); // (50+70)/2 — the 900ms failure is excluded
  assert.deepEqual(result.addresses, ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']);
});

test('all attempts failed ⇒ null resolveMs and success=false (never a crash)', async () => {
  const binding = new FakeBinding();
  binding.queue = [
    { status: 'failed', durationMs: 300 },
    { status: 'failed', durationMs: 300 },
    { status: 'failed', durationMs: 300 },
  ];

  const result = await new DnsBenchmark(binding).benchmark();

  assert.equal(result.success, false);
  assert.equal(result.resolveMs, null);
  assert.deepEqual(result.addresses, []);
  assert.deepEqual(result.attemptDurationsMs, [300, 300, 300]);
});

test('bridge null (unavailable native layer) skips the attempt silently', async () => {
  const binding = new FakeBinding();
  binding.queue = [
    { status: 'bridge-null', durationMs: 0 },
    { status: 'resolved', durationMs: 25, addresses: ['93.184.216.34'] },
    { status: 'bridge-null', durationMs: 0 },
  ];

  const result = await new DnsBenchmark(binding).benchmark();

  assert.deepEqual(result.attemptDurationsMs, [25]);
  assert.equal(result.resolveMs, 25);
  assert.equal(result.success, true);
});

test('custom hostname and attempt counts pass straight through', async () => {
  const binding = new FakeBinding();
  binding.queue = [
    { status: 'resolved', durationMs: 11, addresses: ['1.2.3.4'] },
    { status: 'resolved', durationMs: 13, addresses: ['1.2.3.4'] },
  ];

  const result = await new DnsBenchmark(binding).benchmark({
    hostname: 'example.org',
    attempts: 2,
  });

  assert.deepEqual(binding.resolveCalls, ['example.org', 'example.org']);
  assert.equal(result.hostname, 'example.org');
  assert.equal(result.attemptCount, 2);
  assert.equal(result.resolveMs, 12);
});

test('attempt count floor: zero or negative collapses to one attempt', async () => {
  const binding = new FakeBinding();
  binding.queue = [{ status: 'resolved', durationMs: 5, addresses: ['1.2.3.4'] }];

  const result = await new DnsBenchmark(binding).benchmark({ attempts: 0 });
  assert.equal(result.attemptCount, 1);
  assert.equal(binding.resolveCalls.length, 1);
});

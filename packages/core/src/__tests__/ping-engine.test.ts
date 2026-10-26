/**
 * PingEngine suite (node --test) against a scripted fake native binding.
 * Documents the Phase 2 invariants at the JS boundary:
 *   - 10 sequential probes per hop with a 200ms pause between probes
 *     (interval injectable for fast, deterministic tests).
 *   - `refused` (TCP RST carrier) samples are VALID RTT measurements (hard
 *     rule #2); `timeout` / `unreachable` samples count as packet loss.
 *   - A native lie (timeout carrying an RTT) is re-neutralized to null.
 *   - No gateway ⇒ WAN-only measurement, never an exception (NFR-3).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLOUDFLARE_DNS_TARGET,
  DEFAULT_GATEWAY_PORTS,
  DEFAULT_PROBE_INTERVAL_MS,
  GATEWAY_PROBE_TIMEOUT_MS,
  GOOGLE_DNS_TARGET,
  PROBES_PER_HOP,
  WAN_PROBE_TIMEOUT_MS,
  computeHopMetrics,
  isRttCarryingOutcome,
  PingEngine,
} from '../ping-engine.ts';
import type {
  DnsResolution,
  InterfaceInfo,
  ListenerHandle,
  PingHopResult,
  PingProbeSample,
  ProbeOutcome,
  ScanEventName,
  ScanEventListener,
} from '../model.ts';
import type { NetLensNativeBinding } from '../native-binding.ts';

interface HandshakeScript {
  outcome: ProbeOutcome;
  rttMs: number | null;
}

type PingHandshakeResult = { outcome: ProbeOutcome; rttMs: number | null };

/**
 * Fake binding: per-IP script queues consumed in probe order, plus a
 * per-IP fallback once the queue drains (default: refused carrier @0.5ms).
 */
class ScriptedBinding implements NetLensNativeBinding {
  detectResult: InterfaceInfo | null = {
    localIp: '192.168.7.42',
    cidrPrefix: 24,
    gatewayIp: '192.168.7.1',
  };
  detectCalls = 0;
  private ordered = new Map<string, HandshakeScript[]>();
  private fallbacks = new Map<string, HandshakeScript>();
  handshakeCalls: { ip: string; port: number; timeoutMs: number }[] = [];
  sleepCalls: number[] = [];
  resolveCalls: string[] = [];

  enqueue(ip: string, scripts: HandshakeScript[]): void {
    this.ordered.set(ip, scripts);
  }

  setFallback(ip: string, script: HandshakeScript): void {
    this.fallbacks.set(ip, script);
  }

  addListener<E extends ScanEventName>(
    event: E,
    _listener: ScanEventListener<E>,
  ): ListenerHandle {
    void event;
    void _listener;
    return { remove: () => {} };
  }

  async detectInterface(): Promise<InterfaceInfo | null> {
    this.detectCalls += 1;
    return this.detectResult;
  }

  async measureTcpHandshake(
    ip: string,
    port: number,
    timeoutMs: number,
  ): Promise<PingHandshakeResult> {
    this.handshakeCalls.push({ ip, port, timeoutMs });
    const next = this.ordered.get(ip)?.shift();
    const script = next ?? this.fallbacks.get(ip) ?? { outcome: 'refused' as const, rttMs: 0.5 };
    return { outcome: script.outcome, rttMs: script.rttMs };
  }

  async resolveHostname(hostname: string): Promise<DnsResolution | null> {
    this.resolveCalls.push(hostname);
    throw new Error('not scripted in this suite');
  }

  async startTcpScan(): Promise<void> {}
  async stopTcpScan(): Promise<void> {}
  async startServiceDiscovery(_timeoutMs: number): Promise<void> {
    void _timeoutMs;
  }
  async stopServiceDiscovery(): Promise<void> {}
}

const instantSleep = async (): Promise<void> => undefined;

/** Healthy 2.4 GHz gateway link RTTs (1 decimal-free jitter math below). */
const GATEWAY_RTTS = [11, 13, 12, 14, 11, 12, 13, 12, 11, 13];

function sampleScript(outcome: ProbeOutcome, rttMs: number | null): HandshakeScript {
  return { outcome, rttMs };
}

test('module constants pin the SPEC §5 probe plan', () => {
  assert.equal(PROBES_PER_HOP, 10);
  assert.equal(DEFAULT_PROBE_INTERVAL_MS, 200);
  assert.equal(GATEWAY_PROBE_TIMEOUT_MS, 350);
  assert.equal(WAN_PROBE_TIMEOUT_MS, 1000);
  assert.deepEqual(DEFAULT_GATEWAY_PORTS, [80, 53, 443]);
  assert.equal(CLOUDFLARE_DNS_TARGET.ip, '1.1.1.1');
  assert.equal(GOOGLE_DNS_TARGET.ip, '8.8.8.8');
  assert.equal(CLOUDFLARE_DNS_TARGET.port, 53);
  assert.equal(GOOGLE_DNS_TARGET.port, 53);
});

test('three hop bursts of 10 sequential probes paced 200ms apart', async () => {
  const binding = new ScriptedBinding();
  binding.enqueue('192.168.7.1', GATEWAY_RTTS.map((rtt) => sampleScript('open', rtt)));
  binding.setFallback(CLOUDFLARE_DNS_TARGET.ip, sampleScript('refused', 45));
  binding.enqueue(GOOGLE_DNS_TARGET.ip, [sampleScript('timeout', null)]);
  binding.setFallback(GOOGLE_DNS_TARGET.ip, sampleScript('open', 130));

  const engine = new PingEngine(binding);
  const report = await engine.pingAll({
    sleep: (ms) => {
      binding.sleepCalls.push(ms);
      return instantSleep();
    },
  });

  // Probe pacing: 9 pauses per 10-probe burst, 3 bursts, all at the interval.
  assert.equal(binding.sleepCalls.length, (PROBES_PER_HOP - 1) * 3);
  assert.ok(binding.sleepCalls.every((ms) => ms === DEFAULT_PROBE_INTERVAL_MS));
  assert.equal(binding.handshakeCalls.length, PROBES_PER_HOP * 3);
  // Gateway hop at the hard-rule sweep timeout, WAN hops at the WAN budget.
  assert.ok(
    binding.handshakeCalls.every(
      (c) =>
        (c.ip === '192.168.7.1' && c.timeoutMs === GATEWAY_PROBE_TIMEOUT_MS) ||
        (c.ip !== '192.168.7.1' && c.timeoutMs === WAN_PROBE_TIMEOUT_MS),
    ),
  );

  // Hop order and targets.
  assert.deepEqual(
    report.hops.map((h) => h.hop),
    ['gateway', 'wan_cloudflare', 'wan_google'],
  );
  assert.equal(report.hops[0]?.targetIp, '192.168.7.1');
  assert.equal(report.hops[1]?.targetIp, CLOUDFLARE_DNS_TARGET.ip);
  assert.equal(report.hops[2]?.targetIp, GOOGLE_DNS_TARGET.ip);

  const gateway = report.gateway;
  assert.ok(gateway, 'gateway burst present when a gateway is detected');
  assert.equal(report.hops[0], report.gateway);
  // Multi-port gateway bursts rotate the port plan; the port column is null.
  assert.equal(gateway.port, null);
  assert.deepEqual(
    gateway.samples.map((s) => s.port),
    Array.from({ length: PROBES_PER_HOP }, (_, i) => DEFAULT_GATEWAY_PORTS[i % DEFAULT_GATEWAY_PORTS.length]),
  );

  // Gateway metrics straight out of the scripted RTT vector.
  const gatewayAvg = GATEWAY_RTTS.reduce((a, b) => a + b, 0) / GATEWAY_RTTS.length;
  let gatewayJitterSum = 0;
  for (let i = 1; i < GATEWAY_RTTS.length; i += 1) {
    gatewayJitterSum += Math.abs(GATEWAY_RTTS[i] - GATEWAY_RTTS[i - 1]);
  }
  assert.deepEqual(gateway.metrics, {
    avgRttMs: gatewayAvg,
    jitterMs: gatewayJitterSum / (GATEWAY_RTTS.length - 1),
    packetLossPct: 0,
  });

  // Cloudflare burst: every refused (RST) carrier is a VALID measurement.
  const cloudflare = report.hops[1] as PingHopResult;
  assert.ok(cloudflare.samples.every((s) => s.outcome === 'refused' && s.rttMs === 45));
  assert.equal(cloudflare.metrics.avgRttMs, 45);
  assert.equal(cloudflare.metrics.jitterMs, 0);
  assert.equal(cloudflare.metrics.packetLossPct, 0, 'RST must not count as loss');

  // Google burst: probe #0 lost, nine carriers at 130ms.
  const google = report.hops[2] as PingHopResult;
  assert.equal(google.metrics.packetLossPct, 10);
  assert.equal(google.metrics.avgRttMs, 130);
  assert.equal(google.metrics.jitterMs, 0);
  assert.equal(google.samples[0]?.outcome, 'timeout');
  assert.equal(google.samples[0]?.rttMs, null);
});

test('computeHopMetrics: consecutive-RTT jitter math on a synthetic burst', () => {
  const samples: PingProbeSample[] = [10, 14, 13].map((rtt, index) => ({
    index,
    port: 53,
    outcome: 'open' as const,
    rttMs: rtt,
  }));
  const metrics = computeHopMetrics(samples);
  const avgRtt = metrics.avgRttMs;
  const jitter = metrics.jitterMs;
  assert.ok(avgRtt !== null && jitter !== null, 'valid RTTs imply both metrics');
  assert.ok(Math.abs(avgRtt - 37 / 3) < 1e-9);
  assert.ok(Math.abs(jitter - 2.5) < 1e-9); // (|14-10| + |13-14|) / 2
  assert.equal(metrics.packetLossPct, 0);
});

test('computeHopMetrics: losses, and an all-lost burst never crashes', () => {
  const partial: PingProbeSample[] = Array.from({ length: 10 }, (_, index) => ({
    index,
    port: 80,
    outcome: index === 0 ? ('timeout' as const) : ('open' as const),
    rttMs: index === 0 ? null : 20,
  }));
  const partialMetrics = computeHopMetrics(partial);
  assert.equal(partialMetrics.avgRttMs, 20);
  assert.equal(partialMetrics.jitterMs, 0);
  assert.equal(partialMetrics.packetLossPct, 10);

  const allLost: PingProbeSample[] = Array.from({ length: 10 }, (_, index) => ({
    index,
    port: 80,
    outcome: 'timeout' as const,
    rttMs: null,
  }));
  const lostMetrics = computeHopMetrics(allLost);
  assert.equal(lostMetrics.avgRttMs, null);
  assert.equal(lostMetrics.jitterMs, null);
  assert.equal(lostMetrics.packetLossPct, 100);

  assert.deepEqual(computeHopMetrics([]), {
    avgRttMs: null,
    jitterMs: null,
    packetLossPct: 0,
  });
});

test('a native lie (timeout carrying an RTT) is neutralized to a lost sample', async () => {
  const binding = new ScriptedBinding();
  binding.detectResult = null; // WAN-only
  binding.enqueue(CLOUDFLARE_DNS_TARGET.ip, [sampleScript('timeout', 8)]);
  binding.setFallback(CLOUDFLARE_DNS_TARGET.ip, sampleScript('open', 47));

  const engine = new PingEngine(binding);
  const report = await engine.pingAll({ sleep: instantSleep });
  const cloudflare = report.hops[0] as PingHopResult;
  const lost = cloudflare.samples[0];
  assert.ok(lost);
  assert.equal(lost.outcome, 'timeout');
  assert.equal(lost.rttMs, null, 'non-carrier outcomes must not keep an RTT');
  assert.equal(cloudflare.metrics.packetLossPct, 10);
  assert.equal(cloudflare.metrics.avgRttMs, 47);
});

test('explicit gatewayIp hint bypasses interface detection', async () => {
  const binding = new ScriptedBinding();
  binding.setFallback(CLOUDFLARE_DNS_TARGET.ip, sampleScript('open', 60));
  binding.setFallback(GOOGLE_DNS_TARGET.ip, sampleScript('open', 60));
  binding.enqueue('10.20.30.1', [sampleScript('open', 2)]);

  const engine = new PingEngine(binding);
  const report = await engine.pingAll({
    gatewayIp: '10.20.30.1',
    sleep: instantSleep,
  });

  assert.equal(binding.detectCalls, 0);
  assert.equal(report.gateway?.targetIp, '10.20.30.1');
});

test('null gateway and exploding detectInterface both downgrade to WAN-only', async () => {
  const binding = new ScriptedBinding();
  binding.detectResult = {
    localIp: '192.168.7.42',
    cidrPrefix: 24,
    gatewayIp: null,
  };
  binding.setFallback(CLOUDFLARE_DNS_TARGET.ip, sampleScript('refused', 60));
  binding.setFallback(GOOGLE_DNS_TARGET.ip, sampleScript('open', 62));

  const engine = new PingEngine(binding);
  const report = await engine.pingAll({ sleep: instantSleep });
  assert.equal(report.gateway, null);
  assert.equal(report.hops.length, 2);
  assert.ok(report.hops.every((h) => h.hop.startsWith('wan_')));

  binding.detectInterface = async () => {
    throw new Error('native context gone');
  };
  const retry = await engine.pingAll({ sleep: instantSleep });
  assert.equal(retry.gateway, null);
  assert.equal(retry.hops.length, 2, 'NFR-3 graceful downgrade, no exception');
});

test('isRttCarryingOutcome mirrors the hard rule', () => {
  assert.equal(isRttCarryingOutcome('open'), true);
  assert.equal(isRttCarryingOutcome('refused'), true);
  assert.equal(isRttCarryingOutcome('timeout'), false);
  assert.equal(isRttCarryingOutcome('unreachable'), false);
});

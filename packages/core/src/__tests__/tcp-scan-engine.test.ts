/**
 * TcpScanEngine orchestrator suite (node --test) against a fake native
 * binding. Documents the hard OS rules at the JS boundary:
 *   - outcome 'refused' is a TCP RST ⇒ accounted as reachable with RTT.
 *   - the sweep list handed to native is the clamped /24 (≤ 254 hosts).
 *   - cancellation still produces onScanComplete(cancelled: true).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TCP_PORTS,
  DEFAULT_TCP_TIMEOUT_MS,
  NATIVE_HOST_LIMIT,
  ScanUnavailableError,
  TcpScanEngine,
} from '../tcp-scan-engine.ts';
import type { InterfaceInfo, ScanEventName, ScanEventPayloadMap, ScanEventListener } from '../model.ts';
import type { NetLensNativeBinding, TcpScanStartParams } from '../native-binding.ts';
import type { ProbeOutcome } from '../model.ts';

interface HostScript {
  outcome: ProbeOutcome;
  rttMs: number | null;
  port: number;
}

class FakeBinding implements NetLensNativeBinding {
  private listeners = new Map<ScanEventName, ScanEventListener<ScanEventName>[]>();

  detectResult: InterfaceInfo | null = {
    localIp: '192.168.7.42',
    cidrPrefix: 16,
    gatewayIp: '192.168.7.1',
  };
  scripts = new Map<string, HostScript>();
  lastStart: TcpScanStartParams | null = null;
  serviceEvents: { kind: 'mdns' | 'ssdp' | 'mdns-instance'; serviceName?: string | null }[] = [];
  stopTcpScanCalls = 0;
  stopServiceCalls = 0;
  canceled = false;

  // --- Phase 2 diagnostic surface (unsed by this suite; stubs for typing) ---

  handshakeCalls: { ip: string; port: number; timeoutMs: number }[] = [];
  resolveCalls: string[] = [];

  async measureTcpHandshake(
    ip: string,
    port: number,
    timeoutMs: number,
  ): Promise<{ outcome: ProbeOutcome; rttMs: number | null }> {
    this.handshakeCalls.push({ ip, port, timeoutMs });
    throw new Error('measureTcpHandshake is not scripted in this suite');
  }

  async udpRequest(): Promise<number[] | null> {
    return null;
  }

  async tcpFetch(): Promise<string | null> {
    return null;
  }

  async resolveHostname(hostname: string): Promise<null> {
    this.resolveCalls.push(hostname);
    throw new Error('resolveHostname is not scripted in this suite');
  }

  addListener<E extends ScanEventName>(
    event: E,
    listener: ScanEventListener<E>,
  ): { remove(): void } {
    const list = this.listeners.get(event) ?? [];
    type Boxed = ScanEventListener<ScanEventName>;
    list.push(listener as unknown as Boxed);
    this.listeners.set(event, list);
    return {
      remove: () => {
        const current = this.listeners.get(event) ?? [];
        const boxed = listener as unknown as Boxed;
        const idx = current.indexOf(boxed);
        if (idx >= 0) current.splice(idx, 1);
        this.listeners.set(event, current);
      },
    };
  }

  listenerCount(event: ScanEventName): number {
    return (this.listeners.get(event) ?? []).length;
  }

  private emit<E extends ScanEventName>(event: E, ...args: ScanEventPayloadMap[E]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      (listener as unknown as (...a: unknown[]) => void)(...args);
    }
  }

  async detectInterface(): Promise<InterfaceInfo | null> {
    return this.detectResult;
  }

  async startTcpScan(params: TcpScanStartParams): Promise<void> {
    this.lastStart = params;
    if (this.canceled) {
      this.emit('onScanComplete', {
        durationMs: 0,
        totalProbed: 0,
        hostsFound: 0,
        cancelled: true,
      });
      return;
    }
    let hostsFound = 0;
    for (const ip of params.hostIps) {
      const script = this.scripts.get(ip);
      if (script && (script.outcome === 'open' || script.outcome === 'refused')) {
        hostsFound += 1;
        this.emit('onHostDiscovered', {
          ip,
          isReachable: true,
          rttMs: script.rttMs,
          winningPort: script.port,
          outcome: script.outcome,
        });
      }
    }
    this.emit('onScanComplete', {
      durationMs: 123,
      totalProbed: params.hostIps.length,
      hostsFound,
      cancelled: false,
    });
  }

  async stopTcpScan(): Promise<void> {
    this.stopTcpScanCalls += 1;
    this.canceled = true;
  }

  async startServiceDiscovery(timeoutMs: number): Promise<void> {
    void timeoutMs;
    let mdnsCount = 0;
    let ssdpCount = 0;
    for (const item of this.serviceEvents) {
      if (item.kind === 'mdns') {
        mdnsCount += 1;
        this.emit('onServiceDiscovered', { kind: 'mdns', serviceName: item.serviceName ?? null });
      } else if (item.kind === 'mdns-instance') {
        this.emit('onServiceDiscovered', {
          kind: 'mdns-instance',
          instanceName: 'TV',
          serviceType: '_airplay._tcp',
          host: '192.168.1.5',
        });
      } else {
        ssdpCount += 1;
        this.emit('onServiceDiscovered', {
          kind: 'ssdp',
          host: '192.168.7.1',
          location: 'http://192.168.7.1:4001/desc.xml',
          server: 'Linux UPnP/1.0',
          usn: 'uuid:netlens-test::ssdp:all',
        });
      }
    }
    this.emit('onServiceScanComplete', {
      mdnsCount,
      ssdpCount,
      cancelled: false,
    });
  }

  async stopServiceDiscovery(): Promise<void> {
    this.stopServiceCalls += 1;
  }
}

function seededBinding(): FakeBinding {
  const binding = new FakeBinding();
  // HARD RULE coverage: RST/refused is alive WITH its measured RTT.
  binding.scripts.set('192.168.7.1', { outcome: 'refused', rttMs: 3, port: 62078 });
  binding.scripts.set('192.168.7.2', { outcome: 'open', rttMs: 44, port: 80 });
  binding.scripts.set('192.168.7.3', { outcome: 'open', rttMs: 30, port: 443 });
  // Silent windows: nothing to emit, they schedule themselves as timeouts.
  binding.serviceEvents.push({ kind: 'mdns', serviceName: '_http._tcp' });
  binding.serviceEvents.push({ kind: 'mdns', serviceName: '_airplay._tcp' });
  binding.serviceEvents.push({ kind: 'ssdp' });
  return binding;
}

test('scanOnce hands the clamped /24 host list to the native layer', async () => {
  const binding = seededBinding();
  const engine = new TcpScanEngine(binding);
  const summary = await engine.scanOnce();

  assert.ok(binding.lastStart, 'native startTcpScan must be invoked');
  assert.equal(binding.lastStart.hostIps.length, 256 - 2); // 254 targets
  assert.ok(binding.lastStart.hostIps.length <= NATIVE_HOST_LIMIT);
  assert.deepEqual(binding.lastStart.ports, [...DEFAULT_TCP_PORTS]);
  assert.equal(binding.lastStart.timeoutMs, DEFAULT_TCP_TIMEOUT_MS);
  assert.ok(binding.lastStart.hostIps.includes('192.168.7.42'), 'host itself probed');
  assert.ok(!binding.lastStart.hostIps.includes('192.168.7.0'));
  assert.ok(!binding.lastStart.hostIps.includes('192.168.7.255'));

  assert.equal(summary.plan.clamped, true, 'detected /16 must clamp to /24');
  assert.equal(summary.plan.prefix, 24);
  assert.equal(summary.plan.hosts.length, 254);
  assert.equal(summary.durationMs, 123);
  assert.equal(summary.cancelled, false);
});

test('refused (TCP RST) hosts are counted reachable with their measured RTT', async () => {
  const engine = new TcpScanEngine(seededBinding());
  const summary = await engine.scanOnce();

  assert.equal(summary.hostsFound, 3);
  assert.equal(summary.discovered.length, 3);
  assert.deepEqual(summary.byOutcome, { open: 2, refused: 1, timeout: 0, unreachable: 0 });

  const refused = summary.discovered.find((h) => h.ip === '192.168.7.1');
  assert.ok(refused, 'RST responder must appear in the discovered list');
  assert.equal(refused.isReachable, true);
  assert.equal(refused.rttMs, 3);
  assert.equal(refused.winningPort, 62078);
  assert.equal(refused.outcome, 'refused');
});

test('ports and timeout override flow through to the native binding', async () => {
  const binding = seededBinding();
  const engine = new TcpScanEngine(binding);
  await engine.scanOnce({ ports: [80, 443], timeoutMs: 99 });
  assert.deepEqual(binding.lastStart?.ports, [80, 443]);
  assert.equal(binding.lastStart?.timeoutMs, 99);
});

test('originIp bypasses interface detection and clamps a manual prefix', async () => {
  const binding = seededBinding();
  binding.detectResult = null; // pretend no native context; still works
  const engine = new TcpScanEngine(binding);
  const summary = await engine.scanOnce({ originIp: '10.0.0.152', requestedPrefix: 16 });

  assert.equal(summary.plan.networkIp, '10.0.0.0');
  assert.equal(summary.plan.broadcastIp, '10.0.0.255');
  assert.equal(summary.plan.hosts.length, 254);
  assert.equal(summary.plan.clamped, true);
  assert.ok(binding.lastStart?.hostIps.includes('10.0.0.152'));
});

test('scanOnce rejects with ScanUnavailableError when no interface exists', async () => {
  const binding = seededBinding();
  binding.detectResult = null;
  const engine = new TcpScanEngine(binding);
  await assert.rejects(engine.scanOnce(), { name: 'ScanUnavailableError' });
});

test('stop() cancels natively and the sweep completes with cancelled=true', async () => {
  const binding = seededBinding();
  const engine = new TcpScanEngine(binding);
  await engine.stop();
  assert.equal(binding.stopTcpScanCalls, 1);

  const summary = await engine.scanOnce();
  assert.equal(summary.cancelled, true);
  assert.equal(summary.hostsFound, 0);
  assert.equal(summary.durationMs, 0);
});

test('discoverServices aggregates mDNS + SSDP events into a bundle', async () => {
  const engine = new TcpScanEngine(seededBinding());
  const bundle = await engine.discoverServices(2750);

  assert.equal(bundle.mdns.length, 2);
  assert.equal(bundle.ssdp.length, 1);
  assert.equal(bundle.cancelled, false);
  assert.deepEqual(
    bundle.mdns.map((e) => e.serviceName),
    ['_http._tcp', '_airplay._tcp'],
  );
  assert.equal(bundle.ssdp[0]?.host, '192.168.7.1');
  assert.match(bundle.ssdp[0]?.location ?? '', /^http:\/\//);
});

test('discoverServices does not count mdns-instance events as SSDP or mDNS types', async () => {
  const binding = seededBinding();
  binding.serviceEvents.push({ kind: 'mdns-instance' });
  const bundle = await new TcpScanEngine(binding).discoverServices(2750);

  assert.equal(bundle.ssdp.length, 1);
  assert.equal(bundle.mdns.length, 2);
  assert.ok(bundle.ssdp.every((e) => e.kind === 'ssdp'));
});

test('subscription handles detach cleanly', () => {
  const binding = seededBinding();
  const engine = new TcpScanEngine(binding);

  const hostHandle = engine.onHostDiscovered(() => {});
  assert.equal(binding.listenerCount('onHostDiscovered'), 1);
  hostHandle.remove();
  assert.equal(binding.listenerCount('onHostDiscovered'), 0);

  const serviceHandle = engine.onServiceDiscovered(() => {});
  assert.equal(binding.listenerCount('onServiceDiscovered'), 1);
  serviceHandle.remove();
  assert.equal(binding.listenerCount('onServiceDiscovered'), 0);
});

test('real-time onHostDiscovered fires during the sweep', async () => {
  const binding = seededBinding();
  const engine = new TcpScanEngine(binding);
  const seen: string[] = [];
  const handle = engine.onHostDiscovered((host) => seen.push(host.ip));
  try {
    await engine.scanOnce();
  } finally {
    handle.remove();
  }
  assert.deepEqual(seen, ['192.168.7.1', '192.168.7.2', '192.168.7.3']);
});

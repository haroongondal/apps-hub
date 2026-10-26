/**
 * DiagnosticAnalyzer suite (node --test) — SPEC §5 thresholds / decision
 * order, exercised at exact boundary values:
 *   gateway rtt>30 | jitter>15 | loss>2  → LOCAL_WIFI_CONGESTION (priority 1)
 *   WAN rtt>120 | loss>2                 → ISP_WAN_DEGRADATION (priority 2)
 *   dnsResolveMs>150                     → SLOW_DNS_SERVER (priority 3)
 *   otherwise                            → HEALTHY
 * Comparisons are strict (`>`): a value sitting exactly ON a threshold is
 * not degraded.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DIAGNOSTIC_THRESHOLDS,
  DIAGNOSTIC_ADVICE,
  analyze,
  diagnose,
  isDnsSlow,
  isGatewayDegraded,
  isWanDegraded,
  summarizeWan,
  triggeredChecks,
} from '../diagnostics.ts';
import type {
  DiagnosticConclusion,
  DiagnosticInput,
  DiagnosticThresholds,
  DiagnosticVerdict,
} from '../diagnostics.ts';
import type { HopMetrics } from '../model.ts';

const T = DEFAULT_DIAGNOSTIC_THRESHOLDS;

function hop(
  avgRttMs: number | null,
  jitterMs: number | null,
  packetLossPct: number,
): HopMetrics {
  return { avgRttMs, jitterMs, packetLossPct };
}

function input(fields: {
  gateway?: HopMetrics | null;
  wan?: HopMetrics[];
  dnsResolveMs?: number | null;
}): DiagnosticInput {
  return {
    gateway: fields.gateway === undefined ? null : fields.gateway,
    wan: fields.wan ?? [],
    dnsResolveMs:
      fields.dnsResolveMs === undefined ? null : fields.dnsResolveMs,
  };
}

function thresholds(overrides: Partial<DiagnosticThresholds>) {
  return { ...T, ...overrides };
}

test('healthy when every hop sits inside the SPEC §5 limits', () => {
  const verdict = analyze(
    input({
      gateway: hop(12, 3.5, 0),
      wan: [hop(85, null, 0), hop(92, null, 0)],
      dnsResolveMs: 45,
    }),
  );
  assert.equal(verdict, 'HEALTHY');
});

test('LOCAL_WIFI_CONGESTION fires on gateway avg RTT above 30ms', () => {
  const verdict = analyze(
    input({
      gateway: hop(85, 4, 0),
      wan: [hop(70, null, 0), hop(88, null, 0)],
      dnsResolveMs: 40,
    }),
  );
  assert.equal(verdict, 'LOCAL_WIFI_CONGESTION');
});

test('LOCAL_WIFI_CONGESTION fires on gateway jitter above 15ms', () => {
  const verdict = analyze(
    input({
      gateway: hop(14, 18.2, 0),
      wan: [hop(60, null, 0), hop(65, null, 0)],
      dnsResolveMs: 40,
    }),
  );
  assert.equal(verdict, 'LOCAL_WIFI_CONGESTION');
});

test('LOCAL_WIFI_CONGESTION fires on gateway packet loss above 2%', () => {
  const verdict = analyze(
    input({
      gateway: hop(10, 2, 4), // one lost burst in ten
      wan: [hop(60, null, 0), hop(65, null, 0)],
      dnsResolveMs: 40,
    }),
  );
  assert.equal(verdict, 'LOCAL_WIFI_CONGESTION');
});

test('a dead gateway burst (100% loss) degrades as LOCAL, not offline', () => {
  const verdict = analyze(
    input({
      gateway: hop(null, null, 100),
      wan: [hop(60, null, 0), hop(65, null, 0)],
      dnsResolveMs: 40,
    }),
  );
  assert.equal(verdict, 'LOCAL_WIFI_CONGESTION');
});

test('ISP_WAN_DEGRADATION fires when the router is fine but WAN is slow', () => {
  const verdict = analyze(
    input({
      gateway: hop(3, 1, 0),
      wan: [hop(190, null, 0), hop(210, null, 0)],
      dnsResolveMs: 40,
    }),
  );
  assert.equal(verdict, 'ISP_WAN_DEGRADATION');
});

test('ISP_WAN_DEGRADATION fires on WAN packet loss even with a fast best path', () => {
  const verdict = analyze(
    input({
      gateway: hop(3, 1, 0),
      wan: [hop(40, null, 0), hop(45, null, 6)],
      dnsResolveMs: 40,
    }),
  );
  assert.equal(verdict, 'ISP_WAN_DEGRADATION');
});

test('ISP_WAN_DEGRADATION fires when both WAN paths failed entirely', () => {
  const verdict = analyze(
    input({
      gateway: hop(3, 1, 0),
      wan: [hop(null, null, 100), hop(null, null, 100)],
      dnsResolveMs: 40,
    }),
  );
  assert.equal(verdict, 'ISP_WAN_DEGRADATION');
});

test('SLOW_DNS_SERVER fires when hops are fast but example.com resolves slowly', () => {
  const verdict = analyze(
    input({
      gateway: hop(3, 1, 0),
      wan: [hop(60, null, 0), hop(65, null, 0)],
      dnsResolveMs: 180,
    }),
  );
  assert.equal(verdict, 'SLOW_DNS_SERVER');
});

test('gateway degradation outranks WAN degradation (SPEC decision order)', () => {
  const verdict = analyze(
    input({
      gateway: hop(99, 20, 10),
      wan: [hop(500, null, 50), hop(500, null, 50)],
      dnsResolveMs: 999,
    }),
  );
  assert.equal(verdict, 'LOCAL_WIFI_CONGESTION');
});

test('WAN degradation outranks slow DNS when both fire', () => {
  const verdict = analyze(
    input({
      gateway: hop(3, 1, 0),
      wan: [hop(400, null, 0), hop(400, null, 0)],
      dnsResolveMs: 400,
    }),
  );
  assert.equal(verdict, 'ISP_WAN_DEGRADATION');
});

test('boundaries are strict: values exactly ON the threshold do not trigger', () => {
  const verdict = analyze(
    input({
      gateway: hop(30, 15, 2),
      wan: [hop(120, null, 2)],
      dnsResolveMs: 150,
    }),
  );
  assert.equal(verdict, 'HEALTHY');
});

test('boundaries are strict: a hair above each threshold triggers its stage', () => {
  assert.equal(
    analyze(input({ gateway: hop(30.01, null, 0) })),
    'LOCAL_WIFI_CONGESTION',
  );
  assert.equal(
    analyze(input({ gateway: hop(30, 15.01, 0) })),
    'LOCAL_WIFI_CONGESTION',
  );
  assert.equal(
    analyze(input({ gateway: hop(30, 15, 2.01) })),
    'LOCAL_WIFI_CONGESTION',
  );
  assert.equal(
    analyze(input({ wan: [hop(120.01, null, 0)] })),
    'ISP_WAN_DEGRADATION',
  );
  assert.equal(
    analyze(input({ wan: [hop(0, null, 2.01)] })),
    'ISP_WAN_DEGRADATION',
  );
  assert.equal(analyze(input({ dnsResolveMs: 150.01 })), 'SLOW_DNS_SERVER');
});

test('summarizeWan aggregates best-path RTT and worst-path loss', () => {
  const summary = summarizeWan([hop(80, null, 0), hop(400, null, 50)]);
  assert.equal(summary.avgRttMs, 80);
  assert.equal(summary.packetLossPct, 50);
});

test('summarizeWan ignores dead paths for RTT but not for loss', () => {
  const summary = summarizeWan([hop(null, null, 100), hop(90, null, 0)]);
  assert.equal(summary.avgRttMs, 90);
  assert.equal(summary.packetLossPct, 100);
});

test('summarizeWan on no WAN data judges nothing:', () => {
  const summary = summarizeWan([]);
  assert.equal(summary.avgRttMs, null);
  assert.equal(summary.packetLossPct, 0);
  assert.equal(isWanDegraded([], T), false);
});

test('missing gateway hop and unmeasurable DNS are skipped, not degraded', () => {
  assert.equal(isGatewayDegraded(null, T), false);
  assert.equal(isDnsSlow(null, T), false);
  const verdict = analyze(input({ wan: [hop(60, null, 0)] }));
  assert.equal(verdict, 'HEALTHY');
});

test('custom thresholds override the defaults', () => {
  const verdict = analyze(
    input({ gateway: hop(35, null, 0) }),
    thresholds({ gatewayAvgRttMs: 40 }),
  );
  assert.equal(verdict, 'HEALTHY');
});

test('diagnose() bundles verdict with plain-English advice for all four outcomes', () => {
  const cases: [DiagnosticVerdict, DiagnosticInput][] = [
    [
      'HEALTHY',
      input({ gateway: hop(3, 1, 0), wan: [hop(60, null, 0)], dnsResolveMs: 30 }),
    ],
    [
      'LOCAL_WIFI_CONGESTION',
      input({ gateway: hop(85, null, 0), wan: [hop(60, null, 0)] }),
    ],
    [
      'ISP_WAN_DEGRADATION',
      input({ gateway: hop(3, null, 0), wan: [hop(190, null, 0)] }),
    ],
    [
      'SLOW_DNS_SERVER',
      input({
        gateway: hop(3, null, 0),
        wan: [hop(60, null, 0)],
        dnsResolveMs: 180,
      }),
    ],
  ];
  for (const [expected, payload] of cases) {
    const conclusion: DiagnosticConclusion = diagnose(payload);
    assert.equal(conclusion.verdict, expected);
    const advice = DIAGNOSTIC_ADVICE[expected];
    assert.equal(conclusion.title, advice.title);
    assert.ok(advice.title.trim().length > 0, 'title must be readable');
    assert.ok(advice.advice.trim().length > 50, 'advice must be actionable');
    assert.equal(conclusion.advice, advice.advice);
  }
});

test('triggeredChecks() emits human-readable trigger lines', () => {
  const reasons = triggeredChecks(
    input({ gateway: hop(85, 18.2, 4) }),
    T,
  );
  assert.deepEqual(reasons, [
    'Gateway avg RTT 85.0ms > 30ms',
    'Gateway jitter 18.2ms > 15ms',
    'Gateway packet loss 4.0% > 2%',
  ]);
  assert.equal(triggeredChecks(input({ gateway: hop(3, 1, 0) }), T).length, 0);
});

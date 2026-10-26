/**
 * DiagnosticAnalyzer — SPEC §5 "Why is my Wi-Fi slow?" decision table
 * (FR-3 / AC-4, Phase 2). Pure TypeScript and free of the ping runtime:
 * it consumes HopMetrics snapshots so unit tests can script exact boundary
 * values without touching the native binder.
 *
 * Decision order (first match wins):
 *   1. gateway avgRttMs > 30  OR gateway jitterMs > 15  OR gateway loss > 2%
 *      → LOCAL_WIFI_CONGESTION (the device↔router hop is the bottleneck)
 *   2. WAN avgRttMs > 120 OR WAN loss > 2%
 *      → ISP_WAN_DEGRADATION (router is fine, the wider path is not)
 *   3. dnsResolveMs > 150 → SLOW_DNS_SERVER (browsing hangs on name lookups)
 *   4. otherwise → HEALTHY
 *
 * WAN aggregation semantics: with two cloud targets probing independently,
 * RTT capability is judged on the BEST proven path (min avgRttMs) while
 * reliability is judged on the WORST path (max packetLossPct). A single
 * provider-specific slowdown therefore cannot fake an ISP verdict, but loss
 * observed on any WAN target still counts — a packet dropped once is dropped.
 */
import type { HopMetrics } from './model.ts';

export type DiagnosticVerdict =
  | 'HEALTHY'
  | 'LOCAL_WIFI_CONGESTION'
  | 'ISP_WAN_DEGRADATION'
  | 'SLOW_DNS_SERVER';

export interface DiagnosticThresholds {
  /** Gateway hop average RTT ceiling (ms). */
  gatewayAvgRttMs: number;
  /** Gateway hop jitter ceiling (ms). */
  gatewayJitterMs: number;
  /** Hop packet-loss ceiling (%), applied to gateway and WAN alike. */
  packetLossPct: number;
  /** WAN path average RTT ceiling (ms). */
  wanAvgRttMs: number;
  /** DNS resolver wall-time ceiling (ms). */
  dnsResolveMs: number;
}

/** SPEC §5 diagnosis heuristic thresholds. Comparisons are strict (`>`). */
export const DEFAULT_DIAGNOSTIC_THRESHOLDS: Readonly<DiagnosticThresholds> =
  Object.freeze({
    gatewayAvgRttMs: 30,
    gatewayJitterMs: 15,
    packetLossPct: 2,
    wanAvgRttMs: 120,
    dnsResolveMs: 150,
  });

export interface DiagnosticInput {
  /** Gateway hop metrics; null when no gateway could be detected (NFR-3). */
  gateway: HopMetrics | null;
  /** WAN hop snapshots (1.1.1.1 / 8.8.8.8 bursts), typically two entries. */
  wan: readonly HopMetrics[];
  /** DnsBenchmark average resolve time; null when DNS was not measurable. */
  dnsResolveMs: number | null;
}

export interface WanSummary {
  /** Best proven WAN path average RTT (min across hops carrying data). */
  avgRttMs: number | null;
  /** Worst WAN path packet loss (max); 0 when no hop data exists at all. */
  packetLossPct: number;
}

export function summarizeWan(hops: readonly HopMetrics[]): WanSummary {
  if (hops.length === 0) {
    return { avgRttMs: null, packetLossPct: 0 };
  }
  let bestRtt: number | null = null;
  let worstLoss = 0;
  for (const hop of hops) {
    const loss = hop.packetLossPct;
    if (loss > worstLoss) worstLoss = loss;
    if (hop.avgRttMs !== null && (bestRtt === null || hop.avgRttMs < bestRtt)) {
      bestRtt = hop.avgRttMs;
    }
  }
  return { avgRttMs: bestRtt, packetLossPct: worstLoss };
}

/** True when any gateway metric crosses its SPEC §5 ceiling. */
export function isGatewayDegraded(
  gateway: HopMetrics | null,
  thresholds: DiagnosticThresholds,
): boolean {
  if (!gateway) return false;
  return (
    (gateway.avgRttMs !== null && gateway.avgRttMs > thresholds.gatewayAvgRttMs) ||
    (gateway.jitterMs !== null && gateway.jitterMs > thresholds.gatewayJitterMs) ||
    gateway.packetLossPct > thresholds.packetLossPct
  );
}

/** True when the aggregated WAN view crosses its SPEC §5 ceilings. */
export function isWanDegraded(
  wan: readonly HopMetrics[],
  thresholds: DiagnosticThresholds,
): boolean {
  const summary = summarizeWan(wan);
  return (
    (summary.avgRttMs !== null && summary.avgRttMs > thresholds.wanAvgRttMs) ||
    summary.packetLossPct > thresholds.packetLossPct
  );
}

/** True when the measured DNS resolve time crosses the SPEC §5 ceiling. */
export function isDnsSlow(
  dnsResolveMs: number | null,
  thresholds: DiagnosticThresholds,
): boolean {
  return dnsResolveMs !== null && dnsResolveMs > thresholds.dnsResolveMs;
}

/** Which SPEC §5 conditions fire for the given input (helps UI/debug output). */
export function triggeredChecks(
  input: DiagnosticInput,
  thresholds: DiagnosticThresholds,
): string[] {
  const reasons: string[] = [];
  if (input.gateway && isGatewayDegraded(input.gateway, thresholds)) {
    const g = input.gateway;
    if (g.avgRttMs !== null && g.avgRttMs > thresholds.gatewayAvgRttMs) {
      reasons.push(
        `Gateway avg RTT ${g.avgRttMs.toFixed(1)}ms > ${thresholds.gatewayAvgRttMs}ms`,
      );
    }
    if (g.jitterMs !== null && g.jitterMs > thresholds.gatewayJitterMs) {
      reasons.push(
        `Gateway jitter ${g.jitterMs.toFixed(1)}ms > ${thresholds.gatewayJitterMs}ms`,
      );
    }
    if (g.packetLossPct > thresholds.packetLossPct) {
      reasons.push(
        `Gateway packet loss ${g.packetLossPct.toFixed(1)}% > ${thresholds.packetLossPct}%`,
      );
    }
  }
  if (isWanDegraded(input.wan, thresholds)) {
    const summary = summarizeWan(input.wan);
    if (summary.avgRttMs !== null && summary.avgRttMs > thresholds.wanAvgRttMs) {
      reasons.push(
        `WAN best-path avg RTT ${summary.avgRttMs.toFixed(1)}ms > ${thresholds.wanAvgRttMs}ms`,
      );
    }
    if (summary.packetLossPct > thresholds.packetLossPct) {
      reasons.push(
        `WAN worst-path packet loss ${summary.packetLossPct.toFixed(1)}% > ${thresholds.packetLossPct}%`,
      );
    }
  }
  if (isDnsSlow(input.dnsResolveMs, thresholds)) {
    reasons.push(
      `DNS resolve ${(input.dnsResolveMs as number).toFixed(1)}ms > ${thresholds.dnsResolveMs}ms`,
    );
  }
  return reasons;
}

/**
 * Pure verdict computation. A hop whose metrics are null (no data) is treated
 * as "cannot judge" rather than degraded; total burst failures surface
 * through packetLossPct = 100 and DO trigger their stage.
 */
export function analyze(
  input: DiagnosticInput,
  thresholds: DiagnosticThresholds = DEFAULT_DIAGNOSTIC_THRESHOLDS,
): DiagnosticVerdict {
  if (isGatewayDegraded(input.gateway, thresholds)) {
    return 'LOCAL_WIFI_CONGESTION';
  }
  if (isWanDegraded(input.wan, thresholds)) {
    return 'ISP_WAN_DEGRADATION';
  }
  if (isDnsSlow(input.dnsResolveMs, thresholds)) {
    return 'SLOW_DNS_SERVER';
  }
  return 'HEALTHY';
}

export interface VerdictAdvice {
  /** Plain-English overview of the verdict (AC-4 bottleneck summary). */
  title: string;
  /** What the user can do about it, phrased for non-engineers. */
  advice: string;
}

export const DIAGNOSTIC_ADVICE: Readonly<
  Record<DiagnosticVerdict, VerdictAdvice>
> = Object.freeze({
  HEALTHY: {
    title: 'Your connection looks healthy',
    advice:
      'The Wi-Fi link to your router, the internet path and DNS lookups are all fast and stable. If a particular app or website still feels slow, the bottleneck is on that service itself, not your network.',
  },
  LOCAL_WIFI_CONGESTION: {
    title: 'The Wi-Fi link to your router is the bottleneck',
    advice:
      'Latency, jitter or drops happen between this device and your router, while the wider internet is fine. Move closer to the router, try the 5 GHz band, restart the router, or pause other devices that are streaming or downloading.',
  },
  ISP_WAN_DEGRADATION: {
    title: 'Your router is fast, but the internet path is slow',
    advice:
      'The device-to-router hop is healthy while the path to the wider internet is slow or lossy. Restart your modem and router first; if these numbers stay bad, report a slow line to your internet provider and share this measurement.',
  },
  SLOW_DNS_SERVER: {
    title: 'Website addresses resolve slowly (DNS)',
    advice:
      'The internet path itself is fine, but name lookups take too long, so pages and apps hang before content loads. Switching your DNS server to 1.1.1.1 or 8.8.8.8 in the router or device settings usually fixes this.',
  },
});

export interface DiagnosticConclusion {
  verdict: DiagnosticVerdict;
  title: string;
  advice: string;
  /** Human-readable trigger lines; empty for HEALTHY. */
  reasons: string[];
}

/** analyze() plus the human-readable advice bundle for UI rendering. */
export function diagnose(
  input: DiagnosticInput,
  thresholds: DiagnosticThresholds = DEFAULT_DIAGNOSTIC_THRESHOLDS,
): DiagnosticConclusion {
  const verdict = analyze(input, thresholds);
  const { title, advice } = DIAGNOSTIC_ADVICE[verdict];
  return {
    verdict,
    title,
    advice,
    reasons: triggeredChecks(input, thresholds),
  };
}

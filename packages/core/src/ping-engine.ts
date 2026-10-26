/**
 * PingEngine — FR-3 hop measurement runtime (SPEC §5, Phase 2).
 *
 * Each hop fires 10 sequential TCP handshake probes 200ms apart through the
 * injected native binding. HARD RULE forwarded from native (AGENTS.md #2):
 * both an `open` connect AND a `refused` reply (TCP RST carrier) count as a
 * valid RTT measurement; only `timeout` / `unreachable` samples count as
 * packet loss. Metric math lives in computeHopMetrics() (pure, unit-tested).
 */
import type {
  HopMetrics,
  ProbeOutcome,
  PingHopName,
  PingHopResult,
  PingProbeSample,
  PingReport,
} from './model.ts';
import type { NetLensNativeBinding } from './native-binding.ts';

/** Sequential probes per hop (SPEC §5). */
export const PROBES_PER_HOP = 10;
/** Gap between consecutive probes inside a burst (SPEC §5). */
export const DEFAULT_PROBE_INTERVAL_MS = 200;
/** Gateway burst rotates SPEC §5's useful router ports ("80/53/443"). */
export const DEFAULT_GATEWAY_PORTS: readonly number[] = [80, 53, 443];
/** WAN hop targets (SPEC §5). */
export const CLOUDFLARE_DNS_TARGET = Object.freeze({ ip: '1.1.1.1', port: 53 });
export const GOOGLE_DNS_TARGET = Object.freeze({ ip: '8.8.8.8', port: 53 });
/**
 * Per-probe connect timeout. The gateway hop uses the hard-rule sweep
 * timeout (350ms, NFR-1); the WAN hop is granted 1s so a genuinely
 * slow-but-alive path is measured as RTT instead of faked as packet loss.
 */
export const GATEWAY_PROBE_TIMEOUT_MS = 350;
export const WAN_PROBE_TIMEOUT_MS = 1000;

/** Outcomes whose native reply carried a real TCP handshake (see §3.2). */
export function isRttCarryingOutcome(outcome: ProbeOutcome): boolean {
  return outcome === 'open' || outcome === 'refused';
}

/**
 * SPEC §5 metric math over one burst's samples:
 *   avgRttMs     = mean of valid RTTs (null when none)
 *   jitterMs     = mean of |rtt[i] - rtt[i-1]| over consecutive valid RTTs
 *                  (`zipWithNext { a,b -> abs(a-b) }.average()` in the SPEC)
 *   packetLossPct= failedCount / total × 100
 */
export function computeHopMetrics(
  samples: readonly PingProbeSample[],
): HopMetrics {
  const rtts: number[] = [];
  for (const sample of samples) {
    if (sample.rttMs !== null) rtts.push(sample.rttMs);
  }
  const packetLossPct =
    samples.length === 0
      ? 0
      : ((samples.length - rtts.length) / samples.length) * 100;
  if (rtts.length === 0) {
    return { avgRttMs: null, jitterMs: null, packetLossPct };
  }
  const avgRttMs = rtts.reduce((sum, rtt) => sum + rtt, 0) / rtts.length;
  let jitterMs: number | null = null;
  if (rtts.length >= 2) {
    let diffSum = 0;
    for (let i = 1; i < rtts.length; i += 1) {
      diffSum += Math.abs(rtts[i] - rtts[i - 1]);
    }
    jitterMs = diffSum / (rtts.length - 1);
  }
  return { avgRttMs, jitterMs, packetLossPct };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface PingEngineOptions {
  /** Sequential probes per burst. Default 10 (SPEC §5). */
  probeCount?: number;
  /** Pause between consecutive probes. Default 200ms (SPEC §5). */
  intervalMs?: number;
  /** Port plan the gateway burst rotates through. Default [80, 53, 443]. */
  gatewayPorts?: readonly number[];
  /** Connect timeout for the gateway hop. Default 350ms. */
  gatewayTimeoutMs?: number;
  /** Connect timeout for WAN hops. Default 1000ms. */
  wanTimeoutMs?: number;
  /** Injectable pause (tests fake it); defaults to real setTimeout sleep. */
  sleep?: (ms: number) => Promise<void>;
}

export interface PingRunOptions {
  /**
   * Pre-detected gateway for the first hop. When omitted, the engine asks
   * the binding for the active interface; a failed detection downgrades
   * gracefully to WAN-only measurement (NFR-3), never to an exception.
   */
  gatewayIp?: string | null;
}

export class PingEngine {
  private readonly binding: NetLensNativeBinding;

  constructor(binding: NetLensNativeBinding) {
    this.binding = binding;
  }

  /**
   * Measure the three FR-3 hops in order: gateway → 1.1.1.1:53 → 8.8.8.8:53.
   * Probes are strictly sequential inside a burst so consecutive-RTT jitter
   * stays meaningful.
   */
  async pingAll(
    options: PingEngineOptions & PingRunOptions = {},
  ): Promise<PingReport> {
    const {
      probeCount = PROBES_PER_HOP,
      intervalMs = DEFAULT_PROBE_INTERVAL_MS,
      gatewayPorts = DEFAULT_GATEWAY_PORTS,
      gatewayTimeoutMs = GATEWAY_PROBE_TIMEOUT_MS,
      wanTimeoutMs = WAN_PROBE_TIMEOUT_MS,
      sleep = defaultSleep,
      gatewayIp,
    } = options;

    const runProbe = async (
      hop: PingHopName,
      targetIp: string,
      ports: readonly number[],
      timeoutMs: number,
    ): Promise<PingHopResult> => {
      const samples: PingProbeSample[] = [];
      for (let index = 0; index < probeCount; index += 1) {
        if (index > 0) await sleep(intervalMs);
        const port = ports[index % ports.length];
        const result = await this.binding.measureTcpHandshake(
          targetIp,
          port,
          timeoutMs,
        );
        const carrying =
          isRttCarryingOutcome(result.outcome) && result.rttMs !== null;
        samples.push({
          index,
          port,
          outcome: result.outcome,
          rttMs: carrying ? result.rttMs : null,
        });
      }
      return {
        hop,
        targetIp,
        probeCount,
        port: ports.length === 1 ? ports[0] : null,
        samples,
        metrics: computeHopMetrics(samples),
      };
    };

    const hops: PingHopResult[] = [];
    let gateway: PingHopResult | null = null;

    const effectiveGateway =
      gatewayIp !== undefined ? gatewayIp : await this.detectGatewayIp();
    if (effectiveGateway) {
      gateway = await runProbe(
        'gateway',
        effectiveGateway,
        gatewayPorts,
        gatewayTimeoutMs,
      );
      hops.push(gateway);
    }

    hops.push(
      await runProbe(
        'wan_cloudflare',
        CLOUDFLARE_DNS_TARGET.ip,
        [CLOUDFLARE_DNS_TARGET.port],
        wanTimeoutMs,
      ),
    );
    hops.push(
      await runProbe(
        'wan_google',
        GOOGLE_DNS_TARGET.ip,
        [GOOGLE_DNS_TARGET.port],
        wanTimeoutMs,
      ),
    );

    return { hops, gateway };
  }

  /** Gateway detection that never throws (downgrades to WAN-only instead). */
  private async detectGatewayIp(): Promise<string | null> {
    try {
      const info = await this.binding.detectInterface();
      return info?.gatewayIp ?? null;
    } catch {
      return null;
    }
  }
}

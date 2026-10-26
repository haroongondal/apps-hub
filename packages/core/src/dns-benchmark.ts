/**
 * DnsBenchmark — FR-3 hop 3 (SPEC §5 / Phase 2). Measures OS resolver
 * wall-time (`InetAddress` / `getaddrinfo` bridge) against a standard
 * domain. Three sequential attempts keep the average stable; only
 * successful lookups feed `resolveMs` because a failed query answers
 * "is DNS broken", not "how fast is my DNS".
 */
import type { DnsBenchmarkResult, DnsResolution } from './model.ts';
import type { NetLensNativeBinding } from './native-binding.ts';

/** Standard domain resolved by the benchmark (PRD FR-3). */
export const DEFAULT_DNS_BENCHMARK_HOSTNAME = 'example.com';
/** Sequential resolution attempts. */
export const DEFAULT_DNS_ATTEMPTS = 3;

export interface DnsBenchmarkOptions {
  /** Domain to resolve. Default `example.com`. */
  hostname?: string;
  /** Sequential attempts. Default 3. */
  attempts?: number;
}

export class DnsBenchmark {
  private readonly binding: NetLensNativeBinding;

  constructor(binding: NetLensNativeBinding) {
    this.binding = binding;
  }

  /**
   * Resolve the hostname repeatedly and aggregate. Null resolutions (bridge
   * unavailable) and `success: false` lookups are recorded only as elapsed
   * facts — they never contribute addresses or latency credits.
   */
  async benchmark(options: DnsBenchmarkOptions = {}): Promise<DnsBenchmarkResult> {
    const hostname = options.hostname ?? DEFAULT_DNS_BENCHMARK_HOSTNAME;
    const attempts = Math.max(1, Math.floor(options.attempts ?? DEFAULT_DNS_ATTEMPTS));

    const attemptDurationsMs: number[] = [];
    const successfulDurationsMs: number[] = [];
    const addresses: string[] = [];

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const resolution: DnsResolution | null =
        await this.binding.resolveHostname(hostname);
      if (!resolution) continue; // bridge unavailable — no wall time known
      attemptDurationsMs.push(resolution.durationMs);
      if (resolution.success && resolution.addresses.length > 0) {
        successfulDurationsMs.push(resolution.durationMs);
        for (const address of resolution.addresses) {
          if (!addresses.includes(address)) addresses.push(address);
        }
      }
    }

    const resolveMs =
      successfulDurationsMs.length === 0
        ? null
        : successfulDurationsMs.reduce((sum, ms) => sum + ms, 0) /
          successfulDurationsMs.length;

    return {
      hostname,
      resolveMs,
      addresses,
      success: addresses.length > 0,
      attemptCount: attempts,
      attemptDurationsMs,
    };
  }
}

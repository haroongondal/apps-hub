/**
 * LatencyProber — measures real TCP handshake latency against candidate
 * relays and scores them. 1:1 port of `lib/core/network/latency_prober.dart`,
 * with the socket primitive injected: the JS runtime (Hermes) has no raw TCP
 * sockets, so on-device probing is delegated to the native module; Node
 * environments (tests, smoke tool) use `src/node-tcp-probe.ts`.
 */
import { computeFitnessScore } from './fitness.ts';
import { withProbe, type VpnNode } from './vpn-node.ts';

/**
 * Measures one TCP connect attempt. Resolves with the measured RTT in
 * milliseconds, or null on unreachability/timeout (dead relay — upstream
 * static ping remains the fallback). The socket must be destroyed
 * immediately after the handshake.
 */
export type TcpProbeFn = (
  ip: string,
  port: number,
  timeoutMs: number,
) => Promise<number | null>;

export interface LatencyProberOptions {
  concurrency?: number;
  timeoutMs?: number;
}

/**
 * Weighted node fitness score.
 *
 * `S = 40 * (speedMbps / 100) - 0.35 * rttMs + 10 * log10(uptimeSec + 1)
 *      - 0.15 * numSessions`
 *
 * `rttMs` is the measured TCP handshake RTT when available and falls back to
 * the static VPN Gate `Ping` column after a failed probe.
 */
export { computeFitnessScore };

export class LatencyProber {
  private readonly probe: TcpProbeFn;

  constructor(probe: TcpProbeFn) {
    this.probe = probe;
  }

  /** Returns new node copies, relays that answered first, then by fitness
   * score, highest first. Input nodes are never mutated. */
  async probeAndScoreNodes(
    candidates: readonly VpnNode[],
    options?: LatencyProberOptions,
  ): Promise<VpnNode[]> {
    if (candidates.length === 0) {
      return [];
    }
    const concurrency = options?.concurrency ?? 8;
    const timeoutMs = options?.timeoutMs ?? 1500;
    const workers = Math.max(1, Math.min(concurrency, candidates.length));
    const probed: Array<VpnNode | undefined> = new Array(candidates.length);

    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (nextIndex < candidates.length) {
        const index = nextIndex++;
        const candidate = candidates[index]!;
        const rttMs = await this.probe(candidate.ip, candidate.port, timeoutMs);
        const measured = withProbe(candidate, { measuredRttMs: rttMs });
        probed[index] = withProbe(measured, {
          fitnessScore: computeFitnessScore(measured),
        });
      }
    };

    await Promise.all(
      Array.from({ length: workers }, () => worker()),
    );

    const results: VpnNode[] = [];
    for (const probedNode of probed) {
      if (probedNode !== undefined) results.push(probedNode);
    }
    // A relay that never answered can't win on its listed ping: VPN Gate lists many we can't reach.
    const answered = (node: VpnNode) => (node.measuredRttMs === null ? 0 : 1);
    return results.sort((a, b) => answered(b) - answered(a) || b.fitnessScore - a.fitnessScore);
  }
}

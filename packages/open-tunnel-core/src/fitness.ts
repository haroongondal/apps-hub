/**
 * Fitness scoring formula — shared by the prober and model tests.
 * Own module so neither the prober nor the CSV parser need to import it
 * transitively; imported directly by both.
 */
import { speedMbps, uptimeSec, type VpnNode } from './vpn-node.ts';

export function computeFitnessScore(node: VpnNode): number {
  const rttMs = node.measuredRttMs ?? node.pingMs;
  return (
    40 * (speedMbps(node) / 100) -
    0.35 * rttMs +
    10 * Math.log10(uptimeSec(node) + 1) -
    0.15 * node.numSessions
  );
}

import type { VpnNode } from './vpn-node.ts';

export type RelayAttempt = 'connected' | 'failed' | 'cancelled';

export type BestRelayResult =
  | { outcome: 'connected'; node: VpnNode; attempts: number }
  | { outcome: 'cancelled'; attempts: number }
  | { outcome: 'none-left' }
  | { outcome: 'all-failed'; attempts: number };

export interface BestRelayOptions {
  failedIds: ReadonlySet<string>;
  maxAttempts: number;
  tryConnect(node: VpnNode): Promise<RelayAttempt>;
}

export function pickRelayCandidates(
  ranked: readonly VpnNode[],
  failedIds: ReadonlySet<string>,
  maxAttempts: number,
): VpnNode[] {
  return ranked.filter((node) => !failedIds.has(node.id)).slice(0, maxAttempts);
}

// A thrown start counts as a failed relay: VPN Gate lists relays that are down or refuse this client.
export async function connectRankedRelay(ranked: readonly VpnNode[], options: BestRelayOptions): Promise<BestRelayResult> {
  const candidates = pickRelayCandidates(ranked, options.failedIds, options.maxAttempts);
  if (candidates.length === 0) return { outcome: 'none-left' };
  let attempts = 0;
  for (const node of candidates) {
    attempts += 1;
    const result = await options.tryConnect(node).catch((): RelayAttempt => 'failed');
    if (result === 'connected') return { outcome: 'connected', node, attempts };
    if (result === 'cancelled') return { outcome: 'cancelled', attempts };
  }
  return { outcome: 'all-failed', attempts };
}

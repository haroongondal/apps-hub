/**
 * Relay failover policy — pure helpers the app shell applies to ranked
 * relays and native failure codes. VPN Gate relays are flaky: a failed
 * start or a dropped tunnel moves on to the next ranked candidate, and an
 * auth rejection fails over immediately even on a first connect, because
 * retrying the same relay with the same credentials cannot succeed.
 * No I/O and no state here — the shell owns the failed-id set.
 */
import type { VpnNode } from 'open-tunnel-core';
import { OPEN_TUNNEL_ERROR_CODES, type OpenTunnelErrorCode } from 'open-tunnel-native';

/** How many ranked relays one auto-select pass may try before giving up.
 * Raised from 3: VPN Gate relays go down or refuse clients often enough
 * that three tries left users stuck on thin country lists. */
export const MAX_ATTEMPTS = 6;

/** The next relay candidates: ranked order minus relays that already
 * failed this session, capped at `maxAttempts` tries per pass. */
export function pickRelayCandidates(
  ranked: readonly VpnNode[],
  failedIds: ReadonlySet<string>,
  maxAttempts: number,
): VpnNode[] {
  return ranked.filter((node) => !failedIds.has(node.id)).slice(0, maxAttempts);
}

/** True only for the engine-raised auth rejection: the relay answered but
 * refused this client, so the same relay must not be retried. */
export function isAuthError(code: OpenTunnelErrorCode | null): boolean {
  return code === OPEN_TUNNEL_ERROR_CODES.AUTH_FAILED;
}

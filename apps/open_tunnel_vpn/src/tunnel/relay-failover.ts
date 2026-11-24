/**
 * Relay failover policy — pure helpers the app shell applies to ranked
 * relays and native failure codes. VPN Gate relays are flaky: a failed
 * start or a dropped tunnel moves on to the next ranked candidate, and an
 * auth rejection fails over immediately even on a first connect, because
 * retrying the same relay with the same credentials cannot succeed.
 * No I/O and no state here — the shell owns the failed-id set.
 */
import type { BestRelayResult } from 'open-tunnel-core';
import { OPEN_TUNNEL_ERROR_CODES, type OpenTunnelErrorCode } from 'open-tunnel-native';

export { pickRelayCandidates } from 'open-tunnel-core';

/** How many ranked relays one auto-select pass may try before giving up.
 * Raised from 3: VPN Gate relays go down or refuse clients often enough
 * that three tries left users stuck on thin country lists. */
export const MAX_ATTEMPTS = 6;

/** Plain words for a pass that connected nothing; null when there is nothing to say. */
export function bestRelayFailure(result: BestRelayResult): string | null {
  if (result.outcome === 'none-left') {
    return 'Every relay here has already failed. Pull down to refresh the list, or choose another country.';
  }
  if (result.outcome === 'all-failed') {
    const tried = result.attempts === 1 ? "The best relay didn't connect" : `None of the ${result.attempts} best relays connected`;
    return `${tried}. Pull down to refresh the list, or choose another country.`;
  }
  return null;
}

/** True only for the engine-raised auth rejection: the relay answered but
 * refused this client, so the same relay must not be retried. */
export function isAuthError(code: OpenTunnelErrorCode | null): boolean {
  return code === OPEN_TUNNEL_ERROR_CODES.AUTH_FAILED;
}

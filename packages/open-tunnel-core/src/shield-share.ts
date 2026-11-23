// Not exported from index.ts: the app bundle never needs it, and Metro then never resolves app-link-contract.
import { HEALTH_AUTHORITIES, appHealthShare, defineShare } from '@apps-hub/app-link-contract';

/** One row, only while Shields is on; untrusted_now is what TunnelWall last saw, never which network it is. */
export interface ShieldRow {
  on: number;
  untrusted_now: number;
  since: number;
}

export const SHIELD_SHARE = defineShare<ShieldRow>()({
  authority: HEALTH_AUTHORITIES['open-tunnel'],
  path: 'shield',
  columns: { on: 'int', untrusted_now: 'int', since: 'long' },
  maxRows: 1,
  description: "TunnelWall's Shields: on, whether the phone is on a network the owner does not trust, since when. Read by Halo for its red pulse; no network names or addresses.",
});

export const TUNNEL_HEALTH_SHARE = appHealthShare('open-tunnel');

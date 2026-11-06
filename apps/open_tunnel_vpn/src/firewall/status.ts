import type {
  FirewallStatus,
  VpnStatusState,
} from '../../modules/open-tunnel-native/src/OpenTunnelNativeModule.ts';
import { FIREWALL_PAUSED_LINE } from './copy.ts';

export type FirewallLabel = 'On' | 'Off' | 'Paused';

export interface FirewallView {
  label: FirewallLabel;
  detail: string | null;
  canStart: boolean;
}

export const USER_PAUSED_LINE = "Traffic flows normally and isn't logged until you resume.";
export const NOT_RUNNING_LINE = "The firewall isn't running, so traffic isn't blocked or logged.";

/** Same rule as native `FirewallContract.serverHoldsSlot`. */
export function serverHoldsSlot(state: VpnStatusState): boolean {
  return state !== 'disconnected' && state !== 'error';
}

export function firewallView(status: FirewallStatus, serverConnected: boolean): FirewallView {
  const canStart = !serverConnected;
  const serverLine = serverConnected ? FIREWALL_PAUSED_LINE : null;
  // "On" needs the switch, a live process, no server connection and no pause; a running flag without the switch is stale.
  if (!status.enabled) return { label: 'Off', detail: serverLine, canStart };
  if (serverConnected) return { label: 'Paused', detail: serverLine, canStart };
  if (status.paused) return { label: 'Paused', detail: USER_PAUSED_LINE, canStart };
  if (status.running) return { label: 'On', detail: null, canStart };
  return { label: 'Off', detail: NOT_RUNNING_LINE, canStart };
}

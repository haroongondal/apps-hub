/**
 * Pure presentation state for the connection shield: the tone each tunnel
 * state renders with and the copy per state. Pure TypeScript (no React
 * imports), so both stay unit-testable on Node — the docked
 * `TunnelShield` component only reads them.
 */
import type { Tone } from '@apps-hub/ui';
import type { VpnNode } from 'open-tunnel-core';

import type { TunnelSnapshot } from '../tunnel/tunnel-client.ts';
import { countryLabel } from './format.ts';

/** One tone per contract state; all six values render distinctly. The
 * three groups are deliberately separated so busy can never be mistaken
 * for a settled on or off state: off = neutral, on = ok, transient = warn,
 * failure = danger. */
const STATE_TONE: Record<TunnelSnapshot['state'], Tone> = {
  disconnected: 'neutral',
  connecting: 'warn',
  connected: 'ok',
  reasserting: 'warn',
  disconnecting: 'warn',
  error: 'danger',
};

export function shieldTone(state: TunnelSnapshot['state']): Tone {
  return STATE_TONE[state];
}

/** True while the native side is still moving between settled states
 * (starting, re-establishing, or shutting down) — the states the shield
 * renders with a spinner and a pulsing ring instead of a static dot. */
export function shieldBusy(state: TunnelSnapshot['state']): boolean {
  return state === 'connecting' || state === 'reasserting' || state === 'disconnecting';
}

export function shieldCopy(
  tunnel: TunnelSnapshot,
  activeNode: VpnNode | null,
  scanning: boolean,
): { title: string; subtitle: string; action: string } {
  const where = activeNode ? ` to ${countryLabel(activeNode)}` : '';
  switch (tunnel.state) {
    case 'connected':
      return {
        title: 'Connected',
        subtitle: activeNode
          ? `${countryLabel(activeNode)} · ${activeNode.hostName}`
          : 'The tunnel is up',
        action: 'Tap to disconnect',
      };
    case 'connecting':
      return {
        title: `Connecting${where}`,
        subtitle: 'Opening the tunnel',
        action: 'Tap to cancel',
      };
    case 'reasserting':
      return {
        title: 'Reconnecting',
        subtitle: 'The tunnel is re-establishing',
        action: 'Tap to cancel',
      };
    case 'disconnecting':
      // The JS client commits `disconnecting` optimistically, so the copy
      // states the transition itself rather than deferring to the native
      // side for wording.
      return {
        title: 'Disconnecting',
        subtitle: 'Closing the tunnel',
        action: 'The tunnel is turning off',
      };
    case 'error':
      return {
        title: 'Connection failed',
        subtitle: scanning ? 'Measuring relays' : 'Tap to find another relay',
        action: 'Connects the fastest relay that answers',
      };
    default:
      return {
        title: 'Not connected',
        subtitle: scanning
          ? 'Measuring relays'
          : activeNode
            ? `Tap to connect to ${countryLabel(activeNode)}`
            : 'Tap to find the fastest relay',
        action: 'Connects the selected relay, or the fastest one',
      };
  }
}

/**
 * What a tap on the connection shield does in each tunnel state. Pure TypeScript, Hermes-safe.
 */
import type { VpnStatusState } from '../../modules/open-tunnel-native/src/OpenTunnelNativeModule.ts';

export type ShieldTap = 'connect' | 'retry' | 'stop' | 'none';

// Connecting and reconnecting can be cancelled: the native stop works while a start is still in progress.
export function shieldTap(state: VpnStatusState): ShieldTap {
  switch (state) {
    case 'disconnected':
      return 'connect';
    case 'error':
      return 'retry';
    case 'connecting':
    case 'reasserting':
    case 'connected':
      return 'stop';
    case 'disconnecting':
      return 'none';
  }
}

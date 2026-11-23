import type { KillSwitchStatus, VpnStatusState } from 'open-tunnel-native';

export type KillSwitchView = 'connected' | 'reconnecting' | 'blocked' | 'off';

/** `blocking` is the native block interface; `scanning` is the app moving to another relay. */
export function killSwitchView(state: VpnStatusState, blocking: boolean, scanning: boolean): KillSwitchView {
  if (state === 'connected' || state === 'reasserting') return 'connected';
  if (!blocking) return 'off';
  return state === 'connecting' || scanning ? 'reconnecting' : 'blocked';
}

export interface LockdownHint {
  title: string;
  subtitle: string;
}

/** Android only: the app cannot turn on Block connections without VPN, so it says where the switch is. */
export function lockdownHint(status: Pick<KillSwitchStatus, 'alwaysOn' | 'lockdown'>): LockdownHint {
  if (status.lockdown === true) {
    return {
      title: 'Android blocks internet without the VPN',
      subtitle: 'Always-on VPN and Block connections without VPN are on for TunnelWall.',
    };
  }
  if (status.alwaysOn === true) {
    return {
      title: 'Block internet even when TunnelWall is closed',
      subtitle: 'Always-on VPN is on. Also turn on Block connections without VPN in Android settings.',
    };
  }
  return {
    title: 'Block internet even when TunnelWall is closed',
    subtitle: 'TunnelWall can only block while it runs. In Android settings, turn on Always-on VPN and Block connections without VPN for TunnelWall.',
  };
}

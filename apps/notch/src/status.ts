export type NotchStatus = 'needs-permission' | 'off' | 'on';

export function notchStatus(canDrawOverlay: boolean, running: boolean): NotchStatus {
  if (!canDrawOverlay) return 'needs-permission';
  return running ? 'on' : 'off';
}

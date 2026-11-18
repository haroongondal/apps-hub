export type NotchStatus = 'on' | 'off';

export function notchStatus(running: boolean): NotchStatus {
  return running ? 'on' : 'off';
}

export function accessLine(allowed: boolean): string {
  return allowed
    ? 'Notch can show now playing and calls.'
    : 'Notification access is off. Turn it on to show now playing and calls.';
}

export type NotchStatus = 'on' | 'off';

export function notchStatus(running: boolean): NotchStatus {
  return running ? 'on' : 'off';
}

import type { PermissionKind, Status } from 'halo-engine';

export interface SetupRow {
  key: PermissionKind | 'audio' | 'notifications';
  label: string;
  done: boolean;
}

/** What Halo still needs from the system, in the order a person should grant it. */
export function setupRows(s: Status): SetupRow[] {
  return [
    { key: 'overlay', label: 'Show over other apps', done: s.overlayAllowed },
    { key: 'audio', label: 'Hear the music', done: s.audioAllowed },
    { key: 'listener', label: 'See which app is playing', done: s.listenerAllowed },
    { key: 'notifications', label: 'Show the running notification', done: s.notificationsAllowed },
    { key: 'battery', label: 'Run without battery limits', done: s.batteryUnrestricted },
  ];
}

/** Battery is recommended, not required. */
export const ready = (rows: SetupRow[]) => rows.every((r) => r.done || r.key === 'battery');

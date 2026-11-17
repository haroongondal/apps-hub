import type { PermissionKind, Settings, Status } from 'halo-engine';

export interface SetupRow {
  key: PermissionKind | 'audio' | 'notifications';
  label: string;
  done: boolean;
}

/** What Halo still needs from the system, in the order a person should grant it. */
export function setupRows(s: Status, settings?: Pick<Settings, 'rules'>): SetupRow[] {
  const rows: SetupRow[] = [
    { key: 'overlay', label: 'Show over other apps', done: s.overlayAllowed },
    { key: 'audio', label: 'Hear the music', done: s.audioAllowed },
    { key: 'listener', label: 'See which app is playing', done: s.listenerAllowed },
    { key: 'notifications', label: 'Show the running notification', done: s.notificationsAllowed },
    { key: 'battery', label: 'Run without battery limits', done: s.batteryUnrestricted },
  ];
  if (settings && settings.rules.apps.length > 0) rows.push({ key: 'usage', label: 'See which app is open', done: s.usageAllowed });
  return rows;
}

/** Battery is recommended, not required; usage access only serves the app hide list. */
export const ready = (rows: SetupRow[]) => rows.every((r) => r.done || r.key === 'battery' || r.key === 'usage');

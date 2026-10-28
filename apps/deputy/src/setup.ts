import type { ServiceState } from 'deputy-agent';

export type SetupAction = 'accessibility' | 'appInfo' | 'notifications' | 'battery';

export interface SetupRow {
  id: 'accessibility' | 'restricted' | 'notifications' | 'battery' | 'autostart';
  title: string;
  detail: string;
  status: 'ok' | 'todo' | 'manual';
  action: SetupAction;
}

export function setupRows(s: ServiceState): SetupRow[] {
  const live = (ok: boolean) => (ok ? 'ok' : 'todo');
  return [
    {
      id: 'accessibility',
      title: 'Turn on the Deputy accessibility service',
      detail: 'Deputy reads and taps other apps through it. Open Settings, Accessibility, then Deputy.',
      status: live(s.accessibilityEnabled),
      action: 'accessibility',
    },
    {
      id: 'restricted',
      title: 'Allow restricted settings',
      detail: 'If the accessibility switch is greyed out, open App info, tap the three-dot menu, then choose Allow restricted settings.',
      status: 'manual',
      action: 'appInfo',
    },
    {
      id: 'notifications',
      title: 'Allow notifications',
      detail: 'Deputy asks for your approval through notifications, so you can answer from any app.',
      status: live(s.notificationsAllowed),
      action: 'notifications',
    },
    {
      id: 'battery',
      title: 'Remove the battery limit',
      detail: 'Set battery use to No restrictions so the phone does not stop Deputy in the background.',
      status: live(s.batteryUnrestricted),
      action: 'battery',
    },
    {
      id: 'autostart',
      title: 'Turn on Autostart (Xiaomi phones)',
      detail: 'Open App info, then Autostart, and switch it on. The phone cannot tell Deputy whether it is on.',
      status: 'manual',
      action: 'appInfo',
    },
  ];
}

export const setupComplete = (rows: SetupRow[]): boolean => rows.every((r) => r.status !== 'todo');

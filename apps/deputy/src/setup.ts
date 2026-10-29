import type { ServiceState } from 'deputy-agent';

export type SetupAction = 'accessibility' | 'appInfo' | 'notifications' | 'battery' | 'key';

export interface SetupRow {
  id: 'accessibility' | 'restricted' | 'notifications' | 'battery' | 'autostart' | 'key';
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
      detail: 'Deputy reads and taps other apps through it. Open Accessibility, then Downloaded apps, then Deputy. On the warning that follows, tick the box and wait for OK.',
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
    {
      id: 'key',
      title: 'Add your API key',
      detail: 'Deputy sends each screen to the model with this key. Paste a Gemini API key below.',
      status: live(s.keySet),
      action: 'key',
    },
  ];
}

export const setupComplete = (rows: SetupRow[]): boolean => rows.every((r) => r.status !== 'todo');

export const canRun = (s: ServiceState): boolean => s.accessibilityEnabled && s.notificationsAllowed && s.keySet && !s.runActive;

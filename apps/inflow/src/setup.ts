import type { Status } from 'inflow-core';

export interface SetupRow {
  id: 'access' | 'restricted' | 'battery' | 'autostart' | 'sms';
  title: string;
  detail: string;
  status: 'ok' | 'todo' | 'manual';
  action: 'access' | 'appInfo' | 'battery' | 'sms';
}

export function setupRows(s: Status): SetupRow[] {
  const live = (ok: boolean) => (ok ? 'ok' : 'todo');
  return [
    {
      id: 'access',
      title: 'Turn on notification access',
      detail: 'Inflow saves each notification it can read. Open the list, tap Inflow, and switch it on. Inflow only reads notifications and never changes them.',
      status: live(s.accessGranted),
      action: 'access',
    },
    {
      id: 'restricted',
      title: 'Allow restricted settings',
      detail: 'If the Inflow switch is greyed out, open App info, tap the three-dot menu, then choose Allow restricted settings.',
      status: 'manual',
      action: 'appInfo',
    },
    {
      id: 'battery',
      title: 'Remove the battery limit',
      detail: 'Set battery use to No restrictions so the phone does not stop Inflow in the background and miss notifications.',
      status: live(s.batteryUnrestricted),
      action: 'battery',
    },
    {
      id: 'autostart',
      title: 'Turn on Autostart (Xiaomi phones)',
      detail: 'Open App info, then Autostart, and switch it on. The phone cannot tell Inflow whether it is on.',
      status: 'manual',
      action: 'appInfo',
    },
    {
      id: 'sms',
      title: 'Read SMS',
      detail: 'Inflow saves your text messages and reads bank messages to total your money. It never sends or changes a message.',
      status: live(s.smsGranted),
      action: 'sms',
    },
  ];
}

// SMS never blocks setup: if the phone refuses it, the app must still open.
export const setupComplete = (rows: SetupRow[]): boolean => rows.every((r) => r.id === 'sms' || r.status !== 'todo');

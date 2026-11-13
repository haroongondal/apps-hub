import type { Status } from 'notebox-core';

export interface HealthNotice {
  tone: 'danger' | 'warn';
  title: string;
  body: string;
  action: 'access' | 'reconnect' | null;
}

// The warning at the top of Home when capture has stopped or can't start. The first problem found wins.
export function healthNotice(s: Status, now: number): HealthNotice | null {
  void now;
  if (s.storeError !== null) {
    return { tone: 'danger', title: "Notebox can't open your saved history", body: s.storeError, action: null };
  }
  if (!s.accessGranted) {
    return {
      tone: 'danger',
      title: "Notebox isn't saving notifications",
      body: 'Notification access is off, so nothing is being saved. Turn it back on to start saving again.',
      action: 'access',
    };
  }
  if (!s.listenerConnected) {
    return {
      tone: 'warn',
      title: 'Notebox lost its connection to your notifications',
      body: 'The phone stopped the listener, so new notifications may be missed. Tap Reconnect to start it again.',
      action: 'reconnect',
    };
  }
  return null;
}

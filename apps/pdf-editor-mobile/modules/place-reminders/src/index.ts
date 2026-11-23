import { requireNativeModule } from 'expo';

export type ReminderTrigger = 'arrive' | 'leave';

/** What the native side registers: one proximity alert per entry. */
export interface NativeReminder {
  id: string;
  itemId: string;
  title: string;
  lat: number;
  lng: number;
  radiusM: number;
  trigger: ReminderTrigger;
}

export interface CurrentPlace {
  lat: number;
  lng: number;
  accuracyM: number;
}

// Errors reject with a CodedException: permission_denied, location_off, no_fix, alert_failed.
export interface PlaceRemindersModule {
  /** Replaces every registered alert with `json` (a NativeReminder[]) and saves it for reboots. */
  setReminders(json: string): Promise<void>;
  /** One fix from the last known location if it is recent, otherwise a new one (up to 20 s). */
  currentPlace(): Promise<CurrentPlace>;
}

export const PlaceReminders = requireNativeModule<PlaceRemindersModule>('PlaceReminders');

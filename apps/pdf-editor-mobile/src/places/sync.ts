import { PlaceReminders } from 'place-reminders';
import { Platform } from 'react-native';

import { openLibrary } from '../library/open-library';

/** Makes the phone's proximity alerts match the library's reminders. Call after any change to them. */
export async function syncPlaceReminders(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const reminders = await (await openLibrary()).activeReminders();
  await PlaceReminders.setReminders(JSON.stringify(reminders));
}

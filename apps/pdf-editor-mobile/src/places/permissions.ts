import { Alert, Linking, PermissionsAndroid, type Permission } from 'react-native';

const FINE: Permission = 'android.permission.ACCESS_FINE_LOCATION';
const BACKGROUND: Permission = 'android.permission.ACCESS_BACKGROUND_LOCATION';
const NOTIFICATIONS: Permission = 'android.permission.POST_NOTIFICATIONS';

export type PlacePermission = 'ready' | 'need-precise' | 'need-background';

async function ask(permission: Permission): Promise<boolean> {
  if (await PermissionsAndroid.check(permission)) return true;
  return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * Precise location first, then "Allow all the time": alerts must fire while the app is closed.
 * Android 11+ sends the background choice to Settings, so a refusal here is reported, not retried.
 */
export async function ensurePlacePermissions(): Promise<PlacePermission> {
  if (!(await ask(FINE))) return 'need-precise';
  if (!(await ask(BACKGROUND))) return 'need-background';
  await ask(NOTIFICATIONS); // without it the reminder still saves, but the notification is silent
  return 'ready';
}

export function explainMissing(verdict: Exclude<PlacePermission, 'ready'>): void {
  const body =
    verdict === 'need-precise'
      ? 'Reminders need your location. In Settings, allow Nexus to use precise location.'
      : 'So a reminder can fire while Nexus is closed, set Nexus location to "Allow all the time" in Settings.';
  Alert.alert('Location is off for reminders', body, [
    { text: 'Not now', style: 'cancel' },
    { text: 'Open settings', onPress: () => void Linking.openSettings() },
  ]);
}

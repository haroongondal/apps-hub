// Not exported from index.ts: the app bundle never needs it, and Metro then never resolves app-link-contract.
import { defineShare } from '@apps-hub/app-link-contract';

export interface WhoIsHomeRow {
  person: string;
  present: number;
  last_seen_at: number;
}

export const WHO_IS_HOME_SHARE = defineShare<WhoIsHomeRow>()({
  authority: 'com.haroon.netlens.applink',
  path: 'who_is_home',
  columns: { person: 'string', present: 'int', last_seen_at: 'long' },
  maxRows: 16,
  description: 'Who is home by the background check: the tag the owner gave a person, 1 when home, when last seen',
});

export interface NewDeviceRow {
  first_seen_at: number;
  label: string;
  acknowledged: number;
}

export const NEW_DEVICES_SHARE = defineShare<NewDeviceRow>()({
  authority: 'com.haroon.netlens.applink',
  path: 'new_devices',
  columns: { first_seen_at: 'long', label: 'string', acknowledged: 'int' },
  maxRows: 200,
  description: 'Devices the background check found new on the home Wi-Fi: when, a guess of what it is, 1 when the owner said it is theirs',
});

import { defineShare } from '@apps-hub/app-link-contract';

// One row per card with an expiry date (passes have no date yet). label is "Card" unless the owner chose Show names. Never a number, code, holder or note.
export interface ExpiryRow {
  kind: string;
  label: string;
  expires_on: string;
  days_left: number;
}

export const EXPIRY_SHARE = defineShare<ExpiryRow>()({
  authority: 'com.haroon.strongroom.applink',
  path: 'expiry',
  columns: { kind: 'string', label: 'string', expires_on: 'string', days_left: 'long' },
  description: 'Card expiry dates (and card names only when the owner turns on Show names), read by sibling apps when the owner turns on sharing',
});

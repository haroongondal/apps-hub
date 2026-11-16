import { whenLabel } from './format.ts';

export const ADDRESS_ERROR = 'Enter your Gmail address.';
export const PASSWORD_ERROR = 'An app password has 16 letters. Copy it again from your Google account.';

// Google shows app passwords in four groups of four; pasting keeps the spaces.
export const cleanAppPassword = (s: string): string => s.replace(/\s+/g, '');

export function gmailFormError(address: string, password: string): string | null {
  if (!address.trim().includes('@')) return ADDRESS_ERROR;
  return /^[A-Za-z]{16}$/.test(cleanAppPassword(password)) ? null : PASSWORD_ERROR;
}

export const syncLabel = (lastSyncAt: number | null, now: number): string =>
  lastSyncAt === null ? 'Not checked yet' : `Checked ${whenLabel(lastSyncAt, now)}`;

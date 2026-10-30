import { requireNativeModule } from 'expo';

export interface Status {
  setUp: boolean;
  unlocked: boolean;
  biometricEnabled: boolean;
  autofillSelected: boolean;
  autoLockMinutes: 1 | 5 | 15;
  unreadable: number;
  lostSaves: number;
}

export interface Row {
  id: string;
  type: 'login' | 'card' | 'note';
  name: string;
  subtitle: string;
}

export type EntryInput =
  | { type: 'login'; name: string; username: string; password: string; sites: string[]; note: string }
  | { type: 'card'; name: string; holder: string; number: string; expMonth: number | null; expYear: number | null; cvc: string; note: string }
  | { type: 'note'; name: string; text: string };

export interface EntryView {
  id: string;
  type: Row['type'];
  name: string;
  username?: string;
  sites?: string[];
  apps?: string[];
  holder?: string;
  last4?: string;
  expMonth?: number | null;
  expYear?: number | null;
  note: string;
  text?: string;
}

export interface ImportPreview {
  found: number;
  merged: number;
  flagged: number;
}

export interface Diagnostics {
  lastUnlockMs: number | null;
  browsers: { pkg: string; installed: boolean; trusted: boolean }[];
}

// Rejections carry a code (LOCKED, NOT_SET_UP, KDF_OUT_OF_RANGE, HEADER_UNREADABLE, BAD_SITE, IMPORT_*, NO_FINGERPRINT, ...) and an owner-ready message.
export interface StrongroomVaultApi {
  getStatus(): Status;
  generateRecoveryKey(): string;
  setUp(password: string, recoveryKey: string): Promise<void>;
  unlock(password: string): Promise<boolean>;
  unlockWithBiometric(): Promise<boolean>;
  recover(recoveryKey: string, newPassword: string): Promise<boolean>;
  lock(): void;
  rows(): Row[];
  entry(id: string): EntryView | null;
  reveal(id: string, field: 'password' | 'number' | 'cvc'): string;
  copy(id: string, field: 'username' | 'password' | 'number' | 'cvc'): void;
  save(id: string | null, e: EntryInput): string;
  remove(id: string): void;
  pickGoogleCsv(): Promise<ImportPreview | null>;
  commitImport(): number;
  // The password is required to turn it on; false when it's wrong or the owner cancels the prompt.
  setBiometric(enabled: boolean, password?: string): Promise<boolean>;
  setAutoLockMinutes(m: 1 | 5 | 15): void;
  changePassword(oldPw: string, newPw: string): Promise<boolean>;
  newRecoveryKey(password: string): Promise<string | null>;
  clearLostSaves(): void;
  openAutofillSettings(): void;
  // JSON.stringify({ light: palette('strongroom', 'light'), dark: palette('strongroom', 'dark') }) from @apps-hub/ui; the autofill unlock screen reads its opaque colours.
  setPalette(json: string): void;
  diagnostics(): Diagnostics;
}

export default requireNativeModule<StrongroomVaultApi>('StrongroomVault');

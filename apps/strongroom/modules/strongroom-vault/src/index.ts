import { requireNativeModule, requireNativeView } from 'expo';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

export interface Status {
  setUp: boolean;
  unlocked: boolean;
  biometricEnabled: boolean;
  autofillSelected: boolean;
  autoLockMinutes: 1 | 5 | 15;
  unreadable: number;
  lostSaves: number;
  keepAliveEnabled: boolean;
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
  // Keeps the process unfrozen so autofill requests are delivered (see KeepAliveService).
  setKeepAlive(enable: boolean): void;
  changePassword(oldPw: string, newPw: string): Promise<boolean>;
  newRecoveryKey(password: string): Promise<string | null>;
  clearLostSaves(): void;
  openAutofillSettings(): void;
  // JSON.stringify({ light: palette('strongroom', 'light'), dark: palette('strongroom', 'dark') }) from @apps-hub/ui; the autofill unlock screen reads its opaque colours.
  setPalette(json: string): void;
  diagnostics(): Diagnostics;
  addListener(event: 'onLock', listener: () => void): { remove(): void };
}

const StrongroomVault = requireNativeModule<StrongroomVaultApi>('StrongroomVault');

// Fires each time an unlocked vault locks (auto-lock, Lock now, a failed key check), so screens can drop what they show.
export const addLockListener = (listener: () => void) => StrongroomVault.addListener('onLock', listener);

// mostRecentEventCount is the eventCount of the last change JS has seen; a value sent with an older count is ignored, so it can't overwrite newer typing.
export interface SecretInputProps extends ViewProps {
  value: string;
  mostRecentEventCount: number;
  shown: boolean;
  numeric: boolean;
  multiline: boolean;
  fontFamily: string;
  fontSize: number;
  textInset: number;
  textColor: string;
  placeholder?: string;
  placeholderColor: string;
  selectionColor: string;
  label: string;
  onChangeValue: (e: NativeSyntheticEvent<{ text: string; eventCount: number }>) => void;
  onSubmit: () => void;
  onFocusChange: (e: NativeSyntheticEvent<{ focused: boolean }>) => void;
  onContentHeight: (e: NativeSyntheticEvent<{ height: number }>) => void;
}

// An input no autofill service sees (its autofill type is NONE), for every secret and note on Strongroom's own screens.
export const SecretInput = requireNativeView<SecretInputProps>('StrongroomVault');

export default StrongroomVault;

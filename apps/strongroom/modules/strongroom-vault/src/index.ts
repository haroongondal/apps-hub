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
  smsFillEnabled: boolean;
}

export interface Row {
  id: string;
  type: 'login' | 'card' | 'note';
  name: string;
  subtitle: string;
}

// A login's totp: omit the key to keep a stored code as is, '' to remove it, a raw otpauth URI (from scanQr) to set it.
export type EntryInput =
  | { type: 'login'; name: string; username: string; password: string; sites: string[]; note: string; totp?: string }
  | { type: 'card'; name: string; holder: string; number: string; expMonth: number | null; expYear: number | null; cvc: string; note: string }
  | { type: 'note'; name: string; text: string };

// A login's authenticator code, without its secret: the raw otpauth URI never leaves the vault except through the scanner.
export interface TotpInfo {
  issuer: string | null;
  account: string | null;
  algorithm: string;
  digits: number;
  period: number;
}

// §15.5: the live code and how long it stays valid. Derived in Kotlin; the secret never crosses the bridge.
export interface TotpCode {
  code: string;
  secondsLeft: number;
  period: number;
}

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
  totp?: TotpInfo;
}

export interface ImportPreview {
  found: number;
  merged: number;
  flagged: number;
  // Cards and notes, which only a Strongroom export carries.
  others: number;
}

// Progress after one scanned Authenticator export batch (§15.5): scanned of total batches.
export interface AuthenticatorProgress {
  scanned: number;
  total: number;
  entries: number;
  hotp: number;
}

// One line of the Authenticator review: a code that attaches to an existing login (login = its name)
// or becomes a new login (name). The code itself is never shown here.
export type AuthenticatorItem =
  | { kind: 'attach'; login: string; issuer: string | null; account: string | null }
  | { kind: 'create'; name: string; issuer: string | null; account: string | null };

export interface AuthenticatorReview {
  items: AuthenticatorItem[];
  created: number;
  attached: number;
  duplicates: number;
  // Counter-based (HOTP) codes, and codes refused by the same bounds as a scanned QR.
  hotp: number;
  bad: number;
}

export interface AuthenticatorCommit {
  created: number;
  attached: number;
}

// One import: the entries still exactly as imported. name and imported are null for an import made before this phone kept a log of them.
export interface ImportBatch {
  at: number;
  name: string | null;
  count: number;
  imported: number | null;
}

export interface ExportCounts {
  logins: number;
  cards: number;
  notes: number;
}

export interface Diagnostics {
  lastUnlockMs: number | null;
  browsers: { pkg: string; installed: boolean; trusted: boolean }[];
}

// 'off' also when this build has no vault server (SyncConfig.BASE_URL empty): every sync call then rejects with SYNC_UNAVAILABLE.
export type SyncState = 'off' | 'pendingSetup' | 'idle' | 'syncing' | 'needsSignIn' | 'error';

export interface SyncStatus {
  state: SyncState;
  lastSyncAt: number | null;
  blocked: number;
  quarantined: number;
  // False in a build without a vault server: the Sync entry then says "Sync isn't available in this build."
  available: boolean;
}

export interface SyncReport {
  pulled: number;
  pushed: number;
  conflicts: number;
  quarantined: number;
  blocked: number;
  headerChanged: boolean;
}

// Rejections carry a code (LOCKED, NOT_SET_UP, KDF_OUT_OF_RANGE, HEADER_UNREADABLE, ACCOUNT_KEY_REQUIRED, BAD_SITE, NO_TOTP, IMPORT_*, NO_FINGERPRINT,
// SYNC_UNAVAILABLE, SYNC_OFF, SYNC_SIGN_IN, SYNC_OFFLINE, SYNC_SERVER, SYNC_ROLLBACK, SYNC_KEY_LOST, HEADER_CHECK_FAILED, WRONG_RECOVERY_KEY,
// WRONG_SETUP_TOKEN, BAD_ACCOUNT_KEY, ...) and an owner-ready message.
export interface StrongroomVaultApi {
  getStatus(): Status;
  generateRecoveryKey(): string;
  setUp(password: string, recoveryKey: string): Promise<void>;
  unlock(password: string): Promise<boolean>;
  unlockWithBiometric(): Promise<boolean>;
  // accountKey only after ACCOUNT_KEY_REQUIRED (a flagged vault whose account key this phone lost); nothing can check it, so ask for it twice.
  recover(recoveryKey: string, newPassword: string, accountKey?: string): Promise<boolean>;
  lock(): void;
  rows(): Row[];
  entry(id: string): EntryView | null;
  reveal(id: string, field: 'password' | 'number' | 'cvc'): string;
  copy(id: string, field: 'username' | 'password' | 'number' | 'cvc' | 'totp'): void;
  // §15.5: the live code and countdown; throws NO_TOTP when the login has no code.
  totpCode(id: string): TotpCode;
  // Removes the login's code; the password and the rest of the entry stay as they are.
  removeTotp(id: string): void;
  save(id: string | null, e: EntryInput): string;
  remove(id: string): void;
  // Opens the camera and shows the parsed code for confirmation; null when the scan is cancelled.
  // The raw URI is stored by the following save. It carries the secret, so nothing but save holds it.
  scanQr(): Promise<(TotpInfo & { raw: string }) | null>;
  pickGoogleCsv(): Promise<ImportPreview | null>;
  commitImport(): number;
  // §15.5: scan the Authenticator export's batch QRs one by one, then review and commit once.
  scanAuthenticatorBatch(): Promise<AuthenticatorProgress | null>;
  authenticatorReview(): AuthenticatorReview;
  commitAuthenticatorImport(): AuthenticatorCommit;
  cancelAuthenticatorImport(): void;
  imports(): ImportBatch[];
  deleteImport(at: number): number;
  // Null when the password is wrong; rejects with EXPORT_CANCELLED when no file was picked.
  exportAll(password: string): Promise<ExportCounts | null>;
  // Null when the password is wrong; otherwise how many entries were deleted.
  deleteAll(password: string): Promise<number | null>;
  // The password is required to turn it on; false when it's wrong or the owner cancels the prompt.
  setBiometric(enabled: boolean, password?: string): Promise<boolean>;
  setAutoLockMinutes(m: 1 | 5 | 15): void;
  // Keeps the process unfrozen so autofill requests are delivered (see KeepAliveService).
  setKeepAlive(enable: boolean): void;
  // The RECEIVE_SMS permission is requested from the Settings toggle only, never at setup.
  setSmsFill(enable: boolean): void;
  changePassword(oldPw: string, newPw: string): Promise<boolean>;
  newRecoveryKey(password: string): Promise<string | null>;
  clearLostSaves(): void;
  openAutofillSettings(): void;
  // JSON.stringify({ light: palette('strongroom', 'light'), dark: palette('strongroom', 'dark') }) from @apps-hub/ui; the autofill unlock screen reads its opaque colours.
  setPalette(json: string): void;
  diagnostics(): Diagnostics;
  syncStatus(): SyncStatus;
  // A retry while pendingSetup finishes the setup it started and shows the same account key; null when the password is wrong.
  enableSync(setupToken: string, password: string, recoveryKey: string): Promise<{ accountKey: string } | null>;
  showAccountKey(password: string): Promise<string | null>;
  // For a fresh phone or one in needsSignIn; a phone that holds another vault is refused (DIFFERENT_VAULT). Both unlock the vault.
  signInSync(password: string, accountKey: string): Promise<void>;
  // accountKey is needed only on a phone that holds none (a new phone, or one whose Keystore lost it); nothing can check it, so ask for it twice.
  recoverSync(recoveryKey: string, newPassword: string, accountKey?: string): Promise<void>;
  syncNow(): Promise<SyncReport>;
  addListener(event: 'onLock', listener: () => void): { remove(): void };
  addListener(event: 'onSync', listener: (status: SyncStatus) => void): { remove(): void };
}

const StrongroomVault = requireNativeModule<StrongroomVaultApi>('StrongroomVault');

// Fires each time an unlocked vault locks (auto-lock, Lock now, a failed key check), so screens can drop what they show.
export const addLockListener = (listener: () => void) => StrongroomVault.addListener('onLock', listener);

export const addSyncListener = (listener: (status: SyncStatus) => void) => StrongroomVault.addListener('onSync', listener);

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

import type { SyncStatus } from 'strongroom-vault';
import { hasCode, messageOf } from './call.ts';
import { recoveryGroupMatches, validateMasterPassword } from './forms.ts';

export type SyncTone = 'neutral' | 'ok' | 'warn' | 'danger';
export type FormName = 'turnOn' | 'finish' | 'signIn' | 'recover';
export type SyncAction = FormName | 'syncNow' | 'showKey';
export type FieldName = 'setupToken' | 'password' | 'recoveryKey' | 'accountKey' | 'accountKeyAgain' | 'newPassword' | 'confirm';
export type Values = Record<FieldName, string>;
export type Problems = Partial<Record<FieldName, string>>;

export const EMPTY_VALUES: Values = { setupToken: '', password: '', recoveryKey: '', accountKey: '', accountKeyAgain: '', newPassword: '', confirm: '' };

export const ACTION_LABEL: Record<SyncAction, string> = {
  turnOn: 'Turn on sync',
  finish: 'Finish setting up sync',
  signIn: 'Sign in to sync',
  recover: 'Forgot master password',
  syncNow: 'Sync now',
  showKey: 'Show account key',
};

export const FIELD_LABEL: Record<FieldName, string> = {
  setupToken: 'Setup code',
  password: 'Master password',
  recoveryKey: 'Recovery key',
  accountKey: 'Account key',
  accountKeyAgain: 'Type the account key again',
  newPassword: 'New master password',
  confirm: 'Type it again',
};

export const FORM_COPY: Record<FormName, { title: string; intro: string; button: string }> = {
  turnOn: {
    title: 'Turn on sync',
    intro:
      'Sync keeps an encrypted copy of your vault on your own vault server, so your other devices can open it. Enter the setup code from when you set the server up, your master password and your recovery key.',
    button: 'Turn on sync',
  },
  finish: {
    title: 'Finish setting up sync',
    intro: "This phone is ready, but the vault server didn't finish creating your account. Enter the same details again to finish. Your account key stays the same.",
    button: 'Finish setting up sync',
  },
  signIn: {
    title: 'Sign in to sync',
    intro: 'Enter your master password and the account key you wrote down when you turned on sync.',
    button: 'Sign in',
  },
  recover: {
    title: 'Reset your master password',
    intro: 'Enter your recovery key and choose a new master password. Strongroom checks the key with the vault server, so this phone needs to be online. Your logins, cards and notes stay as they are.',
    button: 'Reset and unlock',
  },
};

export const NEEDS_SIGN_IN_BODY =
  "This phone's saved sign-in no longer works. If you changed your master password or recovery key on this phone, that change may not have reached your other devices. Signing in replaces it with the settings on the vault server, so enter the master password your other devices use, with your account key. Your logins, cards and notes on this phone are kept and sync after you sign in.";

const OFF_BODY = 'Sync keeps an encrypted copy of your vault on your own vault server, so your other devices can open it. The server never sees your passwords.';
const PENDING_BODY = "This phone is ready, but the vault server didn't finish creating your account. Finish setting up sync to get your account key and start syncing.";
const ERROR_BODY = "The last sync didn't finish. Check that this phone is online, then choose Sync now. If it fails again, the reason shows here.";

export const ALREADY_USE = 'I already use Strongroom on another device';

export const WRONG_PASSWORD = 'That password is wrong. Try again.';
const wrongRecovery = (form: FormName) =>
  `That recovery key doesn't open this vault. In Settings, choose New recovery key, write the new key down, then ${form === 'finish' ? 'finish setting up sync' : 'turn on sync'} again.`;
const WRONG_SETUP_CODE = "The vault server didn't accept that setup code. Check it and try again.";
const ACCOUNT_EXISTS = `The vault server already has a sync account. Go back and choose ${ACTION_LABEL.signIn}, then enter your master password and account key.`;
const SIGN_IN_REFUSED = "That password or account key isn't right. Check both and try again.";
const RECOVERY_REFUSED = "The vault server didn't accept that recovery key. Check each group and try again.";
const NEEDS_ACCOUNT_KEY = "This phone doesn't have your account key. Type it below, twice. It can't be checked here, so compare it with the key you wrote down.";
const KEYS_DIFFER = "The two account keys don't match. Check both against the key you wrote down.";

export const KEY_SCREEN = {
  title: 'Your account key',
  intro: 'You need it, with your master password, to sign in on another device.',
  warning: 'Write it down or print it, and keep it somewhere safe, apart from your master password. Anyone who has both can open your vault.',
  saved: "I've saved it",
  done: 'Done',
  askTitle: 'Show account key',
  askIntro: 'Enter your master password to see your account key again.',
  askAction: 'Show key',
};

export const verifyCopy = (group: number) => ({
  title: 'Check your account key',
  intro: `Type group ${group + 1} of the key you wrote down. Each group is four characters.`,
  label: `Group ${group + 1}`,
  button: 'Finish',
  again: 'Show the key again',
});

export const DONE = { turnedOn: 'Sync is on.', signedIn: 'Signed in. Sync is on.', reset: 'Master password changed.' };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function lastSynced(at: number | null, now: number): string {
  if (at === null) return 'Not synced yet';
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'Synced just now';
  if (minutes < 60) return `Synced ${plural(minutes, 'minute', 'minutes')} ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `Synced ${plural(hours, 'hour', 'hours')} ago` : `Synced ${plural(Math.floor(hours / 24), 'day', 'days')} ago`;
}

export interface SyncView {
  title: string;
  body: string | null;
  tone: SyncTone;
  actions: SyncAction[];
  notes: string[];
}

// A remote entry this phone can't open is counted in both, so the larger of the two is the honest number.
const unsyncedCount = (s: SyncStatus) => Math.max(s.blocked, s.quarantined);

function notesOf(s: SyncStatus): string[] {
  const n = unsyncedCount(s);
  if (n === 0) return [];
  const it = n === 1 ? 'it' : 'them';
  return [`${plural(n, 'entry', 'entries')} ${n === 1 ? "isn't" : "aren't"} synced. Strongroom leaves ${it} unchanged and doesn't upload ${it}. If an entry is very large, shorten it. The rest of your vault syncs as usual.`];
}

export function syncView(s: SyncStatus, now: number): SyncView {
  if (!s.available) return { title: "Sync isn't available in this build.", body: null, tone: 'neutral', actions: [], notes: [] };
  const notes = notesOf(s);
  switch (s.state) {
    case 'off':
      return { title: 'Sync is off', body: OFF_BODY, tone: 'neutral', actions: ['turnOn', 'signIn'], notes: [] };
    case 'pendingSetup':
      return { title: "Sync setup isn't finished", body: PENDING_BODY, tone: 'warn', actions: ['finish', 'signIn', 'showKey'], notes: [] };
    case 'needsSignIn':
      return { title: 'Sign in to sync again', body: NEEDS_SIGN_IN_BODY, tone: 'warn', actions: ['signIn', 'recover', 'showKey'], notes: [] };
    case 'syncing':
      return { title: 'Syncing…', body: null, tone: 'neutral', actions: ['showKey'], notes };
    case 'error':
      return { title: "Sync didn't finish", body: ERROR_BODY, tone: 'danger', actions: ['syncNow', 'showKey'], notes };
    default:
      return { title: 'Sync is on', body: `${lastSynced(s.lastSyncAt, now)}.`, tone: 'ok', actions: ['syncNow', 'showKey'], notes };
  }
}

export interface FooterLine {
  title: string;
  subtitle: string | null;
  tone: SyncTone;
}

export function syncFooter(s: SyncStatus, now: number): FooterLine | null {
  if (!s.available || s.state === 'off') return null;
  const count = unsyncedCount(s);
  const unsynced = count > 0 ? `${plural(count, 'entry', 'entries')} ${count === 1 ? "isn't" : "aren't"} synced.` : null;
  switch (s.state) {
    case 'pendingSetup':
      return { title: "Sync setup isn't finished", subtitle: null, tone: 'warn' };
    case 'needsSignIn':
      return { title: 'Sign in to sync again', subtitle: null, tone: 'warn' };
    case 'syncing':
      return { title: 'Syncing…', subtitle: unsynced, tone: 'neutral' };
    case 'error':
      return { title: "Sync didn't finish", subtitle: [s.lastSyncAt === null ? null : `${lastSynced(s.lastSyncAt, now)}.`, unsynced].filter(Boolean).join(' ') || null, tone: 'danger' };
    default:
      return { title: lastSynced(s.lastSyncAt, now), subtitle: unsynced, tone: unsynced ? 'warn' : 'ok' };
  }
}

const FIELDS: Record<FormName, FieldName[]> = {
  turnOn: ['setupToken', 'password', 'recoveryKey'],
  finish: ['setupToken', 'password', 'recoveryKey'],
  signIn: ['password', 'accountKey'],
  recover: ['recoveryKey', 'newPassword', 'confirm'],
};

export const fieldsOf = (form: FormName, askAccountKey = false): FieldName[] =>
  form === 'recover' && askAccountKey ? [...FIELDS.recover, 'accountKey', 'accountKeyAgain'] : FIELDS[form];

const squash = (s: string) => s.replace(/[\s-]/g, '').toUpperCase();

export function keyProblem(text: string, what: 'recovery key' | 'account key'): string | null {
  const key = squash(text);
  if (key === '') return `Enter your ${what}.`;
  return /^[A-Z2-7]{32}$/.test(key) ? null : `That ${what} isn't complete. It has eight groups of four characters, written with A to Z and 2 to 7. Check it and try again.`;
}

export function checkForm(form: FormName, v: Values, askAccountKey = false): Problems {
  const problems: Problems = {};
  const set = (field: FieldName, message: string | null) => {
    if (message) problems[field] = message;
  };
  if (form === 'turnOn' || form === 'finish') {
    set('setupToken', v.setupToken.trim() === '' ? 'Enter the setup code.' : null);
    set('password', v.password === '' ? 'Enter your master password.' : null);
    set('recoveryKey', keyProblem(v.recoveryKey, 'recovery key'));
  } else if (form === 'signIn') {
    set('password', v.password === '' ? 'Enter your master password.' : null);
    set('accountKey', keyProblem(v.accountKey, 'account key'));
  } else {
    set('recoveryKey', keyProblem(v.recoveryKey, 'recovery key'));
    set('newPassword', validateMasterPassword(v.newPassword, v.confirm));
    if (askAccountKey) {
      const missing = keyProblem(v.accountKey, 'account key');
      set('accountKey', missing);
      // Nothing can check an account key before the vault server takes it, and a typo would become the key on every device.
      if (!missing) set('accountKeyAgain', squash(v.accountKey) === squash(v.accountKeyAgain) ? null : KEYS_DIFFER);
    }
  }
  return problems;
}

export const accountKeyGroupProblem = (key: string, group: number, typed: string): string | null =>
  recoveryGroupMatches(key, group, typed) ? null : `That isn't group ${group + 1}. Check the key you wrote down and try again.`;

export const offerSignIn = (status: SyncStatus | null, failure: unknown): boolean =>
  hasCode(failure, 'ACCOUNT_KEY_REQUIRED') || (status?.available === true && status.state === 'needsSignIn');

export interface Explained {
  field: FieldName | null;
  message: string;
  askAccountKey: boolean;
}

// A wrong password and a wrong account key look the same to the vault server, so a refused sign-in blames both.
export function explain(form: FormName, e: unknown): Explained {
  const say = (field: FieldName | null, message = messageOf(e), askAccountKey = false): Explained => ({ field, message, askAccountKey });
  if (hasCode(e, 'WRONG_RECOVERY_KEY')) return say('recoveryKey', wrongRecovery(form));
  if (hasCode(e, 'BAD_RECOVERY_KEY')) return say('recoveryKey');
  if (hasCode(e, 'WRONG_SETUP_TOKEN')) return say('setupToken', WRONG_SETUP_CODE);
  if (hasCode(e, 'SYNC_ACCOUNT_EXISTS')) return say(null, ACCOUNT_EXISTS);
  if (hasCode(e, 'BAD_ACCOUNT_KEY')) return say('accountKey');
  if (hasCode(e, 'SYNC_SIGN_IN') && form === 'signIn') return say(null, SIGN_IN_REFUSED);
  if (hasCode(e, 'SYNC_SIGN_IN') && form === 'recover') return say('recoveryKey', RECOVERY_REFUSED);
  if (hasCode(e, 'ACCOUNT_KEY_REQUIRED') && form === 'recover') return say(null, NEEDS_ACCOUNT_KEY, true);
  return say(null);
}

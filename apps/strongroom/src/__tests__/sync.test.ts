import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SyncState, SyncStatus } from 'strongroom-vault';
import {
  ACTION_LABEL,
  ALREADY_USE,
  DONE,
  FIELD_LABEL,
  FORM_COPY,
  KEY_SCREEN,
  NEEDS_SIGN_IN_BODY,
  WRONG_PASSWORD,
  accountKeyGroupProblem,
  checkForm,
  explain,
  fieldsOf,
  keyProblem,
  lastSynced,
  syncFooter,
  syncView,
  verifyCopy,
  type FormName,
  type Values,
} from '../sync-flow.ts';

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const KEY = 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-2345-6723';
const OTHER_KEY = 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-2345-6724';
const RECOVERY = 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH';
const STATES: SyncState[] = ['off', 'pendingSetup', 'idle', 'syncing', 'needsSignIn', 'error'];

const status = (o: Partial<SyncStatus> = {}): SyncStatus => ({ state: 'idle', lastSyncAt: null, blocked: 0, quarantined: 0, available: true, ...o });
const values = (o: Partial<Values> = {}): Values => ({ setupToken: '', password: '', recoveryKey: '', accountKey: '', accountKeyAgain: '', newPassword: '', confirm: '', ...o });
const rejected = (code: string, message = 'Owner-ready text from the module.') => Object.assign(new Error(message), { code });
// The failures whose copy this module writes itself (the others show the module's own owner-ready message).
const OWN_COPY: [FormName, string][] = [
  ['turnOn', 'WRONG_RECOVERY_KEY'],
  ['finish', 'WRONG_RECOVERY_KEY'],
  ['signIn', 'SYNC_SIGN_IN'],
  ['recover', 'SYNC_SIGN_IN'],
  ['recover', 'ACCOUNT_KEY_REQUIRED'],
];
const ownMessages = () => OWN_COPY.map(([form, code]) => explain(form, rejected(code, 'Module text.')).message);

test('a build without a vault server offers nothing', () => {
  const v = syncView(status({ available: false, state: 'off' }), NOW);
  assert.equal(v.title, "Sync isn't available in this build.");
  assert.deepEqual(v.actions, []);
  assert.equal(syncFooter(status({ available: false, state: 'off' }), NOW), null);
});

test('sync that is off offers to turn it on and shows no footer', () => {
  assert.deepEqual(syncView(status({ state: 'off' }), NOW).actions, ['turnOn']);
  assert.equal(syncFooter(status({ state: 'off' }), NOW), null);
});

test('pendingSetup offers "Finish setting up sync", which asks again for the token, password and recovery key', () => {
  const v = syncView(status({ state: 'pendingSetup' }), NOW);
  assert.equal(v.actions[0], 'finish');
  assert.equal(ACTION_LABEL.finish, 'Finish setting up sync');
  assert.equal(FORM_COPY.finish.button, 'Finish setting up sync');
  assert.deepEqual(fieldsOf('finish'), ['setupToken', 'password', 'recoveryKey']);
  assert.deepEqual(fieldsOf('finish'), fieldsOf('turnOn'));
  assert.ok(v.actions.includes('showKey'), 'the account key can be shown before the setup is finished');
});

test('needsSignIn offers the password and account-key form and says a local change may not have reached other devices', () => {
  const v = syncView(status({ state: 'needsSignIn' }), NOW);
  assert.equal(v.actions[0], 'signIn');
  assert.deepEqual(fieldsOf('signIn'), ['password', 'accountKey']);
  assert.equal(v.body, NEEDS_SIGN_IN_BODY);
  assert.match(NEEDS_SIGN_IN_BODY, /may not have reached/);
  assert.match(NEEDS_SIGN_IN_BODY, /master password or recovery key/);
  assert.match(NEEDS_SIGN_IN_BODY, /replaces it/);
  assert.equal(v.tone, 'warn');
  assert.equal(syncFooter(status({ state: 'needsSignIn' }), NOW)?.title, 'Sign in to sync again');
});

test('a working sync shows when it last ran, and offers Sync now and Show account key', () => {
  const s = status({ state: 'idle', lastSyncAt: NOW - 5 * MINUTE });
  assert.deepEqual(syncView(s, NOW).actions, ['syncNow', 'showKey']);
  assert.equal(syncView(s, NOW).title, 'Sync is on');
  assert.equal(syncView(s, NOW).body, 'Synced 5 minutes ago.');
  assert.deepEqual(syncFooter(s, NOW), { title: 'Synced 5 minutes ago', subtitle: null, tone: 'ok' });
});

test('syncing and error have their own footer line', () => {
  assert.deepEqual(syncFooter(status({ state: 'syncing' }), NOW), { title: 'Syncing…', subtitle: null, tone: 'neutral' });
  const error = syncFooter(status({ state: 'error', lastSyncAt: NOW - 2 * 60 * MINUTE }), NOW);
  assert.equal(error?.title, "Sync didn't finish");
  assert.equal(error?.tone, 'danger');
  assert.match(error?.subtitle ?? '', /Synced 2 hours ago/);
  assert.deepEqual(syncView(status({ state: 'error' }), NOW).actions, ['syncNow', 'showKey']);
});

test('pendingSetup has a footer that says the setup is not finished', () => {
  assert.equal(syncFooter(status({ state: 'pendingSetup' }), NOW)?.title, "Sync setup isn't finished");
});

test('entries that did not sync or cannot be read are counted in plain words, only when there are some', () => {
  const none = syncView(status({ lastSyncAt: NOW }), NOW);
  assert.deepEqual(none.notes, []);
  const one = syncView(status({ lastSyncAt: NOW, blocked: 1, quarantined: 1 }), NOW);
  assert.deepEqual(one.notes, [
    "1 entry from the vault server can't be opened on this phone. It's kept unchanged.",
    "1 entry hasn't synced. It's kept unchanged on this phone. Update Strongroom on your other devices, then sync again.",
  ]);
  const many = syncView(status({ lastSyncAt: NOW, blocked: 3, quarantined: 2 }), NOW);
  assert.match(many.notes[0]!, /^2 entries from the vault server can't be opened/);
  assert.match(many.notes[1]!, /^3 entries haven't synced/);
  assert.equal(syncFooter(status({ lastSyncAt: NOW, blocked: 3, quarantined: 2 }), NOW)?.subtitle, "5 entries aren't synced.");
  assert.equal(syncFooter(status({ lastSyncAt: NOW, blocked: 1 }), NOW)?.subtitle, "1 entry isn't synced.");
  assert.equal(syncFooter(status({ lastSyncAt: NOW, blocked: 1 }), NOW)?.tone, 'warn');
});

test('lastSynced reads as plain relative time and survives a clock that is behind', () => {
  assert.equal(lastSynced(null, NOW), 'Not synced yet');
  assert.equal(lastSynced(NOW - 20_000, NOW), 'Synced just now');
  assert.equal(lastSynced(NOW + 5 * MINUTE, NOW), 'Synced just now');
  assert.equal(lastSynced(NOW - MINUTE, NOW), 'Synced 1 minute ago');
  assert.equal(lastSynced(NOW - 59 * MINUTE, NOW), 'Synced 59 minutes ago');
  assert.equal(lastSynced(NOW - 60 * MINUTE, NOW), 'Synced 1 hour ago');
  assert.equal(lastSynced(NOW - 23 * 60 * MINUTE, NOW), 'Synced 23 hours ago');
  assert.equal(lastSynced(NOW - 24 * 60 * MINUTE, NOW), 'Synced 1 day ago');
  assert.equal(lastSynced(NOW - 3 * 24 * 60 * MINUTE, NOW), 'Synced 3 days ago');
});

test('the setup screen refuses to continue until one group of the account key is typed back', () => {
  for (const typed of ['', '   ', 'WXYZ', 'abcd-efgh']) {
    assert.match(accountKeyGroupProblem(KEY, 2, typed) ?? '', /^That isn't group 3\. Check the key you wrote down and try again\.$/, typed);
  }
  assert.equal(accountKeyGroupProblem(KEY, 2, 'ijkl'), null);
  assert.equal(accountKeyGroupProblem(KEY, 7, ' 6 7 2 3 '), null);
  assert.notEqual(accountKeyGroupProblem(KEY, 7, 'IJKL'), null, 'a group from another place in the key does not count');
});

test('the type-back screen names the group and the key screen warns', () => {
  const v = verifyCopy(2);
  assert.equal(v.label, 'Group 3');
  assert.match(v.intro, /^Type group 3 of the key you wrote down\./);
  assert.match(KEY_SCREEN.warning, /^Write it down/);
  assert.match(KEY_SCREEN.intro, /another device/);
});

test('a typed key must look complete before anything is sent', () => {
  assert.equal(keyProblem(RECOVERY, 'recovery key'), null);
  assert.equal(keyProblem(` ${RECOVERY.toLowerCase()} `, 'recovery key'), null);
  assert.equal(keyProblem(RECOVERY.replaceAll('-', ' '), 'recovery key'), null);
  assert.equal(keyProblem(KEY, 'account key'), null);
  assert.match(keyProblem('', 'account key') ?? '', /^Enter your account key\./);
  assert.match(keyProblem('ABCD-EFGH', 'account key') ?? '', /^That account key isn't complete\./);
  assert.match(keyProblem(KEY.slice(0, -1) + '0', 'account key') ?? '', /^That account key isn't complete\./, '0 is not in the alphabet');
  assert.match(keyProblem(KEY + 'A', 'recovery key') ?? '', /^That recovery key isn't complete\./);
});

test('every flow lists the fields it asks for, and the recovery form adds the account key twice only when asked', () => {
  assert.deepEqual(fieldsOf('recover'), ['recoveryKey', 'newPassword', 'confirm']);
  assert.deepEqual(fieldsOf('recover', true), ['recoveryKey', 'newPassword', 'confirm', 'accountKey', 'accountKeyAgain']);
  assert.deepEqual(fieldsOf('signIn', true), ['password', 'accountKey']);
});

test('turn on needs the setup token, the master password and a complete recovery key', () => {
  const empty = checkForm('turnOn', values());
  assert.deepEqual(Object.keys(empty).sort(), ['password', 'recoveryKey', 'setupToken']);
  assert.equal(empty.setupToken, 'Enter the setup token.');
  assert.equal(empty.password, 'Enter your master password.');
  assert.deepEqual(checkForm('turnOn', values({ setupToken: 'abc', password: 'x', recoveryKey: RECOVERY })), {});
  assert.deepEqual(Object.keys(checkForm('finish', values({ setupToken: 'abc', password: 'x', recoveryKey: 'AAAA' }))), ['recoveryKey']);
});

test('sign in needs the password and a complete account key', () => {
  assert.deepEqual(Object.keys(checkForm('signIn', values())).sort(), ['accountKey', 'password']);
  assert.deepEqual(checkForm('signIn', values({ password: 'x', accountKey: KEY })), {});
  assert.match(checkForm('signIn', values({ password: 'x', accountKey: 'ABCD' })).accountKey ?? '', /isn't complete/);
});

test('recovering through sync applies the master password rules and checks both account key entries match', () => {
  const ok = values({ recoveryKey: RECOVERY, newPassword: 'x7Kq-m2Vw-p9Zt', confirm: 'x7Kq-m2Vw-p9Zt' });
  assert.deepEqual(checkForm('recover', ok), {});
  assert.equal(checkForm('recover', { ...ok, newPassword: 'short', confirm: 'short' }).newPassword, 'Use at least 12 characters.');
  assert.equal(checkForm('recover', { ...ok, confirm: 'x7Kq-m2Vw-p9Zu' }).newPassword, "The two passwords don't match.");
  assert.equal(checkForm('recover', { ...ok, recoveryKey: '' }).recoveryKey, 'Enter your recovery key.');
  assert.deepEqual(Object.keys(checkForm('recover', ok, true)).sort(), ['accountKey']);
  assert.deepEqual(checkForm('recover', { ...ok, accountKey: KEY, accountKeyAgain: KEY.toLowerCase().replaceAll('-', ' ') }, true), {});
  const typo = checkForm('recover', { ...ok, accountKey: KEY, accountKeyAgain: OTHER_KEY }, true);
  assert.deepEqual(Object.keys(typo), ['accountKeyAgain']);
  assert.match(typo.accountKeyAgain ?? '', /^The two account keys don't match\./);
});

test('a wrong recovery key at turn-on is explained and points to Settings, New recovery key', () => {
  const e = explain('turnOn', rejected('WRONG_RECOVERY_KEY'));
  assert.equal(e.field, 'recoveryKey');
  assert.match(e.message, /doesn't open this vault/);
  assert.match(e.message, /Settings/);
  assert.match(e.message, /New recovery key/);
  assert.equal(explain('finish', rejected('WRONG_RECOVERY_KEY')).field, 'recoveryKey');
  assert.equal(explain('turnOn', rejected('WRONG_SETUP_TOKEN', 'The vault server didn’t accept that setup token. Check it and try again.')).field, 'setupToken');
});

test('a failed sign-in blames the password or the account key, never one of them', () => {
  const e = explain('signIn', rejected('SYNC_SIGN_IN', 'The vault server did not accept this sign-in. Sign in again with your master password and account key.'));
  assert.equal(e.field, null);
  assert.match(e.message, /password or account key/);
  assert.equal(explain('signIn', rejected('BAD_ACCOUNT_KEY', "That account key isn't complete. Check it and try again.")).field, 'accountKey');
});

test('recovery asks for the account key when the phone has none, and blames the recovery key for a refusal', () => {
  const need = explain('recover', rejected('ACCOUNT_KEY_REQUIRED', 'This phone no longer holds your account key...'));
  assert.equal(need.askAccountKey, true);
  assert.equal(need.field, null);
  assert.match(need.message, /doesn't have your account key/);
  assert.match(need.message, /twice/);
  const refused = explain('recover', rejected('SYNC_SIGN_IN'));
  assert.equal(refused.field, 'recoveryKey');
  assert.match(refused.message, /recovery key/);
  assert.equal(refused.askAccountKey, false);
  assert.equal(explain('recover', rejected('BAD_RECOVERY_KEY')).field, 'recoveryKey');
});

test('other failures show the module message, and a crash shows a plain sentence', () => {
  const offline = "Strongroom couldn't reach the vault server. Check your connection and try again.";
  assert.deepEqual(explain('signIn', rejected('SYNC_OFFLINE', offline)), { field: null, message: offline, askAccountKey: false });
  assert.match(explain('turnOn', rejected('ERR_UNEXPECTED', 'java.lang.NullPointerException')).message, /^Something went wrong/);
  assert.equal(WRONG_PASSWORD, 'That password is wrong. Try again.');
});

// Everything the screens can say, gathered from the same functions they call.
function allCopy(): string[] {
  const out: string[] = [];
  for (const state of STATES) {
    for (const [blocked, quarantined] of [[0, 0], [1, 0], [0, 1], [3, 2]] as const) {
      const s = status({ state, lastSyncAt: NOW - 90 * MINUTE, blocked, quarantined });
      const v = syncView(s, NOW);
      const f = syncFooter(s, NOW);
      out.push(v.title, ...(v.body ? [v.body] : []), ...v.notes, ...(f ? [f.title, ...(f.subtitle ? [f.subtitle] : [])] : []));
    }
  }
  out.push(syncView(status({ available: false }), NOW).title, lastSynced(null, NOW), NEEDS_SIGN_IN_BODY, WRONG_PASSWORD, ALREADY_USE);
  out.push(...Object.values(ACTION_LABEL), ...Object.values(FIELD_LABEL));
  for (const f of Object.values(FORM_COPY)) out.push(f.title, f.intro, f.button);
  out.push(...Object.values(KEY_SCREEN), ...Object.values(DONE), ...Object.values(verifyCopy(2)));
  for (const form of Object.keys(FORM_COPY) as FormName[]) {
    out.push(...Object.values(checkForm(form, values({ recoveryKey: 'AAAA', accountKey: 'AAAA' }), true)));
    out.push(...Object.values(checkForm(form, values({ newPassword: 'short', confirm: 'other', accountKey: KEY, accountKeyAgain: OTHER_KEY, recoveryKey: RECOVERY }), true)));
  }
  out.push(...ownMessages(), accountKeyGroupProblem(KEY, 0, 'ZZZZ')!);
  return out;
}

test('copy is sentence case, with no ALL-CAPS words and no emoji', () => {
  const copy = allCopy();
  assert.ok(copy.length > 60, 'the copy was gathered');
  for (const text of copy) {
    assert.match(text, /^[A-Z0-9]/, `starts with a capital: ${text}`);
    assert.doesNotMatch(text, /\b[A-Z]{2,}\b/, `no ALL-CAPS word: ${text}`);
    assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, `no emoji: ${text}`);
    assert.doesNotMatch(text, /[!]/, `no shouting: ${text}`);
  }
});

test('copy uses no engineering words', () => {
  for (const text of allCopy()) {
    const plain = text.replace(/setup token/gi, 'setup code');
    assert.doesNotMatch(plain, /quarantin|\brev\b|\bblocked\b|\btokens?\b|\b[45]\d\d\b|hash|keystore|argon|hkdf|header|ciphertext|payload/i, text);
  }
});

test('every problem says what to do next', () => {
  const fix = /\b(try again|check|choose|type|enter|sign in|use|update|turn on|retry)\b/i;
  const messages: string[] = [];
  for (const form of Object.keys(FORM_COPY) as FormName[]) {
    messages.push(...Object.values(checkForm(form, values({ recoveryKey: 'AAAA', accountKey: 'AAAA' }), true)));
  }
  messages.push(...ownMessages(), NEEDS_SIGN_IN_BODY, WRONG_PASSWORD, accountKeyGroupProblem(KEY, 0, 'ZZZZ')!);
  for (const m of messages) assert.match(m, fix, m);
});

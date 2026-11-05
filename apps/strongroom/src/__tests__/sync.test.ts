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
  introFor,
  keyProblem,
  lastSynced,
  offerSignIn,
  showKeyProblem,
  signInNote,
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
  ['turnOn', 'WRONG_SETUP_TOKEN'],
  ['finish', 'WRONG_SETUP_TOKEN'],
  ['turnOn', 'SYNC_ACCOUNT_EXISTS'],
  ['finish', 'SYNC_ACCOUNT_EXISTS'],
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

test('sync that is off offers to turn it on or to sign in to an account that exists, and shows no footer', () => {
  assert.deepEqual(syncView(status({ state: 'off' }), NOW).actions, ['turnOn', 'signIn']);
  assert.equal(syncFooter(status({ state: 'off' }), NOW), null);
});

test('pendingSetup offers "Finish setting up sync", which asks again for the setup code, password and recovery key', () => {
  const v = syncView(status({ state: 'pendingSetup' }), NOW);
  assert.equal(v.actions[0], 'finish');
  assert.equal(ACTION_LABEL.finish, 'Finish setting up sync');
  assert.equal(FORM_COPY.finish.button, 'Finish setting up sync');
  assert.deepEqual(fieldsOf('finish'), ['setupToken', 'password', 'recoveryKey']);
  assert.deepEqual(fieldsOf('finish'), fieldsOf('turnOn'));
  assert.deepEqual(v.actions, ['finish', 'signIn', 'showKey'], 'the account key can be shown, and an existing account can be signed in to, before the setup is finished');
});

test('needsSignIn offers the password and account-key form and says a local change may not have reached other devices', () => {
  const v = syncView(status({ state: 'needsSignIn' }), NOW);
  assert.deepEqual(v.actions, ['signIn', 'recover', 'showKey']);
  assert.deepEqual(fieldsOf('signIn'), ['password', 'accountKey']);
  assert.equal(v.body, NEEDS_SIGN_IN_BODY);
  assert.match(NEEDS_SIGN_IN_BODY, /may not have reached/);
  assert.match(NEEDS_SIGN_IN_BODY, /master password or recovery key/);
  assert.match(NEEDS_SIGN_IN_BODY, /replaces it/);
  assert.match(NEEDS_SIGN_IN_BODY, /master password your other devices use, with your account key/, 'it asks for what the sign-in form asks for');
  assert.doesNotMatch(NEEDS_SIGN_IN_BODY, /recovery key your other devices/);
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

test('entries that did not sync are counted once, in plain words, and the advice fits every cause', () => {
  assert.deepEqual(syncView(status({ lastSyncAt: NOW }), NOW).notes, []);
  // One entry the phone can't open is both blocked and quarantined (SyncMerge): it is one entry, not two.
  const one = syncView(status({ lastSyncAt: NOW, blocked: 1, quarantined: 1 }), NOW);
  assert.equal(one.notes.length, 1);
  assert.equal(
    one.notes[0],
    "1 entry isn't synced. Strongroom leaves it unchanged and doesn't upload it. If an entry is very large, shorten it. The rest of your vault syncs as usual.",
  );
  assert.match(syncView(status({ lastSyncAt: NOW, blocked: 3, quarantined: 2 }), NOW).notes[0]!, /^3 entries aren't synced\. Strongroom leaves them unchanged and doesn't upload them\./);
  assert.match(syncView(status({ lastSyncAt: NOW, blocked: 0, quarantined: 2 }), NOW).notes[0]!, /^2 entries aren't synced\./);
  assert.match(syncView(status({ lastSyncAt: NOW, blocked: 4, quarantined: 0 }), NOW).notes[0]!, /^4 entries aren't synced\./);
  for (const note of [one.notes[0]!, syncView(status({ blocked: 2 }), NOW).notes[0]!]) assert.doesNotMatch(note, /Update Strongroom/, 'no advice that fits only one cause');
  assert.equal(syncFooter(status({ lastSyncAt: NOW, blocked: 1, quarantined: 1 }), NOW)?.subtitle, "1 entry isn't synced.");
  assert.equal(syncFooter(status({ lastSyncAt: NOW, blocked: 3, quarantined: 2 }), NOW)?.subtitle, "3 entries aren't synced.");
  assert.equal(syncFooter(status({ lastSyncAt: NOW, quarantined: 2 }), NOW)?.subtitle, "2 entries aren't synced.");
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

test('turn on needs the setup code, the master password and a complete recovery key', () => {
  const empty = checkForm('turnOn', values());
  assert.deepEqual(Object.keys(empty).sort(), ['password', 'recoveryKey', 'setupToken']);
  assert.equal(empty.setupToken, 'Enter the setup code.');
  assert.equal(FIELD_LABEL.setupToken, 'Setup code');
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
  assert.match(e.message, /then turn on sync again\.$/);
});

test('each message names the screen it appears on', () => {
  assert.match(explain('finish', rejected('WRONG_RECOVERY_KEY')).message, /then finish setting up sync again\.$/);
  for (const form of ['turnOn', 'finish'] as const) {
    const token = explain(form, rejected('WRONG_SETUP_TOKEN', "The vault server didn't accept that setup token. Check it and try again."));
    assert.equal(token.field, 'setupToken');
    assert.equal(token.message, "The vault server didn't accept that setup code. Check it and try again.");
    const exists = explain(form, rejected('SYNC_ACCOUNT_EXISTS', 'Sign in with your master password and account key instead.'));
    assert.equal(exists.field, null);
    assert.equal(
      exists.message,
      'The vault server already has a sync account. Go back and choose Sign in to sync, then enter your master password and account key. If this phone set the account up earlier, choose Show account key first.',
    );
  }
  // The copy points at buttons, so the home screen it sends the owner back to (a failed turn-on leaves pendingSetup) must have them.
  const home = syncView(status({ state: 'pendingSetup' }), NOW).actions;
  assert.ok(home.includes('signIn') && home.includes('showKey'));
  assert.ok(syncView(status({ state: 'off' }), NOW).actions.includes('signIn'));
  assert.equal(ACTION_LABEL.signIn, 'Sign in to sync');
  assert.equal(ACTION_LABEL.showKey, 'Show account key');
});

test('signing in warns before it replaces a change made on this phone', () => {
  assert.equal(signInNote('needsSignIn'), NEEDS_SIGN_IN_BODY);
  const pending = signInNote('pendingSetup') ?? '';
  assert.match(pending, /^If you changed your master password or recovery key on this phone since you started setting up sync, signing in replaces that change with the settings on the vault server\.$/);
  for (const state of ['off', 'idle', 'syncing', 'error', undefined] as const) assert.equal(signInNote(state), null, String(state));
});

test('the sign-in intro says where to get the account key when the phone has never shown it', () => {
  assert.equal(introFor('signIn', 'idle'), FORM_COPY.signIn.intro);
  assert.equal(introFor('signIn', undefined), FORM_COPY.signIn.intro);
  assert.equal(introFor('signIn', 'needsSignIn'), FORM_COPY.signIn.intro);
  assert.match(introFor('signIn', 'pendingSetup'), /go back and choose Show account key first/);
  assert.doesNotMatch(introFor('signIn', 'pendingSetup'), /wrote down/);
  for (const form of ['turnOn', 'finish', 'recover'] as const) assert.equal(introFor(form, 'pendingSetup'), FORM_COPY[form].intro);
});

test('Show account key on a phone that lost its key says so in plain words', () => {
  const lost = showKeyProblem(rejected('SYNC_OFF', 'Sync is off. Turn it on in Settings first.'));
  assert.equal(lost, "This phone doesn't have your account key any more. Use the copy you wrote down to sign in.");
  const offline = "Strongroom couldn't reach the vault server. Check your connection and try again.";
  assert.equal(showKeyProblem(rejected('SYNC_OFFLINE', offline)), offline);
  assert.match(showKeyProblem(rejected('ERR_UNEXPECTED', 'java.lang.NullPointerException')), /^Something went wrong/);
});

test('Sign in to sync is offered on the unlock screen only when it can help', () => {
  const failed = (code: string) => rejected(code);
  assert.equal(offerSignIn(status({ state: 'needsSignIn' }), null), true);
  assert.equal(offerSignIn(status({ state: 'idle' }), failed('ACCOUNT_KEY_REQUIRED')), true, 'the phone lost its account key');
  assert.equal(offerSignIn(null, failed('ACCOUNT_KEY_REQUIRED')), true);
  for (const state of STATES.filter((s) => s !== 'needsSignIn')) assert.equal(offerSignIn(status({ state }), null), false, state);
  assert.equal(offerSignIn(status({ state: 'idle' }), failed('LOCKED')), false);
  assert.equal(offerSignIn(status({ state: 'idle' }), new Error('wrong password')), false);
  assert.equal(offerSignIn(status({ state: 'needsSignIn', available: false }), null), false);
  assert.equal(offerSignIn(null, null), false);
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
  out.push(signInNote('pendingSetup')!, introFor('signIn', 'pendingSetup'), showKeyProblem(rejected('SYNC_OFF')));
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
    assert.doesNotMatch(text, /quarantin|\brev\b|\bblocked\b|\btokens?\b|\b[45]\d\d\b|hash|keystore|argon|hkdf|header|ciphertext|payload/i, text);
  }
});

test('every problem says what to do next', () => {
  const fix = /\b(try again|check|choose|type|enter|sign in|use|update|turn on|retry)\b/i;
  const messages: string[] = [];
  for (const form of Object.keys(FORM_COPY) as FormName[]) {
    messages.push(...Object.values(checkForm(form, values({ recoveryKey: 'AAAA', accountKey: 'AAAA' }), true)));
  }
  messages.push(...ownMessages(), showKeyProblem(rejected('SYNC_OFF')), NEEDS_SIGN_IN_BODY, WRONG_PASSWORD, accountKeyGroupProblem(KEY, 0, 'ZZZZ')!);
  for (const m of messages) assert.match(m, fix, m);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMON_PASSWORDS } from '../common-passwords.ts';
import { exportedNotice, filterRows, importConfirm, importRow, keyboardNotice, pickGroupIndex, recoveryGroupMatches, validateMasterPassword } from '../forms.ts';

test('an import shows its file name, or its date when the phone has no log of it', () => {
  const at = new Date(2026, 10, 6, 14, 2).getTime();
  assert.deepEqual(importRow({ at, name: 'Passwords.csv', count: 212, imported: 215 }), { title: 'Passwords.csv', subtitle: '6 Nov 2026, 14:02 · 212 entries' });
  assert.deepEqual(importRow({ at, name: null, count: 1, imported: null }), { title: 'Imported 6 Nov 2026, 14:02', subtitle: '1 entry' });
});

test('deleting an import says how many edited entries it leaves alone', () => {
  assert.equal(importConfirm({ at: 0, name: 'a.csv', count: 212, imported: 215 }), "This deletes the 212 entries still exactly as imported. 3 entries you've edited or deleted since aren't touched. This can't be undone.");
  assert.equal(importConfirm({ at: 0, name: 'a.csv', count: 4, imported: 5 }), "This deletes the 4 entries still exactly as imported. 1 entry you've edited or deleted since isn't touched. This can't be undone.");
  assert.equal(importConfirm({ at: 0, name: null, count: 1, imported: null }), "This deletes the 1 entry still exactly as imported. This can't be undone.");
});

test('the export notice counts each kind', () => {
  assert.match(exportedNotice({ logins: 1, cards: 0, notes: 2 }), /^Exported 1 login, 0 cards and 2 notes\. /);
});

const TOO_SHORT = 'Use at least 12 characters.';
const TOO_COMMON = 'That password is too common. Pick something only you would think of.';
const same = (pw: string) => validateMasterPassword(pw, pw);

test('rejects 11 characters, accepts 12', () => {
  assert.equal(same('a1b2c3d4e5f'), TOO_SHORT);
  assert.equal(same('a1b2c3d4e5f6'), null);
});

test('rejects mismatched confirm', () => {
  assert.equal(validateMasterPassword('x7Kq-m2Vw-p9Zt', 'x7Kq-m2Vw-p9Zu'), "The two passwords don't match.");
});

test('rejects common 12-character passwords', () => {
  const [common] = [...COMMON_PASSWORDS];
  assert.ok(common && common.length >= 12);
  for (const pw of [common.toUpperCase(), 'aaaaaaaaaaaa', 'abcdefghijkl', 'lkjihgfedcba']) assert.equal(same(pw), TOO_COMMON, pw);
  assert.equal(same('x7Kq-m2Vw-p9Zt'), null);
});

test('only whole straight runs count as sequences', () => {
  assert.equal(same('abcdefghijkm'), null);
  assert.equal(same('012345678901'), null);
});

test('checks length before commonness before the match', () => {
  assert.equal(validateMasterPassword('short', 'other'), TOO_SHORT);
  assert.equal(validateMasterPassword('aaaaaaaaaaaa', 'other'), TOO_COMMON);
});

const KEY = 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH';

test('recovery group check ignores case and spaces', () => {
  assert.equal(recoveryGroupMatches(KEY, 1, ' bbbb '), true);
  assert.equal(recoveryGroupMatches(KEY, 7, 'h h H h'), true);
});

test('recovery group check rejects wrong group', () => {
  assert.equal(recoveryGroupMatches(KEY, 1, 'AAAA'), false);
  assert.equal(recoveryGroupMatches(KEY, 1, ''), false);
  assert.equal(recoveryGroupMatches(KEY, 8, 'AAAA'), false);
});

const ROWS = [
  { id: '1', type: 'login' as const, name: 'GitHub', subtitle: 'Octo@Example.com' },
  { id: '2', type: 'login' as const, name: 'Bank app', subtitle: 'customer_0142' },
];

test('filterRows matches name and username, case-insensitive', () => {
  assert.deepEqual(filterRows(ROWS, 'GIT').map((r) => r.id), ['1']);
  assert.deepEqual(filterRows(ROWS, 'cUSTOMER').map((r) => r.id), ['2']);
  assert.deepEqual(filterRows(ROWS, 'octo@').map((r) => r.id), ['1']);
  assert.deepEqual(filterRows(ROWS, 'nothing'), []);
});

test('filterRows with empty query returns all rows', () => {
  assert.deepEqual(filterRows(ROWS, ''), ROWS);
  assert.deepEqual(filterRows(ROWS, '  '), ROWS);
});

test('keyboardNotice warns about letters outside A-Z, without blocking', () => {
  const warning = "This password uses letters outside A–Z. Type it with the same keyboard on every device, or Strongroom won't recognise it.";
  assert.equal(keyboardNotice('x7Kq-m2Vw-p9Zt ~!@#$%^&*()'), null);
  assert.equal(keyboardNotice(''), null);
  for (const pw of ['میرا خفیہ کوڈ 7731', 'Crème brûlée 2026', 'vault \u{1F510} 2026']) {
    assert.equal(keyboardNotice(pw), warning, pw);
    assert.equal(same(pw), null, pw);
  }
});

test('pickGroupIndex covers 0 to 7', () => {
  assert.equal(pickGroupIndex(() => 0), 0);
  assert.equal(pickGroupIndex(() => 0.999999), 7);
  assert.equal(pickGroupIndex(() => 0.5), 4);
});

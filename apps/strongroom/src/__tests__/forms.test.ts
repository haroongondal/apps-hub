import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMON_PASSWORDS } from '../common-passwords.ts';
import { filterRows, pickGroupIndex, recoveryGroupMatches, validateMasterPassword } from '../forms.ts';

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

test('pickGroupIndex covers 0 to 7', () => {
  assert.equal(pickGroupIndex(() => 0), 0);
  assert.equal(pickGroupIndex(() => 0.999999), 7);
  assert.equal(pickGroupIndex(() => 0.5), 4);
});

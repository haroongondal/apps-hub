import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADDRESS_ERROR, PASSWORD_ERROR, cleanAppPassword, gmailFormError, syncLabel } from '../gmail.ts';

test('an app password pasted in groups is 16 letters and valid', () => {
  assert.equal(cleanAppPassword('abcd efgh ijkl mnop'), 'abcdefghijklmnop');
  assert.equal(cleanAppPassword(' abcd\tefgh\nijkl  mnop '), 'abcdefghijklmnop');
  assert.equal(gmailFormError('me@gmail.com', 'abcd efgh ijkl mnop'), null);
});

test('15 letters, or a digit, gives the app password copy', () => {
  assert.equal(gmailFormError('me@gmail.com', 'abcd efgh ijkl mno'), PASSWORD_ERROR);
  assert.equal(gmailFormError('me@gmail.com', 'abcd efgh ijkl mno1'), PASSWORD_ERROR);
  assert.equal(gmailFormError('me@gmail.com', ''), PASSWORD_ERROR);
});

test('a blank or @-less address gives the address copy, before the password check', () => {
  assert.equal(gmailFormError('  ', 'abcd efgh ijkl mnop'), ADDRESS_ERROR);
  assert.equal(gmailFormError('me', ''), ADDRESS_ERROR);
});

test('syncLabel says when it last checked', () => {
  const now = Date.UTC(2026, 10, 13, 7, 30);
  assert.equal(syncLabel(null, now), 'Not checked yet');
  assert.equal(syncLabel(now - 60_000, now), 'Checked 12:29');
});

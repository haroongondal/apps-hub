import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessLine, notchStatus } from '../island/status.ts';

test('the status follows the accessibility service', () => {
  assert.equal(notchStatus(true), 'on');
  assert.equal(notchStatus(false), 'off');
});

test('the access line says what to do when access is off', () => {
  assert.equal(accessLine(true), 'Notch can show now playing and calls.');
  assert.ok(accessLine(false).includes('Turn it on'));
});

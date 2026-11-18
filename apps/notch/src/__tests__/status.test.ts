import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notchStatus } from '../status.ts';

test('the status follows the accessibility service', () => {
  assert.equal(notchStatus(true), 'on');
  assert.equal(notchStatus(false), 'off');
});

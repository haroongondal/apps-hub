import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notchStatus } from '../status.ts';

test('without the permission nothing else matters', () => {
  assert.equal(notchStatus(false, false), 'needs-permission');
  assert.equal(notchStatus(false, true), 'needs-permission');
});

test('with the permission it follows the service', () => {
  assert.equal(notchStatus(true, false), 'off');
  assert.equal(notchStatus(true, true), 'on');
});

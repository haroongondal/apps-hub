import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Status } from 'inflow-core';
import { healthNotice } from '../health.ts';

const NOW = 1_800_000_000_000;

const healthy: Status = {
  accessGranted: true,
  listenerConnected: true,
  lastCaptureAt: NOW - 1000,
  batteryUnrestricted: true,
  storeError: null,
};

test('a store error comes first, with the error as the body and no action', () => {
  const n = healthNotice({ ...healthy, accessGranted: false, listenerConnected: false, storeError: 'Could not open the database.' }, NOW);
  assert.ok(n);
  assert.equal(n.tone, 'danger');
  assert.equal(n.body, 'Could not open the database.');
  assert.equal(n.action, null);
});

test('access off is a danger notice that opens notification access', () => {
  const n = healthNotice({ ...healthy, accessGranted: false, listenerConnected: false }, NOW);
  assert.ok(n);
  assert.equal(n.tone, 'danger');
  assert.equal(n.title, "Inflow isn't saving notifications");
  assert.equal(n.action, 'access');
});

test('access on but listener disconnected is a warning that offers reconnect', () => {
  const n = healthNotice({ ...healthy, listenerConnected: false }, NOW);
  assert.ok(n);
  assert.equal(n.tone, 'warn');
  assert.equal(n.action, 'reconnect');
});

test('everything fine gives no notice', () => {
  assert.equal(healthNotice(healthy, NOW), null);
});

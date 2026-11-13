import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Status } from 'notebox-core';
import { setupComplete, setupRows } from '../setup.ts';

const base: Status = {
  accessGranted: true,
  listenerConnected: true,
  lastCaptureAt: null,
  batteryUnrestricted: true,
  storeError: null,
};

test('access off makes the access row a todo and setup incomplete', () => {
  const rows = setupRows({ ...base, accessGranted: false });
  assert.equal(rows.find((r) => r.id === 'access')?.status, 'todo');
  assert.equal(setupComplete(rows), false);
});

test('access and battery on complete setup; manual rows do not block', () => {
  const rows = setupRows(base);
  assert.deepEqual(
    rows.map((r) => r.id),
    ['access', 'restricted', 'battery', 'autostart'],
  );
  assert.equal(rows.find((r) => r.id === 'restricted')?.status, 'manual');
  assert.equal(rows.find((r) => r.id === 'autostart')?.status, 'manual');
  assert.equal(setupComplete(rows), true);
});

test('battery limited makes the battery row a todo', () => {
  const rows = setupRows({ ...base, batteryUnrestricted: false });
  assert.equal(rows.find((r) => r.id === 'battery')?.status, 'todo');
  assert.equal(setupComplete(rows), false);
});

test('rows open the right settings screen', () => {
  const actions = Object.fromEntries(setupRows(base).map((r) => [r.id, r.action]));
  assert.deepEqual(actions, { access: 'access', restricted: 'appInfo', battery: 'battery', autostart: 'appInfo' });
});

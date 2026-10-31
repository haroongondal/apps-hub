import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRun, setupComplete, setupRows } from '../setup.ts';

const ready = { accessibilityEnabled: true, notificationsAllowed: true, batteryUnrestricted: true, keySet: true, contactsAllowed: true, runActive: false };

test('everything on: every live row is ok and setup is complete', () => {
  const rows = setupRows(ready);
  assert.deepEqual(
    rows.filter((r) => r.status !== 'manual').map((r) => r.status),
    ['ok', 'ok', 'ok', 'ok', 'ok'],
  );
  assert.equal(setupComplete(rows), true);
});

test('service off: the accessibility row is todo and setup is incomplete', () => {
  const rows = setupRows({ ...ready, accessibilityEnabled: false });
  const row = rows.find((r) => r.id === 'accessibility');
  assert.equal(row?.status, 'todo');
  assert.equal(row?.action, 'accessibility');
  assert.equal(setupComplete(rows), false);
});

test('battery restricted blocks completion; notifications off does too', () => {
  assert.equal(setupComplete(setupRows({ ...ready, batteryUnrestricted: false })), false);
  assert.equal(setupComplete(setupRows({ ...ready, notificationsAllowed: false })), false);
});

test('contacts are optional: without them setup is still complete', () => {
  const rows = setupRows({ ...ready, contactsAllowed: false });
  assert.equal(rows.find((r) => r.id === 'contacts')?.status, 'optional');
  assert.equal(setupComplete(rows), true);
});

test('manual rows have no live status and never block completion', () => {
  const manual = setupRows(ready).filter((r) => r.status === 'manual');
  assert.deepEqual(manual.map((r) => r.id), ['restricted', 'autostart']);
  assert.ok(manual.every((r) => r.action === 'appInfo'));
});

test('each row opens the screen that fixes it', () => {
  assert.deepEqual(Object.fromEntries(setupRows(ready).map((r) => [r.id, r.action])), {
    accessibility: 'accessibility',
    restricted: 'appInfo',
    notifications: 'notifications',
    battery: 'battery',
    contacts: 'contacts',
    autostart: 'appInfo',
    key: 'key',
  });
});

test('no API key: the key row is todo and setup is incomplete', () => {
  const rows = setupRows({ ...ready, keySet: false });
  assert.equal(rows.find((r) => r.id === 'key')?.status, 'todo');
  assert.equal(setupComplete(rows), false);
});

test('a task can start only with the service on, notifications allowed, a key set and no run active', () => {
  assert.equal(canRun(ready), true);
  assert.equal(canRun({ ...ready, batteryUnrestricted: false }), true);
  for (const off of ['accessibilityEnabled', 'notificationsAllowed', 'keySet'] as const) assert.equal(canRun({ ...ready, [off]: false }), false, off);
  assert.equal(canRun({ ...ready, runActive: true }), false);
});

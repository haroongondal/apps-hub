import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupComplete, setupRows } from '../setup.ts';

const ready = { accessibilityEnabled: true, notificationsAllowed: true, batteryUnrestricted: true };

test('everything on: every live row is ok and setup is complete', () => {
  const rows = setupRows(ready);
  assert.deepEqual(
    rows.filter((r) => r.status !== 'manual').map((r) => r.status),
    ['ok', 'ok', 'ok'],
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
    autostart: 'appInfo',
  });
});

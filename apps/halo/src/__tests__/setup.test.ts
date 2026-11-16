import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Status } from 'halo-engine/src/index.ts';
import { ready, setupRows } from '../setup.ts';

const none: Status = {
  running: false,
  overlayAllowed: false,
  listenerAllowed: false,
  audioAllowed: false,
  notificationsAllowed: false,
  batteryUnrestricted: false,
  audio: 'idle',
  playingApp: null,
  frameP95Ms: null,
};

test('nothing granted: five rows in order, none done, not ready', () => {
  const rows = setupRows(none);
  assert.deepEqual(rows.map((r) => r.key), ['overlay', 'audio', 'listener', 'notifications', 'battery']);
  assert.ok(rows.every((r) => !r.done));
  assert.equal(ready(rows), false);
});

test('everything but battery granted is ready', () => {
  const rows = setupRows({ ...none, overlayAllowed: true, listenerAllowed: true, audioAllowed: true, notificationsAllowed: true });
  assert.deepEqual(rows.map((r) => r.done), [true, true, true, true, false]);
  assert.equal(ready(rows), true);
  assert.equal(ready(setupRows({ ...none, overlayAllowed: true, audioAllowed: true, notificationsAllowed: true })), false);
});

test('labels are plain sentence case', () => {
  for (const { label } of setupRows(none)) assert.match(label, /^[A-Z][a-z ]+$/, label);
});

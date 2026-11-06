import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SyncStatus } from '../service.ts';
import { syncLines } from '../sync-copy.ts';

const base: SyncStatus = { available: true, state: 'idle', lastSyncAt: 1, blocked: 0, quarantined: 0, pendingUpdate: false, error: null, keyLost: false };
const lines = (over: Partial<SyncStatus>) => syncLines({ ...base, ...over }, () => '10:00');
const text = (over: Partial<SyncStatus>) => lines(over).join(' ');

test('signing in again says local changes are kept, and claims no loss when no password change is waiting', () => {
  const copy = text({ state: 'needsSignIn' });
  assert.match(copy, /Sign in again/);
  assert.match(copy, /kept/);
  assert.doesNotMatch(copy, /dropped|replaces|wasn't sent/);
});

test('signing in again warns about a new master password that was never sent, and only then', () => {
  const copy = text({ state: 'needsSignIn', pendingUpdate: true });
  assert.match(copy, /new master password you set on this computer wasn't sent/);
  assert.match(copy, /signing in replaces it/);
  assert.doesNotMatch(copy, /as soon as it can connect/);
});

test('a new master password that is only waiting for a connection is not called lost', () => {
  const copy = text({ state: 'error', error: 'The vault server could not be reached.', pendingUpdate: true });
  assert.match(copy, /hasn't reached the vault server yet/);
  assert.doesNotMatch(copy, /replaces/);
});

test('the other states keep their one line', () => {
  assert.deepEqual(lines({ available: false, state: 'off' }), ["Sync isn't available in this build."]);
  assert.match(text({ state: 'off' }), /Sync is off/);
  assert.deepEqual(lines({ state: 'idle' }), ['Synced at 10:00.']);
  assert.deepEqual(lines({ state: 'idle', lastSyncAt: null }), ['Not synced yet.']);
  assert.deepEqual(lines({ state: 'syncing' }), ['Syncing…']);
  assert.match(text({ blocked: 2 }), /2 items couldn't be synced and were left as they are/);
  assert.match(text({ quarantined: 1 }), /1 item on the vault server couldn't be read here and was left untouched/);
});

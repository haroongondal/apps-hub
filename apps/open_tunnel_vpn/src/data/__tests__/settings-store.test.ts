/**
 * Settings-store test suite (node --test). Runs against Node's built-in
 * SQLite engine (not a mock) through the same statements the on-device
 * expo-sqlite path executes — same discipline as the node-cache suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { AppSettingsStore } from '../settings-store.ts';
import { nodeSqliteDriver } from '../sqlite-driver.ts';

function openStore(): AppSettingsStore {
  return new AppSettingsStore(nodeSqliteDriver(DatabaseSync)(':memory:'));
}

test('loadSettings falls back to documented defaults on an empty table', async () => {
  const store = openStore();
  const settings = await store.loadSettings();
  assert.equal(settings.killSwitchEnabled, true);
  assert.deepEqual(settings.disallowedApps, []);
  assert.equal(settings.lastNodeId, null);
});

test('kill-switch preference round-trips', async () => {
  const store = openStore();
  await store.setKillSwitchEnabled(false);
  assert.equal((await store.loadSettings()).killSwitchEnabled, false);
  await store.setKillSwitchEnabled(true);
  assert.equal((await store.loadSettings()).killSwitchEnabled, true);
});

test('disallowed apps are trimmed, deduplicated, and order-kept', async () => {
  const store = openStore();
  await store.setDisallowedApps([
    ' com.example.updater ',
    'com.example.updater',
    'org.mozilla.firefox',
    '',
    '   ',
  ]);
  assert.deepEqual(
    (await store.loadSettings()).disallowedApps,
    ['com.example.updater', 'org.mozilla.firefox'],
  );
});

test('a corrupted disallowed-apps value degrades to the default list', async () => {
  const driver = nodeSqliteDriver(DatabaseSync)(':memory:');
  const store = new AppSettingsStore(driver);
  await store.setDisallowedApps(['org.mozilla.firefox']);
  await driver.run('UPDATE app_settings SET value = ? WHERE key = ?', [
    'not-json',
    'disallowedApps',
  ]);
  assert.deepEqual((await store.loadSettings()).disallowedApps, []);
});

test('lastNodeId persists and clears on null', async () => {
  const store = openStore();
  const id = 'a'.repeat(64);
  await store.setLastNodeId(id);
  assert.equal((await store.loadSettings()).lastNodeId, id);
  await store.setLastNodeId(null);
  assert.equal((await store.loadSettings()).lastNodeId, null);
});

test('the firewall consent flag is unset until the owner confirms, then persists', async () => {
  const driver = nodeSqliteDriver(DatabaseSync)(':memory:');
  const store = new AppSettingsStore(driver);
  assert.equal((await store.loadSettings()).firewallConsented, false);
  await store.setFirewallConsented();
  assert.equal((await store.loadSettings()).firewallConsented, true);
  // A new store over the same database is a relaunch: the consent is still there.
  assert.equal((await new AppSettingsStore(driver).loadSettings()).firewallConsented, true);
  const rows = await driver.all('SELECT value FROM app_settings WHERE key = ?', ['firewallConsented']);
  assert.equal(rows[0]?.value, 'true');
});

test('an unreadable consent value counts as unset, so the sheet shows again', async () => {
  const driver = nodeSqliteDriver(DatabaseSync)(':memory:');
  const store = new AppSettingsStore(driver);
  await store.setFirewallConsented();
  await driver.run('UPDATE app_settings SET value = ? WHERE key = ?', ['yes?', 'firewallConsented']);
  assert.equal((await store.loadSettings()).firewallConsented, false);
});

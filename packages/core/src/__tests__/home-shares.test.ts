import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { assertRowShape, auditManifest, isShareAuthority } from '@apps-hub/app-link-contract';

import { NEW_DEVICES_SHARE, WHO_IS_HOME_SHARE } from '../home-shares.ts';

const read = (name: string): unknown => JSON.parse(fs.readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8'));

test('who-is-home share equals fixtures/who-is-home.share.json (HomeLinkProviderShareTest reads the same file)', () => {
  const { authority, path, columns, maxRows } = WHO_IS_HOME_SHARE;
  assert.deepEqual(read('who-is-home.share.json'), { authority, path, columns, maxRows });
});

test('new-devices share equals fixtures/new-devices.share.json (HomeLinkProviderShareTest reads the same file)', () => {
  const { authority, path, columns, maxRows } = NEW_DEVICES_SHARE;
  assert.deepEqual(read('new-devices.share.json'), { authority, path, columns, maxRows });
});

test('both shares use the HomeNet applink authority', () => {
  assert.ok(isShareAuthority(WHO_IS_HOME_SHARE.authority));
  assert.equal(WHO_IS_HOME_SHARE.authority, NEW_DEVICES_SHARE.authority);
  assert.equal(WHO_IS_HOME_SHARE.uri(), 'content://com.haroon.netlens.applink/who_is_home');
  assert.equal(NEW_DEVICES_SHARE.uri(), 'content://com.haroon.netlens.applink/new_devices');
});

test('no column names a network detail: no address, MAC, hostname, port or scan field', () => {
  const columns = [...WHO_IS_HOME_SHARE.columns, ...NEW_DEVICES_SHARE.columns];
  for (const c of columns) assert.doesNotMatch(c, /ip|mac|host|port|ssid|bssid|gateway|subnet|scan|addr|name/, c);
});

test('sample rows have exactly the share shape', () => {
  const rows = read('home-share-rows.sample.json') as { who_is_home: unknown[]; new_devices: unknown[] };
  for (const row of rows.who_is_home) assertRowShape(WHO_IS_HOME_SHARE, row);
  for (const row of rows.new_devices) assertRowShape(NEW_DEVICES_SHARE, row);
  assert.throws(() => assertRowShape(WHO_IS_HOME_SHARE, { person: 'Sara', present: 1, last_seen_at: 1, ip: '192.168.1.2' }), /extra \[ip\]/);
});

test('the netlens-core manifest follows the link rules', () => {
  const xml = fs.readFileSync(new URL('../../../../apps/netlens/modules/netlens-core/android/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.deepEqual(auditManifest(xml), []);
  assert.match(xml, /android:authorities="com\.haroon\.netlens\.applink"/);
  assert.doesNotMatch(xml, /grantUriPermissions|grant-uri-permission/);
});

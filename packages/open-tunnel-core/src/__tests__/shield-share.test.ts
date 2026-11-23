import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { CHANGED_PING, LINK_PERMISSION, assertRowShape, auditManifest, isShareAuthority } from '@apps-hub/app-link-contract';

import { SHIELD_SHARE, TUNNEL_HEALTH_SHARE } from '../shield-share.ts';

const read = (name: string): unknown => JSON.parse(fs.readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8'));
const APP = '../../../../apps/open_tunnel_vpn/';
const appFile = (rel: string) => fs.readFileSync(new URL(APP + rel, import.meta.url), 'utf8');
const NATIVE = 'modules/open-tunnel-native/android/src/main/';

test('shield share equals fixtures/shield.share.json (TunnelLinkProviderShareTest reads the same file)', () => {
  const { authority, path, columns, maxRows } = SHIELD_SHARE;
  assert.deepEqual(read('shield.share.json'), { authority, path, columns, maxRows });
});

test('health share equals fixtures/tunnel-health.share.json (TunnelLinkProviderShareTest reads the same file)', () => {
  const { authority, path, columns, maxRows } = TUNNEL_HEALTH_SHARE;
  assert.deepEqual(read('tunnel-health.share.json'), { authority, path, columns, maxRows });
});

test('both shares sit on the TunnelWall applink authority', () => {
  assert.ok(isShareAuthority(SHIELD_SHARE.authority));
  assert.equal(SHIELD_SHARE.authority, TUNNEL_HEALTH_SHARE.authority);
  assert.equal(SHIELD_SHARE.uri(), 'content://com.haroon.opentunnel.applink/shield');
  assert.equal(TUNNEL_HEALTH_SHARE.uri(), 'content://com.haroon.opentunnel.applink/health');
});

test('no shield column names the network: no Wi-Fi name, access point, address or location', () => {
  for (const c of SHIELD_SHARE.columns) assert.doesNotMatch(c, /ssid|bssid|ip|mac|addr|host|gateway|dns|name|lat|lon|loc/, c);
});

test('sample rows have exactly the share shape', () => {
  assertRowShape(SHIELD_SHARE, { on: 1, untrusted_now: 1, since: 1764000000000 });
  assertRowShape(TUNNEL_HEALTH_SHARE, { app_id: 'open-tunnel', accessibility: null, listener: null, ai_source: 'none', last_seen_at: null });
  assert.throws(() => assertRowShape(SHIELD_SHARE, { on: 1, untrusted_now: 1, since: 1, ssid: 'Home' }), /extra \[ssid\]/);
});

test('the module and app manifests follow the link rules', () => {
  const module = appFile(`${NATIVE}AndroidManifest.xml`);
  assert.deepEqual(auditManifest(module), []);
  assert.deepEqual(auditManifest(appFile('android/app/src/main/AndroidManifest.xml')), []);
  assert.match(module, /android:authorities="com\.haroon\.opentunnel\.applink"/);
  assert.match(module, new RegExp(`<permission android:name="${LINK_PERMISSION}" android:protectionLevel="signature"`));
  assert.match(module, new RegExp(`<uses-permission android:name="${LINK_PERMISSION}"`));
  assert.doesNotMatch(module, /grantUriPermissions|grant-uri-permission/);
});

test('the Kotlin ping is the contract CHANGED ping: Halo only, guarded by the link permission, no extras', () => {
  const kotlin = appFile(`${NATIVE}java/expo/modules/opentunnelnative/TunnelLinkStore.kt`);
  assert.match(kotlin, new RegExp(`"${CHANGED_PING.action.replaceAll('.', '\\.')}"`));
  assert.match(kotlin, new RegExp(`"${CHANGED_PING.targetPackage.replaceAll('.', '\\.')}"`));
  assert.match(kotlin, /sendBroadcast\(Intent\(CHANGED_ACTION\)\.setPackage\(HALO_PACKAGE\), AppLinkGuard\.PERMISSION\)/);
  assert.doesNotMatch(kotlin, /putExtra/);
});

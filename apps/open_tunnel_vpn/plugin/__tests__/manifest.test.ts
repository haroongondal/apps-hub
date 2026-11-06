/**
 * Config plugin manifest tests (node --test): what the plugin declares for the firewall, and that
 * it keeps the privacy posture. Runs the plugin's manifest step over a bare template manifest and
 * over the committed android/ manifest, so the plugin and the checked-in file cannot drift apart.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { AndroidConfig } = require('expo/config-plugins');
const plugin = require('../opentunnel-android-config.js');

type Attrs = Record<string, string>;
type El = { $: Attrs; [child: string]: unknown };
type Manifest = {
  manifest: {
    $: Attrs;
    'uses-permission'?: El[];
    application: Array<{ $: Attrs; service?: El[] }>;
  };
};

const COMMITTED_MANIFEST = join(import.meta.dirname, '../../android/app/src/main/AndroidManifest.xml');

/** What `expo prebuild` starts from: the android namespace only, an application element, no firewall entries. */
function bareManifest(): Manifest {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      application: [{ $: { 'android:name': '.MainApplication', 'android:allowBackup': 'true' } }],
    },
  };
}

function configure(m: Manifest): Manifest {
  plugin.configureManifest(m);
  return m;
}

const permissionNames = (m: Manifest) => (m.manifest['uses-permission'] ?? []).map((p) => p.$['android:name']);
const firewallServices = (m: Manifest) =>
  (m.manifest.application[0].service ?? []).filter((s) => s.$['android:name'] === '.firewall.FirewallService');

test('the firewall service runs in its own process, bound to the VPN permission and not exported', () => {
  const [service, ...extra] = firewallServices(configure(bareManifest()));
  assert.equal(extra.length, 0);
  assert.deepEqual(service.$, {
    'android:name': '.firewall.FirewallService',
    'android:process': ':firewall',
    'android:permission': 'android.permission.BIND_VPN_SERVICE',
    'android:exported': 'false',
    'android:foregroundServiceType': 'specialUse',
  });
  assert.deepEqual(
    (service.property as El[]).map((p) => p.$),
    [{ 'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE', 'android:value': 'Firewall' }],
  );
  assert.deepEqual(service['intent-filter'], [{ action: [{ $: { 'android:name': 'android.net.VpnService' } }] }]);
});

test('package visibility and usage access are declared, and nothing else is added', () => {
  const m = configure(bareManifest());
  assert.deepEqual(permissionNames(m).sort(), [
    'android.permission.PACKAGE_USAGE_STATS',
    'android.permission.QUERY_ALL_PACKAGES',
  ]);
  const all = m.manifest['uses-permission']!.find((p) => p.$['android:name'].endsWith('QUERY_ALL_PACKAGES'))!;
  assert.equal(all.$['tools:node'], undefined);
});

test('the tools namespace is declared on the root, so the tools:ignore on PACKAGE_USAGE_STATS resolves', () => {
  const m = bareManifest();
  assert.equal(m.manifest.$['xmlns:tools'], undefined);
  configure(m);
  assert.equal(m.manifest.$['xmlns:tools'], 'http://schemas.android.com/tools');
  assert.equal(m.manifest.$['xmlns:android'], 'http://schemas.android.com/apk/res/android');
  const usage = m.manifest['uses-permission']!.find((p) => p.$['android:name'].endsWith('PACKAGE_USAGE_STATS'))!;
  assert.equal(usage.$['tools:ignore'], 'ProtectedPermissions');
});

test('release builds permit no cleartext, and the plugin writes the committed policy', () => {
  const committed = readFileSync(join(import.meta.dirname, '../../android/app/src/main/res/xml/network_security_config.xml'), 'utf8');
  assert.equal(plugin.NETWORK_SECURITY_CONFIG_XML, committed);
  assert.doesNotMatch(committed, /cleartextTrafficPermitted="true"|vpngate/);
  assert.match(committed, /<base-config cleartextTrafficPermitted="false"/);
});

test('debug builds allow cleartext only for the Metro base config, with no VPN Gate exception', () => {
  const debug = readFileSync(join(import.meta.dirname, '../../android/app/src/debug/res/xml/network_security_config.xml'), 'utf8');
  assert.doesNotMatch(debug, /vpngate|<domain-config/);
  assert.match(debug, /<base-config cleartextTrafficPermitted="true">/);
});

test('iOS has no App Transport Security exception for VPN Gate', () => {
  const appJson = readFileSync(join(import.meta.dirname, '../../app.json'), 'utf8');
  const infoPlist = readFileSync(join(import.meta.dirname, '../../ios/OpenTunnel/Info.plist'), 'utf8');
  assert.doesNotMatch(appJson, /vpngate|NSExceptionAllowsInsecureHTTPLoads/);
  assert.doesNotMatch(infoPlist, /vpngate|NSExceptionAllowsInsecureHTTPLoads/);
});

test('backups stay off and the network security config stays wired', () => {
  const app = configure(bareManifest()).manifest.application[0];
  assert.equal(app.$['android:allowBackup'], 'false');
  assert.equal(app.$['android:networkSecurityConfig'], '@xml/network_security_config');
});

test('applying twice gives the same manifest', () => {
  const once = configure(bareManifest());
  assert.deepEqual(configure(structuredClone(once)), once);
});

test('over the committed manifest: re-allows QUERY_ALL_PACKAGES, one firewall service, ics-openvpn posture kept', async () => {
  const m = configure((await AndroidConfig.Manifest.readAndroidManifestAsync(COMMITTED_MANIFEST)) as Manifest);
  const all = (m.manifest['uses-permission'] ?? []).filter((p) => p.$['android:name'].endsWith('QUERY_ALL_PACKAGES'));
  assert.equal(all.length, 1);
  assert.equal(all[0].$['tools:node'], undefined);
  assert.equal(firewallServices(m).length, 1);
  const services = m.manifest.application[0].service ?? [];
  assert.ok(services.some((s) => s.$['android:name'] === '.OpenTunnelVpnService'));
  const ics = services.find((s) => s.$['android:name'] === 'de.blinkt.openvpn.core.OpenVPNService')!;
  assert.equal(ics.$['tools:remove'], 'android:process');
  assert.equal(m.manifest.application[0].$['android:allowBackup'], 'false');
});

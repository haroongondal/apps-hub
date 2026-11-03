/**
 * OpenTunnel Android posture, carried over from the Flutter scaffold's
 * verified AndroidManifest.xml:
 *
 * 1. `android:allowBackup="false"` — the SQLite node cache must never leave
 *    the device through OS backup; "no accounts, remote sync, upload" is a
 *    hard privacy rule of this app.
 * 2. `android:networkSecurityConfig` — VPN Gate's documented HTTP (non-TLS)
 *    fallback sources need a scoped cleartext exception for
 *    `vpngate.net`. HTTPS remains the primary transport.
 *
 * 3. The firewall: `FirewallService` in its own `:firewall` process (firestack's
 *    and WireGuard's Go runtimes crash each other in one), plus the two
 *    permissions it needs: `QUERY_ALL_PACKAGES` (package names for the
 *    per-app rules; ics-openvpn's merge would otherwise drop it) and
 *    `PACKAGE_USAGE_STATS` (NetworkStatsManager, for data use).
 *
 * Only the `<service>` declaration for OpenTunnelVpnService is intentionally
 * NOT added here: it is created with the native module in Phase 2, when the
 * Kotlin class exists. The firewall service above is added by this plugin.
 */
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const NETWORK_SECURITY_CONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Backend API: cleartext permitted only for the documented VPN Gate
         HTTP fallback and mirrors. Do not widen this to the whole app. -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">www.vpngate.net</domain>
        <domain includeSubdomains="true">vpngate.net</domain>
    </domain-config>
</network-security-config>
`;

/** Insert `entry`, or replace the element already named the same (a prebuild over the committed android/ runs this again). */
function upsertByName(list, entry) {
  const i = list.findIndex((el) => el.$?.['android:name'] === entry.$['android:name']);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
}

const FIREWALL_SERVICE = {
  $: {
    'android:name': '.firewall.FirewallService',
    'android:process': ':firewall',
    'android:permission': 'android.permission.BIND_VPN_SERVICE',
    'android:exported': 'false',
    'android:foregroundServiceType': 'specialUse',
  },
  property: [
    {
      $: {
        'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
        'android:value': 'Firewall',
      },
    },
  ],
  'intent-filter': [{ action: [{ $: { 'android:name': 'android.net.VpnService' } }] }],
};

/** Mutates the parsed manifest (xml2js shape). Safe to run more than once. */
function configureManifest(manifest) {
  const application = manifest.manifest?.application?.[0];
  if (!application) {
    throw new Error(
      'opentunnel-android-config: manifest application element not found',
    );
  }
  application.$ = {
    ...(application.$ ?? {}),
    'android:allowBackup': 'false',
    'android:networkSecurityConfig': '@xml/network_security_config',
  };

  // `tools:ignore` below needs the namespace declared on the manifest root; the Expo helper adds it only when absent.
  AndroidConfig.Manifest.ensureToolsAvailable(manifest);
  // A plain declaration replaces any `tools:node="remove"` left by the ics-openvpn merge fix.
  const permissions = (manifest.manifest['uses-permission'] ??= []);
  upsertByName(permissions, { $: { 'android:name': 'android.permission.QUERY_ALL_PACKAGES' } });
  upsertByName(permissions, {
    $: {
      'android:name': 'android.permission.PACKAGE_USAGE_STATS',
      'tools:ignore': 'ProtectedPermissions',
    },
  });

  upsertByName((application.service ??= []), structuredClone(FIREWALL_SERVICE));
  return manifest;
}

function withOpentunnelAndroidConfig(config) {
  config = withAndroidManifest(config, (config) => {
    configureManifest(config.modResults);
    return config;
  });

  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const resXmlDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      );
      fs.mkdirSync(resXmlDir, { recursive: true });
      fs.writeFileSync(
        path.join(resXmlDir, 'network_security_config.xml'),
        NETWORK_SECURITY_CONFIG_XML,
      );
      return config;
    },
  ]);

  return config;
}

module.exports = withOpentunnelAndroidConfig;
module.exports.configureManifest = configureManifest;

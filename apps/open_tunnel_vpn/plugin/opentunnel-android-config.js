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
 * The `<service>` declaration for OpenTunnelVpnService is intentionally NOT
 * added here: it is created with the native module in Phase 2, when the
 * Kotlin class exists.
 */
const {
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

function withOpentunnelAndroidConfig(config) {
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const application = manifest.manifest?.application?.[0];
    if (application) {
      application.$ = {
        ...(application.$ ?? {}),
        'android:allowBackup': 'false',
        'android:networkSecurityConfig': '@xml/network_security_config',
      };
    } else {
      throw new Error(
        'opentunnel-android-config: manifest application element not found',
      );
    }
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

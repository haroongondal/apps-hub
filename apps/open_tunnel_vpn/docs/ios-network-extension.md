# iOS Network Extension Target — Required Manual Setup

`flutter create` cannot generate a Network Extension target. Do this once in Xcode
before running `/phase3`. Without it, `PacketTunnelProvider.swift` has no host
process and `NETunnelProviderManager` will fail to start the tunnel.

## 1. Create the target

1. `open ios/Runner.xcworkspace`
2. **File → New → Target… → Network Extension**, then choose **Packet Tunnel**.
3. Product name: `PacketTunnel`. Language: Swift.
4. Bundle identifier: `com.opentunnel.openTunnelVpn.PacketTunnel`
   (must be prefixed by the Runner bundle identifier shown in Xcode; confirm the
   exact Runner id rather than copying this example blindly).
5. Finish, then **Activate** the new scheme when prompted.

## 2. Capabilities

Select **both** the `Runner` and `PacketTunnel` targets and add:

- **App Groups** → `group.com.opentunnel.vpn` on both.
- **Network Extensions** → check **Packet Tunnel** (extension target; Runner also
  needs it to install the extension).
- **Personal VPN** (Runner target).

Equivalent entitlements:

```xml
<!-- Runner/Runner.entitlements -->
<key>com.apple.developer.networking.networkextension</key>
<array><string>packet-tunnel-provider</string></array>
<key>com.apple.developer.networking.vpn.api</key>
<array><string>allow-vpn</string></array>
<key>com.apple.security.application-groups</key>
<array><string>group.com.opentunnel.vpn</string></array>
```

```xml
<!-- PacketTunnel/PacketTunnel.entitlements -->
<key>com.apple.developer.networking.networkextension</key>
<array><string>packet-tunnel-provider</string></array>
<key>com.apple.security.application-groups</key>
<array><string>group.com.opentunnel.vpn</string></array>
```

Put these on a real Apple development team. App Groups and Network Extension
entitlements are not available with a personal (free) team for distribution.

## 3. Extension Info.plist

```xml
<key>NSExtension</key>
<dict>
  <key>NSExtensionPointIdentifier</key>
  <string>com.apple.networkextension.packet-tunnel</string>
  <key>NSExtensionPrincipalClass</key>
  <string>$(PRODUCT_MODULE_NAME).PacketTunnelProvider</string>
</dict>
```

## 4. File membership

- `ios/PacketTunnel/PacketTunnelProvider.swift` → **PacketTunnel** target only.
- `ios/Runner/VpnManagerBridge.swift` and `ios/Runner/VpnBridge.g.swift` →
  **Runner** target.
- Do not add the Dart/Flutter engine to the extension.
- Add WireGuardKit (Swift Package) and OpenVPNAdapter to the **PacketTunnel**
  target. Confirm the actual package URLs and licenses at implementation time.

## 5. Deployment target

Set both targets to iOS 16.0 or newer. `includeAllNetworks` (the closest thing to
an iOS kill switch) requires iOS 16; WireGuardKit and current Flutter releases
are comfortable there.

## 6. Verification limits

- A simulator build proves compilation, not extension memory behavior.
- Measure on a physical device with Xcode → Debug → **Allocations** while the
  tunnel is active. Keep peak footprint below 12 MB; the OS jettisons the
  extension near 15 MB.
- Never fetch or parse the VPN Gate CSV in the extension. The main app writes one
  sanitized config to the App Group and the extension reads only that.

## Licensing warning

`ics-openvpn` is GPLv2. OpenVPNAdapter/OpenVPN 3 Core is AGPLv3. Shipping either
in a proprietary App Store build triggers source-disclosure obligations. Confirm
the license strategy before release; WireGuardKit is MIT.

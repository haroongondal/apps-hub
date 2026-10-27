# iOS Network Extension Target — Required Manual Setup

> **Status (2026-10-27): §1–§3 are DONE in the committed project.** The
> `OpenTunnelPacketTunnel` target was added programmatically (bundle id
> `com.opentunnel.openTunnelVpn.PacketTunnel`, deployment iOS 16.0,
> Info.plist extension point per §3, entitlements per §2 on both targets,
> dependency + `Embed App Extensions` on the app target), and the extension
> target builds for the simulator (`xcodebuild -target OpenTunnelPacketTunnel
> -sdk iphonesimulator`, `CODE_SIGNING_ALLOWED=NO` → `BUILD SUCCEEDED`).
> **Still required from a human with the Apple team:** attach the
> DEVELOPMENT_TEAM on both targets (one dropdown in Signing & Capabilities)
> and let Xcode register the App Group with the portal on the first signed
> device build — no codesigning identity exists on this machine to do it.
> Status: §1–§4 are done — the target exists, entitlements/Info.plist are
> final, and `PacketTunnelProvider.swift` (with the shared contract source)
> is in the extension target and compiles (2026-10-27, phase 3).


`expo prebuild` cannot generate a Network Extension target. Do this once in Xcode
before running `/phase3`. Without it, `PacketTunnelProvider.swift` has no host
process and `NETunnelProviderManager` will fail to start the tunnel.

## 1. Create the target

1. `open ios/OpenTunnel.xcworkspace`
2. **File → New → Target… → Network Extension**, then choose **Packet Tunnel**.
3. Product name: `OpenTunnelPacketTunnel`. Language: Swift.
4. Bundle identifier: `com.opentunnel.openTunnelVpn.PacketTunnel`
   (must be prefixed by the Runner bundle identifier shown in Xcode; the app id
   is `com.opentunnel.openTunnelVpn` in app.json).
5. Finish, then **Activate** the new scheme when prompted.

## 2. Capabilities

Select **both** the `OpenTunnel` and `OpenTunnelPacketTunnel` targets and add:

- **App Groups** → `group.com.opentunnel.vpn` on both.
- **Network Extensions** → check **Packet Tunnel** (extension target; OpenTunnel also
  needs it to install the extension).
- **Personal VPN** (OpenTunnel target).

Equivalent entitlements:

```xml
<!-- OpenTunnel/OpenTunnel.entitlements -->
<key>com.apple.developer.networking.networkextension</key>
<array><string>packet-tunnel-provider</string></array>
<key>com.apple.developer.networking.vpn.api</key>
<array><string>allow-vpn</string></array>
<key>com.apple.security.application-groups</key>
<array><string>group.com.opentunnel.vpn</string></array>
```

```xml
<!-- OpenTunnelPacketTunnel/OpenTunnelPacketTunnel.entitlements -->
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

Landed 2026-10-27 (phase 3); the project file carries the membership:

- `ios/OpenTunnelPacketTunnel/PacketTunnelProvider.swift` →
  **OpenTunnelPacketTunnel** target only.
- `modules/open-tunnel-native/ios/OpenTunnelShared.swift` → compiled into
  the **OpenTunnelPacketTunnel** target AND into the **OpenTunnelNative**
  Expo module pod (one contract source, two consumers).
- The provider-bridge flow (`VpnManagerBridge`, registry, ticker, probe)
  lives in `modules/open-tunnel-native/ios/OpenTunnelNativeModule.swift`,
  compiled into the **OpenTunnelNative** pod. Deviation from the original
  plan (which placed it in `ios/OpenTunnel/`): the Expo Modules API requires
  the module class to live in its pod, so the bridge moved with it; the app
  target links the pod.
- Do not add the React Native engine or any JS runtime to the extension.
- WireGuardKit and the OpenVPN engine are NOT added as Swift packages this
  phase: the wireguard-go bridge cannot be built by SwiftPM (external Go
  build target required) and the OpenVPN carry-in is gated on the G1
  license decision. Both engines surface typed `ERR_ENGINE_UNAVAILABLE`
  failures instead.

## 5. Deployment target

Set both targets to iOS 16.0 or newer. `includeAllNetworks` (the closest thing to
an iOS kill switch) requires iOS 16; WireGuardKit and current RN releases
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

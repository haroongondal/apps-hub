---
description: Phase 2 — Pigeon contract and Android VpnService host
---

Read `AGENTS.md`. Implement Phase 2. Verify every native API you use against
the installed SDK; do not invent methods. If an engine dependency cannot be
resolved, stop and report it instead of writing a mock.

## 1. Pigeon contract — `pigeons/vpn_bridge.dart`

Define, in one file:

- `enum VpnProtocol { openvpn, wireguard }`
- `enum VpnStatusState { disconnected, connecting, connected, disconnecting, reasserting, error }`
- `class VpnTunnelConfig` with `nodeId`, `serverIp`, `protocol`, `rawConfig`,
  `dnsServers`, `enableKillSwitch`, `disallowedApps`.
- `@HostApi() abstract class VpnHostApi`:
  `void startTunnel(VpnTunnelConfig config)`, `void stopTunnel()`,
  `VpnStatusState getCurrentState()`, `bool openSystemVpnSettings()`.
- `@FlutterApi() abstract class VpnStateCallback`:
  `void onStateChanged(VpnStatusState state, String? message)` and
  `void onTrafficUpdate(int bytesIn, int bytesOut, int connectedDurationSec)`.

Add a `@ConfigurePigeon(PigeonOptions(...))` block with these outputs and run
generation:

- Dart: `lib/core/network/vpn_bridge.g.dart`
- Kotlin: `android/app/src/main/kotlin/com/opentunnel/open_tunnel_vpn/VpnBridge.g.kt`
  (package `com.opentunnel.open_tunnel_vpn`)
- Swift: `ios/Runner/VpnBridge.g.swift`

Command: `dart run pigeon --input pigeons/vpn_bridge.dart`.
Commit the generated files. Do not hand-edit them.

## 2. Android — `OpenTunnelVpnService.kt`

Create the service in the **actual** application package
`com.opentunnel.open_tunnel_vpn` (not `com.opentunnel.vpn`).

- Extend `android.net.VpnService`; implement `onStartCommand`, `onRevoke`, and a
  binder only if the chosen engine needs one.
- Build the interface with `Builder()`: `setSession("OpenTunnel")`,
  `setMtu(1420)`, DNS `1.1.1.1` and `9.9.9.9`, IPv4 address/route coverage, and
  IPv6 leak blackhole:
  `addAddress("fd00::1", 128)` plus `addRoute("::", 0)`.
- **Do not call `allowBypass()`**; that is the opt-out of the internal kill
  switch. Verify whether your compile SDK exposes `setBlocking(true)` and use it
  only if it exists; otherwise drop packets in the engine.
- Protocol routing: genuine `.conf` WireGuard payloads go to the WireGuard
  backend; VPN Gate `.ovpn` payloads go to the OpenVPN engine. Never assume
  `WgQuickBackend` is a published library class — inspect
  `com.wireguard.android:tunnel` and the ics-openvpn/OpenVPN 3 artifacts, choose
  a real integration, and pin versions in `build.gradle.kts`.
- Foreground service: channel + ongoing notification, with
  `FOREGROUND_SERVICE_TYPE_SPECIAL_USE` on API 34+ and the matching manifest
  property. Request `POST_NOTIFICATIONS` at runtime on Android 13+ (do not make
  tunnel startup depend on the user granting it). Stop cleanly in `onDestroy`.
- Report connection state and byte counters to `VpnStateCallback` on the main
  thread; poll `TrafficStats`/engine counters at ~1 Hz, not faster.
- `openSystemVpnSettings()` launches `Intent(Settings.ACTION_VPN_SETTINGS)` with
  `FLAG_ACTIVITY_NEW_TASK` and returns whether it resolved.
- Verify the manifest in `android/app/src/main/AndroidManifest.xml` already has
  INTERNET, ACCESS_NETWORK_STATE, FOREGROUND_SERVICE,
  FOREGROUND_SERVICE_SPECIAL_USE, POST_NOTIFICATIONS, the `BIND_VPN_SERVICE`
  service declaration, and `android:foregroundServiceType="specialUse"`.

## 3. Wiring

Implement the Dart-side `VpnHostApi` client and a Riverpod stream controller
that forwards `VpnStateCallback` events. Handle `error` as a terminal state with
the native message. No UI yet.

## 4. Verification

- `flutter analyze` and `flutter test` green.
- If an Android SDK/JDK is present, run `flutter build apk --debug`; otherwise
  report that the native compile could not be verified and explain exactly what
  is missing. Do not claim a successful build you did not run.

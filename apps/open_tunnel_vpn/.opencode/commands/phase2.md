---
description: Phase 2 — Expo native module contract and Android VpnService host
---

Read `AGENTS.md`. Implement Phase 2. Verify every native API you use against
the installed SDK; do not invent methods. If an engine dependency cannot be
resolved, stop and report it instead of writing a mock.

Decision map + gates: `docs/phase2-plan.md` — read it before starting.

## 1. Native module contract — `modules/open-tunnel-native`

Create an Expo local module (Expo Modules API, not Pigeon) at
`apps/open_tunnel_vpn/modules/open-tunnel-native` (package name
`open-tunnel-native`, added to `pnpm-workspace.yaml` via the existing
`apps/*/modules/*` glob and to the app `package.json` as `workspace:*`).

Shared typed surface (TypeScript contract in the module's `src`):

- `type VpnProtocol = 'openvpn' | 'wireguard'`
- `type VpnStatusState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'reasserting' | 'error'`
- `interface VpnTunnelConfig { nodeId, serverIp, serverPort, protocol, configText, dnsServers, enableKillSwitch, disallowedApps }`
  (`configText` = the already-sanitized `.conf`/`.ovpn` payload — engines
  cannot run from endpoint metadata alone; plan §4.1)
- Functions: `startTunnel(config)`, `stopTunnel()`, `getState(): VpnStatusState`, `openSystemVpnSettings(): boolean`
- Events (use `addHistoryForExportedValue`… no — use Expo Modules event emitters): `onStatusChanged(state, message?)`, `onTrafficUpdate(bytesIn, bytesOut, connectedDurationSec)` at ~1 Hz, emitted on the main thread.

## 2. Android — `OpenTunnelVpnService.kt`

Create the service in the **actual** application package
`com.opentunnel.open_tunnel_vpn` (not `com.opentunnel.vpn`).

- Extend `android.net.VpnService`; implement `onStartCommand`, `onRevoke`, and
  a binder only if the chosen engine needs one.
- Build the interface with `Builder()`: `setSession("OpenTunnel")`,
  `setMtu(1420)`, DNS `1.1.1.1` and `9.9.9.9`, IPv4 address/route coverage, and
  IPv6 leak blackhole: `addAddress("fd00::1", 128)` plus `addRoute("::", 0)`.
- **Do not call `allowBypass()`**; that is the opt-out of the internal kill
  switch. Verify whether your compile SDK exposes `setBlocking(true)` and use
  it only if it exists; otherwise drop packets in the engine.
- Protocol routing: genuine `.conf` WireGuard payloads go to the WireGuard
  backend; VPN Gate `.ovpn` payloads go to the OpenVPN engine. Never assume
  `WgQuickBackend` is a published library class — inspect
  `com.wireguard.android:tunnel` and the ics-openvpn/OpenVPN 3 artifacts,
  choose a real integration, and pin versions in `build.gradle`.
- Foreground service: channel + ongoing notification, with
  `FOREGROUND_SERVICE_TYPE_SPECIAL_USE` on API 34+ and the matching manifest
  property. Request `POST_NOTIFICATIONS` at runtime on Android 13+ (do not
  make tunnel startup depend on the user granting it). Stop cleanly in
  `onDestroy`.
- Report connection state and byte counters through the Expo module event
  emitters (`onStatusChanged`, `onTrafficUpdate`). Poll
  `TrafficStats`/engine counters at ~1 Hz, not faster.
- `openSystemVpnSettings()` launches `Intent(Settings.ACTION_VPN_SETTINGS)`
  with `FLAG_ACTIVITY_NEW_TASK` and returns whether it resolved.
- The manifest already carries INTERNET, ACCESS_NETWORK_STATE,
  FOREGROUND_SERVICE, FOREGROUND_SERVICE_SPECIAL_USE, POST_NOTIFICATIONS.
  Phase 2 must add the `<service>` declaration:
  `android:name=".OpenTunnelVpnService"`, `android:permission=
  "android.permission.BIND_VPN_SERVICE"`, `android:exported="false"`,
  `android:foregroundServiceType="specialUse"`, the
  `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` value "VPN tunnel", and the
  `android.net.VpnService` intent filter — reusing the checked-in copy from
  the Flutter snapshot commit (`a8cf6e9`) as the source of truth.

## 3. Wiring

Implement the TS-side client (`apps/open_tunnel_vpn/src/tunnel/`) that wraps
the module functions and forwards the events into app state. Handle `error`
as a terminal state with the native message. No UI yet beyond a fetchable
status readout for development.

## 4. Verification

- `pnpm test` and `pnpm typecheck` green.
- Android compile gate (JDK 21 + SDK 36 are installed on this machine):
  `cd apps/open_tunnel_vpn/android && JAVA_HOME=$JAVA_HOME ./gradlew
  :app:assembleDebug` — report the ACTUAL output; do not claim a build you
  did not run.
- Latency probing on device: wire `TcpProbeFn` to the native module's TCP
  probe function (bounded concurrency, 1500 ms timeout, destroy sockets
  immediately) so `LatencyProber` stops falling back to static pings.

---
description: Phase 3 — iOS NetworkExtension, App Group handoff, On-Demand kill switch
---

Read `AGENTS.md`. Respect the 15 MB extension ceiling absolutely: no CSV
fetching, parsing, Base64 decoding, analytics, or unbounded logging inside
`ios/PacketTunnel/`.

## Prerequisite

The `PacketTunnel` Network Extension target is not created by `flutter create`.
Before writing Swift, read `docs/ios-network-extension.md` and verify the target,
bundle identifier, App Group, and entitlements exist. If they do not, stop and
report exactly which Xcode step is missing; do not fake the target.

## 1. `ios/Runner/VpnManagerBridge.swift`

- `NETunnelProviderManager.loadAllFromPreferences`; find an existing manager by
  `providerBundleIdentifier`, otherwise create one with
  `NETunnelProviderProtocol`.
- Set `providerConfiguration` with the node id and protocol, but pass the full
  sanitized config through App Group `group.com.opentunnel.vpn`. Keep the
  UserDefaults payload to a single active config (small); prefer shared Keychain
  if private-key material is included, and never log it.
- On connect: save the config, set `isOnDemandEnabled` from `enableKillSwitch`,
  install `NEOnDemandRuleConnect` (match `.any`), save preferences, then
  `startVPNTunnel()`.
- On user-initiated disconnect: set `isOnDemandEnabled = false` and
  `saveToPreferences` **before** `stopVPNTunnel()`, so on-demand does not
  immediately respawn the tunnel.
- Set `protocol.includeAllNetworks = true` and `excludeLocalNetworks` as
  appropriate when the deployment target supports it; this is the closest iOS
  equivalent to a system kill switch.
- Observe `NSNotification.Name.NEVPNStatusDidChange`; map
  `NEVPNStatus` to `VpnStatusState` and forward via the generated Pigeon
  `VpnStateCallback`. Poll byte counters from `NETunnelProviderManager` or the
  provider's App Group stats at ~1 Hz, not in a tight loop.
- Expose start/stop/state/open-settings to Flutter; iOS has no
  `ACTION_VPN_SETTINGS`, so `openSystemVpnSettings` opens the app's settings URL
  or returns false with an explanatory message.

## 2. `ios/PacketTunnel/PacketTunnelProvider.swift`

- Subclass `NEPacketTunnelProvider`; implement `startTunnel(options:completionHandler:)`
  and `stopTunnel(with:completionHandler:)`.
- Read only the single active config + `dnsServers` from the App Group. Validate
  size (< 256 KB) and reject oversize payloads with a typed error.
- `NEPacketTunnelNetworkSettings`:
  - MTU 1420.
  - IPv4 address/route that capture traffic (do not ship an empty split tunnel).
  - `NEDNSSettings(servers: dns)` and `matchDomains = [""]` so all queries go
    through the tunnel; do not leave the system resolver reachable.
  - IPv6 `NEIPv6Settings` with `includedRoutes = [NEIPv6Route.default()]` so IPv6
    cannot escape when the node is IPv4-only.
- Bind `WireGuardAdapter` for `.conf` payloads and `OpenVPNAdapter` for `.ovpn`
  payloads. Report a clear `NEProvider.stopTunnel` error when the engine cannot
  start; never silently mark connected.
- Keep peak memory < 12 MB: no full-file reads, no CSV, no retained byte buffers,
  no per-packet allocations in Swift. Stream counters, don't accumulate.

## 3. Verify

- Run `flutter analyze` and `flutter test` (Dart side).
- If the target and signing are configured, run
  `xcodebuild -workspace ios/Runner.xcworkspace -scheme Runner -configuration Debug -sdk iphonesimulator build`
  and report the real result. A simulator build cannot validate the extension's
  memory behavior; state that separately.

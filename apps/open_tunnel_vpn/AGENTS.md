# OpenTunnel VPN & Privacy Guard — Agent Rules & Architecture

## Workspace

- Root: `~/Documents/open_tunnel_vpn`
- UI/state: Flutter 3.x (Dart 3.x), Riverpod, Drift (SQLite).
- Native bridge: Pigeon (`pigeons/vpn_bridge.dart`) plus EventChannel for counters.
- Android: `android.net.VpnService` in
  `android/app/src/main/kotlin/com/opentunnel/open_tunnel_vpn/`.
- iOS: `NETunnelProviderManager` in `ios/Runner/` and
  `NEPacketTunnelProvider` in `ios/PacketTunnel/`.
- Upstream data: `https://www.vpngate.net/api/iphone/` (University of Tsukuba).
  The payload is ~1.3 MB and the server can be slow; use a 15 s connect timeout
  and up to 120 s receive timeout, and show cached nodes immediately.

### Verified commands

```bash
flutter pub get
flutter analyze
flutter test
dart run pigeon --input pigeons/vpn_bridge.dart
```

Android native compilation works on this machine: JDK 21 (`openjdk@21`) plus an
Android SDK at `~/Library/Android/sdk` (platform 36/35, build-tools 36.0.0,
NDK r28c), with `JAVA_HOME`/`ANDROID_HOME` exported by `~/.zshrc`. iOS
compilation requires Xcode plus the manually created `PacketTunnel` target;
that target is the only blocking prerequisite for Phase 3.

## Directory Map

```
lib/core/models/vpn_node.dart        Immutable node model + scoring fields
lib/core/network/vpngate_service.dart Fetch + streaming CSV parser + sanitizer
lib/core/network/latency_prober.dart  Concurrent TCP RTT probe + fitness score
lib/core/database/                    Drift schema and DAO
lib/features/vpn_tunnel/data/         Repositories, Pigeon client
lib/features/vpn_tunnel/domain/       Riverpod controllers / use cases
lib/features/vpn_tunnel/presentation/ Screens and widgets
pigeons/vpn_bridge.dart               Pigeon contract
android/.../OpenTunnelVpnService.kt   Android VpnService host
ios/Runner/VpnManagerBridge.swift     Main-app tunnel manager
ios/PacketTunnel/PacketTunnelProvider.swift  Network Extension
.opencode/commands/phase1..4.md       Implementation phases
```

## Non-Negotiable Engineering Rules

1. **Dual engine, not dual fantasy.** VPN Gate column 15 (index 14,
   `OpenVPN_ConfigData_Base64`) is OpenVPN `.ovpn` data. It is never WireGuard.
   Route VPN Gate nodes through the OpenVPN engine and only genuine `.conf`
   payloads through WireGuard (`wireguard-go` / `WireGuardKit`). Detect the
   protocol from the payload, not from the endpoint name.
2. **iOS memory ceiling.** `ios/PacketTunnel/` must never fetch, parse, cache, or
   Base64-decode the VPN Gate CSV. All ingestion and scoring happens in the Dart
   UI process. Pass only the single active, sanitized config string through App
   Group `group.com.opentunnel.vpn`. Target < 12 MB peak in the extension; the OS
   hard limit is roughly 15 MB. No analytics, verbose logging, or large buffers
   in the extension.
3. **Kill-switch boundary.** An app cannot toggle Android's system
   "Block connections without VPN" setting. Implement in-app packet blocking,
   never call `allowBypass()`, and deep-link users to
   `Settings.ACTION_VPN_SETTINGS` for the OS-level Always-On toggle. On iOS use
   `NEOnDemandRuleConnect` with `isOnDemandEnabled`, and set
   `includeAllNetworks` where the deployment target supports it.
4. **Sanitize every OpenVPN payload.** Inject
   `data-ciphers AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305:AES-128-CBC` and
   `data-ciphers-fallback AES-128-CBC` exactly once. Strip unsupported
   directives that modern OpenVPN 2.6+ rejects. Never log inline keys,
   certificates, or full configs.
5. **Privacy by construction.** No accounts, analytics SDKs, crash reporters with
   PII, or remote logging. Node cache lives only in local Drift storage and dies
   with the app.
6. **No placeholders.** Do not ship `// TODO`, mock bridge methods, or hard-coded
   fake states in parser, bridge, or native tunnel code. If an external SDK is
   missing, implement a typed, explicit failure path and report the blocker.
7. **Stream everything.** Parse the CSV line by line, never build the full
   multi-megabyte body in memory in the extension. Probe with short timeouts and
   bounded concurrency (default 8).
8. **Secrets stay out of the repo.** `.env` is ignored. Never paste API keys into
   source, tests, fixtures, or commands.

## VPN Gate CSV Contract

- Line 1: `*vpn_servers` — discard.
- Line 2: header beginning `#HostName,...` — discard.
- Rows: 15 columns, in order:
  `HostName, IP, Score, Ping, Speed, CountryLong, CountryShort, NumVpnSessions,
  Uptime, TotalUsers, TotalTraffic, LogType, Operator, Message,
  OpenVPN_ConfigData_Base64`.
- Final line: `*` — discard.
- Decode index 14 with `base64.decode` (normalize whitespace/padding). Parse from
  the final comma because the base64 field is last and no field is reliably
  quoted; a naive `split(',')` shifts columns when the message contains commas.
- Extract `remote <host> <port>` and `proto <tcp|udp>` from the decoded text.
  Default to port 1194/udp if absent.
- Prefer HTTPS, then HTTP, and then documented mirrors when the primary host is
  blocked. The HTTP fallback is slow and needs a scoped cleartext exception on
  Android plus an ATS exception on iOS (already configured in this scaffold).

## Scoring

`S = 40 * (speedMbps / 100) - 0.35 * measuredRttMs + 10 * log10(uptimeSec + 1)
- 0.15 * numSessions`

Probe candidates with `Socket.connect(..., timeout: 1500ms)` before connecting,
destroy the socket immediately, and keep the static CSV score as a fallback when
probing fails.

## Platform Setup Status

- Android manifest contains VPN/FGS permissions and the service declaration;
  the debug APK builds (`flutter build apk --debug`).
  `OpenTunnelVpnService.kt` is created in Phase 2.
- Phase 1 (ingestion, parser, sanitizer, prober, Drift cache) is implemented
  and green; `tool/vpngate_smoke.dart` validates it against the live payload.
- The iOS `PacketTunnel` Network Extension target is **not** generated by
  `flutter create`; follow `docs/ios-network-extension.md` in Xcode before
  Phase 3 builds. App Group: `group.com.opentunnel.vpn`.

## Verification Discipline

After every file modification run `flutter analyze`, then `flutter test`. A phase
is complete only when both are green and the phase's acceptance checks pass.
Report unresolved external blockers instead of inventing APIs.

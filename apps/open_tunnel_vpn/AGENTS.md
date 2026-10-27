# OpenTunnel VPN & Privacy Guard — Agent Rules & Architecture

## Workspace

- App: `apps/open_tunnel_vpn` (workspace member of the `apps-hub` monorepo).
- UI/runtime: React Native 0.81.5 + Expo SDK 54 (new arch), TypeScript 5.9.
- Domain logic: `packages/open-tunnel-core` — pure TypeScript, Hermes-safe
  (no `node:crypto`, `Buffer`, or `TextDecoder` in runtime code), with
  `TcpProbeFn` injected for sockets.
- Local cache: Expo `expo-sqlite` via `src/data/` (Drift-parity semantics,
  real `node:sqlite` in unit tests — no mocks).
- Native bridge: Expo local module `modules/open-tunnel-native` (Phase 2,
  Expo Modules API — replaces the Flutter-era Pigeon contract; event
  emitters for status + ~1 Hz traffic counters).
- Android: `android.net.VpnService` (Kotlin, package
  `com.opentunnel.open_tunnel_vpn`). Engines: WireGuard via
  `com.wireguard.android:tunnel`, OpenVPN 2 via ics-openvpn (GPLv2, the
  reason this app is GPL-2.0-only) built by `vendor/ics-openvpn/build-aar.sh`
  into `android/app/libs/ics-openvpn.aar`. Both engines host their own
  VpnService; `OpenTunnelVpnService` is the controller. The manifest keeps
  ics-openvpn's services in the app process and removes its remote-control
  API; `expo.useLegacyPackaging=true` because the OpenVPN binary
  (`libovpnexec.so`) must be extracted to run.
- iOS: `NETunnelProviderManager` in `ios/OpenTunnel/` and
  `NEPacketTunnelProvider` in `ios/OpenTunnelPacketTunnel/` (manually created
  Xcode target; see `docs/ios-network-extension.md`).
- Upstream data: `https://www.vpngate.net/api/iphone/` (University of
  Tsukuba). The payload is ~1.3 MB and the server can be slow; use a 15 s
  connect timeout, a 120 s data-gap receive timeout, and show cached nodes
  immediately.

### Verified commands

```bash
pnpm test               # workspace-wide node --test (TS via type stripping)
pnpm typecheck          # per-package tsc --noEmit
pnpm --filter open_tunnel_vpn exec expo-doctor
# Native compile gates (after Phase 2+):
cd apps/open_tunnel_vpn/android && JAVA_HOME=$JAVA_HOME ./gradlew :app:assembleDebug
cd apps/open_tunnel_vpn/ios && xcodebuild -workspace OpenTunnel.xcworkspace ...
# Config plugins regenerate natives:
pnpm --filter open_tunnel_vpn exec expo prebuild --no-install
```

Android native compilation works on this machine with JDK 21 (`openjdk@21`)
plus the Android SDK at `~/Library/Android/sdk`; iOS compilation works too —
the committed workspace builds (2026-10-27, see
`docs/phase3-session-log.md`), and the only owner-only step still outstanding
is attaching a paid-team DEVELOPMENT_TEAM for device builds.

## Directory Map

```
packages/open-tunnel-core/src/vpn-node.ts     Immutable node model + scoring
packages/open-tunnel-core/src/vpngate.ts      CSV parse + sanitizer + config decode
packages/open-tunnel-core/src/vpngate-service.ts  Fetch + streaming line parser
packages/open-tunnel-core/src/latency-prober.ts   Bounded TCP RTT probe + fitness
packages/open-tunnel-core/src/node-tcp-probe.ts   Node-only probe (tests/smoke)
apps/open_tunnel_vpn/App.tsx                  Phase 1 data-parity screen
apps/open_tunnel_vpn/src/data/node-cache.ts   expo-sqlite cache (Drift parity)
apps/open_tunnel_vpn/plugin/opentunnel-android-config.js  manifest posture
apps/open_tunnel_vpn/modules/open-tunnel-native  Expo module (Phase 2)
ios/OpenTunnelPacketTunnel/                   NEPacketTunnelProvider (Phase 3)
android/.../OpenTunnelVpnService.kt           Android VpnService host (Phase 2)
.opencode/commands/phase1..4.md               implementation phases
```

## Non-Negotiable Engineering Rules

1. **Dual engine, not dual fantasy.** VPN Gate column 15 (index 14,
   `OpenVPN_ConfigData_Base64`) is OpenVPN `.ovpn` data. It is never
   WireGuard. Route VPN Gate nodes through the OpenVPN engine and only
   genuine `.conf` payloads through WireGuard (`wireguard-go` /
   `WireGuardKit`). Detect the protocol from the payload, not from the
   endpoint name.
2. **iOS memory ceiling.** `ios/OpenTunnelPacketTunnel/` must never fetch,
   parse, cache, or Base64-decode the VPN Gate CSV. All ingestion and
   scoring happens in the JS UI process. Pass only the single active,
   sanitized config string through App Group `group.com.opentunnel.vpn`.
   Target < 12 MB peak in the extension; the OS hard limit is roughly
   15 MB. No analytics, verbose logging, or large buffers in the extension.
3. **Kill-switch boundary.** An app cannot toggle Android's system "Block
   connections without VPN" setting. Implement in-app packet blocking,
   never call `allowBypass()`, and deep-link users to
   `Settings.ACTION_VPN_SETTINGS` for the OS-level Always-On toggle. On iOS
   use `NEOnDemandRuleConnect` with `isOnDemandEnabled`, and set
   `includeAllNetworks` where the deployment target supports it.
4. **Sanitize every OpenVPN payload.** Inject
   `data-ciphers AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305:AES-128-CBC` and
   `data-ciphers-fallback AES-128-CBC` exactly once. Strip unsupported
   directives that modern OpenVPN 2.6+ rejects. Never log inline keys,
   certificates, or full configs.
5. **Privacy by construction.** No accounts, analytics SDKs, crash
   reporters with PII, or remote logging. Node cache lives only in local
   expo-sqlite storage and dies with the app; Android backups are disabled
   via the config plugin (`allowBackup="false"`).
6. **No placeholders.** Do not ship `// TODO`, mock bridge methods, or
   hard-coded fake states in parser, bridge, or native tunnel code. If an
   external SDK is missing, implement a typed, explicit failure path and
   report the blocker.
7. **Stream everything.** Parse the CSV line by line (byte-level line
   splitting, tolerant UTF-8, base64 decoded per row), never build the full
   multi-megabyte body in memory. Probe with short timeouts and bounded
   concurrency (default 8).
8. **Secrets stay out of the repo.** `.env` is ignored. Never paste API
   keys into source, tests, fixtures, or commands.

## VPN Gate CSV Contract

- Line 1: `*vpn_servers` — discard.
- Line 2: header beginning `#HostName,...` — discard.
- Rows: 15 columns, in order:
  `HostName, IP, Score, Ping, Speed, CountryLong, CountryShort,
  NumVpnSessions, Uptime, TotalUsers, TotalTraffic, LogType, Operator,
  Message, OpenVPN_ConfigData_Base64`.
- Final line: `*` — discard.
- Decode index 14 with tolerant base64 (whitespace normalized, padding
  repaired, URL-safe alphabet accepted). Parse from the final comma because
  the base64 field is last and no field is reliably quoted; a naive
  `split(',')` shifts columns when the message contains commas.
- Extract `remote <host> <port>` and `proto <tcp|udp>` from the decoded
  text. Default to port 1194/udp if absent.
- Prefer HTTPS, then HTTP, then documented mirrors when the primary host is
  blocked. The HTTP fallback needs a scoped cleartext exception on Android
  (`plugin/opentunnel-android-config.js`) plus the ATS exception on iOS
  (already configured in `app.json`).

## Scoring

`S = 40 * (speedMbps / 100) - 0.35 * measuredRttMs + 10 * log10(uptimeSec + 1)
- 0.15 * numSessions`

Probe candidates over native sockets (`TcpProbeFn`) before connecting,
destroy the socket immediately, and keep the static CSV ping as fallback
when probing fails.

## Migration provenance

The app lived in Flutter (Riverpod/Drift/Pigeon) until the 2026-10-26
migration. The full Phase-1 Dart implementation is preserved at git commit
`a8cf6e9`; the release APK staged under `releases/` predates it. Drift →
expo-sqlite semantics were ported with two deliberate deviations:

- `nodeFromRow` now **restores** `measuredRttMs`/`fitnessScore` (the Drift
  version dropped both on read-back; wrong UX after restart).
- `probedAtMs` is actually written (Drift had the column but never set it).

## Platform Setup Status

- React Native scaffold: Expo 54 + expo-sqlite 16, prebuilt `android/` and
  `ios/` committed; Android manifest carries the VPN/FGS permissions and
  the scoped cleartext policy (the service declaration is added in Phase 2
  together with the Kotlin class).
- Phase 1 data layer (ingestion, parser, sanitizer, scorer, cache) is
  implemented in TS and green: `pnpm test` / `pnpm typecheck`.
- The iOS `OpenTunnelPacketTunnel` Network Extension target carries the
  Phase-3 sources (added 2026-10-27 per `docs/ios-network-extension.md` and
  `docs/phase3-session-log.md`): `PacketTunnelProvider.swift` in the
  extension target plus the shared App-Group contract, and the
  `OpenTunnelNative` Expo module pod implements the iOS half alongside
  Kotlin. Full workspace build green; extension Info.plist/entitlements
  are final. Both iOS engines stay typed-gated (G1 license carry-in, G2
  no-Go toolchain for the wireguard-go bridge) — see the session log. A
  paid-team DEVELOPMENT_TEAM still needs attaching before device builds.
  App Group: `group.com.opentunnel.vpn`.

## Verification Discipline

After every file modification run `pnpm test`, then `pnpm typecheck`. A
phase is complete only when both are green and the phase's acceptance
checks pass. Report unresolved external blockers instead of inventing APIs.

# TunnelWall (formerly OpenTunnel) VPN & Privacy Guard

Zero-registration, zero-telemetry VPN client that aggregates academic and
community relays (VPN Gate) alongside user-supplied WireGuard nodes.

React Native (Expo SDK 54) app in the `apps-hub` monorepo. Formerly
Flutter — the pre-migration Dart implementation is preserved at commit
`a8cf6e9`. The four implementation phases live in `.opencode/commands/`
and are invoked as `/phase1` … `/phase4`.

## Status

| Area | State |
| --- | --- |
| React Native 0.81 + Expo 54 project (`apps/open_tunnel_vpn`) | Scaffolded, natives prebuilt & committed |
| Pure-TS domain layer (`packages/open-tunnel-core`) | Created — Hermes-safe sha256/base64/UTF-8, streaming parser |
| expo-sqlite cache (Drift parity, `node:sqlite` tests) | Implemented |
| Android VPN/FGS permissions + scoped cleartext policy | Configured (Expo config plugin) |
| iOS ATS exception (vpngate.net) — bundle id retained | Configured |
| Phase 1 — ingestion, parser, sanitizer, scorer, cache | Done |
| Phase 2 — Android VpnService + OpenVPN engine (ics-openvpn) | Done; connects to VPN Gate relays on a real phone (2026-10-27) |
| Phase 3 — iOS Network Extension | Module + provider built; both iOS engines still gated (OpenVPN core licence, WireGuard Go build) |
| Phase 4 — full UI | Built: server list, connect/disconnect, live traffic, settings (on `@apps-hub/ui`); not yet tested on a phone |
| Distribution | Private Store (Android). Every push to `main` that changes this app, its native module or a package it uses publishes a new build automatically (`docs/app-store.md`, "CI/CD") |

## Quick start

```bash
pnpm install
pnpm --filter open_tunnel_vpn test      # node --test suites
pnpm --filter open_tunnel_vpn typecheck

# Run the app (first build takes a while):
pnpm --filter open_tunnel_vpn android   # or: ios
```

Then run, in order: `/phase2`, `/phase3`, `/phase4` (see
`.opencode/commands/`).

## Architecture in one screen

```
VPN Gate HTTPS ──▶ VpnGateService (stream fetch, 15s connect / 120s data-gap)
                     └─▶ parseVpnGateCsv   (byte-level lines, last-comma base64)
                          └─▶ sanitizeOvpnConfig (2.6+ cipher block, exactly once)
                               └─▶ LatencyProber (native TcpProbeFn, ≤8 workers)
                                    └─▶ VpnNodeCache (expo-sqlite, atomic replace)
                                         └─▶ UI list / tunnel start (Phase 2+)
```

## Privacy invariants

- No accounts, analytics, telemetry, or remote logging.
- VPN Gate parsing, base64 decoding, and latency scoring run in the app UI
  process only; the iOS extension reads one sanitized config from the App
  Group and stays below 12 MB peak (15 MB OS ceiling).
- Cached nodes live in local expo-sqlite and disappear on uninstall;
  Android `allowBackup="false"` via config plugin.
- `.env` is ignored; no keys in source or fixtures.

## Threat model and upstream terms

"Zero telemetry" describes this app, not the exit relay. VPN Gate nodes are
operated by volunteers and academic institutions; an operator can observe
traffic metadata and, without TLS, content. The UI must not claim that free
relays are anonymous or log-free. Some nodes are explicitly marked
"Academic Use Only" in the upstream `Operator`/`Message` fields, and VPN
Gate's terms still apply. Review both before distributing or monetising
the app.

## Licensing and release blockers

- TunnelWall is GPL-2.0-only (`LICENSE`, decided 2026-10-27) because the
  Android OpenVPN engine is `ics-openvpn` v0.7.69 (GPLv2 with additional
  terms, `vendor/ics-openvpn/LICENSE-ics-openvpn.txt`). Anyone who gets the
  APK must be able to get this source; the repo is public.
- Rebuild the engine with `vendor/ics-openvpn/build-aar.sh` (needs the
  Android NDK 28.2 and CMake 3.22 from the SDK); it writes
  `android/app/libs/ics-openvpn.aar`, which is committed.
- OpenVPNAdapter / OpenVPN 3 Core (a future iOS engine) is AGPLv3.
- WireGuardKit is MIT.
- App Groups and Network Extension entitlements require a paid Apple
  Developer team.

## Backend notes carried from the Flutter phase

- VPN Gate is slow (~1.3 MB body); the fetch contract uses a 15 s connect
  deadline and a 120 s data-gap receive timeout, HTTPS first. Cached nodes
  render immediately.
- CSV comma splitting is unsafe; parse from the final comma and fold extra
  commas into the operator/message field instead of shifting column 14.
- Android opts out of bypass by never calling `allowBypass()`; "Block
  connections without VPN" is deep-linked, not programmable.
- Native package path is `com.opentunnel.open_tunnel_vpn` (React Native
  `applicationId` and future Kotlin sources keep this).
- VPN Gate needs a scoped cleartext exception for its HTTP fallback
  (`plugin/opentunnel-android-config.js`) plus the iOS ATS exception
  (already in `app.json`). HTTPS remains primary.
- Licensing was decided on 2026-10-27: GPL-2.0-only (see above).

## Migration provenance (Flutter → React Native, 2026-10-26)

- Snapshot commit of the complete Flutter app (Phase 1 green, 19 tests):
  `a8cf6e9`.
- Dart core ported to `packages/open-tunnel-core` with one deliberate
  improvement: the SQLite cache now restores `measuredRttMs` /
  `fitnessScore` on read-back (the Drift version dropped them).
- `main.dart` was still the default Flutter counter template — no UI code
  was migrated; App.tsx got a fresh Phase-1 parity screen.
- Release APK `releases/OpenTunnel-release.apk` predates the migration and
  does not reflect this code base.

## Toolchain verified on this machine

| Tool | State |
| --- | --- |
| Node / pnpm | ≥ 22 / 12.15 (corepack), workspace hoisted |
| Xcode / CocoaPods | 26.5 / 1.17.0 |
| JDK / Android SDK | JDK 21 (`openjdk@21`); platform 36, build-tools 36.0.0 |
| React Native / Expo | 0.81.5 / SDK 54 (~54.0.36) |

## Verification

- `pnpm test` — 22 core tests + 7 cache tests green (CSV tokenizer, sanitizer
  idempotency, fitness formula, real-loopback TCP prober, sha256 identity,
  cache round-trips/eviction).
- `pnpm typecheck` — all packages green.
- `expo prebuild --no-install` — android/ios regenerated with the privacy
  posture verified in-place (greps in AGENTS.md Platform Setup Status).

# Phase 3 Plan — iOS NetworkExtension host + App-Group hand-off

Companion to `.opencode/commands/phase3.md`. Phase-2 baseline: commit
`ea990ca` (record: `docs/phase2-session-log.md` — gates, G4 findings,
deviations). One session executes this phase; phases stay atomic.

## 1. Objective & scope

Ship the iOS half of the tunnel: the module's iOS binding, the packet-tunnel
extension host, and the App-Group hand-off of the single sanitized config —
with the same honesty rules as phase 2 (real states or typed failures; no
mock bridge methods, no invented traffic).

In scope:

- `modules/open-tunnel-native` iOS half (Swift) — same JS contract as
  Android (`startTunnel/stopTunnel/getState/openSystemVpnSettings`,
  `tcpProbe` typed-fail, `onStatusChanged`/`onTrafficUpdate` emitters).
- `ios/OpenTunnelPacketTunnel/PacketTunnelProvider.swift` — NetworkExtension
  process; reads one config from the App Group; engines per payload.
- App-Group payload contract + entitlements/prerequisite verification.
- On-Demand ("kill switch equivalent") wiring per AGENTS rule #3.
- TS: replace the phase-2 iOS fail-fast binding with the real one; no UI
  rework (`App.tsx` dev readout already consumes the contract).

Out of scope: VPN Gate CSV handling in the extension (never), UI redesign
(phase 4), Android changes (phase 2 is final there), the full UI app.

## 2. Rules carried into every task

From app `AGENTS.md` (read it first) plus the phase-2 record:

- **15 MB ceiling / < 12 MB target** in `ios/OpenTunnelPacketTunnel/`:
  no CSV, no fetch, no Base64 decode, no full-file reads, no per-packet
  allocations, no analytics or verbose logging. Static/autoreleased needs
  auditing against the Allocations gauge — "it compiles" is not enough.
- **Kill-switch boundary:** `NEOnDemandRuleConnect` + `isOnDemandEnabled`;
  disconnect must `saveToPreferences` **before** `stopVPNTunnel()` so
  on-demand does not respawn the tunnel. No `allowBypass`-equivalent tricks.
- **Privacy by construction:** the App Group carries only the single active
  sanitized config + counters; nothing else, nothing persisted after stop
  beyond what iOS requires for Always-On to function.
- **No placeholders** (grep-gated as in phase 2): typed failures instead.
  Never log keys, certs, or full configs — the App Group payload never
  appears in logs.
- Copy stays sentence case, active voice.
- Separator-engine parity: the extension receives `protocol` in the config
  (the router was decided in the app by payload sniffing — `VpnPayload`
  on Android, package `detectVpnProtocol` in TS). The extension trusts
  `configText` + `protocol`, re-validates size, and never sniffs from
  names or endpoints.
- After every file modification: `pnpm test`, then `pnpm typecheck` (TS
  gates; report ACTUAL outputs).

## 3. Gates before code (owner decisions)

Ask the four gate questions up front; any "don't know" → the fallback next
to each gate governs (same convention as phase 2 — fallbacks keep the
session unblocked and honest).

- **G1 — OpenVPN engine licensing path (carried over, now also iOS).**
  `ics-openvpn` is GPLv2; OpenVPNAdapter / OpenVPN 3 Core is AGPLv3
  (`docs/ios-network-extension.md` §Licensing). Without a project license
  decision, iOS `.ovpn` payloads get the same treatment Android got:
  typed `ERR_ENGINE_UNAVAILABLE` at start, real message surfaced through
  `onStatusChanged`. Fallback: WireGuard-only extension this phase.
- **G2 — Swift package approvals (name · version · license · why · scripts).**
  `WireGuardKit` (MIT per the docs table above) may proceed only after the
  implementer pins the exact repo/tag, verifies the license file in that
  tag, and records it. OpenVPN bindings are blocked by G1. Fallback: if
  WireGuardKit cannot be verified (package fetch fails, license mismatch,
  any build script), implement the extension host + App-Group plumbing with
  both engines typed-gated and report the blocker — never a fake adapter.
- **G3 — pnpm `allowBuilds` / lockfile.** Nothing expected: Swift packages
  live outside pnpm; `pnpm-lock.yaml` must not churn in phase 3. If a
  TS-side change truly requires a dependency, that is new scope — report
  before adding.
- **G4 — artifact/API verification before writing Swift** (same discipline
  as phase 2 G4):
  1. Target prerequisite — **done 2026-10-27, commit `1f77983`**: the
     `OpenTunnelPacketTunnel` target exists in the committed project
     (bundle id `com.opentunnel.openTunnelVpn.PacketTunnel`, iOS 16.0,
     embedded into the app), entitlements per `docs/ios-network-extension.md`
     §2 are on both targets, and the extension proves out with
     `xcodebuild -target OpenTunnelPacketTunnel -sdk iphonesimulator
     CODE_SIGNING_ALLOWED=NO` → `BUILD SUCCEEDED`. Re-run that greps/build
     at session start to confirm nothing regressed. Still human-only:
     attaching a paid-team `DEVELOPMENT_TEAM` (this machine has no
     codesigning identity); it gates device builds/portal registration,
     NOT simulator work or the rest of the plan.
  2. Verify `includeAllNetworks` / `excludeLocalNetworks` availability and
     behavior against the actual SDK headers the project builds with (iOS 16
     deployment target per `docs/ios-network-extension.md` §5), not from
     memory of forum threads.
  3. Verify WireGuardKit's public surface (`WireGuardAdapter`, state
     callbacks, ingress/egress counters hooks) from the pinned tag's source
     before writing the adapter wrapper.

## 4. Module iOS half — `modules/open-tunnel-native/ios/`

- Flip `expo-module.config.json` to declare `ios`
  (`platforms: ["android","ios"]`, `ios.modules` with the Swift module
  class) and add the podspec (`open-tunnel-native.podspec`, convention:
  dependency `pod 'expo-modules-core'`, deployment iOS 16, static
  framework safe). Verify the Expo modules podspec pattern against a
  committed local module in this repo (`apps/netlens/modules/netlens-core`
  has an iOS half — pattern- copy its structure, not its domain logic).
- Swift side mirrors the Kotlin registry/event shapes minimally: a
  process-wide status store +
  `NEVPNStatusDidChange` observer (§5 of the command), a ≤1 Hz main-thread
  timer reading provider counters from the App Group for
  `onTrafficUpdate`, and the engine router over the payload `protocol`.
- `startTunnel(config)`: write the App-Group payload per §5 (below), build
  `NETunnelProviderProtocol` (providerBundleIdentifier
  `com.opentunnel.openTunnelVpn.PacketTunnel`, server + port in the
  providerConfiguration **only as id/protocol metadata** — the payload
  itself rides the App Group), connect if `enableKillSwitch`, save, start.
  Private-key material stays out of `providerConfiguration`/UserDefaults;
  if WireGuard needs the key in the extension, read it from shared
  Keychain or the App-Group file written with file protection, and never
  log it.
- `getState()`: real `NEVPNStatus` mapping; app restart re-converges
  (phase-2 TS already normalizes).
- `openSystemVpnSettings()`: iOS has no `ACTION_VPN_SETTINGS` — open
  `UIApplication.openSettingsURLString` (app settings), resolve true only
  if the URL actually opens. Document the difference; deep-linking the
  provider-specific VPN page is a phase-4 polish if it proves reliable.
- TCP probe on iOS: there is no native `tcpProbe` module yet. Implement
  the same bounded single-connect probe in Swift for parity if the owner
  wants it this phase; otherwise keep the typed `PROBE_FAILED`
  ("arrives with the Android module" wording no longer true — update the
  message to state iOS probe is pending) and record the deviation.
- TS: after the Swift half lands, extend `createOpenTunnelBinding`
  (`modules/open-tunnel-native/src/index.ts`) so `platform === 'ios'`
  binds the real native module — deleting the `unavailableBinding('ios')`
  path and its "ships in Phase 3" message. Keep the fail-fast semantics
  for genuinely unavailable runtimes (Node/tests); the phase-2 tests
  (`tunnel-client.test.ts`) must keep passing namespace-wide — but update
  the iOS expectations in the test **only if** the contract strings they
  assert changed, and say so in the session log.

**Deviation from the command (record up front):** `.opencode/commands/phase3.md`
§1 places `VpnManagerBridge.swift` in the **app target**
(`ios/OpenTunnel/`). The Expo Modules API requires the module class to
live in the module pod — the bridge therefore lands in
`modules/open-tunnel-native/ios/` and the app target keeps only what
target membership requires. Same corrective pattern as phase 2 §4.4.

## 5. App-Group payload contract (single source of truth)

Written by the module on every `startTunnel(config)`; read by the
extension at `startTunnel`; removed/released on `stopTunnel` only where
iOS allows (Always-On on-demand may need the payload to survive — keep
the payload, never the raw VPN Gate row):

| Key | Type | Content |
| --- | --- | --- |
| `activeConfig.protocol` | String | `openvpn` \| `wireguard` |
| `activeConfig.configText` | String | the already-sanitized `.conf`/`.ovpn` payload (phase-1 sanitizer output, byte-for-byte — no double-injection) |
| `activeConfig.nodeId` | String | 64-char id (traceability, no PII) |
| `activeConfig.dnsServers` | [String] | from the phase-2 contract |
| `activeConfig.enableKillSwitch` | Bool | drives On-Demand |
| `activeConfig.writtenAtMs` | Int64 | staleness guard for the extension |

Container: shared file in the App-Group container (JSON, no base64
double-churn) OR a `UserDefaults(suiteName: "group.com.opentunnel.vpn")`
entry — pick ONE, document it, and size-guard on read: reject >
256 KB with a typed error (command §2). The extension never reads
anything else from disk.

## 6. Extension — `ios/OpenTunnelPacketTunnel/PacketTunnelProvider.swift`

Concrete form of command §2:

- `PacketTunnelProvider: NEPacketTunnelProvider`.
  `startTunnel(options:completionHandler:)`:
  1. Read the App-Group payload; validate size and required keys; typed
     failure (`NEProviderStopReason` equivalent an error + `cancel(_:)`)
     on missing/oversize/stale payloads — never silently "connected".
  2. Build `NEPacketTunnelNetworkSettings`: MTU 1420; IPv4 with a real
     capturing address/route; DNS `NEDNSSettings` with the payload's
     servers and `matchDomains = [""]`; IPv6 `NEIPv6Settings` with
     `[NEIPv6Route.default()]` so IPv6 cannot leak around an IPv4-only
     node.
  3. Start the engine for `protocol`: WireGuardKit adapter for
     `wireguard`; for `openvpn`, the typed G1 gate.
  4. Publish status changes to the shared App-Group status key (≤1 Hz,
     values only when they change) so the module's observer can surface
     `onStatusChanged` without an XPC poll storm.
- `stopTunnel(with:completionHandler:)`: stop the engine, flush counters
  once, clear the status key, complete.
- Counters: adapter-provided totals or `NEPacketFlowStats` if available;
  the extension writes only bytes/duration, the module owns cadence.
- Memory: no retained payload buffers after settings are built; drop the
  config string after the adapter parses it where the adapter API
  permits.

Entitlements/plist per `docs/ios-network-extension.md` §2–§4 — after the
manual Xcode prerequisite exists, re-verify the four checkboxes in that
doc (target, capabilities on BOTH targets, Info.plist extension point,
file membership), then commit the generated target files the way
`expo prebuild`-generated natives are committed.

## 7. Verification & acceptance (report ACTUAL outputs)

```bash
# TS gates after every edit:
pnpm test && pnpm typecheck
# iOS compile gate (after the manual target exists):
cd apps/open_tunnel_vpn/ios && xcodebuild -workspace OpenTunnel.xcworkspace \
  -scheme OpenTunnel -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -configuration Debug build CODE_SIGNING_ALLOWED=NO
# Extension scheme (needs CODE_SIGNING off for simulator-only proof):
xcodebuild -workspace OpenTunnel.xcworkspace -scheme OpenTunnelPacketTunnel \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build
```

Acceptance checks (extend the phase-2 checklist style):

- [ ] `grep -rn "allowBypass" ios modules/open-tunnel-native/src` clean
      (source, build/ excluded — same convention as phase 2)
- [ ] `grep -rn "TODO\|placeholder\|fake\|mock"` clean over new Swift/TS
- [ ] Extension never references `URLSession`/`vpngate`/CSV strings
      (`grep -rn "vpngate\|URLSession\|base64" ios/OpenTunnelPacketTunnel/`)
- [ ] `println`/`os_log` in the extension print no config/key/cert content
      (inspect the log statements manually — gate: zero logs of payload text)
- [ ] Simulator build green for BOTH targets; device Allocations report
      recorded in the session log (peak MB while tunnel active)
- [ ] `pnpm test`/`pnpm typecheck` green with the real iOS binding in
- [ ] Session log `docs/phase3-session-log.md`: gates asked/answered,
      deviations, verification outputs, memory numbers

Hard stop-and-report triggers (no fakes, no path invention): entitlements
broken or the target/regression check fails at session start
(re-run the §3 G4.1 build); the Apple team cannot be attached when device
verification needs it (record as blocker — owner action — instead of
faking a signed build); WireGuardKit unverifiable under G2; an `.ovpn`
payload arrives before a G1 decision (typed gate covers this at runtime —
that is the "engine-unavailable" path, not a blocker).

## 8. Risks & blockers (prioritized)

1. **Apple team attach (verified absent on this machine):** the target and
   capabilities exist, but `DEVELOPMENT_TEAM` + portal registration of the
   App Group need the owner's account at the first signed device build.
   Simulator/compile work is unblocked; `DEVELOPMENT_TEAM` attach is not
   grantable from session tooling.
2. **G1 license** — unchanged from phase 2; now binds the iOS `.ovpn` path
   too; WireGuard-only fallback keeps the rest of the phase shippable.
3. **Entitlement limits on free/personal teams** — App Groups + Network
   Extensions generally require a paid team; the docs say so explicitly.
4. **Simulator blind spots** — extension memory and lifecycle need a
   physical device for the honest <12 MB claim; a simulator pass proves
   compilation only.
5. **Counter fidelity** — if WireGuardKit's counters differ from
   Android's byte semantics, surface them as measured values, never
   shaped to match Android numbers.

## 9. Sequencing (one session)

1. Read `AGENTS.md`, this plan, `docs/phase2-session-log.md`, command
   `phase3.md`. Ask G-gates; merge answers into §3 fallbacks.
2. Prerequisite + regression check (§3 G4.1): confirm the target and
   its entitlements are intact via the committed-project grep and the
   simulator build (they were verified green 2026-10-27, `1f77983`);
   do NOT re-attempt project surgery. If anything regressed, stop and
   report diffs verbatim.
3. G4 verifications (SDK symbols, WireGuardKit pin/license/docs).
4. Module iOS half (§4) → `pnpm test`+`typecheck` green on Node/Android.
5. Extension (§6) + entitlement verification (§2 of the docs file).
6. Verification §7; write `docs/phase3-session-log.md`; commit by
   explicit path only (phase 2 hygiene: no `git add -A`; the repo is a
   shared workspace with in-flight work — stage only this app's files).

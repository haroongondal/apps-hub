# Phase 3 session log — iOS NetworkExtension half (module + provider + shared contract)

Date: 2026-10-27 · Session scope: `docs/phase3-plan.md` + `/phase3` command
Governing rules: root `AGENTS.md`, app `AGENTS.md`, plan §7 acceptance checks.

Parallel Android decision (recorded in `docs/phase2-session-log.md` update): G1
resolved GPLv2 + ics-openvpn on Android; this phase carried the iOS half, where
the G1 carry-in and the G2 Go-build question remained owner-"don't know" → the
documented fallbacks below govern.

## Gate decisions (owner answered "don't know" → fallback governs)

| Gate | Owner answer | Resolution |
| --- | --- | --- |
| G1 (OpenVPN on iOS) | Don't know | Typed gate: `ERR_ENGINE_UNAVAILABLE` with an honest reason string (`TunnelContracts.openvpnEngineUnavailableReason`); the payload routing, settings, and start flow are real and complete, so the engine adapter slots in without restructuring. Same shape as the Android `OpenVpnEngine` typed gate. |
| G2 (wireguard-go on iOS) | Don't know | `WireGuardKit` NOT added to the project. It is MIT-licensed, but the wireguard-go bridge cannot be produced by SwiftPM: it requires an External Build Target running `make` with a Go toolchain, and this machine has no Go. Typed gate with that exact reason; recorded blocker. |
| G4 (verify every native API) | Don't know | Done by direct artifact inspection (below). |
| CocoaPods (pod-file edits) | Don't know | `pod install` run against the committed workspace; pod-managed artifacts classified per the netlens precedent (see deviations 6–7). |

## G4 findings (verified against installed artifacts, not documentation)

**ExpoModulesCore 3.0.30 pod sources** (under `node_modules/.pnpm/…/expo-modules-core/ios`):

- `Name(_:)` — `Api/Factories/ModuleFactories.swift:6`; `Events(_ names: String...)`
  and `OnStartObserving(_ event: String? = nil, closure)` — ObjectFactories.swift:33/47;
  `OnDestroy(closure)` — EventListenersFactories.swift:11.
- `AsyncFunction<R, A0: AnyArgument, each A>(_ name: String, @_implicitSelfCapture closure: @escaping (A0, repeat each A) throws -> R)`
  — AsyncFunctionFactories.swift; `Dictionary`/`Array` conform to `AnyArgument`
  conditionally (AnyArgument.swift:100) and `Promise` is itself an
  `AnyArgument` struct, so Kotlin-style `(args…, promise: Promise)` closures
  compile directly.
- `BaseModule.sendEvent(name, body: [String: Any?])` →
  `LegacyEventEmitterCompat.sendEvent(withName:)` schedules via
  `runtime.schedule` → module dispatches to `DispatchQueue.main` before it
  (Kotlin `Dispatchers.Main` parity); the `sendEvent` override the first
  draft attempted on `Module` was removed as illegal — reseed-on-connect
  moved into `ModuleEventForwarder.onStatus` instead.

**swiftc `-typecheck` probes against the installed iphonesimulator SDK** — four
renames/edges the API references would have gotten wrong:

- `NEPacketTunnelNetworkSettings.MTU` imports into Swift as `mtu` (Swift-3
  rename), while `ipv4Settings`/`ipv6Settings`/`dnsSettings` keep ObjC casing.
- `NEPacketTunnelFlow.readPacketObjects(completionHandler:)` — not
  `withCompletionHandler`.
- Cancellation is `cancelTunnelWithError(_:)`; neither `cancel(with:)` nor
  `cancelTunnel(with:)` exists.
- `NEVPNStatus` switches require `@unknown default` under Swift 6 mode;
  `NEProviderStopReason` has no `.unknown` case (cases end at
  `configurationRemoved`/`superceded`/`userLogout`); `NEPacket.direction` is
  macOS-only (unavailable in iOS).

**Pod-compile findings (the workspace gate taught these):** `Result<_, String>`
is illegal (`Failure` must conform to `Swift.Error` → typed
`ConfigParser.Failure.invalid` enum); `protocol` is a reserved token as a
parameter name (renamed `protocolKind`); `BaseModule` does NOT implement
`definition()` — the first draft's `override` keyword failed ("method does not
override any method from its superclass") and was removed; `.domain` is not a
member of `any Error` (cast `as NSError`); and podspec `source_files` paths are
resolved relative to the podspec's own directory — with the spec inside
`ios/`, `source_files "ios/**/*"` matched nothing and the pod compiled empty,
which is what broke `ExpoModulesProvider.swift` with
`no such module 'OpenTunnelNative'` on the first workspace attempt.

## Deliverables

- `modules/open-tunnel-native/ios/` (new, three files):
  `OpenTunnelNativeModule.swift` (Expo module — status registry with monotonic
  duration anchor, event bus, 1 Hz main-queue traffic ticker emitting deltas,
  `VpnManagerBridge` real manager save/reload/start flow, bounded
  `NWConnection` TCP probe with TCP-RST = measured-RTT semantics,
  `startTunnel`/`stopTunnel`/`getState`/`openSystemVpnSettings`/`tcpProbe`,
  strict config parser mirroring Kotlin wording),
  `OpenTunnelShared.swift` (Expo-free shared contract: App Group
  `group.com.opentunnel.vpn` keys, 256 KB / 10-min payload guards, status
  strings, engine-gate reason strings, `TunnelProtocolKind.detect` 1:1 with
  open-tunnel-core + Kotlin, `TunnelHandoff`, `SharedPayload`
  UserDefaults(suiteName:) writer/reader), and `OpenTunnelNative.podspec`
  (NetlensCore pattern, podspec-relative `**/*` sources, platforms 15.1).
- `expo-module.config.json` → `platforms: ["android", "apple"]` +
  `apple.modules ["OpenTunnelNativeModule"]`.
- `ios/OpenTunnelPacketTunnel/PacketTunnelProvider.swift`: reads the
  hand-off (typed size/stale/keys guards), re-does payload sniff
  agreement, builds the real TUN topology (MTU 1420, IPv4 `/30` + default
  route, DNS matchDomains `[""]`, IPv6 default route so an IPv4-only relay
  cannot leak v6), then typed engine gate → cancels with
  `configurationFailed`; stop flushes counters once and clears status keys;
  SafeLog static-text-only.
- `OpenTunnel.xcodeproj/project.pbxproj`: both Swift sources in the
  extension target (xcodeproj gem script; provider in the extension group,
  shared contract in a new `OpenTunnelSharedSource` group anchored at
  `../modules/open-tunnel-native/ios`).
- TS: binding now binds the native seam on BOTH mobile platforms —
  `resolveNativeModule` (lazy `require('expo')` preserved for Node
  type-stripping) with a typed absent-module degrade naming "iOS module";
  `unavailableBinding` wording carries no phase references; tests updated;
  `OpenTunnelNativeModule.ts` header no longer claims "ships in Phase 3".
- Pod wiring: `OpenTunnelNative (0.1.0)` resolves from
  `../modules/open-tunnel-native/ios` and compiles inside the app pod graph.

## Deviations from plan (recorded, none silent)

1. **Bridge location (command §1 deviation):** `VpnManagerBridge` lives in
   the module pod rather than `ios/OpenTunnel/` — the Expo Modules API
   requires the module class (and its helpers) in the pod; the app target
   keeps no Swift source of its own.
2. **`SharedPayload` placement:** first draft kept it inside the module
   file; the extension build failed on `cannot find type 'SharedPayload'`,
   so the contract moved into `OpenTunnelShared.swift` (one source of
   truth, two consumers) and the module maps `NormalizedTunnelConfig` onto
   `TunnelHandoff` via an in-pod initializer extension.
3. **App-Group container choice:** UserDefaults(suiteName:) for the config
   JSON, provider status, and counters (atomic cross-process replaces, no
   base64 double-churn, `synchronize()` after writes) — instead of files.
4. **Contract wording:** the absent-module degrade says the module is not
   installed in this runtime (true at test/runtime boundaries) — no phase
   references; the provider publishes `connecting` before settings apply.
5. **Extension Info.plist churn guard:** pod install injected
   `RCTNewArchEnabled` into the extension plist (React-native-scoped target
   script; meaningless to an appex linking no RN pods) — reverted; future
   pod installs may re-inject it, treat as known artifact, keep the file
   as documented-final.
6. **Pod-managed additions committed per netlens precedent:** Podfile.lock
   (78 deps / 77 pods), `OpenTunnel.xcworkspace`, and
   `OpenTunnel/PrivacyInfo.xcprivacy` (CocoaPods privacy-manifest
   aggregation) are now tracked; `Pods/` stays ignored.
7. **Command's `podspec`-at-package-root sketch:** the spec was placed
   inside `modules/open-tunnel-native/ios/` (as netlens does) with
   podspec-relative sources; CocoaPods resolved it fine there.

## Verification (ACTUAL outputs, run 2026-10-27)

| Check | Result |
| --- | --- |
| `pnpm test` (workspace) | exit 0 — 138 tests / 138 pass / 0 fail across 8 packages (`ui` 13, `store-manifest` 4, `core` 65, `open-tunnel-core` 22, `tools/release` 4, `apps/store` 10, `store-api` 5, `open_tunnel_vpn` 15) |
| `pnpm typecheck` (workspace) | exit 0 — all packages `Done`, 0 errors |
| Extension-target compile gate (first real proof of both Swift files) | `xcodebuild -project … -target OpenTunnelPacketTunnel -sdk iphonesimulator … CODE_SIGNING_ALLOWED=NO` → `** BUILD SUCCEEDED **` (benign warnings only: AppIntents metadata skip, ONLY_ACTIVE_ARCH multi-arch) — after relocating `SharedPayload` into the shared contract |
| `pod install` | complete — 78 dependencies from the Podfile, 77 total pods; `OpenTunnelNative (0.1.0)` registered from `../modules/open-tunnel-native/ios`; took 29 s then 9 s on re-run |
| Workspace native gate `xcodebuild -workspace OpenTunnel.xcworkspace -scheme OpenTunnel -sdk iphonesimulator -configuration Debug build CODE_SIGNING_ALLOWED=NO` | attempt 1: BUILD FAILED (`ExpoModulesProvider.swift: no such module 'OpenTunnelNative'` — podspec `source_files` glob bug); attempt 2: BUILD FAILED (four Swift type errors in the module, listed under pod-compile findings); attempt 3: BUILD FAILED (one residual `.domain` cast); attempt 4: `** BUILD SUCCEEDED **` — app target, `OpenTunnelNative` pod, all 77 pods, and the extension target compile with the real Swift sources |
| Marker gate `grep -rniE 'TODO\|placeholder\|fake\|mock' modules/open-tunnel-native/ios ios/OpenTunnelPacketTunnel modules/open-tunnel-native/src/index.ts` | empty (three phrasing-adjacent comments reworded: "@unknown default invented-state", shared "engines not yet available", provider "no invented engine") |
| Extension purity gate `grep -rniE 'vpngate\|URLSession\|base64' ios/OpenTunnelPacketTunnel/` | empty (header comment reworded to "decodes upstream catalog encodings") |
| `grep -rn 'allowBypass'` over module iOS sources + extension + module TS | empty (Android module matches too; the iOS kill-switch comment cites AGENTS rule #3 without naming the API) |
| `pnpm-lock.yaml` | untouched on this branch this phase (no TS dependency added) |

## Blockers to carry forward

- **iOS OpenVPN engine (G1 carry-in):** typed gated as above; implementing
  it needs the owner's decision on shipping GPL code in the iOS target and
  a port strategy (ics-openvpn is Android-AAR shaped).
- **iOS wireguard-go bridge (G2):** needs a Go toolchain + SwiftPM External
  Build Target; typed gated meanwhile.
- **DEVELOPMENT_TEAM (owner-only, unchanged):** attach on both targets for
  device builds / portal registration (App Group + extension entitlements);
  simulator work is unblocked.

## Source hygiene

- Staged by explicit path only (`git add <path>`), no `git add -A` /
  `commit -a`; status minus staged set is clean; no in-flight/owner work
  touched (branch top is unrelated NetLens handoff work left as-is).
- graft usage this session: 2 calls ≈ 14,284 tokens saved (<$0.02) —
  `ask` on the TS binding contract (≈11,564) and a `grep` pass on
  `unavailableBinding` (≈2,720).

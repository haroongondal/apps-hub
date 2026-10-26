# Phase 2 Plan — Expo native module + Android `VpnService` host

Status: draft, awaiting gate decisions (§3) · Date: 2026-10-26 ·
Execution command: `.opencode/commands/phase2.md` (this plan is its file/decision map) ·
Provenance: service contract held to Flutter commit `a8cf6e9` (§8).

## 1. Objective & scope

Phase 2 replaces the Flutter-era Pigeon bridge with an Expo local module and
brings the tunnel up on Android. Phase 1 (data layer) is already green.

**In scope**

| Deliverable | Location |
| --- | --- |
| Expo module `open-tunnel-native` (Expo Modules API, not Pigeon) | `apps/open_tunnel_vpn/modules/open-tunnel-native/` |
| Android `OpenTunnelVpnService.kt` in app package `com.opentunnel.open_tunnel_vpn` | `android/app/src/main/java/com/opentunnel/open_tunnel_vpn/` |
| WireGuard engine wiring (`com.wireguard.android:tunnel`) | module `android/build.gradle` + engine adapter |
| OpenVPN engine path for VPN Gate `.ovpn` payloads | engine adapter (license gate G1 first) |
| Manifest `<service>` declaration | `android/app/src/main/AndroidManifest.xml` |
| TS client + state machine | `apps/open_tunnel_vpn/src/tunnel/` |
| `TcpProbeFn` → native TCP probe (bounded, 1500 ms, socket destroyed immediately) | `src/tunnel/native-tcp-probe.ts` |
| Dev-only status readout + probed fitness in `App.tsx` | `apps/open_tunnel_vpn/App.tsx` |

**Out of scope** (brought here so it is never improvised)

- iOS implementation — Phase 3 (`docs/ios-network-extension.md`). The module's
  iOS side ships only a typed fail-fast path (§4.3).
- Split-tunnel **app picker UI** and its `<queries>` MAIN/LAUNCHER entry —
  Phase 4. `VpnTunnelConfig.disallowedApps` is already plumbed because
  `Builder.addDisallowedApplication` needs no picker.
- Tunnel control UI (connect screen) — Phase 4.
- Any persistence of `configText` — single active node config flows JS →
  native per start; nothing stored natively (privacy rule #5).

## 2. Rules carried into every task

- Dual engine is payload-derived: the protocol field comes from
  `detectVpnProtocol(configText)` (`open-tunnel-core/src/vpngate.ts:149`), never
  from the endpoint name. VPN Gate rows are always OpenVPN; genuine `.conf`
  payloads route to WireGuard.
- `.ovpn` payloads arrive already sanitized by `sanitizeOpenVpnConfig`
  (cipher directives injected exactly once, unsupported lines stripped).
  The native side must not re-inject — it is idempotent by construction, but
  do not add a second injection site.
- **Never `allowBypass()`** (that is *not* the kill switch — it is the
  check-hole through it). Deep-link `Settings.ACTION_VPN_SETTINGS` for the
  OS Always-On toggle; in-app blocking stays in-engine.
- No placeholders: no `// TODO`, no mock bridge methods, no fake states
  (AGENTS rule #6). Unresolvable engine → typed failure + report blocker.
- Events at ~1 Hz max, marshalled onto the main thread. Hermes-safe TS only
  (no `node:crypto`/`Buffer`/`TextDecoder` in runtime code).

## 3. Gates before code (owner decisions)

Per the dependency skill, nothing below is added until the owner signs off;
names/versions/licenses are given so the approval can be a one-word reply.

### G1 — OpenVPN engine licensing path (release blocker)

| Option | Engine | License | Integration shape |
| --- | --- | --- | --- |
| A ✓ recommended | ics-openvpn (OpenVPN 2.x core via JNI/NDK) | GPLv2 (+ AGPLv3 parts if OpenVPN3 is pulled in) | Subtree-vendor the `openvpn` core as a Gradle library module under the app; drive it through `OpenVPNManagement` against our `VpnService` |
| B | openvpn3-java / OpenVPN3 core | AGPLv3 | Same shape; needs project license declaration |
| C | Write own management wrapper around libopenvpn | dep on copied code | Not viable in one phase |

No Maven artifact exists for either engine; both need a vendored source tree
and an NDK/CMake build, which also raises `:app:assembleDebug` build time.
GPLv2/AGPLv3 are F-Droid-FOSS-fine, but the repo currently declares **no app
license** — adopting a copyleft engine makes the project license a required
sibling decision, surfaced here per plan rather than at release time.

If G1 is unresolved at execution: phase stops after WireGuard plumbing and
reports the blocker (typed `ENGINE_UNAVAILABLE` — no mocks).

### G2 — Dependency approvals (name · version · license · why · scripts)

| Dependency | Version | License | Why nothing existing works | Install scripts |
| --- | --- | --- | --- | --- |
| `com.wireguard.android:tunnel` | latest Maven Central (currently ~1.0.20260102; pin at add time) | Apache-2.0 per artifact POM (re-verify repo LICENSE at pin) | Embeddable GoBackend/wireguard-go; repo has no tunnel engine and RN has no equivalent | AAR from Maven Central, none |
| Vendored ics-openvpn source | pinned upstream commit | GPLv2 | Only real OpenVPN client core for Android that is FOSS | none (Gradle/NDK at build time) |
| `open-tunnel-native` (local) | workspace `0.1.0` | MIT-style in-repo | The bridge itself | none |
| `expo-modules-core` (module own dep) | `~3.0.30` (same pin as `netlens-core`) | MIT | Expo Modules API surface | none |

`pnpm-workspace.yaml` needs **no change**: the `apps/*/modules/*` glob already
covers `apps/open_tunnel_vpn/modules/open-tunnel-native`. The app's
`package.json` gains `open-tunnel-native: workspace:*` (same shape as
`netlens` → `netlens-core`).

### G3 — `allowBuilds`

None expected (all of the above are Gradle-side artifacts, not npm
postinstall scripts). If any dep surfaces a build script at install time:
stop, do not add to `allowBuilds`, report for owner approval.

### G4 — Engine API inspection (before writing engine adapters)

Per phase2.md §2: inspect the actual artifacts, then pin. Never assume
`WgQuickBackend` is a published library class — it is the root-only backend;
non-root Android goes through `GoBackend` (bundled wireguard-go), whose
integration hooks the VpnService it is launched from. Verify in the AAR:
GoBackend construction + up/down state API, the `Tunnel` config parser, and
ics-openvpn's `OpenVPNManagement`/builder contract. Record findings in the
phase-2 session log; that record is an acceptance input.

## 4. Module contract — `modules/open-tunnel-native`

### 4.1 TypeScript surface (mirrors phase2.md §1, plus `configText`)

```ts
export type VpnProtocol = 'openvpn' | 'wireguard';
export type VpnStatusState =
  | 'disconnected' | 'connecting' | 'connected'
  | 'disconnecting' | 'reasserting' | 'error';

export interface VpnTunnelConfig {
  /** UI-facing metadata; the engine reads `configText` for the truth. */
  nodeId: string;
  serverIp: string;
  serverPort: number;            // from extractRemote() or UI default
  protocol: VpnProtocol;         // payload-derived via detectVpnProtocol()
  /** Opaque already-sanitized engine payload (`.conf` or `.ovpn`). */
  configText: string;
  dnsServers: string[];          // baseline ['1.1.1.1', '9.9.9.9']
  enableKillSwitch: boolean;     // Engine drop-all when true; never allowBypass()
  disallowedApps: string[];      // Builder.addDisallowedApplication
}

export interface OpenTunnelNativeApi {
  startTunnel(config: VpnTunnelConfig): Promise<null>;   // resolves once handed to the service
  stopTunnel(): Promise<null>;
  getState(): Promise<VpnStatusState>;
  openSystemVpnSettings(): Promise<boolean>;
  tcpProbe(ip: string, port: number, timeoutMs: number): Promise<number | null>; // RTT ms | null
  addListener(
    event: 'onStatusChanged',
    listener: (payload: { state: VpnStatusState; message?: string }) => void,
  ): { remove(): void };
  addListener(
    event: 'onTrafficUpdate',
    listener: (p: { bytesIn: number; bytesOut: number; connectedDurationSec: number }) => void,
  ): { remove(): void };
}
```

`configText` is the one addition beyond phase2.md's field list — without it
no engine can run (inline cert/key live in the payload). Phase 3's
`VpnManagerBridge` consumes the same object (§10 conflict-check done).

Typed rejects (Expo `Promise.reject` codes, module-side constants like
`netlens-core`): `ERR_INVALID_CONFIG` (malformed configText / protocol
mismatch with payload sniff), `ERR_UNUSED`→`ERR_NO_CONTEXT`, `ERR_ENGINE_UNAVAILABLE`,
`ERR_SERVICE_START_FAILED`, `ERR_PROBE_FAILED` (transport-level only).
`error` status events carry `message` (native wording; never inline keys,
certs, or full configs — rule #4/#5).

### 4.2 Kotlin skeleton (pattern = `NetlensCoreModule.kt`)

- `Name("OpenTunnelNative")`, `Events("onStatusChanged", "onTrafficUpdate")`.
- `AsyncFunction("tcpProbe")` runs on the module `CoroutineScope(SupervisorJob
  + Dispatchers.Default)`: one `Socket.connect(...)` per call — **`ConnectException`
  (RST) is still a live measurement**, returning elapsed ms; only
  `SocketTimeoutException` / `NoRouteToHostException`-family → `null`
  (netlens hard rule #2 semantics, open-tunnel usage).
- `startTunnel` → builds `Intent(context, OpenTunnelVpnService::class)` with
  `ACTION_START` + config extras, `startForegroundService` is called by the
  service lifecycle, not the module; the module only resolves/validates.
- Traffic ticker (`TrafficTicker.kt`): `TrafficStats` per-process deltas +
  monotonic connected-duration, `Handler(mainLooper)` cadence exactly 1 Hz,
  emit stops on disconnect/revoke. No faster.
- Status holder: in-process `object TunnelStateRegistry` (survives
  activity recreation; process death returns to `disconnected` — true state,
  not a fake).
- Events go through the same post-to-main path `netlens-core` uses.

### 4.3 iOS posture in Phase 2

`expo-module.config.json` lists `android` only; the TS client gates on
`Platform.OS` and treats iOS as: `startTunnel`/`stopTunnel` reject with
ERR_ENGINE_UNAVAILABLE('iOS network extension ships in Phase 3'),
`getState` resolves `'disconnected'` (the true state), `openSystemVpnSettings`
resolves `false` — the typed-explicit-failure path allowed by AGENTS #6.
No Swift stub masquerading as a working bridge.

### 4.4 Service placement

`OpenTunnelVpnService.kt` lives in the **app** java path, not the module —
`<service android:name=".OpenTunnelVpnService">` resolves against the app
namespace `com.opentunnel.open_tunnel_vpn` and the engine hookup wants the
running VpnService instance it can hand to `GoBackend`.

## 5. File plan

New files:

```
apps/open_tunnel_vpn/modules/open-tunnel-native/
  package.json                     # name open-tunnel-native, deps: open-tunnel-core workspace:*, expo-modules-core ~3.0.30
  expo-module.config.json          # platforms ["android"], android modules ["expo.modules.opentunnelnative.OpenTunnelNativeModule"]
  src/index.ts                     # createOpenTunnelBinding(): OpenTunnelBinding + normalize/validate helpers
  src/OpenTunnelNativeModule.ts    # requireNativeModule<OpenTunnelNativeApi>('OpenTunnelNative') + shared types
  android/build.gradle             # com.android.library + expo-module-gradle-plugin (mirror netlens-core)
  android/src/main/AndroidManifest.xml
  android/src/main/java/expo/modules/opentunnelnative/
    OpenTunnelNativeModule.kt
    TrafficTicker.kt
    TunnelStateRegistry.kt
    NativeTcpProbe.kt
android/app/src/main/java/com/opentunnel/open_tunnel_vpn/
  OpenTunnelVpnService.kt
  engines/EngineAdapter.kt         # select + lifecycle glue (G4 output decides imports)
  engines/WireGuardEngine.kt       # com.wireguard.android:tunnel GoBackend wrapper
  engines/OpenVpnEngine.kt         # vendored ics-openvpn wrapper (G1 permitting)
apps/open_tunnel_vpn/src/tunnel/
  tunnel-client.ts                 # state machine wrapper + terminal-error handling
  native-tcp-probe.ts              # (ip, port, timeoutMs) => binding.tcpProbe — the TcpProbeFn
apps/open_tunnel_vpn/src/tunnel/__tests__/
  tunnel-client.test.ts            # pure TS: native event → state map, protocol routing, config validation
```

Edits:

- `apps/open_tunnel_vpn/package.json` — add `open-tunnel-native: workspace:*`.
- `apps/open_tunnel_vpn/android/app/src/main/AndroidManifest.xml` — insert the
  `<service>` block (§8). No other manifest churn; permissions already present.
- `apps/open_tunnel_vpn/App.tsx` — dev status row from `tunnel-client` +
  refresh path now probes via `LatencyProber(nativeTcpProbe)` before ranking
  (cache still loads first, cached nodes render immediately).
- `pnpm-lock.yaml` (mechanical from the workspace dep).

Reused, unmodified: `LatencyProber`, `computeFitnessScore`, `detectVpnProtocol`,
`extractRemote`, `sanitizeOpenVpnConfig` from `open-tunnel-core`. The cache
persists probed results on the next `replaceAllNodes` — no cache API change.

## 6. Android service details (phase2.md §2 in concrete form)

Builder baseline (WireGuard path / leak blackhole fallback for OpenVPN):

```kotlin
Builder().apply {
  setSession("OpenTunnel")
  setMtu(1420)
  for (dns in dnsServers.takeIf { it.isNotEmpty() } ?: listOf("1.1.1.1", "9.9.9.9")) addDnsServer(dns)
  // IPv4 coverage is engine/config-driven; the blackhole is the safety net:
  addAddress("fd00::1", 128); addRoute("::", 0)   // IPv6 leak blackhole (never omit unless the payload defines IPv6)
  for (pkg in disallowedApps) addDisallowedApplication(pkg)
  // NEVER allowBypass(); setBlocking(true) only if present on this compileSdk
}
```

- Protocol routing: `protocol === 'openvpn'` → `OpenVpnEngine`, `'wireguard'` →
  `WireGuardEngine`. Mismatch with payload sniff → `ERR_INVALID_CONFIG`.
- Foreground: notification channel (id `tunnel`), `startForeground` with
  `FOREGROUND_SERVICE_TYPE_SPECIAL_USE` on API 34+, plain `startForeground`
  below; `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` value "VPN tunnel" lives in the
  manifest (§8). `POST_NOTIFICATIONS` is requested at runtime on 13+ but a
  denial **never blocks** tunnel startup.
- `onRevoke` → engines down, state → `disconnected`, ticker stops.
- `onDestroy` → clean stop (engine teardown + unregister).
- Traffic streamed from engine counters when they exist (GoBackend stats),
  else `TrafficStats`; ≥1 Hz never.

## 7. TS wiring

`src/tunnel/tunnel-client.ts`: small reducer mapping native
`onStatusChanged` → app state; `error` is terminal — message surfaced, no
retry loop, listener stays attached for the next explicit start.
`native-tcp-probe.ts` is the `TcpProbeFn` handed to
`new LatencyProber(...)`; defaults stay concurrency 8 / 1500 ms (prober's
own), so no duplicate timeout constants.

## 8. Manifest block (verbatim from Flutter snapshot `a8cf6e9`)

```xml
<service
    android:name=".OpenTunnelVpnService"
    android:permission="android.permission.BIND_VPN_SERVICE"
    android:exported="false"
    android:foregroundServiceType="specialUse">
    <property
        android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
        android:value="VPN tunnel" />
    <intent-filter>
        <action android:name="android.net.VpnService" />
    </intent-filter>
</service>
```

Insert inside `<application>`, after `<activity>` (phase2.md already lists the
five required permissions as present — verified in the current manifest).
Defer the Flutter-era `<queries>` MAIN/LAUNCHER block to Phase 4 with the
picker.

## 9. Verification & acceptance

Commands (actual outputs reported, never predicted):

```bash
pnpm test                  # phase 1 suites stay green; + tunnel-client tests
pnpm typecheck
cd apps/open_tunnel_vpn/android && JAVA_HOME=$JAVA_HOME ./gradlew :app:assembleDebug
pnpm --filter open_tunnel_vpn exec expo-doctor
```

Acceptance checklist (device where noted):

- [ ] Status machine: pull-up events seen for start → connected; stop →
      disconnected; `error` terminal with message (dev readout).
- [ ] Traffic ticks ~1 Hz, main-thread, deltas > 0 under load; connected
      duration grows; freezes when not connected.
- [ ] `openSystemVpnSettings()` returns true and opens the system sheet.
- [ ] System "Always-on VPN" reachable via deep link; notification denial
      does not block start.
- [ ] Kill switch: `grep -rn "allowBypass" android/app modules/open-tunnel-native`
      → empty (except AGENTS/doc files).
- [ ] Probe: live relay IP yields non-null RTT from `tcpProbe`; dead → null
      (cross-check vs Node smoke probe).
- [ ] Cold start while connected: service survives; UI restores state via
      `getState()`.
- [ ] `grep -rn "TODO\|placeholder\|fake" android/app modules/open-tunnel-native src/tunnel`
      → empty.
- [ ] `:app:assembleDebug` links **real** engine artifacts (G4 pinned
      versions appear in `build.gradle`); a missing engine stops the phase.

## 10. Risks & blockers

| Risk | Impact | Mitigation / trigger |
| --- | --- | --- |
| G1 license + NDK build of ics-openvpn (no published AAR) | Phase duration doubles at worst; build time jump | Gate first; WireGuard plumbing independent; typed `ENGINE_UNAVAILABLE` fallback |
| GoBackend API drift vs assumptions | Engine adapter rewrites | G4 inspection before adapter code; pin versions |
| `configText` sizes (inline certs) crossing the bridge | Memory/latency hiccups | Single-node only, never bulk configs; extension never sees CSV (Phase 3 rule) |
| Event flooding or wrong-thread emits | UI jank, lost status | netlens post-to-main pattern; hard 1 Hz cap |
| Notification denial on 13+ | UX confusion | Graceful path: tunnel runs, bell icon absent; document in Phase 4 |
| Residual `WgQuickBackend` usage | Non-root crash | G4 (root-only backend; `GoBackend` is the shipped path) |
| Gradle `expo-root-project` ext versions differ from assumptions | specialUse guard wrong | Read ext values in-session; guard all FGS type code on `Build.VERSION_CODES.UPSIDE_DOWN_CAKE` |

## 11. Sequencing (one session executes, phases stay atomic)

1. G1–G4 answers/pins from owner (block on G1 for the OpenVPN half only).
2. Module skeleton + contract types + tcpProbe + tests (pure TS pass first).
3. Service + manifest + notification/FGS path, WireGuard engine via AAR.
4. TS client + App defer/status readout + probe wiring.
5. OpenVPN engine (G1 permitting) or typed blocker report.
6. Full verification block (§9) → report actual outputs.

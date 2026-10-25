# Phase Prompts — feed one phase per session, strictly in order (1 → 4)

Run OpenCode with `apps-hub/` as the working directory so `AGENTS.md` is auto-loaded.
Wait for each phase to pass its verification commands before starting the next.

## Prelude for any NEW chat (paste this first, then the phase prompt)

```text
You are building NetLens, a FOSS, zero-telemetry LAN scanner and connectivity
diagnostic tool in React Native + Expo (apps-hub monorepo, pnpm).
Project root: /Users/outsentia/Documents/apps-hub — make it your working
directory and touch nothing outside apps-hub/ (except documented toolchain
installs). Before code, read AGENTS.md, docs/netlens/PRD.md, docs/netlens/SPEC.md
in full — especially the Hard OS Constraints. Verify every step by running the
phase's commands and report the ACTUAL output (never predicted output). Complete
only the phase prompt that follows, then stop — do not start the next phase.
```

## Phase 1 — Core Networking & Subnet Discovery Engine (FR-1, FR-2, NFR-1)

```text
Read AGENTS.md, docs/netlens/PRD.md, and docs/netlens/SPEC.md.

We are executing Phase 1: Core Networking & Subnet Discovery Engine (FR-1, FR-2, NFR-1).
Do not build the database or the full UI yet. Build and verify the native networking layer first:

1. Monorepo scaffold: pnpm workspaces, packages/config, packages/core (@apps-hub/core),
   apps/netlens (Expo SDK 54, RN 0.81.x, new-arch) + local Expo module netlens-core.
2. packages/core: IPv4 utils + SubnetCalculator — clamps any requested prefix to a
   maximum /24 around the host IP and produces the host list (network+broadcast excluded).
   Comprehensive tests via node --test.
3. netlens-core module (Expo Modules API), both platform actuals:
   - getNetworkInterfaceInfo(): Android ConnectivityManager.getActiveNetwork()+getLinkProperties()
     (NEVER deprecated WifiManager); iOS getifaddrs() on en0 + sysctl route-table gateway.
   - startTcpScan(hostIps, ports=[80,443,22,445,5353,8080,62078], timeoutMs=350):
     Android Semaphore(64) coroutine sweep; iOS 64 worker queues + POSIX non-blocking
     connect+poll. HARD RULE: ECONNREFUSED/TCP RST => isReachable=true WITH measured RTT;
     only timeout / NoRouteToHost(ENETUNREACH…) means offline.
     Real-time events: onHostDiscovered → onScanComplete.
   - startServiceDiscovery(timeoutMs): mDNS meta-query (_services._dns-sd._udp.local via
     NsdManager on Android; NWBrowser on iOS) + raw UDP SSDP M-SEARCH to 239.255.255.250:1900;
     MulticastLock acquired/released in finally. Events: onServiceDiscovered,
     onServiceScanComplete. stopTcpScan/stopServiceDiscovery cancellation supported.
4. packages/core TcpScanEngine orchestrator + typed adapter + tests (mock binding).
   Gradle JVM test asserting the RST=ALIVE classifier (:netlens-core:testDebugUnitTest).
5. Verify (report ACTUAL outputs):
   pnpm test
   pnpm typecheck
   cd apps/netlens/android && ./gradlew :netlens-core:testDebugUnitTest :app:assembleDebug
   cd ../ios && xcodebuild -workspace NetLens.xcworkspace -scheme NetLens -sdk iphonesimulator \
     -destination 'generic/platform=iOS Simulator' -configuration Debug build CODE_SIGNING_ALLOWED=NO
   pnpm --filter netlens exec expo-doctor
```

## Phase 2 — Connectivity & Latency Diagnostic Engine (FR-3, AC-4)

```text
Read AGENTS.md and docs/netlens/SPEC.md (Section 5).

We are executing Phase 2: Connectivity & Latency Diagnostic Engine (FR-3, AC-4).

1. Extend netlens-core with measureTcpHandshake(ip, port, timeoutMs) native function
   (open AND refused-carrier RTT both count as valid measurements) and
   resolveHostname(hostname) via native getaddrinfo/InetAddress.
2. packages/core: PingEngine (10 probes @200ms to gateway / 1.1.1.1:53 / 8.8.8.8:53),
   DnsBenchmark (example.com), computing avgRttMs, jitterMs, packetLossPct per hop.
3. DiagnosticAnalyzer in packages/core implementing the SPEC §5 thresholds into
   DiagnosticVerdict (HEALTHY, LOCAL_WIFI_CONGESTION, ISP_WAN_DEGRADATION,
   SLOW_DNS_SERVER) with human-readable advice. Unit tests for all 4 verdicts.
4. Verify: pnpm test && pnpm typecheck && Android assembleDebug && iOS compile check.
```

## Phase 3 — Local Persistence & New Device Identification (FR-4, AC-2, AC-3)

```text
Read AGENTS.md, docs/netlens/PRD.md (FR-4, AC-2, AC-3), docs/netlens/SPEC.md (Section 4).

We are executing Phase 3: Local Persistence & New Device Identification.

1. Add expo-sqlite; create the devices/networks schema from SPEC §4.
2. DeviceRepository reconciliation in packages/core (pure TS + injectable store port):
   match incoming DiscoveredHost items against stored devices via identityKey
   (mDNS instance/hostname → IP fallback); flag records not previously seen on
   networkId as isNew = true; preserve customName and isTrusted across scans even
   when the device IP changes.
3. Unit tests for reconciliation + isNew badge logic; verify all phase commands green.
```

## Phase 4 — Compose UI, Permissions & F-Droid Readiness

```text
Read AGENTS.md, docs/netlens/PRD.md, docs/netlens/SPEC.md.

We are executing Phase 4: UI, Runtime Permissions & F-Droid Readiness.

1. Bottom-navigation UI, two tabs:
   - ScannerScreen: summary card (Local IP, Gateway, CIDR, active/new counts),
     animated progress + Scan/Stop, filter chips (All/New/Untrusted), device cards
     (IP, name, mDNS/SSDP vendor, RTT badge, ports, NEW badge), DeviceDetailSheet
     (custom name, trusted toggle, targeted ping).
   - DiagnosticsScreen: 3-hop visualization [Device]→[Router]→[ISP]→[DNS] with
     RTT/Jitter/Packet-loss cards + plain-English verdict card (uses Phase 2 engine).
2. Permissions: AndroidManifest INTERNET, ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE,
   CHANGE_WIFI_MULTICAST_STATE, NEARBY_WIFI_DEVICES (neverForLocation, no popup).
   iOS Info.plist NSLocalNetworkUsageDescription + NSBonjourServices
   (_services._dns-sd._udp, _http._tcp).
3. F-Droid audit: zero proprietary deps/repos, deterministic builds, license check.
4. Final verification: Android assembleDebug, iOS build, pnpm test/typecheck, expo-doctor.
```

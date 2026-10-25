# Phase Prompts — feed to OpenCode one phase at a time

Run OpenCode with `netlens/` as the working directory so AGENTS.md is auto-loaded. Execute phases strictly in order (1 → 4) and wait for each phase to pass `./gradlew :composeApp:testDebugUnitTest` before starting the next.

## Prelude for any NEW chat (paste this first, then the phase prompt)

```text
You are building NetLens, a FOSS, zero-telemetry LAN scanner and connectivity
diagnostic tool (Kotlin Multiplatform + Compose Multiplatform, Android first).
Project root: /Users/outsentia/Documents/netlens — make it your working directory
and touch nothing outside netlens/. Before any code, read AGENTS.md, docs/PRD.md,
and docs/SPEC.md in full and obey them — especially the Hard Architectural & OS
Constraints in AGENTS.md. Verify each step with the phase's required Gradle
commands and report the ACTUAL command output (never predicted output). Complete
only the phase prompt that follows this prelude, then stop — do not start the
next phase.
```

## Phase 1 — Core Networking & Subnet Discovery Engine (FR-1, FR-2, NFR-1)

```text
Read `AGENTS.md`, `docs/PRD.md`, and `docs/SPEC.md`.

We are executing Phase 1: Core Networking & Subnet Discovery Engine (FR-1, FR-2, NFR-1).
Do not build the database or full UI yet. Build and verify the native networking layer first:

1. Set up the KMP project structure (`commonMain`, `androidMain`, `iosMain`) with
   dependencies for Coroutines, Serialization, and Compose Multiplatform.
2. Implement `SubnetCalculator` in `commonMain` that takes an IPv4 address and CIDR
   prefix length (clamped to maximum `/24` around the host IP to prevent `/16` scan
   stalls) and generates the sequence of target IPv4 addresses. Write comprehensive
   unit tests for `SubnetCalculator`.
3. Create the `expect/actual` `NetworkInterfaceProvider` that retrieves `localIp`,
   `cidrPrefix`, and `gatewayIp`:
   - `androidMain`: Use `ConnectivityManager.getActiveNetwork()` and `getLinkProperties()`.
   - `iosMain`: Use POSIX `getifaddrs()` on `en0`.
4. Implement `TcpProbeScanner` and `SsdpMdnsDiscovery`:
   - Sweep all IPs in the subnet using `Semaphore(64)`.
   - Remember our hard rule: `ConnectException` (connection refused) on TCP ports
     `[80, 443, 22, 445, 5353, 8080, 62078]` MUST be treated as `isReachable = true`
     with measured RTT!
   - Emit discovered hosts via `Flow<DiscoveredHost>` in real time as they respond.
5. Run `./gradlew :composeApp:testDebugUnitTest` and verify all unit tests pass.
```

## Phase 2 — Connectivity & Latency Diagnostic Engine (FR-3, AC-4)

```text
Read `AGENTS.md` and `docs/SPEC.md` (Section 5).

We are executing Phase 2: Connectivity & Latency Diagnostic Engine (FR-3, AC-4).

1. Implement `PingEngine` and `DnsBenchmark` in `commonMain/data/diagnostics/`:
   - Measure TCP handshake RTT (`Socket.connect` time to port 80/443/53, where both
     connected and `ConnectException` count as valid RTT measurements) across 10
     probes to:
     a) Default Gateway IP (Local Wi-Fi Hop)
     b) `1.1.1.1:53` and `8.8.8.8:53` (WAN / ISP Hop)
   - Measure DNS resolution latency for `example.com` using native
     `InetAddress.getAllByName`.
2. Compute `avgRttMs`, `jitterMs`, and `packetLossPct` for each hop.
3. Implement `DiagnosticAnalyzer` that evaluates the metrics against the thresholds
   in `docs/SPEC.md` Section 5 and outputs a structured `DiagnosticVerdict`
   (`HEALTHY`, `LOCAL_WIFI_CONGESTION`, `ISP_WAN_DEGRADATION`, `SLOW_DNS_SERVER`)
   with human-readable troubleshooting advice.
4. Write unit tests for `DiagnosticAnalyzer` covering all 4 verdict states and run
   `./gradlew :composeApp:testDebugUnitTest`.
```

## Phase 3 — Local Persistence & New Device Identification (FR-4, AC-2, AC-3)

```text
Read `AGENTS.md`, `docs/PRD.md` (FR-4, AC-2, AC-3), and `docs/SPEC.md` (Section 4).

We are executing Phase 3: Local Persistence & New Device Identification.

1. Configure Room KMP (`androidx.room`) with `BundledSQLiteDriver`.
2. Implement `NetworkEntity`, `DeviceEntity`, and `NetLensDao`.
3. Implement `DeviceRepository` reconciliation logic:
   - When a scan runs on a `networkId`, match incoming `DiscoveredHost` items against
     stored `DeviceEntity` records using `identityKey` (prioritizing mDNS instance
     name / hostname, falling back to IP address).
   - Flag any device not previously seen on an existing `networkId` with
     `isNew = true` in the domain model.
   - Preserve user-assigned `customName` and `isTrusted` flags across scans even if
     the device's IP changes.
4. Write unit tests verifying the reconciliation and `isNew` badge logic, and run
   `./gradlew :composeApp:testDebugUnitTest`.
```

## Phase 4 — Compose Multiplatform UI, Permissions & F-Droid Readiness

```text
Read `AGENTS.md`, `docs/PRD.md`, and `docs/SPEC.md`.

We are executing Phase 4: Compose Multiplatform UI, Runtime Permissions & F-Droid Readiness.

1. Build the bottom-navigation UI with two primary tabs:
   - **Tab 1: Network Scanner (`ScannerScreen`)**
     - Top summary card showing Local IP, Gateway IP, Subnet CIDR, Active Device
       Count, and New Device Count.
     - Animated progress bar during active scan + "Scan Now" / "Stop" button.
     - Filter chips: `All`, `New`, `Untrusted`.
     - Device list cards displaying IP, Custom Name / Hostname, mDNS/SSDP vendor
       info, RTT badge (ms), open ports, and a bright `"NEW"` badge for newly
       discovered devices.
     - Clicking a device opens `DeviceDetailSheet` to edit its Custom Name, toggle
       `Trusted`, or run a targeted continuous ping.
   - **Tab 2: Speed & Latency Diagnostics (`DiagnosticsScreen`)**
     - Visualizes the 3 hops: `[This Device] ---> [Wi-Fi Router] ---> [ISP / WAN] ---> [DNS]`.
     - Displays real-time RTT, Jitter, and Packet Loss cards per hop, plus the
       plain-English bottleneck verdict card.
2. Configure platform permissions:
   - Android (`AndroidManifest.xml`): Add `INTERNET`, `ACCESS_NETWORK_STATE`,
     `ACCESS_WIFI_STATE`, `CHANGE_WIFI_MULTICAST_STATE`, and `NEARBY_WIFI_DEVICES`
     (`usesPermissionFlags="neverForLocation"`). Ensure the scanner works
     immediately with zero runtime permission popups required!
   - iOS (`Info.plist`): Add `NSLocalNetworkUsageDescription` and
     `NSBonjourServices` (`_services._dns-sd._udp`, `_http._tcp`).
3. Audit `build.gradle.kts` to ensure 100% F-Droid compliance (no proprietary
   repositories or dependencies, disable non-deterministic dependency metadata
   blocks if needed).
4. Run `./gradlew :composeApp:assembleDebug` and `./gradlew :composeApp:testDebugUnitTest`
   and fix any build or lint issues.
```

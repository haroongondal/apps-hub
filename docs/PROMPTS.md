# Phase Prompts — paste into the OpenCode chat, one at a time

Run the agent inside the `netlens/` folder (AGENTS.md auto-loads). Wait for each phase to pass the Definition of Done in AGENTS.md §5 before starting the next.

## Phase 1 — Project scaffold

> Read AGENTS.md, docs/PRD.md and docs/SPEC.md first. Phase 1: create the Android project scaffold — settings.gradle.kts with an `:app` module, version catalog, Hilt + Compose + Room (KSP) dependencies, MainActivity with an empty 4-tab Compose navigation (Dashboard, Diagnose, History, Rules), a manifest declaring INTERNET / ACCESS_NETWORK_STATE / POST_NOTIFICATIONS / FOREGROUND_SERVICE plus the VpnService intent-filter, a placeholder NetVpnService, and tab-label string resources. Run `./gradlew assembleDebug` and `./gradlew testDebugUnitTest` and report the actual output. Done = both green.

## Phase 2 — VpnService + Room (FR-1 and FR-3 data layer)

> Phase 2: implement SPEC §3 (3.1–3.5) and §4. NetVpnService with consent flow, establish(), a single-threaded read loop, the IPv4 header parser (5-tuple + counters, payload dropped), NAT table, UDP relay, TCP relay state machine, and the DNS interceptor feeding DnsMap. Room DB v1 with all six entities from SPEC §4, repositories, and the 14-day RetentionWorker. Unit tests for PacketParser and the TCP relay state machine using captured-header fixtures, plus a DAO test. Run `./gradlew assembleDebug && ./gradlew testDebugUnitTest` and report results.

## Phase 3 — Diagnostic Engine (FR-2)

> Phase 3: implement SPEC §5 and the VpnController bridge. Probes (DNS compare, TCP-connect latency, HTTPS generate_204, captive portal, best-effort ICMP), serial executor with timeouts and 1-second cancellation, scoring and summary text per SPEC, persistence of runs and probe rows. Wire the Diagnose tab: run button, progress, per-probe result cards, score ring. Probe unit tests with fake sockets. Run `./gradlew assembleDebug && ./gradlew testDebugUnitTest` and report results.

## Phase 4 — History, Rules and Export (FR-3 UI, FR-4) and polish

> Phase 4: build the History aggregates and charts, the Rules editor with wildcard validation, matcher, and local notifications on match, plus session export to JSON/CSV via the share sheet. Add per-app filter and IP/host search to the Dashboard, wire the RetentionWorker, and get lint clean. Add the instrumented smoke test if an emulator is available. Run `./gradlew lintDebug` and the full test suite, update docs/IMPLEMENTATION.md, and report.

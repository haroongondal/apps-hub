# Product Requirements Document — NetLens

Version 1.0 · Status: ready for implementation · Platform: Android 8.0+ (minSdk 26)

## 1. Summary

NetLens is a privacy-first network lens for Android. One toggle opens a local, on-device tunnel that shows every app's live connections (metadata only), a Diagnose tab answers "why is my internet slow?", and History keeps searchable per-app usage of what happened.

## 2. Goals and Non-Goals

| ID | Statement |
| --- | --- |
| G-1 | Live, per-app visibility of outgoing connections (metadata only). |
| G-2 | One-tap answer to "is it the phone, the DNS, or the ISP?". |
| G-3 | Useful, searchable history and per-app usage statistics. |
| G-4 | Privacy: metadata only, stored locally, never leaves the device without an explicit export. |

Non-goals for v1:

| ID | Statement |
| --- | --- |
| NG-1 | No payload, TLS, or content inspection of other apps' traffic. |
| NG-2 | No accounts, no cloud sync, no analytics telemetry. |
| NG-3 | No blocking / firewall features (observation only in v1). |
| NG-4 | No iOS, desktop, or tablet-optimized layout. |

## 3. Users and Jobs

- Power user / privacy-curious — "which app is phoning home?": FR-1, FR-4
- Person on flaky Wi-Fi — "why is everything failing?": FR-2
- Developer — "is my app leaking connections?": FR-1, FR-3

## 4. Features and Acceptance Criteria

AC IDs are the contract the implementation is verified against (also enforced in AGENTS.md §5, Definition of Done).

### FR-1 · Live Connection Monitor (P0, Dashboard screen)

A tunnel toggle plus a live list of active flows. Each row: app icon + name, protocol, remote host (DNS-mapped when known, else IP:port), running byte counters. Supports filter-by-app and search by IP/host. A persistent notification shows the live connection count while the tunnel is active.

| AC | Criterion |
| --- | --- |
| AC-FR1-1 | A new TCP or UDP flow appears in the list ≤ 2 s after the app connects, while the tunnel is on. |
| AC-FR1-2 | Remote hostname is shown whenever the DNS interceptor observed the query in this session; otherwise the IP is shown. |
| AC-FR1-3 | Payload bytes are never copied beyond protocol header length — enforced by a unit test on the header parser. |
| AC-FR1-4 | The tunnel survives app backgrounding; toggle-off or system revoke closes the file descriptor and stops the foreground service cleanly. |
| AC-FR1-5 | NetLens's own traffic bypasses the tunnel (no feedback loop through itself). |

### FR-2 · One-Tap Diagnostics (P0, Diagnose screen)

"Quick diagnostics" runs a serial battery: DNS comparison (system resolver vs 1.1.1.1 / 8.8.8.8), TCP-connect latency to port 443 on 3 well-known endpoints, HTTPS reachability (HTTP 204 check endpoints), and captive-portal detection. Produces a 0–100 score plus PASS / WARN / FAIL per probe with a human-readable detail string.

| AC | Criterion |
| --- | --- |
| AC-FR2-1 | A full run completes in ≤ 30 s on healthy Wi-Fi. |
| AC-FR2-2 | Runs correctly with the tunnel ON and OFF (all probe sockets bypass the tunnel). |
| AC-FR2-3 | In airplane mode, every probe fast-fails with a clear message; no crash, no hanging run. |
| AC-FR2-4 | Every run is persisted and viewable from History. |

### FR-3 · History and Usage Statistics (P0, History screen)

7 / 30-day per-app aggregates (bytes up/down, connection counts), charts, and an event history with filters. A retention worker keeps raw event data bounded while aggregates persist.

| AC | Criterion |
| --- | --- |
| AC-FR3-1 | Aggregate error is within ±5% of the raw counters, verified by a unit test over seeded data. |
| AC-FR3-2 | A 30-day history query loads in < 500 ms on a 2020-class device. |
| AC-FR3-3 | Retention deletes raw events older than 14 days while usage aggregates persist (worker unit test). |
| AC-FR3-4 | Every released DB version has a green migration test before release. |

### FR-4 · Rules, Alerts, and Export (P1, Rules screen)

User-defined rules over app and/or domain pattern (e.g. `*.doubleclick.net`). A matching new connection raises a local notification. Any recorded session can be exported to JSON or CSV through the share sheet.

| AC | Criterion |
| --- | --- |
| AC-FR4-1 | A matching connection triggers a notification ≤ 5 s after connect. |
| AC-FR4-2 | The rule editor validates wildcard syntax and rejects duplicate rules. |
| AC-FR4-3 | Exports carry `schemaVersion` and all session events; nothing is transmitted over the network (share sheet only). |

## 5. UX Requirements

- Jetpack Compose, Material 3, dynamic color, light and dark themes.
- Four bottom tabs: Dashboard, Diagnose, History, Rules.
- Explicit states for: first-run VPN consent, tunnel active chip, empty states, and errors.

## 6. Privacy Statement

Metadata only. Packet payloads are never read beyond protocol headers. All storage is local Room; the only egress is a user-initiated export. Data Safety declaration: no data collected off device. No telemetry in v1.

## 7. Release Criteria (v1.0)

1. All P0 ACs green on an emulator plus at least one physical device.
2. `assembleRelease` builds without warnings-as-errors violations.
3. Lint: zero errors.
4. Tunnel survives Doze for ≥ 15 minutes with periodic background traffic.

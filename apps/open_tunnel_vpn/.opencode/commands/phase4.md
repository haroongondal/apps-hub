---
description: Phase 4 — Privacy-first Flutter UI, filtering, and egress verification
---

Read `AGENTS.md`. Build the presentation layer on top of the existing Riverpod
controllers and Pigeon bridge. Do not duplicate native state in widgets.

## 1. Theme and shell

Create the dark slate theme exactly: background `#0B0F19`, connected accent
`#10B981`, connecting pulse `#F59E0B`, high-contrast text, and a restrained
surface (`#111827`). Add a single `MaterialApp` entry point. No analytics, no
third-party fonts fetched at runtime.

## 2. `lib/features/vpn_tunnel/presentation/home_screen.dart`

- Central interactive Connection Shield: tap connects to the selected node or
  auto-selected fastest; tap again disconnects. Show all six `VpnStatusState`
  values distinctly, with an error message surface.
- Real-time upload/download throughput graph from `onTrafficUpdate` (keep a
  bounded 60-sample ring buffer; dispose the timer).
- Current public IP badge (fetched on demand, cached only in memory).
- "Auto-Select Fastest" toggle; when on, run the probe + fitness ranking and
  connect to the winner. Do not block the UI thread.
- Show connected duration and active node country; never show a fake "connected"
  state before the native callback confirms it.

## 3. `lib/features/vpn_tunnel/presentation/server_list_sheet.dart`

- Filterable modal bottom sheet grouped by country with flag emoji/ISO code.
- Ping badge: green < 80 ms, amber < 180 ms, red otherwise; display `—` when
  unprobed rather than 0.
- Show Mbps capacity and active sessions.
- Sort: Fastest Score (default), Lowest Latency, Highest Throughput, Highest
  Uptime. Sorting happens on immutable copies; the selected node survives
  filtering.
- Empty, loading, and fetch-error states with retry.

## 4. `lib/features/vpn_tunnel/presentation/privacy_guard_screen.dart`

- DNS provider toggle: Cloudflare `1.1.1.1` vs Quad9 `9.9.9.9` (and
  `149.112.112.112`).
- IPv6 leak block toggle, disabled with an explanation when the connected node
  cannot carry IPv6.
- Kill switch toggle. On Android, show an inline banner explaining that the app
  cannot flip "Block connections without VPN" itself, plus a one-tap deep link
  via `VpnHostApi.openSystemVpnSettings()`. On iOS, state that On-Demand is
  active and that the OS has no user-facing toggle.
- "Run Leak Test": query `https://1.1.1.1/cdn-cgi/trace` through the active
  tunnel, parse `ip=`, `loc=`, and `warp=`, compare the exit IP/country to the
  selected node, and show the result with timestamps. Label it accurately as an
  egress + resolver-path check; a true DNS-leak audit needs a canary domain and
  must not be faked client-side.
- Never persist leak-test results or IP history.

## 5. Verification

- `flutter analyze` clean; `flutter test` green with widget tests for the three
  state transitions (disconnected → connecting → connected/error) and the ping
  badge thresholds.
- Run on an iOS simulator or Android emulator if available and report exactly
  what was verified; otherwise state that UI rendering was not device-verified.

---
description: Phase 4 — Privacy-first React Native UI, filtering, and egress verification
---

Read `AGENTS.md`. Build the presentation layer on top of the migrated data
layer and the native tunnel state; do not duplicate native state in
components.

## 1. Theme and shell

Dark slate theme: background `#0B0F19`, connected accent `#10B981`,
connecting pulse `#F59E0B`, high-contrast text, restrained surface
(`#111827`). Single `App.tsx` entry (already present) — keep navigation
light (e.g. `@react-navigation/native` + bottom sheet) only if it is
warranted; the pipeline is four screens at most. No analytics, no
third-party fonts fetched at runtime.

## 2. Home screen

- Central interactive Connection Shield: tap connects to the selected node
  or auto-selected fastest; tap again disconnects. Show all six
  `VpnStatusState` values distinctly, with an error message surface; drive
  state exclusively from the native module's events.
- Real-time upload/download throughput from `onTrafficUpdate` (bounded
  60-sample ring buffer; clear timers/taksk on unmount).
- Current public IP badge (fetched on demand, cached only in memory).
- "Auto-Select Fastest" toggle; when on, run the native probe +
  `computeFitnessScore` ranking and connect to the winner. Do not block the
  JS thread: probing is bounded-concurrency native work (`TcpProbeFn`).
- Show connected duration and active node country; never render a fake
  "connected" state before the native callback confirms it.

## 3. Server list sheet

- Filterable modal grouped by country with flag emoji/ISO code.
- Each row: `nodeLabel`, ping/RTT, speed, sessions, upstream score, and the
  `measuredRttMs` once probed; sorting by fitness uses the cached
  `fitnessScore` from `loadNodes` minus heavy recomputation.
- List reads must stay configless (`loadNodes()` without `withConfig`); the
  sanitized payload is fetched by node id only when the user connects.

## 4. Settings and privacy surfaces

- Kill-switch toggle → deep link to Android system VPN settings via
  `openSystemVpnSettings`, and in-app packet blocking from the engine. On
  iOS, on-demand connect rules.
- Disallowed apps picker (Android) on demand — do not over-build.
- "My data lives only on this phone" disclosure copy: no accounts, no
  analytics, cache dies with the app.
- Remember the threat-model copy: free relays are not anonymous; VPN Gate
  operator terms apply.

## 5. Verification

- `pnpm test`, `pnpm typecheck` green.
- Android build + install guide OK on a device; iOS follows
  `docs/ios-network-extension.md` limits (Allocations profiling on real
  hardware).
- Egress verification: with the tunnel connected, an external IP echo
  `curl` from the device resolves to the relay's IP, not the device's.
- Phase gate: no fake states, no `TODO` markers, all four phases green.

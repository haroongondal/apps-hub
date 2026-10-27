---
description: Phase 4 — Privacy-first React Native UI on @apps-hub/ui, connect flow, Android egress verification
---

Read `AGENTS.md`. Drive every screen from `createTunnelClient` snapshots and
the module's events — never duplicate native state in components, never
render a state the native side has not reported.

## Prerequisite

Author `docs/phase4-plan.md` first — decision map, gates, fallbacks, and the
§7 verification checklist, same shape as `docs/phase3-plan.md` — and read
`docs/phase2-session-log.md` + `docs/phase3-session-log.md` for the standing
decisions. Record owner answers there; when an owner answer is "don't know",
the plan's documented fallback governs and is reported as such.

Machine state (2026-10-27, phase 3 committed `b71fd79`):

- Binding is real on BOTH mobile platforms (`createOpenTunnelBinding`);
  where the module is absent it degrades typed, naming the missing iOS
  module — never silently.
- Android engines are REAL: WireGuard (GoBackend) and OpenVPN 2 (GPLv2
  carry-in, commit `a03ebb0`). A device connect works end-to-end; egress
  verification therefore runs on Android.
- iOS module pod is real (NEVPNManager save/reload/start flow + shared
  App-Group contract), but BOTH iOS engines remain typed
  `ERR_ENGINE_UNAVAILABLE` (G1 OpenVPN license carry-in; G2 wireguard-go
  bridge needs an external Go build, no toolchain). The iOS UI surfaces
  those message strings verbatim; a connected state on iOS is impossible
  this phase, and the phase's egress check is Android-only.
- `App.tsx` already carries the phase-2 readout: cache-first refresh,
  bounded display-ranking probes, top-node connect. Phase 4 reshapes it
  into the real UI on top of it.

## 1. Shell rules

- Build ONLY on `@apps-hub/ui` components (`ThemeProvider brand="opentunnel"`
  — hue 158, accent `#34D399` dark), using `Screen`, `Header`, `Group`/
  `Row`, `Button`, `Field`, `Segmented`, `Readout`, `Notice`, `Sheet`.
  No new UI dependency (navigation, sheet library) unless the plan doc
  records why and the fallback governs.
- Copy is sentence case, active voice; no emoji icons, no ALL-CAPS labels;
  country display uses ISO codes, not flag emoji.

## 2. Home screen

- Connection shield: tap connects the selected node (or auto-selected
  fastest), tap again disconnects. All six `VpnStatusState` values render
  distinctly; the error message surface quotes the snapshot message. The
  state machine terminates in `error` — retry happens only via an explicit
  new start, all rebuilt on `createTunnelClient` (`subscribe`, `refresh`,
  `startTunnel`, `stopTunnel`).
- Throughput reads `onTrafficUpdate` deltas (the native ticker is the only
  cadence source; UI keeps a ~60-sample ring buffer and clears
  timers/subscriptions on unmount). Show connected duration and the active
  node's country.
- "Auto-select fastest" runs the bounded native probe (`nativeTcpProbe`,
  concurrency 8) + `computeFitnessScore`, then connects to the winner —
  never on the JS thread.
- Public IP badge: fetched on demand, cached in memory only, shown as a
  readout; it never drives state.

## 3. Server list sheet

- Filterable modal, grouped by country: each row shows node label, RTT
  (static ping until probed, `measuredRttMs` once measured), speed,
  sessions, upstream score, cached `fitnessScore`.
- List reads stay configless (`loadNodes()`); the sanitized payload is
  re-fetched by node id only at connect time (`configFromNode(node,
  { enableKillSwitch, disallowedApps })` then `startTunnel`).

## 4. Settings and disclosures

- Kill-switch toggle: deep link to system VPN settings via
  `openSystemVpnSettings()` plus the in-app packet blocking already owned
  by the engine. On iOS reflect the module's on-demand CONNECT posture;
  the Android-only packet-bypass API is never referenced anywhere.
- Disallowed-apps picker on Android only — do not over-build.
- Fixed disclosure copy: "My data lives only on this phone" (no accounts,
  no analytics, cache dies with the app) and the threat-model truth that
  free relays are not anonymous and VPN Gate operator terms apply.

## 5. Engineering rules

- After every file modification run `pnpm test`, then `pnpm typecheck`;
  report ACTUAL outputs.
- No fake states, no `TODO`/placeholder/fake/mock markers (the phase
  marker gate greps new source and must return empty), no invented
  engines — typed errors surface verbatim to the user.
- Adding a workspace dependency is a new gate: record the candidate, its
  license, and the owner fallback in the plan doc before installing;
  `pnpm-lock.yaml` changes require the same record.
- Report graft usage per turn (tokens saved + value).

## 6. Verification & acceptance (report ACTUAL outputs)

- `pnpm test` / `pnpm typecheck` green.
- Android: build + install on a real device; with the tunnel connected,
  an external-IP echo resolves to the relay's address, not the device's;
  disconnect restores it.
- iOS simulator: start attempts surface the typed `ERR_ENGINE_UNAVAILABLE`
  strings in the UI (device work stays blocked until `DEVELOPMENT_TEAM`
  is attached, owner-only).
- Expo doctor clean for the app; docs updated (phase-4 session log).
- Phase gate: no fake states, `pnpm doctor` passes, phase gate greps clean.

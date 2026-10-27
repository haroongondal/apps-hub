# Phase 4 Plan — Privacy-first React Native UI on `@apps-hub/ui`, connect flow, Android egress proof

Companion to `.opencode/commands/phase4.md`. Baseline: commit `e493af9`
(phase-3 record: `docs/phase3-session-log.md`; phase-2 record:
`docs/phase2-session-log.md`). One session executes this phase; phases stay
atomic.

## 1. Objective & scope

Reshape the phase-2 dev readout (`App.tsx`) into the real app UI, driven
entirely by `createTunnelClient` snapshots and the module's events, then prove
egress on Android. The UI renders exactly what the native side reports — no
duplicated state, no optimistic states, no state the native side has not
reported.

In scope:

- Home screen: connection shield (tap = connect/disconnect), all six
  `VpnStatusState` values rendered distinctly, throughput from
  `onTrafficUpdate` deltas into a ~60-sample ring buffer, connected duration,
  active node country, bounded auto-select-fastest, on-demand public IP
  badge (memory-only cache).
- Server list sheet: filterable, grouped by country (ISO codes), configless
  reads; the sanitized payload is re-fetched by node id only at connect time.
- Settings sheet: kill-switch preference (deep link to system VPN settings +
  engine-owned packet blocking), disallowed-apps picker (Android only),
  fixed privacy/threat-model disclosures.
- Data: `getNode(id)` on the node cache (config re-fetch by primary key);
  a settings store persisted in the same local sqlite DB.
- Copy per repo rules: sentence case, active voice, no emoji icons, no
  ALL-CAPS labels, ISO country codes.

Out of scope: native engine work (phase 2/3 is final), iOS engine
implementation (G1/G2 carry-in blockers), VPN Gate CSV handling changes,
new UI dependencies.

## 2. Rules carried into every task

- **Single state authority:** the tunnel client (`subscribe`, `refresh`,
  `startTunnel`, `stopTunnel`) is the only tunnel-state source; native
  `onStatusChanged` / `onTrafficUpdate` events own cadence. UI state that is
  not native state (sheet visibility, filter text, node selection, public IP
  value, ring buffer) is presentation-only and never drives tunnel state.
- **`error` is terminal** (phase-2 semantics): retry happens only via an
  explicit new start — the shield tap / server-row tap is that explicit
  start, rebuilt through `startTunnel` on the same client.
- **The Android-only packet-bypass API is never referenced** anywhere in
  source (grep-gated as before); the kill switch is engine-owned packet
  blocking plus the system deep link. On iOS the preference maps to the
  module's on-demand CONNECT posture.
- **Privacy by construction:** no accounts, analytics, or remote logging;
  settings persist only in the local app database (dies with the app);
  the public IP value lives in memory only and is fetched strictly on
  demand. Never log keys, certs, or configs.
- **No placeholders** — typed failures surface verbatim; the marker gate
  greps new source and must return empty.
- After every file modification: `pnpm test`, then `pnpm typecheck`
  (report ACTUAL outputs).

## 3. Gates before code (owner decisions, fallbacks govern on "don't know")

| Gate | Question | Fallback (governs on "don't know") |
| --- | --- | --- |
| G1 — new workspace dependencies | Phase 4 adds none: navigation is not needed (single Screen + the kit's `Sheet` modals), public IP uses the built-in `fetch`, settings use the existing `expo-sqlite` driver. | If one becomes truly necessary, record candidate · version · license · why · scripts in this doc **before** installing; `pnpm-lock.yaml` churn gets the same record. |
| G2 — disallowed-apps picker scope | Manual package-name entry (zero native additions, zero new manifest permissions) vs. launchable-apps enumeration (a Kotlin `listLaunchableApps` + scoped `<queries>` manifest block). | Manual package-name entry — the command's "do not over-build" rule, and no new privacy-sensitive capability. |
| G3 — public IP echo endpoint | `https://checkip.amazonaws.com` (plain-text IP, neutral infrastructure, no third-party tracking domain) vs. `api.ipify.org`. | `checkip.amazonaws.com`; fetched only on user tap with a bounded timeout; response shown as-is and never parsed into tunnel state. |
| G4 — settings persistence | Same local sqlite database via a new `app_settings` key-value table (no new dependency, same dies-with-the-app posture) vs. AsyncStorage (new dependency → G1 record). | The sqlite `app_settings` table (`src/data/settings-store.ts`, real-Node-sqlite tests like the cache suite). |
| G5 — Android verification surface | The phase acceptance says "real device"; this machine has an attached **emulator** (`emulator-5554`), no physical phone. | Run the full connect + egress proof on the attached emulator and record the surface deviation honestly; a physical-device pass remains owner work. |

Owner answers recorded in §10 below (asked up front, same convention as
phases 2–3).

## 4. Home screen

- **Shield:** a tap target rendered inside `Group title="Connection"` —
  large status dot + state title + subtitle, built from kit primitives
  (`Text`, `Dot`); tap connects the selected node (or runs auto-select and
  connects the winner) / tap again disconnects. Shield tap = the explicit
  start out of `error` (terminal-state rule preserved by the client).
- **Six-state rendering:** `disconnected` (neutral, "Tap to connect"),
  `connecting` (warn, names the node), `connected` (ok, node country +
  duration), `disconnecting` (warn), `reasserting` (warn, "Reconnecting"),
  `error` (danger, message quoted in a `Notice tone="danger"` — verbatim
  snapshot message, the `ERR_*: ` prefix kept on the surface per "surface
  verbatim"; no paraphrase).
- **Throughput:** one `client.subscribe` listener feeds both the snapshot
  state and the ring buffer (~60 samples, newest first) of
  `onTrafficUpdate` deltas; display shows the latest tick plus a smoothed
  recent-average, drawn as a compact bar strip of theme-token-colored
  `View`s (no new chart dependency). Timers/subscriptions are cleared on
  unmount; no JS-side cadence is introduced.
- **Auto-select fastest:** cached nodes (configless load, bounded list) →
  `LatencyProber.probeAndScoreNodes(candidates, { concurrency: 8 })` over
  `nativeTcpProbe` → winner by `fitnessScore` → config re-fetch by id →
  `startTunnel`. The probe runs off the JS thread (native module); the
  scanning indicator is presentation-only and never claims a tunnel state.
- **Public IP badge:** `Readout` + on-demand fetch (G3), in-memory cache,
  AbortController-bounded; on failure shows a typed one-line reason. It
  never participates in the tunnel state machine.

## 5. Server list sheet

- Kit `Sheet` modal: `Field` filter input (matches host name / country) +
  nodes grouped by `countryShort` (group titles are ISO codes with the long
  name, e.g. "JP · Japan" — never flag emoji).
- Row content: node label (`countryShort/hostName`), RTT — static
  `pingMs` until probed, `measuredRttMs` once measured — speed (Mbps),
  sessions, upstream `score`, cached `fitnessScore`.
- List reads stay configless (`loadNodes()`); on connect,
  `cache.getNode(id)` re-fetches the sanitized payload by node id, then
  `client.configFromNode(node, { enableKillSwitch, disallowedApps })` →
  `client.startTunnel(config)`.
- Connect is never issued while a start is in flight; switching relays
  while connected performs an explicit stop, then the new start — no
  double start.

## 6. Settings and disclosures

- **Kill switch:** kit `Segmented` (On/Off — the kit has no switch
  component; recorded here so the gate greps know why) persisted via the
  settings store; passed as `enableKillSwitch` at connect time. The row's
  detail: engine-owned in-app packet blocking + a "Always-on VPN settings"
  deep link (`openSystemVpnSettings()`). On iOS the same preference is the
  module's on-demand CONNECT posture.
- **Disallowed apps (Android only):** manual package-name entry (G2
  fallback) — a `Field` add + removable rows; persisted in the settings
  store; passed to `configFromNode` only on Android.
- **Fixed disclosure copy** (verbatim in UI):
  - "My data lives only on this phone. There are no accounts, no analytics,
    and the server cache dies with the app."
  - "Free volunteer relays are not anonymous. Relay operators can see the
    sites you visit, and VPN Gate operator terms apply."
- Deep-link row + GPLv2 source caption carried over from the phase-2 readout.

## 7. Verification & acceptance (report ACTUAL outputs)

```bash
# TS gates after every edit:
pnpm test && pnpm typecheck
# Phase marker gate (new source only; must be empty):
grep -rniE 'TODO|fake|mock' \
  apps/open_tunnel_vpn/App.tsx apps/open_tunnel_vpn/src/ui \
  apps/open_tunnel_vpn/src/data/settings-store.ts
grep -rni 'placeholder' \
  apps/open_tunnel_vpn/App.tsx apps/open_tunnel_vpn/src/ui \
  apps/open_tunnel_vpn/src/data/settings-store.ts \
  | grep -v 'placeholder="'
# (src/data SQL `?` parameter markers stay out of scope per the phase-2
#  convention — documented in the phase-2 session log. RN's TextInput prop
#  is named `placeholder`; the only permitted matches are that prop.)
# Bypass-API gate (must be empty over the app + module sources):
grep -rn 'allowBypass' apps/open_tunnel_vpn/App.tsx \
  apps/open_tunnel_vpn/src apps/open_tunnel_vpn/modules/open-tunnel-native/src
# Android build gate (install + egress echo deferred per G5 owner decision):
cd apps/open_tunnel_vpn/android && JAVA_HOME=$JAVA_HOME ./gradlew :app:assembleDebug
# physical-device session: install -r app/build/outputs/apk/debug/app-debug.apk, then
# connect → public IP echo == relay address; disconnect → restored
# iOS simulator (typed engine-unavailable proof):
cd apps/open_tunnel_vpn/ios && xcodebuild -workspace OpenTunnel.xcworkspace \
  -scheme OpenTunnel -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -configuration Debug build CODE_SIGNING_ALLOWED=NO
xcrun simctl install <UDID> <app> && xcrun simctl launch <UDID> com.opentunnel.openTunnelVpn
# Expo doctor:
pnpm --filter open_tunnel_vpn exec expo-doctor
```

Acceptance checklist:

- [ ] `pnpm test` / `pnpm typecheck` green (ACTUAL outputs reported)
- [ ] Marker gate greps clean over new source (node-cache SQL `?`
      placeholders stay out of scope per the phase-2 convention)
- [ ] Bypass-API grep clean
- [ ] Android: build gate (`:app:assembleDebug`) green; install + external-IP
      echo (relay address while connected, device address restored on
      disconnect) **deferred to a physical-device session per G5 owner
      decision — recorded as owner-blocked, not faked**
- [ ] iOS simulator: start attempts surface the verbatim
      `ERR_ENGINE_UNAVAILABLE` reason strings in the UI; no connected
      state is ever shown on iOS
- [ ] Public IP badge: on-demand only, memory cache only, never drives state
- [ ] All six `VpnStatusState` values render distinctly (verified in the
      TS tests where the contract is exercised)
- [ ] `expo-doctor` clean for the app (known phase-1 advisories, if any,
      re-verified and quoted)
- [ ] `docs/phase4-session-log.md` written: gates asked/answered,
      deviations, ACTUAL verification outputs, graft tally
- [ ] Commit by explicit path only (no `git add -A`)

Hard stop-and-report triggers: `pnpm test`/`typecheck` red after an edit
without an honest fix; a UI state that cannot be derived from a client
snapshot (design error → report, never fake); the Android build failing
natively (report the exact Gradle output); no Android surface at all
(neither emulator nor device attached → report the blocker as owner work
instead of simulating the egress proof).

## 8. Risks & blockers

1. **iOS engines (G1/G2 carry-in):** the UI can only ever render
   `connecting → error` on iOS this phase; the verbatim reason strings are
   the product. Connected states on iOS are impossible — enforced by
   surfacing, not by UI special-casing.
2. **Verification surface (G5, owner decision):** the on-device egress
   proof waits for a physical device; the emulator is not used as a
   stand-in. `:app:assembleDebug` still gates the session.
3. **1 Hz re-render budget:** traffic ticks re-render the home screen; the
   ring buffer + single subscription keep this bounded (no timers added).
4. **VPN Gate availability:** the sheet depends on the cached list; a
   failed fetch keeps cached nodes visible with a `Notice` (phase-2 parity).
5. **`pnpm-lock.yaml`:** must not churn (G1 expects zero dependency
   additions); any churn is recorded or reverted.

## 9. Sequencing (one session)

1. Read `AGENTS.md` (root + app), this plan, phase-2/3 session logs, command
   `phase4.md`. Ask the G-gates; record answers in §10.
2. Data layer: `settings-store.ts` + `getNode(id)` + tests → `pnpm test`
   + `pnpm typecheck`.
3. UI layer: shared format helpers → home screen → server sheet → settings
   sheet → `App.tsx` shell. Gates after each file.
4. Marker/bypass greps; fix wording if any match is a false-positive
   comment (reword, don't exclude).
5. §7 verification (Android build gate; egress proof deferred per G5; iOS
   simulator typed-error proof; expo-doctor); write
   `docs/phase4-session-log.md`; commit by explicit path only.

## 10. Gate answers (asked up front 2026-10-27)

| Gate | Owner answer | Resolution |
| --- | --- | --- |
| G1 dependencies | Allow, with review | The zero-dependency design needs no install; posture confirmed — if a dependency ever becomes necessary, its candidate · license · why · scripts are recorded here before installing, and lockfile churn gets the same record. |
| G2 disallowed-apps scope | Manual package entry | Manual package-name entry (`Field` add + removable rows); no native additions, no manifest `<queries>`/`QUERY_ALL_PACKAGES` churn. |
| G3 public IP endpoint | checkip.amazonaws.com | Plain-text echo, fetched only on user tap, AbortController-bounded, memory-cached, never parsed into tunnel state. |
| G4 settings persistence | Same sqlite DB | `app_settings` key-value table in the existing local database via the real `SqliteDriver`; dies with the app; no new dependency. |
| G5 Android surface | **Wait for physical device** | The on-device connect + egress proof is **deferred (owner-blocked)** until a physical device is attached; this session still runs the `:app:assembleDebug` build gate and reports the deferral honestly in the session log. No emulated "proof". |

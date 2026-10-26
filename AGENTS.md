# AGENTS.md — apps-hub Monorepo Guidelines

## What This Repo Is
A generic workspace hosting multiple mobile/desktop applications built with
React Native (+ Expo) and Electron. Apps live in `apps/`, shared logic lives
in `packages/`.

Current apps:
- **netlens** (`apps/netlens`) — FOSS, zero-telemetry LAN scanner & connectivity
  diagnostic toolkit. Android-first, iOS second. Feature docs: `docs/netlens/`.
- **open_tunnel_vpn** (`apps/open_tunnel_vpn`) — zero-registration VPN client
  aggregating VPN Gate relays + user WireGuard nodes. Migrated from Flutter to
  React Native (Expo SDK 54) on 2026-10-26 (Dart snapshot: commit `a8cf6e9`).
  Domain logic in `packages/open-tunnel-core`; phases in
  `apps/open_tunnel_vpn/.opencode/commands/`.
- **store** (`apps/store`) — private Android sideload store (`docs/app-store.md`).
- **pdf-editor** — offline PDF editor, moved in from `~/Documents/pdf-editor`
  on 2026-10-26: `apps/pdf-editor-desktop` (Electron), `apps/pdf-editor-mobile`
  (Expo + WebView), both booting the shared engine in
  `packages/pdf-editor-engine` (`build.mjs` inlines it for mobile).
- **design-editor** (`apps/design-editor`) — offline Canva-style editor for the
  Mac (Electron), moved in from `~/Documents/design-editor` on 2026-10-26.

Not here on purpose: `~/Documents/browser-automation` (stays standalone) and
`~/Documents/agent-harness` (deferred until its phase branches are merged).

Planned (do not scaffold yet):
- macOS/Windows targets for NetLens (react-native-macos / Electron) — future scope.

## Shared UI (`packages/ui`, NEVER hand-roll colours or fonts in an app)
- Every app uses `@apps-hub/ui`. React Native: wrap the root in
  `<ThemeProvider brand="…">` and build screens from its components (`Screen`,
  `Header`, `Group`/`Row`, `Button`, `Field`, `Segmented`, `TabBar`, `Readout`,
  `Notice`, `Sheet`, …). HTML/Electron: load `web/tokens.css` + `web/base.css`
  and set `<html data-brand="…">`; use the `--c-*` variables and `.ui-*` classes.
- Tokens live in `src/tokens.ts` only. After changing them run
  `pnpm --filter @apps-hub/ui build:css`; the test fails if `web/tokens.css` is
  stale, and it enforces WCAG AA contrast for every brand in light and dark.
- Brands: netlens, opentunnel, store, pdf, design (hue + accent from each
  launcher icon). Light and dark follow the system.
- Copy is sentence case, active voice; errors say what happened and how to fix
  it. No emoji icons, no ALL-CAPS labels.
- Fonts: Atkinson Hyperlegible Next + Mono (OFL, vendored in `packages/ui/fonts`).

## Tech Stack & Toolchain
- React Native 0.81.x + Expo SDK 54 + TypeScript 5.9.x (version-pinned to the
  stack proven in the pdf-editor mobile app).
- Node ≥ 22 (nvm), package manager: **pnpm** (pinned in root `package.json`
  `packageManager` field, enabled via `corepack enable pnpm`).
- Metro/monorepo: `node-linker=hoisted` (see root `.npmrc`) + `watchFolders` /
  `nodeModulesPaths` config in each app's `metro.config.js`.
- Android builds: JDK 21 (`$JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`)
  + Android SDK (`ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`,
  platform-tools, platforms;android-36, build-tools;36.0.0).
- iOS builds: Xcode + CocoaPods (`pod install` in `apps/netlens/ios`,
  `apps/open_tunnel_vpn/ios`).
- Local DB (when Phase 3 starts): `expo-sqlite` (pure FOSS). OpenTunnel's
  cache already runs expo-sqlite (schemaVersion 1).

## Hard Architectural & OS Constraints — NetLens (NEVER VIOLATE)
1. **NO ARP TABLE SCRAPING:** Never read `/proc/net/arp`, never shell out to
   `ip neigh`. They fail with `EACCES` on Android 11+ and iOS. Host discovery
   is TCP-probe based only.
2. **TCP RST = HOST ALIVE:** In the TCP probe engine, `ECONNREFUSED` /
   `ConnectException` (connection refused) means the target IP is ONLINE and
   actively responded with a TCP RST. It MUST be classified as
   `isReachable = true` WITH the measured RTT. Only `SocketTimeoutException`
   (ETIMEDOUT) or `NoRouteToHostException` (EHOSTUNREACH/ENETUNREACH) means
   offline. This rule is enforced natively (Kotlin + Swift) and guarded by
   unit tests (`TcpProbeClassifierTest`).
3. **CONCURRENCY:** All subnet sweeps are bounded. Android: Kotlin
   `Semaphore(64)`. iOS: a fixed pool of 64 worker queues pulling from a shared
   cursor. Never launch 254 unthrottled socket operations simultaneously.
4. **MULTICAST LOCK:** On Android, always acquire `WifiManager.MulticastLock`
   before mDNS/SSDP discovery and release it in a `finally` block.
5. **F-DROID PURE FOSS:** Never add proprietary dependencies (no Firebase, no
   Google Play Services, no closed-source SDKs, no telemetry/crash-reporting).
   Audit licenses before adding any dependency (Expo, React Native,
   expo-modules: MIT).
6. **MODERN ANDROID APIS:** Use `ConnectivityManager.getActiveNetwork()` +
   `getLinkProperties()` for IP/Gateway detection. Never use deprecated
   `WifiManager.getConnectionInfo().ipAddress`.
7. **DEFAULT PROBE PORTS:** `[80, 443, 22, 445, 5353, 8080, 62078]` with a
   350 ms connect timeout per probe. Subnet sweeps are clamped to at most a
   `/24` around the host IP (NFR-1).

## Code Style & Workflow
- NetLens feature specs: `docs/netlens/PRD.md` (FR-1..FR-4, NFR-1..NFR-3
  acceptance criteria AC-1..AC-4), `docs/netlens/SPEC.md` (architecture,
  native module contracts, algorithms), `docs/netlens/PROMPTS.md` (phase
  prompts — execute one phase per session, strictly in order 1 → 4).
- Shared TS logic goes in `packages/core` (pure TypeScript, runnable from RN,
  Electron, or Node — no React/RN imports there).
- Native per-platform code lives in Expo local modules under the app
  (`apps/netlens/modules/netlens-core`) via Expo Modules API.
- Tests: TypeScript via `node --test` (type stripping, no Jest dependency).
  Native invariants via Gradle JVM unit tests
  (`:netlens-core:testDebugUnitTest`).

## Verification Commands (per phase; report ACTUAL output, never predicted)
```bash
pnpm test                       # all workspace package unit tests (TS)
pnpm typecheck                  # tsc --noEmit per package
# Native engine compile + unit tests:
cd apps/netlens/android && JAVA_HOME=$JAVA_HOME ./gradlew \
  :netlens-core:testDebugUnitTest :app:assembleDebug
cd apps/netlens/ios && xcodebuild -workspace NetLens.xcworkspace -scheme NetLens \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -configuration Debug build CODE_SIGNING_ALLOWED=NO
# Native compile gate (OpenTunnel, after Phase 2+):
cd apps/open_tunnel_vpn/android && JAVA_HOME=$JAVA_HOME ./gradlew :app:assembleDebug
# Electron apps (open real windows, so not part of `pnpm test`):
pnpm --filter pdf-editor-desktop test:e2e   # desktop + Electron + mobile-bridge suites
pnpm --filter design-editor test:e2e
# Environment sanity:
pnpm doctor                     # expo-doctor in every app that ships it
```

# AGENTS.md — apps-hub Monorepo Guidelines

## What This Repo Is
A generic workspace hosting multiple mobile/desktop applications built with
React Native (+ Expo) and Electron. Apps live in `apps/`, shared logic lives
in `packages/`.

Current apps:
- **HomeNet** (`apps/netlens`, formerly NetLens) — FOSS, zero-telemetry LAN scanner & connectivity
  diagnostic toolkit with a router dashboard, device remotes, who's home, wake PC and guest QR.
  Android-first, iOS second. Feature docs: `docs/netlens/`.
- **TunnelWall** (`apps/open_tunnel_vpn`, formerly OpenTunnel) — zero-registration VPN client
  aggregating VPN Gate relays + user WireGuard nodes. Migrated from Flutter to
  React Native (Expo SDK 54) on 2026-10-26 (Dart snapshot: commit `a8cf6e9`).
  Domain logic in `packages/open-tunnel-core`; phases in
  `apps/open_tunnel_vpn/.opencode/commands/`.
- **store** (`apps/store`) — private Android sideload store (`docs/app-store.md`).
- **pdf-editor** — offline PDF editor, moved in from `~/Documents/pdf-editor`
  on 2026-10-26: `apps/pdf-editor-desktop` (Electron), `apps/pdf-editor-mobile`
  (Expo + WebView), both booting the shared engine in
  `packages/pdf-editor-engine` (`build.mjs` inlines it for mobile). The mobile
  app's home screen is a searchable **Library** (folders, tags, full-text search,
  Arabic and Urdu normalised) over one `library.db`: logic in
  `packages/library-core`, app glue in `apps/pdf-editor-mobile/src/library`. Scan
  and Reader build on it; specs `docs/pdf-editor/`, progress `docs/handoffs/pdf-editor-scan.md`.
  The mobile app is named **Nexus** since N2 (package id and Store id unchanged): an opt-in
  AI layer (owner's OpenAI key; fully offline without one) over the same Library, with
  logic in `packages/knowledge-core` and glue in `apps/pdf-editor-mobile/src/nexus`. Design
  `docs/superpowers/specs/2026-11-18-nexus-design.md`, progress `docs/handoffs/nexus.md`.
- **design-editor** (`apps/design-editor`) — offline Canva-style editor for the
  Mac (Electron), moved in from `~/Documents/design-editor` on 2026-10-26.
  Its Android sibling `apps/design-editor-mobile` (`com.haroon.designeditor`, Store
  release id `design-editor`) runs the same canvas in a WebView plus the media tools
  as a Kotlin foreground queue (`modules/design-media`). Pure logic in
  `packages/media-core`. Specs: `docs/design-editor/`; progress:
  `docs/handoffs/design-editor-media.md`.
- **deputy** (`apps/deputy`) — personal Android agent that carries out tasks by
  operating other apps through an AccessibilityService. Android only, private
  Store only (`com.haroon.deputy`). Kotlin owns the agent loop and the
  confirmation gate; RN only renders. Specs: `docs/deputy/` (PRD, SPEC);
  phases and spike results: `docs/handoffs/deputy.md`. Autopilot (stage 1): starts a
  reply run only from Inflow's Run tap, through `RunSuggestionActivity`, with the other
  person's text kept in the untrusted block; design `docs/superpowers/specs/2026-11-18-autopilot-design.md`.
- **strongroom** (`apps/strongroom`) — personal password manager, all own code
  (Kotlin owns the vault; RN only renders). Android only, private Store only
  (`com.haroon.strongroom`). Design: `docs/strongroom/DESIGN.md`; phases:
  `docs/strongroom/PHASE-1-PLAN.md` and `docs/handoffs/strongroom.md`.
- **halo** (`apps/halo`) — edge visualizer: audio-reactive lights around the screen edge and
  an always-on display. It also carries Notch, the pill around the camera (`modules/notch-island`,
  fed by halo-engine's one notification listener; the separate `notch` app is gone). Android only,
  private Store only (`com.haroon.halo`); Kotlin modules `halo-engine` and `notch-island`, RN renders
  settings. Spec: `docs/superpowers/specs/2026-11-17-edge-visualizer-design.md`;
  plan: `docs/superpowers/plans/2026-11-17-halo.md`; handoff: `docs/handoffs/edge-visualizer.md`.
- **strongroom-extension** (`apps/strongroom-extension`) — Strongroom for Chrome
  (Manifest V3, Mac and Windows, loaded unpacked). Its own local vault in the
  Android vault format (`packages/strongroom-core`, checked against the shared
  `vault-vectors.json`); fills and saves logins; signs in to sync with the phone
  through the vault server (`tools/vault-api`, Phase 2, not deployed yet). Handoffs:
  `docs/handoffs/strongroom-extension.md`, `docs/handoffs/strongroom-sync.md`.
- **inflow** (`apps/inflow`, formerly Notebox) — personal notification, SMS and
  money archive: saves every notification, the SMS inbox and marked Gmail senders'
  emails (IMAP with an app password) into an encrypted on-phone store (SQLCipher),
  reads bank SMS and emails into a spending ledger, and shows it behind a fingerprint
  lock, with AI summaries, importance, to-dos, money categories and an Ask AI tab
  through the owner's OpenAI-compatible API key (https only; never sent: OTPs,
  blocked apps or senders, apps not recorded, items saved before the first key; Ask AI also sends ledger transactions of any age, with chat titles and a you/not-you flag per item; spending categories and the weekly/monthly reports send the fields of every transaction, including ones from bank pushes and from apps or senders kept from the AI, but never message text). Reports (8 weekly, 4 monthly kept) are the only reason for POST_NOTIFICATIONS.
  Android only, private Store only (`com.haroon.inflow`; READ_SMS, RECEIVE_SMS,
  INTERNET for `imap.gmail.com` and the owner's chosen AI address). Kotlin owns
  capture, storage, parsing, Gmail and AI; RN only renders. WhatsApp chats are grouped by contact, WhatsApp text is kept forever, and the media WhatsApp notifications expose is stored encrypted in the app's private files (never sent to the AI). Home is money card, Inbox (one row per chat-like app), Important (no payments), Coming up, Recent chats, All apps; Money has Overview, Reports and All. In an SMS contact list, senders the AI mostly reads as promotions (and no bank) fold into one "Promotions" row (nothing is deleted; the owner can override per sender; schema v7 `sender_promo`). Spec:
  `docs/superpowers/specs/2026-11-13-inflow-design.md`, `docs/superpowers/specs/2026-11-17-inflow-ux-design.md`; plans:
  `docs/superpowers/plans/2026-11-13-inflow-stage-*.md`, `docs/superpowers/plans/2026-11-18-inflow-ux.md`; progress:
  `docs/handoffs/inflow.md`. Autopilot (stage 1): turns what arrives into reply, bill, event and money suggestions with Run and Skip, shared with Deputy through a signature-guarded provider; design `docs/superpowers/specs/2026-11-18-autopilot-design.md`, progress `docs/handoffs/autopilot.md`. R44 has one exception: items from conversations the owner picked go to the AI for Autopilot only. Ask AI stays SMS and email only, and the ledger and bank parsing take only SMS and Gmail items, not pushes from chat or other apps.

- **autonomous-browsing** (`apps/autonomous-browsing`) — Electron desktop app for
  chat-authored browser automation routines, copied in from
  `~/Documents/browser-automation` on 2026-11-17 (tracked files only, no git
  history; the original stays standalone). A normal pnpm workspace member now;
  its `CLAUDE.md` and `AI_CONTEXT.md` still say `npm run`, read that as
  `pnpm --filter autonomous-browsing <script>`.

- **text-ocr** (`packages/text-ocr`) — Expo local module shared by Design Editor mobile and
  PDF Editor: Tesseract (English, bundled `tessdata_fast`) plus a clipboard copy, Android only.
  Design Editor: long-press an image, "Copy text" (bridge event `recognizeText`). PDF Editor:
  "+" → "Scan text" (`app/scan-text.tsx`, system camera through expo-image-picker). The Scan
  branch's Phase 4 OCR in `pdf-scan` is separate and unchanged.

Not here on purpose: `~/Documents/agent-harness` (deferred until its phase
branches are merged).

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
- Brands: netlens, opentunnel, store, pdf, design, deputy, strongroom, inflow, clipboard, halo (hue + accent from each
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
# Native compile gate (Deputy):
cd apps/deputy/android && JAVA_HOME=$JAVA_HOME ./gradlew \
  :deputy-agent:testDebugUnitTest :app:assembleDebug
# Native compile gate (Strongroom):
cd apps/strongroom/android && JAVA_HOME=$JAVA_HOME ./gradlew \
  :strongroom-vault:testDebugUnitTest :app:assembleDebug
# Native compile gate (Inflow):
cd apps/inflow/android && JAVA_HOME=$JAVA_HOME ./gradlew \
  :inflow-core:testDebugUnitTest :app:assembleDebug
# Native compile gate (PDF Editor mobile; the Scan module's JVM tests):
cd apps/pdf-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew \
  :pdf-scan:testDebugUnitTest :app:assembleDebug
# Native compile gate (Halo):
cd apps/halo/android && JAVA_HOME=$JAVA_HOME ./gradlew \
  :halo-engine:testDebugUnitTest :notch-island:testDebugUnitTest :app:assembleDebug
# Native compile gate (Design Editor mobile):
cd apps/design-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew \
  :design-media:testDebugUnitTest :app:assembleDebug
# Electron apps (open real windows, so not part of `pnpm test`):
pnpm --filter pdf-editor-desktop test:e2e   # desktop + Electron + mobile-bridge suites
pnpm --filter design-editor test:e2e
# Chrome extension in real Chromium (build first; needs playwright-core, see its README):
pnpm --filter strongroom-extension build && pnpm --filter strongroom-extension test:e2e
# Environment sanity:
pnpm doctor                     # expo-doctor in every app that ships it
```

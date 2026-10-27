# Handoff: round 2 fixes after on-phone testing (started 2026-10-27)

## 1. Resume prompt

```text
Continue the apps-hub "round 2" fixes. Working dir: /Users/outsentia/Documents/apps-hub.
Read docs/handoffs/round2-fixes.md completely first (and skim docs/handoffs/frontend-unification.md
for background). Trust §4 (verified facts); do not redo that work. Follow the handoff contract in
~/.claude/CLAUDE.md: keep this file's §6/§7 updated as milestones land, and at ~85% context write a
new resume prompt here and stop instead of compacting.
Start at §7 "Next step". Ask me the open decisions in §3 before building the parts that depend on them.
```

## 2. Goal (user's words, 2026-10-27) and fixed constraints

1. "I don't have these many devices, fix it": NetLens reported 135 responding hosts on 192.168.18.0/24.
2. "Fix the download and update bug": Store installs and self-updates fail on the user's Xiaomi.
3. "Merge everything into main."
4. "How to connect to VPN in OpenTunnel?" and "create logo for OpenTunnel app".
5. "What's the purpose of NetLens? Make it purposeful."
6. "In PDF editor, after edit text the background stays white, fix it."

Constraints: AGENTS.md hard rules (NetLens: no ARP, TCP RST = alive, bounded sweeps, F-Droid pure FOSS; OpenTunnel rules in apps/open_tunnel_vpn/AGENTS.md). All UI on `packages/ui`. Report ACTUAL command output. Release apps with `pnpm release <id> -m "..."` (docs/app-store.md); never release open-tunnel without the user's go-ahead.

## 3. Open decisions (ask the user)

- **NetLens rule 2 vs false positives.** AGENTS.md says ECONNREFUSED/RST = alive. If the investigation shows something on this network sends RSTs for addresses with no device (see §4), fixing it may need to change that hard rule (e.g. require a second signal). Changing a hard rule needs the user's explicit OK.
- **OpenTunnel gate G1.** VPN Gate relays are OpenVPN only. `OpenVpnEngine.start` deliberately throws: "the ics-openvpn GPLv2 core needs a project license decision first" (`modules/open-tunnel-native/.../ServiceContracts.kt:22`, `docs/phase2-session-log.md`). The user must decide whether OpenTunnel may ship GPLv2 code (or pick another engine) before VPN Gate connections can work.
- **NetLens purpose.** Propose 2-3 concrete directions (use superpowers:brainstorming), e.g. "Who's on my Wi-Fi" guard (named devices via mDNS/SSDP/NetBIOS, alert when an unknown device joins, trust list) plus "is it my Wi-Fi, my ISP or DNS" diagnostics, and let the user pick before building.

## 4. Verified facts (do not re-derive)

Phone: Xiaomi 24116RACCG, HyperOS / Android 16, users 0 + "security space" 10 + XSpace 999. Wi-Fi 192.168.18.209/24, router 192.168.18.1. Wireless debugging was used: `adb mdns services` finds `_adb-tls-pairing`/`_adb-tls-connect`; pairing codes only work while the phone's pairing screen is open; serial looks like `adb-49kjmnuwonkffqzh-zHnffO._adb-tls-connect._tcp`. Remote taps need Developer options → "USB debugging (Security settings)". Phone default screen timeout is 120000 ms; restore it if changed (`settings put system screen_off_timeout`).

Installed on the phone now (all match the live Store manifest): store 6, netlens 4, pdf-editor 3, open-tunnel 2 (phase-1 build, no connect). Store, NetLens and PDF Editor have installer of record = com.haroon.store.

Store install failures, root cause (from logcat):
- Google Play Protect intercepts every Store install: "App scan recommended — Scan app / Don't install app" (More details → "Install without scanning", which then demands a fingerprint).
- `verifier_timeout=17000`: at ~16.4 s the session is killed: `PackageInstallerSession: INSTALL_FAILED_ABORTED: Permission denied`, then `VerifyApps: Install-time verification timed out`. The Store gets FAILURE_ABORTED.
- Store ≤5 treated FAILURE_ABORTED as a user cancel and showed nothing (UI silently reset to "Update"). Store 6 now shows an explanatory notice (`apps/store/src/present.ts`).
- Self-update works mechanically (verified on emulator 3→4): Android kills the Store mid-install; Store 5+ posts "Store updated to X (N)" via `SelfUpdateReceiver` (MY_PACKAGE_REPLACED).
- The APK download runs inside the app process (`Installer.install`, coroutine from the JS call). If the user switches apps or the screen locks during the ~60-85 MB download, HyperOS may freeze it and the JS state is lost. Not yet proven, but a foreground service / expedited WorkManager job with a progress notification is the robust fix.
- `adb install -r -i com.haroon.store <apk>` installs without Play Protect and keeps the Store as installer of record (used for store 5/6, netlens 4, pdf-editor 3).

NetLens:
- Fixed in netlens 4: scan button stuck disabled (store readiness lived in a ref) and router shown as fe80::1 (Android took the first default route; now IPv4 only). Native JVM tests 9/9 pass.
- The 135-device result: list shows hosts answering on ports 80 / 62078 (e.g. .1:80, .8:62078, .11:62078, .7:62078). The user says they don't have that many devices. Unverified hypotheses: (a) the router/AP or the phone's VPN (a "VPN" icon was seen in the status bar during testing) returns RST/ECONNREFUSED for empty addresses, which rule 2 counts as alive; (b) sockets are not bound to the Wi-Fi `Network`, so probes may route through a VPN. Investigate with per-host outcome kind (refused vs connected) + RTT distribution on the phone before changing logic; `Network.bindSocket` to the Wi-Fi network is compatible with all hard rules.

PDF editor: "after edit text the background stays white" is the user's report; not yet reproduced. Look at how `packages/pdf-editor-engine/core.js` renders the in-place text editor/overlay and what `textedit.js` writes on save (a white cover rectangle on a non-white page would explain it). Check both the on-screen view and the saved PDF. Desktop e2e: `pnpm --filter pdf-editor-desktop test:e2e`.

OpenTunnel: current icon `apps/open_tunnel_vpn/assets/icon.png` (green shield + lock + arc). Make a new logo in the suite's style: rounded plate, deep green-tinted background, mint `#34D399` mark; see `apps/store/assets/icon.svg` for the SVG structure and render it with `node tools/icons/render-icon.mjs <svg> apps/open_tunnel_vpn` (headless Chrome + cwebp; writes assets/icon.png, assets/android-icon-foreground.png and all mipmaps), then set the adaptive icon background colour in `android/app/src/main/res/values/colors.xml` (`iconBackground`) and `app.json`.

Git: branch `frontend-unification` (pushed, d0e24a0 + later) is 6+ commits ahead of `main` (main = ea990ca). Other sessions also commit OpenTunnel work to this branch. Merging was explicitly requested by the user.

Environment: Node 22.23.4 is the nvm default (graft needed `SDKROOT=$(xcrun --sdk macosx --show-sdk-path)` to build). Android emulator AVD `apps-hub-test` (Android 15) exists: `~/Library/Android/sdk/emulator/emulator -avd apps-hub-test -no-window`. JDK 21 at `/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`.

## 5. File map

- Store installer: `apps/store/modules/store-installer/android/src/main/java/expo/modules/storeinstaller/{Installer,InstallResultReceiver,SelfUpdateReceiver,UpdateCheckWorker,Packages}.kt`, UI `apps/store/App.tsx`, copy `apps/store/src/present.ts`.
- NetLens sweep: `apps/netlens/modules/netlens-core/android/.../{TcpSweepEngine,PlatformNetwork,NetlensCoreModule}.kt`, iOS twins in `.../ios/`, TS engine `packages/core/src/`, screen `apps/netlens/src/screens/ScannerScreen.tsx`.
- PDF editor: `packages/pdf-editor-engine/{core.js,textedit.js,desktop.html,mobile.html,build.mjs}`.
- OpenTunnel: `apps/open_tunnel_vpn/{App.tsx,AGENTS.md,docs/,modules/open-tunnel-native}`, engines in `android/app/src/main/java/com/opentunnel/open_tunnel_vpn/engines/`.
- Icons: `tools/icons/render-icon.mjs`.

## 6. Session log

- s0 (2026-10-26/27, previous chat): redesign, app moves, releases, on-phone debugging; see frontend-unification.md.

## 7. Current state and exact next step

Nothing in §2 started yet. Suggested order:
1. Merge `frontend-unification` into `main` (fast-forward or merge commit, push), then branch for the work below.
2. Ask the §3 decisions (one message).
3. Store download/update robustness (foreground download with progress notification, restore in-progress state on reopen); verify on the phone over wireless debugging, including a real Store self-update and an app update through Play Protect ("Scan app").
4. NetLens false positives: instrument, measure on the phone, fix within the hard rules (or with the user's OK to change rule 2).
5. PDF editor white background after text edit: reproduce, fix, cover with the desktop e2e.
6. OpenTunnel logo (+ answer/act on gate G1).
7. NetLens purpose: build the direction the user picked.
8. Release changed apps, install on the phone, re-verify.

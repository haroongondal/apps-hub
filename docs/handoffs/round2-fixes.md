# Handoff: round 2 fixes after on-phone testing (started 2026-10-27)

## 1. Resume prompt

```text
Continue the apps-hub "round 2" fixes (resume prompt updated 2026-10-27, after s2). Working dir: /Users/outsentia/Documents/apps-hub.
Read docs/handoffs/round2-fixes.md completely first (and skim docs/handoffs/frontend-unification.md
for background). Trust §4 (verified facts); do not redo that work. Follow the handoff contract in
~/.claude/CLAUDE.md: keep this file's §6/§7 updated as milestones land, and at ~85% context write a
new resume prompt here and stop instead of compacting.
Start at §7 "Next step". Ask me the open decisions in §3 before building the parts that depend on them.
Goal 7 (OpenTunnel connect) is built and committed; ask me before releasing open-tunnel.
```

## 2. Goal (user's words, 2026-10-27) and fixed constraints

1. "I don't have these many devices, fix it": NetLens reported 135 responding hosts on 192.168.18.0/24.
2. "Fix the download and update bug": Store installs and self-updates fail on the user's Xiaomi.
3. "Merge everything into main."
4. "How to connect to VPN in OpenTunnel?" and "create logo for OpenTunnel app".
5. "What's the purpose of NetLens? Make it purposeful."
6. "In PDF editor, after edit text the background stays white, fix it."
7. "Make OpenTunnel work as well" (2026-10-27, after s1): a user can pick a server and get a working VPN connection on the phone.

Constraints: **Never install/update apps on the phone with adb (user, 2026-10-27): only through the Store; fix Store bugs first.** adb stays fine for logcat/screens/taps. AGENTS.md hard rules (NetLens: no ARP, TCP RST = alive, bounded sweeps, F-Droid pure FOSS; OpenTunnel rules in apps/open_tunnel_vpn/AGENTS.md). All UI on `packages/ui`. Report ACTUAL command output. Release apps with `pnpm release <id> -m "..."` (docs/app-store.md); never release open-tunnel without the user's go-ahead.

## 3. Open decisions (ask the user)

- **NetLens rule 2 vs false positives.** AGENTS.md says ECONNREFUSED/RST = alive. If the investigation shows something on this network sends RSTs for addresses with no device (see §4), fixing it may need to change that hard rule (e.g. require a second signal). Changing a hard rule needs the user's explicit OK.
- **OpenTunnel gate G1 (ask first for goal 7; s1 answer was "I don't know").** Explain in plain words and recommend: (a) ship ics-openvpn, OpenTunnel becomes GPLv2 (source stays public, F-Droid fine) and VPN Gate relays connect, recommended if the user is happy to keep it open source; (b) WireGuard only, no GPL, only the user's own WireGuard servers connect. Original note: VPN Gate relays are OpenVPN only. `OpenVpnEngine.start` deliberately throws: "the ics-openvpn GPLv2 core needs a project license decision first" (`modules/open-tunnel-native/.../ServiceContracts.kt:22`, `docs/phase2-session-log.md`). The user must decide whether OpenTunnel may ship GPLv2 code (or pick another engine) before VPN Gate connections can work.
- **NetLens purpose.** Propose 2-3 concrete directions (use superpowers:brainstorming), e.g. "Who's on my Wi-Fi" guard (named devices via mDNS/SSDP/NetBIOS, alert when an unknown device joins, trust list) plus "is it my Wi-Fi, my ISP or DNS" diagnostics, and let the user pick before building.

**Answers (s1, 2026-10-27):** Rule 2 → measure first (bind probes to Wi-Fi, log refused vs connected on the phone); come back only if data says the rule must change. G1 → s1: "I don't know" (logo only). **s2 (2026-10-27): G1 = GPLv2 + OpenVPN** (ics-openvpn engine; OpenTunnel becomes GPLv2; repo is public on GitHub, no license yet). NetLens purpose → both, device guard first (named devices, trust list, flag new unknown devices), then the "why is my internet slow" verdict screen.

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
- OpenTunnel connect: engines `apps/open_tunnel_vpn/android/app/src/main/java/com/opentunnel/open_tunnel_vpn/engines/{EngineAdapter,OpenVpnEngine,WireGuardEngine}.kt` (WireGuardEngine is implemented; OpenVpnEngine.start throws `ServiceContracts.OPENVPN_GATE_MESSAGE`), service `OpenTunnelVpnService.kt`, bridge `modules/open-tunnel-native`, phase prompts `.opencode/commands/phase2..4.md`, plans/logs `docs/phase2-plan.md`, `docs/phase2-session-log.md`, `docs/phase3-plan.md` (iOS). Rules: `apps/open_tunnel_vpn/AGENTS.md` (sanitize every .ovpn, kill switch, no placeholders).

## 6. Session log

- s0 (2026-10-26/27, previous chat): redesign, app moves, releases, on-phone debugging; see frontend-unification.md.
- s1 (2026-10-27): main fast-forwarded to 695ac29 and pushed (goal 3 done). Work continues on branch `round2-fixes` (from 695ac29). Asked the §3 decisions.
- s1: Store fix (7ecf8f7): `InstallWorker` (WorkManager foreground job, dataSync, progress notification), verified APK kept in cache/apks/<sha>.apk until an install succeeds (instant retry after a Play Protect abort), background-finished downloads post "ready to install" instead of committing unseen, PENDING_USER_ACTION in background → notification, reopened Store shows running downloads. Verified on emulator (Android 15, adb allowed there by the user): NetLens 3→4, PDF Editor 1→3 (FGS type 0x1 running while backgrounded at 98%; resumed after force-stop), OpenTunnel 1→2 (background finish → notification → retry from cache in <3 s; Cancel → notice). Store 7 released (`✔ store 7 published`). Phone still on Store 6: user must self-update through Store 6 (tap Scan app on Play Protect).
- s1: NetLens false positives. Measured from the Mac (192.168.18.242, same /24, same ports/350 ms/64 workers, script was a scratch node sweep): **3 hosts** (.1 open:80, .209 refused:80, .242). So the router does not fake RSTs; the 135 came from the phone (VPN seen in status bar). Fix 9218320: `PlatformNetwork.lanNetwork` (Wi-Fi/Ethernet non-VPN network) for interface detection; sweep + private-address handshakes use `lanNetwork.socketFactory`; internet handshakes keep the default route. Rule 2 unchanged. JVM tests 10/10, core 65/65. NetLens 5 released. iOS twin not changed (iOS VPNs usually exclude the LAN; revisit if seen). Phone adb was unreachable (wireless debugging off).
- s1: PDF editor (goal 6) done: the saved PDF was already right (content-stream rewrite, no cover box); the on-screen edit box used `color:#000; background:#fff`. `core.js pageInk()` samples the rendered canvas around the box (border mode = bg, farthest pixel = ink) into `--tb-bg/--tb-ink`. e2e now uses a #fde68a page with navy text; all 3 desktop suites pass. PDF Editor 4 released.
- s1: OpenTunnel logo done (fd37b61): `apps/open_tunnel_vpn/assets/icon.svg` (two mint arches + glowing light, plate #16472F→#0F2E1F), rendered Android assets + square opaque iOS AppIcon. Not released (open-tunnel needs the user's go-ahead).

- s2 (2026-10-27): user picked G1 = GPLv2 + OpenVPN. Started goal 7.
- s2: OpenVPN engine built (uncommitted yet): `apps/open_tunnel_vpn/vendor/ics-openvpn/build-aar.sh` clones ics-openvpn v0.7.69 (+ openvpn/openssl/lz4/fmt submodules) into ~/.cache/apps-hub, swaps in `library.gradle.kts` (library, skeleton+ovpn2 flavours, compileSdk 36, NDK 28.2) and turns off the two CMake "skeleton" path checks (AGP 9 paths no longer contain the flavour, so CMake wanted SWIG/openvpn3). Output `android/app/libs/ics-openvpn.aar` (11 MB, 4 ABIs). `OpenVpnEngine` = controller like WireGuard: ConfigParser → temp profile → `VPNLaunchHelper.startOpenVpn`, VpnStatus state/byte listeners, 30 s connect timeout, ACTION_RELEASE tells our service to drop its FGS after an engine-side end. Manifest: ics services run in the app process (`tools:remove="android:process"`), remote API/boot receiver/restrictions removed, LaunchVPN etc. unexported; `keepVPNAlive`, `LaunchVPN`, `OpenVPNStatusService` must stay (referenced by OpenVPNService). `expo.useLegacyPackaging=true` (libovpnexec.so must be extracted). Module's OpenVPN gate removed. App.tsx rebuilt on @apps-hub/ui (server list, tap to connect, status row + Disconnect, errors as Notice). `:app:assembleDebug` passes; typecheck + 15 app tests pass.

- s2: emulator fixes found while testing (all in the code now): VPN consent via `startActivityForResult` from the module (NEW_TASK dialog fell behind the app) and the connect continues on OK; ics `GlobalPreferences` + notification channels initialised in `MainApplication.onCreate` (`OpenVpnEngine.initProcess`; the service can restart in a fresh process); `RECEIVE_BOOT_COMPLETED` kept (keepVPNAlive is a persisted job; boot receiver still removed); single flavour dimension so `BuildConfig.FLAVOR == "skeleton"` and libosslspeedtest is not loaded; VpnStatus callbacks that unregister are posted (fail-fast Vector). Emulator-only: Apple M5 emulator reports sve2/sme it can't execute → OpenSSL SIGILL; `OPENSSL_armcap=0x7d` set only when `Build.HARDWARE == "ranchu"`. Traffic ticks are per-second deltas (UI shows KB/s).
- s2 verified on emulator (release build, shared key, `adb install -d -i com.haroon.store`, emulator only): consent → connected to Japan public-vpn-90; `tun0` up; ip-api.com via nc: `PK 154.192.128.43` without VPN, `JP 219.100.37.236` with VPN; Disconnect removes tun0 and both services. Tests 138/138, typecheck 10/10. LICENSE (GPLv2 text) + `license: GPL-2.0-only`, ics licence at `vendor/ics-openvpn/LICENSE-ics-openvpn.txt`, README/AGENTS updated. Not tested: the 30 s timeout / auth-failed paths, WireGuard import UI (none exists; VPN Gate is OpenVPN only).

- s2: invariant review fixes (verified on emulator): session guard (`armed` = this session's first own state; replayed CONNECTED/NOTCONNECTED ignored); `stop()` waits ≤3 s for the old session's NOTCONNECTED and stops via `stopService` when the control binder isn't bound yet; ics persisted state cleared (`ProfileManager.setConnectedVpnProfileDisconnected`, `keepVPNAlive.unscheduleKeepVPNAliveJobService`, delete `files/temporary-vpn-profile.{vp,cp,cpold}`) right after start, on stop and in `initProcess`. Emulator: JP .236 → switch → JP .246 with correct UI; US foxdenvpn = genuine AUTH_FAILED → error notice, tunnel down; `am crash` while connected → system restarts OpenVPNService but no tunnel, no job. LICENSE now starts with an OpenSSL + Apache-2.0 linking exception. Note: uiautomator dumps are stale while the traffic line ticks; use screenshots. Tap rows by current layout (an error Notice shifts the list).

- s2: user said "yes please update the app": `pnpm release open-tunnel -m "Connects to free VPN Gate servers, new logo"` → `✔ open-tunnel 3 published` (46.4 MB APK). Merged release manifest exports only MainActivity, OpenVPNService (BIND_VPN_SERVICE), keepVPNAlive (BIND_JOB_SERVICE), ProfileInstallReceiver (DUMP).

- s2: **Phone Store install failures, real root cause** (wireless adb, logcat): `PKMSImpl: MIUILOG- assertCallerAndPackage: uid=10291, installerPkg=com.haroon.store ... msg=Permission denied` → `INSTALL_FAILED_ABORTED: Permission denied`. HyperOS rejects `USER_ACTION_NOT_REQUIRED` sessions from non-allowlisted installers. Proven independent of Play Protect: with scanning off (user toggled `package_verifier_user_consent=-1`) verification ALLOWed in 0.6 s and the session still aborted 7 ms later. Play Protect separately flags Store 7 as "Harmful app blocked" (cloud verdict 3); "Install anyway" (a link just above OK) + fingerprint gives ALLOW. Same report: github.com/sofianeelhor/PKForge/issues/25. Fix da28cd9: `Installer.commit` uses USER_ACTION_REQUIRED when `Build.MANUFACTURER == Xiaomi` (phone reports Xiaomi/Redmi). Store JVM tests + assembleRelease pass. NOT released: `pnpm release store` was blocked by the auto-mode permission classifier (production deploy) → user must run it or allow it. Bootstrap problem: Store 6 on the phone always sends NOT_REQUIRED, so it can never install Store 8; needs a one-time install outside the Store (user decision).

- s2: user said "release store 8 then": `✔ store 8 published` (58.8 MB). Phone still has Store 6 (can't install 8 itself); waiting for the user to choose the one-time bootstrap (browser download link via a 10-min signed URL from store-api `/sign`, or one adb install exception).

- s2: user chose "install using adb" (one-time exception): `adb install -r -i com.haroon.store` of the released Store 8 APK → phone Store 8, installer of record kept. Then through Store 8 (taps via adb, installs by the Store): NetLens 4→5, OpenTunnel 2→3, PDF Editor 3→4, all `PackageInstallerSession ... as applied`, zero `assertCallerAndPackage` denials. HyperOS shows "Xiaomi security scan" (com.miui.global.packageinstaller ScanActivity) then installs and opens the app. Play Protect scanning was still OFF during these (user turned it off for the test).

## 7. Current state and exact next step

Done: goals 3, 6, Store fix (Store 8: HyperOS silent-install fix, verified on the phone), NetLens VPN fix, OpenTunnel connect + logo (OpenTunnel 3). Phone now: Store 8, NetLens 5, OpenTunnel 3, PDF Editor 4.
Waiting on the user: turn Play Protect scanning back on; try OpenTunnel 3 on the phone (consent, connect, switch, disconnect); NetLens 5 host count with the VPN on.
Next steps, in order:
1. Collect phone results for OpenTunnel 3 and NetLens 5; fix what they report. Open question: with Play Protect scanning ON, do Store 8 installs still get the "Harmful app blocked" dialog for Store itself (needs "Install anyway")? Normal app updates should now work either way.
2. NetLens purpose, part 1 "device guard": brainstorm/spec first (superpowers:brainstorming → writing-plans), then build (named devices from MdnsProbe/SsdpProbe in `apps/netlens/src/db/`, trust list, flag new unknown devices). Part 2: "why is my internet slow" verdict screen.
3. Merge `round2-fixes` into main and push once the user confirms phone results.
Known gaps (OpenTunnel): no WireGuard import UI; kill switch not enforced app-side; no JVM tests for engine state logic; `expo prebuild --clean` would drop the hand-written ics manifest overrides.

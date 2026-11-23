# HomeNet toolbox handoff

## Resume prompt (2026-11-19)

Continue the HomeNet toolbox build (all five phases are built; what is left is push, PR,
the owner's go, release and the phone check). Work only in the worktree
`~/Documents/apps-hub-wt/homenet-toolbox` (branch `homenet-toolbox`, cut from `main`).
Read this file completely first, then the plan
`docs/superpowers/plans/2026-11-18-homenet-toolbox.md` and the spec
`docs/superpowers/specs/2026-11-18-homenet-toolbox-design.md`. Trust the verified facts
below and do not redo that work. Follow the owner's handoff contract (update this file
as milestones land; at ~85% context write a resume prompt and stop). Execute with
`cd-engineering-tools:phased-orchestration` (one phase agent per phase, briefs and
ledgers in `.orchestration/`), never `superpowers:subagent-driven-development`.
Continue from "Current state + exact next step".

## Goal and fixed constraints

- Add to HomeNet: Router tab (UPnP facts, live usage meter, open doors with close),
  device remotes (Roku, DLNA/Sonos, Shelly, Tasmota, WLED), Who's home tab, Wake PC,
  guest Wi-Fi QR.
- AGENTS.md hard rules; pure-TS logic in `packages/core`; LAN-only requests; no
  telemetry; FOSS only; `@apps-hub/ui` only.
- Owner decisions: build all four feature sets in order 1→4; ONE merge and ONE Store
  release at the end, only on the owner's go; install on the phone only via the Store.
- Commits carry no Claude attribution lines.

## Decisions (with why)

- UPnP IGD for router control: one standard; admin pages are per-brand HTTPS.
- `qrcode-generator` (MIT, pure JS) for QR: no native dependency.
- Native `sendUdpBroadcast` for Wake-on-LAN: `udpRequest` can't broadcast.
- Broadcast address from `InterfaceInfo.localIp`/`cidrPrefix`, not `SubnetPlan` (clamped to /24).
- Phones matched by IP, with a name-based tag carry-over.
- `android:allowBackup=false` (app.json + manifest) so the guest password isn't backed up.
- No Chromecast / Samsung-LG power-input / Hue control this round (need TLS, websockets or pairing).
- Merge origin/main into the branch (not rebase): `260467c2`. Main's #43 (named networks, forget menus) is ported into `ScanProvider`, which now holds `currentNetworkId`, `networkName`, `savedNetworks`, `renameNetwork`, `forgetNetwork`, `forgetDevice`; `ScannerScreen` keeps the menus, confirm and sheets. Why: Home and Router share the scan, so the state cannot live in one screen.
- n2 (an unclosed child tag in `upnp-soap.ts` hides later values) stays a known limit, recorded as a comment: fixing it needs a name stack, which is a parser redesign.
- One fix round for the two Important review findings only; Minors stay open and are listed below. Why: they are low-risk and a phone test will show which matter.
- Engine side of the discovery collision stays a Minor (a colliding scan loses SSDP/mDNS enrichment for that one scan); only the Router listener was fixed.

## Verified facts

- Native `tcpFetch` accepts any IP: the LAN guard must live in TS (Task 1).
- `parseHttpResponse` exists in `packages/core/src/name-formats.ts`; no `JSON.parse` exists in core yet.
- Scan keeps only the last SSDP event per IP (`ScannerScreen.tsx`), fixed in Task 5.
- `lanBinder` (Kotlin) binds only private/link-local targets to Wi-Fi.
- HomeNet version is `0.2.0` (`8d5a5097`: app.json, package.json, Android versionName, iOS Info.plist); versionCode comes from the release tool.
- Phase 5 carry-ins done: `afae681d` `utf8Length` without TextEncoder; `d268f41b` `native-args.ts` guards run before `udpRequest`/`tcpFetch` reach native; `566054be` `httpRequest` returns null for a missing target; `00c9b567` igd comment moved; `e1d9f89b` M-5 (AppState `active` refresh of the Devices header address; untested, no RN harness).
- Whole-branch review pinned to `e1d9f89b` (invariant-reviewer and code-reviewer): all hard rules, LAN guard, privacy and dependencies clean (`qrcode-generator` 2.0.4, MIT, no install scripts). Two Important findings, both fixed: I-1 Android allows one service discovery at a time, so the Router tab and the scan collided (`4321b9ce` `service-discovery.ts`, then `907804f5` asks again after the running discovery so the Router sees the gateway); I-2 the AppState refresh reset the open device sheet (`5fc185ae`, `sameInterface`). Scoped re-review: I-2 addressed; I-1 was partial until `907804f5`.
- Gates at HEAD `907804f5`: core 298/298, `pnpm test` exit 0, `pnpm typecheck` exit 0, Gradle `:netlens-core:testDebugUnitTest :app:assembleDebug` BUILD SUCCESSFUL, expo-doctor 16/18 (same two unrelated failures as Phase 4).
- iOS simulator build NOT completed. Copying main's gitignored Pods made xcodebuild compile the worktree's netlens-core Swift, and it failed only because the copied Pods project lacks the new `NameProbes.swift` and `UdpBroadcast.swift`. It needs `pod install --no-repo-update`, which the permission system denied. Until it runs, `NetlensCoreModule.swift` is uncompiled.
- Nothing has run on a phone. Device reply shapes (Roku, Shelly, Tasmota, WLED, Sonos), the Router tab against a real gateway, Wake-on-LAN and the guest QR come from fixtures and typechecks only. iOS Wake is not bound to Wi-Fi and likely needs the multicast entitlement.
- Worktree setup: `pnpm install` ok; `@apps-hub/core` tests 115/115 pass; core + netlens typecheck clean (2026-11-18).

## File map

- Plan / spec: `docs/superpowers/plans/2026-11-18-homenet-toolbox.md`, `docs/superpowers/specs/2026-11-18-homenet-toolbox-design.md`
- Orchestration workspace (git-excluded): `.orchestration/` (phase briefs, `progress.md` ledgers, `shared-files.txt`, `locks/`)
- Phase 5 ledger: `.orchestration/progress.md` (`## Phase 5`), briefs in `.orchestration/phase-5/`
- Phase 5 files: `packages/core/src/native-args.ts`, `service-discovery.ts` (discovery collision), `apps/netlens/src/scan/ScanProvider.tsx` (shared scan, #43 state, AppState refresh)
- Core logic: `packages/core/src/*.ts`; app: `apps/netlens/src`, native: `apps/netlens/modules/netlens-core`

## Session log

- 2026-11-18: design approved; plan written; Task 0 done (commits `5b0c11ae` port check, `dd1ce571` docs). Phase 1 agent started.
- 2026-11-18: Phase 1 run 1 PARTIAL at cap: Tasks 1, 2, 4 done (`05113574`, `05a3bd7e`, `efa4696b`, `ac4c6d41`); Task 3 `2bff3a29` reviewed with open I1 (quadratic regex), I2 (negative rate on 64-bit reset), m1–m6. Resume agent started with `.orchestration/phase-1-resume-brief.md`.
- 2026-11-18: Phase 1 DONE. Fix `e27ebda2` re-reviewed clean. Main-session gate at e27ebda2: core tests 180/180, core + netlens typecheck clean, tree clean. Deferred minors: n1 (rateBps fake tick on 64-bit reset → Phase 2), n2 (`upnp-soap.ts` ~61 unclosed child hides later values) and parked (`httpRequest` TypeError on null args) → Task 18 review batch. Phase 2 agent started with `.orchestration/phase-2-brief.md`.
- 2026-11-18: Phase 2 DONE (HEAD `a9f647a4`): `133b1597` locations per device, `ee17edfc` rate meter 64-bit reset fix, `979c9b54` detection, `89894496` actions, `e62e5856` device remotes UI, `a9f647a4` review fixes (F1–F5). Reviewed (Tasks 6, 7, n1 + fix re-review). Main-session gate at `a9f647a4`: core tests 210/210, core + netlens typecheck clean, tree clean, no attribution lines. Rule learned: a 401 counts as a locked Tasmota plug only when the JSON body has a string `WARNING`. NOT yet verified on a real device: Roku/Shelly/Tasmota/WLED/Sonos reply shapes come from fixtures; the Task 8 screens are typechecked only. Carried to Task 18: n2, parked httpRequest null-args TypeError, misplaced comment at `igd.ts:32`. Phase 3 agent started with `.orchestration/phase-3-brief.md`.
- 2026-11-18: Phase 3 DONE (HEAD `1aaba37d`): `55a1dcf4`+`54228b1f` schema v2 (migration reviewed against a node:sqlite fake: v0/v1/empty DBs reach 2, failures roll back), `bdcb3972` who's-home logic, `edd94283` shared ScanProvider, `a4e0d8c0` Home tab, `1aaba37d` fix (carried person tag survives saving the sheet; `saveDevice(id, patch)`). Main-session gate: core tests 234/234, typecheck clean, tree clean, no attribution lines. Not run in real expo-sqlite or the phone. Risk found by main session: `carryPersonTags` can move a tag through a generic name ("iPhone", "android") → Phase 4 carry-in C1. Carried to Task 18: M-5 stale header address after Wi-Fi change, Task 9 m2 migration race (unreachable), plus earlier n2/parked/comment items. Phase 4 agent started with `.orchestration/phase-4-brief.md`.
- 2026-11-18: session ended mid-Phase 4. Committed: `25048c32` C1, `2cc501de` + `84f86ab8` Task 13, `30568266` Task 17 core (Wi-Fi QR text). Uncommitted WIP: wol.ts + test (Task 14), QrCode.tsx, RouterScreen.tsx, apps/netlens/package.json, pnpm-lock.yaml (Task 17 app half). Draft PR #47 opened on `homenet-toolbox` (pushed at `30568266`); it conflicts with main on `ScannerScreen.tsx` (main's #43 named networks and forget menus must be ported into ScanProvider).
- 2026-11-19: resumed with `.orchestration/phase-4-resume-brief.md`. Phase 4 built: `3433cf73` Wake-on-LAN packet, `20155711` + `c98dad54` guest Wi-Fi QR (reviewed, two crashes fixed), `5a6623af` + `83ccf52f` native UDP broadcast (reviewed, iOS number-trap fixed), `abbf4742` Wake button. Main-session gate at `83ccf52f`: core 275/275, typecheck clean, Gradle BUILD SUCCESSFUL, tree clean, no attribution lines. iOS build NOT run (Pods absent, pod install ~20 KB/s). Pushed; draft PR #47 (https://github.com/haroongondal/apps-hub/pull/47) conflicts with main on ScannerScreen.tsx (main's #43). Phase 5 started with `.orchestration/phase-5-brief.md`.
- 2026-11-19: Phase 5 DONE (HEAD `907804f5`). Merge of origin/main `260467c2` (#43 ported into `ScanProvider`; conflicts only in `pnpm-lock.yaml` and `ScannerScreen.tsx`; merge reviewed clean). Carry-ins `afae681d`..`e1d9f89b`. Version `8d5a5097`, docs `0fe8f48d` (PRD FR-5..10, NFR-4, AC-5..9, SPEC, netlens CLAUDE.md, AGENTS.md). Whole-branch review; fixes `5fc185ae`, `4321b9ce`, `907804f5`. Gates at `907804f5` in Verified facts. iOS build not completed (needs `pod install`); nothing run on a phone.

### Open Minors (not fixed)

- Phantom speed after a router reboot: the previous counter is not updated on a failed read (`RouterScreen` ~376, `igd.ts` ~176).
- Phone model names ("iPhone 15 Pro Max", "Galaxy-S21-Ultra") are not generic in `people.ts` `DEVICE_WORDS`, so a person tag can carry through them.
- `parseSoapResponse` does not trim values or unwrap CDATA.
- Stray "?." in the `HomeScreen` copy (~125).
- `probeHome` and `checkPorts` call `measureTcpHandshake` without `isLanTarget` (safe in practice).
- Swift trims U+0085 and Kotlin does not (only private IPs pass either way).
- A scan that collides with the Router's discovery loses SSDP/mDNS enrichment.
- iOS has no collision guard: the Router's `onServiceScanComplete` can end the scan's discovery wait early (needs a run id in the payload or a JS dedup in the adapter).
- Forget-during-reconcile edge from #43: a forgotten device can reappear from `commitDevices(result.devices)`, edits to a deleted row are lost, and a failed delete restores a `before` copy that can overwrite a newer scan.
- Forget and rename failures use the shared `errorNote`, so Devices and Home show it under "The scan didn't finish".
- No Swift test; `utf8Bytes` in `QrCode.tsx` is untested.

## Current state + exact next step

All five phases are built and reviewed; branch HEAD `907804f5`; PR #47 (https://github.com/haroongondal/apps-hub/pull/47) was merged to main as e5264f05, "HomeNet 0.2.0: router, device remotes, who's home, wake PC, guest Wi-Fi" (`[skip ci]`; `apps/netlens` is at 0.2.0). Nothing has run on a phone and the iOS build is not done.
Next: the owner (or an approved session) runs `pod install --no-repo-update` in `apps/netlens/ios`, then `xcodebuild -workspace NetLens.xcworkspace -scheme NetLens -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -configuration Debug build CODE_SIGNING_ALLOWED=NO`. Still true: no phone test, iOS build not run, iOS Wake likely needs the multicast entitlement, open Minors above.
Then, if the release has not shipped yet (check the Store manifest): run `pnpm release netlens` locally on the owner's go, install via the Store on the phone through coord (claim `device:<ro.serialno>`), then check each feature at home, including Review Focus 5 with TunnelWall connected.

## Background checks and shares (C4, ecosystem wave, 2026-11-23)

Branch `eco/homenet` (worktree `~/Documents/apps-hub-wt/eco-homenet`), built on `eco/base` (E1 app-link contract). Not merged, not released, nothing run on a phone.

What was added:

- **Who's home in the background** (Android only). A WorkManager periodic job (`WhoIsHomeWorker`, 15 minutes, battery not low) probes only the last known addresses of tagged people (at most 4 per person, 16 people), on the default ports with a 350 ms timeout, through `TcpSweepEngine` (Semaphore 64). Open or refused (RST) counts as an answer. Present/away uses `nextPresence` (`packages/core/src/presence.ts`, Kotlin twin `Presence.next`): present on one answer, away after 3 misses in a row. No subnet sweep.
- **New device joined** (Android only). `NewDeviceWorker` sweeps the /24 around the phone (same engine, 350 ms, Semaphore 64, TCP only: no mDNS or SSDP, so no multicast lock is needed) every 3, 6 (default), 12 or 24 hours. Rule `findNewDevices` (`new-devices.ts`, Kotlin `NewDevices.find`): an answering address is new unless it is this phone, the router, a saved device seen there in the last 30 days, a tagged or trusted device (any age), a device already reported in the last 30 days, or one marked "This is mine". One notification per new device (at most 5 per run) with a "This is mine" action; tapping opens `netlens://devices`.
- Both run only while the phone is on a Wi-Fi network (not VPN, not mobile data) whose default gateway is the saved home gateway (`HomeWatch.homeLan`, ConnectivityManager link properties). Both are off by default; the home network is the scanned network when the first switch is turned on, and native keeps a snapshot of the device list that the app refreshes after each scan there (`useHomeWatch`).
- **Shares** (E1): `content://com.haroon.netlens.applink/who_is_home` (person, present, last_seen_at) and `/new_devices` (first_seen_at, label, acknowledged), declared in `packages/core/src/home-shares.ts`, served by `HomeLinkProvider` behind `com.haroon.permission.AUTOPILOT` and `AppLinkCaller`. Empty unless "Share with my other Haroon apps" is on (off by default) and the matching check is on. No address, MAC, hostname, port or scan detail is served.
- **Bonjour names for matching**: the scan keeps the cleaned instance names each address announces (up to 8, from the service types discovery already browses). `personTagCarries` adds two signals after the old same-name match, each used only when the one before matched nothing: an announced name equal to the old row's name, and a name whose owner word (`ownerOfName`, "Haroon's iPhone") equals the person's tag. The Home tab shows the reason ("Matched: It calls itself Haroon's iPhone").
- iOS: `getHomeWatch`, `setHomeWatch`, `markDeviceMine` answer `{ supported: false }`; the Home tab says the checks are Android only.

Decisions:

- Away after 3 misses (about 45 minutes) (my call): one or two missed checks are normal for a sleeping phone.
- "New" means not seen at that address in 30 days (my call). The background pass has only TCP answers, so it keys on the address; every saved row (USN, hostname or IP identity) is known at its last address. Known limit: a known phone that comes back with a new private MAC and a new address is reported once; "This is mine" stops it.
- Native owns settings and background state (SharedPreferences, `HomeWatchStore`), because WorkManager runs without JS (my call). The app's SQLite store is not read by native.
- Turning every check off clears the home network and the background state (my call).
- Sharing off by default, and a share serves rows only while its check is on (my call).
- Shares live in `packages/core` with fixtures there, because `apps/netlens` has no `test` script; `home-shares.ts` is not exported from the core index so Metro never loads `@apps-hub/app-link-contract`.
- The gateway match is the only home test (a different Wi-Fi with the same router address counts as home); SSID/BSSID would need location permission.

Verified (2026-11-23): `@apps-hub/core` 349/349, core and netlens typecheck clean, `@apps-hub/app-link-contract` 91/91 (copies test covers the netlens copies), Gradle `:netlens-core:testDebugUnitTest :app:assembleDebug` BUILD SUCCESSFUL with 58 JVM tests (HomeRulesTest 8, HomeLinkProviderShareTest 3, HomeWatchStoreTest 5, AppLinkGuardTest 16, TcpProbeClassifierTest 5 and the rest), no gms/firebase on `releaseRuntimeClasspath`. iOS build not run (no Pods in the worktree); `swiftc -parse` of the module file passes.

Phone checks (not run): see the C4 report; they need two Store-signed apps for the share and a second phone or laptop to join the Wi-Fi.

## Halo ping, health row and Restart with Deputy (P4, ecosystem wave 3, 2026-11-24)

Same branch `eco/homenet`, on top of C4. Not merged, not released, nothing run on a phone.

What was added:

- **CHANGED ping to Halo** (Android). After a background new-device check finds at least one new device, and after a who's-home change (someone arrived or left, from the 15-minute check or from a scan the app hands native), HomeNet sends `com.haroon.autopilot.CHANGED` to `com.haroon.halo` only, with `sendBroadcast(intent, "com.haroon.permission.AUTOPILOT")` and no extras, so Halo re-reads the `new_devices` and `who_is_home` shares through their guard. Rule `ChangedPing.due` (`HomeRules.kt`, `ChangedPingTest`): nothing while "Share with my other Haroon apps" is off; a new device pings when the new-device check is on; a presence change pings when the who's-home check is on, at most once a minute (`lastPingAt` in the same SharedPreferences, claimed under the store lock).
- **Health row**: `content://com.haroon.netlens.applink/health` from `appHealthShare('netlens')`: `app_id` netlens, `accessibility` null, `listener` null, `ai_source` none, `last_seen_at` the heartbeat. The heartbeat is written when the native module is created (the app opened) and at the start of each background check; a query only reads it. Served to same-signed callers whatever the share switch says (not personal). `HomeLinkProviderShareTest` binds it to `packages/app-link-contract/fixtures/app-health.share.json`.
- **Restart the router with Deputy** (Android; the button is hidden on iOS). A button on the Router tab (shown once the router lookup ends, in every state) calls the new native `proposeDeputyTask(task, context)`, which calls `startActivityForResult` on the current Activity with `com.haroon.deputy.action.PROPOSE_TASK`, package `com.haroon.deputy`, so Deputy's `AppLinkActivityCaller` check sees HomeNet. Extras: `task` only, the fixed text `ROUTER_RESTART_TASK` (`packages/core/src/deputy-proposal.ts`); Kotlin re-validates with `AppLinkGuard.validateExtras` against `DeputyProposal.SPEC` (bound to `propose-task-extras.json` by `DeputyProposalTest`). Outcomes `handed_over`, `cancelled`, `not_installed`, `refused`, `invalid`, `busy`, iOS `{ supported: false }`; each but cancelled shows a plain sentence. Deputy only opens a draft; the owner starts it there, behind Deputy's own gate.

Decisions:

- `context` is empty (my call). The only router brand and model HomeNet has come from the router's UPnP description, which is text the router (or whoever set it up) wrote, so it is not HomeNet's own words.
- `apps` and `ref` are never sent (my call): the owner picks the router app in Deputy's draft; guessing a package would be wrong for most homes.
- New-device pings are not rate-limited (my call): the check runs every 3 hours at most. A new-device ping also resets the one-minute presence window.
- One pending hand-off at a time (my call): a second tap while Deputy is open answers `busy`. The promise settles once through an `AtomicReference`, and `OnDestroy` settles it as `cancelled`.
- `<queries>` for `com.haroon.deputy` and `com.haroon.halo` (replaces the earlier "no entry" call): `AppLinkTarget` needs package visibility to resolve and check the sibling, so without them every check answers "not installed".
- The heartbeat lives next to the home-watch state in `homenet_home_watch` SharedPreferences (my call), not in the JSON state, so a query never parses the state for it.

Known limits: Halo receives the ping only once its manifest holds `<uses-permission android:name="com.haroon.permission.AUTOPILOT" />` and declares the receiver (Halo's side, not built here). The heartbeat is written only if the React context exists when the module is created; the background checks write it too.

Verified (2026-11-24): `@apps-hub/core` 358/358, core and netlens typecheck clean, `@apps-hub/app-link-contract` 133/133, Gradle `:netlens-core:testDebugUnitTest :app:assembleDebug` BUILD SUCCESSFUL with 71 JVM tests (ChangedPingTest 5, DeputyProposalTest 6, HomeLinkProviderShareTest 5, TcpProbeClassifierTest 5 and the rest), merged manifest has the provider behind the signature permission. iOS build not run (no Pods); `swiftc -parse` of the module passes; Kotlin and Swift register the same 14 functions.

Phone checks (not run): see the P4 report.

## AppLinkTarget (2026-11-24)

`applink/AppLinkTarget.kt` (+ `AppLinkTargetTest.kt`) are the canonical copy-ins (only the `package` line differs). Two call sites: `proposeDeputyTask` in `NetlensCoreModule.kt` runs `AppLinkTarget.trustedActivity(activity, intent)` before `startActivityForResult` (false resolves `not_installed`, nothing is sent), and `HomeWatch.ping` in `HomeWatchWork.kt` runs `trustedReceiver` before the CHANGED broadcast to Halo. The rate-limit claim is taken only after the trust check passes, so a refused ping never uses up the one-minute window. Seams for JVM tests: `DeputyProposal.start(trusted, go)` and `ChangedPing.deliver(trusted, claim, send)` (tests in `DeputyProposalTest` and `ChangedPingTest`). The module manifest holds the `<queries>` entries for Deputy and Halo. Phone check not run: with Deputy or Halo uninstalled HomeNet says not installed and sends nothing; with Store-signed siblings it works as before.

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

All five phases are built and reviewed; branch HEAD `907804f5`; draft PR #47 (https://github.com/haroongondal/apps-hub/pull/47) is not yet updated for Phase 5. Nothing has run on a phone and the iOS build is not done.
Next: the main session pushes, updates PR #47's body (what is verified, what is not: no phone test, iOS build not run, iOS Wake likely needs the multicast entitlement, open Minors above) and asks the owner for the go. The owner (or an approved session) runs `pod install --no-repo-update` in `apps/netlens/ios`, then `xcodebuild -workspace NetLens.xcworkspace -scheme NetLens -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -configuration Debug build CODE_SIGNING_ALLOWED=NO`.
On the owner's go: merge with `[skip ci]`, run `pnpm release` locally, install via the Store on the phone through coord (claim `device:<ro.serialno>`), then check each feature at home, including Review Focus 5 with TunnelWall connected.

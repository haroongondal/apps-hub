# HomeNet toolbox handoff

## Resume prompt (2026-11-18)

Continue the HomeNet toolbox build. Work only in the worktree
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

## Verified facts

- Native `tcpFetch` accepts any IP: the LAN guard must live in TS (Task 1).
- `parseHttpResponse` exists in `packages/core/src/name-formats.ts`; no `JSON.parse` exists in core yet.
- Scan keeps only the last SSDP event per IP (`ScannerScreen.tsx`), fixed in Task 5.
- `lanBinder` (Kotlin) binds only private/link-local targets to Wi-Fi.
- HomeNet version in `apps/netlens/app.json` is `0.1.0`; versionCode comes from the release tool.
- Worktree setup: `pnpm install` ok; `@apps-hub/core` tests 115/115 pass; core + netlens typecheck clean (2026-11-18).

## File map

- Plan / spec: `docs/superpowers/plans/2026-11-18-homenet-toolbox.md`, `docs/superpowers/specs/2026-11-18-homenet-toolbox-design.md`
- Orchestration workspace (git-excluded): `.orchestration/` (phase briefs, `progress.md` ledgers, `shared-files.txt`, `locks/`)
- Core logic: `packages/core/src/*.ts`; app: `apps/netlens/src`, native: `apps/netlens/modules/netlens-core`

## Session log

- 2026-11-18: design approved; plan written; Task 0 done (commits `5b0c11ae` port check, `dd1ce571` docs). Phase 1 agent started.
- 2026-11-18: Phase 1 run 1 PARTIAL at cap: Tasks 1, 2, 4 done (`05113574`, `05a3bd7e`, `efa4696b`, `ac4c6d41`); Task 3 `2bff3a29` reviewed with open I1 (quadratic regex), I2 (negative rate on 64-bit reset), m1–m6. Resume agent started with `.orchestration/phase-1-resume-brief.md`.
- 2026-11-18: Phase 1 DONE. Fix `e27ebda2` re-reviewed clean. Main-session gate at e27ebda2: core tests 180/180, core + netlens typecheck clean, tree clean. Deferred minors: n1 (rateBps fake tick on 64-bit reset → Phase 2), n2 (`upnp-soap.ts` ~61 unclosed child hides later values) and parked (`httpRequest` TypeError on null args) → Task 18 review batch. Phase 2 agent started with `.orchestration/phase-2-brief.md`.
- 2026-11-18: Phase 2 DONE (HEAD `a9f647a4`): `133b1597` locations per device, `ee17edfc` rate meter 64-bit reset fix, `979c9b54` detection, `89894496` actions, `e62e5856` device remotes UI, `a9f647a4` review fixes (F1–F5). Reviewed (Tasks 6, 7, n1 + fix re-review). Main-session gate at `a9f647a4`: core tests 210/210, core + netlens typecheck clean, tree clean, no attribution lines. Rule learned: a 401 counts as a locked Tasmota plug only when the JSON body has a string `WARNING`. NOT yet verified on a real device: Roku/Shelly/Tasmota/WLED/Sonos reply shapes come from fixtures; the Task 8 screens are typechecked only. Carried to Task 18: n2, parked httpRequest null-args TypeError, misplaced comment at `igd.ts:32`. Phase 3 agent started with `.orchestration/phase-3-brief.md`.
- 2026-11-18: Phase 3 DONE (HEAD `1aaba37d`): `55a1dcf4`+`54228b1f` schema v2 (migration reviewed against a node:sqlite fake: v0/v1/empty DBs reach 2, failures roll back), `bdcb3972` who's-home logic, `edd94283` shared ScanProvider, `a4e0d8c0` Home tab, `1aaba37d` fix (carried person tag survives saving the sheet; `saveDevice(id, patch)`). Main-session gate: core tests 234/234, typecheck clean, tree clean, no attribution lines. Not run in real expo-sqlite or the phone. Risk found by main session: `carryPersonTags` can move a tag through a generic name ("iPhone", "android") → Phase 4 carry-in C1. Carried to Task 18: M-5 stale header address after Wi-Fi change, Task 9 m2 migration race (unreachable), plus earlier n2/parked/comment items. Phase 4 agent started with `.orchestration/phase-4-brief.md`.

## Current state + exact next step

Phase 4 (Tasks 13–17 + carry-ins C1, Task 9 m1, M-2) running under `.orchestration/phase-4-brief.md`; ledger `.orchestration/progress.md` (`## Phase 4`).
Next: read its report; on DONE run the gate (`pnpm --filter @apps-hub/core test && pnpm --filter @apps-hub/core --filter netlens typecheck`, the Android Gradle gate, `git status --short`), update this file, then Phase 5 / Task 18 (bump `apps/netlens/app.json` to 0.2.0, docs via docs-keeper, full gates incl. iOS build and `pnpm doctor`, invariant-reviewer + code-reviewer over `main...homenet-toolbox`, deferred minors batch), then ask the owner for the go before any merge or release.

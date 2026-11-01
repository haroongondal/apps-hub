# Handoff: network toolkit (HomeNet + TunnelWall)

## Resume prompt

```
Today is 2026-11-01. Repo: /Users/outsentia/Documents/apps-hub (monorepo, read AGENTS.md and
CLAUDE.md first). This work's handoff lives on branch `firewall-spike`, checked out in the
worktree /Users/outsentia/Documents/apps-hub/.claude/worktrees/firewall-spike.

1. Read /Users/outsentia/Documents/apps-hub/.claude/worktrees/firewall-spike/docs/handoffs/network-toolkit.md
   completely first, then docs/handoffs/firewall-spike-results.md and
   docs/superpowers/specs/2026-10-30-network-toolkit-design.md (Part 2) in that worktree.
2. Trust the "Verified facts" and the spike results; do not redo that work.
3. Follow the same handoff contract: keep this file updated (session log, current state) as
   milestones land; at ~85% context stop, finalize, and print a new resume prompt.
4. Do not touch the main checkout's working tree: it is on `deputy-speed` with the owner's
   uncommitted work.
5. Continue from "Current state + exact next step".
```

## Goal and fixed constraints

- Rename visible app names: NetLens → **HomeNet**, OpenTunnel → **TunnelWall**.
  Package IDs, bundle IDs, folders, workspace names, brand keys unchanged. (Done, released.)
- HomeNet: real device names (reverse DNS, mDNS instance names, SSDP friendlyName, NetBIOS).
  No ARP (hard rule 1). (Done, released.)
- TunnelWall: Android-only app firewall with full traffic through an in-app stack (firestack),
  per-app data use, per-app rules (allow / block on mobile / block always), local activity log,
  one-tap pause. v1 runs only while not connected to a VPN server. (Spike done; full build next.)
- Private Store only; the owner is the only user. Install through the Store, never adb. One
  owner-approved exception: the spike's debug build over wireless debugging on 2026-11-01.
- A push to `main` auto-releases affected apps through CI (`.md`-only changes release nothing).
  Merging or pushing to `main` is the owner's call.

## Decisions made (with why)

- Firewall in TunnelWall, not HomeNet: one VPN slot per phone; TunnelWall already owns it.
- Full-traffic firewall over DNS-only or block-only: the owner wants airtight blocking and a full
  connection log.
- v1 firewall off while connected to a server: engines host their own VpnService; filtering inside
  a tunnel is a separate later project.
- Visible-name-only rename: changing package IDs would force reinstalls and lose data.
- HomeNet names: PTR goes to the gateway over raw UDP 53; SSDP descriptions over raw TCP HTTP/1.0;
  mDNS browses six fixed types (`_googlecast`, `_airplay`, `_ipp`, `_smb`, `_hap`,
  `_companion-link`), max 6 browsers (NSD allows a client about 10 outstanding requests). Names
  never touch the identity key. Spec: `docs/netlens/SPEC.md` section 3.6.
- firestack (MPL-2.0, Maven Central AAR `com.celzero:firestack:d3d530ea3e`, the version RethinkDNS
  v0.5.8 pins) as the packet engine: no Go toolchain in our build; NetGuard (GPLv3) is incompatible
  with GPL-2.0-only and the repo is public.
- The spike ran as a separate app (`com.opentunnel.open_tunnel_vpn.spike`, TunnelWall's code on a
  branch) so TunnelWall itself never carried experimental code; the owner asked why and accepted it.
- **The full firewall must run in its own process** (`android:process=":firewall"`): firestack and
  WireGuard's Go runtimes crash each other in one process. This changes the design's "new firewall
  role in OpenTunnelVpnService"; the full plan must use a separate service class in that process and
  share rules and the log through storage (not memory).
- 2026-11-01: the owner called the spike "tested" and asked what's next. My reading (confirm with
  the owner): the three checks the spike did not do (Private DNS automatic and strict, Always-on
  after a reboot, the two-night battery comparison) move into the acceptance checks of the real
  TunnelWall build.

## Verified facts (don't re-derive)

- HomeNet + rename: merged to `main` (0df03fd, == origin/main) and released through CI on
  2026-10-31 (HomeNet build 7, TunnelWall build 8). `pnpm test` 228 pass / 0 fail and
  `pnpm typecheck` clean at that commit. Owner's on-phone HomeNet checks not reported yet.
- Spike results, all in `docs/handoffs/firewall-spike-results.md` (branch `firewall-spike`):
  emulator and the owner's phone (Redmi 24116RACCG, HyperOS 3.0, Android 16). Passed: +6.5 MB
  arm64 APK, traffic and DNS through firestack (network VALIDATED), real app names on HyperOS
  (incl. Xiaomi push/analytics), domains on flows, per-app blocking (25/25 Chrome flows), WireGuard
  hand-over with the firewall in `:firewall` (no crash), idle 0.0% CPU, ~150–180 MB resident.
- Integration rules the full build must keep (each one broke a spike run):
  1. Flows to the tun's own DNS: port 853 → `Backend.Block` (Android falls back to 53),
     port 53 → `Backend.Base` (never `Exit`).
  2. `fakedns` is `host:port`: `"100.127.222.3:53,[fd66:f83a:c650::3]:53"` (firestack's
     `Connect2` bare-IP default leaves the DNS list empty).
  3. `Intra.setSystemDNS(tunnel, csv)` with a NON-VPN network's DNS servers (not `activeNetwork`
     while another VPN is up).
  4. `bind4`, `bind6` and `protect` must all call `VpnService.protect(fd)`.
  5. The earlier VpnService of the same app gets NO `onRevoke` when the other one establishes:
     the controller must stop the firewall before starting an engine.
  6. Package names need `QUERY_ALL_PACKAGES` (the real manifest removes it on purpose).
  7. Tun range `100.127.222.0/24` + `fd66:f83a:c650::/120` (firestack's default `10.111.222.0/24`
     sits inside the LAN exclusion).
- The universal Store APK grows ~27–29 MB with firestack (4 ABIs); arm64 on device +19.8 MB.
- `OpenTunnelVpnService` builds its own tun for hosted engines; WireGuard GoBackend and
  ics-openvpn host their own VpnService classes.
- Phone access: wireless debugging serial `adb-49kjmnuwonkffqzh-zHnffO._adb-tls-connect._tcp`
  (HyperOS "Install via USB" is now on). Emulator AVD `apps-hub-test` (Android 35 arm64). Android
  env: `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`,
  `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`.
- The release tool on `main` has no GitHub `apks` upload step; that step exists only in the
  owner's uncommitted `deputy-speed` changes.
- Repo `haroongondal/apps-hub` is public.

## File map

- Design: `docs/superpowers/specs/2026-10-30-network-toolkit-design.md` (Part 2 = firewall)
- Plans: `docs/superpowers/plans/2026-10-31-homenet-names-and-rename.md` (done),
  `docs/superpowers/plans/2026-10-31-tunnelwall-firewall-spike.md` (Tasks 1–3 done, Task 4 open)
- Spike results: `docs/handoffs/firewall-spike-results.md` (branch `firewall-spike`)
- Spike code (reference for the real build, not to merge): `apps/open_tunnel_vpn/android/app/src/main/java/com/opentunnel/open_tunnel_vpn/spike/FirewallSpikeService.kt`
  (Bridge implementation, tun builder, DNS rules) and `SpikeActivity.kt` (test screen)
- Spike Store entry: `tools/release/src/apps.ts` key `tunnelwall-spike` (`manualOnly`, branch only)
- TunnelWall: `apps/open_tunnel_vpn/`, `apps/open_tunnel_vpn/modules/open-tunnel-native/`,
  `android/app/src/main/java/com/opentunnel/open_tunnel_vpn/OpenTunnelVpnService.kt`, `engines/`
- HomeNet: `apps/netlens/`, `packages/core/src/device-names.ts`, `name-formats.ts`,
  `name-resolver.ts`, native `NameProbes.kt` / `.swift`, `MdnsProbe.kt` / `MdnsBrowser.swift`
- Stale copies to ignore: `docs/handoffs/network-toolkit.md` and `docs/superpowers/` sitting
  untracked in the main checkout (`deputy-speed`); the real files are on `main` and this branch.

## Session log

- 2026-10-30: brainstormed with owner; design drafted; builder check dispatched.
- 2026-10-31: design approved; HomeNet plan executed (8 tasks, subagent-driven, per-task reviews,
  final opus review "ready to merge", one fix wave); merged and released.
- 2026-10-31: firewall spike Tasks 1–2 on the emulator: firestack builds and works; found and
  fixed four integration bugs; found the two-Go-runtime crash and proved the separate-process fix.
- 2026-11-01: spike on the owner's phone over wireless debugging (owner's request): all checks
  passed. Released through the Store: Store build 11 (its `<queries>` lists the spike) and
  Firewall spike build 2. Branch `firewall-spike` pushed to `origin/firewall-spike`.
- 2026-11-01: owner: "it's tested now, what's next"; asked for this handoff.

## Current state + exact next step

The spike is effectively done; the firewall goes into TunnelWall next. In order:

1. **Confirm with the owner** (one message): (a) the three untested checks move into the real
   build's acceptance tests; (b) remove the Firewall spike now (owner uninstalls it; you delete its
   Store manifest entry and APK through the same admin API `tools/release` uses, since there is no
   CLI command) or keep it for one battery night first; (c) Store APK: accept +~29 MB universal, or
   switch TunnelWall's Store build to arm64-only.
2. **Spike Task 4 (close-out):** write a short verdict ("go, firewall in its own process", plus the
   seven integration rules) into `docs/handoffs/network-toolkit.md` on `main`. Pushing that to
   `main` releases nothing (docs only) but still needs the owner's OK. Keep branch
   `firewall-spike`; do not merge it.
3. **Amend the design** (Part 2, "Service" and "Architecture") for the separate `:firewall`
   process, storage-shared rules and log, and the seven integration rules. Show the owner the delta.
4. **Write the full firewall plan** with superpowers:writing-plans, branch from `main` in a new
   worktree, using the spike service as the reference implementation. Acceptance checks must
   include Private DNS automatic and strict, Always-on after a reboot, and the two-night battery
   comparison (≤ 3 points), on the owner's phone through the Store.

Also open, not blocking:
- HomeNet: the owner's four phone checks (device list kept with no false "New" badges, names shown
  with sources, no crash leaving mid-scan, no invented hosts while TunnelWall is connected).
- Product decision: when a different machine takes over an IP, the HomeNet row keeps the old custom
  name and trusted flag (identity is IP-based, FR-4).
- HomeNet follow-ups: save-failure copy reuses "The scan didn't finish"; `\DDD` escapes decode per
  byte; pre-API-34 NSD resolves are not stopped on timeout.
- The next Store release from `main` drops the spike's `<queries>` entry; that is fine.

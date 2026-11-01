# Handoff: network toolkit (HomeNet + TunnelWall)

## Resume prompt

```
Today is 2026-10-31. Read docs/handoffs/network-toolkit.md completely first, then
the design at docs/superpowers/specs/2026-10-30-network-toolkit-design.md.
Trust the verified facts there and do not redo that work. Follow the same
handoff contract (update the session log and current state as milestones
land; at ~85% context, finalize and print a new resume prompt). Continue from
"Current state + exact next step".
```

## Goal and fixed constraints

- Rename visible app names: NetLens → **HomeNet**, OpenTunnel → **TunnelWall**.
  Package IDs, bundle IDs, folders, workspace names, brand keys unchanged.
- HomeNet: real device names (reverse DNS, mDNS instance names, SSDP
  friendlyName, NetBIOS). No ARP (hard rule 1).
- TunnelWall: Android-only app firewall with full traffic through an in-app
  stack (firestack), per-app data use, per-app rules (allow / block on mobile
  / block always), local activity log, one-tap pause. v1 runs only while not
  connected to a VPN server.
- Private Store only; the owner is the only user. Install via the Store,
  never adb.

## Decisions made (with why)

- Firewall in TunnelWall, not HomeNet: one VPN slot per phone; TunnelWall
  already owns it.
- Full-traffic firewall over DNS-only or block-only: the owner wants airtight
  blocking and a full connection log.
- v1 firewall off while connected to a server: engines host their own
  VpnService; filtering inside a tunnel is a separate later project.
- Visible-name-only rename: changing package IDs would force reinstalls and
  lose data.
- HomeNet names (built, on branch `homenet-names`): PTR goes to the gateway
  over raw UDP 53 (the router knows the DHCP names); SSDP descriptions come
  over raw TCP HTTP/1.0, so Android needs no cleartext network config;
  mDNS browses six fixed types (`_googlecast`, `_airplay`, `_ipp`, `_smb`,
  `_hap`, `_companion-link`), max 6 browsers, because NSD allows a client
  about 10 outstanding requests. Devices that advertise only other types get
  no Bonjour name on Android. iOS browses the same six, so the platforms
  match. Spec: `docs/netlens/SPEC.md` section 3.6.
- Where the code departs from the design: PTR goes to the gateway instead of
  the system resolver; six mDNS types instead of nine; `model` is not in the
  display order; the timing bound is ceil(n/16) × 1.75 s, which passes the
  design's 5 s above 32 devices.
- Names never touch the identity key, so existing devices keep their rows and
  show no false "New" badge.
- firestack (MPL-2.0, Maven Central AAR) as the packet engine: no Go
  toolchain in our build; NetGuard (GPLv3) is incompatible with
  GPL-2.0-only and the repo is public.

## Verified facts (don't re-derive)

- Gates reported during the build (last full run at Task 7, 9f800d1):
  `pnpm test` and `pnpm typecheck` pass in all 19 projects; Android
  `:app:assembleDebug` succeeds (21 JVM tests green at caac33f); iOS simulator
  build succeeds. Not run on a phone yet; the mDNS paths are compile-verified
  only.
- Before the names work (historical): NetLens label order:
  `ScannerScreen.tsx:72`; `hostname` never filled
  (`ScannerScreen.tsx:183-188`); mDNS collects types only.
- `deriveIdentityKey` (`packages/core/src/device-repository.ts:98`) is
  USN → hostname → IP. Names are written after reconcile and nothing passes a
  hostname into the enrichment, so identity keys don't change.
- Before the names work (historical): iOS NetLens `NSBonjourServices` held
  only `_services._dns-sd._udp` and `_http._tcp`. On `homenet-names` it holds
  eight entries: those two plus the six browse types (app.json + Info.plist).
- `OpenTunnelVpnService` builds its own tun for hosted engines
  (`buildHostInterface`); WireGuard GoBackend hosts its own VpnService;
  ics-openvpn hosts its own too.
- No installed-app picker exists in OpenTunnel; `disallowedApps` plumbing
  has no UI.
- Repo `haroongondal/apps-hub` is public.
- firestack: MPL-2.0, `com.celzero:firestack`, API unstable and
  undocumented; RethinkDNS is the reference integration.
- Visible names live in: app.json `name`, strings.xml `app_name`,
  Info.plist `CFBundleDisplayName`, `tools/release/src/apps.ts`,
  `OpenTunnelVpnService.kt` (`setSession`, `setContentTitle`).

## File map

- Design: `docs/superpowers/specs/2026-10-30-network-toolkit-design.md`
- Plans: `docs/superpowers/plans/2026-10-31-homenet-names-and-rename.md`,
  `docs/superpowers/plans/2026-10-31-tunnelwall-firewall-spike.md`
- CI: a push to `main` auto-releases affected apps; the spike branch is
  never merged.
- HomeNet: `apps/netlens/`, `apps/netlens/modules/netlens-core/`,
  `packages/core/`
- HomeNet names: `packages/core/src/device-names.ts` (sanitise, order, merge),
  `name-formats.ts` (DNS, NetBIOS, SSDP formats), `name-resolver.ts`
  (bounded lookups); native `NameProbes.kt` / `NameProbes.swift`
  (`udpRequest`, `tcpFetch`), `MdnsProbe.kt` / `MdnsBrowser.swift` (instance
  names); `apps/netlens/src/screens/ScannerScreen.tsx` (wiring),
  `apps/netlens/src/db/device-store-sqlite.ts` (migration, `user_version` 1).
- TunnelWall: `apps/open_tunnel_vpn/`,
  `apps/open_tunnel_vpn/modules/open-tunnel-native/`

## Session log

- 2026-10-30: brainstormed with owner; design drafted; builder check
  dispatched.
- 2026-10-31: builder check answered as my calls in the design: LAN ranges
  and HomeNet excluded from the firewall tun; DNS mirrors the phone's
  Private DNS (never downgrades); spike on emulator, then a throwaway spike
  app via the Store; pass line of 30 MB APK and 3 points of overnight
  battery; re-allow QUERY_ALL_PACKAGES; Always-on service check.

- 2026-10-31: owner approved the design. Plans written:
  `docs/superpowers/plans/2026-10-31-homenet-names-and-rename.md` (8 tasks)
  and `docs/superpowers/plans/2026-10-31-tunnelwall-firewall-spike.md`
  (4 tasks). The full firewall plan waits for the spike verdict.

- 2026-10-31: owner said "go ahead" (subagent-driven for the HomeNet plan).
  Worktree `.claude/worktrees/homenet-names`, branch `homenet-names` from
  `origin/main` 6daca33, upstream unset (never pushed). Tasks 1–6 done and
  reviewed (commits 1e7abea..635ef6c). Progress ledger with every ruling:
  `.superpowers/sdd/2026-10-31-homenet-names-and-rename/progress.md` inside
  the worktree (git-ignored via .git/info/exclude).

- 2026-10-31: HomeNet plan Tasks 1-8 done on branch `homenet-names`. Task 7
  (app wiring, migration; commits 9f800d1, b211270) and Task 8 (SPEC section
  3.6 and this handoff) landed after Tasks 1-6. Not merged, not pushed.

- 2026-10-31: final whole-branch review (opus): ready to merge, no
  Critical or Important findings. One fix wave applied its follow-ups
  (commits 8dbaa3e..3835197): stale names dropped when a different hostname
  answers at an IP, Android NSD resolves stopped on timeout, CDATA and
  numeric references decoded in UPnP names, SQLite writes serialized, no
  lookups for a dead scan, README rename. Full checks at head: `pnpm test`
  228 pass / 0 fail, `pnpm typecheck` clean, netlens Gradle gate green.

- 2026-10-31: HomeNet names and the rename merged to `main` and released (HomeNet build 7,
  TunnelWall build 8). Firewall spike started in worktree `.claude/worktrees/firewall-spike`,
  branch `firewall-spike` (never merged, never pushed). Spike Tasks 1 and 2 done on the
  emulator; results and the integration rules are in
  `docs/handoffs/firewall-spike-results.md` on that branch.

## Current state + exact next step

Spike plan: Tasks 1 and 2 done. Headline: firestack and WireGuard's Go runtimes crash if they
share a process; running the firewall service in its own process (`android:process=":firewall"`)
fixes it in both orders, so the full plan must use a separate firewall process. Size (+6.5 MB
arm64), traffic, app attribution and per-app blocking all pass on the emulator.

Task 3 progress: the phone run passed (see the results file); the spike is released through the Store
(Store build 11, Firewall spike build 2) and branch `firewall-spike` is pushed to origin (never to
`main`). Next, owner-dependent: install Firewall spike from the Store, then Private DNS automatic and
strict, Always-on after a reboot, and two overnight battery runs (firewall on, then off). Then Task 4:
verdict on `main`, remove the Store entry, keep the branch.

Do not merge `firewall-spike` or push it to `main`. Releasing anything from it is a publish to the owner's
Store: ask first.

Open product decision for the owner: when a different machine takes over an IP, the HomeNet row
keeps the old custom name and trusted flag (identity is IP-based, FR-4).

Known HomeNet follow-ups (not blocking): save-failure copy reuses "The scan didn't finish";
`\DDD` escapes decode per byte; pre-API-34 NSD resolves are not stopped on timeout.

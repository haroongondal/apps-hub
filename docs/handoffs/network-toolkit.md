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
- CI: a push to `main` auto-releases affected apps; the spike is never
  merged (its branch is deleted; the code is kept at tag `archive/firewall-spike`).
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

- 2026-11-03: deleted the local and remote `firewall-spike` branches and its
  worktree. The last spike commit (`a3e09f1`) is kept at tag
  `archive/firewall-spike` on origin. The spike's code is not on this branch;
  the firewall here is a new implementation that uses the same firestack
  version. The spike's open device checks are still open.

- 2026-11-03: the owner gave autonomy, so the three spec gaps the final review
  parked for the owner were built as spec-literal calls (commit `0bcdbd8`):
  Private DNS mode and provider in `FirewallStatus.privateDns` (strict mode
  shows the "set Private DNS to Automatic" line); data use since a start time,
  Today or This month (`getDataUse(sinceMs)`, validated in the adapter and in
  Kotlin); a Clear log row on the existing native clear. Gates on the branch:
  `pnpm --filter open_tunnel_vpn test` 99/0, `typecheck` clean, Gradle
  `:open-tunnel-native:testDebugUnitTest` and `:app:assembleDebug` green
  (PrivateDnsTest 2/0, DataUseReaderTest 4/0). Not on a phone.

## Current state + exact next step

HomeNet names are merged to `main` (the `homenet-names` branch is gone). The
owner's four phone checks below are still open.

Open product decision for the owner: when a different machine takes over an
IP, the row keeps the old custom name and trusted flag (identity is IP-based,
FR-4, unchanged by this branch).

Known follow-ups (not blocking): save-failure copy reuses "The scan didn't
finish"; `\DDD` escapes decode per byte (UTF-8 names would garble, rare);
pre-API-34 NSD resolves are not stopped on timeout.

After the Store release, the owner checks on the phone:

1. The existing device list is kept, with no false "New" badges.
2. Most devices are named, and the detail sheet shows each source.
3. Leaving the screen mid-scan doesn't crash.
4. Scanning while TunnelWall is connected to a server shows no invented hosts.

TunnelWall firewall, branch `tunnelwall-firewall` (three commits ahead of origin's
`d76b901`, none pushed: `f4e5116`, `0bcdbd8`, `ab53d26`):

- Final review passed (`progress.md` in `.superpowers/sdd/2026-11-01-tunnelwall-firewall/`).
  The spec gaps R35 to R37 are built (2026-11-03 log).
- Left as the reviewer found them, to accept before release: R39 (a failed
  start keeps the switch on, so Always-on retries at boot) and the change that
  a paused firewall ends Off after a server connection. Claude's default is
  to keep both.
- The spike's open device checks still apply to this build: Private DNS strict
  (`dns.google`), Always-on after a reboot, two battery nights.

Next, in order: (1) the owner's go-ahead to release. Pushing or merging to
`main` auto-releases both apps through the Store, so do not push or merge
without it. (2) Phone check: the firewall checks above, plus the HomeNet checks
if HomeNet has not been checked yet.

## TunnelWall protection: kill switch, best relay, Trusted Wi-Fi (eco C3, 2026-11-23)

Branch `eco/tunnelwall` (worktree `apps-hub-wt/eco-tunnelwall`), three code commits on top of
`f595c4a9`: `73fcb21e` (kill switch), `c13b0e52` (best relay), `93bccc5a` (Trusted Wi-Fi). Not
pushed, not on a phone.

### What was there before (recon)

- `enableKillSwitch` reached the service, but both engines host their own VpnService
  (ics-openvpn's `OpenVPNService`, WireGuard's `GoBackend$VpnService`), so on the live path the
  switch did nothing on Android. Only the unused hosted path called `Builder.setBlocking(true)`,
  which only puts the tun fd in blocking-read mode; it is not a kill switch (removed).
- ics-openvpn already covers `reasserting`: its `getTunReopenStatus` answers only `NOACTION` or
  `OPEN_BEFORE_CLOSE` (javap of the AAR), so its own reconnect has no gap.
- The real leak windows: a relay switch (App.tsx stopped, then started), the engine ending (drop,
  auth failure, failed failover), the app process dying, and boot.
- Auto-select with failover already existed in App.tsx (`pickRelayCandidates`, `settled`).

### Built

- Kill switch (Android): once a tunnel has connected with the switch on ("armed"),
  `OpenTunnelVpnService` holds its own interface (IPv4 `100.127.223.1/32` + `0.0.0.0/0`, IPv6
  `fd00::2/128` + `::/0`, never read) whenever no engine interface is up: before the old engine
  stops on a relay switch, after the engine ends, after a failed start, and at an Always-on start
  when the process had died armed (`kill_switch` SharedPreferences, one boolean). The app's own
  package is outside the block so it can fetch VPN Gate and probe relays. The service keeps its
  foreground notice ("Internet is blocked until the VPN reconnects") and the server-active flag,
  so the firewall cannot take the slot. Lifted by: a relay connecting (its interface replaces
  the block), Disconnect or Stop blocking, or any revoke. Decisions: `KillSwitch.kt` (JVM test).
  App view: `src/tunnel/kill-switch.ts` (`connected | reconnecting | blocked | off`).
- Lockdown hint: the service reads `VpnService.isAlwaysOn()` / `isLockdownEnabled()` (API 29,
  instance methods, so only known after it ran in this process). `getKillSwitchStatus()` returns
  `{blocking, alwaysOn, lockdown}`; the settings row says what is on and opens
  `Settings.ACTION_VPN_SETTINGS`.
- iOS: `includeAllNetworks = enableKillSwitch` (iOS 14, below the 15.1 target) next to the
  existing `NEOnDemandRuleConnect`; a user stop turns on-demand off first so the OS does not bring
  the tunnel back. Compile not verified here (no Pods in the worktree); iOS engines stay gated.
- Connect to the best relay: `connectRankedRelay` in `packages/open-tunnel-core/src/best-relay.ts`
  over the LatencyProber ranking (fitness formula unchanged, 8 probes at a time, listed ping as
  fallback), max 6 attempts, failed relays skipped, cancel stops; App.tsx runs it; plain-words
  failure copy in `relay-failover.ts`.
- Trusted Wi-Fi (off by default; owner decision pending): Settings > Trusted Wi-Fi. Module
  `startNetworkWatch`/`stopNetworkWatch` + `onNetworkChanged`
  (`registerBestMatchingNetworkCallback`, non-VPN internet request, `FLAG_INCLUDE_LOCATION_INFO`,
  changes only). Logic in `src/tunnel/trusted-wifi.ts`; list in the local sqlite settings.

### Decisions (my call)

- Kill switch arms only after a connect succeeded: a dead relay on a first connect must not take
  the internet away. A process that died armed stays armed for the next start and for an
  Always-on start (the user's last intent was "VPN on").
- Any revoke disarms (ics logs `permission_revoked` from its `onRevoke`; `OpenVpnEngine` passes
  `EXTRA_REVOKED`): the user or another VPN app took the slot, and blocking would take it back.
- At an Always-on start with the switch armed, the block wins over the firewall; Stop blocking
  gives the slot back to the firewall if it was on and not paused.
- A relay switch with the switch on skips the app's explicit stop: the native START replaces the
  engine with the block held in between (Android only; iOS and switch-off keep stop-then-start).
- Trusted Wi-Fi identifies a network by SSID plus BSSID, which needs precise location on
  Android 10+ (asked only when the switch is turned on). A no-permission fingerprint (gateway
  address, DNS servers) was rejected: home routers share `192.168.1.1`, and a false match means
  no VPN on a stranger's network. Unreadable names count as not trusted (the safe direction).
- Trusted Wi-Fi needs Android 12+ (the location-info callback); older Android and iOS reject
  `ERR_NOT_SUPPORTED`. iOS `NEOnDemandRuleDisconnect` per SSID was not built: no iOS engine can
  start and reading the SSID needs the Access WiFi Information entitlement.
- No new service: the watch runs while the app's JS runtime is alive (app open, or in the
  background while connected or blocking). Turning the switch on never connects on the network
  you are on right then; each network is decided once, so a manual disconnect sticks until the
  network changes. Trusted networks never auto-disconnect.

### Not proven (needs the phone)

All of it: the block actually black-holes traffic on HyperOS, the switch gap, Always-on restart
after a process kill, ics revoke detection, the SSID/BSSID reads, background behaviour.

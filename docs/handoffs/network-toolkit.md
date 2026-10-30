# Handoff: network toolkit (HomeNet + TunnelWall)

## Resume prompt

```
Today is <date>. Read docs/handoffs/network-toolkit.md completely first, then
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
- firestack (MPL-2.0, Maven Central AAR) as the packet engine: no Go
  toolchain in our build; NetGuard (GPLv3) is incompatible with
  GPL-2.0-only and the repo is public.

## Verified facts (don't re-derive)

- NetLens label order: `ScannerScreen.tsx:72`; `hostname` never filled
  (`ScannerScreen.tsx:183-188`); mDNS collects types only.
- `deriveIdentityKey` (`packages/core/src/device-repository.ts:93`) is
  USN → hostname → IP, so filling hostname would re-key known devices.
- iOS NetLens `NSBonjourServices`: `_services._dns-sd._udp`, `_http._tcp`
  only (app.json + Info.plist).
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

## Current state + exact next step

Plans written and waiting for the owner's review and choice of execution
method. Next: execute the HomeNet plan from Task 1 in a worktree from `main`.
The spike can start in parallel in its own `firewall-spike` worktree. Nothing is committed yet; the branch at the
time was `deputy-speed`, which carries unrelated Deputy work, so branch
from `main` before committing this.

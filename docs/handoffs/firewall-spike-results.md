# TunnelWall firewall spike: results so far (2026-10-31, phone run 2026-11-01)

Branch `firewall-spike` (never merged, never pushed to `main`). Plan:
`docs/superpowers/plans/2026-10-31-tunnelwall-firewall-spike.md`. Engine: firestack
`com.celzero:firestack:d3d530ea3e` (MPL-2.0; the version RethinkDNS v0.5.8 pins).
Emulator: `apps-hub-test`, Android 35 arm64, plus the owner's phone (section below). Still open:
Private DNS modes, Always-on after a reboot, overnight battery.

## Pass line

| Check | Result |
|---|---|
| Builds next to WireGuard and ics-openvpn, no clash at build time | PASS (debug and release, 0 duplicate class or file errors) |
| arm64 release APK growth ≤ 30 MB | PASS: 17,875,394 to 24,683,605 bytes (+6.5 MB) |
| Traffic flows | PASS: DNS through firestack, TCP flows with domains, Android marks the VPN network VALIDATED |
| Flow callback gives usable tuples | PASS: `proto src -> dst domains verdict` |
| `getConnectionOwnerUid` returns real app UIDs | PASS: gms, shell, chrome, the spike itself; netd shows as `uid:1051`; ICMP has no owner (`unknown`) |
| Block one app | PASS: all `com.android.chrome` flows got `Block` |
| Two Go runtimes in one process | FAIL in one process, PASS in two (below) |
| Overnight battery ≤ 3 points | NOT MEASURED (needs the phone) |

## The blocker and its fix

firestack's `libgojni.so` and WireGuard's `libwg-go.so` cannot run in the same process.
Starting the second one crashes the process with SIGSEGV within about 120 ms, in either order
(firewall then WireGuard: crash in `libwg-go.so`; WireGuard then firewall: crash in
`libgojni.so`). Each alone is stable. With the firewall service declared
`android:process=":firewall"` there was no crash in either order, and both interfaces coexisted.
**Any real build must run the firewall in its own process.** Anything that reads firewall state
from the UI process (log, rules) then needs a shared file or database, not memory. The spike log
already does this (`files/spike.log`).

## What the integration needs (each one cost a failed run)

1. **Flows to the tun's own DNS address.** Port 853 (Android Private DNS "Automatic" sends
   DNS-over-TLS there): return `Block`, so Android falls back to port 53. Port 53: return `Base`,
   not `Exit`. Otherwise firestack redials the tun address and floods (11,552 flows in 18 s, then
   SIGABRT).
2. **`fakedns` must be `host:port`**: `"100.127.222.3:53,[fd66:f83a:c650::3]:53"`. firestack's
   `Connect2` default (bare IPs) fails `netip.ParseAddrPort` and leaves the DNS list empty, so every
   lookup dials a server that does not exist.
3. **`Intra.setSystemDNS(tunnel, csv)` with the DNS servers of a non-VPN network.** Reading
   `activeNetwork` while another VPN is up returned that VPN's DNS (1.1.1.1).
4. **`bind4`, `bind6` and `protect` must all call `VpnService.protect(fd)`.** Empty bind hooks leave
   firestack's own sockets inside the tun.
5. **The earlier VPN service gets no `onRevoke`** when the same app's other `VpnService` establishes
   (checked both ways). The controller must stop the firewall before it starts an engine.
6. **Package names need `QUERY_ALL_PACKAGES`** (the real manifest removes it; re-allowed in the spike).
7. Tun range: firestack's default `10.111.222.0/24` sits inside the `10.0.0.0/8` LAN exclusion, so
   the spike uses `100.127.222.0/24`.

## Other measurements

- Idle firewall process on the emulator: 0.0% CPU, 144 MB resident.
- The Store serves a universal APK: firestack adds about 27 to 29 MB across four ABIs and 19.8 MB
  on the device for arm64. Consider an arm64-only Store build.
- HomeNet (`app.netlens`) is excluded from the tun: 0 of its flows reached the firewall during two
  scans. Devices-responding counts on the emulator are too noisy to compare (on: 161, 110;
  off: 106, 99, 120).

## Owner's phone (2026-11-01, Redmi 24116RACCG, HyperOS 3.0, Android 16)

Installed over wireless debugging at the owner's request (a one-off exception to the Store-only
rule; separate package `com.opentunnel.open_tunnel_vpn.spike`, debug build).

| Check | Result |
|---|---|
| Firewall starts in its own process | PASS: system DNS taken from the router (192.168.18.1), no crash |
| Traffic flows | PASS: 22 of 22 DNS answers complete; Android marks the VPN network VALIDATED |
| Real app names on this ROM | PASS: Google Play services, Gmail, Play Store, Google app, Xiaomi push (`com.xiaomi.xmsf`), `com.miui.analytics`, `com.facebook.services` |
| Domain names on flows | PASS (for example `mtalk.google.com`, `z-m-gateway.facebook.com`, an Aliyun load balancer for Xiaomi push) |
| Block one app | PASS: 25 of 25 Chrome flows blocked (QUIC and TCP, with domains); Chrome shows "This site can't be reached" |
| WireGuard starts while the firewall runs | PASS: no crash, both processes alive; WireGuard becomes the active VPN; the firewall again gets no `onRevoke` |
| Restore after the hand-over | PASS: stop + start the firewall, VALIDATED again |
| Idle firewall process | 0.0% CPU, 176 MB resident |

Private DNS was off on the phone, so the DNS-over-TLS rule was not exercised there.

Released through the Store on 2026-11-01: Store build 11 (its `<queries>` lists the spike) and
Firewall spike build 2 (`com.opentunnel.open_tunnel_vpn.spike`, 75.4 MB universal APK, release-signed;
the Store entry `tunnelwall-spike` is `manualOnly`, so CI never picks it). The wireless-debugging debug
copy was uninstalled first because its signing key differs. No GitHub `apks` copy: that upload step
is not on `main` yet.

## Not verified yet

Always-on start after a reboot (which service class starts), Private DNS automatic and strict
modes on the phone, and battery over two nights (firewall on, then off).

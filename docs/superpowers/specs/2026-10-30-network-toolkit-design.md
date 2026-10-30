# Network toolkit: HomeNet and TunnelWall

Date: 2026-10-30. Status: draft, waiting for owner approval.

## Two apps, split by what they look after

| App | Was | Looks after | Features |
|---|---|---|---|
| **HomeNet** | NetLens | the Wi-Fi network the phone is on | who's connected, with real names (Part 1); diagnostics (ping, DNS speed, "why is my internet slow"); new-device detection |
| **TunnelWall** | OpenTunnel | this phone's own traffic | VPN servers; public IP; app firewall, per-app data use, activity log, pause (Part 2) |

The owner gave me the call on which feature lives where. Nothing that exists
today moves. The firewall goes in TunnelWall because it uses the same
one-per-phone VPN slot as the VPN servers. The owner chose both names.

**Renaming changes only the visible name (my call).** Package IDs
(`app.netlens`, `com.opentunnel.open_tunnel_vpn`), bundle IDs, folder names,
workspace package names and the `@apps-hub/ui` brand keys all stay the same,
so the Store updates the installed apps in place and no data is lost. The
visible name lives in:

- `name` in each `app.json`;
- `app_name` in each Android `strings.xml`;
- `CFBundleDisplayName` in each iOS `Info.plist`;
- the Store listing (`tools/release/src/apps.ts`, plus the manifest test
  fixture);
- the VPN session name and notification title in `OpenTunnelVpnService.kt`;
- in-app headers;
- the docs that describe the apps to people.

Any other user-visible "NetLens" or "OpenTunnel" string changes too. Code
identifiers don't.

## Why

The owner wants their phone to be a complete toolkit for their own network,
without buying a security suite:

- see who is on the Wi-Fi, by name, not by IP;
- see what the apps on the phone do on the network, and stop the ones they
  don't want.

The owner's goals for the firewall are to save mobile data, protect privacy,
control specific apps, and spot suspicious connections.

There are two parts. They share no code and can ship in either order. One
document covers both because the owner asked for that. They do meet at
runtime: a VPN in the path breaks HomeNet's LAN scan
(`PlatformNetwork.kt:57-79` records 135 invented "hosts" on a 3-host /24).
That's why the firewall leaves the LAN and HomeNet alone (Part 2,
"Service").

Ruled out after discussion: setting another person's internet speed. Phone
traffic from other devices never passes through this phone; only the router
can limit it.

---

## Part 1: HomeNet (was NetLens) shows real device names

Paths below still say `netlens`, because code and folder names don't change.

### What happens today

- The device label is `customName → vendorOrModel → hostname → IP`
  (`apps/netlens/src/screens/ScannerScreen.tsx:72`).
- `vendorOrModel` is the raw SSDP `SERVER` header (strings such as
  `Linux/4.9 UPnP/1.0`), and only UPnP devices send one.
- `hostname` has a database column and a row in the detail sheet, but the
  scanner never fills it (`ScannerScreen.tsx:183-188`).
- mDNS only collects service *types* for the whole network
  (`MdnsProbe.kt`, `MdnsBrowser.swift`); nothing ties them to a host.

Result: most phones and laptops appear as a bare IP.

### What it should do

After a scan, most devices show a human name. Four sources, all inside the
AGENTS.md hard rules (no ARP, bounded concurrency):

1. **Reverse DNS (PTR)** for each reachable host through the system resolver.
   The router usually answers with the name the device gave DHCP
   ("Galaxy-S24", "Ali-MacBook"). A result equal to the IP means no name.
2. **mDNS instance names.** For each discovered service type, browse its
   instances and resolve them to an IPv4 address; the instance name
   ("Living Room TV", "HP LaserJet") names that IP. On iOS 14+ an app can only
   browse types listed in `NSBonjourServices` (today: `_services._dns-sd._udp`
   and `_http._tcp`, in both `apps/netlens/app.json` and `Info.plist`), so add
   a fixed list of common types: AirPlay, RAOP, Google Cast, IPP/printer,
   HomeKit, SMB, Spotify Connect, device-info, companion-link. Android has no
   such limit.
3. **SSDP device description.** Fetch the `LOCATION` URL the scan already
   receives and read `friendlyName`, `manufacturer` and `modelName`.
4. **NetBIOS node status** (UDP 137) for Windows and Samba machines.

### Rules

- **Untrusted input.** Every reply comes from an arbitrary LAN device.
  Fetch `LOCATION` only when its host is the same private IP that sent the
  SSDP reply; plain `http` only; no redirects; body capped at 64 KB, 2 s
  timeout; XML parsed with external entities off. Every name is trimmed,
  stripped of control characters and capped at 64 characters.
- **Speed.** The sweep keeps NFR-1 (under 6 s for a /24). Naming runs after
  the sweep, bounded (about 16 lookups at a time) with short per-lookup
  timeouts. The device list appears at once and names fill in as they
  arrive; the naming pass finishes within about 5 s.
- **Cleartext HTTP on Android.** `HttpURLConnection` refuses plain `http` by
  default. Builder chooses between a network security config and a raw
  socket GET.
- **Name order (my call):** custom name → mDNS instance name → SSDP
  `friendlyName` (with model) → NetBIOS name → reverse-DNS hostname → SSDP
  `SERVER` string → IP.
- **Show where a name came from.** The detail sheet lists each source on its
  own row (hostname, Bonjour name, model, NetBIOS name).
- **No false "new device" alarms after the update.** `deriveIdentityKey`
  (`packages/core/src/device-repository.ts:93`) uses USN → hostname → IP.
  Filling `hostname` would change known devices' keys from `ip:` to `host:`,
  and every known device would show as new once (FR-4). Existing rows must
  stay matched, for example by falling back to `lastIp` when the derived key
  is unknown. Builder decides how; a test must cover it.
- **Storage.** New names need room in the devices table (a schema change in
  the expo-sqlite store). Column design is the builder's call; existing
  data must survive the migration.
- **Where code goes.** Pure logic (name precedence, XML field extraction,
  NetBIOS reply parsing, sanitising) lives in `packages/core` with
  `node --test` tests. Native code only does I/O. A new native function
  touches the four places named in CLAUDE.md: the TS contract
  (`NetLensNativeBinding`), the adapter (`createNetLensNativeBinding`),
  Kotlin and Swift.

### Not doing

- Manufacturer lookup by MAC address. It needs the ARP table, which is banned
  (hard rule 1) and blocked by the OS.
- Per-device speed limits (router only).
- An "open router settings" button. Not requested; trivial to add later.

---

## Part 2: TunnelWall (was OpenTunnel) app firewall and traffic monitor (Android only)

Paths and code below still say OpenTunnel, because code and folder names
don't change.

### What the owner gets

A Firewall area in TunnelWall with:

1. **Data use per app:** Wi-Fi and mobile, today and this month, sorted by
   mobile data. Works whether the firewall is on or off.
2. **A rule per app:** Allow (default), Block on mobile data, Block always.
   The rule is set from the same row that shows the app's data use.
3. **Activity log:** one entry per connection with time, app, domain (when
   known), IP, port, protocol, bytes sent and received, and allowed or
   blocked. Filter by app and by blocked only.
4. **Pause and resume** with one tap, in the app and as a notification action.

### Decisions the owner made

- **It lives in TunnelWall, not HomeNet.** Android runs one VPN at a time,
  and TunnelWall already owns one.
- **Full traffic.** All traffic passes through an in-app network stack, so
  blocking is airtight and the log covers every connection. The owner chose
  this over a DNS-lookup-only design and a block-only design.
- **First version runs only while OpenTunnel is not connected to a VPN
  server.** Filtering while connected is a later project.
- **Private Store only, owner is the only user.** Google Play's VPN policy
  doesn't apply; one honest consent screen is enough.
- **Android only.** iOS doesn't tell an app which app owns a connection.

### How it works (my calls unless stated otherwise)

**Packet engine: firestack.** `celzero/firestack`, MPL-2.0, published as an
Android AAR on Maven Central (`com.celzero:firestack`), so our build needs no
Go toolchain. It is the gVisor-based userspace stack inside RethinkDNS: it
terminates TCP/UDP from the tun, hands each flow's source and destination to
Kotlin for an allow/block decision, dials allowed flows on protected sockets,
and resolves DNS. Its API is unstable and undocumented: pin one version, keep
every call behind one Kotlin class, and use the RethinkDNS app (Apache-2.0)
as the reference integration.

- **License.** OpenTunnel is GPL-2.0-only (ics-openvpn) and the repo is
  public. MPL-2.0 allows combining with GPL-2.0 through its Secondary License
  clause unless a file is marked "Incompatible With Secondary Licenses";
  check the pinned version for that marker. firestack bundles gVisor
  (Apache-2.0), the same Apache-2.0 + GPLv2 mix the app already has with the
  WireGuard library. Record both in the OpenTunnel docs. NetGuard's code
  (GPLv3) must not be used.
- **Spike first, before any UI.** Prove that:
  - the firestack AAR builds next to the WireGuard and ics-openvpn AARs
    without native-library or class clashes (two Go runtimes end up in one
    APK);
  - traffic flows;
  - the flow callback gives usable tuples;
  - `getConnectionOwnerUid` returns real app UIDs.

  Measure APK size growth and idle battery drain.
- **Spike pass line (my call; the owner can move it):**
  - All four checks pass.
  - The arm64 APK grows by no more than 30 MB.
  - An 8-hour screen-off night with the firewall on drains no more than
    3 percentage points more battery than a night without it.

  If the spike fails, stop and bring alternatives to the owner rather than
  switching engines silently.
- **How the spike reaches the phone (my call, following the owner's rule:
  installs go through the Store, never adb).**
  1. Build checks, traffic, tuples and UIDs run on the emulator first.
  2. The on-phone checks (UIDs on the real ROM, battery) use a separate
     throwaway spike app with its own package ID, installed through the
     Store and removed from the Store afterwards.

  The daily VPN app doesn't get firestack until the spike passes. The spike
  app is throwaway, so OpenTunnel rule 6 (no placeholders) doesn't apply to
  it.

**App attribution.** `ConnectivityManager.getConnectionOwnerUid` (API 29+,
callable only by the active VPN app). The firewall needs Android 10 or newer;
older versions get a typed "not supported" state.

**Service.** A new firewall role in `OpenTunnelVpnService`. It builds its own
`Builder`; `buildHostInterface` has no IPv4 route and isn't reused. The
firewall tun:
- routes all internet IPv4 and IPv6;
- never calls the bypass opt-out (OpenTunnel rule 3);
- hands its descriptor to firestack.

OpenTunnel's own sockets are protected.

**Leave the LAN and HomeNet alone (my call).** Otherwise a userspace stack
in the path breaks HomeNet's scan (the "RST means alive" rule, mDNS and
SSDP) and skews its ping and DNS-speed readings.
- Private, link-local and multicast ranges stay out of the tun:
  `excludeRoute` on API 33+, and the complement routes on older versions.
- `app.netlens` is excluded with `addDisallowedApplication`.
- The price: LAN-only traffic and HomeNet's own traffic aren't logged or
  blockable. The Firewall area says so in one line.

**DNS keeps the privacy the phone has today (my call).** The tun advertises
its own DNS address so firestack sees lookups. It forwards upstream the way
the phone does now and never downgrades encrypted DNS to plain:

| Phone's Private DNS | Upstream lookups go to |
|---|---|
| Strict (named provider) | that provider over DoT |
| Automatic | the network's DNS over DoT if it answers there, otherwise plain, which is what Android does |
| Off | the network's DNS over plain DNS |

In strict mode Android sends its own DoT through the tun, so the firewall
can't see website names. The Firewall area then says: "To see website names,
set Private DNS to Automatic. Lookups will still go to <provider>."
Connections from apps with their own encrypted DNS, such as Chrome's Secure
DNS, are logged as connections to that DNS provider, not by website name.

**Sharing the VPN slot with server connections.**
- Connecting to a server while the firewall is on: the firewall stops
  cleanly first, then the engine starts. The Firewall area says "The
  firewall is paused while you're connected to a VPN server."
- Disconnecting: the firewall starts again if it was on.
- A server connection must never fail because the firewall held the slot.
- WireGuard's GoBackend runs its own `VpnService` class, so verify on the
  phone that the hand-over between the two services of the same app works
  in both directions.

**Rules are enforced in Kotlin**, because the service runs with the UI
closed.
- Rules are stored natively; JS reads and writes them through the native
  module.
- The decision is a pure function of (rule, current network is cellular,
  UID), with JVM unit tests.
- "Mobile data" means the default network has `TRANSPORT_CELLULAR`.
- When the network changes or a rule changes, rules are re-evaluated and
  open connections of newly blocked apps are closed, not just new ones.
- If the UID lookup fails, the connection is allowed and logged as
  "Unknown app", so the phone keeps working.
- Shared system UIDs (Android system, media and similar) appear as one
  entry each and can carry a rule like any app.

**Activity log storage.** A native SQLite database written by the service in
batches, never once per packet. Keep 7 days or 100,000 entries, whichever
limit comes first. The log has a clear button, never leaves the phone, and
is excluded from backups (`allowBackup="false"` is already set).

**Data use.** `NetworkStatsManager.querySummary` for Wi-Fi and cellular. It
needs the `PACKAGE_USAGE_STATS` grant ("Usage access" in Settings, opened by
deep link) and no VPN. Check on the phone that while the firewall runs,
Android still credits data to the real apps rather than to OpenTunnel. If it
doesn't, say so on the screen.

**Installed apps.** The app list shows names and icons, and the log names
the app behind each UID; both need visibility of every package.
- The manifest currently removes `QUERY_ALL_PACKAGES` on purpose
  (`tools:node="remove"` in `AndroidManifest.xml`, because ics-openvpn
  brings it in). Re-allow it through the config plugin, which is acceptable
  for a private sideload.
- No app picker exists today; the `disallowedApps` plumbing has no UI.

**Pause.** Pause stops the firewall's tun so all traffic flows normally. The
notification stays, with a Resume action. There's no timed pause in v1.

**Reboot.** If the owner sets OpenTunnel as Android's Always-on VPN and the
firewall is enabled, the system start (an intent with no action, which today
falls into the `else` branch and stops the service) starts the firewall.
That's how it survives a reboot.

**If the firewall dies,** traffic flows directly and the status shows Off.
There's no firewall kill switch in v1.

**iOS.** The new native functions return a typed "not supported on iOS"
error (OpenTunnel rule 6: no placeholders), and the UI hides the Firewall
area on iOS.

**Where code goes.**
- The TS contract and adapter go in `modules/open-tunnel-native/src`, with
  Kotlin and the Swift stubs beside them.
- Kotlin JVM tests cover the rule decision, log retention and the
  attribution fallbacks.
- JS formatting and aggregation gets `node --test` tests, each file added to
  the package's `test` script.

### Consent on first enable

One plain screen covers:
- what the firewall sees: every connection's app, address or domain, and
  data amount;
- that this stays on the phone and is never uploaded;
- that it pauses while connected to a VPN server;
- that it uses some battery.

Then Android's VPN permission dialog (OpenTunnel already uses it), then
Usage access. Usage access is optional; without it the data-use list
explains why it's empty.

### UI

Built from `@apps-hub/ui` with the `opentunnel` brand. Layout is the
builder's call. Suggestion: a Firewall tab next to the current home screen,
with status and Pause at the top, then an Apps list (data use and rule) and
an Activity list.

### Anti-goals

- No inspection of traffic contents and no TLS interception; the firewall
  sees only who connects where and how much.
- Nothing leaves the phone.
- Never claim what it can't see.
  - Unknown apps and missing domains are labelled as such.
  - A connection is shown as blocked only if the firewall actually dropped
    it.
  - The screen says that LAN traffic and HomeNet's traffic aren't covered.
- Never make DNS less private than it is without the firewall.

### Not in v1

These are named so they aren't forgotten:
- **Filtering while connected to a VPN server.** A possible path: WireGuard
  nodes through firestack's built-in userspace WireGuard, and OpenVPN by
  handing ics-openvpn a descriptor the firewall controls. This is its own
  project.
- Tracker and ad blocklists, domain rules, schedules ("block games after
  10 pm"), timed pause, threat or reputation detection, log export and
  new-connection alerts.
- iOS.

### Risks

- **The firestack API changes between versions.** Mitigated by the pinned
  version and the single wrapper class.
- **Battery and throughput cost of a userspace stack.** Measured in the
  spike.
- **Two Go runtimes in one APK.** Checked in the spike.
- **VPN slot hand-over between `OpenTunnelVpnService` and GoBackend's
  service.** Checked on the phone.
- **Always-on may start the wrong service.** The WireGuard and ics-openvpn
  library services may also answer the system's "start this VPN" intent,
  so Always-on could pick one of them. Check this in the spike before
  relying on Always-on for reboot.

---

## Done means

On the owner's phone, installed through the Store:

**Both apps:** the home screen, Store, notifications and system VPN screen
show HomeNet and TunnelWall. The rename updated the installed apps in place,
with nothing reinstalled and no data lost.

**HomeNet:**
- A scan of the home Wi-Fi shows names for most devices.
- No known device is flagged as new after the update.

**TunnelWall:**
- An app blocked on mobile data fails on mobile data and works on Wi-Fi.
- The log shows app names and domains.
- Pause and resume work from the notification.
- Connecting to a server pauses the firewall, and disconnecting turns it
  back on.

**Checks:** `pnpm test`, `pnpm typecheck`, the Gradle gates for both apps,
and the iOS builds of both apps (both get Swift changes). Report real
output.

## Left to the builder

- Order of work. Suggestion: start the firestack spike early, since it can
  stop Part 2.
- Database columns.
- Screen layout.
- How the "new device" fallback works.
- Cleartext HTTP approach.
- Concurrency and timeout numbers inside the stated budgets.
- How rules are stored natively.
- Version bumps and releases through `tools/release`.

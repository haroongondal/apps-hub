# HomeNet toolbox: router, remotes, who's home, wake PC, guest QR

Date: 2026-11-18. App: HomeNet (`apps/netlens`, logic in `packages/core`).

## Why

The owner wants HomeNet to make everyday life at home easier and to be fun to use,
not just a scanner. HomeNet now has a device scanner, connection diagnostics, and
(added 2026-11-18, uncommitted) a per-device port check with "Open web page"
and a router "Settings" button. The owner has a smart TV, a Roku or Chromecast,
smart speakers and smart plugs or lights, and asked for all four feature sets below.

## Goals

1. **Router dashboard**: public IP, internet uptime, a live meter of internet speed
   in use now, and the list of "open doors" (UPnP port mappings) with a way to
   close each one.
2. **Device remote**: control the owner's devices from their device sheet: Roku
   (full remote), DLNA/Sonos speakers and TVs (play, pause, next, volume, mute),
   Shelly, Tasmota and WLED (on/off, WLED brightness).
3. **Who's home**: tag a phone with a person's name; a Home tab shows who is on
   the Wi-Fi now and when the others were last seen.
4. **Wake PC + guest QR**: wake a sleeping PC from its device sheet; show a QR
   code guests scan to join the Wi-Fi.

Each goal is one phase, built in this order (1 to 4). Phases pile up on the
branch; the owner decided (2026-11-18) on one merge and one Store release at the
end, on their go. One HomeNet version bump, in the last phase.

## Non-goals

- Blocking devices, changing the Wi-Fi password, rebooting the router or per-device
  usage. No standard API does these; each brand needs its own login-page scraper.
- "Reconnect internet" (UPnP `ForceTermination`): some routers stay offline until
  rebooted afterwards.
- Chromecast control (needs the encrypted Cast protocol), Samsung/LG power, input
  and app control (websockets with pairing), Philips Hue (bridge pairing). Possible
  later phases; a TLS/websocket native transport would be their first step.
- Background work: no alerts or presence tracking while the app is closed.

## Anti-goals (a failure even if it works)

- Any traffic leaving the LAN, any telemetry, any non-FOSS dependency.
- Any request to a host that is not a private IPv4 address on this network.
- A control that acts without the user tapping it (no auto-toggling while probing).
- Closing a port mapping or waking a PC without the user seeing exactly which one.

## Constraints

- AGENTS.md hard rules hold: no ARP, TCP RST means alive, bounded concurrency,
  F-Droid pure FOSS, modern Android APIs.
- Domain logic is pure TS in `packages/core` behind `NetLensNativeBinding`, tested
  with `node --test` (add each test file to `packages/core/package.json`).
- All HTTP goes through the existing `tcpFetch` (plain TCP, no TLS), so only
  `http://` endpoints are reachable. HTTP requests are HTTP/1.0 with
  `Connection: close`, as `ssdpDescriptionRequest` already does. XML is parsed
  with regex the way `name-formats.ts` parses device descriptions. JSON is new to
  core: `JSON.parse` in try/catch, then check each field's type before use.
- **LAN guard.** Native `tcpFetch` accepts any IP, so core gets one guard used by
  every new request path (SOAP control URLs, Roku, Shelly, Tasmota, WLED): the
  target must be a private IPv4 inside the phone's real subnet
  (`InterfaceInfo.localIp` + `cidrPrefix`), otherwise the call is refused. A
  router description whose control URL points elsewhere is ignored.
- A new native function touches four places: the TS contract, the adapter, Kotlin
  and Swift (CLAUDE.md "Wiring that spans files").
- UI uses `@apps-hub/ui` components only; copy is sentence case, plain words.
- Navigation stays `TabBar` (no navigation library). Tabs become: Devices, Home,
  Router, Checks (Diagnostics).
- Install on the phone only through the Store; releases only on the owner's go.

## Approaches considered

| Decision | Options | Picked | Why |
|---|---|---|---|
| Router control | UPnP IGD (standard SOAP) vs. per-brand admin page scraping | UPnP IGD | One code path for most routers; admin pages are HTTPS, per-brand and break on firmware updates |
| Guest QR | `qrcode-generator` (MIT, pure JS) drawn with Views vs. `react-native-qrcode-svg` + `react-native-svg` (native) vs. own encoder | `qrcode-generator` | No native dependency; an own encoder is ~400 lines of error-prone code |
| Wake-on-LAN | new native UDP broadcast vs. unicast through `udpRequest` | native broadcast | A sleeping PC has no live ARP entry, so unicast misses; `udpRequest` can't broadcast and waits for a reply |
| Device control | per-protocol HTTP over `tcpFetch` vs. vendor SDKs | HTTP over `tcpFetch` | Vendor SDKs are closed or cloud-bound |

The owner handed over these choices ("go ahead", then picked features only); they
are Claude's calls.

## Design

### Phase 1: Router dashboard (Router tab, pure TS)

- **Find the router's UPnP service.** Run `startServiceDiscovery(3000)` when the tab
  opens and take the SSDP event whose `host` is the gateway IP and whose `usn` or
  description contains `InternetGatewayDevice`. Fetch its description (reuse
  `ssdpDescriptionRequest`, which already refuses non-private or mismatched hosts).
  Find the `controlURL` of `WANIPConnection:1/2` (or `WANPPPConnection:1`) and
  `WANCommonInterfaceConfig:1`, resolved against `URLBase` or the LOCATION.
- **SOAP helper** in core: build a POST with `SOAPAction`, `Content-Type:
  text/xml; charset="utf-8"` and `Content-Length`; parse named response fields and
  `UPnPError/errorCode`.
- **Facts:** `GetExternalIPAddress`, `GetStatusInfo` (status + uptime seconds),
  `GetCommonLinkProperties` (max up/down speed, when given).
- **Live meter:** poll `GetTotalBytesReceived` / `GetTotalBytesSent` every 2 s
  while the tab is visible; rate = delta bytes / elapsed. Counters are 32-bit on
  many routers: a negative delta adds 2^32. Hide the meter when the calls fail or
  always return 0. Show download and upload in Mbit/s.
- **Open doors:** `GetGenericPortMappingEntry` from index 0 until a SOAP fault
  (713) or 64 entries. Each row: description, protocol, external port, and the
  internal device (matched to a stored device name by IP, else the IP) and port.
  "Close" asks for confirmation, then `DeletePortMapping` and reloads the list.
- **No UPnP:** if no IGD answers, say "Your router doesn't share its status. Turn
  on UPnP in its settings to see it here." with the existing Settings button.
- The Settings button from Diagnostics also appears on this tab.

### Phase 2: Device remote (device sheet, pure TS)

- When a device sheet opens, run detection probes in parallel (each ≤ 1.5 s,
  read-only GETs, never a toggle):
  - Roku: `GET :8060/query/device-info` → 200 with `<device-info>`.
  - Shelly: `GET /shelly` → JSON; `gen` ≥ 2 means the RPC API, else Gen1.
  - Tasmota: `GET /cm?cmnd=Power` → JSON with `POWER`. A 401 means "this plug has
    a password", shown as a note (no auth in this phase).
  - WLED: `GET /json/info` → JSON with `brand: "WLED"`.
  - DLNA/Sonos: the device's UPnP description lists `RenderingControl` and/or
    `AVTransport`. Its LOCATION comes from the last scan's SSDP events, kept in
    memory by the scan. Today the scan keeps only the last SSDP event per IP
    (`ScannerScreen.tsx` ~193-198); it must keep every LOCATION per IP, since one
    box often announces several. Sonos falls back to
    `:1400/xml/device_description.xml`.
- A **Controls** group appears above Details for each detected kind:
  - Roku: D-pad (up, down, left, right, OK), Home, Back, Play/Pause, volume
    up/down, mute, power off via `POST :8060/keypress/<Key>`.
  - DLNA/Sonos: Play, Pause, Next, Previous (AVTransport, InstanceID 0), volume
    −/+ in steps of 5 with the current level shown, Mute toggle (RenderingControl,
    Channel Master).
  - Shelly: on/off switch with current state (Gen1 `/relay/0`, Gen2
    `/rpc/Switch.GetStatus?id=0` / `Switch.Set`). Relay 0 only.
  - Tasmota: on/off switch (`Power On`/`Off`).
  - WLED: on/off switch and brightness −/+ (`POST /json/state`).
- A control that fails shows "Didn't respond. Check the device is on and try
  again." and reloads its state.

### Phase 3: Who's home (Home tab)

- SQLite migration to `user_version = 2` adds `person TEXT` and `mac TEXT` to
  `devices` and a `settings (key TEXT PRIMARY KEY, value TEXT)` table (Phase 4
  uses the last two; one migration keeps versions simple).
- Device sheet gets a "Whose phone is this?" field (blank = nobody).
- **Identity (Claude's call).** Phones send no SSDP, so they are stored by IP
  (`device-repository.ts` ~98-107). Most routers give a device the same IP each
  time, so tags stay put. When they don't: if a tagged device was not seen this scan
  and a device that was seen has the same non-empty reverse-DNS or Bonjour name,
  the tag moves to it, and the old row's tag is cleared. The Home tab's empty state
  suggests reserving the phone's IP in the router for best results.
- The scan moves out of `ScannerScreen` into a shared hook used by Devices and
  Home, so either tab can start a scan and both see the result.
- Home tab: one row per person (a person with several devices counts as home if
  any one is). "Home" when seen in the latest scan; otherwise "Last seen 2 h ago"
  from `lastSeenAt`. "Check now" runs a scan; before calling someone away it
  re-probes that person's devices once at their last IP on the default ports
  (refused counts as home). Empty state explains how to tag a phone.
- Copy says plainly that it updates only while HomeNet is open.

### Phase 4: Wake PC + guest QR

- **Native `sendUdpBroadcast(ip, port, payload)`** (fire and forget): Kotlin
  `DatagramSocket` with `broadcast = true`, bound to the Wi-Fi network like
  `lanBinder`; Swift BSD socket with `SO_BROADCAST`. iOS needs Apple's multicast
  entitlement for broadcast; without it the call fails with a clear error (iOS is
  not shipped today).
- **MAC:** extend NetBIOS status parsing to return the MAC that follows the name
  table (all-zero MAC = none); store it in `mac` at scan time (it rides along
  with `netbiosName` through `resolveDeviceNames`). The device sheet also
  accepts a typed MAC (`AA:BB:CC:DD:EE:FF` or `-` separated, validated).
- **Wake:** magic packet (6 × `FF` + 16 × MAC) built in core, sent 3 times on
  port 9 to the real subnet broadcast address, computed from `InterfaceInfo.localIp`
  and `cidrPrefix`. Not `SubnetPlan.broadcastIp`: the plan is clamped to a /24
  and is wrong on wider networks. The subnet broadcast is a private address, so
  `lanBinder` binds it to Wi-Fi (255.255.255.255 would not be). The sheet shows "Wake
  this device" when a MAC is known, then pings the last IP for up to 60 s and says
  when it answers. Copy notes the PC must have Wake-on-LAN on.
- **Guest QR** (Router tab, "Guest Wi-Fi"): network name, password, and "No
  password" toggle, saved in `settings`. QR text `WIFI:T:WPA;S:<ssid>;P:<pw>;;`
  (or `T:nopass`) with `\ ; , : "` escaped. Drawn black on white regardless of
  theme (scanners need contrast; a stated exception to the token rule).
- Set `android:allowBackup="false"` so the saved password does not go to cloud
  backup. Set it in `app.json` (`android.allowBackup: false`) as well as the
  committed manifest, so a future prebuild keeps it.

### Tests

`node --test` for: SOAP request building and response/fault parsing, IGD
description parsing and URL resolution, port-mapping entry parsing, the counter
wrap rate math, each detection parser (Roku, Shelly gen1/gen2, Tasmota, WLED,
DLNA services), people status from devices, NetBIOS MAC extraction, MAC parsing,
the magic packet, and Wi-Fi QR escaping. Kotlin JVM test for the broadcast
argument validation. Gates per AGENTS.md: `pnpm test`, `pnpm typecheck`, the
NetLens Gradle and iOS simulator builds.

## Left to the builder

File and function names; exact poll and timeout values within the bounds above;
row layouts within `@apps-hub/ui`; how the shared scan hook is shaped; how many
SOAP helpers to extract.

## Claude's calls (owner can override)

- Phase order 1 → 4.
- Store the guest password on the phone and turn off Android backup for HomeNet
  (this also stops backing up device names).
- Work happens on branch `homenet-toolbox`, cut from `main` (not `model-host`), in
  worktree `~/Documents/apps-hub-wt/homenet-toolbox`. It carries only today's
  port-check files: `packages/core/src/port-check.ts`, its test,
  `packages/core/{package.json,index.ts}`, and the two HomeNet screens. Other
  uncommitted work in the main checkout stays where it is.
- Tagged phones stay matched by IP, with a name-based carry-over (Phase 3).

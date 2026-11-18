# Product Requirements Document (PRD): NetLens

## 1. Product Vision
NetLens is a free, open-source (FOSS), zero-telemetry home network scanner and connectivity diagnostic toolkit designed for Android (F-Droid / Play Store) and iOS. It empowers everyday users to see what is connected to their Wi-Fi and diagnose why their internet is slow—without paywalls, subscriptions, or cloud accounts.

> Platform implementation: React Native + Expo on top of native modules that
> mirror the OS networking APIs referenced below. All product requirements in
> this document are stack-independent.

## 2. Target Audience & Problem Statement
- **Problem:** Users experience slow Wi-Fi or suspect unauthorized devices on their network, but commercial tools (Fing, NetSpot) lock basic historical tracking, automated pings, or device identification behind subscriptions and harvest local network telemetry.
- **Target Users:** Privacy-conscious home users, self-hosters, and tech-savvy troubleshooters.

## 3. Scope & MVP Requirements

### Functional Requirements (FR)
- **FR-1: Subnet Interface Detection**
  - Automatically detect active local IPv4 address, subnet mask (CIDR), and Default Gateway IP via native OS network interfaces (`ConnectivityManager`/`LinkProperties` on Android, `NWPathMonitor`/`getifaddrs` on iOS).
- **FR-2: Multi-Protocol LAN Device Discovery**
  - Sweep the active `/24` (or detected CIDR) subnet concurrently.
  - Combine TCP reachability probes (Ports 80, 443, 22, 445, 8080, 62078) with mDNS/DNS-SD (`_services._dns-sd._udp`) and SSDP (`239.255.255.250:1900`) discovery.
  - Perform Reverse DNS (PTR) lookups and local IEEE OUI vendor lookup (only when hardware MAC is organically exposed on older OS/routers; gracefully fallback to mDNS/SSDP model fingerprinting on Android 11+ / iOS).
- **FR-3: Why Is My Internet Slow? (Diagnostic Suite)**
  - Run concurrent latency & jitter tests across three hops:
    1. **Local Wi-Fi Hop:** Ping Default Gateway (Router).
    2. **ISP / WAN Hop:** TCP ping to `1.1.1.1` and `8.8.8.8`.
    3. **DNS Resolution Speed:** Measure query time for resolving a standard domain (`example.com`).
  - Provide a plain-English verdict (e.g., *"High latency to Router (85ms): Wi-Fi interference issue"* vs *"Router is fast (3ms), WAN is slow (190ms): ISP issue"*).
- **FR-4: Persistence, History & "New Device" Detection**
  - Store networks (identified by Gateway IP + Subnet or BSSID/SSID if permitted) and discovered devices in a local SQLite database (`expo-sqlite`; replaces the earlier Room KMP design).
  - Allow users to assign custom names, icons/categories, and "Trusted" status to devices.
  - Highlight newly discovered devices with a **"NEW"** badge during scans.
- **FR-5: Router Dashboard (Router tab)**
  - Find the router's UPnP internet gateway (IGD) service and show its public IP, connection status, uptime, and the line speed when it reports one.
  - Show a live meter of internet speed in use now (download and upload, Mbit/s), polled while the tab is open. Hide it when the router gives no counters.
  - List the router's open port mappings ("open doors") with description, protocol, external port and the internal device. Closing one asks for confirmation and shows which mapping it closes.
  - When the router offers no UPnP, say so and keep the router Settings button. Rebooting the router is not offered.
- **FR-6: Device Remotes (device sheet)**
  - When a device sheet opens, detect (read-only requests, never a toggle) whether the device is a Roku, a DLNA/Sonos renderer, a Shelly, a Tasmota or a WLED, and show a Controls group for each kind found.
  - Roku: D-pad, Home, Back, Play/Pause, volume, mute, power off. DLNA/Sonos: play, pause, next, previous, volume and mute. Shelly and Tasmota: on/off with the current state. WLED: on/off and brightness.
  - Every control acts only when the user taps it.
- **FR-7: Who's Home (Home tab)**
  - Let the user tag a device with a person's name ("Whose phone is this?"). The Home tab shows one row per person: "Home" when any of their devices was seen in the latest scan, otherwise "Last seen" with the time.
  - A tag follows a phone whose identity changed only when exactly one device seen this scan shares its non-generic hostname or Bonjour name.
  - The tab updates only while HomeNet is open, and says so.
- **FR-8: Wake a PC (device sheet)**
  - A device with a known MAC shows "Wake this device". The MAC comes from the NetBIOS reply or is typed by the user (validated).
  - Send the Wake-on-LAN magic packet three times to the subnet broadcast address, then watch the device's last IP for up to 60 seconds and say when it answers.
- **FR-9: Guest Wi-Fi QR (Router tab)**
  - Show a QR code guests scan to join the Wi-Fi from a network name, a password, or "No password". The values are saved on the phone and drawn black on white regardless of theme.
- **FR-10: Port Check (device sheet)**
  - Check a device for common open ports on demand, label them in plain words, flag risky ones, and offer an "Open" button for web ports.

### Non-Functional Requirements (NFR)
- **NFR-1 (Performance):** Full `/24` subnet scan (254 hosts) must complete in `< 6 seconds` using bounded native concurrency (max 64 concurrent socket operations to prevent OS file-descriptor exhaustion).
- **NFR-2 (Privacy & F-Droid Compliance):** Zero external analytics, zero cloud dependencies, 100% reproducible source build using only FOSS dependencies (MIT/Apache-2.0).
- **NFR-3 (Resilience):** Graceful handling of OS permission denials (e.g., scanning IP range even if Location/SSID permission is denied).
- **NFR-4 (LAN only):** Every request the toolbox features make goes to a private IPv4 address inside the phone's own subnet, and nothing leaves the LAN. A router or device that names any other address in its reply is ignored.

### Not supported
- Device types: Chromecast, Samsung and LG power and input control, and Philips Hue. They need TLS, websockets or pairing.
- Blocking devices, changing the Wi-Fi password, rebooting the router, per-device usage, and background alerts or presence tracking while the app is closed.
- Wake-on-LAN on iOS until Apple grants the multicast entitlement (see SPEC §7).

## 4. Acceptance Criteria (AC)
- **AC-1:** Given an active Wi-Fi connection without Location permission, when the user taps "Scan", NetLens still detects the local subnet via `LinkProperties` / `getifaddrs` and discovers active IPs and mDNS hostnames within 6 seconds.
- **AC-2:** Given a completed scan, when a device appears that is not in the local database for that network, it is flagged as `isNew = true` in the UI.
- **AC-3:** Given a user edits a device's custom name to "Living Room TV", when the network is rescanned, the custom name persists even if the device's IP changes (matched via mDNS identifier/hostname fallback or MAC if available).
- **AC-4:** When the user runs the Connectivity Diagnostic, the UI displays independent latency (ms), jitter (ms), and packet loss (%) for Router, WAN, and DNS, alongside an automated bottleneck summary.

- **AC-5:** Given a router with UPnP on, when the user opens the Router tab, it shows the public IP and uptime. Given the router lists a port mapping, when the user confirms "Close", that mapping (and no other) is deleted and the list reloads. Given no UPnP answer, the tab says so and still shows the Settings button and the guest Wi-Fi card.
- **AC-6:** Given a Roku, DLNA/Sonos, Shelly, Tasmota or WLED device, when its sheet opens, a Controls group for that kind appears without any device changing state. Given a router reply or device reply that names a host outside the phone's subnet, no request goes to that host.
- **AC-7:** Given a phone tagged "Sara", when a scan sees it, the Home tab shows Sara as "Home"; when no scan sees it, "Last seen" with the last time. A tag never moves to a device through a generic name such as "iPhone" or "android".
- **AC-8:** Given a device with a known MAC, when the user taps "Wake this device", HomeNet sends the packet to the subnet broadcast address and reports "awake" when the device answers within 60 seconds. Nothing is sent without that tap.
- **AC-9:** Given a name and password, the guest QR encodes `WIFI:T:WPA;S:<name>;P:<password>;;` with `\ ; , : "` escaped, or `T:nopass` when "No password" is on.

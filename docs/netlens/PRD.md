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

### Non-Functional Requirements (NFR)
- **NFR-1 (Performance):** Full `/24` subnet scan (254 hosts) must complete in `< 6 seconds` using bounded native concurrency (max 64 concurrent socket operations to prevent OS file-descriptor exhaustion).
- **NFR-2 (Privacy & F-Droid Compliance):** Zero external analytics, zero cloud dependencies, 100% reproducible source build using only FOSS dependencies (MIT/Apache-2.0).
- **NFR-3 (Resilience):** Graceful handling of OS permission denials (e.g., scanning IP range even if Location/SSID permission is denied).

## 4. Acceptance Criteria (AC)
- **AC-1:** Given an active Wi-Fi connection without Location permission, when the user taps "Scan", NetLens still detects the local subnet via `LinkProperties` / `getifaddrs` and discovers active IPs and mDNS hostnames within 6 seconds.
- **AC-2:** Given a completed scan, when a device appears that is not in the local database for that network, it is flagged as `isNew = true` in the UI.
- **AC-3:** Given a user edits a device's custom name to "Living Room TV", when the network is rescanned, the custom name persists even if the device's IP changes (matched via mDNS identifier/hostname fallback or MAC if available).
- **AC-4:** When the user runs the Connectivity Diagnostic, the UI displays independent latency (ms), jitter (ms), and packet loss (%) for Router, WAN, and DNS, alongside an automated bottleneck summary.

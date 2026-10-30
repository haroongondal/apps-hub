# HomeNet device names + app rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show NetLens and OpenTunnel as HomeNet and TunnelWall, and give HomeNet's scanned devices real names from reverse DNS, mDNS instance names, the SSDP device description and NetBIOS.

**Architecture:** The native side gains two generic I/O primitives, `udpRequest` and `tcpFetch`, plus one new discovery event, `mdns-instance`. Every byte format is built and parsed in pure TypeScript in `packages/core`:
- the DNS PTR query and reply;
- the NetBIOS status query and reply;
- the HTTP response and the UPnP XML fields.

An orchestrator, `resolveDeviceNames`, runs after the sweep with bounded concurrency. ScannerScreen writes names into existing rows without changing their identity keys, so no known device can turn "new".

**Tech Stack:** TypeScript (`node --test`, erasable syntax, `.ts` imports), Expo Modules (Kotlin + Swift), expo-sqlite.

**Spec:** `docs/superpowers/specs/2026-10-30-network-toolkit-design.md` (Part 1 and "Two apps, split by what they look after"). The firewall is not in this plan; see `2026-10-31-tunnelwall-firewall-spike.md`.

**Decisions this plan adds to the spec (each is a builder call the spec left open):**
- **Reverse DNS is a PTR query sent straight to the gateway on UDP 53,** bound to Wi-Fi, instead of a system-resolver call. It still asks the router, as the spec intends, but it also works while a VPN owns the default DNS, has an exact timeout, and its parsing is testable in node. Shortcut: if the router isn't the LAN's DNS server, names come only from the other sources. Upgrade to `LinkProperties.dnsServers` if that bites.
- **Names never enter `HostEnrichment` or `deriveIdentityKey`.** They're written after reconcile by `applyDeviceNames`, which keeps `identityKey`. This removes the "known device looks new" risk instead of migrating keys.
- **Cleartext HTTP uses a raw TCP `GET ... HTTP/1.0`** through `tcpFetch`, on both platforms. App-wide cleartext and ATS policy stay untouched.

## Global Constraints

- Visible names only: `HomeNet` and `TunnelWall`. Package IDs `app.netlens` and `com.opentunnel.open_tunnel_vpn`, bundle IDs, folders, workspace package names, release ids (`netlens`, `open-tunnel`) and brand keys don't change.
- No ARP, `/proc/net/arp` or `ip neigh` (AGENTS hard rule 1).
- Sweep stays under 6 s for a /24 (NFR-1). Naming starts after the sweep. At most 16 targets are in flight, each lookup has a 1,500 ms timeout, and the whole pass takes about 5 s or less.
- SSDP `LOCATION` is fetched only when it is `http://` to the same private IPv4 that sent the SSDP reply. No redirects. 64 KB cap. 1,500 ms timeout.
- Every name is trimmed, stripped of control characters, whitespace-collapsed and capped at 64 characters.
- Name order: custom → mDNS instance → SSDP `friendlyName` → NetBIOS → first label of reverse-DNS hostname → SSDP `SERVER` (`vendorOrModel`) → IP.
- TypeScript is erasable only (no enums, namespaces or parameter properties), imports use the `.ts` extension, and every new `*.test.ts` is added to `packages/core/package.json` `test`.
- Copy is sentence case, active voice, with no emoji and no ALL CAPS. UI is built only from `@apps-hub/ui`.
- No new dependencies.
- Pushing to `main` auto-releases affected apps (docs/app-store.md §CI/CD). Work on a branch from `main`, since `deputy-speed` holds unrelated uncommitted work. Merging is the ship step, and it's the owner's call.

## Review Focus

1. **A device sends hostile or oversized replies** (binary junk in a name, a 10 MB XML, a `LOCATION` with CR/LF): names are sanitised and fetches capped. Tested in Task 2 (control characters), Task 3 (CR/LF in the path is rejected) and Task 5 (`maxBytes` cap).
2. **AirPlay/RAOP instance names like `A1B2C3D4E5F6@Living Room TV`**: the display shows `Living Room TV`. Tested in Task 2.
3. **The scan runs while OpenTunnel/TunnelWall holds the VPN**, so binding to Wi-Fi throws EPERM: the request still goes out on the default route and nothing crashes. Tested in Task 5 (bind lambda throws).
4. **The router doesn't answer DNS, or any single lookup rejects**: the other names still arrive and the pass never throws. Tested in Task 4.
5. **Upgrading a phone with an existing device list, and leaving the screen mid-pass**: old rows load with null names, nothing is flagged new, and no state updates happen after unmount. A manual check in Task 7, because expo-sqlite and screens don't run under node.

---

### Task 1: Rename the visible app names

**Files:**
- Modify: `apps/netlens/app.json` (`name`; `NSLocalNetworkUsageDescription` text), `apps/netlens/android/app/src/main/res/values/strings.xml` (`app_name`), `apps/netlens/ios/NetLens/Info.plist` (`CFBundleDisplayName`, `NSLocalNetworkUsageDescription`)
- Modify: `apps/netlens/src/screens/DiagnosticsScreen.tsx:157,186`, `apps/netlens/src/screens/ScannerScreen.tsx:391` (copy says "NetLens")
- Modify: `apps/open_tunnel_vpn/app.json` (`name`), `apps/open_tunnel_vpn/android/app/src/main/res/values/strings.xml`, `apps/open_tunnel_vpn/ios/OpenTunnel/Info.plist` (`CFBundleDisplayName`)
- Modify: `apps/open_tunnel_vpn/App.tsx:275` (Header title), `apps/open_tunnel_vpn/src/ui/settings-sheet.tsx:154`, `apps/open_tunnel_vpn/src/ui/home-screen.tsx:199`
- Modify: `apps/open_tunnel_vpn/android/app/src/main/java/com/opentunnel/open_tunnel_vpn/OpenTunnelVpnService.kt:202,256,259,287`, `engines/WireGuardEngine.kt:42` (`ActiveTunnel` name, which becomes the VPN session label), `engines/OpenVpnEngine.kt:81,113,135`
- Modify: `apps/open_tunnel_vpn/modules/open-tunnel-native/android/src/main/java/expo/modules/opentunnelnative/OpenTunnelNativeModule.kt:201` (error copy)
- Modify: `tools/release/src/apps.ts:12-17` (`name: 'HomeNet'`, `name: 'TunnelWall'`)
- Modify: `AGENTS.md` (app list: "**HomeNet** (`apps/netlens`, formerly NetLens)", "**TunnelWall** (`apps/open_tunnel_vpn`, formerly OpenTunnel)"), `apps/open_tunnel_vpn/AGENTS.md` title line

Leave alone: Expo module `Name(...)` strings, class names, the `@apps-hub/ui` brand keys, and the manifest test fixture in `packages/store-manifest` (it's test data, not shown to anyone).

- [ ] **Step 1: Replace each visible string listed above.** Copy reads "HomeNet …" and "TunnelWall …". The channel name becomes `"TunnelWall VPN"` and its description `"Status of the TunnelWall VPN service."`.
- [ ] **Step 2: Check that no visible old name is left.**
  Run: `grep -rnE "\"(NetLens|OpenTunnel)|'(NetLens|OpenTunnel)|>(NetLens|OpenTunnel)| (NetLens|OpenTunnel) " apps/netlens/App.tsx apps/netlens/src apps/netlens/app.json apps/open_tunnel_vpn/App.tsx apps/open_tunnel_vpn/src/ui apps/open_tunnel_vpn/app.json apps/open_tunnel_vpn/android/app/src/main apps/open_tunnel_vpn/modules/open-tunnel-native/android/src/main tools/release/src/apps.ts | grep -v "__tests__"`
  Expected: only comments, `Name("OpenTunnelNative")` and other code identifiers.
- [ ] **Step 3: Run the checks.** Run `pnpm test && pnpm typecheck`, then `cd apps/open_tunnel_vpn/android && JAVA_HOME=$JAVA_HOME ./gradlew :app:assembleDebug`. Expected: all pass, BUILD SUCCESSFUL.
- [ ] **Step 4: Commit.** `git commit -m "Rename NetLens to HomeNet and OpenTunnel to TunnelWall (visible names only)"`

---

### Task 2: Name text rules and display order (`packages/core`)

**Files:**
- Create: `packages/core/src/device-names.ts`
- Modify: `packages/core/src/device-repository.ts` (`StoredDevice` fields, `reconcileScan` new-row defaults)
- Modify: `packages/core/src/index.ts` (export `./device-names.ts`)
- Test: `packages/core/src/__tests__/device-names.test.ts` (add to `package.json` `test`), `packages/core/src/__tests__/device-repository.test.ts`

**Interfaces:**
- Produces:
  - `StoredDevice` gains `mdnsName: string | null; friendlyName: string | null; model: string | null; netbiosName: string | null`. New rows from `reconcileScan` start them as `null`; `enrichedRow` keeps them through the spread.
  - `interface DeviceNames { hostname: string | null; mdnsName: string | null; friendlyName: string | null; model: string | null; netbiosName: string | null }`
  - `sanitizeName(raw: string | null | undefined): string | null`
  - `cleanMdnsInstanceName(raw: string): string | null`, which strips a leading `^[0-9A-F]{12}@` and then sanitises.
  - `isPrivateIpv4(ip: string): boolean` covers 10/8, 172.16/12, 192.168/16 and 169.254/16, using `parseIpv4`.
  - `displayNameFor(device: StoredDevice): string`
  - `applyDeviceNames(device: StoredDevice, names: DeviceNames): StoredDevice`

- [ ] **Step 1: Write the failing tests** in `device-names.test.ts`:
  - `sanitizeName('  Living\u0000 Room\n TV ')` → `'Living Room TV'`
  - `sanitizeName('x'.repeat(80))` has length 64
  - `sanitizeName('   ')` → `null`; `sanitizeName(null)` → `null`
  - `cleanMdnsInstanceName('A1B2C3D4E5F6@Living Room TV')` → `'Living Room TV'`; `cleanMdnsInstanceName('HP LaserJet')` → `'HP LaserJet'`
  - `isPrivateIpv4`: `'192.168.1.5'` true, `'10.0.0.1'` true, `'172.31.0.1'` true, `'172.32.0.1'` false, `'8.8.8.8'` false, `'tv.local'` false
  - `displayNameFor`, built from a full fixture by nulling fields one at a time, returns in order: custom `'My TV'` → mdns `'Living Room TV'` → friendly `'Samsung Q60'` → netbios `'ALI-LAPTOP'` → hostname `'Galaxy-S24.lan'` shown as `'Galaxy-S24'` → vendorOrModel → `lastIp`
  - `applyDeviceNames(existing, { hostname: 'a.lan', mdnsName: null, … })` keeps `identityKey`, `id`, `customName`, `isTrusted`, sets `hostname`, and keeps the existing `mdnsName` where the new one is null

  In `device-repository.test.ts`, add `'a named device is matched, not new, on the next scan'`:
  - Seed key `ip:192.168.7.3` with `hostname: 'galaxy.lan'` and `mdnsName: 'Galaxy'`.
  - Reconcile host `192.168.7.3` with enrichment `{ usn: null, vendorOrModel: null }`.
  - Assert `isNew === false`, the same `id`, and `mdnsName === 'Galaxy'`.

  Also update `seedDevice` for the new fields.
- [ ] **Step 2: Run them and see them fail.** Run `node --test packages/core/src/__tests__/device-names.test.ts packages/core/src/__tests__/device-repository.test.ts`. Expected: FAIL (module not found, missing fields).
- [ ] **Step 3: Implement** the interfaces above. `applyDeviceNames` sanitises nothing; callers pass already-clean names. The display hostname is `hostname.split('.')[0]`.
- [ ] **Step 4: Run the tests and see them pass.** Same command. Expected: PASS. Then run `pnpm --filter @apps-hub/core typecheck`. It still fails only in `apps/netlens/src/db/device-store-sqlite.ts`, which Task 7 fixes; note this.
- [ ] **Step 5: Commit.** `git commit -m "core: device name sanitising, display order and name merge"`

---

### Task 3: Byte and text formats (`packages/core`)

**Files:**
- Create: `packages/core/src/name-formats.ts`
- Test: `packages/core/src/__tests__/name-formats.test.ts` (add to `package.json` `test`)

**Interfaces:**
- Produces (bytes are `number[]` of 0–255, because Hermes has no `Buffer`):
  - `buildPtrQuery(ip: string, id: number): number[]`, with RD set, QTYPE 12 and QCLASS 1
  - `parsePtrAnswer(bytes: readonly number[], id: number): string | null`. Returns the first PTR answer name without the trailing dot. Returns null on an ID mismatch, RCODE ≠ 0, ANCOUNT 0, truncation or a compression-pointer loop (more than 16 jumps). Never throws.
  - `buildNetbiosStatusRequest(id: number): number[]`, 50 bytes: header, then `0x20`, `'CK'`, 30 × `'A'`, `0x00`, then QTYPE `0x0021` and QCLASS `0x0001`
  - `parseNetbiosStatus(bytes: readonly number[], id: number): string | null`. Returns the first name whose suffix is `0x00` and whose flags have the group bit (`0x8000`) clear, right-trimmed. Never throws.
  - `ssdpDescriptionRequest(location: string, responderIp: string): { ip: string; port: number; request: string } | null`. Matches `/^http:\/\/(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?(\/\S*)?$/i` (no `URL`: React Native's `URL` lacks `hostname`/`port`). Requires the IP to equal `responderIp` and pass `isPrivateIpv4`, and the port to be in 1–65535. Defaults are port 80 and path `/`. The request is exactly `GET <path> HTTP/1.0\r\nHost: <ip>:<port>\r\nConnection: close\r\n\r\n`.
  - `parseHttpResponse(raw: string): { status: number; body: string } | null`
  - `extractDeviceDescription(xml: string): { friendlyName: string | null; manufacturer: string | null; modelName: string | null }`. Takes the first occurrence of each tag, decodes only `&amp; &lt; &gt; &quot; &apos;` and ignores `<!ENTITY>` declarations. Output isn't sanitised; the orchestrator sanitises.

- [ ] **Step 1: Write the failing tests** (`const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))`):
  - `buildPtrQuery('192.168.1.23', 0x1234)`: the first 12 bytes are `[0x12,0x34,0x01,0x00,0,1,0,0,0,0,0,0]`, the length is 43, and the last 4 are `[0,12,0,1]`.
  - The reply is `[...header(0x1234, flags 0x8180, qd 1, an 1), ...query.slice(12), 0xc0,0x0c, 0,12, 0,1, 0,0,0x0e,0x10, 0,16, 10, ...ascii('Galaxy-S24'), 3, ...ascii('lan'), 0]`. `parsePtrAnswer(reply, 0x1234)` gives `'Galaxy-S24.lan'`, ID `0x9999` gives null, and flags `0x8183` give null. A reply cut at byte 50 gives null, and a pointer to itself (`0xc0, <own offset>`) gives null.
  - `buildNetbiosStatusRequest(0x42)`: length 50; bytes 12–13 are `[0x20, 0x43]`; the last 4 are `[0,0x21,0,1]`.
  - The NetBIOS reply is: header `0x0042`, flags `0x8400`, AN 1; the 34-byte answer name; TYPE `0x21`, CLASS 1, TTL 0, RDLENGTH 37, count 2; `'WORKGROUP'` padded to 15 + `0x00` + flags `0x84,0x00`; `'ALI-LAPTOP'` padded + `0x00` + `0x04,0x00`. Expect `'ALI-LAPTOP'`. A reply with only the group name gives null.
  - `ssdpDescriptionRequest('http://192.168.1.10:49152/desc.xml', '192.168.1.10')` gives the exact object. `https://…`, a host ≠ responder, `'http://8.8.8.8/x'` with responder `'8.8.8.8'`, `'http://tv.local/x'`, and `'http://192.168.1.10/a\r\nX: y'` all give null. `'http://192.168.1.10'` gives port 80 and path `/`.
  - `parseHttpResponse('HTTP/1.1 200 OK\r\nContent-Type: text/xml\r\n\r\n<root/>')` gives `{ status: 200, body: '<root/>' }`; `'garbage'` gives null.
  - `extractDeviceDescription('<root><device><friendlyName>Living Room &amp; Den</friendlyName><manufacturer>Samsung</manufacturer><modelName>Q60</modelName></device></root>')` gives the three fields with `'Living Room & Den'`; `'<root/>'` gives all null.
- [ ] **Step 2: Run them and see them fail.** Run `node --test packages/core/src/__tests__/name-formats.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run the tests and see them pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "core: PTR, NetBIOS, SSDP description and HTTP formats"`

---

### Task 4: Native contract + name orchestrator (`packages/core`)

**Files:**
- Modify: `packages/core/src/native-binding.ts` (two methods), `packages/core/src/model.ts` (`ServiceEvent`)
- Create: `packages/core/src/name-resolver.ts`
- Modify fakes so they still compile: `packages/core/src/__tests__/dns-benchmark.test.ts`, `tcp-scan-engine.test.ts`, `ping-engine.test.ts` (add `udpRequest`/`tcpFetch` returning `null`)
- Test: `packages/core/src/__tests__/name-resolver.test.ts` (add to `package.json` `test`)

**Interfaces:**
- Consumes: Task 2 `DeviceNames`, `sanitizeName`, `cleanMdnsInstanceName`; Task 3 builders and parsers.
- Produces:
  - `NetLensNativeBinding.udpRequest(ip: string, port: number, payload: readonly number[], timeoutMs: number): Promise<number[] | null>`. Sends one datagram and resolves with the first reply from `ip:port`, or null on timeout or error. Private targets go out on Wi-Fi when possible.
  - `NetLensNativeBinding.tcpFetch(ip: string, port: number, request: string, timeoutMs: number, maxBytes: number): Promise<string | null>`. Connects, writes `request` and reads until EOF or `maxBytes` (returning what it read), decoded as UTF-8. Null on connect failure or timeout before any byte.
  - `ServiceEvent.kind` becomes `'mdns' | 'ssdp' | 'mdns-instance'`, adding `instanceName?: string | null` and `serviceType?: string | null`. `host` carries the instance's IPv4.
  - `interface NameTarget { ip: string; ssdpLocation: string | null; mdnsName: string | null }`
  - `resolveDeviceNames(binding: Pick<NetLensNativeBinding, 'udpRequest' | 'tcpFetch'>, targets: readonly NameTarget[], gatewayIp: string | null, onNames?: (ip: string, names: DeviceNames) => void, options?: { concurrency?: number; timeoutMs?: number }): Promise<Map<string, DeviceNames>>`. Defaults are concurrency 16 and `timeoutMs` 1500. For each target it runs PTR (only when `gatewayIp` is set), NetBIOS and the SSDP fetch (only when `ssdpDescriptionRequest` accepts it, with `maxBytes` 65536) in parallel, and accepts the body only on HTTP status 200. `model` is `sanitizeName(manufacturer + ' ' + modelName)`. It calls `onNames` as each target finishes and never rejects.
  - Constants exported from `name-resolver.ts`: `NAME_CONCURRENCY = 16`, `NAME_LOOKUP_TIMEOUT_MS = 1500`, `SSDP_DESCRIPTION_MAX_BYTES = 65536`.

- [ ] **Step 1: Write the failing tests** with a fake binding that records calls:
  - Single target `{ ip: '192.168.1.23', ssdpLocation: null, mdnsName: ' Living Room TV\n' }` with gateway `'192.168.1.1'`:
    - `udpRequest` is called with `('192.168.1.1', 53, <buildPtrQuery bytes>, 1500)` and `('192.168.1.23', 137, <buildNetbiosStatusRequest bytes>, 1500)`.
    - The fake returns the Task 3 replies (the query ID is taken from the payload's first two bytes).
    - The result is `{ hostname: 'Galaxy-S24.lan', netbiosName: 'ALI-LAPTOP', mdnsName: 'Living Room TV', friendlyName: null, model: null }`, and `onNames` was called once.
  - 40 targets, with a fake that holds each call 5 ms and tracks in-flight targets: max in-flight targets ≤ 16.
  - `udpRequest` rejects for one target and returns null for another: both get entries with null network names, and the promise resolves.
  - `gatewayIp: null`: no call to port 53.
  - `ssdpLocation: 'http://192.168.1.99/d.xml'` for target `192.168.1.23`: `tcpFetch` is never called. `ssdpLocation: 'http://192.168.1.23:8080/d.xml'` with the fake returning the Task 3 HTTP 200 + XML gives `friendlyName: 'Living Room & Den'` and `model: 'Samsung Q60'`. A fake returning `'HTTP/1.1 302 Found\r\n\r\n'` gives `friendlyName: null`.
- [ ] **Step 2: Run them and see them fail.** Run `node --test packages/core/src/__tests__/name-resolver.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `resolveDeviceNames`. A small bounded `map` over targets (a shared cursor plus N workers) belongs inline in this file; don't add a dependency.
- [ ] **Step 4: Run the tests and see them pass.** Run `pnpm --filter @apps-hub/core test`. Expected: all PASS.
- [ ] **Step 5: Commit.** `git commit -m "core: name lookup contract and bounded name resolver"`

---

### Task 5: Android native: `udpRequest`, `tcpFetch`, mDNS instances

**Files:**
- Create: `apps/netlens/modules/netlens-core/android/src/main/java/expo/modules/netlenscore/NameProbes.kt`
- Modify: `.../netlenscore/NetlensCoreModule.kt` (two `AsyncFunction`s), `.../netlenscore/MdnsProbe.kt` (instance browse + resolve)
- Test: `apps/netlens/modules/netlens-core/android/src/test/java/expo/modules/netlenscore/NameProbesTest.kt`

**Interfaces:**
- Consumes: the Task 4 contract (exact JS names `udpRequest` and `tcpFetch`, argument order as declared).
- Produces:
  - `object NameProbes`, with `suspend fun udpRequest(ip: String, port: Int, payload: ByteArray, timeoutMs: Int, bind: (DatagramSocket) -> Unit = {}): ByteArray?` and `suspend fun tcpFetch(ip: String, port: Int, request: String, timeoutMs: Int, maxBytes: Int, socketFactory: () -> Socket = { Socket() }): String?`.
  - In the module, `bind` is `{ s -> PlatformNetwork.lanNetwork(cm)?.bindSocket(s) }` wrapped in `runCatching` when the target is private. `socketFactory` is `PlatformNetwork.socketFactoryFor(context, ip)`.
  - The JS payload arrives as `List<Int>`, and the reply goes back as `List<Int>` (0–255).
  - The mDNS event map is `{"kind": "mdns-instance", "instanceName", "serviceType", "host"}`.

- [ ] **Step 1: Write the failing JVM tests:**
  - `udpRequest returns the reply from a loopback echo`: a `DatagramSocket` on 127.0.0.1 echoes the payload, and the result equals the payload.
  - `udpRequest returns null when nothing answers within the timeout`: a port with no listener and a 200 ms timeout give null within 1 s.
  - `udpRequest still sends when bind throws`: `bind = { throw SecurityException("EPERM") }` against the echo still returns the payload.
  - `tcpFetch caps at maxBytes`: a loopback `ServerSocket` writes 100 × `'a'`, and `maxBytes` 10 returns `"aaaaaaaaaa"`.
  - `tcpFetch returns null when the connection is refused`: a closed port returns null.
- [ ] **Step 2: Run them and see them fail.** Run `cd apps/netlens/android && JAVA_HOME=$JAVA_HOME ./gradlew :netlens-core:testDebugUnitTest --tests '*NameProbesTest*'`. Expected: FAIL (unresolved reference).
- [ ] **Step 3: Implement `NameProbes`** on `Dispatchers.IO`. `udpRequest` ignores datagrams that don't come from `ip:port` and keeps reading until the deadline. `tcpFetch` uses `connect(addr, timeoutMs)` with `soTimeout`, an overall deadline, and decodes UTF-8 with replacement.
- [ ] **Step 4: Run the tests and see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Wire the two `AsyncFunction`s** in `NetlensCoreModule.kt`, rejecting with `ERR_INVALID_PARAMS` for a payload byte outside 0–255, a port outside 1–65535 or `maxBytes` ≤ 0.
- [ ] **Step 6: Add mDNS instances to `MdnsProbe`.**
  - For each meta-query result, the browsable type is `serviceName` + `.` + `serviceType` with the trailing `.local.` removed, e.g. `_googlecast._tcp`.
  - Start `discoverServices(type, PROTOCOL_DNS_SD, …)` for it, and queue found instances.
  - A single consumer resolves them one at a time (`resolveService`; pre-34 rejects concurrent resolves) with a 1,500 ms timeout each, at most 32 per window. It emits only IPv4 hosts.
  - Stop every listener in `finally` at the window's end. The multicast lock rule (hard rule 4) is already covered by `MdnsProbe`'s caller; keep it that way.
- [ ] **Step 7: Run the Android gate.** Run `cd apps/netlens/android && JAVA_HOME=$JAVA_HOME ./gradlew :netlens-core:testDebugUnitTest :app:assembleDebug`. Expected: BUILD SUCCESSFUL, all tests pass.
- [ ] **Step 8: Commit.** `git commit -m "netlens-core android: udpRequest, tcpFetch, mDNS instance names"`

---

### Task 6: iOS native: `udpRequest`, `tcpFetch`, mDNS instances

**Files:**
- Create: `apps/netlens/modules/netlens-core/ios/NameProbes.swift`
- Modify: `.../ios/NetlensCoreModule.swift` (two `AsyncFunction`s and the instance events), `.../ios/MdnsBrowser.swift`
- Modify: `apps/netlens/app.json` and `apps/netlens/ios/NetLens/Info.plist`. Both get the same `NSBonjourServices`: the existing two plus `_airplay._tcp`, `_raop._tcp`, `_googlecast._tcp`, `_ipp._tcp`, `_printer._tcp`, `_hap._tcp`, `_smb._tcp`, `_spotify-connect._tcp`, `_device-info._tcp`, `_companion-link._tcp`.

**Interfaces:**
- Consumes: the Task 4 contract. The Swift signatures are `AsyncFunction("udpRequest") { (ip: String, port: Int, payload: [Int], timeoutMs: Int, promise: Promise) in … }` and `AsyncFunction("tcpFetch") { (ip: String, port: Int, request: String, timeoutMs: Int, maxBytes: Int, promise: Promise) in … }`.
- Produces: the same event map as Task 5.

- [ ] **Step 1: Implement `NameProbes.swift`.**
  - `udpRequest` uses a BSD socket with `SO_RCVTIMEO`, following `SsdpProbe.swift`, and accepts only replies from `ip:port`.
  - `tcpFetch` uses `NWConnection(host:port:using: .tcp)`, with a deadline and a receive loop capped at `maxBytes`.
  - Validation and rejection codes match Task 5 Step 5.
- [ ] **Step 2: Add instance browsing to `MdnsBrowser`.**
  - Run one `NWBrowser(for: .bonjour(type:domain: "local"))` per type in the list above, apart from the meta-query.
  - Resolve each `.service` result by opening `NWConnection(to: result.endpoint, using: .tcp)`. On `.ready`, read `currentPath?.remoteEndpoint` as `.hostPort(.ipv4(addr), _)`, emit, and cancel.
  - Use a 1,500 ms timeout and at most 32 per window. Everything stops in `stop()`.
- [ ] **Step 3: Run the iOS gate.** Run `cd apps/netlens/ios && xcodebuild -workspace NetLens.xcworkspace -scheme NetLens -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -configuration Debug build CODE_SIGNING_ALLOWED=NO`. Expected: `** BUILD SUCCEEDED **`.
- [ ] **Step 4: Commit.** `git commit -m "netlens-core ios: udpRequest, tcpFetch, mDNS instance names"`

---

### Task 7: HomeNet app wiring: adapter, database, scanner screen

**Files:**
- Modify: `apps/netlens/modules/netlens-core/src/NetlensCoreModule.ts` (declare the two natives), `apps/netlens/modules/netlens-core/src/index.ts` (adapter methods)
- Modify: `apps/netlens/src/db/device-store-sqlite.ts` (migration + four columns)
- Modify: `apps/netlens/src/screens/ScannerScreen.tsx`

**Interfaces:**
- Consumes: the Task 4 contract and `resolveDeviceNames`; Task 2 `displayNameFor`, `applyDeviceNames`, `cleanMdnsInstanceName`.
- Produces: the finished feature.

- [ ] **Step 1: Write the adapter methods.** `udpRequest` passes `[...payload]` and coerces the reply: an array of integers 0–255, or else null. `tcpFetch` returns a string, or else null. Follow the coercion style of `measureTcpHandshake`.
- [ ] **Step 2: Migrate the database.** After `SCHEMA_SQL`, read `PRAGMA user_version`. When it's 0, run `ALTER TABLE devices ADD COLUMN mdns_name TEXT`, then `friendly_name`, `model` and `netbios_name` the same way, then `PRAGMA user_version = 1`. All of it runs in one `withTransactionAsync`. Leave `SCHEMA_SQL`'s `CREATE TABLE` unchanged, so fresh and upgraded databases follow the same path. Add the four fields to `DeviceRow`, `rowToDevice`, `deviceToParams` and the insert/update SQL.
- [ ] **Step 3: Rework `ScannerScreen`:**
  - Keep `location` in `ssdpByIp`.
  - Collect `mdnsByIp` from `'mdns-instance'` events, keeping the first `cleanMdnsInstanceName` per host.
  - Replace `deviceName()` with `displayNameFor`.
  - After `setPhase('done')`, call `resolveDeviceNames(bindingProxy, targets, info.gatewayIp, onNames)` for the devices `seenThisScan`. `onNames` merges with `applyDeviceNames`, calls `store.updateDevice`, and replaces that row in state.
  - Guard with a `cancelled`/mounted ref, so nothing runs after unmount or a new scan.
  - A store write failure sets `errorNote` with the existing copy pattern. Lookup failures stay silent.
  - Do not put names into `enrichment`, because identity must stay put (spec "No false new device alarms").
- [ ] **Step 4: Add detail sheet rows** after "Hostname": "Bonjour name" (`mdnsName`), "UPnP name" (`friendlyName`), "Model" (`model`) and "Windows name" (`netbiosName`), each shown only when non-null, using the existing `<Fact>`.
- [ ] **Step 5: Run all the checks.** Run `pnpm test && pnpm typecheck`, then the Task 5 Android gate and the Task 6 iOS gate. Expected: all pass.
- [ ] **Step 6: Commit.** `git commit -m "HomeNet: name devices after each scan"`
- [ ] **Step 7: Check on the owner's phone** after the owner merges and the Store release lands. Install through the Store only, never adb.
  - (a) The device list from before the update is still there, with no "New" badges on known devices.
  - (b) After a scan, most devices show names, and the detail sheet shows where each came from.
  - (c) Leaving the screen mid-scan doesn't crash.
  - (d) Scanning while TunnelWall is connected to a server shows no invented hosts.

  Record the results in `docs/handoffs/network-toolkit.md`.

---

### Task 8: Docs and handoff

**Files:**
- Modify: `docs/netlens/SPEC.md`: one short section, "Device names", listing the four sources, the order, the trust-boundary limits and the native primitives.
- Modify: `docs/handoffs/network-toolkit.md` (session log, current state)

- [ ] **Step 1: Write the SPEC section and update the handoff.**
- [ ] **Step 2: Commit.** `git commit -m "docs: HomeNet device names"`

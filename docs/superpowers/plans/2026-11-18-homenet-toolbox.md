# HomeNet Toolbox Implementation Plan

> **For agentic workers:** This repo's owner forbids `superpowers:subagent-driven-development`. Execute with `cd-engineering-tools:phased-orchestration` (one phase agent per Phase below) running the per-task loop of `cd-engineering-tools:parallel-agents-coord`, or inline with `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Router tab (UPnP facts, live usage meter, open-door list), device remotes, a Who's home tab, Wake-on-LAN and a guest Wi-Fi QR code to HomeNet.

**Architecture:** All protocol logic is pure TS in `packages/core`, reaching the LAN through the existing `NetLensNativeBinding` (`tcpFetch`, `measureTcpHandshake`, `startServiceDiscovery`) behind one LAN guard. The only native addition is `sendUdpBroadcast` (Kotlin + Swift + contract + adapter). Screens use `@apps-hub/ui`; navigation stays `TabBar`.

**Tech Stack:** TypeScript (erasable only, `.ts` imports), `node --test`, React Native 0.81 / Expo 54, expo-sqlite, Kotlin, Swift, `qrcode-generator` (MIT, new).

**Spec:** `docs/superpowers/specs/2026-11-18-homenet-toolbox-design.md`

## Global Constraints

- AGENTS.md hard rules: no ARP, TCP RST (`refused`) = host alive, bounded concurrency (≤ 64 sockets), F-Droid pure FOSS, modern Android APIs.
- Every new request goes through `httpRequest` (Task 1), which refuses any target that is not a private IPv4 inside `InterfaceInfo.localIp`/`cidrPrefix`.
- Plain `http://` only (no TLS). Requests are HTTP/1.0 with `Connection: close`.
- No traffic leaves the LAN; no telemetry; no action fires without a user tap (detection is read-only GETs).
- Each new `*.test.ts` is added by name to `packages/core/package.json` `test` script.
- UI from `@apps-hub/ui` only; sentence case, plain words, errors say what happened and how to fix it. QR is black on white (stated exception).
- Tabs: Devices, Home, Router, Checks (in that order).
- Commits carry no Claude attribution lines (owner rule).
- No release, no Store publish, no phone install until the owner says go. One HomeNet version bump (`app.json` `0.1.0` → `0.2.0`) in Task 18.
- Phone testing only via a Store install of a release build, claimed through `coord claim device:<serial>`; never an emulator.

## Review Focus

1. **Router with UPnP off or refusing actions** (no IGD, SOAP fault 401/606, HTTP 500): the Router tab shows the "turn on UPnP" notice or hides that card; never a crash or spinner forever. Tests in Task 3.
2. **A description whose control URL points off the LAN** (public IP, other subnet, hostname): the call is refused. Tests in Tasks 1 and 3.
3. **Byte counter wrap and router reboot** (32-bit wrap, counter reset to near 0): wrap is corrected; an implausible rate (> 10 Gbit/s) is dropped, not shown. Test in Task 3.
4. **Wi-Fi names and passwords with `\ ; , : "`** and non-ASCII: QR text escapes them and still encodes. Test in Task 17.
5. **Phone on a VPN (TunnelWall connected)**: LAN requests and the wake broadcast still leave over Wi-Fi (existing socket binding). Manual check in Task 18's phone pass.

---

## Phase 0: Setup

### Task 0: Worktree and carry the port check

- [ ] **Step 1:** `git worktree add ~/Documents/apps-hub-wt/homenet-toolbox -b homenet-toolbox main`
- [ ] **Step 2:** Copy from the main checkout into the worktree: `packages/core/src/port-check.ts`, `packages/core/src/__tests__/port-check.test.ts`; re-apply the diffs of `packages/core/package.json`, `packages/core/src/index.ts`, `apps/netlens/src/screens/ScannerScreen.tsx`, `apps/netlens/src/screens/DiagnosticsScreen.tsx` (`git -C <main> diff -- <files> | git apply`). Copy the spec and this plan.
- [ ] **Step 3:** In the worktree: `pnpm install && pnpm --filter @apps-hub/core test && pnpm --filter netlens typecheck` → all pass.
- [ ] **Step 4:** Commit `HomeNet: port check, open web page, router settings button` (+ spec and plan as a second commit `docs: HomeNet toolbox design and plan`).
- [ ] **Step 5:** Write `docs/handoffs/homenet-toolbox.md` (resume prompt, goal, decisions, file map, session log, next step) per the owner's handoff contract; update it at each phase end.

---

## Phase 1: Router dashboard

### Task 1: LAN guard and HTTP helper

**Files:** Create `packages/core/src/lan-http.ts`, test `packages/core/src/__tests__/lan-http.test.ts`; modify `packages/core/src/index.ts`.

**Interfaces — Produces:**
- `interface HttpTarget { ip: string; port: number; path: string }`
- `isLanTarget(ip: string, iface: InterfaceInfo): boolean`
- `parseHttpUrl(url: string, base?: HttpTarget): HttpTarget | null` — absolute `http://a.b.c.d[:port]/path` or a path relative to `base`; `null` for https, hostnames, bad ports.
- `httpRequest(binding: Pick<NetLensNativeBinding,'tcpFetch'>, iface: InterfaceInfo, target: HttpTarget, init: { method?: 'GET'|'POST'; headers?: Record<string,string>; body?: string; timeoutMs?: number; maxBytes?: number }): Promise<{ status: number; body: string } | null>` — `null` when refused by the guard or no reply. Defaults: `timeoutMs` 1500, `maxBytes` 65536. Sets `Host`, `Connection: close`, and `Content-Length` = UTF-8 byte length (`TextEncoder`) when a body is given. Parses with `parseHttpResponse`.
- `parseJsonObject(body: string): Record<string, unknown> | null`

- [ ] **Step 1: Failing tests** (`lan-http.test.ts`):
  - `isLanTarget accepts same-subnet private and refuses others`: iface `{localIp:'192.168.1.20', cidrPrefix:24, gatewayIp:'192.168.1.1'}` → `192.168.1.1` true; `192.168.2.1` false; `8.8.8.8` false; `10.0.0.1` false. iface `/16` `10.1.2.3` → `10.1.200.9` true.
  - `parseHttpUrl`: `'http://192.168.1.1:5000/rootDesc.xml'` → `{ip:'192.168.1.1',port:5000,path:'/rootDesc.xml'}`; `'/ctl/IPConn'` with base → base ip/port, that path; `'https://192.168.1.1/'` → null; `'http://router.local/'` → null; port `70000` → null.
  - `httpRequest refuses an off-LAN target without calling tcpFetch` (fake records calls; expect 0 calls, result null).
  - `httpRequest sends Content-Length in bytes`: body `'é'` → header `Content-Length: 2`.
  - `parseJsonObject`: `'{"a":1}'` → `{a:1}`; `'[1]'`, `'nope'` → null.
- [ ] **Step 2:** `node --test packages/core/src/__tests__/lan-http.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement the signatures above.
- [ ] **Step 4:** Same command → PASS; add the file to the `test` script; `pnpm --filter @apps-hub/core test` → PASS.
- [ ] **Step 5:** Commit `core: LAN-only HTTP helper`.

### Task 2: UPnP SOAP

**Files:** Create `packages/core/src/upnp-soap.ts`, test `__tests__/upnp-soap.test.ts`.

**Interfaces — Consumes:** Task 1. **Produces:**
- `interface SoapService { serviceType: string; control: HttpTarget }`
- `buildSoapEnvelope(serviceType: string, action: string, args: ReadonlyArray<[string, string]>): string` — XML-escapes values; argument order kept (UPnP is order-sensitive).
- `type SoapResult = { ok: true; values: Record<string, string> } | { ok: false; errorCode: number | null }`
- `parseSoapResponse(status: number, body: string): SoapResult` — on 200, every leaf element inside `<u:{action}Response>` (any prefix) into `values`, entity-decoded; otherwise `errorCode` from `<errorCode>`.
- `soapCall(binding, iface, service: SoapService, action: string, args?: ReadonlyArray<[string,string]>, timeoutMs?: number): Promise<SoapResult>` — POST with `SOAPAction: "<serviceType>#<action>"`, `Content-Type: text/xml; charset="utf-8"`; no reply → `{ ok:false, errorCode:null }`.

- [ ] **Step 1: Failing tests:** envelope contains `<u:GetExternalIPAddress xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1">` and escapes `a&b<` as `a&amp;b&lt;`; parse of a real `GetExternalIPAddressResponse` sample → `values.NewExternalIPAddress === '203.0.113.7'`; parse of a 500 fault with `<errorCode>713</errorCode>` → `{ok:false, errorCode:713}`; garbage body with 200 → `{ok:true, values:{}}`.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS, register test.
- [ ] **Step 5:** Commit `core: UPnP SOAP envelope and response parsing`.

### Task 3: Internet gateway (IGD) client

**Files:** Create `packages/core/src/igd.ts`, test `__tests__/igd.test.ts` (with real-shaped description XML fixtures for a WANIPConnection:2 router and a WANPPPConnection:1 router).

**Interfaces — Consumes:** Tasks 1–2, `ServiceEvent`, `extractDeviceDescription` patterns. **Produces:**
- `interface IgdServices { wan: SoapService; common: SoapService | null }`
- `findIgdServices(descriptionXml: string, location: HttpTarget): IgdServices | null` — first `WANIPConnection:*` else `WANPPPConnection:1`; `common` = `WANCommonInterfaceConfig:1`; control URLs resolved against `<URLBase>` when present, else `location`.
- `discoverIgd(binding: Pick<NetLensNativeBinding,'tcpFetch'>, iface: InterfaceInfo, events: readonly ServiceEvent[]): Promise<IgdServices | null>` — tries each `ssdp` event whose `host === iface.gatewayIp` (IGD USNs first), fetches its LOCATION via `httpRequest`; first success wins.
- `interface RouterFacts { externalIp: string | null; connected: boolean | null; uptimeSec: number | null; maxDownBps: number | null; maxUpBps: number | null }`
- `getRouterFacts(binding, iface, igd): Promise<RouterFacts>` — `GetExternalIPAddress`, `GetStatusInfo` (`NewConnectionStatus === 'Connected'`, `NewUptime`), `GetCommonLinkProperties` (`NewLayer1DownstreamMaxBitRate`/`Upstream`); each failing call leaves its fields null.
- `interface ByteCounters { rx: number; tx: number; atMs: number }`
- `readByteCounters(binding, iface, igd, nowMs: number): Promise<ByteCounters | null>` — `GetTotalBytesReceived/Sent`; null if `common` is null or either fails.
- `rateBps(prev: ByteCounters, next: ByteCounters): { downBps: number; upBps: number } | null` — delta, `+ 2**32` when negative; null if elapsed ≤ 0 or either rate > 10e9.
- `interface PortMapping { remoteHost: string; externalPort: number; protocol: 'TCP' | 'UDP'; internalClient: string; internalPort: number; description: string; enabled: boolean }`
- `listPortMappings(binding, iface, igd): Promise<PortMapping[]>` — `GetGenericPortMappingEntry` from 0, stop at first failure or 64 entries.
- `deletePortMapping(binding, iface, igd, m: PortMapping): Promise<boolean>`

- [ ] **Step 1: Failing tests:**
  - `findIgdServices` on both fixtures → expected serviceType and control path; fixture with `<URLBase>http://192.168.1.1:49152/</URLBase>` resolves to port 49152.
  - `findIgdServices` where controlURL is `http://203.0.113.9/ctl` → the service's `control` is kept, but `getRouterFacts` with that igd makes **zero** tcpFetch calls (guard) and returns all-null facts.
  - `discoverIgd` ignores ssdp events from non-gateway hosts.
  - `getRouterFacts`: fake replying to the three actions → `{externalIp:'203.0.113.7', connected:true, uptimeSec:3600, maxDownBps:100000000, maxUpBps:20000000}`; fake returning fault 606 for all → all null.
  - `rateBps`: 1000→3000 bytes over 2000 ms → 8000 bps (bits); `rx` 4294967000→200 over 1000 ms → wrapped 496 bytes → 3968 bps; reset `rx` 4e9→10 over 100 ms (wrap-corrected 2.36e9 bits in 0.1 s > 10e9 bps) → null.
  - `listPortMappings`: fake with 2 entries then fault 713 → 2 mappings, parsed fields; fake that never faults → exactly 64 calls.
- [ ] **Step 2–4:** FAIL → implement → PASS, register test.
- [ ] **Step 5:** Commit `core: UPnP internet gateway client`.

### Task 4: Router tab

**Files:** Create `apps/netlens/src/screens/RouterScreen.tsx`; modify `apps/netlens/App.tsx` (tabs now Devices / Router / Checks; Scanner relabelled "Devices", Diagnostics "Checks"; Home is inserted second in Task 12).

**Interfaces — Consumes:** Task 3; `openDeviceStore`, `hashNetworkId`, `computeSubnetForHost`, `displayNameFor`.

- [ ] **Step 1:** On mount/focus: `detectInterface`; collect `onServiceDiscovered` events during `startServiceDiscovery(3000)`; `discoverIgd`. States: finding, no-wifi, no-upnp, ready.
- [ ] **Step 2:** Ready: Group "Internet" with Rows: Public IP (selectable mono), Status (Connected / Not connected), Up for (`2 d 4 h` style), Line speed (when known). Group "Using now": two `Readout`s Download/Upload in Mbit/s, updated every 2000 ms via `readByteCounters` + `rateBps` while the tab is shown; card hidden when the first two reads give null.
- [ ] **Step 3:** Group "Open doors to the internet" (footer: "Devices asked your router to let the internet reach them."): one Row per mapping, title = description or "Unnamed", subtitle `TCP 25565 → <device name or IP>:25565`; trailing `Close` button → confirm `Sheet` naming the mapping → `deletePortMapping` → reload. Empty: "No open doors. Nothing on your network asked the router to accept connections from the internet."
- [ ] **Step 4:** No UPnP: `Notice` "Your router doesn't share its status. Turn on UPnP in its settings to see it here." plus a `Settings` button (`http://<gateway>/`). Ready state also shows that button.
- [ ] **Step 5:** Stop the meter interval and ignore late results when the tab unmounts (generation ref like `scanGeneration`).
- [ ] **Step 6:** `pnpm --filter netlens typecheck` → pass. Commit `HomeNet: Router tab`.

---

## Phase 2: Device remote

### Task 5: Keep every SSDP location per IP

**Files:** Modify `apps/netlens/src/screens/ScannerScreen.tsx` (~lines 193–198, 270–276).

- [ ] **Step 1:** Replace the per-IP single SSDP entry with `{ usn, vendor, locations: string[] }` (append unique locations). Name lookup keeps using the first location. Expose the last scan's `locationsByIp: Map<string, string[]>` in a ref for the sheet.
- [ ] **Step 2:** typecheck → pass. Commit `HomeNet: keep every UPnP location per device`.

### Task 6: Control detection

**Files:** Create `packages/core/src/device-controls.ts`, test `__tests__/device-controls.test.ts`.

**Interfaces — Consumes:** Tasks 1–2. **Produces:**
- `type DetectedControl = { kind: 'roku' } | { kind: 'dlna'; rendering: SoapService | null; transport: SoapService | null } | { kind: 'shelly'; gen: 1 | 2 } | { kind: 'tasmota'; locked: boolean } | { kind: 'wled' }`
- `findMediaServices(descriptionXml: string, location: HttpTarget): { rendering: SoapService | null; transport: SoapService | null }`
- `detectControls(binding: Pick<NetLensNativeBinding,'tcpFetch'>, iface: InterfaceInfo, ip: string, ssdpLocations: readonly string[]): Promise<DetectedControl[]>` — runs in parallel, each ≤ 1500 ms, GET only: Roku `:8060/query/device-info` (200 + `<device-info`); Shelly `/shelly` (JSON; `gen >= 2` → 2 else 1); Tasmota `/cm?cmnd=Power` (JSON with `POWER*` → unlocked; 401 → locked); WLED `/json/info` (`brand === 'WLED'`); DLNA from each location, then `http://<ip>:1400/xml/device_description.xml` (Sonos) when no location gave media services. At most one `dlna` entry.

- [ ] **Step 1: Failing tests** with a fake `tcpFetch` keyed by `port + path`: Roku reply → `[{kind:'roku'}]`; Shelly `{"gen":2}` → gen 2, `{"type":"SHSW-1"}` → gen 1; Tasmota 401 → `locked:true`; WLED `{"brand":"WLED"}` → wled; a Sonos description with RenderingControl+AVTransport → dlna with both; silent device → `[]`; every request in every test is a GET (assert request starts with `GET `).
- [ ] **Step 2–4:** FAIL → implement → PASS, register.
- [ ] **Step 5:** Commit `core: detect controllable devices`.

### Task 7: Control actions

**Files:** Same module or `packages/core/src/device-actions.ts`; test `__tests__/device-actions.test.ts`.

**Interfaces — Produces:**
- `type RokuKey = 'Home'|'Back'|'Up'|'Down'|'Left'|'Right'|'Select'|'Play'|'VolumeUp'|'VolumeDown'|'VolumeMute'|'PowerOff'`
- `rokuKey(binding, iface, ip, key: RokuKey): Promise<boolean>` — `POST :8060/keypress/<key>`, empty body, 200 → true.
- `dlnaTransport(binding, iface, transport: SoapService, action: 'Play'|'Pause'|'Next'|'Previous'): Promise<boolean>` — args `InstanceID=0` (+ `Speed=1` for Play).
- `dlnaGetVolume / dlnaSetVolume(…, level: number)` (clamped 0–100), `dlnaGetMute / dlnaSetMute(…, muted: boolean)` — `InstanceID=0`, `Channel=Master`.
- `plugGetPower(binding, iface, ip, c: Extract<DetectedControl,{kind:'shelly'|'tasmota'}>): Promise<boolean | null>`; `plugSetPower(…, on: boolean): Promise<boolean | null>` — returns the state the device reports after. Gen1 `/relay/0` and `/relay/0?turn=on|off`; Gen2 `/rpc/Switch.GetStatus?id=0` (`output`) and `/rpc/Switch.Set?id=0&on=true|false`; Tasmota `/cm?cmnd=Power` and `/cm?cmnd=Power%20On|Off` (`POWER` or `POWER1`).
- `wledGet(binding, iface, ip): Promise<{ on: boolean; bri: number } | null>`; `wledSet(binding, iface, ip, change: { on?: boolean; bri?: number }): Promise<{ on: boolean; bri: number } | null>` — `GET /json/state`, `POST /json/state` with JSON body and `"v":true`; `bri` clamped 1–255.

- [ ] **Step 1: Failing tests:** each action's exact request line (method + path) and parse of a sample reply; `dlnaSetVolume(…, 140)` sends `<DesiredVolume>100</DesiredVolume>`; Shelly Gen2 set → path `/rpc/Switch.Set?id=0&on=true`; a reply with a non-boolean `output` → null.
- [ ] **Step 2–4:** FAIL → implement → PASS, register.
- [ ] **Step 5:** Commit `core: device control actions`.

### Task 8: Controls in the device sheet

**Files:** Create `apps/netlens/src/components/DeviceControls.tsx`; modify `ScannerScreen.tsx` sheet (place above `Details`).

- [ ] **Step 1:** On sheet open, `detectControls(binding, iface, detail.lastIp, locationsByIp.get(ip) ?? [])`; result applied only if the sheet still shows that device (compare ip, like `runPortCheck`).
- [ ] **Step 2:** Render one `Group` per control: Roku — 3×3 D-pad (Up/Left/OK/Right/Down) + Home, Back, Play/Pause, Vol −, Vol +, Mute, Power off buttons; DLNA — Play, Pause, Previous, Next, volume `−`/`+` (steps of 5) with the level as a `Readout`, Mute switch; Shelly/Tasmota — `Switch` "Power" with state from `plugGetPower`; locked Tasmota — Row "This plug has a password. HomeNet can't control it yet."; WLED — Power switch, brightness `−`/`+` (steps of 25) with `Readout`.
- [ ] **Step 3:** A failed action → inline `Notice` "Didn't respond. Check the device is on and try again." and re-read state. Buttons have `accessibilityLabel`s ("Volume up").
- [ ] **Step 4:** typecheck → pass. Commit `HomeNet: device remotes`.

---

## Phase 3: Who's home

### Task 9: Schema v2 (person, mac, settings)

**Files:** Modify `packages/core/src/device-repository.ts` (`StoredDevice` + `enrichedRow`/insert defaults), `apps/netlens/src/db/device-store-sqlite.ts` (migrate, row mapping, insert/update SQL), `packages/core/src/__tests__/device-repository.test.ts`, any test fixtures constructing `StoredDevice`.

**Interfaces — Produces:**
- `StoredDevice.person: string | null`, `StoredDevice.mac: string | null` (new rows: null).
- In `device-store-sqlite.ts`: `export interface SettingsStore { getSetting(key: string): Promise<string | null>; setSetting(key: string, value: string | null): Promise<void> }`; `openDeviceStore()` returns `DeviceStore & SettingsStore` (`null` value deletes the row).
- Migration: `user_version < 2` → `ALTER TABLE devices ADD COLUMN person TEXT`, `ADD COLUMN mac TEXT`, `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`, `PRAGMA user_version = 2`, in one transaction, after the v1 step.

- [ ] **Step 1: Failing test:** `reconcileScan keeps person and mac across a rescan` (existing row with `person:'Sara', mac:'AA:BB:CC:DD:EE:FF'` → still set after reconcile).
- [ ] **Step 2–4:** FAIL → implement (core + SQLite) → `pnpm --filter @apps-hub/core test` and `pnpm --filter netlens typecheck` PASS.
- [ ] **Step 5:** Commit `HomeNet: store person, MAC and settings (schema v2)`.

### Task 10: People logic

**Files:** Create `packages/core/src/people.ts`, test `__tests__/people.test.ts`.

**Interfaces — Produces:**
- `interface PersonStatus { person: string; home: boolean; lastSeenAt: number; deviceIds: number[] }`
- `peopleStatus(devices: readonly ReconciledDevice[]): PersonStatus[]` — group by trimmed `person` (case-insensitive key, first spelling shown); home if any device `seenThisScan`; `lastSeenAt` = max; sorted home first, then by name.
- `carryPersonTags(devices: readonly ReconciledDevice[]): ReconciledDevice[]` — returns only the rows that changed. For each tagged row not `seenThisScan`: if exactly one `seenThisScan` untagged row has the same non-empty `hostname` or `mdnsName` (case-insensitive), move `person` (and `customName`/`isTrusted` stay put) to it and clear it on the old row.
- `probeHome(binding: Pick<NetLensNativeBinding,'measureTcpHandshake'>, ip: string): Promise<boolean>` — `[62078, 80, 443, 22, 445, 5353, 8080]` (sequential stop-at-first) 800 ms each; `open` or `refused` → true.

- [ ] **Step 1: Failing tests:** two devices tagged "Sara"/"sara", one seen → one person, home true; nobody seen → home false with the max `lastSeenAt`; tag carries to a new row with the same hostname; does **not** carry when two rows share the name or when names are null; `probeHome` true on `refused`, false when all `timeout`.
- [ ] **Step 2–4:** FAIL → implement → PASS, register.
- [ ] **Step 5:** Commit `core: who's home logic`.

### Task 11: Shared scan

**Files:** Create `apps/netlens/src/scan/ScanProvider.tsx` (context + `useNetworkScan()`); modify `ScannerScreen.tsx` (consume it), `App.tsx` (wrap tabs).

**Interfaces — Produces:** `useNetworkScan(): { iface: InterfaceInfo | null; plan: SubnetPlan | null; phase: Phase; discovered: number; devices: ReconciledDevice[]; mdnsTypes: string[]; errorNote: string | null; locationsByIp: ReadonlyMap<string, string[]>; store: (DeviceStore & SettingsStore) | null; runScan(): Promise<void>; stopScan(): Promise<void>; saveDevice(d: ReconciledDevice): Promise<void>; binding: NetLensNativeBinding }`

- [ ] **Step 1:** Move `runScan`/`stopScan`/store opening/name merge/`devicesRef`/generation from `ScannerScreen` into the provider unchanged in behavior; after reconcile, apply `carryPersonTags` and save the changed rows.
- [ ] **Step 2:** Device sheet: `Field` "Whose phone is this?" (placeholder "e.g. Sara", hint "Shows this person on the Home tab.") saved with name and trust.
- [ ] **Step 3:** typecheck → pass; behavior of the Devices tab unchanged (manual read-through of the diff). Commit `HomeNet: share the scan between tabs`.

### Task 12: Home tab

**Files:** Create `apps/netlens/src/screens/HomeScreen.tsx`; modify `App.tsx` (tab "Home", second).

- [ ] **Step 1:** Header "Who's home", subtitle "Updates while HomeNet is open." Button "Check now" → `runScan()`, then for each person with no device `seenThisScan`, `probeHome` on each of their devices' `lastIp` once; a true result marks them home for this view.
- [ ] **Step 2:** Rows: name, `Pill` "Home" (ok) or subtitle "Last seen 2 h ago" / "Not seen yet". Empty: "Tag a phone to see who's home. Open a device on the Devices tab and fill in Whose phone is this?. Tip: reserve that phone's IP address in your router so HomeNet always recognises it."
- [ ] **Step 3:** typecheck → pass. Commit `HomeNet: Home tab`.

---

## Phase 4: Wake PC + guest QR

### Task 13: MAC from NetBIOS

**Files:** Modify `packages/core/src/name-formats.ts` (add parser), `name-resolver.ts` (one NetBIOS request feeds name and MAC), `device-names.ts` (`DeviceNames.mac`, `applyDeviceNames` sets `mac` when the row has none), `ScannerScreen`/provider name-merge equality check; tests in `name-formats.test.ts`, `name-resolver.test.ts`, `device-names.test.ts`.

**Interfaces — Produces:** `parseNetbiosMac(bytes: readonly number[], id: number): string | null` — the 6 bytes after the name table, `AA:BB:CC:DD:EE:FF` uppercase; all-zero → null. `DeviceNames.mac: string | null`.

- [ ] **Step 1: Failing tests:** a captured Windows NBSTAT reply fixture → `'00:1A:2B:3C:4D:5E'`; same with zero MAC (Samba) → null; truncated reply → null; `applyDeviceNames` keeps a typed MAC over a scanned one.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `core: learn a PC's MAC from its NetBIOS reply`.

### Task 14: Wake-on-LAN logic

**Files:** Create `packages/core/src/wol.ts`, test `__tests__/wol.test.ts`.

**Interfaces — Produces:** `parseMac(input: string): string | null` (accepts `:`/`-`/none separators, any case; returns `AA:BB:…`); `magicPacket(mac: string): number[]` (102 bytes); `subnetBroadcast(localIp: string, prefix: number): string` (uses `parseIpv4`/`prefixToMask`/`formatIpv4`).

- [ ] **Step 1: Failing tests:** `parseMac('aa-bb-cc-dd-ee-ff')` → `'AA:BB:CC:DD:EE:FF'`; `'AABBCCDDEEFF'` ok; `'GG:…'`, 5 octets → null; packet length 102, first 6 `0xFF`, bytes 6–11 equal MAC, byte 96–101 equal MAC; `subnetBroadcast('192.168.1.20',24)` → `'192.168.1.255'`, `('10.1.2.3',16)` → `'10.1.255.255'`, `('192.168.4.9',23)` → `'192.168.5.255'`.
- [ ] **Step 2–4:** FAIL → implement → PASS, register.
- [ ] **Step 5:** Commit `core: Wake-on-LAN packet`.

### Task 15: Native `sendUdpBroadcast`

**Files:** `packages/core/src/native-binding.ts` (contract), `apps/netlens/modules/netlens-core/src/NetlensCoreModule.ts` + `src/index.ts` (adapter), `android/.../NetlensCoreModule.kt` + new `android/.../UdpBroadcast.kt`, test `android/src/test/.../UdpBroadcastTest.kt`, `ios/NetlensCoreModule.swift` + `ios/NameProbes.swift` (or new `UdpBroadcast.swift`); every fake binding in `packages/core/src/__tests__` gets the method.

**Interfaces — Produces:** `sendUdpBroadcast(ip: string, port: number, payload: readonly number[]): Promise<void>` — rejects on invalid args or send failure.

- [ ] **Step 1: Failing Kotlin test** `UdpBroadcastTest`: `UdpBroadcast.validate(ip, port, payload)` returns an error string for `8.8.8.8`, port `0`, empty payload, payload > 1024 bytes, byte 256; null for `192.168.1.255`, 9, 102 bytes.
- [ ] **Step 2:** `cd apps/netlens/android && JAVA_HOME=$JAVA_HOME ./gradlew :netlens-core:testDebugUnitTest` → FAIL.
- [ ] **Step 3:** Kotlin: `DatagramSocket().apply { broadcast = true }`, bound with `lanBinder(ip)`, send, close, on `Dispatchers.IO`. Swift: BSD UDP socket, `SO_BROADCAST`, `sendto`, same validation, reject with code `UDP_BROADCAST_FAILED`. Contract + adapter + fakes.
- [ ] **Step 4:** Gradle `:netlens-core:testDebugUnitTest :app:assembleDebug` → BUILD SUCCESSFUL; iOS simulator build per AGENTS.md → BUILD SUCCEEDED; `pnpm test`, `pnpm typecheck` → pass.
- [ ] **Step 5:** Commit `netlens-core: UDP broadcast for Wake-on-LAN`.

### Task 16: Wake in the device sheet

**Files:** Modify the device sheet (`ScannerScreen.tsx` or its extracted component).

- [ ] **Step 1:** Field "Hardware address (MAC)" prefilled from `mac`, validated with `parseMac` (hint on error: "Use six pairs like AA:BB:CC:DD:EE:FF."), saved with the sheet.
- [ ] **Step 2:** When a valid MAC is known: Button "Wake this device" → send `magicPacket` 3× (300 ms apart) to `subnetBroadcast(iface.localIp, iface.cidrPrefix)` port 9; then `probeHome(lastIp)` every 3 s for up to 60 s; show "Waking…", then "It's awake." or "No answer yet. Check Wake-on-LAN is on in the PC's settings." Footer: "Works when the PC has Wake-on-LAN turned on."
- [ ] **Step 3:** typecheck → pass. Commit `HomeNet: wake a sleeping PC`.

### Task 17: Guest Wi-Fi QR

**Files:** Create `packages/core/src/wifi-qr.ts`, test `__tests__/wifi-qr.test.ts`; create `apps/netlens/src/components/QrCode.tsx`; modify `RouterScreen.tsx`, `apps/netlens/package.json` (+ `qrcode-generator`), `apps/netlens/app.json` (`android.allowBackup: false`), `apps/netlens/android/app/src/main/AndroidManifest.xml` (`allowBackup="false"`).

**Interfaces — Produces:** `wifiQrText(w: { ssid: string; password: string; open: boolean }): string` → `WIFI:T:WPA;S:<ssid>;P:<pw>;;` or `WIFI:T:nopass;S:<ssid>;;`, escaping `\ ; , : "` with `\`.

- [ ] **Step 1: Failing tests:** `{ssid:'Home',password:'p;a:ss',open:false}` → `'WIFI:T:WPA;S:Home;P:p\\;a\\:ss;;'`; open network omits `P:`; `ssid` `'Café "5G"'` → `'S:Café \\"5G\\"'`.
- [ ] **Step 2–4:** FAIL → implement → PASS, register.
- [ ] **Step 5:** Add `qrcode-generator` via the `upgrading-dependencies` skill (confirm MIT, no install scripts); `QrCode` renders `qrcode(0,'M')` modules as rows of black `View`s on a white square with a 4-module quiet zone, `accessibilityLabel` "QR code to join <ssid>".
- [ ] **Step 6:** Router tab Group "Guest Wi-Fi": Fields "Network name", "Password" (`secureTextEntry`), Switch "No password"; saved via `setSetting('guestWifi', JSON.stringify(...))`; QR shown when the name is set; footer "Guests point their camera at this to join." Works without UPnP.
- [ ] **Step 7:** typecheck, `pnpm test`, Gradle `:app:assembleDebug` → pass. Commit `HomeNet: guest Wi-Fi QR code`.

---

## Phase 5: Finish

### Task 18: Docs, gates, review, release prep

- [ ] **Step 1:** Bump `apps/netlens/app.json` `version` to `0.2.0`. Update `docs/netlens/PRD.md` (new FRs for the four features), `docs/netlens/SPEC.md` (LAN guard, SOAP/IGD, controls, schema v2, `sendUdpBroadcast`), `apps/netlens/CLAUDE.md` (tabs, ScanProvider) — or dispatch `docs-keeper`.
- [ ] **Step 2:** Full gates per AGENTS.md (`pnpm test`, `pnpm typecheck`, NetLens Gradle, NetLens iOS simulator build, `pnpm doctor`) → report actual output.
- [ ] **Step 3:** Run `invariant-reviewer` and `code-reviewer` on `main...homenet-toolbox`; fix confirmed findings; re-run gates.
- [ ] **Step 4:** Ask the owner for the go. On go: merge with `[skip ci]`, `pnpm release` locally (see memory "Release by local command"), install via the Store on the phone (claimed through coord), and check each feature on the home network, including Review Focus #5 with TunnelWall connected. Report results.

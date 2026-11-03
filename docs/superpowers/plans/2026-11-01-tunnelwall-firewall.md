# TunnelWall Firewall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Android app firewall to TunnelWall: per-app rules (allow, block on mobile data, block always), a connection log, data use per app, and pause from the app and the notification, built on the proven spike.

**Architecture:** The packet engine (firestack) and the VPN service run in their own process (`:firewall`), because firestack and WireGuard's Go runtimes crash each other in one process. The two processes share nothing in memory: rules, the log and the firewall state live in one SQLite database (WAL mode). Pure decisions and retention live in the Expo module (`modules/open-tunnel-native`) with JVM tests. The app module (`android/app`) holds the service and the firestack wrapper. The UI reads and writes through the native module's TS contract.

**Tech Stack:** Kotlin (Android `VpnService`, `NetworkStatsManager`, `ConnectivityManager`, `android.database.sqlite`), firestack `com.celzero:firestack:d3d530ea3e@aar` (MPL-2.0), React Native 0.81 + Expo SDK 54, TypeScript, `node --test`, Gradle JVM unit tests, `@apps-hub/ui` (`opentunnel` brand).

**Spec:** `docs/superpowers/specs/2026-10-30-network-toolkit-design.md` (Part 2, as amended on the spike branch). The spike results are in `docs/handoffs/firewall-spike-results.md`. The reference implementation is `apps/open_tunnel_vpn/android/app/src/main/java/com/opentunnel/open_tunnel_vpn/spike/FirewallSpikeService.kt` at tag `archive/firewall-spike` (the branch was deleted 2026-11-03; read it with `git show archive/firewall-spike:<path>`). Read both before Task 3.

## Global Constraints

- Android only for the firewall; iOS methods return a typed `FIREWALL_NOT_SUPPORTED` error and the UI hides the Firewall area (spec, iOS).
- Attribution needs Android 10 (API 29) or newer; older versions get a typed "not supported" state (spec, App attribution).
- Never call `allowBypass()` (OpenTunnel rule 3); the firewall tun routes all internet IPv4 and IPv6.
- No placeholders: no `TODO`, no mock bridge methods, no hard-coded fake states (OpenTunnel rule 6).
- Nothing leaves the phone; no analytics, crash reporters or remote logging (OpenTunnel rule 5).
- Packages with `node:` imports stay out of Hermes; `packages/open-tunnel-core` stays Hermes-safe.
- Every new TS test file is listed in `apps/open_tunnel_vpn/package.json` `test` script (CLAUDE.md gotcha).
- Firewall tun range: `100.127.222.0/24` and `fd66:f83a:c650::/120`; fake DNS `100.127.222.3:53,[fd66:f83a:c650::3]:53`.
- Log retention: 7 days or 100,000 entries, whichever comes first; written in batches, never per packet.
- Battery acceptance: an 8-hour screen-off night with the firewall on uses no more than 3 percentage points more than a night without it.
- Store APK growth is accepted at about +29 MB universal (owner decision, 2026-11-01); no ABI split in this plan.
- Verification gates (every task that touches its area, and the final gate): `pnpm --filter open_tunnel_vpn test`, `pnpm --filter open_tunnel_vpn typecheck`, `cd apps/open_tunnel_vpn/android && ./gradlew :open-tunnel-native:testDebugUnitTest :app:assembleDebug` (with `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`), and `xcodebuild` for `apps/open_tunnel_vpn/ios/OpenTunnel.xcworkspace` (AGENTS.md).

## Decisions (with why)

- **Where code lives.** Pure decisions, the SQLite store and retention live in `modules/open-tunnel-native/android/src/main/java/expo/modules/opentunnelnative/firewall/`. Why: the Expo module can't see app-module classes, and the UI-side native functions must read the same database the service writes. The service and firestack wrapper live in `android/app/src/main/java/com/opentunnel/open_tunnel_vpn/firewall/`, because only the app module depends on the firestack AAR.
- **SQL is not JVM-tested.** `android.database.sqlite` needs Robolectric, which this repo does not have. Why: AGENTS.md says the native invariants are Gradle JVM tests, and adding a test dependency is a separate decision. So the decisions and retention rule are JVM-tested, and the store's SQL is proven on the phone in Task 13. This is a shortcut with a known limit: upgrade to Robolectric if the on-phone check misses a SQL bug.
- **Process boundary.** The firewall service is `FirewallService` with `android:process=":firewall"`, separate from `OpenTunnelVpnService`. Why: two Go runtimes crash in one process (spike results).
- **Shared state, not memory.** The UI process never reads service objects. It reads the `firewall_state` row and the log through the store, and sends a start/stop/reload intent to the service. Why: the service runs with the UI closed, and the processes are separate.

## Review Focus

1. **Connecting to a server while the firewall is on.** The server engine must start only after the firewall reports stopped in the shared state, and a server connection must never fail because the firewall held the slot. Test: `FirewallHandoverTest` (Task 6).
2. **UID lookup fails.** The connection is allowed and logged as "Unknown app", so the phone keeps working. Test: `FirewallDecisionTest.unknownUidIsAllowedAndLabelled` (Task 1).
3. **A rule changes while a connection is open.** Open connections of a newly blocked app are closed, not only new ones. Test: `FirewallDecisionTest.blockedRuleClosesOpenConnections` (Task 1).
4. **HomeNet and the LAN keep working.** `app.netlens` is excluded from the tun, and the private, link-local and multicast ranges are excluded from routing, so HomeNet's scans and mDNS still work. Test: `FirewallNetworksTest` (Task 3), plus the HomeNet acceptance check (Task 13).
5. **The UI never claims what it can't see.** In Private DNS strict, the Firewall area says website names need Automatic, and a blocked connection is shown as blocked only when the firewall dropped it. Test: `firewall-copy.test.ts` (Task 9).

## Task 1: Pure firewall decisions

**Files:**
- Create: `modules/open-tunnel-native/android/src/main/java/expo/modules/opentunnelnative/firewall/FirewallDecision.kt`
- Test: `modules/open-tunnel-native/android/src/test/java/expo/modules/opentunnelnative/firewall/FirewallDecisionTest.kt`

**Interfaces:**
- Consumes: none.
- Produces: `enum class FirewallRule { ALLOW, BLOCK_ON_MOBILE, BLOCK_ALWAYS }`; `enum class Verdict { ALLOW, BLOCK }`; `object FirewallDecision { fun verdict(rule: FirewallRule, onCellular: Boolean): Verdict; fun shouldCloseOpen(rule: FirewallRule, onCellular: Boolean): Boolean; const val UNKNOWN_APP_LABEL: String = "Unknown app" }`. `verdict` and `shouldCloseOpen` take no UID because the caller resolves the UID and the unknown-UID case is handled by the caller: when the UID is unknown it uses `Verdict.ALLOW` and the label above.

- [ ] **Step 1: Write the failing tests** (one per Review Focus item, plus the rule table)

```kotlin
class FirewallDecisionTest {
  @Test fun allowAlwaysAllows() { /* ALLOW on wifi and on cellular -> Verdict.ALLOW */ }
  @Test fun blockOnMobileBlocksOnlyOnCellular() { /* BLOCK_ON_MOBILE: cellular -> BLOCK, wifi -> ALLOW */ }
  @Test fun blockAlwaysBlocksEverywhere() { /* BLOCK_ALWAYS -> BLOCK on both */ }
  @Test fun unknownUidIsAllowedAndLabelled() { /* UNKNOWN_APP_LABEL == "Unknown app"; the caller path allows; assert the constant */ }
  @Test fun blockedRuleClosesOpenConnections() { /* shouldCloseOpen(BLOCK_ALWAYS, false) and shouldCloseOpen(BLOCK_ON_MOBILE, true) are true; (BLOCK_ON_MOBILE, false) and (ALLOW, *) are false */ }
}
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd apps/open_tunnel_vpn/android && JAVA_HOME=... ./gradlew :open-tunnel-native:testDebugUnitTest --tests '*FirewallDecisionTest*'`
Expected: FAIL, "unresolved reference: FirewallDecision".

- [ ] **Step 3: Implement `FirewallDecision` with the signatures above.** The decision is a pure function of (rule, onCellular); the caller supplies `onCellular` from the default network's `TRANSPORT_CELLULAR`.

- [ ] **Step 4: Run the tests and see them pass.** Same command. Expected: PASS, 5 tests.

- [ ] **Step 5: Commit** `git commit -m "firewall: pure rule decisions with JVM tests"`

## Task 2: Shared store and log retention

**Files:**
- Create: `modules/open-tunnel-native/android/src/main/java/expo/modules/opentunnelnative/firewall/FirewallStore.kt`
- Create: `modules/open-tunnel-native/android/src/main/java/expo/modules/opentunnelnative/firewall/LogRetention.kt`
- Test: `modules/open-tunnel-native/android/src/test/java/expo/modules/opentunnelnative/firewall/LogRetentionTest.kt`

**Interfaces:**
- Consumes: `FirewallRule`, `Verdict` (Task 1).
- Produces: `object LogRetention { const val MAX_AGE_MS: Long = 7 * 24 * 3600 * 1000L; const val MAX_ROWS: Int = 100_000; fun idsToDelete(rows: List<Pair<Long, Long>> /* (id, timestampMs), oldest first */, nowMs: Long): List<Long> }`. `class FirewallStore(context: Context) { fun setRule(uid: Int, pkg: String, rule: FirewallRule); fun rules(): Map<Int, FirewallRule>; fun appendBatch(entries: List<LogEntry>); fun log(filter: LogFilter): List<LogEntry>; fun clearLog(); fun writeState(key: String, value: String); fun readState(key: String): String?; fun enforceRetention(nowMs: Long) }`. `data class LogEntry(val timestampMs: Long, val uid: Int, val pkg: String, val proto: String, val dst: String, val dstPort: Int, val domain: String?, val bytesOut: Long, val bytesIn: Long, val verdict: Verdict)`. `data class LogFilter(val uid: Int?, val blockedOnly: Boolean)`.
- Schema (one DB file `firewall.db` in `context.getDatabasePath`'s directory, WAL on): `rules(uid INTEGER PRIMARY KEY, pkg TEXT, rule TEXT)`, `log(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, uid INTEGER, pkg TEXT, proto TEXT, dst TEXT, dst_port INTEGER, domain TEXT, bytes_out INTEGER, bytes_in INTEGER, verdict TEXT)`, `firewall_state(key TEXT PRIMARY KEY, value TEXT)`. Index on `log(ts)` and `log(uid)`.

- [ ] **Step 1: Write the failing retention test**

```kotlin
class LogRetentionTest {
  @Test fun dropsRowsOlderThanSevenDays() { /* rows at now-8d and now-1d: returns only the 8-day id */ }
  @Test fun keepsAtMost100kNewestRows() { /* 100_001 fresh rows: returns exactly the oldest 1 id */ }
  @Test fun ageLimitWinsWhenItHitsFirst() { /* 2 old rows + 10 new: returns the 2 old ids */ }
}
```

- [ ] **Step 2: Run to see it fail.** Run `./gradlew :open-tunnel-native:testDebugUnitTest --tests '*LogRetentionTest*'`. Expected: FAIL, unresolved reference.

- [ ] **Step 3: Implement `LogRetention.idsToDelete`, then `FirewallStore`.** Retention is the pure function; `FirewallStore` does the SQL with `SQLiteDatabase` and `enforceRetention` calls `idsToDelete` on the rows it reads. Batch writes in a single transaction (`beginTransaction`/`setTransactionSuccessful`).

- [ ] **Step 4: Run to see it pass.** Expected: PASS, 3 tests.

- [ ] **Step 5: Commit** `git commit -m "firewall: shared SQLite store and log retention"`

## Task 3: Firewall service in its own process

**Files:**
- Create: `apps/open_tunnel_vpn/android/app/src/main/java/com/opentunnel/open_tunnel_vpn/firewall/FirewallService.kt`
- Create: `apps/open_tunnel_vpn/android/app/src/main/java/com/opentunnel/open_tunnel_vpn/firewall/FirewallNetworks.kt`
- Test: `apps/open_tunnel_vpn/android/app/src/test/java/com/opentunnel/open_tunnel_vpn/firewall/FirewallNetworksTest.kt`
- Modify: `apps/open_tunnel_vpn/android/app/build.gradle` (add `com.celzero:firestack:d3d530ea3e@aar`; Maven Central)

**Interfaces:**
- Consumes: `FirewallStore` (Task 2), `FirewallDecision` (Task 1).
- Produces: `object FirewallNetworks { val TUN_IPV4 = "100.127.222.1"; val TUN_IPV6 = "fd66:f83a:c650::1"; val FAKE_DNS = "100.127.222.3:53,[fd66:f83a:c650::3]:53"; val LAN_EXCLUSIONS: List<Pair<String, Int>>; const val HOMENET_PACKAGE = "app.netlens" }`. `class FirewallService : VpnService()` with actions `ACTION_START`, `ACTION_STOP`, `ACTION_PAUSE`, `ACTION_RESUME`, `ACTION_RELOAD`, and a start with no action (Always-on, Task 7). Manifest: `android:process=":firewall"`, `android:permission="android.permission.BIND_VPN_SERVICE"`, `android:exported="false"`, `foregroundServiceType="specialUse"`, `VpnService` intent filter.
- Tun builder: the spike's `buildTun` with the constants above, `excludeRoute` for each `LAN_EXCLUSIONS` entry on API 33+ (below 33, log "LAN ranges stay inside the tun" once), `addDisallowedApplication(HOMENET_PACKAGE)`, `setSession("TunnelWall firewall")`.
- Writes `firewall_state` key `running` = `"true"` on start and `"false"` on stop and `onRevoke`/`onDestroy`.

- [ ] **Step 1: Write the failing test** `FirewallNetworksTest`: `LAN_EXCLUSIONS` contains exactly `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `224.0.0.0/4`, `fe80::/10`, `ff00::/8`; `HOMENET_PACKAGE == "app.netlens"`; `FAKE_DNS` is host:port form.

- [ ] **Step 2: Run to see it fail.** `./gradlew :app:testDebugUnitTest --tests '*FirewallNetworksTest*'`. Expected: FAIL, unresolved reference.

- [ ] **Step 3: Implement `FirewallNetworks` and `FirewallService`.** Port `start()`, `stop()`, `buildTun()`, `onRevoke()` from the spike; add the `running` state writes, the pause (stop the tun, keep the foreground notification, `ACTION_RESUME` restarts it), and `ACTION_RELOAD` (re-read rules from the store). Notification has Pause/Resume and a link to the Firewall area.

- [ ] **Step 4: Run the test, then assemble.** `./gradlew :app:testDebugUnitTest --tests '*FirewallNetworksTest*' :app:assembleDebug`. Expected: PASS, BUILD SUCCESSFUL.

- [ ] **Step 5: Commit** `git commit -m "firewall: VpnService in its own process with the tun and LAN exclusions"`

## Task 4: firestack wrapper (one class)

**Files:**
- Create: `apps/open_tunnel_vpn/android/app/src/main/java/com/opentunnel/open_tunnel_vpn/firewall/FirewallEngine.kt`
- Modify: `apps/open_tunnel_vpn/android/app/src/main/java/com/opentunnel/open_tunnel_vpn/firewall/FirewallService.kt` (call the wrapper only)

**Interfaces:**
- Consumes: `FirewallStore`, `FirewallDecision`, `FirewallNetworks`, UID resolver (Task 5).
- Produces: `class FirewallEngine(service: VpnService, store: FirewallStore) { fun start(tunFd: ParcelFileDescriptor, systemDns: String): Boolean; fun stop(); }`. On reload, for each UID whose rule changed, it closes that UID's open flows when `FirewallDecision.shouldCloseOpen(newRule, onCellular)` is true (Review Focus 3). Inside it, the `Bridge` implementation (`bind4`, `bind6`, `protect`, `preflow`, `flow`, `onQuery`, `onResponse`) and the DNS rules, ported from the spike with the 7 integration rules from the spec.

- [ ] **Step 1: No JVM test possible** (firestack is an AAR the JVM test classpath doesn't load). The check is the on-phone acceptance in Task 13. Note this in the commit message.

- [ ] **Step 2: Implement the wrapper.** Rules: port 853 to the tun DNS returns `Backend.Block` (log once); port 53 to the tun DNS returns `Backend.Base`; the flow verdict comes from `FirewallDecision.verdict(rule, onCellular)` with the rule from `store.rules()`; a UID of -1 or a failed lookup takes `Verdict.ALLOW` and the label `UNKNOWN_APP_LABEL`. `bind4`, `bind6` and `protect` all call `VpnService.protect(fd)`. Entries go to a batch buffer that the wrapper flushes to `store.appendBatch` every 2 seconds or at 200 entries, never one write per flow.

- [ ] **Step 3: Assemble.** `./gradlew :app:assembleDebug`. Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Commit** `git commit -m "firewall: firestack wrapper with batched log writes"`

## Task 5: App attribution and names

**Files:**
- Create: `apps/open_tunnel_vpn/android/app/src/main/java/com/opentunnel/open_tunnel_vpn/firewall/UidResolver.kt`
- Test: `apps/open_tunnel_vpn/android/app/src/test/java/com/opentunnel/open_tunnel_vpn/firewall/UidResolverTest.kt`

**Interfaces:**
- Consumes: none.
- Produces: `object UidResolver { fun ownerUid(cm: ConnectivityManager, protocol: Int, src: InetSocketAddress, dst: InetSocketAddress): Int /* -1 when unknown or below API 29 */; fun packageFor(pm: PackageManager, uid: Int): String /* "unknown" for -1, "uid:<n>" when none */ }`. Shared system UIDs map to one entry each (`getPackagesForUid(uid).first()`).

- [ ] **Step 1: Write the failing tests** for `packageFor`: `-1` gives `"unknown"`; a UID with no packages gives `"uid:<n>"`. Pure branch logic: extract the mapping into `fun packageLabel(uid: Int, packages: Array<String>?): String` and test it directly.

- [ ] **Step 2: Run to see it fail, implement, run to see it pass.** Same command pattern as Task 3. Expected: PASS.

- [ ] **Step 3: Commit** `git commit -m "firewall: UID attribution with the unknown-app fallback"`

## Task 6: Hand-over with server connections

**Files:**
- Modify: `apps/open_tunnel_vpn/android/app/src/main/java/com/opentunnel/open_tunnel_vpn/OpenTunnelVpnService.kt` (before `startTunnel`, call the firewall stop and wait; after `stopTunnel`, restart if enabled)
- Create: `modules/open-tunnel-native/android/src/main/java/expo/modules/opentunnelnative/firewall/FirewallHandover.kt`
- Test: `modules/open-tunnel-native/android/src/test/java/expo/modules/opentunnelnative/firewall/FirewallHandoverTest.kt`

**Interfaces:**
- Consumes: `FirewallStore.readState` (Task 2).
- Produces: `object FirewallHandover { fun canStartEngine(running: String?, nowMs: Long, startedAtMs: Long, timeoutMs: Long): Boolean; fun shouldRestartAfterEngine(enabled: String?): Boolean }`. Rule: `running` is `"true"` while the firewall is up. `canStartEngine` is true when `running` is not `"true"`, or when `timeoutMs` (3000) has passed since `startedAtMs`. `shouldForceStop` is true when `running` is `"true"` and the timeout has passed: the controller then stops the firewall service and starts the engine anyway. A server connection never fails because the firewall held the slot.

- [ ] **Step 1: Write the failing tests** `FirewallHandoverTest`: (a) `running == "false"` → start now; (b) `running == null` → start now; (c) `running == "true"` within timeout → wait; (d) `running == "true"` after timeout → `shouldForceStop` true and the engine still starts; (e) `shouldRestartAfterEngine("true")` true and `("false")` false.

- [ ] **Step 2: Run to see it fail, implement, run to see it pass.** Expected: PASS, 5 tests.

- [ ] **Step 3: Wire it into `OpenTunnelVpnService`.** The controller stops the firewall first (intent `ACTION_STOP` to `FirewallService`), polls `running` every 100 ms up to the timeout, then starts the engine. On engine disconnect, if `enabled` is set, it starts `FirewallService` again. Verify the hand-over both ways on the phone (Task 13).

- [ ] **Step 4: Gradle gate.** `./gradlew :open-tunnel-native:testDebugUnitTest :app:assembleDebug`. Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit** `git commit -m "firewall: stop the firewall before a server connection starts"`

## Task 7: Always-on start and boot

**Files:**
- Modify: `apps/open_tunnel_vpn/android/app/src/main/java/com/opentunnel/open_tunnel_vpn/firewall/FirewallService.kt` (the `null` action branch)
- Test: `modules/open-tunnel-native/android/src/test/java/expo/modules/opentunnelnative/firewall/FirewallStartPolicyTest.kt`
- Create: `modules/open-tunnel-native/android/src/main/java/expo/modules/opentunnelnative/firewall/FirewallStartPolicy.kt`

**Interfaces:**
- Consumes: `firewall_state` (`enabled`), Task 6's `FirewallHandover`.
- Produces: `object FirewallStartPolicy { fun startOnNullAction(enabled: String?): Boolean }`. True only when `enabled == "true"`. The same gate applies to every implicit start: a start with no action and a start with `VpnService.SERVICE_INTERFACE` (Ruling R18). A start while disabled stops the service, so a reboot with Always-on and the firewall off does nothing.

- [ ] **Step 1: Write the failing tests**: `startOnNullAction("true")` is true; `("false")` and `(null)` are false.

- [ ] **Step 2: Run to see it fail, implement, run to see it pass.** Expected: PASS, 3 tests.

- [ ] **Step 3: Wire `FirewallService.onStartCommand`**: `null` action → `startOnNullAction(store.readState("enabled"))` → start or `stopSelf()`. Log the action in the state (`last_start_action`) so the on-phone check can see which path ran.

- [ ] **Step 4: Commit** `git commit -m "firewall: a start with no action (Always-on) starts it only when enabled"`

## Task 8: Native module contract (four places, one change)

**Files:**
- Modify: `modules/open-tunnel-native/src/OpenTunnelNativeModule.ts` (the TS contract)
- Modify: `modules/open-tunnel-native/src/index.ts` (the TS adapter)
- Modify: `modules/open-tunnel-native/android/src/main/java/expo/modules/opentunnelnative/OpenTunnelNativeModule.kt` (Kotlin functions)
- Modify: `modules/open-tunnel-native/ios/` (Swift stubs that throw `FIREWALL_NOT_SUPPORTED`)
- Test: `modules/open-tunnel-native/src/__tests__/firewall-contract.test.ts` (new; list it in `apps/open_tunnel_vpn/package.json`)

**Interfaces:**
- Consumes: `FirewallStore` (Task 2), `FirewallService` (Task 3), `FirewallStartPolicy` (Task 7).
- Produces (TS): `interface FirewallApi { getFirewallStatus(): Promise<FirewallStatus>; setFirewallEnabled(on: boolean): Promise<void>; setPaused(paused: boolean): Promise<void>; getAppRules(): Promise<AppRule[]>; setAppRule(uid: number, rule: FirewallRuleKind): Promise<void>; getActivityLog(filter: { uid?: number; blockedOnly: boolean }): Promise<ActivityEntry[]>; clearActivityLog(): Promise<void>; getDataUse(): Promise<DataUseRow[]>; openUsageAccessSettings(): Promise<void> }`, plus `FirewallStatus`, `AppRule`, `ActivityEntry`, `DataUseRow` types, and `FIREWALL_NOT_SUPPORTED` added to `OPEN_TUNNEL_ERROR_CODES`. `FirewallRuleKind = 'allow' | 'block_on_mobile' | 'block_always'`.
- The TS `FirewallRuleKind` maps to the Kotlin `FirewallRule` in one place (`index.ts`).

- [ ] **Step 1: Write the failing contract test** `firewall-contract.test.ts`: the adapter maps `'block_on_mobile'` to `FirewallRule.BLOCK_ON_MOBILE`'s wire string; `FIREWALL_NOT_SUPPORTED` exists in `OPEN_TUNNEL_ERROR_CODES`; the iOS stub is a typed error, not a no-op (assert on the code, not a fake value).

- [ ] **Step 2: Run to see it fail.** `node --test modules/open-tunnel-native/src/__tests__/firewall-contract.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement all four places.** Kotlin: each function calls `FirewallStore` or `FirewallService` intents; `setFirewallEnabled(true)` requests the VPN consent through the existing consent path, then starts the service. Swift: each function rejects with `FIREWALL_NOT_SUPPORTED`.

- [ ] **Step 4: Run the test, typecheck, Gradle gate.** `pnpm --filter open_tunnel_vpn test && pnpm --filter open_tunnel_vpn typecheck`, then the Gradle gate. Expected: all PASS.

- [ ] **Step 5: Commit** `git commit -m "firewall: native contract on Android, typed stubs on iOS"`

## Task 9: Pure TS logic (formatting, copy, data use)

**Files:**
- Create: `apps/open_tunnel_vpn/src/firewall/copy.ts` (consent text, Private DNS message, LAN line, pause line)
- Create: `apps/open_tunnel_vpn/src/firewall/activity.ts` (filter and group log entries; "Unknown app" label)
- Create: `apps/open_tunnel_vpn/src/firewall/data-use.ts` (sort by mobile data; sum Wi-Fi and cellular)
- Test: `apps/open_tunnel_vpn/src/firewall/__tests__/copy.test.ts`, `activity.test.ts`, `data-use.test.ts`
- Modify: `apps/open_tunnel_vpn/package.json` (`test` script: add the three test files)

**Interfaces:**
- Consumes: the types from Task 8.
- Produces: `export function privateDnsMessage(provider: string): string` returning exactly `To see website names, set Private DNS to Automatic. Lookups will still go to ${provider}.`; `export const FIREWALL_PAUSED_LINE = "The firewall is paused while you're connected to a VPN server."`; `export const LAN_COVERAGE_LINE` (one line: LAN-only traffic and HomeNet's own traffic aren't logged or blockable); `export function sortByMobile(rows: DataUseRow[]): DataUseRow[]`; `export function filterActivity(entries: ActivityEntry[], f: { uid?: number; blockedOnly: boolean }): ActivityEntry[]`.

- [ ] **Step 1: Write the failing tests**: the exact `privateDnsMessage` string for `dns.google`; `sortByMobile` orders by cellular bytes descending; `filterActivity` with `blockedOnly` keeps only `verdict === 'blocked'`; a blocked entry is shown as blocked only when `verdict` says so (never inferred from the rule).

- [ ] **Step 2: Run to see it fail, implement, run to see it pass.** `node --test src/firewall/__tests__/*.test.ts`. Expected: PASS.

- [ ] **Step 3: Commit** `git commit -m "firewall: copy, activity filter and data-use sort with tests"`

## Task 10: Firewall screen

**Files:**
- Create: `apps/open_tunnel_vpn/src/firewall/firewall-screen.tsx` (the Firewall area: status and Pause at the top, then Apps (data use and rule) and Activity; a consent screen on first enable)
- Create: `apps/open_tunnel_vpn/src/firewall/use-firewall.ts` (reads status, polls every 2 s while visible)
- Modify: the app's tab/navigation file (add the Firewall area next to the home screen; hide on iOS)

**Interfaces:**
- Consumes: `FirewallApi` (Task 8), copy and helpers (Task 9), `@apps-hub/ui` components (`Screen`, `Header`, `Group`, `Row`, `Button`, `Segmented`, `Notice`, `Sheet`) with `brand="opentunnel"`.
- Produces: `export function FirewallScreen(props: { api: FirewallApi }): JSX.Element`.
- Consent screen text, in this order: what the firewall sees (every connection's app, address or domain, and data amount); stays on the phone and is never uploaded; pauses while connected to a VPN server; uses some battery. Then the Android VPN permission dialog (through the native consent), then Usage access (optional; without it the data-use list explains why it's empty).

- [ ] **Step 1: Write the failing test** for the screen's pure parts: `use-firewall` status mapping (a `running: false` status shows "Off", never "On"). Put the mapping in `src/firewall/status.ts` and test it.

- [ ] **Step 2: Run to see it fail, implement the mapping and the screen, run to see it pass.** Expected: PASS for the mapping; the screen is verified on the phone (Task 13).

- [ ] **Step 3: Check the iOS hide.** `pnpm --filter open_tunnel_vpn typecheck`, and confirm the tab is conditioned on `Platform.OS === 'android'`.

- [ ] **Step 4: Commit** `git commit -m "firewall: Firewall area with consent, status, apps and activity"`

## Task 11: Manifest and config plugin

**Files:**
- Modify: `apps/open_tunnel_vpn/plugin/opentunnel-android-config.js` (add the `FirewallService` declaration with `process=":firewall"`, `QUERY_ALL_PACKAGES` re-allowed, `PACKAGE_USAGE_STATS` permission, and the `tools:remove` for ics-openvpn already present)
- Modify: `apps/open_tunnel_vpn/android/app/src/main/AndroidManifest.xml` (regenerated by prebuild, not hand-edited)

**Interfaces:**
- Consumes: `FirewallService` (Task 3).
- Produces: a manifest where `FirewallService` has `android:process=":firewall"`, `BIND_VPN_SERVICE`, `exported="false"`, and `QUERY_ALL_PACKAGES` is present.

- [ ] **Step 1: Write the failing check** as a node test over the plugin's output (`plugin/__tests__/manifest.test.ts`, listed in `package.json`): the plugin adds the `:firewall` service and the permissions.

- [ ] **Step 2: Run to see it fail, implement, run to see it pass.** Then regenerate: `pnpm --filter open_tunnel_vpn exec expo prebuild --no-install` (AGENTS.md: config plugins regenerate natives). Check that `android/app/src/main/AndroidManifest.xml` has the `:firewall` service.

- [ ] **Step 3: Commit** `git commit -m "firewall: manifest service, usage access and package visibility via the plugin"`

## Task 12: Data use

**Files:**
- Create: `modules/open-tunnel-native/android/src/main/java/expo/modules/opentunnelnative/firewall/DataUseReader.kt`
- Test: `modules/open-tunnel-native/android/src/test/java/expo/modules/opentunnelnative/firewall/DataUseReaderTest.kt`

**Interfaces:**
- Consumes: none.
- Produces: `data class DataUseRow(val uid: Int, val wifiBytes: Long, val cellBytes: Long)` (in `DataUseReader.kt`; the TS `DataUseRow` has the same three fields); `object DataUseReader { fun rows(stats: List<Triple<Int, Long, Long>> /* uid, wifiBytes, cellBytes */): List<DataUseRow> }` (pure: merges and drops zero rows), and a Kotlin `fun query(context: Context, startMs: Long, endMs: Long): List<Triple<Int, Long, Long>>` that calls `NetworkStatsManager.querySummary` for `TYPE_WIFI` and `TYPE_MOBILE` (needs `PACKAGE_USAGE_STATS`; returns empty and a reason when not granted).

- [ ] **Step 1: Write the failing tests** for `rows`: merges by UID; drops rows where both are zero; keeps Wi-Fi and cellular separate.

- [ ] **Step 2: Run to see it fail, implement, run to see it pass.** Expected: PASS.

- [ ] **Step 3: Check on the phone (Task 13):** while the firewall runs, the data is credited to the real apps, not to TunnelWall. If not, the screen says so (spec).

- [ ] **Step 4: Commit** `git commit -m "firewall: data use per app from NetworkStatsManager"`

## Task 13: On-phone acceptance and release

**Files:** none changed (this task is the check and the release; it may add fixes as new commits in the task that owns the bug).

**Interfaces:**
- Consumes: everything above.
- Produces: the results recorded in `docs/handoffs/` and the spec's "Done means" marked off.

- [ ] **Step 1: Run the gates.** `pnpm test`, `pnpm typecheck`, the Gradle gate (`:open-tunnel-native:testDebugUnitTest :app:assembleDebug`), and `xcodebuild -workspace apps/open_tunnel_vpn/ios/OpenTunnel.xcworkspace -scheme OpenTunnel -sdk iphonesimulator -configuration Debug build CODE_SIGNING_ALLOWED=NO`. Expected: all pass, real output reported.

- [ ] **Step 2: Ask the owner before releasing.** Release through `pnpm release open-tunnel` (`tools/release`). A push to `main` auto-releases TunnelWall, so the merge is the owner's call.

- [ ] **Step 3: On the phone, through the Store:**
  - An app blocked on mobile data fails on mobile data and works on Wi-Fi.
  - The log shows app names and domains.
  - Pause and resume work from the notification.
  - Connecting to a server pauses the firewall; disconnecting turns it back on; both directions (Task 6).
  - Private DNS automatic and strict (the Private DNS check that was skipped in the spike).
  - Always-on after a reboot starts the firewall (Task 7; `last_start_action` shows the path).
  - HomeNet scan works with the firewall on (the LAN exclusion).
  - Two battery nights, firewall on and off, at most 3 points difference.
  - Data use is credited to the real apps while the firewall runs.

- [ ] **Step 4: Record results** in `docs/handoffs/` and commit.

## Self-Review

- **Spec coverage:** data use (T12), rule per app (T1, T10), activity log (T2, T9, T10), pause/resume (T3, T10), server pause and hand-over (T6), rules enforced in Kotlin (T1, T4), log storage and retention (T2), data use (T12), installed apps (T5, T11), reboot (T7), firewall dies → traffic flows (T3: stopped state written, no kill switch), iOS (T8, T10), consent (T10), DNS privacy (T4 rules, T9 copy). Spike integration rules 1–7: T4 (1–4), T6 (5), T11 (6), T3 (7).
- **Type consistency:** `FirewallRule` / `Verdict` (T1) used in T2, T4; `FirewallStore` methods (T2) used in T3, T4, T6, T7, T8, T12; `FirewallRuleKind` mapping (T8) matches `FirewallRule` names.
- **Open decisions left to the executor:** none on design. The SQL store has no JVM test (Decisions).

---

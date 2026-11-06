# TunnelWall firewall spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This is a throwaway spike: no production tests and no merge. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decide go or no-go for the TunnelWall firewall by proving firestack works inside the OpenTunnel build on the emulator and on the owner's phone, measured against the spec's pass line.

**Architecture:** A `firewall-spike` branch, never merged. It adds firestack and a minimal `FirewallSpikeService` (`VpnService` → tun → firestack, with a per-flow callback that looks up the owning app and blocks one test package). The build is released through the Store under its own package ID, so the daily VPN app is never touched.

**Tech Stack:** Kotlin, `com.celzero:firestack` (MPL-2.0, Maven Central), Android `VpnService`, `ConnectivityManager.getConnectionOwnerUid`.

**Spec:** `docs/superpowers/specs/2026-10-30-network-toolkit-design.md`, Part 2, "Packet engine", "Spike pass line" and "How the spike reaches the phone".

## Global Constraints

- **Pass line:**
  - the build has no native-library or class clashes;
  - traffic flows;
  - the flow callback gives usable source and destination tuples;
  - `getConnectionOwnerUid` returns real app UIDs;
  - the arm64 APK grows by ≤ 30 MB;
  - an 8-hour screen-off night with the firewall on drains ≤ 3 percentage points more battery than a night with it off.
- If any check fails: stop and report alternatives to the owner. Don't switch engines silently.
- Installs on the owner's phone go through the Store only, never adb. The emulator may use adb.
- The branch is never merged or pushed to `main` (a push to `main` auto-releases).
- The firewall tun leaves out private, link-local and multicast ranges (`excludeRoute`, API 33+) and excludes `app.netlens` (`addDisallowedApplication`). It never calls `allowBypass()`.
- The pinned firestack version is the one RethinkDNS's latest release uses, so the reference integration matches. The RethinkDNS app is Apache-2.0 and may be read for API usage.

## Review Focus

1. **Two Go runtimes in one APK** (wireguard-go's `libwg-go.so` and firestack's gomobile library): the debug and release builds both start, and a WireGuard connect still works. Task 1 Step 3.
2. **HyperOS on the owner's phone** may attribute UIDs differently from the emulator: UIDs are re-checked on the phone. Task 3.
3. **Always-on start:** the library services (GoBackend, ics-openvpn) may answer the system's "start this VPN" intent. Task 3 Step 4 records which service starts.
4. **LAN and HomeNet exclusion:** a HomeNet scan with the firewall on finds the same hosts as with it off. Task 2 Step 4 and Task 3.
5. **DNS:** lookups still resolve with Private DNS off, Automatic and strict. The spike records what firestack sees in each mode, to feed the full plan. Task 3 Step 3.

---

### Task 1: Branch, dependency, build clash check, size

**Files:**
- Modify: `apps/open_tunnel_vpn/android/app/build.gradle` (dependency)

- [ ] **Step 1: Create the spike worktree.** Create a worktree on a new branch `firewall-spike` from `main` (superpowers:using-git-worktrees).
- [ ] **Step 2: Record the baseline size.**
  1. Run `cd apps/open_tunnel_vpn/android && JAVA_HOME=$JAVA_HOME ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a`.
  2. Record the APK's size in bytes.
- [ ] **Step 3: Add firestack and rebuild.**
  1. Add `implementation("com.celzero:firestack:<version>@aar")`, with `<version>` read from RethinkDNS's latest release `app/build.gradle`.
  2. Run `:app:assembleDebug` and the same `assembleRelease`.
  3. Expected: BUILD SUCCESSFUL, with no `Duplicate class` and no `2 files found with path 'lib/arm64-v8a/…'`.
  4. Record the new size and the difference.
  5. If either build fails, stop and report.

### Task 2: Spike service on the emulator

**Files:**
- Create: `apps/open_tunnel_vpn/android/app/src/main/java/com/opentunnel/open_tunnel_vpn/spike/FirewallSpikeService.kt`
- Modify: `AndroidManifest.xml` via `apps/open_tunnel_vpn/plugin/opentunnel-android-config.js`, so the spike service is declared with `BIND_VPN_SERVICE`
- Modify: `apps/open_tunnel_vpn/App.tsx` (a temporary "Start firewall spike" / "Stop" button; throwaway)

- [ ] **Step 1: Write `FirewallSpikeService`.**
  - It builds a tun (IPv4 + IPv6 default routes, the excluded ranges above, and `app.netlens` disallowed) and starts firestack on the descriptor.
  - Follow RethinkDNS `BraveVPNService` for the firestack calls.
  - In the flow callback, call `getConnectionOwnerUid(protocol, src, dst)`, map the UID with `packageManager.getNameForUid`, and log `uid package proto src dst` to logcat under the tag `FirewallSpike`.
  - Return "block" when the package is `com.android.chrome` and "allow" otherwise.
- [ ] **Step 2: Check on the emulator** (API 34+; adb is fine here).
  1. Start the spike.
  2. Run `adb logcat -s FirewallSpike`.
  3. Open a site in another browser.
  4. Expected: log lines carry real package names and destinations, the page loads, and Chrome fails to load pages.
- [ ] **Step 3: Check the WireGuard hand-off.** With the spike running, connect a WireGuard node from the normal UI. Expected: the VPN switches and the spike service gets `onRevoke`. Record what happened.
- [ ] **Step 4: Check that HomeNet is left alone.** Run a HomeNet scan with the spike on and with it off. Expected: the same host count both times.
- [ ] **Step 5: Commit on the spike branch.** `git commit -m "spike: firestack firewall service (do not merge)"`

### Task 3: Spike on the owner's phone through the Store

**Files (spike branch only):**
- Modify: `apps/open_tunnel_vpn/app.json` (`android.package` → `com.opentunnel.open_tunnel_vpn.spike`, `name` → `Firewall spike`) and the matching `applicationId` in `apps/open_tunnel_vpn/android/app/build.gradle`
- Modify: `tools/release/src/apps.ts` (add `'tunnelwall-spike': { name: 'Firewall spike', dir: 'apps/open_tunnel_vpn', android: { packageName: 'com.opentunnel.open_tunnel_vpn.spike' } }`)
- Modify: `apps/store/modules/store-installer/android/src/main/AndroidManifest.xml` (`<queries>` package entry)

- [ ] **Step 1: Release the spike build and the Store** from the spike worktree (docs/app-store.md §5): run `pnpm release store -m "See the firewall spike"`, then `pnpm release tunnelwall-spike -m "Firewall spike"`. Expected: both releases publish. The owner installs "Firewall spike" from the Store.
- [ ] **Step 2: The owner checks on the phone.** The owner repeats Task 2 Steps 2–4, using the spike app's own logging screen or a shared log: add a "Copy log" button that copies the last 200 `FirewallSpike` lines to the clipboard, because the phone has no adb. Record the results.
- [ ] **Step 3: Check DNS in each mode.** For Private DNS Off, Automatic and strict (`dns.google`), record whether pages load and whether firestack's flows show port 53 lookups (domain visible) or only port 853 (domain hidden).
- [ ] **Step 4: Check Always-on.** Set "Firewall spike" as Always-on VPN and reboot. Record which service class starts. Expected: `FirewallSpikeService`. Anything else is a finding for the full plan.
- [ ] **Step 5: Measure battery.** Run two nights of 8 hours with the screen off, one with the spike firewall on and one off, with the same apps and starting charge ±5%. Record the percentage-point drop for each night.

### Task 4: Verdict and clean-up

- [ ] **Step 1: Write the verdict.** In `docs/handoffs/network-toolkit.md` on `main` (docs-only commits don't trigger a release), record every pass-line item as PASS or FAIL with its number, the pinned firestack version, the hand-off and Always-on findings, and the DNS table. Then give the verdict: go means write the full firewall plan; no-go means bring alternatives to the owner.
- [ ] **Step 2: Clean up.**
  1. The owner uninstalls "Firewall spike".
  2. Remove the `tunnelwall-spike` entry from the Store `manifest.json`, using the same admin API that `tools/release` publishes with, and delete its APK with `DELETE /admin/apps/<file>`.
  3. The next normal Store release from `main` drops the extra `<queries>` entry.
  4. Keep the `firewall-spike` branch for reference; don't merge it.

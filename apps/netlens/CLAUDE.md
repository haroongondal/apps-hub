# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

HomeNet (folder `netlens`): LAN scanner, connectivity diagnostics, router dashboard, device remotes, who's home, Wake-on-LAN and guest Wi-Fi QR; Android first (`app.netlens`). The hard scanning rules (no ARP scraping, TCP RST means the host is alive, bounded concurrency, multicast lock, FOSS only) are in the root AGENTS.md. Specs are `docs/netlens/PRD.md`, `SPEC.md` and `PROMPTS.md`; phases run one per session, in order.

## Commands

```bash
pnpm --filter netlens android      # or ios; first build is slow
pnpm --filter netlens typecheck
cd apps/netlens/android && ./gradlew :netlens-core:testDebugUnitTest :app:assembleDebug   # needs JAVA_HOME
```

The app has no `test` script. Scan logic is tested in `packages/core` (`pnpm --filter @apps-hub/core test`); platform invariants such as `TcpProbeClassifierTest` are Kotlin JVM tests in the module.

## Structure

- `App.tsx` switches between four tabs with `TabBar`, not a navigation library, to keep the F-Droid footprint small. Don't add one. Tabs: Devices (`ScannerScreen`), Home (`HomeScreen`), Router (`RouterScreen`), Checks (`DiagnosticsScreen`). Tabs unmount when hidden.
- `src/scan/ScanProvider.tsx` wraps the tabs and `useNetworkScan()` reads it. It owns the native binding and scan engine, interface and plan, scan phase, the device list, the opened store (also the `SettingsStore`), the UPnP locations per IP (`locationsByIp`), background name lookup, person-tag carry-over, `saveDevice`/`forgetDevice`, and the named-network list (`loadNetworks`, `renameNetwork`, `forgetNetwork`). It refreshes the interface when the app returns to the foreground. A scan started on one tab shows on the others, so no screen opens the store or the binding itself.
- Components: `DeviceControls.tsx` (remotes in the device sheet), `WakeDevice.tsx` (the Wake button and its watch), `QrCode.tsx` (guest QR, black on white).
- Scan engines are not in this app. They live in `packages/core` and reach the OS through the `NetLensNativeBinding` port, implemented by `modules/netlens-core/src/index.ts`.
- `src/db/device-store-sqlite.ts` implements the `DeviceStore` port from `packages/core` with the SPEC §4 schema, migrated to `user_version` 2 (`devices.person`, `devices.mac`, and the `settings (key, value)` table behind `SettingsStore`). The database stays on the device and stores scan facts, names, person tags, MACs, trusted flags and the guest Wi-Fi (key `guestWifi`, plain text). Android backup is off (`allowBackup=false` in `app.json` and the manifest) so that password is not backed up; keep it off. Add a column or table as a new migration step, never in `SCHEMA_SQL`.
- Core modules the app uses (all in `packages/core/src`, design in SPEC §6): `lan-http.ts` (LAN-only HTTP guard, every toolbox request goes through it), `upnp-soap.ts` (SOAP), `igd.ts` (router facts, usage meter, port mappings), `device-controls.ts` (detect Roku, DLNA/Sonos, Shelly, Tasmota, WLED), `device-actions.ts` (their actions), `people.ts` (who's home, tag carry-over), `wol.ts` (MAC parse, magic packet, subnet broadcast), `wake.ts` (send and watch), `wifi-qr.ts` (QR text), `port-check.ts` (open-port check), `native-args.ts` and `udp-broadcast-args.ts` (argument checks run before native calls).
- `modules/netlens-core` has Kotlin (`android/`) and Swift (`ios/`) halves that mirror each other. Change both, plus the TS contract and adapter, in the same change.
- Its podspec pins iOS `15.1`; a newer platform makes Expo autolinking silently drop the module (see `docs/toolchain.md`).
- Never call `tcpFetch` directly for a toolbox feature: use `httpRequest`, which refuses anything outside the phone's own subnet.
- Not supported: Chromecast, Samsung/LG power and input, Hue. iOS Wake-on-LAN probably needs the `com.apple.developer.networking.multicast` entitlement, and the entitlements file is empty. Nothing of the toolbox has run on a phone yet and the iOS build was not run (state 2026-11-19); see SPEC §7.

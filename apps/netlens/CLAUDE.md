# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

NetLens: LAN scanner and connectivity diagnostics, Android first (`app.netlens`). The hard scanning rules (no ARP scraping, TCP RST means the host is alive, bounded concurrency, multicast lock, FOSS only) are in the root AGENTS.md. Specs are `docs/netlens/PRD.md`, `SPEC.md` and `PROMPTS.md`; phases run one per session, in order.

## Commands

```bash
pnpm --filter netlens android      # or ios; first build is slow
pnpm --filter netlens typecheck
cd apps/netlens/android && ./gradlew :netlens-core:testDebugUnitTest :app:assembleDebug   # needs JAVA_HOME
```

The app has no `test` script. Scan logic is tested in `packages/core` (`pnpm --filter @apps-hub/core test`); platform invariants such as `TcpProbeClassifierTest` are Kotlin JVM tests in the module.

## Structure

- `App.tsx` switches between the Scanner and Diagnostics screens with `TabBar`, not a navigation library, to keep the F-Droid footprint small. Don't add one.
- Scan engines are not in this app. They live in `packages/core` and reach the OS through the `NetLensNativeBinding` port, implemented by `modules/netlens-core/src/index.ts`.
- `src/db/device-store-sqlite.ts` implements the `DeviceStore` port from `packages/core` with the SPEC §4 schema verbatim. The database stays on the device and stores scan facts, names and trusted flags only.
- `modules/netlens-core` has Kotlin (`android/`) and Swift (`ios/`) halves that mirror each other. Change both, plus the TS contract and adapter, in the same change.
- Its podspec pins iOS `15.1`; a newer platform makes Expo autolinking silently drop the module (see `docs/toolchain.md`).

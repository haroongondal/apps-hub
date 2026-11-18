# Notch handoff

## Resume prompt (2026-11-18)

Read this file completely first and trust the facts below; do not redo them. Continue from "Current state and next step".

## Goal and fixed constraints

- Android app that draws an expanding pill around the phone's camera cutout, like a Mac notch app. First version: tap to expand, shows the clock, folds back after 4 s.
- Owner's phone only for device tests (Xiaomi 24116RACCG, HyperOS 3.0, Android 16, serial 49kjmnuwonkffqzh). Never an emulator. Claim `device:49kjmnuwonkffqzh` in coord before touching it.
- Install through the Store, never `adb install` (the app is Store-released). adb is fine for logcat, screenshots and taps.

## Decisions

- Overlay is `TYPE_APPLICATION_OVERLAY` with the "display over other apps" permission and a foreground service (`specialUse`). Deputy uses an accessibility overlay, but that needs enabling a service on HyperOS; this does not.
- Geometry is pure Kotlin (`PillGeometry`) so JVM tests cover it. The cutout comes from `WindowMetrics.windowInsets.displayCutout` (API 30+), with a centred 72x28 dp fallback.
- Brand `notch` is indigo (hue 235). Teal was already taken by Inflow.
- Store table also gained `halo` (`com.haroon.halo`): Halo is released from its own branch and is not in `main`, so a Store built without it would refuse Halo updates.

## Verified facts

- The phone's cutout: x 510..570, y 0..110 on a 1080x2400 screen, density 2.8125.
- Gradle `:notch-island:testDebugUnitTest :app:assembleDebug` passes (6 tests). TS tests and typecheck pass.
- Released 2026-11-18 from branch `notch` (based on origin/main df22cc60): Store build 21, Notch build 2 (0.1.0). Manifest checked afterwards: no other app's entry was lost.

## File map

- `apps/notch/` app (App.tsx, `src/status.ts`, committed `android/` prebuild).
- `apps/notch/modules/notch-island/` Kotlin module: `core/PillGeometry.kt`, `android/NotchService.kt`, `NotchIslandModule.kt`, `src/index.ts`.
- `packages/ui/src/tokens.ts` (brand), `packages/store-manifest/src/index.ts` and `tools/release/src/apps.ts` (release registry).

## Session log

- 2026-11-18: built the app, tests, released Store 21 + Notch 2. Phone was off wireless adb for a while, then back; queued behind apps-hub-c5.

## Current state and next step

Not yet run on the phone. Branch `notch` is committed in the worktree `apps-hub-wt/notch`, not pushed or merged to main (merge with `[skip ci]`, owner's call).

Next: when coord gives the phone, update the Store if it offers it, install Notch from the Store, grant overlay permission (Settings > Notch), turn it on, and check: the pill sits over the camera hole on the status bar, tap expands and folds back, it survives leaving the app. HyperOS may need Autostart or background-popup permission. Take screenshots with `adb exec-out screencap`. Then `coord release` the phone.

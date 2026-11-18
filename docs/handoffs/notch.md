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

Branch `notch` is committed in the worktree `apps-hub-wt/notch`, rebased on origin/main 18937ec4, not pushed or merged to main (merge with `[skip ci]`, owner's call).

Phone test, 2026-11-19 (Store 23, Notch 2 installed through the Store):

- Works: install, overlay permission via Settings, service starts, the black pill is drawn over the camera hole (window 104x121 at x 488..592, correct).
- Broken: tapping the pill does nothing. HyperOS's StatusBar window (layer 151000, y 0..110) is above an APPLICATION_OVERLAY window (layer 111000) and takes every touch in that band (a tap logs `onScrollToTop` in the foreground app). Only 11 px of the pill lies below the status bar.
- Stale icon: the launcher icon is still the first cyan version. `tools/icons/render-icon.mjs` wrote PNG mipmaps, but prebuild's `ic_launcher_foreground.webp` files and `iconBackground #06181C` in `values/colors.xml` win. Re-run prebuild for the icons, or convert the webp files.
- Unexplained: the app showed "On" and the service was running right after the overlay permission was granted, although nobody tapped Turn on.

Store pitfalls learned (see also `docs/app-store.md` section 5):

- A Store built from main lacks the `notch` and `halo` ids, so it refuses those installs ("Update Store, then try again"). Merge `notch` to main so every later Store release keeps them.
- Concurrent `pnpm release` runs overwrite each other's manifest entries (Design Editor 19 reverted Store 23 to 22 once). Check the manifest after each release.

Resolved 2026-11-19: option A shipped as Notch 0.2.0 (build 3), `NotchAccessibilityService` in `notch-island`, with no overlay permission and no foreground service. Phone check: the owner enabled Notch in Accessibility settings, a tap expands the pill (window 843x278, clock inside), it folds back after 4 s, and it works over the launcher. No crashes in logcat. Not checked: the new launcher icon, rotation, other apps' screens in front. Remaining: merge `notch` to main so Store builds keep the Notch and Halo ids; a real feature (music, timers) is the next product step.

Old plan, kept for the reasoning: make the pill tappable. Option A (recommended): draw it with `TYPE_ACCESSIBILITY_OVERLAY` from an AccessibilityService, as Deputy's StopChip does; windows of that type sit above the status bar. The owner must enable the service in Accessibility settings (see the HyperOS accessibility note in memory). Option B: keep the overlay and make the touch target a transparent strip below the status bar; the pill itself stays untouchable. Then rebuild icons, release Notch and retest on the phone (coord claim first).

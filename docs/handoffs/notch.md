# Notch handoff

## Resume prompt (2026-11-19)

Read this file completely first and trust the verified facts below; do not redo them. Follow the handoff contract in the owner's CLAUDE.md. Continue from "Current state and next step". Before building anything new, ask the owner the two open call questions in that section, one at a time.

## Goal and fixed constraints

- Android app: a pill around the phone's camera cutout that grows into an island. Tap expands it; it shows time, battery and date/alarm, and later timer, stopwatch, now playing and ongoing calls.
- Owner's phone only for device tests: Xiaomi 24116RACCG, HyperOS 3.0, Android 16, serial `49kjmnuwonkffqzh`. Never an emulator. Claim `device:49kjmnuwonkffqzh` in coord before touching it.
- Install through the Store, never `adb install`. adb is fine for logcat, screenshots and taps. Store Update buttons: tap from `uiautomator dump` bounds, never from a screenshot, because the list scrolls between the two.
- Commits: no Claude attribution lines (owner's memory rule). Release with `pnpm release notch` only on the owner's go.
- Accessibility service: do not force-stop Notch, which can switch the service off until the owner re-enables it. Use Back and relaunch.
- Notch's approved design: `docs/superpowers/specs/2026-11-19-notch-widgets-design.md`. Phase 1 plan: `docs/superpowers/plans/2026-11-19-notch-widgets-phase-1.md`.

## Decisions

- Overlay is an accessibility overlay (`TYPE_ACCESSIBILITY_OVERLAY` from `NotchAccessibilityService`), enabled by the owner in Accessibility settings. It sits above HyperOS's status bar, so taps reach it. The old `TYPE_APPLICATION_OVERLAY` version could not take taps there.
- Settings: one JSON string, saved in SharedPreferences `notch_settings` (`NotchPrefs`), passed through `NotchIslandModule.getSettings` / `setSettings`. `NotchSettings.parse` never throws. The allowed values in `settings.ts` and `NotchSettings.kt` must stay in step.
- Layout: option A, "ears", chosen by the owner on 2026-11-19 from `docs/mockups/notch-island.html` (published: https://claude.ai/artifact/LuD3GVDy2XhT2UcAjL5FX9). Clock in the left ear, battery ring and percent in the right ear, camera hole in the middle, date and next alarm on a line under the hole. The rule is `earLayout` in `core/EarLayout.kt` and `earPlan` in `settings.ts`, with tests on both sides.
- Ears ignore the widget order setting: clock always left, battery always right. Recorded as a known gap below.
- Brand `notch` is indigo (hue 235). Teal was already taken by Inflow.
- Store table (`packages/store-manifest`, `tools/release/src/apps.ts`) gained `halo` and `notch`. These are on the `notch` branch only, not `main`.

## Verified facts

- Phone cutout: x 510..570, y 0..110 on a 1080x2400 screen, density 2.8125.
- Gates, run on this branch: `corepack pnpm --filter notch test` (13 pass); `corepack pnpm --filter notch typecheck` (clean); `./gradlew :notch-island:testDebugUnitTest :app:assembleDebug` (JVM tests 5 + 5 + 3 + 8 pass; build green).
- Released: Notch 0.3.1, Store build 5, on 2026-11-19. Manifest checked after release: every other app's entry intact.
- Phone, Notch 0.3.1 through the Store:
  - Pill collapsed: 119x121 px at x 480..599 with Large size (104 px x 1.15).
  - Expanded: 969x222 px, the ears layout. Clock, battery ring with "79% charging", and "Thu 19 Nov · Alarm 5:16" all visible.
  - Folds back to the collapsed size after about 5 s.
  - Settings changed from the app apply straight away (Large, Rounded, Indigo confirmed). They survive leaving and reopening the app.
  - Alarm line appears when an alarm is set on the phone.
- Phone, Notch 0.2.0: a tap expands the pill, it folds back, and it works over the launcher. No crashes in logcat.
- The settings screen had mis-taps during testing (a scrolled list). The phone's values at the end of the test: Indigo, Black, Large, Rounded, 5 s, phone clock style. The owner may want defaults back.

## File map

- App: `apps/notch/App.tsx`, `src/settings.ts` (types, defaults, `normalize`, `pillHex`, `clockLabel`, `resolveClock`, `earPlan`, `foldLabel`, `moveWidget`), `src/Preview.tsx`, `src/SettingsScreen.tsx`, `src/status.ts`, tests in `src/__tests__/`.
- Native module: `apps/notch/modules/notch-island/`
  - `core/` (JVM-tested, pure): `PillGeometry.kt`, `NotchSettings.kt`, `Format.kt`, `EarLayout.kt`
  - `android/`: `NotchAccessibilityService.kt` (pill, card, receivers), `IslandCard.kt` (ears view), `NotchPrefs.kt`, `Colours.kt`
  - `NotchIslandModule.kt` and `src/index.ts`: the bridge.
  - `res/xml/notch_accessibility_service.xml`, `res/values/strings.xml`.
- Mockups: `docs/mockups/notch-island.html`.
- Release registry: `packages/store-manifest/src/index.ts`, `tools/release/src/apps.ts`.

## Session log

- 2026-11-18: built the first app and released Store 21 and Notch 2. The overlay could not take taps.
- 2026-11-19: accessibility service fixed the taps (Notch 0.2.0 / build 3). Phase 1 built: settings, live preview, clock, battery, card (Notch 0.3.0 / build 4). Owner chose the ears layout; the island was rebuilt as ears and released as Notch 0.3.1 / build 5 and tested on the phone.

## Current state and next step

Branch `notch` (worktree `/Users/outsentia/Documents/apps-hub-wt/notch`) is committed through "Notch: version 0.3.1 for the ears layout". Not pushed, not merged to `main`. Merging with `[skip ci]` is the owner's call. A Store built from `main` lacks the `notch` and `halo` ids and will refuse those installs ("Update Store, then try again").

**Not built yet, in order of what the owner should decide first:**

1. **Ongoing calls.** Open questions for the owner (ask one at a time):
   - Is the call feature wanted? It needs the notification listener to read the call's category and duration (not names or text). That goes beyond the approved design's non-goals, so the design doc needs updating if yes.
   - Call controls: speaker and end, or end only? Speaker depends on the phone's call notification supplying that action, which is unverified on this phone.
   - Mockup for calls is on the mockup page (section 3).
2. **Phase 2 plan** (not written): timer, stopwatch, now playing (`MediaSessionManager` via the notification listener), and calls if approved. The design doc describes these. Write the plan with `superpowers:writing-plans` after the owner approves the call decision; do not build before approval.
3. **Widget order** is ignored by the ears layout (clock always left, battery right). Decide whether order should matter, and if so how the ears take it.
4. **Not tested on the phone:** the charger opening the card for 3 s (unplugging breaks adb; the owner may unplug and replug, with a test script); the tinted pill's text contrast (not measured); "Never" fold time; 12/24-hour clock; rotation.
5. **Git history:** earlier `notch` commits track Gradle build output under `apps/notch/modules/notch-island/android/build` and `apps/notch/android/app/build`. The latest commit untracks it. Rewriting unpushed history is the owner's call.

**Process reminders:** the owner's memory rules apply: phone only through coord; Store installs only; merge and release only on the owner's go; no Claude attribution on commits or PRs.

# Notch handoff

## Resume prompt (2026-11-19)

Read this file completely first and trust the verified facts below; do not redo them. Follow the handoff contract in the owner's CLAUDE.md. The owner has answered the call questions (calls in, speaker and end controls) and chosen the card layout (extra rows). The phase 2 plan is written at `docs/superpowers/plans/2026-11-19-notch-widgets-phase-2.md` and awaits the owner's approval. Do not build before approval. When approved, run it with `superpowers:executing-plans` or `cd-engineering-tools:parallel-agents-coord`, never `superpowers:subagent-driven-development`. Continue from "Current state and next step".

## Goal and fixed constraints

- Android app: a pill around the phone's camera cutout that grows into an island. Tap expands it; it shows time, battery and date/alarm, and in phase 2 timer, stopwatch, now playing and ongoing calls.
- Owner's phone only for device tests: Xiaomi 24116RACCG, HyperOS 3.0, Android 16, serial `49kjmnuwonkffqzh`. Never an emulator. Claim `device:49kjmnuwonkffqzh` in coord before touching it.
- Install through the Store, never `adb install`. adb is fine for logcat, screenshots, taps and `uiautomator dump`. Store Update buttons: tap from `uiautomator dump` bounds, never from a screenshot.
- Commits: no Claude attribution lines (owner's memory rule). Release with `pnpm release notch` only on the owner's go.
- Accessibility service: do not force-stop Notch, which can switch the service off until the owner re-enables it. Use Back and relaunch.
- Approved design: `docs/superpowers/specs/2026-11-19-notch-widgets-design.md` (calls added 2026-11-19). Phase 1 plan: `docs/superpowers/plans/2026-11-19-notch-widgets-phase-1.md`. Phase 2 plan: `docs/superpowers/plans/2026-11-19-notch-widgets-phase-2.md`.

## Decisions

- Overlay is an accessibility overlay (`TYPE_ACCESSIBILITY_OVERLAY` from `NotchAccessibilityService`), enabled by the owner in Accessibility settings. It sits above HyperOS's status bar, so taps reach it. The old `TYPE_APPLICATION_OVERLAY` version could not take taps there.
- Settings: one JSON string, saved in SharedPreferences `notch_settings` (`NotchPrefs`), passed through `NotchIslandModule.getSettings` / `setSettings`. `NotchSettings.parse` never throws. The allowed values in `settings.ts` and `NotchSettings.kt` must stay in step.
- Layout: option A, "ears", chosen by the owner on 2026-11-19 from `docs/mockups/notch-island.html` (published: https://claude.ai/artifact/LuD3GVDy2XhT2UcAjL5FX9). Clock in the left ear, battery ring and percent in the right ear, camera hole in the middle, date and next alarm on a line under the hole. The rule is `earLayout` in `core/EarLayout.kt` and `earPlan` in `settings.ts`, with tests on both sides.
- Brand `notch` is indigo (hue 235). Teal was already taken by Inflow.
- Store table (`packages/store-manifest`, `tools/release/src/apps.ts`) gained `halo` and `notch`. These are on the `notch` branch only, not `main`.
- 2026-11-19, owner answers:
  - Ongoing calls: yes. Folded: green call timer, which takes priority over music and timers. Tapped: speaker and end controls. The listener reads only the call category, start time and action count.
  - Call buttons: speaker and end. The speaker button is hidden on a phone whose call notification has no speaker action.
  - Card layout for timer and now playing: extra rows under the ears (one row per active widget, the call row on top). Widget order sets the row order. The ears still ignore order.
- Phase 2 decisions the spec does not settle (recorded in the plan): timer presets 1/5/10/25 min; a finished timer shows "Done" with no sound (spec non-goal); the call's hang-up and speaker are chosen by action position, found by a development probe, so the app never reads notification text; timer state is in memory, a service restart drops it.

## Verified facts

- Phone cutout: x 510..570, y 0..110 on a 1080x2400 screen, density 2.8125.
- Gates, run on this branch: `corepack pnpm --filter notch test` (13 pass); `corepack pnpm --filter notch typecheck` (clean); `./gradlew :notch-island:testDebugUnitTest :app:assembleDebug` (JVM tests 5 + 5 + 3 + 8 pass; build green). Run from `apps/notch/android`.
- Released: Notch 0.3.1, Store build 5, on 2026-11-19. Manifest checked after release: every other app's entry intact.
- Phone, Notch 0.3.1 through the Store:
  - Pill collapsed: 119x121 px at x 480..599 with Large size (104 px x 1.15).
  - Expanded: 969x222 px, the ears layout. Clock, battery ring with "79% charging", and "Thu 19 Nov · Alarm 5:16" all visible.
  - Folds back to the collapsed size after about 5 s.
  - Settings changed from the app apply straight away (Large, Rounded, Indigo confirmed). They survive leaving and reopening the app.
  - Alarm line appears when an alarm is set on the phone.
- Phone, Notch 0.2.0: a tap expands the pill, it folds back, and it works over the launcher. No crashes in logcat.
- The settings screen had mis-taps during testing (a scrolled list). The phone's values at the end of the test: Indigo, Black, Large, Rounded, 5 s, phone clock style. The owner may want defaults back.
- Code check (2026-11-19): the phase 1 plan says its Task 7 adds a `setActive` hook for the compact indicator. No `setActive` exists in the built code. Phase 2 Task 8 adds it.
- Mockup check (2026-11-19): the mockup draws only the ears card (option A), the drop-down card (option B) and the call. Timer and now-playing layouts are not drawn; the extra-row layout is decided, not mocked.
- Spec and plan text on calls: the design doc was updated on 2026-11-19 (goal, non-goals, anti-goal, constraints, phase 2 line). Not committed.

## File map

- App: `apps/notch/App.tsx`, `src/settings.ts` (types, defaults, `normalize`, `pillHex`, `clockLabel`, `resolveClock`, `earPlan`, `foldLabel`, `moveWidget`), `src/Preview.tsx`, `src/SettingsScreen.tsx`, `src/status.ts`, tests in `src/__tests__/`.
- Native module: `apps/notch/modules/notch-island/`
  - `core/` (JVM-tested, pure): `PillGeometry.kt`, `NotchSettings.kt`, `Format.kt`, `EarLayout.kt`. Phase 2 adds `TimerState.kt`, `Calls.kt`, `Rows.kt`, `ArtSample.kt`, `ListenerAccess.kt`.
  - `android/`: `NotchAccessibilityService.kt` (pill, card, receivers), `IslandCard.kt` (ears view), `NotchPrefs.kt`, `Colours.kt`. Phase 2 adds `NotchMediaListener.kt`, `NotchMedia.kt`, `NotchTimer.kt`, `MediaRow.kt`, `TimerRow.kt`, `CallRow.kt`.
  - `NotchIslandModule.kt` and `src/index.ts`: the bridge.
  - `res/xml/notch_accessibility_service.xml`, `res/values/strings.xml`, `AndroidManifest.xml` (phase 2 adds the notification listener service).
- Mockups: `docs/mockups/notch-island.html`.
- Release registry: `packages/store-manifest/src/index.ts`, `tools/release/src/apps.ts`.

## Session log

- 2026-11-18: built the first app and released Store 21 and Notch 2. The overlay could not take taps.
- 2026-11-19: accessibility service fixed the taps (Notch 0.2.0 / build 3). Phase 1 built: settings, live preview, clock, battery, card (Notch 0.3.0 / build 4). Owner chose the ears layout; the island was rebuilt as ears and released as Notch 0.3.1 / build 5 and tested on the phone.
- 2026-11-19 (later): owner answered the two call questions (calls in; speaker and end). Owner chose extra rows for the card. Design doc updated for calls. Phase 2 plan written with `superpowers:writing-plans`, self-reviewed (a missing spec layout and a `setActive` gap found and handled), saved. Awaiting plan approval. Nothing built, nothing committed in this session, no phone work.

## Current state and next step

Branch `notch` (worktree `/Users/outsentia/Documents/apps-hub-wt/notch`) is committed through "Notch: version 0.3.1 for the ears layout". Uncommitted: the design doc update and the phase 2 plan and this handoff. Not pushed, not merged to `main`. Merging with `[skip ci]` is the owner's call. A Store built from `main` lacks the `notch` and `halo` ids and will refuse those installs ("Update Store, then try again").

**Plan approved 2026-11-19; execution: `cd-engineering-tools:parallel-agents-coord`.** Next step: start Task 1 (timer state, JVM test first) and follow the plan's task order. Phone work only in Task 10, under coord, and the phone steps need the owner to make or take a call for the probe.

**Open items, to raise with the owner when relevant:**
1. Widget order is ignored by the ears layout (clock always left, battery right). Rows follow order, so the ears are the only exception. Decide whether the ears should take order too.
2. Not tested on the phone: the charger opening the card for 3 s (unplugging breaks adb; the owner may unplug and replug, with a test script); the tinted pill's text contrast (not measured); "Never" fold time; 12/24-hour clock; rotation.
3. Git history: earlier `notch` commits track Gradle build output under `apps/notch/modules/notch-island/android/build` and `apps/notch/android/app/build`. The latest commit untracks it. Rewriting unpushed history is the owner's call.
4. The notch and halo ids are on the notch branch only: merge notch to main before the next Store release from main.
5. Notification access on HyperOS sideloads may be restricted (spec risk). Phase 2 Task 10 finds out.

**Process reminders:** the owner's memory rules apply: phone only through coord; Store installs only; merge and release only on the owner's go; no Claude attribution on commits or PRs.

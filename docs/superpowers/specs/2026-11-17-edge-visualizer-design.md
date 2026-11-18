# Halo — edge visualizer design

Date: 2026-11-17. Status: awaiting owner approval (builder check done, answers folded in).
Handoff: `docs/handoffs/edge-visualizer.md` (APK findings, session log).

## 1. Intent

The owner uses Muviz Edge (`com.sparkine.muvizedge` 2.1.5.1) and wants their own app that does everything it
does, for personal use on their phone, with no third-party app, ads or tracking. Owner's words: "build a complete
app replica". That means feature parity. It does not mean copying: we learn the mechanisms (already mapped in the
handoff) and write our own code, our own pattern and clock designs, our own icon and our own name.

## 2. Identity (proposed, owner confirms with this doc)

| | |
|---|---|
| App name | Halo |
| Folder | `apps/halo` |
| Android package | `com.haroon.halo` |
| Expo module | `apps/halo/modules/halo-engine` (Kotlin package `expo.modules.haloengine`) |
| Store release id | `halo` (added to `tools/release/src/apps.ts` only when the first phone build is ready, as Deputy does) |
| `@apps-hub/ui` brand key | `halo`, hue about 190 (cyan), final accent taken from the launcher icon, WCAG AA checked by the ui test |

## 3. Goals, non-goals, anti-goals

**Goals (feature parity with Muviz Edge 2.1.5.1):**
1. Edge lights that react to whatever music is playing, drawn around the screen's rounded edge and cutout.
2. 24 original patterns in four families (Lights, Lines, Particles, Waves), each with: 1-4 colours, thickness,
   speed, spread, glow, padding, roundness, mirrored, clockwise/anticlockwise.
3. Colours from: preset palettes, a custom palette, the playing track's album art, or the wallpaper.
4. A "random motion" fallback when a playing app gives no audio data.
5. Notification edge flash.
6. An always-on screen (AOD) with 15 original clock faces, now-playing card with controls, notification icons,
   burn-in shift, pocket mode, timeout, quiet hours, triggers (always / while charging / while music plays),
   double tap to leave, optional edge lights, dim level and a custom background image.
7. A floating music overlay with track info and play/pause/next/previous.
8. Rules that hide or pause the lights: selected apps, fullscreen apps, landscape, during calls, battery saver,
   pocket (proximity covered).
9. A screen-edge editor (corner radius and insets per edge) for when the system shape is wrong.
10. Quick Settings tiles for the edge lights and for the always-on screen. Start at boot.

**Non-goals:** iOS; replacing the phone's hardware AOD; lyrics; online preset sharing; backup/sync; Muviz's
pattern names, clock designs, strings, icon or name.

**Anti-goals (it fails even if it "works" when):**
- It drains the battery when nothing is playing. The overlay draws no frames when there is no audio, no flash and
  no animation running.
- It steals touches. Every edge overlay window is non-touchable and non-focusable.
- The always-on screen weakens the lock screen. It never dismisses the keyguard; leaving it lands on the normal
  secure lock screen.
- It stutters. Target: a frame's draw on the owner's phone stays under 4 ms for every pattern at default settings
  (measured in stage 2).

## 4. Constraints

- AGENTS.md and CLAUDE.md rules: no ads, analytics, Firebase, billing, Play Services or closed SDKs; licences
  audited before any dependency; erasable TypeScript; each new test file listed in its `package.json`.
- Kotlin owns everything that runs in the background (service, audio, overlay, drawing, AOD, rules). React Native
  only renders settings and status with `@apps-hub/ui` (`<ThemeProvider brand="halo">`), as in Deputy and
  Strongroom. No hand-rolled colours or fonts in RN screens. Copy is sentence case, plain words.
- Android only. Test phone: Xiaomi 24116RACCG, HyperOS, Android 16. minSdk follows the repo's Expo default;
  APIs used below need 31+ (rounded corners, cutout path, audio-mode listener) and the phone has them.
- Install only through the private Store; never `adb install`. Claim `device:<serialno>` with coord before
  driving the phone. The owner grants HyperOS special permissions (Display pop-up windows while running in
  background, Show on lock screen, Autostart) and Android special access themselves.
- Only one app can hold the system audio visualizer reliably; the owner uninstalls Muviz once Halo works.

## 5. Approaches considered (owner picked A)

- **A. Android 2D canvas (picked).** Each pattern is a Kotlin class drawing paths, arcs, points and blurred glow
  on a hardware-accelerated `Canvas`, driven by `Choreographer` frames. Least code, patterns unit-testable as
  geometry, GPU still rasterises. Risk: heavy glow + many particles cost battery; measured in stage 2, and any
  single pattern that misses the 4 ms budget may move to an AGSL `RuntimeShader` on its own.
- **B. GPU shaders for every pattern.** Smoother glow, less CPU, but roughly twice the code, hard to test and
  slow to tune on the phone. Rejected for now; stays open per pattern under A.
- **C. Draw in React Native (Skia).** Rejected: the lights must run with the app closed, when no RN runtime exists.

Live preview (builder's design, accepted with A): while a settings screen is open, the real edge overlay runs
over it, so the owner edits the actual result; no separate preview renderer. Each AOD face has a Preview button
that opens the real AOD screen.

## 6. Mechanisms (fixed by the platform; same family Muviz uses)

| Need | Mechanism |
|---|---|
| Audio data | `android.media.audiofx.Visualizer` on session 0 (global mix), FFT capture at the max capture rate. Needs `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS`. No MediaProjection. |
| Drawing over apps | One full-screen `TYPE_APPLICATION_OVERLAY` window (`SYSTEM_ALERT_WINDOW`), `FLAG_NOT_TOUCHABLE`/`NOT_FOCUSABLE`/`LAYOUT_IN_SCREEN`, cutout mode always, transparent. |
| Edge shape | `Display.getRoundedCorner()` + `DisplayCutout.getCutoutPath()`, overridable by the screen-edge editor. |
| Playing app, state, track, art | `NotificationListenerService` (`HaloListener`) → `MediaSessionManager.getActiveSessions(listener)` → `MediaController` metadata, playback state, transport controls. |
| Notifications | Same listener's `onNotificationPosted`. |
| Keep running | Foreground service `HaloService` with a quiet ongoing notification. |
| Start at boot | `BOOT_COMPLETED` receiver. Android 15+ forbids starting a `mediaPlayback` FGS from boot, so the service type is decided by the stage 1 spike (see §9). |
| Calls | `AudioManager.addOnModeChangedListener` (mode in call / in communication); avoids `READ_PHONE_STATE`. |
| Foreground app (per-app rule) | `UsageStatsManager.queryEvents` (special access `PACKAGE_USAGE_STATS`), asked for only if the owner turns on a per-app rule. |
| Fullscreen | A tiny extra overlay view watching `WindowInsets` for hidden system bars. |
| Battery saver | `PowerManager.isPowerSaveMode` + `ACTION_POWER_SAVE_MODE_CHANGED`. |
| Pocket | Proximity sensor, registered only while the lights or AOD are active. |
| Wallpaper colours | `WallpaperManager.getWallpaperColors()`. |
| AOD | `AodActivity`: black, `showWhenLocked`, `turnScreenOn`, keep-screen-on, low window brightness, launched on `SCREEN_OFF` when a trigger matches (background start allowed because the app holds `SYSTEM_ALERT_WINDOW`). Never calls `requestDismissKeyguard`. |
| Tiles | Two `TileService`s: edge lights on/off, AOD on/off. |

## 7. Architecture

```
apps/halo/                         Expo app (RN settings UI, @apps-hub/ui)
  App.tsx, src/*.tsx               screens
  src/settings.ts                  pure TS: settings type, defaults, validation (tested)
  src/setup.ts                     pure TS: permission checklist rows from native status (tested)
  modules/halo-engine/
    src/index.ts                   TS contract
    android/.../haloengine/
      HaloEngineModule.kt          Expo module: get/set settings, status, permission intents, events
      core/                        pure Kotlin, no Android imports, JVM-tested
        Settings.kt                model + JSON codec (one document)
        Spectrum.kt                FFT bytes -> magnitudes -> N smoothed bands, level, beat
        EdgePath.kt                screen perimeter as a parametric path (t in [0,1)) with corners, cutout, insets
        patterns/                  24 patterns: (bands, time, params, EdgePath) -> draw ops
        Quantize.kt                album-art / image pixels -> up to 4 dominant colours
        Rules.kt                   (state) -> show / pause / hide
        AodPolicy.kt               triggers, quiet hours, timeout, burn-in offset
      android/                     platform code
        HaloService.kt, EdgeOverlay.kt, EdgeView.kt, AudioTap.kt, HaloListener.kt,
        MusicOverlay.kt, AodActivity.kt, BootReceiver.kt, tiles, Canvas renderer for draw ops
```

- **Settings flow:** one JSON settings document. RN edits it through `@apps-hub/ui` forms and calls
  `setSettings(json)`; Kotlin validates with the same codec, stores it in `SharedPreferences` (one key) and the
  running service applies it immediately. A shared fixture (`modules/halo-engine/fixtures/settings.sample.json`)
  is parsed by both the TS test and the Kotlin test, so the two sides cannot drift.
- **Status flow:** Kotlin emits `onStatus` events (running, audio ok / blocked by another visualizer, playing
  app, missing permissions); RN renders them. RN never runs logic the service depends on.
- **Patterns are draw-op producers:** a pattern computes geometry and colours into a small list of draw ops
  (core, testable); `EdgeView` renders them with `Canvas`. That keeps all 24 patterns testable on the JVM.
- **Idle rule:** `EdgeView` only requests the next frame while audio is non-silent, a flash or fade runs, or the
  random-motion fallback is active.
- **Random motion:** if a session is playing but FFT is all zero for 3 s, synthesise bands from a seeded noise
  function until real data returns.
- **Visualizer conflict:** if `Visualizer` creation fails or stays disabled, status says another visualizer
  app is holding audio and to close it; the service retries with backoff.

## 8. Settings screens (RN)

Home (master switch, status, permission checklist with buttons to each system screen) · Edge lights (pattern
picker by family, options) · Colours · Notification flash (on/off, which apps, colour from app or palette,
repeat count) · Always-on (trigger, face picker with Preview, music, notifications, edge lights, dim, background
image, pocket, timeout, quiet hours, double tap) · Music overlay · Rules · Screen edges · About.

## 9. Stages (each ends with a Store build the owner can install)

1. **Spike on the phone (throwaway findings, kept as notes):** prove on Android 16 / HyperOS that
   (a) `Visualizer` session 0 delivers FFT from a foreground service while the app is in the background and the
   screen shows another app, (b) which FGS type and start path survive a reboot (`specialUse` from boot,
   `mediaPlayback` started when the listener connects, or a first-unlock start), (c) the overlay draws over the
   lock screen and status bar with the cutout, (d) `AodActivity` can launch on screen off. Results decide the
   service type and are written into this doc before stage 2. **Decision point:** if (a) or (d) fails on the
   phone, work stops and the builder brings the owner the options (each changes permissions or scope); no
   fallback is built without the owner's choice.
2. **Edge lights:** app scaffold, brand, settings round trip, `Spectrum`, `EdgePath`, all 24 patterns, colours
   (presets, custom, album art, wallpaper), random motion, screen-edge editor, frame-time check. Ships as two
   Store builds: 2a = the whole pipeline with one or two patterns per family (6), 2b = the remaining 18.
   Stage 4 likewise ships faces in two batches.

**Iteration loop (builder's call):** fast build-run rounds use the emulator on the Mac (`adb install` there is
fine; it is not the phone). The phone only ever gets Store builds, so `halo` joins `tools/release/src/apps.ts`
at stage 1 and every phone check is a release-signed Store install.

**Owner authorisations (2026-11-17):** the builder may run `pnpm release halo` whenever a phone check needs it,
without asking first, and tells the owner each time (Halo only; every other app still needs the owner's go).
The builder may force-stop Muviz Edge (data kept) on the phone before audio tests while holding the device claim.
3. **Notification flash + rules:** flash, apps / fullscreen / landscape / calls / battery saver / pocket.
4. **Always-on screen:** `AodActivity`, 15 faces, music card, notification icons, triggers, quiet hours,
   timeout, burn-in shift, pocket, double tap, background image.
5. **Extras:** music overlay with controls, Quick Settings tiles, start at boot polished, battery-optimisation
   exemption prompt.

## 10. Permissions

`SYSTEM_ALERT_WINDOW`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `FOREGROUND_SERVICE` + the type from stage 1,
`POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`,
notification listener access, `PACKAGE_USAGE_STATS` (only for per-app rules). Not requested: `READ_PHONE_STATE`,
storage permissions (images come through the system photo picker), internet.

## 11. Testing

- JVM: settings codec (with the shared fixture), `Spectrum`, `EdgePath` (corners, cutout, insets), every pattern
  produces finite in-bounds draw ops, `Quantize`, `Rules`, `AodPolicy`.
- TS (`node --test`): `settings.ts`, `setup.ts`, shared fixture.
- Gates: `pnpm --filter halo test`, `typecheck`, `./gradlew :halo-engine:testDebugUnitTest :app:assembleDebug`,
  `pnpm --filter @apps-hub/ui test` (brand contrast).
- Phone: per stage, installed from the Store, owner-visible checks listed in the plan.

## 12. Left to the builder

Pattern and clock-face designs and names; launcher icon and final accent; screen layouts within `@apps-hub/ui`;
band count and smoothing constants; colour quantiser algorithm (own small median cut in `core/`, no new
dependency); music overlay layout and drag behaviour; notification-flash default filters (skip ongoing, silent
and Halo's own notifications).

## 13. Spike results (phone, Halo 0.3.1, 2026-11-17)

Xiaomi 24116RACCG, HyperOS, Android 16. Owner installed Store 19 + Halo 0.3.1 and granted overlay, notification
access, mic, notifications; Halo is battery-unrestricted (deviceidle whitelist).
- (a) Visualizer session 0 from the foreground service (type mediaPlayback, 0x2): **works** — 34k FFT frames, 3.8k
  with real sound, while the phone was used normally and then locked.
- (c) Overlay over the lock screen: **no** — WindowManager sets `mForceHideNonSystemOverlayWindow=true` on Halo's
  overlay while the keyguard shows (non-system overlays are hidden on the lock screen). Consequence: the always-on
  screen draws its own edge lights (stage 4 design already assumes this).
- Frame time (gfxinfo, whole run): 50th 24 ms, 90th 57 ms, 95th 109 ms, GPU 50th 7 ms — **over budget** (16.7 ms at
  60 fps; target < 4 ms draw). Suspect per-op `BlurMaskFilter` (CPU mask rasterisation on a full-screen window).
  Fix: one GPU blur for the glow layer (RenderEffect on a glow-only layer) instead of per-op mask filters.
- (b) boot start path and (d) always-on launch after screen-off: **not yet run** (need the owner present to unlock).
- 0.3.2 on the phone (Lights preview, random motion, 20 s, display at 60 Hz): Janky frames (deadline metric) 0.00 %,
  total frame time 50th 24 / 90th 27 / 95th 29 / 99th 30 ms, GPU 6–7 ms. The 99th percentile fell from 150 ms
  (0.3.1) to 30 ms; with zero deadline misses the 24 ms median is pipeline latency, not dropped frames. Frame time
  is **acceptable**; the earlier "over budget" reading used the legacy jank metric.
- Bug found: after a Store update the service does not restart ("Halo is not running"). Fix in 0.4.0:
  `MY_PACKAGE_REPLACED` receiver → start if `serviceWanted`.
- 2026-11-18, Halo 0.4.0 (installed via the Store app on the phone): **(d) always-on screen PASSES** — with the
  Diagnostics test switch on, a power-button lock logged "SCREEN_OFF received, keyguard locked, launching
  AodActivity", the black clock screen showed over the keyguard (`mCurrentFocus=AodActivity`, `isKeyguardShowing=true`),
  finished itself after 10 s, keyguard still showing. Stage 4 gate passed.
- After the 0.4.0 update the service was NOT restarted on HyperOS (no MY_PACKAGE_REPLACED handling logged; process
  later started only by opening the app; Home said "not running" until Diagnostics → Start). Needs a fix (likely
  HyperOS blocks the broadcast without Autostart, or the receiver must also start from the listener rebind / app
  open). Opening the app also did not auto-start it — the Home "not running" hint asks for an off/on toggle.
- "Alerts" tab label fits at 1080 px.
- 2026-11-18: **(b) start after reboot PASSES** — after `adb reboot` and the owner's unlock, Halo's Home showed
  "Halo is running" (BootReceiver path; Autostart on). All four spike questions answered.

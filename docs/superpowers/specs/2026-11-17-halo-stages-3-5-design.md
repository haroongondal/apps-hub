# Halo stages 3–5 — notifications, always-on screen, extras (design)

Date: 2026-11-17. Status: APPROVED by the owner 2026-11-17 (builder check done; answers in §10).
Extends `2026-11-17-edge-visualizer-design.md` (the base design: identity, constraints, mechanisms, stages 1–2).
Everything there still holds; this document widens stages 3–5 at the owner's request ("AOD with infinite and
customizable time with multiple AOD screen customizations and themes, notification customizations and other cool
features"; owner kept every item proposed on 2026-11-17, dropped nothing).

## 1. Intent

Halo already draws music-reactive edge lights (0.3.1). The owner wants it to replace Muviz fully and go further: an
always-on screen they can leave on as long as they like and dress up with faces and themes, notifications they can
tune per app, and a set of extras (charging fill, call glow, tiles, music overlay, theme files).

## 2. Goals

**Notifications (stage 3)**
1. Edge flash on a posted notification: per app on/off (default: on for apps that post user-visible notifications),
   per app colour (auto = dominant colour of the app icon, or a picked colour), style (`pulse`, `sweep`, or any edge
   pattern id), repeat count (1–5), duration (0.5–5 s).
2. Reminder flash: repeats every N minutes (1, 2, 5, 10, 15) while the notification is still posted and the owner has
   not unlocked the phone since it arrived; stops on unlock or when the notification is removed.
3. Screen off: a new notification can wake the always-on screen (only while the keyguard is locked) which shows the
   flash and the icon. **Built in stage 4** (needs the real always-on screen); stage 3 flashes only while the screen is on.
4. Quiet hours (start/end time) suppress flashes and reminder flashes.
5. Filters: skip ongoing, silent (importance < DEFAULT), group-summary, and Halo's own notifications.
6. Hide/pause rules (base design goal 8): selected apps, fullscreen, landscape, calls, battery saver, pocket.

**Always-on screen (stage 4)**
7. Timeout: 10 s, 30 s, 1, 5, 15, 30 min, or **Never stop** (stays until unlock, pocket, or double tap).
8. Triggers: always / while charging / while music plays; schedule with off hours.
9. 15 original clock faces. Per face: size (S/M/L), vertical position (top / centre / bottom third), 12/24 h, show
   date, battery, next alarm (`AlarmManager.getNextAlarmClock`), seconds (faces that support it).
10. Colours: album art / wallpaper / custom palette (same sources as the edge lights) or the theme's own.
11. Content: now-playing card with play/pause/next/previous; notification icons with counts; edge lights (any
    pattern, independent of the main one); background photo (system photo picker) with dim 0–90 %.
12. Themes: a named, saved bundle of {face + face options, colours, background, dim, edge pattern on/off + id,
    brightness level}. Several themes; switch by hand or by time of day (up to 4 time slots → theme).
13. Gestures: double tap to leave; swipe up/down on the music card for next/previous; pocket (proximity covered →
    screen fully black and touch ignored).
14. Burn-in protection: whole content shifts by up to ±12 dp every 60 s along a slow path; static elements never
    stay on the same pixels for more than a minute.

**Extras (stage 5)**
15. Charging fill: on plug-in, the edge fills clockwise to the battery level, then fades (also on the always-on screen).
16. Low battery: at ≤ 15 % and not charging, a slow amber breathing on the edge once per 10 minutes (screen on) or on
    the always-on screen.
17. Call glow: while a call rings (audio mode `MODE_RINGTONE`), the edge pulses in the caller app's colour.
18. Quick Settings tiles: Edge lights on/off; Always-on screen on/off.
19. Music overlay: a small draggable card over any app with track, art and play/pause/next/previous; shows while
    music plays (opt-in), auto-hides after 5 s without touch, tap to expand.
20. Themes as files: export a theme (or all) to a JSON file via the system file picker; import merges by name.
21. Battery-optimisation exemption prompt and start at boot polished (base design stage 5).

## 3. Non-goals and anti-goals

Non-goals: weather or anything needing internet (Halo has no INTERNET permission by design); replacing HyperOS's
hardware AOD; lyrics; cloud sync of themes.

Anti-goals (fails even if it "works"):
- The always-on screen weakens the lock screen. It is shown only while `KeyguardManager.isKeyguardLocked` is true,
  never calls `requestDismissKeyguard`, and leaving it always lands on the secure lock screen. (Kept from the
  0.3.1 fix; reviewed.)
- Notification content leaves the phone or lands in logs. Halo stores only package names, counts and colours; never
  titles or text (probe.log included).
- "Never stop" turns into a battery or burn-in disaster: minimum window brightness, pure-black background unless the
  owner picks a photo, burn-in shift always on, pocket → black, and the screen still turns off on the phone's own
  power-button press.
- Flashes or reminder flashes become noisy: quiet hours honoured; reminder flash stops on unlock.

## 4. Approaches (owner picked A on 2026-11-17)

- **A. Native Kotlin drawing (picked).** `AodActivity` hosts one custom View; each face is a Kotlin class drawing on
  a Canvas (like the edge patterns); edge lights on the always-on screen reuse `EdgeView`. Instant on screen-off,
  least power, faces testable as geometry.
- **B. React Native always-on screen.** RN would cold-start on every screen-off — slower, heavier, blank flashes.
  Rejected.
- **C. Jetpack Compose.** Large new dependency not used anywhere in the repo. Rejected.

Picking faces and themes (builder's call, accepted with A): Kotlin renders each face to a small bitmap
(`renderFacePreview(faceId, options, w, h)` → PNG file in cache, URI to RN) shown in a grid; a Preview button opens
the real always-on screen (only works when locked → Preview instead shows it un-locked as an in-app preview
activity that is NOT `showWhenLocked`, so it can never sit over the keyguard unlocked).

## 5. Architecture additions

```
core/ (pure Kotlin, JVM-tested)
  NotifyRules.kt     (pkg, flags, importance, settings, now, quietHours) -> FlashDecision?  + reminder schedule
  QuietHours.kt      time-window maths (crosses midnight)
  AodPolicy.kt       trigger + schedule + timeout (incl. Never) + once-per-lock (absorbs core/Aod.kt)
  BurnIn.kt          offset(timeMs) -> (dx, dy) within ±12 dp, changes every 60 s, smooth path
  faces/             15 faces: (FaceInput{time, date, battery, nextAlarm, options, colours, bounds}) -> DrawList
  Themes.kt          theme model + codec (part of the settings document) + time-slot resolution
  Charging.kt, LowBattery.kt  small state machines -> edge "events" the renderer overlays
android/
  AodActivity.kt     real always-on screen: face view + music card + icons + EdgeView, gestures, proximity, timeout
  AodPreviewActivity.kt  same content, not showWhenLocked (Preview from settings)
  FaceView.kt        renders a face DrawList + text (Canvas text via Paint, bundled Atkinson fonts from @apps-hub/ui)
  NotifyFlash.kt     listens via HaloListener.onNotificationPosted/Removed, applies NotifyRules, drives EdgeView events
  AppIcons.kt        app icon -> dominant colour (Quantize) with an in-memory cache
  Tiles: LightsTile.kt, AodTile.kt (TileService)
  MusicOverlay.kt    small TYPE_APPLICATION_OVERLAY card (touchable, only the card's bounds)
  ThemeFiles.kt      export/import via ACTION_CREATE_DOCUMENT / ACTION_OPEN_DOCUMENT
```

- **Settings document grows** (version stays 1; new fields are optional with defaults so 0.3.x documents still load):
  `notify` {enabled, apps: {pkg: {on, colour|null}}, style, repeat, durationMs, reminderMin|null, wakeScreen,
  quiet: {on, start, end}}, `aod` {enabled, timeoutSec|null(=never), trigger, schedule, themeId, slots[]},
  `themes` [{id, name, face, faceOptions, colours, background, dim, edge {on, pattern}, brightness}],
  `rules` {apps[], fullscreen, landscape, calls, batterySaver, pocket}, `extras` {charging, lowBattery, callGlow,
  musicOverlay}. Shared fixture cases extended for each block (Kotlin + TS parity, as in Task 4).
- **Renderer events:** `EdgeView` gains a small event layer (flash, sweep, charging fill, breathing) drawn over or
  instead of the music pattern, so all edge effects share one window and one frame loop.
- **The always-on test switch** in Diagnostics (0.3.1) is replaced by the real `aod.enabled` setting; the security
  rules from the 0.3.1 fix carry over unchanged (receiver only while enabled, keyguard locked, once per lock unless a
  new notification wakes it).
- **Background photo:** copied into app storage when picked (system photo picker, no storage permission), scaled to
  screen size, stored as one file per theme.
- **Fonts:** faces use the Atkinson Hyperlegible Next + Mono fonts already vendored in `packages/ui/fonts`
  (OFL), copied into the module's assets at build time — no new fonts.

## 6. Permissions

Adds `QUERY_ALL_PACKAGES` (private Store app, as the Store itself does) so the per-app lists can show every
launchable app with its icon. Nothing else mandatory. `READ_PHONE_STATE` stays out (calls via audio mode). Notification access is already needed.
`POST_NOTIFICATIONS` already present. `PACKAGE_USAGE_STATS` only if the per-app hide rule is used (base design).

## 7. Stages (each ends with a Store build the owner installs; `pnpm release halo` is pre-approved)

3. **Notifications + rules** (0.4.0): settings blocks, NotifyRules/QuietHours, NotifyFlash, AppIcons, renderer
   events, reminder flash, hide/pause rules, RN Notifications + Rules screens. Phone check.
4. **Always-on screen** (0.5.0, then 0.5.x): AodPolicy, BurnIn, Themes, FaceView, AodActivity + preview, 15 faces in
   parallel batches (4 agents), music card, icons, gestures, pocket, themes UI with face previews. **Gate:** the 0.3.1
   phone check must show the always-on screen launches on HyperOS after screen-off with the keyguard locked; if it
   does not, stop and bring the owner options before building faces.
5. **Extras** (0.6.0): charging fill, low battery, call glow, tiles, music overlay, theme files, battery-exemption
   prompt, boot polish.

## 8. Testing

JVM: every core/ file above (NotifyRules incl. filters + reminder timing; QuietHours across midnight; AodPolicy
triggers/timeout/Never/once-per-lock; BurnIn bounds + period; every face produces finite in-bounds ops for S/M/L and
both orientations; Themes codec + slot resolution; Charging/LowBattery state machines). TS: settings parity fixture
for each new block, RN pure helpers. Emulator rounds per task. Phone: per stage, installed from the Store.

## 9. Left to the builder

Face designs and names (original; nothing from Muviz), theme defaults (ship 4 starter themes), exact flash/sweep
look, music card and overlay layout, icon-colour cache size, screen layouts within `@apps-hub/ui`.

## 10. Builder-check answers (builder's calls, owner can veto)

1. Stage 3 is planned in full; stage 4 is planned as an outline until the 0.3.1 phone check shows the always-on
   screen launches after screen-off on HyperOS. Goal 3 (notification wakes the screen) moves to stage 4. If the
   phone shows the edge overlay already draws over the lock screen, `AodActivity` hides the overlay while it is in
   front and draws its own `EdgeView` (one drawer at a time).
2. Relaunch rule (replaces the spike's once-per-lock): on every SCREEN_OFF while the keyguard is locked, the
   always-on screen shows again (so a power-button press brings it back, like a real always-on display) — except
   after it has timed out by itself, then it stays off until the next unlock or a new notification wake. "Never stop"
   never times out, so it always comes back.
3. Reminder flashes follow `wakeScreen`: if on (and the always-on screen is enabled), each reminder wakes it briefly
   (its own 10 s, not the theme timeout); if off, reminders show only while the screen is on. Reminders are off by
   default.
4. `QUERY_ALL_PACKAGES` is added (see §6); per-app lists show all launchable apps, apps that have notified first.
5. Call glow colour: the package of the most recent `CATEGORY_CALL` notification (its icon colour); none → the
   current theme/palette accent.
6. Two separate windows: `aod.schedule` (when the always-on screen is off) and `notify.quiet` (when flashes are
   muted). One `QuietHours` type, used twice.
7. Theme export embeds the background photo as base64 JPEG (scaled to ≤ 1440 px long side, quality 85); import with a
   name clash keeps both and adds " (2)", " (3)"…

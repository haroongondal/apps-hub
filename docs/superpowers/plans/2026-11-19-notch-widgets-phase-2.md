# Notch widgets, phase 2: timer, stopwatch, now playing and calls Implementation Plan

> **For agentic workers:** Execute task by task with `superpowers:executing-plans` (native, in this session) or `cd-engineering-tools:parallel-agents-coord`. Do not use `superpowers:subagent-driven-development` (owner's rule). Steps use checkbox (`- [ ]`) syntax for tracking. Phone steps need the coord claim first.

**Goal:** The expanded Notch card gains a now-playing row, a timer and stopwatch row and an ongoing-call row; the folded pill shows a small indicator while music, a timer or a call runs.

**Architecture:** Pure rules (timer state, call duration, row order, listener check, art sampling, pill widths) live in Kotlin `core/` and are JVM-tested. Native views (`MediaRow`, `TimerRow`, `CallRow`) live in `android/` inside `NotchAccessibilityService`, the same overlay as phase 1. `NotchMediaListener`, a `NotificationListenerService`, is the only place that reads notification data, and it keeps only media metadata and the call category, start time and action count. RN adds the notification-access row and the preview rows; it does no card drawing.

**Tech Stack:** Kotlin + Expo Modules API (`notch-island`), no new dependency; TypeScript with `node --test`; `@apps-hub/ui`; React Native 0.81.

**Spec:** `docs/superpowers/specs/2026-11-19-notch-widgets-design.md` (calls added 2026-11-19). Phase 1: `docs/superpowers/plans/2026-11-19-notch-widgets-phase-1.md`.

## Global Constraints

- No INTERNET permission; no `SYSTEM_ALERT_WINDOW`; no new dependency (kotlinx-serialization-json 1.8.1 stays the only one).
- The notification listener reads only: media session title, artist, album art, play state; call notification category, `when` (start time), `isOngoing`, and the count and position of its actions. It never reads notification text, `extras`, or action titles inside the app.
- No sounds, haptics or notifications from Notch. A finished timer shows "Done" in the card.
- Copy is sentence case, plain words. Card labels: "Timer", "Stopwatch", "Now playing", "Nothing playing", "Speaker", "End call", "Done".
- Notification access is one switch under Notification access; without it, now playing and calls are skipped and the clock and battery keep working.
- Test files must be listed in the `test` script of `apps/notch/package.json`.
- Device tests only on `device:49kjmnuwonkffqzh` through coord. Install through the Store only. Do not force-stop Notch.
- No Claude attribution lines in commits or PRs.
- Release (`pnpm release notch`) and merge only on the owner's go.

## Review Focus

1. Notification access off → now playing and calls are skipped, the card says "Notification access is off" with a button, clock and battery still work. Tested in Task 4 and Task 9.
2. A call notification with a `when` in the future or missing → duration is 0, never negative or a crash. Tested in Task 2.
3. Call ends while the card is open → the call row disappears on the next refresh and the folded pill returns to the timer or music indicator. Tested in Task 8 (phone step in Task 10).
4. Album art larger than the row → sampled down before drawing, so a 4000 px image does not allocate 64 MB. Tested in Task 2 and Task 5.
5. Speaker or end action missing on a phone → that button is hidden rather than doing nothing. Tested in Task 7 and checked in Task 10.

---

### Task 1: Timer and stopwatch state (pure)

**Files:**
- Create: `apps/notch/modules/notch-island/android/src/main/java/expo/modules/notchisland/core/TimerState.kt`
- Test: `apps/notch/modules/notch-island/android/src/test/java/expo/modules/notchisland/core/TimerStateTest.kt`

**Interfaces:**
- Produces: `enum class TimerMode { COUNTDOWN, STOPWATCH }`; `data class TimerState(val mode: TimerMode, val durationMs: Long, val accumulatedMs: Long = 0, val startedAt: Long? = null)` with `val running: Boolean` (= `startedAt != null`), `fun elapsed(now: Long): Long`, `fun remaining(now: Long): Long`, `fun done(now: Long): Boolean`, `fun start(now: Long): TimerState`, `fun pause(now: Long): TimerState`, `fun reset(): TimerState`.

Rules: `elapsed` = `accumulatedMs` + (`now - startedAt` if running), never below 0. `remaining` = `max(0, durationMs - elapsed)` for COUNTDOWN, and `0` for STOPWATCH. `done` = COUNTDOWN and `elapsed >= durationMs`. The view calls `pause(now)` once `done` becomes true, so `running` turns false and `elapsed` stays at `durationMs`. `start` on a running state and `pause` on a paused state return the same state.

- [ ] **Step 1: Write the failing tests**

Names and assertions (with `now` as a plain `Long`):
- `countdown_counts_down_while_running`: `TimerState(COUNTDOWN, 300_000).start(1000).remaining(31_000) == 270_000`
- `pause_keeps_elapsed_and_resume_adds`: start at 0, pause at 10_000, start at 50_000, `elapsed(60_000) == 20_000`
- `countdown_done_at_duration_and_pause_holds_it`: start at 0, `done(300_000)` true, `pause(300_000).elapsed(900_000) == 300_000`
- `stopwatch_is_never_done_and_has_no_remaining`: `TimerState(STOPWATCH, 0).start(0).done(10_000_000) == false`, `remaining(...) == 0`
- `reset_clears_to_zero_and_stops`: `reset().elapsed(999) == 0` and `running == false`
- `elapsed_never_negative_when_clock_goes_back`: start at 5_000, `elapsed(1_000) == 0`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/notch/android && JAVA_HOME=$JAVA_HOME ./gradlew :notch-island:testDebugUnitTest --tests '*TimerStateTest*'`
Expected: FAIL, `TimerState` unresolved.

- [ ] **Step 3: Implement `TimerState` in `core/TimerState.kt`**

Pure Kotlin, no Android imports. Follow the rules in Interfaces.

- [ ] **Step 4: Run the tests to verify they pass**

Run: same command. Expected: `BUILD SUCCESSFUL`, 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/notch/modules/notch-island/android/src/main/java/expo/modules/notchisland/core/TimerState.kt apps/notch/modules/notch-island/android/src/test/java/expo/modules/notchisland/core/TimerStateTest.kt
git commit -m "Notch: timer and stopwatch state"
```

---

### Task 2: Call duration, duration text, row order and art sampling (pure)

**Files:**
- Create: `core/Calls.kt`, `core/Rows.kt`, `core/ArtSample.kt` (under `apps/notch/modules/notch-island/android/src/main/java/expo/modules/notchisland/`)
- Modify: `core/Format.kt` (add `durationText`)
- Test: `src/test/java/expo/modules/notchisland/core/CallsTest.kt`, `RowsTest.kt`, `ArtSampleTest.kt`, and add cases to `FormatTest.kt`

**Interfaces:**
- Produces:
  - `fun callElapsed(category: String?, startedAt: Long, now: Long): Long?` in `core/Calls.kt`. Null unless `category == "call"` (Notification.CATEGORY_CALL). Otherwise `max(0, now - startedAt)`.
  - `fun durationText(ms: Long): String` in `core/Format.kt`. `mm:ss` under an hour (`03:12`), `h:mm:ss` from an hour (`1:02:05`). Negative input is treated as 0.
  - `fun rowsFor(widgets: List<String>): List<String>` in `core/Rows.kt`. Returns the `"media"` and `"timer"` entries of `widgets`, in the order given (the card's row order). `"clock"` and `"battery"` are ignored because the ears fix them.
  - `fun sampleSize(width: Int, height: Int, target: Int): Int` in `core/ArtSample.kt`. The largest power of two `s` (at least 1) with `max(width, height) / s >= target`.

- [ ] **Step 1: Write the failing tests**

- `callElapsed_null_for_non_call`: `callElapsed("msg", 0, 5_000) == null`; `callElapsed(null, 0, 5_000) == null`
- `callElapsed_counts_from_start`: `callElapsed("call", 1_000, 193_000) == 192_000`
- `callElapsed_zero_when_start_in_future`: `callElapsed("call", 9_000, 1_000) == 0`
- `durationText_minutes_and_hours`: `durationText(0) == "00:00"`, `durationText(192_000) == "03:12"`, `durationText(3_725_000) == "1:02:05"`, `durationText(-5) == "00:00"`
- `rowsFor_keeps_only_media_and_timer_in_order`: `rowsFor(listOf("timer","clock","media","battery")) == listOf("timer","media")`; `rowsFor(listOf("clock","battery")) == emptyList()`
- `sampleSize_keeps_side_at_least_target`: `sampleSize(1024, 1024, 96) == 8`; `sampleSize(80, 80, 96) == 1`; `sampleSize(4000, 3000, 96) == 32`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./gradlew :notch-island:testDebugUnitTest` from `apps/notch/android`. Expected: FAIL, unresolved references.

- [ ] **Step 3: Implement the four functions**

Pure Kotlin. `sampleSize` loops with `s` doubling while `max / (s * 2) >= target`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: same command. Expected: `BUILD SUCCESSFUL`, all new cases pass.

- [ ] **Step 5: Commit**

```bash
git commit -m "Notch: call duration, duration text, row order and art sampling"
```

---

### Task 3: Pill widths for the folded indicator and the taller card (pure)

**Files:**
- Modify: `core/PillGeometry.kt`
- Test: `src/test/java/expo/modules/notchisland/core/PillGeometryTest.kt` (add cases)

**Interfaces:**
- Consumes: `PillBox` (existing).
- Produces:
  - `fun withIndicator(box: PillBox, extraPx: Int): PillBox`. Adds `extraPx` to the width, split evenly so the box stays centred (`xFromCenter` unchanged).
  - `fun expandedRowsPx(rows: Int, density: Float): Int`. `rows * 40 * density`, using the same int conversion as the existing `EXPANDED_EXTRA_DP`. `expanded` must add it to its height: `expanded(...).height + expandedRowsPx(rows, density)`. Change the `expanded` signature to `expanded(cutout, screenWidth, density, rows: Int = 0)`, so phase 1 callers and tests keep working.

Indicator widths (used by the service in Task 8): media or timer active → `withIndicator(small, 24 * density)`; call active → `withIndicator(small, 56 * density)`, enough for the `03:12` text beside the hole.

- [ ] **Step 1: Write the failing tests**

- `withIndicator_widens_both_sides_and_keeps_centre`: `withIndicator(PillBox(10, 100, 50), 24) == PillBox(10, 124, 50)`
- `expanded_grows_by_row_height`: with `rows = 2`, height is the `rows = 0` height plus `2 * 40 * density` in px (use density 2.8125f; 40 × 2.8125 = 112.5 → int 112 per row)
- `existing_expanded_unchanged_with_zero_rows`: the phase 1 expanded test values still pass

- [ ] **Step 2: Run the tests to verify they fail**
- [ ] **Step 3: Implement** (both functions, `expanded` gets the default parameter)
- [ ] **Step 4: Run the tests to verify they pass** (`BUILD SUCCESSFUL`, phase 1 PillGeometry tests still green)
- [ ] **Step 5: Commit**

```bash
git commit -m "Notch: indicator and taller card widths"
```

---

### Task 4: Notification listener and the shared state it feeds

**Files:**
- Create: `android/src/main/java/expo/modules/notchisland/android/NotchMediaListener.kt` (the `NotificationListenerService`)
- Create: `android/src/main/java/expo/modules/notchisland/android/NotchMedia.kt` (object: `media: MediaInfo?`, `call: CallInfo?`, `listener: (() -> Unit)?`)
- Create: `core/ListenerAccess.kt` with `fun listenerEnabled(enabled: String?, component: String): Boolean`
- Test: `src/test/java/expo/modules/notchisland/core/ListenerAccessTest.kt`
- Modify: `modules/notch-island/android/src/main/AndroidManifest.xml` (add the listener service with `android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE"`, `exported="true"`, intent-filter action `android.service.notification.NotificationListenerService`)
- Modify: `NotchIslandModule.kt` (add `Function("isListenerAllowed")` and `Function("openNotificationAccessSettings")`, the latter starting `Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS` with `FLAG_ACTIVITY_NEW_TASK`)
- Modify: `src/index.ts` (add `isListenerAllowed(): boolean` and `openNotificationAccessSettings(): void` to the interface)

**Interfaces:**
- Produces:
  - `data class MediaInfo(val title: String?, val artist: String?, val art: Bitmap?, val playing: Boolean)` (`android/NotchMedia.kt`).
  - `data class CallInfo(val startedAt: Long, val actionCount: Int, val key: String)`.
  - `object NotchMedia { @Volatile var media: MediaInfo?; @Volatile var call: CallInfo?; var onChange: (() -> Unit)? ; fun changed() }`. `changed()` calls `onChange` on the main thread.
  - `fun listenerEnabled(enabled: String?, component: String): Boolean` in `core/ListenerAccess.kt`. True when `enabled` (a `:`-separated list of flattened component names) contains `component` exactly.
  - Module: `isListenerAllowed(): Boolean` is `listenerEnabled(Settings.Secure.getString(contentResolver, "enabled_notification_listeners"), ComponentName(context, NotchMediaListener::class.java).flattenToString())`.

- [ ] **Step 1: Write the failing test**

- `listener_enabled_exact_match_only`: the list `"com.haroon.notch/expo.modules.notchisland.android.NotchMediaListener:com.other/x.Y"` gives true for the Notch component and false for `"com.haroon.notch/expo.modules.notchisland.android.NotchMediaListenerX"`
- `listener_enabled_null_or_blank_false`: `listenerEnabled(null, c) == false`, `listenerEnabled("", c) == false`

- [ ] **Step 2: Run to verify failure**
- [ ] **Step 3: Implement**

`NotchMediaListener` (structure only; behaviour in Tasks 5 and 7):
- `onListenerConnected()`: register a `MediaSessionManager.OnActiveSessionsChangedListener` with `ComponentName(this, NotchMediaListener::class.java)` and call `refreshCall()`-style initial read. Keep the registration and remove it in `onListenerDisconnected()`.
- `onNotificationPosted(sbn)` and `onNotificationRemoved(sbn)`: call-only in this task; the call logic is Task 7. Media logic is Task 5.
- The `ComponentName` read for `MediaSessionManager.getActiveSessions` needs the listener enabled, so the module reads `isListenerAllowed()` first.

- [ ] **Step 4: Run tests and build**

Run: `./gradlew :notch-island:testDebugUnitTest :app:assembleDebug` from `apps/notch/android`. Expected: `BUILD SUCCESSFUL`.
Run: `cd apps/notch && corepack pnpm typecheck`. Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git commit -m "Notch: notification listener, shared state and access check"
```

---

### Task 5: Now-playing row (native view)

**Files:**
- Create: `android/src/main/java/expo/modules/notchisland/android/MediaRow.kt` (`class MediaRow(context: Context, density: Float) : LinearLayout`)
- Modify: `NotchMediaListener.kt` (fill `NotchMedia.media` from the active session; register a `MediaController.Callback` per session for metadata and playback changes; call `NotchMedia.changed()`)

**Interfaces:**
- Consumes: `MediaInfo`, `NotchMedia` (Task 4); `sampleSize` (Task 2).
- Produces: `fun bind(info: MediaInfo?, accent: Int, controller: MediaController?)` on `MediaRow`; `fun isVisibleFor(info: MediaInfo?): Boolean` (true only when `info` has a non-blank title).

Row contents: 48 dp art thumbnail (rounded), title (one line, ellipsised), artist (one line), then three 44 dp touch targets: previous, play/pause, next. Buttons call `transportControls` on the controller: `skipToPrevious()`, `play()`/`pause()` by `playing`, `skipToNext()`. Labels for the buttons are `contentDescription` strings "Previous", "Play" / "Pause", "Next". Art: `MediaMetadata.getBitmap(METADATA_KEY_ALBUM_ART)` or `METADATA_KEY_ART`, then downscaled with `inSampleSize = sampleSize(w, h, 96)` in the listener, never in the row.

Session choice in the listener: the first session whose `playbackState.state == PlaybackState.STATE_PLAYING`, otherwise the first session with a title, otherwise null (row hidden, card shows "Nothing playing" only if the widget is on and the call row is absent; decided: the media row is hidden, see Interfaces of Task 8).

- [ ] **Step 1: Verify by build**

Run: `./gradlew :app:assembleDebug` from `apps/notch/android`. Expected: `BUILD SUCCESSFUL`. The row's logic is covered by the phone test in Task 10.

- [ ] **Step 2: Commit**

```bash
git commit -m "Notch: now-playing row and media session tracking"
```

---

### Task 6: Timer and stopwatch row (native view)

**Files:**
- Create: `android/src/main/java/expo/modules/notchisland/android/TimerRow.kt` (`class TimerRow(context: Context, density: Float) : LinearLayout`)
- Create: `android/src/main/java/expo/modules/notchisland/android/NotchTimer.kt` (object: `var state: TimerState`, default `TimerState(COUNTDOWN, 5 * 60_000)`; kept in memory, see shortcut below)

**Interfaces:**
- Consumes: `TimerState`, `TimerMode`, `durationText` (Tasks 1 and 2).
- Produces: `fun bind(state: TimerState, now: Long, accent: Int)` on `TimerRow`; `fun onAction(action: TimerAction)`, `enum class TimerAction { START_PAUSE, RESET, MODE, PRESET }`.

Row contents: the large `durationText(elapsed or remaining)`; a mode switch "Timer | Stopwatch"; for COUNTDOWN a preset chip cycling 1, 5, 10, 25 minutes (each tap sets `durationMs` and resets); Start/Pause and Reset buttons. When `done(now)`, the text reads "Done" in the accent colour and the view pauses the state. No sound, haptics or notification.

The service ticks the row once a second only while the timer is running and the card is open or the folded indicator is showing. The tick stops itself when `running` is false.

Shortcut (code comment in `NotchTimer.kt`): `shortcut: timer state lives in memory, so a service restart drops a running timer, upgrade to SharedPreferences if the owner asks for timers that survive it.`

- [ ] **Step 1: Verify by build**

Run: `./gradlew :app:assembleDebug`. Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 2: Commit**

```bash
git commit -m "Notch: timer and stopwatch row"
```

---

### Task 7: Ongoing call detection, call row and probe

**Files:**
- Modify: `NotchMediaListener.kt` (`onNotificationPosted`: when `callElapsed` applies (category `call` and `isOngoing`), set `NotchMedia.call = CallInfo(startedAt = n.notification.`when`, actionCount = n.notification.actions?.size ?: 0, key = sbn.key)` and call `changed()`; `onNotificationRemoved`: clear when the key matches)
- Create: `android/src/main/java/expo/modules/notchisland/android/CallRow.kt` (`class CallRow(context, density) : LinearLayout`)
- Modify: `core/Calls.kt` (add `const val SPEAKER_ACTION = -1` and `const val HANGUP_ACTION = -1` placeholders; set to the verified indices in step 1 of this task)

**Interfaces:**
- Consumes: `CallInfo` (Task 4), `callElapsed`, `durationText` (Task 2).
- Produces: `fun bind(info: CallInfo, now: Long, accent: Int)` on `CallRow`; in `core/Calls.kt`, `fun speakerAvailable(actionCount: Int): Boolean` = `SPEAKER_ACTION in 0 until actionCount` and `fun endAvailable(actionCount: Int): Boolean` = `HANGUP_ACTION in 0 until actionCount`. The buttons send the PendingIntent from `sbn.notification.actions[index]`; the listener keeps the `PendingIntent` list in `CallInfo`, so add `val actions: List<PendingIntent>` to `CallInfo` (Task 4's data class, extend it here).

The app never reads action titles. The indices are chosen on the phone in step 1.

- [ ] **Step 1: Probe on the phone (blocks the constants, runs during Task 10)**

With an active call on the phone (the owner places or takes one), capture one `uiautomator dump` of the notification shade and read the button labels from that dump. Map each label to its index in the call notification's action list, recording the index in `docs/handoffs/notch.md`. This is a development check run through adb on the notification shade; no label text goes into the app.
Expected: the hang-up index and whether a speaker action exists. If there is no speaker action, `SPEAKER_ACTION = -1` and the speaker button stays hidden (Review Focus 5).

- [ ] **Step 2: Write the failing test for the constants' effect**

`core/CallsTest.kt`: with `HANGUP_ACTION = 1`, `endAvailable(2)` is true and `endAvailable(1)` is false; with `SPEAKER_ACTION = -1`, `speakerAvailable(3)` is false.

- [ ] **Step 3: Implement the listener branch and the row; run**

`./gradlew :notch-island:testDebugUnitTest :app:assembleDebug`. Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: Commit**

```bash
git commit -m "Notch: ongoing call detection and call row"
```

---

### Task 8: Card wiring and the folded indicator

**Files:**
- Modify: `android/src/main/java/expo/modules/notchisland/android/IslandCard.kt` (add rows above the date line; rows are: the call row first when a call is active, then `rowsFor(settings.widgets)` rows that have content)
- Modify: `android/src/main/java/expo/modules/notchisland/android/NotchAccessibilityService.kt`:
  - `show()`: the folded box is `withIndicator(small, 24 * density)` for media or timer, `withIndicator(small, 56 * density)` for a call (call wins), and `small` otherwise. The expanded box uses `expanded(hole, screenW, density, rows)` where `rows` = the number of rows with content at open time.
  - `setActive(...)`: a `fun onMediaChanged()` that `NotchMedia.onChange` calls (set in `onServiceConnected`, cleared in `onUnbind`): if the card is open, rebind rows; if the folded pill's indicator changed, `reapply()`.
  - Timer tick: a `Handler` tick each second while `NotchTimer.state.running`; when `done`, call `pause` and stop ticking.
  - Remove the widget rows from the card when the widget is switched off in settings (`rowsFor` controls this).
  - The folded indicator: a green dot and `durationText(callElapsed)` for a call, text colour from the mockup's `--go` (#34d399); a small dot for media playing or timer running. `setActive` is the hook phase 1's plan named; it did not exist in the phase 1 code, so this task adds it.

Layout rule: the ears (clock left, battery right, hole in the middle, date line under) stay as built. Rows sit under the date line, one per active widget, in `rowsFor` order, with the call row above all of them. The ears ignore widget order, rows follow it.

- [ ] **Step 1: Verify by build**

Run: `./gradlew :app:assembleDebug` from `apps/notch/android`. Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 2: Commit**

```bash
git commit -m "Notch: card rows and folded indicator"
```

---

### Task 9: Settings, status and preview on the app side (TypeScript)

**Files:**
- Modify: `apps/notch/src/settings.ts` (add `export function rowsFor(widgets: WidgetId[]): ('media' | 'timer')[]` mirroring `rowsFor` in Kotlin; add `export function widgetLabel(id: WidgetId): string` with "Clock", "Battery", "Timer", "Now playing")
- Modify: `apps/notch/src/status.ts` (add `export function accessLine(allowed: boolean): string`: "Notch can show now playing and calls." when true, "Notification access is off. Turn it on to show now playing and calls." when false)
- Modify: `apps/notch/src/SettingsScreen.tsx` (a "Notification access" row showing `accessLine` and an "Open settings" button calling `NotchIsland.openNotificationAccessSettings()`; read `isListenerAllowed()` on focus)
- Modify: `apps/notch/src/Preview.tsx` (show the now-playing and timer rows under the date line when their widgets are on, using `rowsFor`; the preview shows sample text "Song title" and "04:12", not real data)
- Modify: `apps/notch/modules/notch-island/src/index.ts` (done in Task 4)
- Test: `apps/notch/src/__tests__/settings.test.ts` (add `rowsFor` and `widgetLabel` cases), `apps/notch/src/__tests__/status.test.ts` (add `accessLine` cases)
- Modify: `apps/notch/package.json` only if a new test file is added (none planned)

- [ ] **Step 1: Write the failing tests**

- `rowsFor_follows_widget_order_and_skips_clock_battery`: `rowsFor(['timer','clock','media','battery']) → ['timer','media']`
- `widgetLabel_plain_words`: `widgetLabel('media') === 'Now playing'`, `widgetLabel('timer') === 'Timer'`
- `accessLine_off_says_what_to_do`: `accessLine(false)` contains "Turn it on"

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/notch && corepack pnpm test`. Expected: FAIL, the new functions are missing.

- [ ] **Step 3: Implement and run**

Run: `corepack pnpm test && corepack pnpm typecheck`. Expected: all tests pass (13 existing + the new cases), typecheck clean.

- [ ] **Step 4: Commit**

```bash
git commit -m "Notch: settings for now playing, timer and notification access"
```

---

### Task 10: Phone verification and the release gate (no code)

This task needs the phone and the owner. Before any phone step: `coord claim device:49kjmnuwonkffqzh "Notch phase 2 test"`; if queued, `coord wait` in the background. Release the claim when done.

- [ ] **Step 1: Bump the version**

Set `apps/notch/package.json` version and the Android `versionName`/`versionCode` for Notch 0.4.0 (Store build 6). Commit `Notch: version 0.4.0 for phase 2`.

- [ ] **Step 2: Run every gate on this branch**

Run: `cd apps/notch && corepack pnpm test && corepack pnpm typecheck`, then `cd apps/notch/android && ./gradlew :notch-island:testDebugUnitTest :app:assembleDebug`. Expected: each passes; paste the actual output into the session log.

- [ ] **Step 3: Store build and install (owner's go to release first)**

Ask the owner for the release go. On the go: `pnpm release notch` locally, then install through the Store only: tap Update from `uiautomator dump` bounds (never a screenshot). Check the Store manifest after release.

- [ ] **Step 4: Phone checks, in this order**

1. Notification access off: open the app, the access row says "Notification access is off" and the clock and battery still work.
2. Turn the access on (owner enables it, or tap through the settings screen). Music playing: folded pill widens and shows the dot; tap → now-playing row with title, artist, art; previous, play/pause, next work.
3. Timer: start 1 minute, fold and reopen, pause, reset; let it run out and check "Done" with no sound.
4. Stopwatch: mode switch, start, pause, elapsed time is kept.
5. Call (owner makes or takes one): folded green timer; tap → call row; run the Task 7 probe; End call ends the call; Speaker shows only if the probe found an action.
6. Remove a widget in settings → its row disappears on the next open.
7. `adb logcat` for crashes during all of the above. Do not force-stop Notch.

- [ ] **Step 5: Record and hand back**

Update `docs/handoffs/notch.md` with the actual results, the probe indices, and the phone's notification-access outcome. Release the coord claim. Wait for the owner's go before any merge or release.

---

## Decisions taken where the spec is silent

- Timer presets 1, 5, 10 and 25 minutes; stopwatch in the same row.
- A finished timer shows "Done" and stops; no sound or haptics (spec non-goal).
- Rows show only when they have content: now playing when a session has a title, the call row when a call is active; the timer row shows whenever the widget is on.
- The card's row order follows the widget order; the ears still ignore it (phase 1 known gap, now only the ears).
- The call row appears above the other rows; the folded call indicator wins over media and timer.
- Speaker and end are chosen by action position, found by a development probe, so the app never reads action text.

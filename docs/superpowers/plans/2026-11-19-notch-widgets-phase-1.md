# Notch widgets, phase 1: settings, live preview, clock and battery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping the Notch pill opens a card with the clock, date, next alarm and battery; the owner customizes its look and behaviour in the app, with a live preview.

**Architecture:** Settings are one JSON string passed from the app to the native module, saved in one SharedPreferences file, and read by `NotchAccessibilityService`, which re-applies them on change. The card is native views inside the accessibility overlay; React Native draws only the settings screen and a preview. Pure logic (settings, clock text, battery text, pill geometry) lives in Kotlin `core/` and TypeScript `src/`, tested on the JVM and with `node --test`.

**Tech Stack:** Kotlin + Expo Modules API (`notch-island`), kotlinx-serialization-json 1.8.1 (same version Deputy uses), TypeScript with `node --test`, `@apps-hub/ui`, React Native 0.81.

**Spec:** `docs/superpowers/specs/2026-11-19-notch-widgets-design.md`

## Global Constraints

- No INTERNET permission. Keep `android.permission.INTERNET` removed in the app manifest.
- No dependency beyond kotlinx-serialization-json 1.8.1 (already in Deputy). No other new library.
- No overlay permission (`SYSTEM_ALERT_WINDOW`). The pill is an accessibility overlay only.
- Copy is sentence case, active voice, plain words. No engineering terms on screens a user sees.
- Test files must be listed in the `test` script of their package (`apps/notch/package.json`).
- Each phase ends with a Store release and a phone test (coord claim first).

## Review Focus

1. Stored settings missing, empty or not JSON → defaults, card still opens. Tested in Task 2 and Task 4.
2. An unknown value (a swatch, size or corner id from a newer or older build) → that field falls back to its default, the others keep. Tested in Task 1 and Task 2.
3. No alarm set → the header shows the clock and date only, with no alarm line. Tested in Task 5.
4. Widget list with an unknown or duplicated id → unknown ids and repeats dropped; empty list → shows nothing but still opens without crashing. Tested in Task 1 and Task 7.
5. Settings changed while the pill is folded → the next fold and open use the new values, with no restart. Tested in Task 4 and Task 7.

---

### Task 1: TypeScript settings model

**Files:**
- Create: `apps/notch/src/settings.ts`
- Test: `apps/notch/src/__tests__/settings.test.ts`
- Modify: `apps/notch/package.json` (add the test file to the `test` script)

**Interfaces:**
- Produces: `export type Accent`, `PillColour`, `Size`, `Corners`, `Clock`, `WidgetId` (string unions as listed below); `export interface NotchSettings { accent; pill; size; corners; foldMs: number; clock: Clock; widgets: WidgetId[] }`; `export const DEFAULTS: NotchSettings`; `export function normalize(raw: unknown): NotchSettings`; `export const SWATCHES: Record<Accent, string>`; `export function moveWidget(list: WidgetId[], id: WidgetId, to: number): WidgetId[]`.
- Ids: accent `indigo | cyan | mint | amber | rose | violet | sky | lime`; pill `black | graphite | tinted`; size `compact | regular | large`; corners `pill | rounded | squared`; foldMs `3000 | 5000 | 10000 | 0` (0 = never fold); clock `12 | 24 | system`; widget `clock | battery | timer | media`.
- Defaults: accent `indigo`, pill `black`, size `regular`, corners `pill`, foldMs `5000`, clock `system`, widgets `['clock', 'battery']`.

- [ ] **Step 1: Write the failing tests**

Tests to write, each one `test(...)` with `assert.deepEqual` / `assert.equal`:
- `normalize(undefined)` and `normalize('nope')` both return `DEFAULTS`.
- `normalize({accent: 'neon', size: 'large'})` returns defaults for accent and the given `size: 'large'`.
- `normalize({foldMs: 7000})` returns `foldMs: 5000` (not in the allowed set).
- `normalize({widgets: ['battery', 'nope', 'battery', 'clock']})` returns `['battery', 'clock']`.
- `normalize({widgets: []})` returns `widgets: []`.
- `moveWidget(['clock','battery','timer'], 'timer', 0)` returns `['timer','clock','battery']`; moving beyond the end clamps to the last index.
- Every `SWATCHES` value is a 7-character `#RRGGBB` string.

- [ ] **Step 2: Run to verify failure**

Run: `corepack pnpm --filter notch test`
Expected: FAIL with "Cannot find module '../settings.ts'".

- [ ] **Step 3: Implement `src/settings.ts`**

Use the id lists above as `as const` arrays, derive the unions from them, and write `normalize` as a per-field pick: keep the raw value if it is in the allowed list, otherwise the default. For `widgets`, keep only known ids, drop repeats, keep order. Swatch hex values: pick one per accent so that the text on it (`onAccent`) keeps WCAG AA contrast (4.5:1) against the pill colour it sits on.

- [ ] **Step 4: Run to verify pass**

Run: `corepack pnpm --filter notch test`
Expected: all tests pass, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add apps/notch/src/settings.ts apps/notch/src/__tests__/settings.test.ts apps/notch/package.json
git commit -m "Notch: settings model with defaults and tolerant parsing"
```

---

### Task 2: Kotlin settings model

**Files:**
- Create: `apps/notch/modules/notch-island/android/src/main/java/expo/modules/notchisland/core/NotchSettings.kt`
- Test: `apps/notch/modules/notch-island/android/src/test/java/expo/modules/notchisland/core/NotchSettingsTest.kt`
- Modify: `apps/notch/modules/notch-island/android/build.gradle` (add `implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")`)

**Interfaces:**
- Consumes: the id lists from Task 1 (same strings).
- Produces: `data class NotchSettings(val accent: String, val pill: String, val size: String, val corners: String, val foldMs: Int, val clock: String, val widgets: List<String>)` with `companion object { val DEFAULTS; fun parse(json: String?): NotchSettings; fun toJson(): String }`. `parse` never throws: null, blank or invalid JSON returns `DEFAULTS`; per-field rules are identical to Task 1.

- [ ] **Step 1: Write the failing tests**

Test names and assertions:
- `nullOrBlankGivesDefaults`: `parse(null) == DEFAULTS`, `parse("  ") == DEFAULTS`.
- `invalidJsonGivesDefaults`: `parse("{not json") == DEFAULTS`.
- `unknownValueFallsBackPerField`: `parse("""{"accent":"neon","size":"large"}""").size == "large"` and `.accent == "indigo"`.
- `unknownWidgetsDropped`: `parse("""{"widgets":["battery","nope","battery"]}""").widgets == listOf("battery")`.
- `roundTrip`: `parse(s.toJson()) == s` for a non-default value.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/notch/android && ./gradlew :notch-island:testDebugUnitTest`
Expected: FAIL, unresolved reference `NotchSettings`.

- [ ] **Step 3: Implement `NotchSettings.kt`**

Use `Json.parseToJsonElement` and `jsonObject`, the same way `apps/deputy/.../StopChip.kt` parses its palette. Per-field validation mirrors Task 1 exactly. `toJson` builds a `JsonObject`.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/notch/android && ./gradlew :notch-island:testDebugUnitTest`
Expected: `tests="N" failures="0"` for the new class plus the existing 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/notch/modules/notch-island/android
git commit -m "Notch: native settings model parsed with the same rules as the app"
```

---

### Task 3: Clock and battery text

**Files:**
- Create: `apps/notch/modules/notch-island/android/src/main/java/expo/modules/notchisland/core/Format.kt`
- Test: `apps/notch/modules/notch-island/android/src/test/java/expo/modules/notchisland/core/FormatTest.kt`

**Interfaces:**
- Produces:
  - `fun clockText(hour24: Int, minute: Int, clock: String): String` ("9:05" for 12-hour, "09:05" for 24-hour; `system` is resolved by the caller and passed as `"12"` or `"24"`).
  - `fun dateText(dayOfWeek: Int, dayOfMonth: Int, month: Int): String` (for example "Thu 19 Nov"; month `0..11`, day-of-week 1..7 with 1 = Sunday, as `java.util.Calendar` gives).
  - `fun alarmText(nextAlarmMillis: Long?, nowMillis: Long, is24: Boolean): String?` (null when there is no alarm; otherwise "Alarm 07:00" in the same clock style; the caller passes the time already formatted only through this function).
  - `fun batteryText(percent: Int, charging: Boolean): String` ("82%" or "82% charging"; percent clamped to 0..100).

- [ ] **Step 1: Write the failing tests**

- `clockText(9, 5, "12") == "9:05"`, `clockText(21, 5, "24") == "21:05"`, `clockText(0, 0, "12") == "12:00"`.
- `alarmText(null, 0L, true) == null`.
- `batteryText(150, false) == "100%"`, `batteryText(-3, false) == "0%"`, `batteryText(82, true) == "82% charging"`.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/notch/android && ./gradlew :notch-island:testDebugUnitTest`
Expected: FAIL, unresolved reference `clockText`.

- [ ] **Step 3: Implement `Format.kt`**

Pure functions only; no `Calendar.getInstance()` inside them, so the tests stay deterministic. Day and month names are English strings.

- [ ] **Step 4: Run to verify pass**

Expected: `failures="0"`.

- [ ] **Step 5: Commit**

```bash
git add apps/notch/modules/notch-island/android/src
git commit -m "Notch: clock, date, alarm and battery text as pure functions"
```

---

### Task 4: Persist settings and expose them to the app

**Files:**
- Modify: `apps/notch/modules/notch-island/src/index.ts` (add `getSettings(): string`, `setSettings(json: string): void`)
- Modify: `apps/notch/modules/notch-island/android/src/main/java/expo/modules/notchisland/NotchIslandModule.kt`
- Create: `apps/notch/modules/notch-island/android/src/main/java/expo/modules/notchisland/android/NotchPrefs.kt`

**Interfaces:**
- Consumes: `NotchSettings.parse`, `NotchSettings.toJson` (Task 2).
- Produces: `object NotchPrefs { fun load(context: Context): NotchSettings; fun save(context: Context, s: NotchSettings) }` backed by the SharedPreferences file `notch_settings`, key `json`. `NotchIslandModule` functions `getSettings` and `setSettings(json: String)`; `setSettings` saves, then calls `NotchAccessibilityService.reapply()` if the service is running.
- `NotchAccessibilityService` gets `companion object { @Volatile var instance: NotchAccessibilityService? }` and `fun reapply()`. `reapply()` re-reads settings and rebuilds the pill on the main thread. Its body is added in Task 7; in this task it is a stub that only rebuilds the existing pill.

- [ ] **Step 1: Test by inspection, then build**

This task is wiring; its test is the build plus the TS typecheck, because the logic it depends on is already tested in Tasks 1 and 2.

Run: `cd apps/notch && corepack pnpm typecheck && cd android && ./gradlew :app:assembleDebug`
Expected: `BUILD SUCCESSFUL`, `tsc` prints nothing.

- [ ] **Step 2: Commit**

```bash
git add apps/notch/modules/notch-island
git commit -m "Notch: save settings natively and expose get and set to the app"
```

---

### Task 5: Header view: clock, date and next alarm

**Files:**
- Create: `apps/notch/modules/notch-island/android/src/main/java/expo/modules/notchisland/android/HeaderView.kt`

**Interfaces:**
- Consumes: `clockText`, `dateText`, `alarmText` (Task 3); `NotchSettings.clock` (Task 2).
- Produces: `class HeaderView(context: Context) : LinearLayout` with `fun bind(s: NotchSettings, nowMillis: Long)`. It reads `AlarmManager.getNextAlarmClock()?.triggerTime` for the alarm line and `Calendar` for the rest. It uses `TextClock` only if the value must update live; otherwise it calls `bind` again each minute from `NotchAccessibilityService` (see Task 7).

- [ ] **Step 1: Verify by build**

Run: `cd apps/notch/android && ./gradlew :app:assembleDebug`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 2: Commit**

```bash
git add apps/notch/modules/notch-island/android/src
git commit -m "Notch: header view with clock, date and next alarm"
```

---

### Task 6: Battery view with a ring and a charging moment

**Files:**
- Create: `apps/notch/modules/notch-island/android/src/main/java/expo/modules/notchisland/android/BatteryView.kt`

**Interfaces:**
- Consumes: `batteryText` (Task 3).
- Produces: `class BatteryView(context: Context) : FrameLayout` with `fun bind(percent: Int, charging: Boolean)`. Draws a ring (an arc over `percent`, colour from the accent), the percentage text inside, and `batteryText` below. Battery state is read from `BatteryManager.BATTERY_PROPERTY_CAPACITY` and `Intent.ACTION_BATTERY_CHANGED`, read by `NotchAccessibilityService` (Task 7), not by this view.

- [ ] **Step 1: Verify by build**

Run: `cd apps/notch/android && ./gradlew :app:assembleDebug`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 2: Commit**

```bash
git add apps/notch/modules/notch-island/android/src
git commit -m "Notch: battery ring view"
```

---

### Task 7: The card in the accessibility service

**Files:**
- Modify: `apps/notch/modules/notch-island/android/src/main/java/expo/modules/notchisland/android/NotchAccessibilityService.kt`
- Modify: `apps/notch/modules/notch-island/android/src/main/AndroidManifest.xml` (no new permission; add nothing)

**Interfaces:**
- Consumes: `NotchPrefs.load` (Task 4), `HeaderView`, `BatteryView` (Tasks 5, 6), `PillGeometry` (existing).
- Produces: the card. Behaviour:
  - Pill size from `size` (compact, regular, large map to a width scale 0.85, 1.0, 1.15 on the existing `PillGeometry` boxes).
  - Pill colour from `pill` (black `#000000`, graphite `#1C1C1E`, tinted = the accent at 20% over black).
  - Corner radius from `corners` (pill = height/2, rounded = 28 dp, squared = 6 dp).
  - Auto-fold after `foldMs`; 0 means never fold. The timer is replaced, not stacked.
  - The expanded card lists the enabled `widgets` in order; phase 1 renders `clock` (HeaderView) and `battery` (BatteryView) only and skips any other id.
  - `ACTION_POWER_CONNECTED` registered at runtime opens the card for 3 s; `ACTION_BATTERY_CHANGED` refreshes `BatteryView` while open; a 60 s `Handler` tick refreshes `HeaderView` while open.
  - `reapply()` (declared in Task 4): removes and rebuilds the pill with fresh settings, keeps it open if it was open.
  - Unregister receivers in `onUnbind`.

- [ ] **Step 1: Write the failing JVM test for the rules that do not need Android**

Put the rules in `core/PillGeometry.kt` (for example `fun sizeScale(size: String): Float` and `fun foldDelayMs(foldMs: Int): Long?`, null meaning never fold). Test them in `PillGeometryTest.kt`:
- `sizeScale("compact") == 0.85f`, `sizeScale("bogus") == 1.0f`.
- `foldDelayMs(0) == null`, `foldDelayMs(5000) == 5000L`.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/notch/android && ./gradlew :notch-island:testDebugUnitTest`
Expected: FAIL, unresolved reference `sizeScale`.

- [ ] **Step 3: Implement the rules and the service changes**

Add the two functions in `PillGeometry`. In the service, build the card from `NotchPrefs.load(this)` inside `show()` and `reapply()`, and keep the existing collapse and animation code, reading `foldDelayMs` instead of the constant.

- [ ] **Step 4: Run to verify pass, then build**

Run: `cd apps/notch/android && ./gradlew :notch-island:testDebugUnitTest :app:assembleDebug`
Expected: `failures="0"` and `BUILD SUCCESSFUL`.

- [ ] **Step 5: Commit**

```bash
git add apps/notch/modules/notch-island/android/src
git commit -m "Notch: card with clock, battery, size, colour, corners and fold time from settings"
```

---

### Task 8: Settings screen with live preview

**Files:**
- Create: `apps/notch/src/Preview.tsx` (renders a collapsed and an expanded pill from a `NotchSettings`, using `@apps-hub/ui` tokens; the colours are the user's choices, read from `SWATCHES`)
- Create: `apps/notch/src/SettingsScreen.tsx` (sections Look, Behaviour, Widgets)
- Modify: `apps/notch/App.tsx` (load with `NotchIsland.getSettings()`, save with `NotchIsland.setSettings(JSON.stringify(s))` on each change; keep the existing status row and Open accessibility settings notice)

**Interfaces:**
- Consumes: `NotchSettings`, `normalize`, `SWATCHES`, `moveWidget` (Task 1); `getSettings`, `setSettings` (Task 4).
- Produces: `export function SettingsScreen(props: { value: NotchSettings; onChange(next: NotchSettings): void })`; `export function Preview(props: { value: NotchSettings })`.
- Look: swatch row for accent, segmented control for pill colour, size and corners. Behaviour: segmented control for fold time (3 s, 5 s, 10 s, Never) and clock (12-hour, 24-hour, Follow phone). Widgets: ordered list with move up and move down buttons, and an on/off switch per widget; phase 1 shows `clock` and `battery`, plus `timer` and `media` listed as "Coming soon" and disabled.

- [ ] **Step 1: Write the failing test for the pure part**

Put the label mapping (for example `foldLabel(foldMs)` returns "Never" for 0, "3 seconds" for 3000) in `src/settings.ts` and test it in `settings.test.ts`:
- `foldLabel(0) === 'Never'`, `foldLabel(3000) === '3 seconds'`.

- [ ] **Step 2: Run to verify failure, then implement**

Run: `corepack pnpm --filter notch test`
Expected: FAIL, `foldLabel is not a function`. Then implement the label and the components.

- [ ] **Step 3: Verify with the test and the typecheck**

Run: `corepack pnpm --filter notch test && corepack pnpm --filter notch typecheck`
Expected: `# fail 0`, `tsc` prints nothing.

- [ ] **Step 4: Commit**

```bash
git add apps/notch/src apps/notch/App.tsx
git commit -m "Notch: settings screen with live preview of the pill"
```

---

### Task 9: Verify, release and phone test

**Files:** none changed.

- [ ] **Step 1: Run every gate**

```bash
cd /Users/outsentia/Documents/apps-hub-wt/notch
corepack pnpm --filter notch test
corepack pnpm --filter notch typecheck
corepack pnpm --filter @apps-hub/ui test
cd apps/notch/android && ./gradlew :notch-island:testDebugUnitTest :app:assembleDebug
```
Expected: every line reports zero failures and `BUILD SUCCESSFUL`. Paste the real output into the handoff, not a prediction.

- [ ] **Step 2: Release and check the manifest**

Run: `corepack pnpm release store -m "..."` only if the Store table changed (it has not in this phase), then `corepack pnpm release notch -m "Settings: change the pill's look, the fold time and the widgets. Tap the pill to see the clock, date, alarm and battery."`. Re-fetch the manifest and check every app's entry is still there.

- [ ] **Step 3: Phone test (coord first)**

Claim `device:49kjmnuwonkffqzh`. Update Notch through the Store. Check: the card opens on tap; each setting in the app changes the pill without a restart; plugging in opens the card for 3 s; an alarm set on the phone appears; with no alarm, no alarm line appears. Release the phone when done.

## Self-review notes

- Spec coverage: the phase 1 items (settings, customization with live preview, clock/date/alarm, battery ring and charging, compact-indicator plumbing) map to Tasks 1–8. Compact-indicator plumbing is only the `setActive` hook in Task 7 (not in the phase 1 list of tasks, so it is left unexercised until phase 2 by design).
- Default fold time changes from 4 s (current build) to 5 s, so the first build of phase 1 shows a slightly longer open time. Call that out in the release note.
- Phase 2 (timer, stopwatch, now playing, notification listener) is out of scope.

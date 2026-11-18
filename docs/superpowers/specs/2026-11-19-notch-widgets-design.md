# Notch widgets and customization: design

## Intent

Notch is a pill around the camera. It works and takes taps. Turn it into a small hub the owner enjoys using: tap it and it opens a good-looking card with the time, music, a timer, the battery and the next alarm, and the owner shapes how it looks from the app, with a live preview. The owner wants the Mac-notch-app feel (tap, expand, fold back), not a settings tool.

## Goals

- Expanded card with these widgets: clock with date and next alarm, now playing (title, artist, album art, previous / play-pause / next), timer and stopwatch, battery with a ring and a charging moment.
- Customize from the app, applied live to the pill: accent colour (8 swatches), pill colour (black, graphite, tinted), size (compact, regular, large), corner shape (pill, rounded, squared), auto-fold time (3 s, 5 s, 10 s, never), clock (12-hour, 24-hour, follow the phone), which widgets show and in what order.
- A live preview of the collapsed and expanded pill inside the app's settings.
- When music plays or a timer runs, the folded pill widens a little and shows a small indicator beside the camera, like a compact island.
- Plugging in the charger opens the pill for 3 s with the battery ring.
- Ongoing call (added 2026-11-19 after the owner chose it): while a call runs, the folded pill shows a green call timer and takes priority over music and timers. Tapped, the card shows the call timer and two controls, speaker and end call. The listener reads only the call notification's category, start time, isOngoing, the action count, each action's PendingIntent, and the notification key. No caller name, number or text.

## Non-goals

- No weather, calendar, notification text, messages, or anything that reads the screen. No network (INTERNET stays blocked). No new dependencies. No iOS.
- Reading notifications is limited to media metadata (now playing) and the call notification's category, start time, isOngoing, the action count, each action's PendingIntent, and the notification key (ongoing call). Nothing else from a notification is read.
- No sounds, haptics, per-app rules, or custom widgets from outside.

## Anti-goals

- Reading what is on screen or in notifications beyond media metadata (title, artist, art, play state) and the call notification's category, start time, isOngoing, the action count, each action's PendingIntent, and the notification key would make it a failure even if it works.
- A settings screen that feels like a form dump; the preview and the swatches should be the first thing seen.

## Constraints

- The pill is built from native Android views inside `NotchAccessibilityService` (RN cannot render in that overlay). RN renders only the app: settings controls and the preview.
- Now playing and ongoing calls need the owner to switch on Notch under Notification access once (a `NotificationListenerService`, used to reach `MediaSessionManager` and to read the call notification's category and duration). Without it the app says so, the widgets are skipped and the clock and battery keep working; nothing else breaks.
- Settings live in one `SharedPreferences` file read by both the app and the service (same process); the service re-applies on change.
- Shared UI package for all app screens (`@apps-hub/ui`). The pill's own colours are user choices, kept in one `swatches` table, not app theme colours.
- Copy is sentence case and plain words. Release screens carry no engineering text.
- Device tests only on the owner's phone, through coord. Install through the Store.

## Approaches

1. **Native views in the accessibility service, RN for settings and preview (chosen).** Smallest, reuses what works on the phone, no new dependency. The preview duplicates the card layout in RN, so layout changes touch two places.
2. A WebView or RN surface as the overlay: one layout for both, but heavy, slow to start and flaky as an accessibility overlay. Rejected.
3. Jetpack Compose in the service: nicer layout code, but a new dependency, and Compose in a service window needs lifecycle scaffolding. Rejected.

## Design

Pure Kotlin (`core/`, JVM-tested): `NotchSettings` (parse, validate, defaults, JSON), `WidgetOrder`, `TimerState` (countdown and stopwatch state machine on a fake clock), `Format` (12/24-hour, date, alarm text), `PillGeometry` (adds size presets and the compact "active" width).

Android (`android/`): `NotchAccessibilityService` builds the card from small view classes (`HeaderView`, `NowPlayingView`, `TimerView`, `BatteryView`) and listens for settings changes, battery and power broadcasts, and the next alarm; `NotchMediaListener` (notification listener) gives `MediaSessionManager` access and feeds `NowPlayingView`; `NotchIslandModule` adds `getSettings`, `setSettings`, `isListenerAllowed`, `openNotificationAccessSettings`.

TS (`apps/notch`): `src/settings.ts` (types, defaults, validation, swatches, widget reorder, pure and tested), a Preview component, sections for Look, Behaviour and Widgets on the app screen.

Phases, each released to the Store and tested on the phone:

1. Settings, customization with live preview, clock/date/alarm header, battery and charging, compact indicator plumbing.
2. Timer and stopwatch, now playing with the notification listener, and ongoing calls (speaker and end controls; the speaker control is shown only when the phone's call notification supplies that action).

## Left to the builder

Exact dp values and animation timings, the swatch hex values (AA contrast against the pill colours), card padding and type sizes, widget icon drawing, the preview's fidelity, test fixtures.

## Risks

- HyperOS may restrict the notification listener on sideloaded installs; the app falls back to "not allowed" and keeps everything else.
- Album art can be large; scale it to the card size before drawing.
- Concurrent `pnpm release` runs can overwrite the manifest; check it after every release.

# Clipboard: design

Working name **Clipboard** (`apps/clipboard`, `com.haroon.clipboard`). A personal
clipboard history for the owner's Android phone that keeps every clip, so nothing
is lost to Gboard's 1-hour delete. Status: owner said "start working" on
2026-10-31 after the brainstorm; this document records that conversation.

## 1. Intent and why

On the owner's phone (Xiaomi 24116RACCG, Android 16, HyperOS 3.0, not rooted):

- Gboard deletes unpinned clips after 1 hour. That is fixed inside Gboard and
  can't be changed without root.
- Android 13+ also wiped the current clip after 1 hour. **Fixed on 2026-10-31**
  with `adb shell device_config override clipboard auto_clear_enabled false`
  (a local override, so server flag sync can't undo it; it survives reboots).
  Undo: `adb shell device_config clear_override clipboard auto_clear_enabled`.
- Gboard misses text from some apps, images and screenshots, files, and hides
  passwords and one-time codes on purpose.

The owner wants their own app that keeps all of it and lets them pick an old
clip from anywhere.

## 2. What it does

- **Captures** every copy in the background: text from every app, images,
  screenshots, and passwords/OTPs (§5). Files, videos and PDFs come in through
  the Android **Share** menu, because apps rarely put them on the clipboard.
  *(My call.)*
- **Keeps** clips for 30 days; pinned clips stay until deleted (owner).
  One-time codes delete after 10 minutes. *(My call.)*
- **Floating bubble** (owner, refined 2026-11-01): shown **only while the
  keyboard is open**, by default at the right edge 72 dp above the keyboard's
  top (`TYPE_WINDOWS_CHANGED` + the `TYPE_INPUT_METHOD` window's bounds). It
  is draggable: a drag moves it anywhere on screen (on screen, under the
  status bar, never under the keyboard) and the spot persists for the next
  keyboards and restarts; a tap without a drag opens the panel as before
  (owner, 2026-11-13: the fixed spot covered app content while typing). Tapping
  it opens a panel just above the keyboard listing recent text clips; tapping a
  clip **pastes it into the focused field** (`setPrimaryClip` then
  `ACTION_PASTE` on `findFocus(FOCUS_INPUT)`; if that fails the clip stays on
  the clipboard with a toast). Both windows are `FLAG_NOT_FOCUSABLE` so the
  field keeps focus; an outside tap closes the panel. Rows swipe to delete with
  Undo, as in the app. Colours: the app sends `{light, dark}` palettes, kept in
  prefs. Shortcut: text clips only until images and hidden clips can be pasted.
- Gboard stays the keyboard (owner chose the bubble over a keyboard of our own).
- The app screen shows the full history (search, pin, delete, copy) and setup.
- **Delete by swiping** a clip sideways (owner, 2026-11-01), in the app and
  later in the bubble panel. The row goes at once; "Clip deleted" with Undo
  stays 5 s and the delete is committed then or when the app leaves the
  screen. Screen readers get the same as a "Delete" accessibility action.
  Deleting the newest clip remembers its fingerprint so the same clipboard
  isn't saved again on the next open (not for hidden clips, which have no
  stored text, until Phase 3).

## 3. Goals, non-goals, anti-goals

**Goals**
- No copy is lost: every clip that reaches the clipboard lands in the history.
- Picking an old clip takes two taps from any app.

**Non-goals** (deliberate cuts)
- Our own keyboard; iOS; sync to other devices; cloud anything.
- Capturing from apps that block copying entirely (nothing reaches the
  clipboard, so there is nothing to catch).

**Anti-goals** (failure even if it "works")
- Capture that disturbs typing: the keyboard closing, a field losing its text
  or selection, visible flicker.
- A password or code readable at rest, or readable by another accessibility
  app such as Deputy.
- Saving Strongroom's own copies, which Strongroom wipes after 30 s on purpose.
- Battery drain or a service HyperOS keeps killing.
- Any telemetry (repo rule).

## 4. Capture: how background reading works

**Verified in the Android 16 source** (`ClipboardService.clipboardAccessAllowed`,
`android16-release`, read 2026-10-31):
- Only the default keyboard, the app whose window has **focus**, the content
  capture service and the augmented autofill service may read the clipboard.
  Accessibility services get **no** exemption. The last two can only be set
  temporarily over adb, so they don't count.
- `addPrimaryClipChangedListener` is never called for an app without access.
  Instead the system logs `Denying clipboard access to <package>` on every
  copy, once per registered listener.

**So the engine works in two steps:**
1. **Notice a copy.** Candidate signals, to be measured in the spike:
   (a) accessibility events: a click on a node labelled "Copy", a "Copied"
   toast, the system clipboard overlay window; (b) the `Denying clipboard
   access to com.haroon.clipboard` log line, which needs `READ_LOGS` granted
   once with adb (Android 13+ may ask for log consent).
2. **Read it.** The accessibility service briefly adds a focusable
   `TYPE_ACCESSIBILITY_OVERLAY` window (no overlay permission needed, as
   Deputy's Stop chip), reads `getPrimaryClip()` while it has focus, then
   removes it. Opening the bubble panel also reads the current clip, so the
   latest copy is never missed even if no signal fired.

Images: the clip holds a content URI whose read grant is temporary, so the
bytes are copied into app storage at capture time. Limit 25 MB per item; a
larger item is skipped with a notice. *(My call.)*

Screenshots: HyperOS can write each screenshot to the clipboard
(`settings secure mi_screen_shots_write_clipboard_enable`, currently 0). With
a history the overwrite costs nothing, so the plan is to switch it on and let
the normal engine capture screenshots, with no media permission. *(My call,
depends on S3.)*

### Spike (Phase 0), answers needed before Phase 1 is planned

- **S1** A focusable accessibility overlay gets focus and `getPrimaryClip()`
  returns the clip, on the emulator and on the phone.
- **S2** The focus grab's side effects while typing: does the keyboard stay or
  come back, does the field keep its text and selection, is there flicker; how
  long the grab takes.
- **S3** Which copy signals fire on HyperOS for: the text selection Copy, an
  app's own copy button (WhatsApp, Chrome "Copy link"), a screenshot with the
  HyperOS setting on, and a password manager's sensitive copy.
- **S4** Only if (a) misses copies: does `READ_LOGS` work, and how often does
  HyperOS ask for log consent.
- **S5** Does HyperOS keep the service alive for a day (autostart, battery).
- **S6** Does HyperOS show its own notice on each read, and does
  `clipboard_show_access_notifications=0` silence it.

**Emulator results** (2026-10-31, Android 15, throwaway Java probe, Gboard):
- **S1 pass.** A direct `getPrimaryClip()` from the service is denied
  (`clip=null`, "Denying clipboard access" logged). Through a 1x1 focusable
  `TYPE_ACCESSIBILITY_OVERLAY` it returns the clip, with or without
  `FLAG_ALT_FOCUSABLE_IM`. Focus took 128-750 ms. `onWindowFocusChanged`
  sometimes never fired although the read at the 600 ms timeout succeeded, so
  the engine must read on a timer as well, not only on the focus callback.
- **S2 pass.** With the keyboard up in a text field: the keyboard stayed shown,
  the field kept its text and focus, and typing continued after the grab.
- **S3 (AOSP).** A tap on the selection toolbar's Copy fires
  `TYPE_VIEW_CLICKED` with text `[Copy]`; SystemUI's clipboard preview fires a
  `TYPE_WINDOW_STATE_CHANGED` from `com.android.systemui`; the "Denying
  clipboard access" log line appears on every copy.
- **Trigger rule learned the hard way:** triggering on any event whose text
  contains "Copy" fires when the toolbar *opens*; the grab steals focus, the
  toolbar closes and reopens, and it loops. Trigger only on a click on a
  Copy-labelled node, a "Copied" toast or announcement, or a SystemUI window,
  and never re-trigger on our own window's events.
- `wm.addView` can throw `BadTokenException` while the service is being
  rebound; guard it as Deputy's chip does.
- **Every read shows the system toast "<app> pasted from your clipboard"**
  unless `secure clipboard_show_access_notifications` is 0 (Settings, Privacy,
  "Show clipboard access"). That switch is global: it hides the toast for every
  app. The owner decides (see handoff).
- On the emulator, an adb-installed app's accessibility service is stripped
  from `enabled_accessibility_services` until
  `appops set <pkg> ACCESS_RESTRICTED_SETTINGS allow`.

**Emulator results with the real app** (Clipboard 0.1.0, release build):
- The selection toolbar is a popup window and its Copy item is a
  not-important view. Android delivers that click only to a service with
  `flagIncludeNotImportantViews | flagRetrieveInteractiveWindows`, and the
  second needs `canRetrieveWindowContent="true"`. Without them only SystemUI's
  window event arrives. The service never calls `getWindows()` or reads nodes;
  its description says so.
- Background copy in another app: captured, source package recorded, grab
  273 ms warm. The first grab in a fresh process took 1813 ms (renderer start).
  Typing continued after the warm grab; after the cold one a single keystroke
  typed ~1.5 s later was lost once. Watch for this on the phone (S2).
- "Saved on open" catches what the service misses: every copy made before the
  flags were fixed was still saved when the app was opened.
- Hidden kinds (secret, code) store no text; dedupe for them is an in-memory
  fingerprint only.

**Phone results** (2026-10-31, HyperOS 3.0, Clipboard 0.1.0 from the Store):
- **S1, S3 pass in Chrome:** selection-toolbar Copy fires `TYPE_VIEW_CLICKED
  [Copy]` (171 ms and 114 ms grabs); the address bar's copy icon fires
  `TYPE_VIEW_CLICKED` on an `ImageView` labelled "Copy link to web page …"
  (105 ms). All three saved with source `com.android.chrome`.
- **S2 pass:** typing straight after a capture went into Chrome's address bar
  with Gboard up.
- **S6 pass:** with `clipboard_show_access_notifications=0`, no toast and no
  HyperOS notice on a read.
- HyperOS logs "Denying clipboard access" for Gmail, GMS, Clipboard Manager and
  Mi App Finder on every copy, so the log signal (S4) exists here too.
- **Setup is UI only.** The Store installs with `packageSource=0`, so Android
  treats the app as sideloaded: the switch is grey until App info, ⋮, "Allow
  restricted settings". Writing `enabled_accessibility_services` over adb with
  a not-yet-approved service makes HyperOS clear the whole list (Deputy was
  switched off and had to be restored). Never write that setting over adb.
- **Screenshots pass (2026-11-01)** with `mi_screen_shots_write_clipboard_enable=1`:
  HyperOS writes the image to the clipboard, then `com.miui.screenshot` shows a
  "Copied successfully" toast ~3.5 s later; that toast triggers the grab
  (247 ms) and the clip is saved as an image. Bug: the source is guessed from
  the last window (`com.miui.touchassistant`); for toasts and announcements use
  the event's own package unless it is `android`/SystemUI.
- **S5 fails without HyperOS setup.** HyperOS's cleanup (`OneKeyClean`, the
  recents "clear all"; `SwipeUpClean`, swiping the app away) kills the process
  (`dumpsys activity exit-info`: reason 13). Android marks the service crashed
  and, with Autostart off (`MIUIOP(10008): ignore`), never rebinds it; Deputy
  was hit the same way. Fixes: Autostart on (Security app's Autostart list,
  `com.miui.permcenter.autostart.AutoStartManagementActivity`; not on HyperOS 3's
  App info page), and setup must detect "enabled but not connected" and say how
  to recover. A crashed service clears only when it leaves the enabled list
  (`removeDisabledServicesFromTemporaryStatesLocked`) or its app is updated.
- **Bubble passes on the phone (2026-11-01, Clipboard 0.2.0, docked Gboard,
  portrait, Chrome):** the bubble appears at the right edge above the keyboard
  and covers nothing; the panel opens above the keyboard in the dark theme
  without taking focus; tapping a clip pasted it into Chrome's address bar
  with the keyboard still up; swipe deleted a row, Undo restored it, and
  letting the 5 s pass committed the delete. Two things to remember when
  testing: `uiautomator dump` suspends accessibility services (it closes the
  panel), and overlay rows can't be found by dump, so locate buttons by
  colour (`scratchpad/findcolor.py` pattern: screencap, BMP, accent pixels)
  rather than guessed coordinates, since a missed tap lands on a real clip.
- **Bug found on the phone and fixed in 0.2.1:** after deleting a clip,
  copying the same text again was silently not saved (`saved=false`), because
  both the in-memory last fingerprint and the "dismissed" fingerprint blocked
  every path. Now the dismissed fingerprint only blocks the open-the-app read
  (`core/CaptureGate.kt`, JVM-tested) and deleting the newest clip clears the
  last fingerprint. Verified on the emulator.
- Still open: S3 for WhatsApp; S5 (survived a package update and ~3 h with
  Autostart on, not yet a full day); the cold-start lost keystroke (not seen
  on the phone).

## 5. Passwords and one-time codes

- **Detected** by `ClipDescription.EXTRA_IS_SENSITIVE` (set by banks and
  password managers), or text that is only a 4-8 digit code. *(My call.)*
- **Skipped entirely** when the copy came from Strongroom
  (`com.haroon.strongroom`, the foreground package at copy time).
- **Stored sealed**, never in readable form. Shown in the bubble and the app as
  "Password · from <app> · hidden". Revealed text is marked
  `setAccessibilityDataSensitive` so other accessibility apps can't read it.
- **Sealing scheme** (the Strongroom seam): each secret is encrypted with a
  fresh AES-256-GCM key, which is wrapped with an **RSA-OAEP public key**.
  Encrypting needs only the public key, so a copy is sealed in the background
  with no fingerprint. Revealing needs the private key.
  - **Now:** the key pair lives in the app's Android Keystore; the private key
    requires the fingerprint (`setUserAuthenticationRequired`,
    `BiometricPrompt`).
  - **Later (Strongroom):** Strongroom owns the key pair and publishes the
    public key; the clipboard app seals with it and sends a reveal to a
    Strongroom activity, which unlocks and shows or copies it. Each sealed
    record stores a `scheme` field (`keystore-v1`, later `strongroom-v1`), so
    both kinds can sit in the history during the switch.
  - In code this is one interface, `SecretSealer` (`seal(bytes)` and
    `reveal(activity, sealed)`), with one implementation now.
  - Strongroom's side (its public key, reveal activity, and a signature check
    that only `com.haroon.clipboard` may call it) belongs in Strongroom's own
    design when that phase starts.

## 6. Fixed constraints

- Monorepo app like Deputy: Expo SDK 54, RN 0.81.5, Android only, `minSdk 33`.
  Native code in an Expo local module `apps/clipboard/modules/clipboard-core`
  (Kotlin). **Kotlin owns capture, storage, expiry and the bubble**, because
  the accessibility service runs without React Native. RN renders the app
  screens only.
- The bubble and its panel are native views in an accessibility overlay. They
  use the `@apps-hub/ui` token values for colour and type, as Deputy's chip does.
- UI from `@apps-hub/ui`; a `clipboard` brand added to `packages/ui/src/tokens.ts`.
- Storage: platform SQLite plus a files directory, app-private,
  `allowBackup=false`.
- Released with `pnpm release clipboard` (register in
  `tools/release/src/apps.ts`), installed on the phone **only through the
  private Store**. Debug work uses the emulator.
- Tests: Kotlin JVM tests for expiry, detection and sealing; `node --test` for
  TS logic. FOSS dependencies only (`androidx.biometric` is Apache-2.0).

## 7. Phases

| Phase | Scope |
|---|---|
| 0 | Spike S1-S5: capture engine probe, emulator then phone (Store build) |
| 1 | Capture engine, storage, 30-day/10-minute expiry, history screen, setup screen |
| 2 | Floating bubble and panel |
| 3 | Passwords/OTPs sealed with the fingerprint; Share target for files |
| 4 | Strongroom reveal, after Strongroom ships |

## 8. Left to the builder

SQLite schema, module file layout, bubble look and gestures within the repo's
UI rules, the exact copy-signal heuristics after S3.

Launcher icon: `apps/clipboard/assets/icon.svg` (lime clipboard with a darker
history sheet on `#16200B`), rendered with `tools/icons/render-icon.mjs`; the
`clipboard` brand (hue 95, `#A3E635` / `#4D7C0F`) matches it. *(My call.)*

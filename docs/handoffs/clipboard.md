# Handoff: Clipboard (own clipboard history app)

## Resume prompt

Dated 2026-10-31. Work happens in the worktree `.claude/worktrees/clipboard`
(branch `clipboard`, from `main`). Read `docs/handoffs/clipboard.md` completely
first, then `docs/clipboard/DESIGN.md`. Trust the decisions and verified facts
below and don't redo that work. Follow the handoff contract in
`~/.claude/CLAUDE.md`. Read "Current state + exact next step", then continue
from it. Commit or release only when the user says so.

## Goal and fixed constraints

- Replace Gboard's clipboard history (1-hour delete, missing data types) with
  the owner's own Android app. Gboard stays the keyboard.
- Repo rules (AGENTS.md): Expo SDK 54 / RN 0.81.5, `@apps-hub/ui`, native code
  in an Expo local module, `node --test`, Gradle JVM tests, no telemetry.
- Phone installs only through the private Store (memory: install-via-store-only).
  Debug work uses the emulator (`emulator-5554`, Android 15).

## Decisions made (with why)

Owner's answers, 2026-10-31:
- Build our own app ("can we create our own clipboard app to fix this issue?")
  instead of unblocking the third-party Clipboard Manager.
- Capture: text from all apps, images/screenshots, files/videos/PDFs,
  passwords and OTPs.
- Keep 30 days; pinned forever.
- Paste from a floating bubble.
- Accessibility service capture with a one-time adb/setup step is acceptable.
- Passwords/OTPs hidden until revealed "with Strongroom"; ship first with a
  fingerprint lock inside the app and room to move reveal to Strongroom later.

Claude's calls are marked *(My call.)* in DESIGN.md.

## Evidence / facts already verified

- Phone: `adb-49kjmnuwonkffqzh-zHnffO._adb-tls-connect._tcp`, Android 16 (SDK
  36), HyperOS OS3.0, not rooted. Gboard 18.5.4 is the default IME and has
  `READ_CLIPBOARD: allow`.
- 2026-10-31: `device_config override clipboard auto_clear_enabled false`
  applied on the phone; `device_config get` returns `false` and
  `list_local_overrides` shows it. Was `auto_clear_enabled=true`,
  `auto_clear_timeout=3600000`.
- HyperOS settings seen: `secure mi_screen_shots_write_clipboard_enable=0`,
  `secure old_clipboard_content_need_clear_new=1` (meaning unknown; not found
  in framework jars by plain grep, they are compressed).
- Android 16 `ClipboardService.clipboardAccessAllowed`: background read only
  for default IME, focused uid, content capture service, augmented autofill
  service; no accessibility exemption. Denied listeners log
  `Denying clipboard access to <pkg>` on every clip change
  (`sendClipChangedBroadcast`). Augmented autofill can only be set temporarily
  over adb.
- Deputy's phone spikes (docs/handoffs/deputy.md, session 5): a Store-installed
  app's accessibility switch works without "Allow restricted settings"; HyperOS
  shows a "Danger" sheet with a 5 s OK. Deputy's chip is a
  `TYPE_ACCESSIBILITY_OVERLAY` with no overlay permission.
- Installed third-party clipboard apps on the phone: `com.mason.ship.clipboard`
  (accessibility + overlay, both currently off/denied), `org.rojekti.clipper`.
- Strongroom Phase 1 is in progress on branch `strongroom-phase-1` (Task 11 of
  12 done, worktree `.claude/worktrees/strongroom-phase-1`).

## File map

- `docs/clipboard/DESIGN.md`: the design.
- `apps/clipboard`: Expo app (`App.tsx`, `src/rows.ts` + test), committed
  prebuild `android/` with Deputy's release signing/version wiring copied into
  `android/app/build.gradle`, `minSdk 33`.
- `apps/clipboard/modules/clipboard-core`: `core/CopySignal.kt`,
  `core/ClipKind.kt` (pure, `CopySignalTest`), `android/CaptureService.kt`
  (accessibility service + focus grab; spike S3 logging under tag
  `ClipCapture`, marked shortcut), `android/ClipStore.kt` (SQLite `clips.db`),
  `ClipboardCoreModule.kt`, TS adapter `src/index.ts`.
- Also changed: `packages/ui` (`clipboard` brand, provisional hue 95, CSS
  rebuilt), `tools/release/src/apps.ts`, Store installer `<queries>`.

## Session log

- 2026-11-13: owner asked for a movable bubble ("it hides some important
  content or button while typing"). Built the drag into `android/Bubble.kt`
  (touch handler: tap = open/close as before, any direction past the slop
  drags) with the placement math in pure `core/BubblePlace.kt` (+ 8 tests:
  follow-finger conversion, clamped on screen, under the status bar, never
  under the keyboard, parked spot survives a taller keyboard). The dragged
  spot persists in prefs (`bubble_dx`/`bubble_dy`, distances from the right
  edge and the keyboard top, so a keyboard resize keeps the same spot) and
  the default stays 8 dp in from the right, 72 dp above the keyboard.
  `:clipboard-core:testDebugUnitTest` 24/24, `:app:assembleDebug` builds,
  `pnpm --filter clipboard test` 0 failures. Emulator/phone drag check still
  to do before the next Store release. Owner asked for the release ("release
  the app latest build using local command"): bumped app.json to 0.2.2 and
  ran `pnpm release clipboard`. Gotcha found: the manifest's 0.2.1 (6) entry
  had been lost (some later manifest publish dropped it — only one android
  entry is kept per app), so `nextVersionCode` handed back 6 and the first
  publish would have been uninstallable on any device already on 0.2.1 (6).
  Re-ran the release, which built and **published Clipboard 0.2.2 (7)**
  (verified in the live manifest: versionName 0.2.2, versionCode 7, sha256
  5d78134227a595fb…). Still nothing committed. Owner asked for the PR
  ("create the PR"): committed in two commits (app + docs + brand + lock;
  release-tool registration), rebased onto `origin/main` (conflicts resolved:
  strongroom brand coexists in tokens.ts, clipboard section added to the
  root .gitignore, apps.ts entry rebuilt on #32's `ANDROID_PACKAGES.clipboard`,
  the old Store-installer `<queries>` hunk dropped — main's #32 replaced it
  with `QUERY_ALL_PACKAGES`), re-verified (`pnpm test` 19 packages all
  `fail 0`, typecheck exit 0, ui tokens/contrast suite green) and opened
  **PR #34 → main: https://github.com/haroongondal/apps-hub/pull/34**.

- 2026-10-31: phone diagnosis, system auto-clear override, brainstorm, design
  written, worktree created.
- 2026-10-31: emulator spike with a throwaway Java probe (scratchpad, now
  uninstalled from the emulator): S1 and S2 pass, S3 signals found on AOSP,
  the access toast found. Results in DESIGN.md §4. Probe logic to carry into
  Kotlin: 1x1 `TYPE_ACCESSIBILITY_OVERLAY`, flags `FLAG_NOT_TOUCH_MODAL |
  FLAG_NOT_TOUCHABLE` (focusable), read clip on focus or after 600 ms, remove,
  150 ms delay after the trigger event. The emulator shares the Mac clipboard:
  never log clip text there, and save/restore the Mac clipboard (`pbpaste`/
  `pbcopy`) around any test copy.

- 2026-10-31: owner chose: turn off "Show clipboard access" (done on the phone:
  `settings put secure clipboard_show_access_notifications 0`; undo with
  `settings delete secure clipboard_show_access_notifications`), and release a
  Store build. Scaffolded `apps/clipboard`, emulator end to end passes (DESIGN
  §4). `pnpm test` and `pnpm typecheck` exit 0; `:clipboard-core` JVM tests
  7/7. **Published Clipboard 0.1.0 (versionCode 2) to the Store.** The Store
  release was first denied by the auto-mode permission check; the owner said
  "go ahead" and **Store 0.1.0 (versionCode 10) was published** with the
  `<queries>` entry. Nothing committed.

- 2026-10-31: phone test over wireless debugging (results in DESIGN §4,
  "Phone results"): S1, S2, S3 (Chrome), S6 pass. Setup lessons: the owner
  first enabled the third-party Clipboard Manager by mistake (same "Clipboard"
  label; switched back off over adb); our switch was grey until "Allow
  restricted settings" (the adb appops grant was refused by the auto-mode
  check, so the owner did it). An adb write of `enabled_accessibility_services`
  wiped Deputy too; restored with Deputy's exact original value. Launcher icon
  made; **Clipboard 0.1.1 (versionCode 3) published** with it. Wireless adb
  serial changed: reconnect with `adb mdns services` then
  `adb connect <ip:port>` (was `192.168.18.209:36935`).

- 2026-11-01: owner updated to Clipboard 0.1.1 (3). Both Clipboard and Deputy
  were found dead: HyperOS cleanup kills + Autostart off (DESIGN §4). Owner
  turned Autostart on for both (the HyperOS Autostart list, opened over adb);
  their off/on toggles didn't register, so the crashed state was cleared by
  `settings delete` then `put` of the exact approved list (both rebound:
  Deputy 161, Clipboard 1). Owner approved screenshots-to-clipboard: set
  `mi_screen_shots_write_clipboard_enable=1` (left on); one test screenshot
  (`input keyevent 120`, now in the Gallery) was captured in the background via
  the "Copied successfully" toast. Wireless adb serial is the mDNS name again.

- 2026-11-01: owner asked for delete by swiping. Built with RN `PanResponder`
  (no new dependency): `src/SwipeToDelete.tsx`, pure `src/swipe.ts` + test,
  pending delete with 5 s Undo in `App.tsx`, native `remove(id)` + persisted
  dismissed fingerprint in `ClipStore`. Found and fixed: the on-open read ran
  before window focus and was refused (`captureNow` now waits for focus).
  Emulator: saved on open with 0 refused reads, Undo restores, delete commits
  after 5 s, deleted clip stays gone after a force-stop. `pnpm test`/
  `typecheck` exit 0, JVM 7/7. **Published Clipboard 0.1.2 (4).**

- 2026-11-01: owner asked how to open the clipboard while typing; chose the
  bubble "only while typing" and "paste into the field". Built
  `android/Bubble.kt` (bubble + panel + paste + swipe/Undo), `core/Swipe.kt`
  (+ `SwipeTest`, JVM now 12/12), `typeWindowsChanged` in the service config,
  `setPalettes` from the app. Emulator (floating Gboard): bubble follows the
  keyboard, panel opens without taking focus, tap pasted
  "hello probeundoprobebubble" into Settings search, swipe + Undo kept the
  clip. Test gotcha: Undo times out in 5 s, so swipe and tap Undo in one
  command. **Published Clipboard 0.2.0 (5).**

- 2026-11-01: owner said "test it". Phone test of the bubble (DESIGN §4):
  pass. Store trouble: the phone's Store is **build 11, released from the
  `firewall-spike` branch** (its manifest lists `…open_tunnel_vpn.spike`, not
  Clipboard), so the Store shows Clipboard as "Install" even though it is
  installed; tapping Install updated it in place (0.1.1 to 0.2.0). Do **not**
  release the Store from the clipboard worktree: it would drop that spike's
  entry. The clean fix is when branches merge to `main` and CI releases the
  Store with every app's entry. Mistakes: my guessed Undo tap landed on a real
  clip and pasted it into Chrome's address bar (cleared at once, nothing
  sent; that clip also moved to the top of the history and onto the system
  clipboard). Found the dismissed-fingerprint bug (DESIGN §4) and **published
  Clipboard 0.2.1 (6)**; the first upload hit `fetch failed … write EPIPE`
  and a retry worked (manifest unchanged until a publish succeeds). JVM 16/16.

## Current state + exact next step

**PR #34 open (https://github.com/haroongondal/apps-hub/pull/34)**: Clipboard
0.2.2 (7) — draggable bubble — against main, rebased onto #32. Clipboard
0.2.2 (7) is in the Store; the phone may still have 0.2.0 (5) or 0.2.1 (6) —
both update to 7 through the Store's Install button. Next: drag the bubble
on the phone, then WhatsApp copy button (S3), S5 after a full day, then
write the Phase 1 plan (expiry, images stored, pin, drop INTERNET, remove
spike logging, setup copy).
Next:
1. Remaining phone checks: S3 for WhatsApp's copy button; S5 again after a day
   now that Autostart is on (`dumpsys accessibility`, `dumpsys activity
   exit-info com.haroon.clipboard`).
2. Write the Phase 1 plan (also: source from the toast's own package; setup
   that detects "enabled but not connected" and guides Autostart + off/on) (superpowers:writing-plans) from the results:
   30-day/10-minute expiry, images copied into storage, delete/pin, drop
   INTERNET from release, remove spike logging, "Turn on" opens our own
   service page (`ACTION_ACCESSIBILITY_DETAILS_SETTINGS`; adb was refused, try
   from the app) and setup copy that mentions "Allow restricted settings".
   Store fix to propose separately: set
   `SessionParams.setPackageSource(PACKAGE_SOURCE_STORE)` in
   `apps/store/modules/store-installer/.../Installer.kt:88` so Store installs
   aren't restricted (affects Deputy and Strongroom too). Consider renaming the
   service label, which collides with Clipboard Manager's "Clipboard".

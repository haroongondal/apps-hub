# Edge visualizer (own Muviz Edge equivalent) — handoff

## Resume prompt
(2026-11-18) Work only in the worktree ~/Documents/apps-hub-wt/halo (branch `halo`). Read this file completely first,
then docs/handoffs/halo-sdd-ledger.md (task-by-task log; tasks marked complete are done), the approved designs
docs/superpowers/specs/2026-11-17-edge-visualizer-design.md (§13 = phone results) and
docs/superpowers/specs/2026-11-17-halo-stages-3-5-design.md, and the approved plan
docs/superpowers/plans/2026-11-17-halo-stages-3-5.md. Trust the verified facts; do not redo them. Follow the handoff
contract in ~/.claude/CLAUDE.md and execute with cd-engineering-tools:parallel-agents-coord (agent per task, briefs in
.sdd/, filelock for shared files, reviews). Releases: `pnpm release halo` is pre-approved — run it from the detached
worktree ~/Documents/apps-hub-wt/halo-release after `git -C ../halo-release checkout --detach <sha>`, then re-fetch
manifest.json and check nothing clobbered it. Store releases need the owner's go. Phone: claim
device:49kjmnuwonkffqzh with coord, install only through the Store app on the phone. Continue from
"Current state + next step".

## Goal and fixed constraints
- The owner wants their own Android app that does what Muviz Edge (com.sparkine.muvizedge 2.1.5.1) does, for personal use, with no third-party app.
- Original code and art: learn the mechanisms from the APK, never copy its decompiled code, assets or name.
- v1 scope (owner, 2026-11-17): edge lights to music, album-art colours, notification edge flash, AOD screen.
- Lives in apps-hub, shipped via the private Store (owner, 2026-11-17). Kotlin owns services/overlay/visualizer; RN renders settings with @apps-hub/ui (Deputy/Strongroom pattern). Android only.
- No ads, analytics, billing, Firebase or Play Services (AGENTS.md FOSS rule).
- Test phone is HyperOS (Xiaomi 24116RACCG): owner enables special permissions; Autostart needed (see memory hyperos-accessibility-setup).

## Verified facts (from the pulled APK, 2026-11-17)
APK copy: scratchpad only (not committed). Manifest dump via aapt2 `dump xmltree`, strings via `aapt2 dump resources`.
- minSdk 32, targetSdk 36. App code is wrapped by pairip (com.pairip.application.Application) — decompiling its logic is not useful; the manifest + strings + API refs are enough.
- Audio: `android.media.audiofx.Visualizer` (global mix, session 0). Permissions RECORD_AUDIO + MODIFY_AUDIO_SETTINGS. No MediaProjection / AudioPlaybackCapture referenced in dex.
  Fallback "Random mode" when an app yields no FFT data. Ships res/raw/workaround_1min.mp3 (likely silent keep-alive; not verified).
  Error copy: "Unable to access Audio FX layers ... Disable other music visualizers" → only one Visualizer client works reliably.
- Drawing: TYPE_APPLICATION_OVERLAY via SYSTEM_ALERT_WINDOW (no AccessibilityService). Uses DisplayCutout + getRoundedCorner; has a manual "Define Screen Edges" screen and "Roundness" setting.
- Service: `service.AppService` foregroundServiceType=mediaPlayback (FOREGROUND_SERVICE_MEDIA_PLAYBACK), BootReceiver (BOOT_COMPLETED, QUICKBOOT_POWERON), WAKE_LOCK.
- Media + notifications: `AppNotificationListener` (NotificationListenerService) + MediaSessionManager/MediaController/PlaybackState → playing app, state, album art.
- Tiles: OverlayTileService and AODTileService (Quick Settings).
- Per-app/conditions: PACKAGE_USAGE_STATS (hide over selected apps, fullscreen, landscape), READ_PHONE_STATE (disable during calls), battery saver, proximity "Pocket mode".
- Features by string: Edge lights 24 patterns in groups Lights/Lines/Particles/Waves (names e.g. Side Waves, Bars Around, Fire Dance, Snow Particles); options colours 1-4, thickness, speed, spread, glow, padding, roundness, mirrored/clockwise.
  Music overlay with controls. AOD: 15 clock styles, music, notifications, burn-in pixel shift, pocket mode, timeout, off schedule, "while charging"/"on music" triggers, double tap to wake.
  Colours: palettes, fetch from album art, from wallpaper. Dim background, custom background image.
- Dropped on purpose: AdMob, Firebase, Play billing, license check.

## Decisions made
- 2026-11-17: scope widened by owner to "a complete app replica" = full Muviz Edge feature parity (own code, art, name).
- 2026-11-17: approach A picked by owner: Android 2D Canvas drawing in Kotlin; any single pattern over budget may move to an AGSL shader later.
- Builder calls (in the design, owner can veto): name Halo / com.haroon.halo / apps/halo / module halo-engine / release id + brand key `halo`;
  live preview = the real overlay over the settings screen; 5 stages (spike, edge lights, flash+rules, AOD, extras);
  calls detected via AudioManager mode listener (no READ_PHONE_STATE).
- 2026-11-17 owner: may `pnpm release halo` without asking each time (tell owner each time; Halo only).
- 2026-11-17 owner: may force-stop Muviz (data kept) before audio tests while holding the device claim.
- 2026-11-17 owner: wants stages 3-5 widened (AOD with any timeout incl. never, faces + themes, notification customisation, extras); kept every proposed item; picked approach A (native Kotlin AOD) and order notifications → AOD → extras. Design: docs/superpowers/specs/2026-11-17-halo-stages-3-5-design.md (awaiting approval).
- Builder calls after builder check: spike failure = stop and ask owner; stage 2 and 4 ship in two batches;
  emulator for fast rounds, phone only via Store; `halo` joins apps.ts at stage 1.

## File map
- docs/handoffs/edge-visualizer.md (this file)
- docs/superpowers/specs/2026-11-17-edge-visualizer-design.md (design, APPROVED 2026-11-17)
- docs/superpowers/plans/2026-11-17-halo.md (plan for stages 1-2; stages 3-5 get a plan after the spike)
- Worktree: ~/Documents/apps-hub-wt/halo, branch `halo` (off main 226a947)
- Phone serial for coord: run `adb shell getprop ro.serialno` (phone runs Android 16).

## Session log
- 2026-11-17: pulled APK, mapped mechanisms and features (above). Owner chose v1 scope and apps-hub. Brainstorming started; owner asked for a new-chat prompt to start building.

## Session log (cont.)
- 2026-11-18 (session 3): read handoff/ledger/plan; Task 4.1 brief written (.sdd/task-4.1-brief.md), implementer dispatched (sonnet, base 0efbbf9).
- Task 4.1 complete (1ae0888; app-open restart, aod/themes settings, AodPolicy). Task 4.2 dispatched (opus, brief .sdd/task-4.2-brief.md); session restart interrupted it with WIP uncommitted (DrawList text op, FaceView, BurnIn, Face/Faces, faces/, tests, temporary FaceDebugActivity), resumed the same agent by SendMessage.
- Task 4.2 complete (1c10ae0: text op, BurnIn, Face API, FaceView, 3 faces). Tasks 4.3 (t43, opus) + 4.5 (t45, sonnet) dispatched in parallel (briefs .sdd/task-4.3-brief.md, .sdd/task-4.5-brief.md; t45 commits core/Themes.kt first; shared files under filelock). Task 4.5 complete (8a4a41b, bbc6fd8, 31833ce). Task 4.4 wave dispatched (f1-f4, sonnet, brief .sdd/task-4.4-brief.md, Faces.kt under filelock, no emulator; afterwards: controller sets FacesTest count to 15 and one visual contact-sheet pass). Task 4.3 complete (fb6719f, 3800370, f48247a: real always-on screen, preview activity, wake). Task 4.6 dispatched (t46, sonnet, brief .sdd/task-4.6-brief.md; adds module listFaces + renderFaceThumb) in parallel with the 4.4 wave. Remaining after those: controller sets FacesTest count 15 + contact-sheet visual pass, then 4.7 (review wave incl. security re-check, 0.5.0 release from halo-release, phone check with owner). Task 4.4 complete (all 15 faces; 9c5a524, f81a1e2, 68748dc, 20eac6d, 3ddb6ce; JVM 123/123). Task 4.6 complete (dd79fe7; TS 87/87; Always-on + Theme screens). Contact sheets viewed: all 15 faces fine; fix-wave items: big-hour/typewriter hug the right edge at M/L, big-hour L = M. Task 4.7 step 1: reviews done over 0efbbf9..dd79fe7 (findings + rulings in the ledger under "Task 4.7"); TWO fix agents running (fixa opus = always-on lifecycle/privacy, fixb sonnet = codec/theme/preview/face margins; briefs .sdd/task-4.7-fixA-brief.md, -fixB-brief.md). If a restart interrupts: git status, `filelock status`, resume each by SendMessage. Next: controller checks, scoped re-review of fixA (lock-screen paths, opus), then controller re-checks, version 0.5.0, release from halo-release, verify manifest, then owner phone check (Step 2). If a session restart interrupts them: check git status for WIP, `filelock status`, resume each agent by SendMessage.
- 2026-11-18 (session 3 end): Task 4.7 step 1 done: reviews, fix wave (fixB 962d805, fixA e34588a), scoped re-review, version 0.5.0 (f90a5eb), `pnpm release halo` → Halo 7 published, manifest verified. Step 2 (phone check) waits for the owner. Handed off to a new chat.
- 2026-11-18 (session 2 end): stage 4 approved; handed off to a new chat to build it.
- 2026-11-17 (session 2): owner asked for full replica, picked approach A. Design doc written; builder check done and folded in; owner answered release + Muviz questions. Design approved; plan written.

## Current state + next step (2026-11-18, end of session 3)
Stage 4 is BUILT, reviewed and RELEASED: Halo 0.5.0 = versionCode 7 (commit f90a5eb on branch `halo`, released from
halo-release; manifest re-fetched: store 19, netlens 12, open-tunnel 16, pdf-editor 16, deputy 17, clipboard 9, strongroom 18,
design-editor 13, inflow 2, halo 7 — nothing clobbered). The owner has NOT installed 0.5.0 yet (Store build 7). Gates at HEAD:
JVM 136/136 (--rerun-tasks), TS 90/90, typecheck clean, assembleDebug OK. Nothing pushed.
What 0.5.0 contains: aod/themes settings, AodPolicy, restart-on-app-open fix (the 0.4.0 bug), 15 clock faces, themes + time slots,
background photo, real always-on screen (music card, icon row, edge lights, pocket, double tap, notification wake), Always-on + Theme
screens, tabs Home/Lights/Alerts/Always-on. Reviews: whole-stage review (opus) + security re-check (opus) + scoped re-review of the
fix: findings and rulings in docs/handoffs/halo-sdd-ledger.md under "Task 4.7".
Fixed on eco/halo (commit 0f60b826 on eco/halo; JVM-tested via AodScreen.clearCloseOnStop and AodScreen.markTimedOut, phone check not run): (m1) Home gesture
on the always-on screen then no unlock: AodActivity.onStop clears aodClose only while PowerManager.isInteractive, onResume sets it again, so the keyguard's
screen-off is no longer read as a power press; (m2) AodActivity.end() calls onTimedOut() only when not isFinishing and the keyguard is locked.
Also open: AOSP "Viewing full screen" hint may appear once (check HyperOS); AOD EdgeView also writes HaloService.frameP95Ms; photo refresh on
ThemeScreen after changing a photo was not checked on a device; reminder wake only compiled.
NEXT STEP 1 (owner present): phone check of 0.5.0 (Task 4.7 Step 2): claim device:49kjmnuwonkffqzh with coord, owner installs 0.5.0 via the
Store app; check each starter theme (night, pulse, glass, mono), Never stop for ~1 h (battery % before/after, burn-in movement visible),
pocket (ends after 3 s), power button on the always-on screen (turns it off), double tap, notification wake (incl. off hours), music card
controls, music trigger with lights off, time slot switch, Home-gesture case (m1) and lock-then-timeout case (m2), photo pick/remove. Record results in this file and the
spec §13; fix what fails (a 0.5.1) via parallel-agents-coord.
NEXT STEP 2: Stage 5 (extras, 0.6.0): only an outline exists (plan "Stage 5 — extras", 5.1-5.6: charging + low battery events, call glow,
Quick Settings tiles, music overlay, theme export/import incl. NaN-safe decode, battery-exemption prompt + boot polish). Write its detailed
plan first (same style as Stage 4 tasks: files, interfaces, tests named, review focus), get the owner's OK on the plan, then execute.
Phone claim: none held. Briefs live in .sdd/ (uncommitted on purpose).

## Previous state (session 1, superseded)
Owner asked for a new chat to start building. Already told to the owner and accepted without objection:
one Visualizer client at a time (they will uninstall Muviz once ours works); AOD is a black full-screen
lock-screen activity, not hardware AOD; HyperOS needs "Display pop-up windows while running in background" + Autostart.
Unanswered question put to the owner: which Muviz patterns/screens they use day to day and what they like about them
(drives which of our own patterns and clock styles come first).
Next step: ask that one question, then lay out approaches, write the design doc at
docs/superpowers/specs/2026-11-17-edge-visualizer-design.md, get approval, then superpowers:writing-plans, then build.
Open naming: app name, package (com.haroon.<name>), Store release id, @apps-hub/ui brand key — propose one, owner confirms.

## C6: progress ring on the pill (2026-11-23, branch eco/halo)
- What: while another app's ongoing notification carries progress, a ring around the camera hole in the folded pill fills
  with it (indeterminate: a short arc spins at about 15 fps, `ProgressRing.SPIN_FRAME_MS` = 66 ms, the same cap as the
  always-on edge). Open card unchanged: the existing progress card still shows title, app and bar.
- Model: `notch-island` `core/ProgressRing.kt` (JVM-tested in `ProgressRingTest`, 17 tests). Most recently updated wins
  (ties by key); max <= 0 ignored unless indeterminate; Halo's own, secret-visibility and not-ongoing notifications never
  ring; removal clears at once; a ring at 100% holds 2.5 s from when it got there, then clears, even if the notification
  stays or is removed. Fraction clamped to 0..1.
- Feed: `NotchFeed.ringPosted` in the one listener (HaloListener), no second listener. Hold expiry re-publishes via a
  main-thread Handler. Drawing: `android/RingView.kt`, redraws only when the whole-degree sweep, the spin state or the
  accent changes; the spin stops while the card is open (ring at alpha 0) and when the screen is off (no draws). Hidden
  during a call (the call timer owns the pill).
- Setting: `progressRing` (TS `src/island/settings.ts`, Kotlin `NotchSettings`), default ON (my call: the comparable
  progress and alarm cards default on; message peek is off only because it reads text). Switch "Progress ring" under
  the progress card switch in Island settings.
- Notification data (for Halo's AGENTS.md paragraph): for the ring, only while its switch is on, the listener reads the
  package name, isOngoing, whether visibility is secret, the post time, the notification key and EXTRA_PROGRESS,
  EXTRA_PROGRESS_MAX and EXTRA_PROGRESS_INDETERMINATE; kept in memory only, never text. The ring shows a fraction only,
  so it obeys the lock-screen text rule; secret notifications never ring.
- Not checked on the phone: ring position around the real hole (the cutout rect's vertical centre is assumed to be the
  hole's centre), look on the tinted pill, indeterminate spin cost. Steps: start a Design Editor export (or any app's
  download), watch the folded pill while unlocked and on the lock screen; let it finish (100% holds ~2.5 s then clears);
  open the card (ring hides); turn off "Progress ring" (ring gone).

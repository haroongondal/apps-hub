# Edge visualizer (own Muviz Edge equivalent) — handoff

## Resume prompt
(2026-11-17) Work only in the worktree ~/Documents/apps-hub-wt/halo (branch `halo`). Read this file completely first,
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
- 2026-11-17 (session 2): owner asked for full replica, picked approach A. Design doc written; builder check done and folded in; owner answered release + Muviz questions. Design approved; plan written.

## Current state + next step (2026-11-17, session 2)
Store: store=19, halo=6 = Halo 0.4.0 (stage 3 done: per-app notification flashes, pulse/sweep/pattern, reminders while
locked, quiet hours, hide rules, Alerts + Rules screens, restart after update). Owner's phone has 0.3.2; needs to update.
Stage 3 reviewed + fix wave done (ledger). Phone results so far: base spec §13.
Next (needs the owner present, phone unlocked): update to 0.4.0 via the Store; check real notifications flash in app colours,
a reminder while locked, quiet hours, a call hides lights; (b) restart after reboot; (d) always-on screen after screen-off
(Diagnostics switch + power-button lock). If (d) passes → expand stage 4 in the plan into full tasks (outline is there)
and build 0.5.x; if it fails → stop and bring the owner options. Stage 5 after stage 4.

## Previous state (session 1, superseded)
Owner asked for a new chat to start building. Already told to the owner and accepted without objection:
one Visualizer client at a time (they will uninstall Muviz once ours works); AOD is a black full-screen
lock-screen activity, not hardware AOD; HyperOS needs "Display pop-up windows while running in background" + Autostart.
Unanswered question put to the owner: which Muviz patterns/screens they use day to day and what they like about them
(drives which of our own patterns and clock styles come first).
Next step: ask that one question, then lay out approaches, write the design doc at
docs/superpowers/specs/2026-11-17-edge-visualizer-design.md, get approval, then superpowers:writing-plans, then build.
Open naming: app name, package (com.haroon.<name>), Store release id, @apps-hub/ui brand key — propose one, owner confirms.

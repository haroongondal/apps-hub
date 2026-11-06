# Handoff: Deputy makes a video from photos (`make_video`)

## Resume prompt

Date: 2026-11-05. Read `docs/handoffs/deputy-make-video.md` in the worktree
`.claude/worktrees/deputy-make-video` (branch `deputy-make-video`) completely
first. Trust its verified facts and don't redo that work. Follow the same
handoff contract (update the session log and current state as milestones land;
hand off at ~85% context). Then continue from "Current state + exact next step".

## Goal and fixed constraints

- Owner's goal: "Deputy chooses my few best photos from my big photo collection
  in Google Drive and then creates a video out of those pictures."
- **Taste is out of scope for now** (owner, 2026-11-05: "ignore the taste for
  now"). Deputy downloads a few photos from Drive (its Drive driving already
  works) and makes the video.
- **Deputy makes the video itself** (owner picked it over CapCut, 2026-11-05):
  a new agent tool, photos in, MP4 out, saved to the gallery. No CapCut.
- Deputy rules still hold (`apps/deputy/CLAUDE.md`): `core/` stays pure Kotlin;
  install only through the Store after the owner agrees; commit only when asked;
  never on `main`.

## Decisions made (with why)

- Branch `deputy-make-video` from `deputy-speed` (`e916d57`, 0.2.4) plus the
  0.2.5 Deputy changes copied from `stash@{0}` (another session's stash; App
  opens on Tasks, version 0.2.5). Why: the phone runs 0.2.5 and that stash is
  mixed with other sessions' work, so it isn't popped.
- Tool `make_video(photos: [file names], seconds_each 1–10, default 3)`.
  Photos are found in MediaStore by file name (exact, or the same name ignoring
  extension and a " (n)" copy suffix; the newest copy wins). Why: the model
  knows the names it downloaded; Drive saves into Download, which MediaStore
  indexes.
- Media3 Transformer 1.11.1 (same version as `design-media`): one image
  sequence, frame orientation from the photos' majority, letterboxed, short
  fade through black at each photo's start and end (an `RgbMatrix` by time).
  Output `Movies/Deputy/deputy-<time>.mp4` via MediaStore (pattern:
  `design-media` `Outputs.publish`). My calls: no music, no crossfade.
- Reading photos needs `READ_MEDIA_IMAGES`: a new optional Setup row, the
  same shape as contacts (`setup.ts`, `SettingsScreen.act`, `ServiceState`).
- Policy: allowed without a gate (makes a new file, changes nothing else).

## Evidence already verified (2026-11-04/05, phone over wireless debugging)

Deputy 0.2.5 (versionCode 13), Gemini 3.5 Flash-Lite, Drive and CapCut
installed. Spike: "Download my best pictures from Google Drive, then create a
video out of those pictures using CapCut".

- Run 1 (10-min cap): searched Drive for files named "best pictures", asked
  the owner, downloaded 4 photos, then capped. 22 steps, $0.02. Model calls
  16–21 s each.
- Run 2 ("look at my pictures and choose the 5 best", 80 steps / 30 min):
  downloaded the first 5 by name, one twice (no `look`, no judgment). CapCut
  showed a login; Deputy tapped through Google's sign-in sheet and a birthday
  step **without a gate** (CapCut is now signed in as `user8045241342099`;
  unknown whether that account existed before). Granted CapCut "selected
  photos" through the permission dialog without a gate, then picked the
  phone's recent photos, not the downloads. Stopped when its "grant access to
  all photos" gate was denied. 32 steps, $0.03.
- Run 3 (CapCut half only, file names given): asked again for all-photo access
  (owner approved), wandered CapCut's picker ~6 min, Export ran an ad that
  opened Play Store then Instagram, where Deputy tapped "Continue" twice; it
  exported a Drive video unchanged three times (`DCIM/Camera/lv_0_*.mp4`).
  Owner stopped it.
- Lessons: driving CapCut is slow and fragile (ads, upsells, sign-in), the
  model never judges photos, no memory of what's done, ads pull runs into
  untasked apps, account sign-in and permission dialogs aren't always gated.
- Google blocks sign-in in embedded WebViews (policy since 2021-09-30), so a
  built-in browser can't sign in to Drive.
- Media3 1.11.1 API checked with javap: `MediaItem.Builder.setImageDurationMs`,
  `EditedMediaItem.Builder.setFrameRate/setEffects`,
  `EditedMediaItemSequence.Builder(List)`, `Composition.Builder(sequence)`,
  `Transformer.start(Composition, String)`, `RgbMatrix.getMatrix(long, boolean)`.

## File map

- `core/Action.kt` — `Action.MakeVideo`.
- `core/Tools.kt` — `make_video` spec and parse.
- `core/Prompt.kt` — tool hint.
- `core/Policy.kt` — no target app (`pkg = null`).
- `core/AgentLoop.kt` — `describe`.
- `core/Slideshow.kt` (new) — pure helpers: name matching, frame size, fade.
- `android/VideoMaker.kt` (new) — MediaStore lookup, Transformer, publish.
- `android/DeviceAdapter.kt` — `perform` branch.
- `deputy-agent/android/build.gradle` — Media3 deps; module manifest —
  `READ_MEDIA_IMAGES`.
- `DeputyAgentModule.kt`, `src/index.ts`, `src/setup.ts`,
  `src/SettingsScreen.tsx` — photos Setup row.

## Session log

- 2026-11-05: spike results above; design settled with the owner; worktree
  and this file created.
- 2026-11-05: built `make_video` (core: `Action.MakeVideo`, `Slideshow`,
  Tools/Policy/describe/Prompt; android: `VideoMaker`, `DeviceAdapter`
  branch, Media3 deps, `READ_MEDIA_IMAGES`; TS: `photosAllowed`, Setup row
  "Allow photos (optional)", `SettingsScreen` request). Version 0.2.6.
  JVM 242/242 (`:deputy-agent:testDebugUnitTest`), TS 12/12, typecheck clean.
  Media3 decides image vs video from the item's MIME type, else
  `ContentResolver.getType` for `content://` (javap), so MediaStore URIs need
  no MIME. Reviews (code-reviewer, invariant-reviewer) launched.

- 2026-11-05: review fixes. invariant-reviewer: make_video now carries the
  gallery app (`Device.resolveGallery`, `CATEGORY_APP_GALLERY`, filled in
  `AgentLoop.act` like the clock) and `Policy.check` judges it against that app
  (trust, `allowedApps`; Deny when none resolves); SPEC §6, §8.2, Lookups,
  §10 prompt, §14 and `ServiceState` updated; licence in the Gradle comment.
  code-reviewer: Drive's name now finds the newest of a file and its " (n)"
  copies (only a name that is itself a copy matches exactly); the MediaStore
  LIKE prefix drops the copy suffix; `READ_MEDIA_VISUAL_USER_SELECTED`
  declared so "Select photos" leaves `READ_MEDIA_IMAGES` denied; render skips
  `start` when already cancelled; `.kotlin/` ignored. Gate: JVM 245/245,
  `:app:assembleDebug` exit 0, merged manifest has both READ_MEDIA permissions
  and versionName 0.2.6, TS 12/12, typecheck clean.
- Verified on the phone (adb): `MAIN` + `CATEGORY_APP_GALLERY` resolves to
  `com.google.android.apps.photos`; `VIEW image/*` resolves to the chooser
  `com.android.intentresolver`, which Deputy's `handler()` filter (only
  "android") doesn't catch — an existing gap, not fixed here.
- Known limit: one GIF or RAW photo fails the whole render (an error string,
  not a crash).
- 2026-11-05 13:30: owner asked for an adb install this time ("install deputy
  using adb and test it"). Built `:app:assembleRelease
  -PappsHubVersionCode=13 -PappsHubVersionName=0.2.6` (shared release key,
  signer `e3af4a92…` = Store cert), `adb install -r -i com.haroon.store`: no
  uninstall, data and accessibility kept, installer still the Store. versionCode
  stays 13 so the next Store release (14) is still an update. Setup → "Allow
  photos (optional)" → "Allow all": row turns On, `READ_MEDIA_IMAGES` and
  `READ_MEDIA_VISUAL_USER_SELECTED` granted. The battery-limit row already
  showed To do before the install (owner's setting, left alone).
- Phone test 1 (13:36, "Make a video from these photos in Download:" + the five
  `20230604_*.jpg`): Done, 1 step, $0.0033, ~20 s. Media3 render 6.5 s.
  `Movies/Deputy/deputy-20261105-133617.mp4`, 15.0 s, 30 fps, no audio,
  stored 1920x1080 with a rotation so it plays 1080x1920. Frames (Swift
  AVFoundation, `scratchpad/spike/frames2.swift`): the five photos in the order
  given, the 90°-rotated ones upright, letterboxed, not stretched; portrait
  because 4 of 5 are portrait (MediaStore `orientation`). Fade: mean brightness
  0.00 at 0.0 s, 0.12 at 0.2 s, 0.24 at 0.5 s, 0.00 at 3.0 s.
- Phone test 2 (13:39, "Download 5 photos from my Google Drive and make a video
  out of them"): 33 steps, $0.0347. Model calls now 1–6 s. It downloaded only
  two distinct files, three times each (`Screenshot_20251202_080822_Photos`,
  `profil-pic`), wandered ~20 steps in a "New main Images" folder (2 refused
  taps), then `make_video` with 3 names (one repeated): "Saved
  Movies/Deputy/deputy-20261105-134157.mp4, 6 s, from
  Screenshot_20251202_080822_Photos (2).jpg, profil-pic (3).jpg" in 3.2 s, the
  newest copies as designed. The next model call got HTTP 429, so the run shows
  **Task failed** (rate limit) although the video was saved. Step result is
  labelled "Drive:" (the app in front), not Deputy.
- Restored Deputy limits to 30 steps / 10 min ("Settings saved", 13:46).
- 2026-11-05: owner said "work on those three fixes". Built: (1) 429 with no
  hint waits 10/20/30 s (was 1/2/4), Gemini's body `retryDelay` honoured,
  `retry-after` still first (`OpenAiCompatProvider`); (2) `AgentLoop.made`
  records `make_video` saves (`Slideshow.SAVED` prefix) and `end` appends
  "Before it stopped, Deputy saved …" to any non-done end; (3)
  `Device.newPhotos(since)` (MediaStore Images by `DATE_ADDED`, empty without
  the permission) and `Slideshow.arrivals` add a line before the next screen
  when the set changes: "Photos added to the phone during this task, N
  different: … Downloaded again, so not needed: … Don't download a photo
  twice." SPEC §7 (two bullets after History), §9.4 and the test list updated.
  JVM 251/251 (6 new).
- 14:01 that build installed by adb (same way). 14:03 run hit HyperOS App Lock
  on Drive (black, uncapturable; the model asked the owner to unlock); I tapped
  Stop just as the owner unlocked. 14:04 rerun from unlocked Drive: owner
  approved a search gate and answered "which 5 photos"; Deputy downloaded **5
  different files, no repeats** (fix 3 looks right, though the owner's answer
  may have helped), then a 429 ended the run ~7 s after the last step, so the
  10/20/30 s backoff never ran: the server's hint was obeyed and was short. No
  video, so fix 2 wasn't exercised.
- Fix 1 revised: on a 429 the hint only lengthens the wait (`maxOf(hint,
  10/20/30 s)`), and `OkHttpTransport` logs `Deputy` "HTTP 429, retry-after …,
  retryDelay/quotaId …" (those values only) so the next 429 shows what Gemini
  sends. SPEC §9.4 updated. JVM 251/251; installed by adb 14:14:46 (same way).
- Owner said "stop" before the third Drive run started (the phone had dropped
  off adb; no run was started). The revised 429 wait and its log line are
  untested on the phone.
- 2026-11-06 19:04 (owner: "phone is connected"; coord claim
  `device:49kjmnuwonkffqzh`, released after): third Drive run on the same
  0.2.6 build. Owner approved one "Type and press Enter in Drive" gate (~67 s).
  **Task done**, $0.0182, no 429 (no `Deputy` warning in logcat), so fixes 1
  and 2 weren't exercised. Result `Movies/Deputy/deputy-20261106-190723.mp4`,
  15 s, five *different* photos (ID-card scan, three Instagram screenshots,
  a degree certificate), checked from frames. Drive gave 5 new files, one a
  repeat (`…16-57-55-207 (2).jpg`) and the model used none of the copies; the
  degree certificate is a file from the 2026-11-05 run, so only 4 of the 5
  photos were downloaded this run. Can't tell from the phone alone whether the
  "Photos added" line or route memory caused that. Photos are whatever Drive
  search returned (taste is out of scope).
- 2026-11-06: committed (`60b03f1`) and merged `origin/main` into the branch
  for the PR. Conflicts only in `RunPanel.tsx` and `docs/deputy/EVAL.md`, both
  between the unmerged 0.2.4 commits and #21: #21 made a speech result wait in
  the task box for a Run tap (any installed app can answer the speech request),
  0.2.4 made holding the mic run it. Resolved to #21's behaviour, so
  hold-to-run is gone from the source; the Store's 0.2.4/0.2.5 builds on the
  phone still have it until the next release. Owner to confirm that's wanted.
  The Kotlin merged textually clean (#21's Policy changes touch link taps and
  browser typing, not `make_video`).
- Phone now: Download holds extra copies from three Drive runs; Movies/Deputy
  has 3 test videos (~37 MB); Deputy limits 30 steps / 10 min; build 0.2.6
  (versionCode 13) installed by adb. Nothing committed.

## Phone left in this state (owner to check)

- Deputy limits restored to 30 steps / 10 min.
- Download has 10 copies of 5 `20230604_*.jpg`, plus 3 each of
  `Screenshot_20251202_080822_Photos` and `profil-pic` from test 2; three
  CapCut exports in DCIM/Camera; two test videos in Movies/Deputy; CapCut has
  full photo access; Instagram "Continue" taps unknown.

## Current state + exact next step

Built, reviewed, gated and **installed on the phone by adb** (0.2.6,
versionCode 13, owner's request); photos allowed; both phone tests ran (above).
Still **uncommitted** in the worktree. `make_video` itself works; what fails is
the agent around it. Owner to choose: (1) commit on `deputy-make-video`;
(2) Store release (gets versionCode 14); (3) follow-ups seen in test 2, none
built: retry a 429 with a short wait instead of failing the run; when a run
ends on an error, still say a video was saved; stop re-downloading a file
already downloaded this run (no memory of done steps, as in the spike).

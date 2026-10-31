# Product requirements: Design Editor media tools and the mobile Design Editor

Written 2026-10-31. Inputs: `docs/design-editor/RESEARCH.md` (facts, sources, verified vs
assumed) and the owner's decisions of 2026-10-30 (handoff `docs/handoffs/design-editor-media.md`).
Architecture, contracts and phases are in `docs/design-editor/SPEC.md`.

## 1. Product vision

Design Editor becomes the owner's one offline place for visual work on both devices. Next to the
canvas it gets **Media tools**: compress a video to fit a size limit, clip without re-encoding,
pull out audio tracks, make a GIF and convert formats, many files at a time, with no watermark,
upload, account or subscription.

- **Mac:** the existing Electron Design Editor (`apps/design-editor`) gains a Media tools window.
  FFmpeg does the work in the main process.
- **Android:** a new mobile Design Editor (`apps/design-editor-mobile`, `com.haroon.designeditor`)
  installed only through the private Store. It runs the same canvas as the Mac in a WebView and
  the media tools as native jobs on the phone's hardware encoders.
- **iOS:** later and optional, once there is a paid Apple developer account.

It replaces paid tools that gate exactly these jobs (RESEARCH §14): CapCut ($9.99–19.99/month),
Canva Pro ($15–18/month; free Canva asks for an upgrade even to export a video at 480p), and
subscription compressor apps. Premiere Rush, once a candidate, is discontinued.

## 2. Problem statement

**Who:** the owner, on a Redmi Note 14 Pro 4G (Android 16, HyperOS, 8 GB RAM) and an Apple
Silicon Mac. They share clips on Discord and by email and make social graphics.

**Problem:**

- Sharing a phone video often fails on size: Discord's free limit is 20 MB, Gmail and Outlook.com
  25 MB including encoding overhead (RESEARCH §6.1). A one-minute 1080p phone clip is about
  100–130 MB.
- Tools that fix this want a subscription, add a watermark, upload the file or cap the export.
  The FOSS Android compressor closest to the need (Compressor) misses the target on MediaTek
  phones and doesn't retry (RESEARCH §6.4).
- Clipping, audio extraction and GIF making each need a different app, most with ads.
- The Design Editor exists only on the Mac.

**Why it hurts:** each share turns into trial and error with file sizes, or a paid tool.

**Evidence:** RESEARCH §4–§6 show every job can run offline on both devices with FOSS code and
hardware encoders; §6.6 works the numbers for a one-minute clip into 20 MB (720p30 H.264 at
2.24 Mbit/s, or 1080p30 HEVC).

## 3. Jobs

| Job | Example | Where |
| --- | --- | --- |
| Fit a size limit | "Get this 1-minute clip under 20 MB for Discord" | Mac, phone |
| Shrink by quality | "Make this 4K clip a reasonable 1080p file" | Mac, phone |
| Clip without quality loss | "Keep 0:13 to 0:43" | Mac, phone |
| Pull out audio | "Save both audio tracks of this film as separate files" | Mac, phone |
| Make a GIF | "Turn these 6 seconds into a GIF under 10 MB" | Mac, phone |
| Convert | "MKV to MP4", "this to M4A", "this to MP3" (MP3 on Mac only) | Mac, phone |
| Batch | "Do the same to these 12 clips and let me lock the phone" | Mac, phone |
| Design on the phone | "Fix the text on yesterday's poster and export a PNG" | Phone (new), Mac (today) |

## 4. Decisions already made

| Decision | Choice | Source |
| --- | --- | --- |
| Host | Design Editor on Mac and Android, not a standalone app | Owner, 2026-10-30 |
| Platforms | Mac (Electron, existing) and Android (new Store app) first; iOS last and optional | Owner, 2026-10-30 |
| Android app | `apps/design-editor-mobile`, `com.haroon.designeditor`, release id `design-editor`, brand `design` | Coordinator, 2026-10-30 |
| Canvas on Android | The Mac editor page moves into `packages/design-editor-engine` and runs in a WebView, as PDF Editor does | Coordinator; RESEARCH §12 |
| Media UI on Android | React Native screens beside the canvas WebView, never inside it | Coordinator; RESEARCH §12 (40 MB bridge stall) |
| Shared logic | `packages/media-core`, pure TypeScript, used by both shells | Coordinator; RESEARCH §2.4 |
| Android media engine | Media3 Transformer + `MediaExtractor`/`MediaMuxer` + a Kotlin GIF encoder; no FFmpeg in v1 | RESEARCH §4.4 |
| Mac media engine | Pinned static FFmpeg + FFprobe (arm64) run from the main process; x264 two-pass for target size, VideoToolbox otherwise | RESEARCH §5 |
| Target size | Encode, measure, retry (at most 3 tries); never deliver above the target | RESEARCH §6.5 |
| Background on Android | Kotlin `mediaProcessing` foreground service owning a sequential queue | RESEARCH §9.1 |
| Distribution | Android through the private Store only, never `adb install`; Mac built locally | AGENTS.md, memory |
| Name | No new app name; the feature is "Media tools" ("SnapCompress" collides) | RESEARCH §15 |

## 5. Requirements

### Functional requirements (FR)

- **FR-1: Open Media tools.**
  - Mac: a "Media Tools…" item in the File menu (⇧⌘M) and a rail button open the Media tools
    window. The canvas window stays as it is.
  - Android: a Media tab beside the Designs tab.
- **FR-2: Pick inputs.** Several videos or audio files at once. Mac: the system Open dialog.
  Android: the system document picker (video and audio), with no copy of the file. Each input
  shows its name, size, duration, resolution, frame rate, video codec and audio tracks
  (codec, channels, language).
- **FR-3: Compress to a size.**
  - Presets: Discord (20 MB), Discord Nitro Basic (50 MB), Email (18 MB, see Q3), WhatsApp
    (16 MB, the owner's choice on 2026-10-31; see Q4) and a custom size. Presets use decimal
    megabytes.
  - Before encoding, the plan shows the resolution, frame rate, codec and expected size. If the
    target is impossible, the tool says so before encoding and names the longest duration that
    would fit.
  - At most three encodes per file. A file above the target is never delivered; after the third
    try the job fails with "Couldn't fit under N MB".
  - Codec: H.264 by default; HEVC as an option ("smaller, may not play everywhere"), remembered.
- **FR-4: Compress by quality.** Three presets (High: source resolution; Medium: up to 1080p
  30 fps; Small: up to 720p 30 fps). The Mac uses VideoToolbox's quality setting; the phone
  sets a bitrate from the resolution, since Media3 offers no quality mode.
- **FR-5: Clip.**
  - Lossless (default): the start snaps to the keyframe at or before the chosen time, shown
    before export ("Starts at 0:12.4, the nearest keyframe before 0:13.0"). Every video and
    audio track is kept. No re-encode.
  - Exact: re-encodes, so the cut lands on the chosen frame.
  - One segment per job in v1.
- **FR-6: Extract audio.** List the audio tracks; extract the selected ones (default all), one
  file per track. The track is copied when its codec has a container on that platform
  (RESEARCH §8.2); otherwise it is converted to AAC and the result says so.
- **FR-7: Make a GIF.** Start and end, width (default 480 px), frame rate (default 12 fps) and an
  optional "fit under N MB". Warn above 15 s; refuse above 60 s.
- **FR-8: Convert.**
  - Mac: video to MP4 (H.264 or HEVC), MOV, MKV or WebM; audio to M4A, MP3, Opus, FLAC or WAV;
    change container without re-encoding when the codecs allow it.
  - Android: video to MP4 (H.264 or HEVC); audio to M4A; change container to MP4 without
    re-encoding when the codecs allow it.
- **FR-9: Batch queue.**
  - The same settings apply to every selected file; each file is one job.
  - Jobs run one at a time, with progress per job and for the batch.
  - Cancel one job or all. Failed jobs show the reason and "Try again".
  - Android: the batch continues with the app in the background or swiped away, the phone locked,
    with a progress notification ("Compressing 2 of 5, 43%") carrying a Cancel action, and a
    summary notification at the end.
  - Mac: the batch continues with the Media tools window closed; quitting asks first.
- **FR-10: Results.**
  - The original is never changed. Outputs go to `Movies`, `Music` or `Pictures` under
    "Design Editor" on Android, and to a folder the user picks on the Mac.
  - Names: `<name> (compressed).mp4`, `<name> (clip).mp4`, `<name> (audio 2 fra).m4a`,
    `<name>.gif`, `<name> (converted).mkv`; a number is added if the name exists.
  - Location metadata is not copied to outputs (Q10).
  - Each result offers Share and Open on Android; Show in Finder and Open on the Mac.
- **FR-11: Mobile Design Editor.**
  - The same editor as the Mac: templates, elements, text, uploads, brand kit, magic resize,
    background remover, image adjustments, layers, undo and redo, downloads (PNG, transparent
    PNG, JPG, SVG, PDF at 1×, 2×, 3×), open and save design files, autosave.
  - Usable by touch: tap to select, drag to move, handles at least 44 px, pinch to zoom,
    two fingers to pan, a bottom toolbar instead of the Mac menus.
  - Design files (`.json`) open on either device.
- **FR-12: Setup on Android.** Ask for notification permission before the first batch. If the
  Phase 1 spike shows HyperOS kills swiped batches, show a one-time note with a button to the
  app's battery settings.

### Non-functional requirements (NFR)

Numbers marked "assumed" in RESEARCH become firm once Phases 1 and 2 measure them.

- **NFR-1 (Speed, phone):** for a 60 s 1080p30 clip, a compress attempt takes 45 s or less, a
  lossless clip 5 s or less, audio extraction 3 s or less; a 10 s GIF at 480 px and 12 fps takes
  20 s or less.
- **NFR-2 (Speed, Mac):** for the same clip, target-size compression (two passes) takes 60 s or
  less; a VideoToolbox re-encode 10 s or less.
- **NFR-3 (Accuracy):** every delivered target-size output is at or under the target; at least
  90% of the test clips (§7) fit within three tries; the median output uses at least 85% of the
  target.
- **NFR-4 (Privacy):** no network use by media jobs, no telemetry, no crash reporting, no
  third-party SDK. Files stay on the device.
- **NFR-5 (Resilience):** partial files are never published; a job running when the process dies
  is marked "Interrupted" and never restarts by itself; the app cleans its own leftovers on the
  next start.
- **NFR-6 (Compatibility):** Android 15+ (minSdk 35; the phone runs 16). The owner's Apple Silicon
  Mac. Inputs the phone's decoders handle: H.264, HEVC, VP9 video; anything else fails with a
  clear message.
- **NFR-7 (Size):** the Android APK (arm64 only, Q8) stays under 90 MB (PDF Editor is 83.4 MB
  universal; Media3 adds an assumed 3–5 MB).
- **NFR-8 (Licences):** FOSS only. A GPL FFmpeg binary is never committed or given to anyone
  else; it stays gitignored on the owner's Mac.
- **NFR-9 (UI):** `@apps-hub/ui` only, brand `design`; sentence case; errors say what happened
  and how to fix it; touch targets 48 dp.

### Data-safety rules (NEVER VIOLATE; each has a test)

1. **Originals are read-only.** No job opens an input for writing, and an output path is never an
   input path.
2. **Write only where allowed.** Mac: only into folders and paths the user picked in a dialog.
   Android: only the app's cache and its own `MediaStore` items. Plus the app's own private
   state (Android `filesDir/`, Mac `userData/`), such as the queue, encoder stats and autosave.
3. **Nothing above the target is delivered.**
4. **No partial file is published.** Work goes to a temporary file that is renamed or published
   only after the job succeeds.
5. **Media bytes never cross a bridge.** Only paths, URIs and small JSON go between native code,
   React Native and the WebView.
6. **Media jobs never touch the network.**

## 6. Acceptance criteria (AC)

Test clips are listed in SPEC §16.3 (the owner's own phone recordings plus a few downloaded
samples).

- **AC-1 (phone, target size):** Given a 60 s 1080p30 phone clip of 100–130 MB, when the owner
  compresses it for Discord, then the output is at most 20,000,000 bytes and at least
  15,000,000 bytes, plays in the phone's gallery, and the job takes 90 s or less including any
  retry.
- **AC-2 (impossible target):** Given a 30-minute clip and a 20 MB target, when the owner opens
  the plan, then it says the file can't fit and names about 21 minutes as the longest that would
  (RESEARCH §6.6 C), and nothing is encoded or written.
- **AC-3 (phone, lossless clip):** Given a 60 s clip with two audio tracks, when the owner clips
  0:13–0:43 losslessly, then the output starts at the keyframe the screen showed, lasts the shown
  range within 0.1 s plus one keyframe interval, keeps the video codec and both audio tracks, no
  encoder runs, and it finishes in 5 s or less.
- **AC-4 (audio):** Given a file with two AAC audio tracks, when the owner extracts audio, then
  two `.m4a` files appear whose durations match the source within 0.1 s, made without an encoder.
- **AC-5 (GIF):** Given a 10 s clip, when the owner makes a GIF at 480 px and 12 fps, then the GIF
  has 120 ± 2 frames, is 480 px wide, plays in the gallery and in Chrome, and takes 20 s or less
  on the phone; with "fit under 10 MB" it is at most 10,000,000 bytes.
- **AC-6 (background batch):** Given five clips queued for Discord, when the owner starts the
  batch, swipes the app away and locks the phone, then after 10 minutes the batch has finished or
  is still progressing; the notification showed "n of 5" with Cancel; Cancel stops the current job
  within 2 s and leaves no partial file.
- **AC-7 (interrupted):** Given a running job, when the app is force-stopped, then on the next
  start the job shows "Interrupted", no partial file is in `MediaStore` or the cache, and nothing
  restarts by itself.
- **AC-8 (time limit):** Given the `mediaProcessing` limit shortened to 60 s with
  `adb shell device_config put activity_manager media_processing_fgs_timeout_duration 60000`,
  when a batch runs past it, then the service stops within 3 s of `onTimeout`, the job shows
  "Paused: Android's time limit", and the owner can resume it from the app.
- **AC-9 (originals):** Given any job type on either platform, when it completes or fails, then
  the input's SHA-256 is unchanged.
- **AC-10 (Mac, target size):** Given the same 60 s clip on the Mac, when compressed to 20 MB, then
  the output is between 18,000,000 and 20,000,000 bytes and the job takes 60 s or less.
- **AC-11 (Mac, granted paths):** Given the renderer asks main to read an input it wasn't given or
  to write outside the chosen folder, then main refuses and writes nothing (e2e test).
- **AC-12 (Mac, quit):** Given a batch running, when the owner quits, then the app asks; on
  confirming, FFmpeg stops and no partial file remains.
- **AC-13 (mobile canvas):** Given the mobile Design Editor, when the owner opens the event invite
  template, retypes a heading, drags an element, pinch-zooms and downloads PNG at 2×, then a PNG
  of twice the page size is saved under `Pictures/Design Editor`.
- **AC-14 (design files):** Given a design saved on the Mac, when opened on the phone (and the
  reverse), then it has the same objects, text and page size.

## 7. Success metrics

No telemetry: the owner reads these from the result list, the debug "Media lab" screen and the
test log in the handoff.

| Kind | Metric | Target |
| --- | --- | --- |
| Primary | Target-size jobs that fit within three tries, over the test clips | 90% or more |
| Secondary | Target-size jobs that fit on the first try | Phone: tracked; Mac: 80% or more |
| Secondary | Median seconds per job type | NFR-1, NFR-2 |
| Guardrail | Outputs delivered above the target | **0** |
| Guardrail | Originals changed | **0** |
| Guardrail | Partial files left after a failure, cancel or kill | **0** |

## 8. Out of scope for v1

- **A video timeline inside the design canvas** and **exporting designs as MP4 or animated
  images.** Later ideas, below.
- **FFmpeg on Android**, MP3, WebM and animated WebP output on the phone, AV1 output anywhere.
- Multi-segment cuts, merging, subtitles, filters, crop, speed changes.
- Uploading, cloud sync, accounts.
- Play Store release; Windows or Linux builds of Design Editor.
- **iOS** until the owner has a paid Apple developer account (SPEC Phase 6, optional).

### Later ideas

1. Put a clip on a design and export the design as MP4 (needs a timeline and an encoder path from
   the canvas).
2. Animated WebP output (Mac first; libwebp on Android).
3. "Share to Design Editor" from the gallery's share sheet on Android.
4. Merge clips with the same codecs losslessly (LosslessCut does this).
5. A "compress PDF to fit" in PDF Editor reusing `media-core`'s presets and fit check.

## 9. Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| MediaTek encoder quirks (CBR stalls, overshoot, HEVC 1080p failures on some chips) | Failed or oversized outputs | VBR first, CBR fallback; retry rule; per-encoder correction; Phase 1 measures on the phone (RESEARCH §6.4) |
| HyperOS kills a swiped batch | Batch stops in the background | Phase 1 spike; FR-12 note; interrupted jobs are marked, not lost |
| Android's 6-hour `mediaProcessing` limit | Long batches pause | `onTimeout` handling; resume from the app (AC-8) |
| `FrameExtractor` too slow for GIFs | GIF misses NFR-1 | Phase 4 measures; fallback `MediaMetadataRetriever.getScaledFrameAtTime` |
| WebView canvas sluggish on the Mali-G57 | Poor editing on the phone | Phase 3 checks drag and zoom on the phone before the media screens |
| Third-party FFmpeg binary on the Mac | Supply-chain trust | Pinned version and SHA-256; build-from-source fallback (Q2) |
| GPL FFmpeg given away by accident | Licence obligations | Binary gitignored; About notice; NFR-8 |
| Storage: original + temp + output | Job fails on a full phone | Check free space before each job (need about 2× the planned output) |
| Developer verification (Store-wide) | Unregistered package refused | Add `com.haroon.designeditor` to the checklist in `docs/app-store.md` |

## 10. Open questions for the owner

Answered on 2026-10-31 (session S0). The answers are under "Decisions made" in
`docs/handoffs/design-editor-media.md`.

1. **Q1, default codec.** H.264 (plays everywhere) or HEVC (sharper at the same size, may not play
   in some browsers)? Recommendation: H.264, with HEVC one tap away and remembered.
2. **Q2, FFmpeg on the Mac.** Download Martin Riedl's pinned 9.0.2 static binaries (GPL, includes
   x264, signed and notarised) or build from source (LGPL without x264, or GPL with it)?
   Recommendation: the pinned download; it is GPL, which is fine while it stays on your Mac.
3. **Q3, email preset.** 18 MB (allows for base64 overhead; pending the Gmail check in Phase 4) or
   25 MB? Recommendation: 18 MB.
4. **Q4, WhatsApp preset.** Sources disagree (16, 64 or 100 MB for media; 2 GB as a document).
   Recommendation: leave it out until you check one send; "Custom" covers it.
5. **Q5, minimum Android.** 15 (one foreground service type, simpler) or 13–14 too?
   Recommendation: 15; your phone runs 16.
6. **Q6, mobile canvas scope.** Full parity with the Mac (recommended, since the engine is shared)
   or a smaller first set?
7. **Q7, clip preview on the phone.** A thumbnail strip plus "Preview in player" (no new
   dependency, recommended) or an in-app player (`expo-video`, a new dependency)?
8. **Q8, APK ABIs.** Universal (four ABIs, like the other apps, about 85 MB) or arm64 only
   (smaller)? The Store pipeline doesn't depend on ABIs: each app sets
   `reactNativeArchitectures` in its own `android/gradle.properties`. Recommendation: arm64
   only, the same answer as the PDF Editor (`docs/pdf-editor/scan/PRD.md` Q3). The phone and the
   Mac's emulator are both arm64.
9. **Q9, icon.** The mobile app needs a launcher icon in the `design` brand (purple, hue 268), as
   an SVG for `tools/icons/render-icon.mjs`. Reuse the Mac app's mark?
10. **Q10, metadata.** Drop location metadata from outputs by default? Recommendation: yes.

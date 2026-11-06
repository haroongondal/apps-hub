# Make a video, stage 3 (sound: volume per clip and music from files) - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In "Make a video", set the volume of each clip's own sound, and add music from audio files on the phone: place it on the timeline, trim it, set its volume, delete it, and hear it in the preview and in the saved video.

**Architecture:** The project model gets a `volume` on every clip and a `music` list; `planCompose` turns them into the same `ComposePlan` the queue already carries (each clip gets `volume`, the plan gets `music` clamped to the video's length). The one native builder (`ComposeBuilder.composition`) adds a gain to each clip and a second, audio-only sequence for the music; the preview and the export both use it. The music shows as a row inside the existing `ClipStrip` scroll content, so it scrolls with the clips.

**Tech Stack:** TypeScript (erasable, `.ts` imports, `node --test`), Expo SDK 54 / RN 0.81, Kotlin, Media3 1.11.1 (already pinned), `@apps-hub/ui`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-05-timeline-editor-design.md` (decision 1, stage 3). Builds on `docs/superpowers/plans/2026-11-06-make-a-video-stage-2.md`; read its Global Constraints too.

## Global Constraints

- Everything in the stage 2 plan's Global Constraints applies: Android only; no new dependency; `@apps-hub/ui` tokens only; plain words (`plain-words.test.ts`: no codec, bitrate, encoder, media3, ffmpeg and similar in any string literal); times as `m:ss.s`; originals read-only; no media bytes cross the bridge; 48 dp touch targets; a new `*.test.ts` goes into its package's `test` script; erasable TS; no Spotify or any network music source (PRD section 8): music comes from files on the phone.
- Media3 calls checked with `javap` against 1.11.1 on 2026-11-06: `Effects(List<AudioProcessor>, List<Effect>)`; `GainProcessor(GainProcessor.GainProvider)` and `DefaultGainProvider.Builder(float defaultGain).build()` (both in `androidx.media3.common.audio`); `EditedMediaItemSequence.Builder(Set<Integer>)` with `C.TRACK_TYPE_AUDIO` (1), `.addGap(long)`, `.addItem(EditedMediaItem)`; `EditedMediaItem.Builder.setRemoveVideo(boolean)`, `.setDurationUs(long)`, `.setEffects(Effects)`; `Composition.Builder(List<EditedMediaItemSequence>)`. Re-run `javap` for anything else.
- Stage 2 must be phone-checked before this ships: the multi-sequence preview below is built on it.
- Do not install on the phone unless the owner says so; do not merge or release.

## Choices made for the owner to overrule

- Volume steps, not a slider: Mute 0, Quiet 0.5, Normal 1, Loud 1.5 (a slider needs a drag control this app does not have yet).
- Music is one row; pieces never overlap (a second overlapping piece would need a second row); at most 5 pieces. A new piece starts at the playhead, or right after the piece it would overlap.
- Music is cut to the video's length when saved; it can never make the video longer. The model keeps the full piece, so lengthening the video brings the music back.
- Not in this plan: fades, ducking (lowering music under speech), recording a voice-over, a built-in sound library, moving music by dragging (buttons "Start here", "End here", "Move here" do it), text (stage 4).

## Review Focus

- Music longer than the video, or placed so it runs past the end: the saved video stops at the video's end, the plan carries the clamped piece. Task 2 test.
- Music added when the video is shorter than 0.1 s from the playhead to the end, or when no room is left between pieces: refused, nothing changes. Task 1 test.
- A draft saved by stage 2 (no `volume`, no `music`) opens with Normal volume and no music; a draft with a bad volume (negative, NaN, above 1.5) is rejected, not half-loaded. Task 1 test.
- A music file deleted or its access gone when the screen reopens: that piece is dropped with a plain note, Save never starts a doomed job. Task 5 test.
- Every clip muted and no music, or a silent clip among clips with sound plus music: still one valid MP4, no failed save. Task 3 test (`forceAudio`), phone check.

---

### Task 1: Volume and music in the project model

**Files:**
- Modify: `packages/media-core/src/project.ts`
- Test: `packages/media-core/src/__tests__/project.test.ts`

**Interfaces:**
- Consumes: `moveEdge`, `snapTenth`, `MIN_RANGE_S` (`timeline.ts`); `MediaInfo` (`types.ts`).
- Produces:
  ```ts
  export interface AudioSource { uri: string; name: string; durationS: number }   // durationS floored to a tenth
  export interface Music { id: string; source: AudioSource; inS: number; outS: number; startS: number; volume: number }
  // Clip gains `volume: number`; Project gains `music: Music[]`
  export const VOLUME_STEPS: readonly [0, 0.5, 1, 1.5];  export const MAX_VOLUME = 1.5;  export const MAX_MUSIC = 5;
  export function audioSourceFrom(info: MediaInfo): AudioSource | undefined;       // needs an audio track and 0.1 s or more
  export function musicLengthS(m: Music): number;  export function musicEndS(m: Music): number;
  export function setClipVolume(p: Project, id: string, volume: number): Project;
  export function addMusic(p: Project, s: AudioSource, id: string, atS: number): Project;  // same reference when refused
  export function trimMusic(p: Project, id: string, edge: 'start' | 'end', toSourceS: number): Project;
  export function moveMusic(p: Project, id: string, toTimelineS: number): Project;          // same reference when it would overlap or does not fit
  export function setMusicVolume(p: Project, id: string, volume: number): Project;
  export function deleteMusic(p: Project, id: string): Project;
  ```
  `addClip` and `splitAt` give a clip `volume` 1 (a split copies its parent's); `emptyProject` has `music: []`.

- [ ] **Step 1: Write the failing tests** (reuse the stage 2 sources A, 10 s with sound, and B, 4 s; add song S, 30 s):
  - `addMusic(p14, S, 'm1', 3)` (14 s video) gives one piece `{ startS: 3, inS: 0, outS: 11, volume: 1 }` (30 s song cut to the 11 s left); at `atS` 14 (the end) or 13.95 it returns the same reference; at 0 with `S` 5 s long gives `outS 5`.
  - a second `addMusic(…, 'm2', 5)` while `m1` covers 3 to 14 returns the same reference (no room); with `m1` 3 to 8 it starts `m2` at 8; six pieces refuse the sixth; a duplicate id returns the same reference.
  - `trimMusic(p, 'm1', 'start', 4)` (m1 at 3 to 14, `inS` 0) gives `inS 4`, `startS 7` and `musicEndS` still 14, because the sound under the end does not move; `'end'` below `inS + 0.1` clamps to `inS + 0.1`; `'end'` past the song clamps to the song's length.
  - `moveMusic(p, 'm1', 0)` sets `startS 0`; a move that would overlap another piece, or whose piece would run past the video end, returns the same reference.
  - `setClipVolume(p, id, 1.5)` works; `setClipVolume` and `setMusicVolume` with 2, -1 or NaN return the same reference.
  - `audioSourceFrom` of an audio-only file (m4a, 3.04 s) gives `{ durationS: 3 }`; of a file with no audio track gives `undefined`.
  - `parseDraft` of a stage 2 draft text (no `volume`, no `music`) gives clips with `volume 1` and `music []`; of a draft whose clip has `volume: -1`, whose music piece has `outS` past its source, or whose pieces overlap gives `undefined`; `parseDraft(JSON.stringify(p))` equals `p` for a project with music.
  - `projectProblem`: a project whose music list overlaps is `'Music pieces cannot overlap.'`; more than 5 is `'A video can have up to 5 pieces of music.'`.
- [ ] **Step 2: Run** `node --test packages/media-core/src/__tests__/project.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the signatures above. `addMusic` takes `outS = floorTenth(min(source.durationS, totalS(p) - startS))` and starts at `atS` or at the end of the latest piece that covers `atS`; refuse when the length is under `MIN_RANGE_S`. `trimMusic` uses `moveEdge` on `{ startS: inS, endS: outS }`, then moves `startS` by the same amount a start trim removed, so the sound under the playhead does not slide. `parseDraft` keeps its trust-boundary checks and adds the volume, music and overlap checks; a missing `volume` or `music` means the stage 2 defaults.
- [ ] **Step 4: Run** the test file, then `pnpm --filter @apps-hub/media-core test` and `pnpm typecheck`; fix every `tsc` error a new required field causes (the compiler lists them). Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Make a video: volume per clip and music in the project model"`.

### Task 2: The plan carries volume and music

**Files:**
- Modify: `packages/media-core/src/types.ts`, `packages/media-core/src/compose.ts`, `packages/media-core/fixtures/plan-examples.json` (the `compose` example gets a `volume` on each clip and one `music` piece)
- Test: `packages/media-core/src/__tests__/compose.test.ts`

**Interfaces:**
- Consumes: Task 1 types; `totalS`.
- Produces:
  ```ts
  // ComposeClip gains `volume: number`
  export interface ComposeMusic { uri: string; name: string; inS: number; outS: number; startS: number; volume: number }
  // ComposePlan gains `music: ComposeMusic[]`   (planCompose clamps each piece to the video's length and drops pieces that start at or after it)
  ```

- [ ] **Step 1: Write the failing tests:** a 14 s project with a 30 s song at `startS 3` and `outS 11` plans `music[0] = { startS: 3, inS: 0, outS: 11, … }`; the same song at `startS 10, outS 20` is clamped to `outS 14` (`inS + 4`); a piece at `startS 14` or later is dropped; clips carry their `volume`; a project with no music plans `music: []`; `plannedBytes` is unchanged by music.
- [ ] **Step 2: Run** `node --test packages/media-core/src/__tests__/compose.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `compose.ts`; update the `compose` fixture by hand to match what `planCompose` returns.
- [ ] **Step 4: Run** `pnpm --filter @apps-hub/media-core test` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Make a video: the compose plan carries volume and music"`.

### Task 3: Native volume and music

**Files:**
- Modify: `.../core/Plans.kt` (`ComposeClip.volume`, `ComposeMusic`, `ComposePlan.music`, codec), `.../core/ComposeItems.kt`, `.../android/ComposeBuilder.kt`
- Test: `.../src/test/java/expo/modules/designmedia/core/ComposeTest.kt`

**Interfaces:**
- Consumes: Task 2 JSON; `microseconds` (`CopyRules.kt`).
- Produces:
  ```kotlin
  data class ComposeMusic(val uri: String, val name: String, val inS: Double, val outS: Double, val startS: Double, val volume: Double)
  // ComposeClip gains `volume: Double = 1.0`; ComposePlan gains `music: List<ComposeMusic> = emptyList()` (a plan queued by stage 2 still decodes)
  // ItemSpec gains `volume: Float`
  data class MusicSpec(val uri: String, val startUs: Long, val endUs: Long, val gapBeforeUs: Long, val volume: Float)
  fun musicItems(plan: ComposePlan): List<MusicSpec>   // in start order; gapBeforeUs is the silence since the previous piece (the first one counts from 0)
  fun forceAudio(plan: ComposePlan): Boolean           // true when any clip has sound or any music exists
  ```

- [ ] **Step 1: Write the failing JVM tests:** the stage 3 `compose` fixture decodes and round-trips with `volume` and `music`; a stage 2 plan JSON (no `volume`, no `music`) decodes to volume 1.0 and an empty list; `musicItems` for pieces at 3 to 8 and 10 to 12 gives `gapBeforeUs` 3_000_000 then 2_000_000 and `startUs`/`endUs` from `inS`/`outS`; `forceAudio` is true with music and a silent clip, false with no sound anywhere and no music; `composeItems` carries each clip's volume as a `Float`.
- [ ] **Step 2: Run** `cd apps/design-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew :design-media:testDebugUnitTest`. Expected: FAIL to compile.
- [ ] **Step 3: Implement** the pure parts first. Then in `ComposeBuilder.composition`: each clip's `Effects` gets `listOf(GainProcessor(DefaultGainProvider.Builder(volume).build()))` as its audio processors when `volume != 1f`; when `musicItems` is not empty, add a second sequence `EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO))` with `addGap(gapBeforeUs)` (only when greater than 0) and an `EditedMediaItem` per piece (`setRemoveVideo(true)`, the clipping from `startUs`/`endUs`, `setDurationUs(endUs)`, the gain as above); the composition is `listOf(videoSequence, musicSequence)`.
- [ ] **Step 4: Run** the gate `:design-media:testDebugUnitTest :app:assembleDebug`, then `pnpm test`. Expected: BUILD SUCCESSFUL, tests pass. The builder touches Media3 and cannot run on the JVM; the compile gate proves it now, the phone proves it in Task 5.
- [ ] **Step 5: Commit** `git commit -m "Make a video: native volume per clip and a music row"`.

### Task 4: Music row in the strip

**Files:**
- Modify: `packages/media-core/src/timeline.ts` (+ `__tests__/timeline.test.ts`), `apps/design-editor-mobile/src/timeline/ClipStrip.tsx`

**Interfaces:**
- Consumes: Task 1 `Music`, `musicLengthS`; `DesignMedia.waveform(uri, buckets)` (stage 1).
- Produces:
  ```ts
  export function musicSpans(p: Project, pxPerS: number): { id: string; leftPx: number; widthPx: number }[];  // timeline.ts; widthPx is never below 1
  // ClipStripProps gains: selectedMusicId?: string; onSelectMusic(id: string): void
  ```

- [ ] **Step 1: Write the failing test:** music at `startS 3` and 8 s long at 20 px/s gives `{ left 60, width 160 }`; no music gives `[]`; a 0.1 s piece at 1 px/s has width 1.
- [ ] **Step 2: Run** `node --test packages/media-core/src/__tests__/timeline.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `musicSpans`, then the row in `ClipStrip`: inside the same scroll content, under the filmstrip, one block per piece at its span with a waveform (peaks from `waveform`, loaded with `singleFlight`, keyed by the piece's `uri`), the selected piece with the accent border, tap selects it (and clears the clip selection). The row is 36 dp tall (`WAVE_H`) and hidden when there is no music.
- [ ] **Step 4: Run** the timeline test, `pnpm --filter @apps-hub/media-core test`, `pnpm --filter design-editor-mobile typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Make a video: music row in the strip"`.

### Task 5: Screen, draft and gate

**Files:**
- Modify: `apps/design-editor-mobile/app/video.tsx`, `apps/design-editor-mobile/src/video/draft.ts` (`dropUnreadable` also drops unreadable music), `docs/handoffs/design-editor-media.md`, `docs/design-editor/` (one paragraph)
- Test: `apps/design-editor-mobile/src/__tests__/video-draft.test.ts` (extend)

**Interfaces:**
- Consumes: Tasks 1 to 4; `pickFiles(['audio'], false)` and `DesignMedia.probe` (`src/media/jobs.ts`); `Segmented` from `@apps-hub/ui`.
- Produces: a selection of either one clip or one music piece; no new exported function beyond the `dropUnreadable` change (`dropped` counts clips and music pieces together; the note reads "1 file could not be opened and was removed." for any mix).

- [ ] **Step 1: Write the failing test:** a draft with two clips and two music pieces where one clip source and one music source are unreadable gives one clip, one piece and `dropped 2`; a draft with music whose only readable source is gone keeps the clips and gives `music []`.
- [ ] **Step 2: Run** `node --test apps/design-editor-mobile/src/__tests__/video-draft.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `dropUnreadable`, then `video.tsx`: a "Sound" group under the strip with a `Segmented` (Mute, Quiet, Normal, Loud) that sets the volume of the selected clip or music piece; fixed rows of two: "Add music" / "Delete music", "Start here" / "End here" (they act on the selected music piece when one is selected, else on the selected clip, as today), "Move here" (moves the selected music piece's start to the playhead, disabled otherwise). "Add music" picks one audio file, calls `audioSourceFrom` then `addMusic` at the playhead, refusing with a plain notice ("There is no room for music here." when `addMusic` returns the same project). Every edit still calls `saveDraft`.
- [ ] **Step 4: Run the full gate** (report the real output): `pnpm test`, `pnpm typecheck`, `pnpm --filter design-editor-mobile lint`, `cd apps/design-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew :design-media:testDebugUnitTest :app:assembleDebug`.
- [ ] **Step 5: Update** the handoff and the design paragraph; **commit** `git commit -m "Make a video: sound screen, draft and the music row wired in"`.

**Phone checklist (not part of the gate):** Mute, Quiet, Normal and Loud audibly differ on a clip with sound; a clip with no sound next to clips with sound plus music (silence under the music only); music added at the playhead, trimmed, moved and deleted updates the strip and the preview together; music longer than the video stops at the video's end in the saved file; the saved file's length equals the strip total; sound and picture stay in step after 5 or more clips; kill the app mid-save and resume; reopen the screen and the music is back; a deleted music file is dropped with the note; drag smoothness with 5 clips and 3 music pieces.

## Self-review (run 2026-11-06)

- **Spec coverage:** decision 1, stage 3 ("sound tracks: music from files, original sound, volume per clip"): music from files Tasks 1 and 5, original sound kept and per-clip volume Tasks 1 and 3, a music track on the timeline Task 4. Decisions 2 and 3 (Composition for preview and export, the edit as pure data): Tasks 1 to 3.
- **Not covered on purpose:** fades, ducking, voice-over, a sound library, dragging music, overlapping music, text (stage 4).
- **Types:** `Music` and `AudioSource` (Task 1) feed `ComposeMusic` (Task 2) and the Kotlin `ComposeMusic` (Task 3) from one fixture; `musicSpans` (Task 4) and the screen (Task 5) use the Task 1 names unchanged.
- **Unverified before building:** that `CompositionPlayer` mixes a second, audio-only sequence on this phone without stutter; that `GainProcessor` above 1.0 does not clip audibly; that a gap at the start of an audio sequence plays as silence; whether the composition length follows the longest sequence (the plan relies on music never being longer than the video).

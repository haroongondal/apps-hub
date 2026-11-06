# Make a video, stage 2 (video track only) - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Make a video" screen where the person adds several clips, sees them as one horizontal strip, cuts, trims, reorders and deletes them, plays the result, and saves one MP4.

**Architecture:** The edit is data: a pure-TypeScript project model in `packages/media-core` (add, split, trim, move, delete) becomes a `ComposePlan` (all clips travel inside the plan, so the existing queue, retry and resume work unchanged). Native builds ONE Media3 `Composition` from that plan; `Transformer` exports it and a `CompositionPlayer` view previews it, so the preview is what gets saved. The strip is a multi-clip sibling of the stage 1 `RangeStrip`.

**Tech Stack:** TypeScript (erasable, `.ts` imports, `node --test`), Expo SDK 54 / RN 0.81, Kotlin, Media3 1.11.1 (`media3-transformer` already a dependency; `CompositionPlayer` lives in it), `@apps-hub/ui`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-05-timeline-editor-design.md` (decisions 1 to 3, 5). Stage 1 plan for conventions: `docs/superpowers/plans/2026-11-05-timeline-strip-stage-1.md`.

## Global Constraints

- Everything in the stage 1 plan's Global Constraints applies: Android only; no new dependency; `@apps-hub/ui` tokens only; plain words (`plain-words.test.ts` bans codec, bitrate, keyframe, encoder, media3, ffmpeg and similar in every string literal); times as `m:ss.s`; originals read-only; no media bytes cross the bridge; 48 dp touch targets; a new `*.test.ts` must be added to its package's `test` script; erasable TS.
- Media3 calls used here were checked with `javap` against 1.11.1 on 2026-11-06: `CompositionPlayer.Builder(Context).setLooper(Looper).build()`, `CompositionPlayer.setComposition(Composition)` and `setComposition(Composition, long)`, `setVideoSurface(Surface, androidx.media3.common.util.Size)`, `setScrubbingModeEnabled(boolean)`; `Composition.Builder(List<EditedMediaItemSequence>).setEffects(Effects).build()`; `EditedMediaItemSequence.Builder(List<EditedMediaItem>).experimentalSetForceAudioTrack(boolean).build()`; `EditedMediaItem.Builder(MediaItem).setEffects(Effects).build()`. Re-run `javap` for anything else before using it.
- Preview and export call the same function (`ComposeBuilder.composition(plan)`). No second code path.
- No Spotify or network source. Do not install on the phone (the owner installs through the Store, or says otherwise); do not merge or release.

## Choices made for the owner to overrule

- Limits: 20 clips, 10 minutes in all (guards memory and phone time; no measurement behind the numbers).
- Output: one MP4, the "medium" quality preset (short side at most 1080, at most 30 fps, 0.10 bits per pixel). The FIRST clip sets the picture shape; later clips of another shape fit inside it with black bars, never stretched.
- Trim and reorder use buttons ("Start here", "End here", "Earlier", "Later") because that pattern is already proven on the phone in stage 1. Drag handles on clip edges and drag-to-reorder are NOT in this plan.
- The project is kept on the phone automatically and comes back when the screen reopens. No rename (default name "My video"), no undo, no transitions, no speed change; sound and music are stage 3, text is stage 4.

## Review Focus

- Clips of different sizes or turned differently (portrait and landscape together): output is the first clip's shape, others letterboxed. Task 2 test, phone check.
- A clip with no sound among clips with sound: silence for that stretch, no failed export, no drift. Task 3 test (`forceAudio`), phone check.
- The same source added twice, or one clip split in two: ids stay unique and editing one piece never changes the other. Task 1 test.
- A source that cannot be opened any more (deleted, access gone) when the screen reopens or at save: the clip is dropped with a plain notice, Save never starts a doomed job. Task 6 test.
- Split at the very start, the very end, on a join, or within 0.1 s of an edge: no zero-length clip. Task 1 test.

---

### Task 1: Project model

**Files:**
- Create: `packages/media-core/src/project.ts`
- Test: `packages/media-core/src/__tests__/project.test.ts`
- Modify: `packages/media-core/src/index.ts` (`export * from './project.ts';`), `packages/media-core/package.json` (add the test file to `test`)

**Interfaces:**
- Consumes: `moveEdge`, `snapTenth`, `MIN_RANGE_S` from `timeline.ts`; `MediaInfo` from `types.ts`.
- Produces:
  ```ts
  export interface Source { uri: string; name: string; durationS: number; width: number; height: number; fps: number; hasAudio: boolean } // width/height are the DISPLAY size (rotation already applied); durationS floored to a tenth
  export interface Clip { id: string; source: Source; inS: number; outS: number }
  export interface Project { name: string; clips: Clip[] }
  export const MAX_CLIPS = 20; export const MAX_TOTAL_S = 600;
  export function emptyProject(name?: string): Project;                       // name defaults to 'My video'
  export function sourceFrom(info: MediaInfo): Source | undefined;            // undefined when there is no video track
  export function clipLengthS(c: Clip): number;
  export function totalS(p: Project): number;
  export function clipStarts(p: Project): number[];                           // timeline start of each clip
  export function locate(p: Project, timelineS: number): { index: number; offsetS: number } | undefined; // the end of the video maps to the last clip's end
  export function addClip(p: Project, s: Source, id: string): Project;       // whole source, appended
  export function splitAt(p: Project, timelineS: number, newId: string): Project; // same reference when nothing changes
  export function trimClip(p: Project, id: string, edge: 'start' | 'end', toSourceS: number): Project;
  export function moveClip(p: Project, id: string, by: -1 | 1): Project;     // same reference at either end
  export function deleteClip(p: Project, id: string): Project;
  export function projectProblem(p: Project): string | undefined;           // plain-words refusal text, undefined when fine
  export function parseDraft(text: string): Project | undefined;            // undefined for anything malformed
  ```

- [ ] **Step 1: Write the failing tests** in `project.test.ts` with sources A (10 s, 1280x720, 30 fps, sound) and B (4.04 s, 720x1280, 30 fps, no sound):
  - `addClip` twice: two clips, unique ids, B has `inS 0`, `outS 4` (4.04 floors to 4.0); `totalS` is 14; `clipStarts` is `[0, 10]`.
  - `locate(p, 12)` is `{ index: 1, offsetS: 2 }`; `locate(p, 14)` is `{ index: 1, offsetS: 4 }`; `locate(emptyProject(), 0)` is `undefined`.
  - `splitAt(p, 3.5, 'x')` gives A 0..3.5, A 3.5..10, B; `totalS` stays 14; `splitAt` at 0.05, 9.95, 10 (a join) and 14 returns the same reference.
  - `trimClip(p, A.id, 'start', 2)` makes `inS 2` and `totalS` 12; `'end'` below `inS + 0.1` clamps to `inS + 0.1`; `'start'` past the source length clamps to `outS - 0.1`.
  - `moveClip(p, B.id, -1)` gives `[B, A]`; moving the first clip by -1 returns the same reference; `deleteClip` of the last clip gives `totalS` 0.
  - `projectProblem`: empty is `'Add a clip first.'`; 21 clips is `'A video can have up to 20 clips.'`; 601 s is `'A video can be up to 10 minutes long.'`; a normal project is `undefined`.
  - `sourceFrom`: a 1920x1080 video track with `rotation: 90` gives `width 1080, height 1920`; an audio-only file gives `undefined`.
  - `parseDraft(JSON.stringify(p))` equals `p`; `'nope'`, `{"clips":[{"id":1}]}` and a clip with `inS: "x"` or `outS` below `inS` give `undefined`.
- [ ] **Step 2: Run** `node --test packages/media-core/src/__tests__/project.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `project.ts` to the signatures above. `trimClip` reuses `moveEdge({startS: inS, endS: outS}, edge, toSourceS, source.durationS)`; `splitAt` ignores a time within `MIN_RANGE_S` of a clip edge. `parseDraft` is a trust boundary: check every field's type and every number's finiteness.
- [ ] **Step 4: Run** the test file, then `pnpm --filter @apps-hub/media-core test` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add packages/media-core && git commit -m "Make a video: project model (add, split, trim, move, delete)"`.

### Task 2: The compose plan

**Files:**
- Create: `packages/media-core/src/compose.ts`
- Test: `packages/media-core/src/__tests__/compose.test.ts`
- Modify: `packages/media-core/src/types.ts` (add `'compose'` to `Tool`, the `ComposePlan` type below to `Plan`), `packages/media-core/src/index.ts`, `packages/media-core/package.json`, `packages/media-core/fixtures/plan-examples.json` (one `compose` example; `gif-cases.test.ts` and Kotlin `Fixtures.kt` read this file), `apps/design-editor-mobile/src/media/tools.ts` (`BY_PLAN` becomes `Record<Plan['tool'], string>` with `compose: 'Make a video'`)

**Interfaces:**
- Consumes: Task 1 `Project`, `totalS`, `projectProblem`; `dimsFor` (`budget.ts`); `QUALITY_PRESETS.medium` (`presets.ts`: `maxShortSide 1080, maxFps 30, bpp 0.10`).
- Produces:
  ```ts
  export interface ComposeClip { uri: string; name: string; inS: number; outS: number; hasAudio: boolean }
  export interface ComposePlan { tool: 'compose'; clips: ComposeClip[]; width: number; height: number; fps: number; videoBps: number; plannedBytes: number; ext: 'mp4' }
  export function outputSize(p: Project): { width: number; height: number };  // from the first clip, as planQuality does
  export function planCompose(p: Project): Planned<ComposePlan>;
  ```
  Refusals use `{ ok: false, reason: 'invalid', detail: projectProblem(p) }` (do NOT use `'too-long'`: its text in `format.ts` talks about a size target).

- [ ] **Step 1: Write the failing tests.**
  - `outputSize`: first clip 1280x720 gives `{1280, 720}`; first clip 3840x2160 gives `{1920, 1080}`; first clip portrait 720x1280 followed by a landscape clip gives `{720, 1280}`; first clip 1081x721 gives `{1080, 720}` (even sides).
  - `planCompose` for A (10 s) then B (4 s), both 1280x720 at 30 fps: `ok`, `width 1280`, `height 720`, `fps 30`, `videoBps 2_764_800`, `plannedBytes 5_174_400` (video plus 192 000 bit/s sound, over 14 s), `clips[1].hasAudio` false, `ext 'mp4'`.
  - fps is the largest source fps capped at 30: sources 24 and 60 give 30; a single 24 gives 24.
  - an empty project gives `{ ok: false, reason: 'invalid', detail: 'Add a clip first.' }`.
- [ ] **Step 2: Run** `node --test packages/media-core/src/__tests__/compose.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `compose.ts`; short side is `2 * Math.floor(Math.min(1080, first short side) / 2)` then `dimsFor`; `plannedBytes = Math.ceil((videoBps + 192_000) / 8 * totalS)`.
- [ ] **Step 4: Run** the test file, `pnpm --filter @apps-hub/media-core test`, `pnpm typecheck`. Fix every `tsc` error a new `Plan` member causes (the compiler lists the sites). Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Make a video: compose plan (size, rate, planned size)"`.

### Task 3: Native compose job (codec, builder, runner)

**Files:**
- Modify: `.../core/Plans.kt` (class, `decodePlan`, `encodePlan`), `.../core/OutputName.kt` (`outputLabel` is `""`, `outputExt` is `"mp4"`), `.../core/Bitrate.kt` (`neededBytes`: `is ComposePlan -> 2 * plan.plannedBytes`), `.../core/EncoderMode.kt` (`hasBitrateMode`: `is ComposePlan -> true`), `.../android/Runners.kt` (`is ComposePlan -> TransformerRunner.compose(req, plan, done)`), `.../android/TransformerRunner.kt` (share `launch` between a single item and a `Composition`)
- Create: `.../core/ComposeItems.kt` (pure), `.../android/ComposeBuilder.kt`
- Test: `.../src/test/java/expo/modules/designmedia/core/ComposeTest.kt`; extend `Fixtures.kt`/`PlanJsonTest.kt` to cover the `compose` example

**Interfaces:**
- Consumes: Task 2 JSON shape; `microseconds(seconds)` (`CopyRules.kt`).
- Produces:
  ```kotlin
  data class ComposeClip(val uri: String, val name: String, val inS: Double, val outS: Double, val hasAudio: Boolean)
  data class ComposePlan(val clips: List<ComposeClip>, val width: Int, val height: Int, val fps: Int, val videoBps: Int, val plannedBytes: Long, val ext: String) : Plan { override val tool get() = "compose" }
  data class ItemSpec(val uri: String, val startUs: Long, val endUs: Long, val keepAudio: Boolean)
  fun composeItems(plan: ComposePlan): List<ItemSpec>
  fun forceAudio(plan: ComposePlan): Boolean              // true when ANY clip has sound, so a silent clip gets silence
  object ComposeBuilder { fun composition(context: Context, plan: ComposePlan): Composition } // the one place a Composition is made
  // TransformerRunner.compose(req: Request, plan: ComposePlan, done: (Outcome) -> Unit): Runner
  ```

- [ ] **Step 1: Write the failing JVM tests** in `ComposeTest.kt`: the fixture `compose` plan decodes to a `ComposePlan` and `encodePlan(decodePlan(x))` keeps every field; `composeItems` for A (0..10, sound) and B (0..4, no sound) is `[ItemSpec(a, 0, 10_000_000, true), ItemSpec(b, 0, 4_000_000, false)]`; `forceAudio` is true for that plan and false when no clip has sound; `neededBytes` is `2 * plannedBytes`; `outputExt` is `mp4`; `outputLabel` is `""`; `hasBitrateMode` is true; `targetFor` gives `Kind.VIDEO` and `Movies/Design Editor/`.
- [ ] **Step 2: Run** `cd apps/design-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew :design-media:testDebugUnitTest`. Expected: FAIL to compile (`ComposePlan` missing).
- [ ] **Step 3: Implement** the pure parts first (class, codec, `composeItems`, `forceAudio`, the four `when` branches); then `ComposeBuilder.composition`: one `EditedMediaItem` per `ItemSpec` (`MediaItem` with a `ClippingConfiguration` from the times, `setRemoveAudio(!keepAudio)` NOT used: keep the item's own sound), item effects `Presentation.createForWidthAndHeight(width, height, LAYOUT_SCALE_TO_FIT)` plus `FrameDropEffect.createDefaultFrameDropEffect(fps)` as `scaleTo` already does, one `EditedMediaItemSequence` with `experimentalSetForceAudioTrack(forceAudio(plan))`. Then `TransformerRunner.compose`: H.264 + AAC, `encoders(req, plan.videoBps, AAC_BPS)`, same listener and progress as today.
- [ ] **Step 4: Run** the Gradle gate `:design-media:testDebugUnitTest :app:assembleDebug`. Expected: BUILD SUCCESSFUL; then `pnpm test`. The builder and runner touch Media3 and cannot run on the JVM: they are proved by the compile gate now and on the phone in Task 6.
- [ ] **Step 5: Commit** `git commit -m "Make a video: native compose job (plan codec, one Composition builder, runner)"`.

### Task 4: Preview view

**Files:**
- Create: `apps/design-editor-mobile/modules/design-media/android/src/main/java/expo/modules/designmedia/android/CompositionView.kt`, `apps/design-editor-mobile/modules/design-media/src/CompositionView.tsx`
- Modify: `.../DesignMediaModule.kt` (register the view), `apps/design-editor-mobile/modules/design-media/src/index.ts` (re-export)

**Interfaces:**
- Consumes: Task 3 `ComposeBuilder.composition`, `decodePlan`.
- Produces:
  ```ts
  // props: plan (JSON of a ComposePlan, or null), playing: boolean; events onPosition({ timeS }), onEnded(), onError()
  export interface CompositionViewHandle { seekTo(timeS: number): Promise<void>; setScrubbing(on: boolean): Promise<void> }
  export const CompositionView: React.ForwardRefExoticComponent<CompositionViewProps & React.RefAttributes<CompositionViewHandle>>;
  ```

- [ ] **Step 1: Implement `CompositionView` (Kotlin)**: an `ExpoView` holding a `SurfaceView`; the player is built on the main looper (`setLooper(Looper.getMainLooper())`); the `plan` prop calls `decodePlan`, then `ComposeBuilder.composition`, then `setComposition` with the current position (check the unit of that second argument in the 1.11.1 Javadoc first) and `prepare()`; `playing` calls `play()`/`pause()`; `seekTo` and `setScrubbing` (`setScrubbingModeEnabled`) are view functions; position is posted every 100 ms while playing as `onPosition`; the surface callbacks call `setVideoSurface(holder.surface, Size(w, h))` and clear it on destroy; release the player when the view is removed.
- [ ] **Step 2: Implement `CompositionView.tsx`** with `requireNativeView('DesignMedia', 'CompositionView')` from `expo` (confirm the export in the installed `expo-modules-core`), a `forwardRef` + `useImperativeHandle` wrapper, and the types above.
- [ ] **Step 3: Run** the gate `:design-media:testDebugUnitTest :app:assembleDebug` and `pnpm --filter design-editor-mobile typecheck`. Expected: PASS. If the compiler cannot see an exoplayer type, stop and ask the owner before declaring `media3-exoplayer:1.11.1` (same pinned family, already in the tree).
- [ ] **Step 4: Commit** `git commit -m "Make a video: preview view that plays the same Composition"`.

### Task 5: Clip strip

**Files:**
- Create: `apps/design-editor-mobile/src/timeline/ClipStrip.tsx`
- Modify: `packages/media-core/src/timeline.ts` (+ `__tests__/timeline.test.ts`)

**Interfaces:**
- Consumes: Task 1 `Project`, `clipLengthS`, `clipStarts`; stage 1 `thumbCount`, `thumbTimes`, `zoomLimits`, `clampZoom`; `singleFlight` (`latest.ts`).
- Produces:
  ```ts
  export function clipSpans(p: Project, pxPerS: number): { id: string; leftPx: number; widthPx: number }[]; // timeline.ts; widthPx is never below 1
  // ClipStrip props:
  { project: Project; selectedId?: string; onSelect(id: string): void; seekS?: number; onPlayhead(timelineS: number): void }
  ```

- [ ] **Step 1: Write the failing test** for `clipSpans`: two clips of 10 s and 4 s at 20 px/s give `[{left 0, width 200}, {left 200, width 80}]`; an empty project gives `[]`; a 0.1 s clip at 1 px/s has width 1.
- [ ] **Step 2: Run** `node --test packages/media-core/src/__tests__/timeline.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `clipSpans`, then `ClipStrip`: same shape as `RangeStrip` (native horizontal `ScrollView`, fixed centre playhead, ruler over the whole video, tap a block to select it, the selected block gets an accent border). Tiles per clip: `inS + t` for `t` of `thumbTimes(clipLengthS, thumbCount(clipLengthS, pxPerS))`, requested with `singleFlight` and keyed by the clip's `uri`. The seek effect must NOT call `onPlayhead` (the stage 1 lesson in `RangeStrip.tsx`).
- [ ] **Step 4: Run** the timeline test, `pnpm --filter @apps-hub/media-core test`, `pnpm --filter design-editor-mobile typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Make a video: multi-clip strip"`.

### Task 6: The screen, the entry and the gate

**Files:**
- Create: `apps/design-editor-mobile/app/video.tsx`, `apps/design-editor-mobile/src/video/draft.ts`
- Modify: `apps/design-editor-mobile/app/(tabs)/media.tsx` (a "Make a video" row above the tools; it is not in `TOOLS`, which drives the one-file tool flow), `apps/design-editor-mobile/app/_layout.tsx` (register the route if the stack needs it), `docs/handoffs/design-editor-media.md`, `docs/design-editor/` PRD or SPEC (one paragraph for stage 2)
- Test: `apps/design-editor-mobile/src/__tests__/video-draft.test.ts` (add to the app's `test` script); `plain-words.test.ts` must still pass unchanged

**Interfaces:**
- Consumes: Tasks 1 to 5; `pickFiles(['video'], true)` and `startJobs` (`src/media/jobs.ts`); `DesignMedia.probe`.
- Produces:
  ```ts
  export function draftPath(): string;                                              // `${FileSystem.documentDirectory}video-project.json`
  export async function saveDraft(p: Project): Promise<void>;
  export async function loadDraft(readable: (uri: string) => Promise<boolean>): Promise<{ project: Project; dropped: number }>;
  ```
  `loadDraft` runs `parseDraft`, then removes every clip whose source `readable` rejects, and reports how many (the screen shows "N clips could not be opened and were removed").

- [ ] **Step 1: Write the failing test** `video-draft.test.ts` (inject `readable`, no file system): a draft with three clips where one source is unreadable gives two clips and `dropped 1`; a malformed draft gives an empty project and `dropped 0`.
- [ ] **Step 2: Run** `node --test apps/design-editor-mobile/src/__tests__/video-draft.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `draft.ts` (file I/O only in `saveDraft` and the default `readable`), then `video.tsx`: top to bottom, the `CompositionView` (height 150 dp, as in the stage 1 fix), play and pause, `ClipStrip`, then fixed button rows of two: "Add clips" / "Cut here", "Start here" / "End here", "Earlier" / "Later", "Delete clip" / "Save video". "Add clips" calls `pickFiles`, then `sourceFrom`, then `addClip`, refusing with `projectProblem` text. "Save video" is disabled while `planCompose` is not `ok`, then `startJobs([{ info: { id: firstClip.uri, name: project.name }, plan }])` and opens the Queue tab. Every edit calls `saveDraft`. Play pauses while the strip is dragged (`setScrubbing(true)` during the drag).
- [ ] **Step 4: Run the full gate** (report the real output): `pnpm test`, `pnpm typecheck`, `pnpm --filter design-editor-mobile lint`, `cd apps/design-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew :design-media:testDebugUnitTest :app:assembleDebug`.
- [ ] **Step 5: Update** the handoff (what was built, what is verified, the phone checklist below) and the one design paragraph; **commit** `git commit -m "Make a video: screen, draft, entry in the Media tab"`.

**Phone checklist (not part of the gate; needs the phone and the owner's install route):** two clips of different shapes join and play; a silent clip among clips with sound; split, trim, move and delete update the strip and the preview together; Save writes one MP4 whose length equals the strip total; the file plays with sound in step; kill the app mid-export and resume from the Queue; leave and reopen the screen and the project is back; drag smoothness with 10 or more clips.

## Self-review (run 2026-11-06)

- **Spec coverage:** decision 1 stage 2 (join, split, trim, reorder, delete, preview, save): Tasks 1, 5, 6; decision 2 (Composition and CompositionPlayer, one preview and export path): Tasks 3, 4; decision 3 (edit as data, pure, `node --test`, JSON to native): Tasks 1, 2, 3; decision 5 (PanResponder and ScrollView, no dependency): Task 5. Stage 1's `RangeStrip` is untouched.
- **Not covered on purpose:** drag handles, drag-to-reorder, undo, rename, transitions, speed, per-clip volume, music, text, templates (later stages or follow-ups).
- **Types:** `Source`, `Clip`, `Project` (Task 1) are the only inputs of `planCompose` (Task 2); `ComposeClip` and `ComposePlan` are written once in TS (Task 2) and once in Kotlin (Task 3) from the same fixture; `ClipStrip` and the screen use Task 1 names unchanged.
- **Unverified before building:** that `experimentalSetForceAudioTrack` gives silence (not an error) for a silent clip on this phone; that `CompositionPlayer` plays a letterboxed mix of portrait and landscape clips smoothly; the unit of `setComposition(Composition, long)`; whether the exoplayer type is visible to the module's compile classpath.

# Timeline strip, stage 1 - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the typed start and end times in Trim, Make a GIF and Save a picture with a draggable filmstrip and waveform with start and end handles, as in CapCut and Instagram Edits.

**Architecture:** Pure timeline maths in `packages/media-core`; two small native reads (`waveform`, `previewFrame`) in the `design-media` Expo module; a React Native `RangeStrip` built on a native horizontal `ScrollView` (fixed centre playhead) with `PanResponder` handles; wired into `app/media/[tool].tsx`.

**Tech Stack:** TypeScript (erasable, `.ts` imports, `node --test`), Expo SDK 54 / RN 0.81, Kotlin (MediaExtractor, MediaCodec, MediaMetadataRetriever), `@apps-hub/ui` tokens. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-05-timeline-editor-design.md`

## Global Constraints

- Android only; no iOS project exists for `apps/design-editor-mobile`.
- No new npm, Gradle or CocoaPods dependency.
- Colours, fonts and spacing from `@apps-hub/ui` via `useTheme()`; never hand-rolled hex.
- Plain words only on screen (PRD FR-13, AC-16): no codec, bitrate, keyframe, encoder, etc. `src/__tests__/plain-words.test.ts` scans every string literal in `src/` and `app/`.
- Times display as `m:ss.s` (PRD FR-5); edges snap to 0.1 s.
- Originals read-only; only the app cache is written; no network; no media bytes cross the bridge (numbers and `file://` paths do).
- Touch targets at least 48 dp.
- Each package's `test` script lists test files by name; a new `*.test.ts` does nothing until it is added to that `package.json`.
- Write erasable TypeScript only (no enums, namespaces, parameter properties); import with the `.ts` extension inside `packages/`.
- Check every Android API with `javap` against the android-36 `android.jar` before using it.
- Do not install on the phone; the owner installs through the Store. Do not merge or release.

## Review Focus

- Duration 0, negative or NaN (probe failure): no NaN reaches the screen, handles do nothing. Tested in Task 1.
- Very long media (two hours): thumbnail tiles stay at or under 60 and ruler labels stay readable. Tested in Task 1.
- A file with no sound: `waveform` returns `[]`, the strip shows no waveform row and no error. Tested in Tasks 1 and 2.
- Fast scrubbing: frame results arrive out of order and only the newest is shown. Tested in Task 3.
- View width 0 before layout: zoom limits do not divide by zero. Tested in Task 1.

---

### Task 1: Timeline maths

**Files:**
- Create: `packages/media-core/src/timeline.ts`
- Test: `packages/media-core/src/__tests__/timeline.test.ts`
- Modify: `packages/media-core/src/index.ts` (add `export * from './timeline.ts';`), `packages/media-core/package.json` (add the test file to `test`)

**Interfaces:**
- Produces:
  ```ts
  export interface Range { startS: number; endS: number }
  export const MIN_RANGE_S = 0.1;
  export const MAX_PX_PER_S = 240;
  export function snapTenth(s: number): number;
  export function moveEdge(range: Range, edge: 'start' | 'end', toS: number, durationS: number, minS?: number): Range;
  export function zoomLimits(durationS: number, viewPx: number): { min: number; max: number };
  export function clampZoom(pxPerS: number, durationS: number, viewPx: number): number;
  export function rulerStepS(pxPerS: number, minGapPx?: number, durationS?: number, maxLabels?: number): number; // at most 150 labels
  export function lastFrameS(durationS: number): number; // last tenth strictly inside the media (the frame rule needs t < duration)
  export function thumbCount(durationS: number, pxPerS: number, tilePx?: number): number;
  export function thumbTimes(durationS: number, count: number): number[];
  export function barsFor(peaks: number[], count: number): number[];
  ```

- [ ] **Step 1: Write the failing tests** in `timeline.test.ts`:
  - `moveEdge` start: `{0,10}` to 12 gives start `9.9` (end minus 0.1); to -3 gives `0`; to `2.34` gives `2.3`.
  - `moveEdge` end: `{2,10}` to 99 with duration 10 gives end `10`; to 1 gives `2.1`.
  - `moveEdge` with duration `0`, `NaN` and `-5` returns the range unchanged.
  - `zoomLimits(3, 360)` is `{ min: 120, max: 240 }`; `zoomLimits(7200, 360)` has `min` `0.05`; `zoomLimits(10, 0)` is `{ min: 1, max: 240 }`.
  - `clampZoom(1000, 60, 360)` is `240`; `clampZoom(0.01, 60, 360)` is `6`.
  - `rulerStepS(100)` is `1`; `rulerStepS(2)` is `30`; `rulerStepS(0.01)` is `600`.
  - `thumbCount(600, 1.2)` is `15`; `thumbCount(7200, 240)` is `60`; `thumbCount(2, 1)` is `6`; `thumbCount(0, 50)` is `6`.
  - `thumbTimes(10, 4)` is `[1.25, 3.75, 6.25, 8.75]`; `thumbTimes(10, 0)` is `[]`.
  - `barsFor([0.1, 0.9, 0.2, 0.4], 2)` is `[0.9, 0.4]`; `barsFor([0.5, 0.2], 4)` is `[0.5, 0.5, 0.2, 0.2]`; `barsFor([], 5)` is `[]`; `barsFor([1], 0)` is `[]`.
- [ ] **Step 2: Run** `node --test packages/media-core/src/__tests__/timeline.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** each function in `timeline.ts`. `moveEdge` snaps with `snapTenth`, clamps, and returns the input object untouched when `durationS` is not a finite number above 0. `zoomLimits` returns `max: MAX_PX_PER_S` and `min: min(viewPx / durationS, MAX_PX_PER_S)`, with `{ min: 1, max }` when `viewPx <= 0` or the duration is not valid. `rulerStepS` picks the smallest of `[0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]` whose step times `pxPerS` is at least `minGapPx` (default 56), else the last. `thumbCount` is `ceil(durationS * pxPerS / tilePx)` (default tile 48) clamped to 6 through 60. `barsFor` output bar `i` is the max of `peaks[lo..hi)` with `lo = floor(i * n / count)` and `hi = max(lo + 1, ceil((i + 1) * n / count))`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Wire** the export and the `package.json` test list; run `pnpm --filter @apps-hub/media-core test` and `pnpm --filter @apps-hub/media-core typecheck`. Expected: all pass.
- [ ] **Step 6: Commit** `git add packages/media-core && git commit -m "Design Editor timeline: pure strip maths"`.

### Task 2: Native `waveform` and `previewFrame` (delegate to `native-module-engineer`)

**Files:**
- Create: `apps/design-editor-mobile/modules/design-media/android/src/main/java/expo/modules/designmedia/core/Peaks.kt`, `.../android/Waveform.kt`
- Test: `apps/design-editor-mobile/modules/design-media/android/src/test/java/expo/modules/designmedia/core/PeaksTest.kt`
- Modify: `.../android/Thumbs.kt` (a `folder` parameter, default `"thumbs"`), `.../DesignMediaModule.kt`, `apps/design-editor-mobile/modules/design-media/src/index.ts`

**Interfaces:**
- Produces (Kotlin core): `class PeakBuckets(durationUs: Long, buckets: Int) { fun add(ptsUs: Long, pcm: ShortArray, channels: Int, sampleRate: Int); fun result(): List<Float> }`. `result()` always has `buckets` entries (at least 1), each the largest absolute sample in that slice divided by 32768, across all channels. Samples whose time falls past the end go in the last slice. A duration of 0 or less gives all zeros.
- Produces (Android): `object Waveform { fun peaks(context: Context, uri: Uri, buckets: Int): List<Float> }`: reads the first audio track with `MediaExtractor` and `MediaCodec`, returns `emptyList()` when there is no audio track, never writes anywhere, releases the codec and extractor in `finally`.
- Produces (TS contract in `src/index.ts`, after `thumbnails`):
  ```ts
  waveform(uri: string, buckets: number): Promise<number[]>; // peak 0..1 per slice, [] when there is no sound
  previewFrame(uri: string, timeS: number, width: number): Promise<string>; // file:// JPEG, replaced by the next call
  ```
- Module: `AsyncFunction("waveform") { uri: String, buckets: Int -> Waveform.peaks(context, Uri.parse(uri), buckets.coerceIn(8, 2000)) }` and `AsyncFunction("previewFrame") { uri: String, timeS: Double, width: Int -> Thumbs.write(context, Uri.parse(uri), listOf(timeS), width, "preview").first() }`. All three media reads (`thumbnails` too) end in `.runOnQueue(readScope)` with `readScope = CoroutineScope(Dispatchers.IO + SupervisorJob())`, because Expo's default queue is one thread shared by every module. `Thumbs.write` takes a lock per folder. `waveform` slices over the container duration (what `probe` reports), not the sound track's own.

- [ ] **Step 1: Write `PeaksTest.kt`**: 10 s mono at 8000 Hz, loud (16384) only from 2.0 s to 3.0 s, 10 buckets: bucket 2 is `0.5`, every other bucket `0`; the same signal as interleaved stereo with the loud samples on the right channel only gives the same result; a sample at 12 s lands in the last bucket; `PeakBuckets(0, 4).result()` is four zeros; `PeakBuckets(1_000_000, 0).result().size` is `1`.
- [ ] **Step 2: Run** `cd apps/design-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew :design-media:testDebugUnitTest --tests '*PeaksTest'`. Expected: FAIL, unresolved `PeakBuckets`.
- [ ] **Step 3: Implement** `Peaks.kt`, `Waveform.kt`, the `Thumbs.write` folder parameter (the cleanup of old files stays per folder), the two module functions and the contract lines. `Waveform` handles a 16-bit PCM output format; if `MediaFormat.KEY_PCM_ENCODING` reports float, convert to 16-bit before `add`.
- [ ] **Step 4: Run** `:design-media:testDebugUnitTest :app:assembleDebug`. Expected: all JVM tests pass (120 before this task plus the new ones) and the debug build succeeds.
- [ ] **Step 5: Commit** `git add apps/design-editor-mobile/modules/design-media && git commit -m "Design Editor timeline: waveform and preview frame reads"`.

### Task 3: Latest-only helper and media hooks

**Files:**
- Create: `apps/design-editor-mobile/src/timeline/latest.ts`, `apps/design-editor-mobile/src/timeline/useStripMedia.ts`, `apps/design-editor-mobile/src/timeline/usePreviewFrame.ts`
- Test: `apps/design-editor-mobile/src/__tests__/latest.test.ts`
- Modify: `apps/design-editor-mobile/package.json` (add the test file)

**Interfaces:**
- Produces:
  ```ts
  // latest.ts: one request at a time (the native reads cannot be cancelled); while one runs only the newest later request is kept, and a stale answer is dropped.
  export function singleFlight<A, T>(run: (arg: A) => Promise<T>, done: (value: T, arg: A) => void, failed?: (error: unknown, arg: A) => void): (arg: A) => void;
  // useStripMedia.ts
  export function useStripMedia(uri: string, durationS: number, hasVideo: boolean, hasSound: boolean, pxPerS: number, ready: boolean): { tiles: string[]; peaks: number[] }; // ready is false until the strip knows its width
  // usePreviewFrame.ts: waits 120 ms after the last change, then asks DesignMedia.previewFrame(uri, timeS, 480).
  export function usePreviewFrame(uri: string | undefined, timeS: number): string | undefined;
  ```

- [ ] **Step 1: Write the failing test** `latest.test.ts`: call a, b, c while a runs: only a then c run, a's answer is dropped, c's is delivered; a lone answer is delivered with its argument; a failure is reported only when nothing newer waits.
- [ ] **Step 2: Run** `node --test apps/design-editor-mobile/src/__tests__/latest.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `latest.ts`; then `useStripMedia`: tiles from `DesignMedia.thumbnails(uri, thumbTimes(durationS, thumbCount(durationS, pxPerS)), 160)` re-requested 300 ms after the zoom bucket changes, keeping the old tiles until the new ones arrive and showing none on failure; peaks from `DesignMedia.waveform(uri, 400)` once, `[]` on failure or `hasSound` false. `usePreviewFrame` uses `singleFlight` and keeps the last frame while the next loads.
- [ ] **Step 4: Run** the test and `pnpm --filter design-editor-mobile typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add apps/design-editor-mobile/src apps/design-editor-mobile/package.json && git commit -m "Design Editor timeline: latest-only helper and strip media hooks"`.

### Task 4: `RangeStrip` component

**Files:**
- Create: `apps/design-editor-mobile/src/timeline/RangeStrip.tsx`

**Interfaces:**
- Consumes: Task 1 functions and `Range`; Task 3 `useStripMedia`; `useTheme`, `Button` from `@apps-hub/ui`; `timeText` from `src/media/tools.ts`.
- Produces:
  ```ts
  export interface RangeStripProps {
    uri: string; durationS: number; hasVideo: boolean; hasSound: boolean;
    mode: 'range' | 'point';
    range: Range;
    onRange: (r: Range) => void;
    onPlayhead: (s: number) => void; // tenths, after every scroll; in 'point' mode never past lastFrameS
    seekS?: number; // a time typed elsewhere: the strip scrolls to it when it is not already there
  }
  export function RangeStrip(props: RangeStripProps): JSX.Element;
  ```

- [ ] **Step 1: Implement** the layout: a ruler row (labels every `rulerStepS(pxPerS)`), a horizontal `ScrollView` whose content is `[half-view padding][durationS * pxPerS wide track][half-view padding]` so `scrollX / pxPerS` is the time under the fixed playhead (a full-height line in `c.text` with a time label above it), a filmstrip of equal-width tiles with `Image`, and under it the waveform as bars from `barsFor(peaks, n)` with `n` the first of 100, 200, 400, 800 whose bars are at least 3 px apart over the track coloured `c.accent` inside the range and `c.muted` outside. No waveform row when `peaks` is empty. A loading placeholder in `c.raised` while tiles are absent.
- [ ] **Step 2: Handles** (range mode only): two `PanResponder` handles 14 dp wide, with a 48 dp touch area, positioned inside the scrolling content at `range.startS * pxPerS` and `range.endS * pxPerS`; dragging calls `onRange(moveEdge(range, edge, startTimeAtGrant + dx / pxPerS, durationS))`; the `ScrollView` has `scrollEnabled` off while a handle is held; dimming overlays in `c.bg` at 65 percent outside the range and a 2 dp `c.accent` border around it. Accessibility labels in plain words: "Start of the part to keep" and "End of the part to keep".
- [ ] **Step 3: Zoom**: `pxPerS` state starts at `clampZoom(durationS > 8 ? viewPx / 8 : viewPx / durationS, ...)`; two buttons "Zoom out" and "Zoom in" (each multiplies by 1.5 and clamps); a two-finger pinch handled with `onTouchMove` on the wrapper View using the distance between `nativeEvent.touches`; after a zoom change the scroll offset is set so the playhead time stays put.
- [ ] **Step 4: Buttons** below the strip in range mode: "Start here" and "End here" set the edge to the playhead through `moveEdge`.
- [ ] **Step 5: Verify** `pnpm --filter design-editor-mobile typecheck` and `pnpm --filter design-editor-mobile test` (the plain-words scan covers the new file). Expected: pass.
- [ ] **Step 6: Commit** `git add apps/design-editor-mobile/src/timeline && git commit -m "Design Editor timeline: the strip"`.

### Task 5: Use the strip in Trim, Make a GIF and Save a picture

**Files:**
- Modify: `apps/design-editor-mobile/app/media/[tool].tsx` (remove `thumbs` state and its effect, the `setting` state and its Segmented, the thumbnail `ScrollView`; add `RangeStrip`, `usePreviewFrame`, a preview `Image` with `resizeMode="contain"` and a readout row "Start", "Keeps", "End"); keep the typed `Field`s beneath, kept in step with the strip.

**Interfaces:**
- Consumes: `RangeStrip`, `usePreviewFrame`, `parseTime`, `timeText`.

- [ ] **Step 1: Wire** `range` from `parseTime(start)` and `parseTime(end)` (fall back to `{ startS: 0, endS: info.durationS }` when either is not a time); `onRange` writes `timeText` back to `start` and `end`; in `picture` mode `onPlayhead` writes `start`.
- [ ] **Step 2: Verify** `pnpm --filter design-editor-mobile typecheck && pnpm test`. Expected: all pass. Check by reading the file that no hex colours were added and `Pressable`, `Image`, `ScrollView` imports that became unused are gone.
- [ ] **Step 3: Compile gate** `cd apps/design-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew :design-media:testDebugUnitTest :app:assembleDebug`. Expected: BUILD SUCCESSFUL.
- [ ] **Step 4: Commit** `git add apps/design-editor-mobile && git commit -m "Design Editor media: Trim, GIF and picture use the timeline strip"`.

### Task 6: Docs and handoff

**Files:**
- Modify: `docs/design-editor/SPEC.md` (section 13.2 screens, section 7.1 contract: the two new calls), `docs/design-editor/PRD.md` (FR for the strip), `docs/handoffs/design-editor-media.md` (session log, current state, next step)

- [ ] **Step 1: Update** the three docs, naming what was built, what is verified (unit tests, compile gate) and what is not (phone drag test), and the stage 2 next step.
- [ ] **Step 2: Commit and push** `git add docs && git commit -m "Docs: timeline strip stage 1" && git push`.

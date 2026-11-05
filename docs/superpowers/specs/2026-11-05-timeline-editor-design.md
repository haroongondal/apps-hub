# Timeline editor for Design Editor (phone) - design

Date: 2026-11-05. Owner request, branch `design-media-phase-4`. Written for the engineer who builds it.

## Intent

The owner wants the way CapCut and Instagram Edits set a start and an end: the media is shown as a horizontal
breakdown (a filmstrip, with a waveform under it for sound), and the person drags the strip under a fixed
playhead and pulls handles at the ends of the part they want. Today every tool asks for typed times
(`app/media/[tool].tsx`). The owner chose the **full timeline** ("Make a video": video, original sound, background
music and text on separate tracks, each with handles, split, volume and add music) over a strip-only change, and
said they like all of CapCut's and Edits' timeline functions. They did not describe a first video; the
stages below are my ordering, not theirs.

## Goals

- One shared timeline strip that every timeline task uses: filmstrip, waveform, ruler, fixed centre playhead,
  drag to move along the media, handles to set start and end, zoom (pinch and two buttons).
- The strip replaces the thumbnail row and the "Set the start / Set the end" switch in Trim, Make a GIF and
  Save a picture. The typed boxes stay beneath it for exact times.
- Later: "Make a video" with several tracks, built on the same strip.

## Non-goals and anti-goals

- No Spotify or any network music source (PRD section 8). Music comes from files on the phone.
- No copy of CapCut's or Edits' own content, templates or code. Ours are original.
- No new npm, Gradle or CocoaPods dependency without the owner's yes (gesture-handler and reanimated are
  the first thing to ask for if dragging proves janky on the phone).
- A timeline that looks right but cannot be dragged with one thumb is a failure, even if it works.

## Constraints (all stages)

Android only (`apps/design-editor-mobile` has no iOS project). Colours and fonts come from `@apps-hub/ui` via
`useTheme()`. Every label is plain words (PRD FR-13, AC-16, enforced by `plain-words.test.ts`). Times show as
`m:ss.s` (FR-5). Originals are read-only; only our own cache and rows are written; nothing touches the network;
no media bytes cross the bridge (numbers and `file://` paths do). Touch targets are 48 dp or more.

## Decisions (my calls, for the owner to overrule)

1. **Stages.** 1 the strip in the three existing tools. 2 "Make a video": video track only (join, split, trim,
   reorder, delete), preview and save. 3 sound tracks: music from files, original sound, volume per clip.
   4 text, then templates. Each stage is shippable and gets its own plan.
2. **Engine for stages 2-4.** Media3 Transformer `Composition` (already a dependency, 1.11.1) mixes audio
   sequences and draws text overlays; `CompositionPlayer` in a native view previews the same composition so the
   preview is what gets saved. The alternative (a separate player library) adds a dependency and two code paths.
3. **The edit is data, not code.** A pure-TypeScript project model in `packages/media-core` (tracks, clips with
   source, in, out, position, gain) with split, trim, move and delete as pure functions, tested with
   `node --test`, then handed to native as JSON like the existing job plans.
4. **Stage 1 scrubbing preview** is one still frame at the playhead (`previewFrame`), not playback; playback
   arrives with the player in stage 2.
5. **Dragging uses `PanResponder` and a native horizontal `ScrollView`**, so no dependency. Handles live inside
   the scrolling content, so they move with the strip as in CapCut.

## Stage 1 shape

`RangeStrip` (React Native, `src/timeline/`) gets `uri`, `durationS`, `hasVideo`, `hasSound`, `mode`
(`'range'` for Trim and GIF, `'point'` for Save a picture: no handles, the playhead is the moment), `range`,
`onRange`, `onPlayhead`. Pure maths (edge clamping with a 0.1 s minimum, zoom limits, ruler step, thumbnail
count and times, waveform bar resampling) lives in `packages/media-core/src/timeline.ts`. Native adds
`waveform(uri, buckets)` (peak per slice, 0 to 1, empty when there is no sound) and `previewFrame(uri, timeS,
width)` to the `design-media` module.

Plan: `docs/superpowers/plans/2026-11-05-timeline-strip-stage-1.md`.

## Left to the builder

Exact pixel sizes, handle grip drawing, the first-zoom level (fit the whole media when it is short, about eight
seconds across when it is long), and the empty and loading looks of the strip.

## Not verified

No phone test yet: drag smoothness inside a `ScrollView` on the Redmi Note 14 Pro is the main risk. The phone
rule applies: the owner installs through the Store.

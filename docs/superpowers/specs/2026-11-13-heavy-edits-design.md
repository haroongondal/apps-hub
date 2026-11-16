# Heavy edits: object eraser, background blur, face fix

Date: 2026-11-13. Status: draft for the owner's approval. Feature 4 of 4; shared parts are in
`2026-11-13-image-tools-overview.md`. Reuses feature 3's bridge call and cut-out mask.

## Why

Google's Magic Eraser, Samsung's object eraser, portrait blur and Remini's face restore are
the headline paid or phone-locked tricks. They are slower models, so they come last, after the
model setup has proven itself on the phone.

## Goal

In the editor, with a photo selected:
- paint over or tap an unwanted thing and it disappears;
- blur the background behind the subject;
- sharpen blurry faces.

Each result is a normal, undoable edit that replaces the image's source, and the original
stays recoverable through undo.

## Scope

1. **Object eraser.**
   - Select what to remove: paint over it with a brush, or tap it. Tapping uses SlimSAM-77
     (Apache; 8.9 MB image encoder + 4.9 MB decoder, 8-bit) to pick the object's outline.
   - MI-GAN (MIT, 28.1 MB, 512 px) fills the gap. It works on a crop around the selection,
     and the result is blended back into the full photo.
   - Quality upgrade if MI-GAN's fill looks smeared: LaMa (Apache, 208 MB). Decided in Phase 0
     from side-by-side results.
2. **Background blur.**
   - The subject mask comes from feature 3's cut-out (U²-Netp).
   - Depth Anything V2 Small (Apache, 27.3 MB, 8-bit) grades the blur, so far things blur more
     than near ones.
   - One strength slider.
   - Shortcut: a mask-only blur, with no depth model, ships first if the depth model misses
     its speed bar.
3. **Face fix.**
   - YuNet (MIT, 0.2 MB) finds the faces.
   - Each face is aligned to 512 px, restored by GFPGAN v1.4, then pasted back with a
     feathered edge.
   - A strength slider blends the restored face with the original.
   - GFPGAN's size and the licences of its listed third-party parts must be checked before
     it's built (its LICENSE says Apache-2.0 "except for the third-party components listed
     below"). If either fails, face fix is dropped and the owner is told.

Out (not possible on this phone): generative fill beyond the eraser's local patch; expanding
a photo past its edges; sky replacement with new content; AI styles and avatars. Also out (my
call): erasing in video; batch processing.

Anti-goals: the eraser invents a visible new object; face fix changes who someone looks like
(the strength slider defaults to 70% so the original shows through); the phone stalls (all
three run off the UI thread with progress and Cancel).

## How it works

- Same path as feature 3: the engine calls `window.native.vision({ op: 'erase' | 'blur' |
  'faces', src, mask? })`. Paths go both ways.
- The eraser brush draws its mask on a separate canvas layer in the engine. That mask is sent
  as a grey PNG next to the image.
- Kotlin `vision/` adds `Erase`, `DepthBlur` and `FaceFix`. Crop, blend, feather and
  alignment maths go in `core/` with JVM tests.
- All models arrive through the model manager on first use.

## Phases

0. **Phone spike:** time MI-GAN at 512 px, SlimSAM encode and decode, Depth Anything V2 Small at
   518 px, YuNet, and GFPGAN at 512 px (if its licence check passes). Compare MI-GAN with LaMa
   on 10 public photos. Pass (est.): eraser ≤ 5 s, tap-select ≤ 2 s, blur ≤ 5 s, face fix ≤
   10 s per face.
1. **Object eraser** (brush, then tap-to-select), Store release.
2. **Background blur,** Store release.
3. **Face fix** (only if Phase 0 clears its licence, size and speed), Store release.

## Acceptance

- AC-1: erasing a small object (≤ 10% of the photo) leaves no visible outline at 100% zoom on the
  Phase 0 set, judged by the owner.
- AC-2: tap-to-select picks the tapped object's outline on the first tap for clear objects.
- AC-3: background blur keeps the subject sharp and blurs the rest; the slider at 0 leaves the
  photo unchanged.
- AC-4: face fix changes only face regions; the slider at 0 leaves the photo unchanged.
- AC-5: every tool can be cancelled, is undoable in one step, and works offline once its model
  has been fetched.
- AC-6: on the Mac, none of these tools are shown.

## Left to the builder

Brush size and feel, crop margins around the mask, blur kernel, face alignment template.

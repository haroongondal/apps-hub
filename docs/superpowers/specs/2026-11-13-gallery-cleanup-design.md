# Clean up the gallery

Date: 2026-11-13. Status: draft for the owner's approval. Feature 2 of 4; shared parts are in
`2026-11-13-image-tools-overview.md`. Builds on feature 1's photo index
(`2026-11-13-photo-search-design.md`).

## Why

Gallery-cleaner apps charge a subscription, or about $60 for a lifetime licence, to find
blurry shots, duplicates and look-alikes and free space. The owner wants the same on the
phone, locally, and set one rule: **it must not delete without my approval.**

## Goal

Open Clean up and see groups of photos worth removing, with the space each group would free.
Untick anything to keep, tap Delete, confirm in Android's own dialog, and the photos go to the
trash, where they can be restored for 30 days.

## Scope

In:
1. **Blurry:** a sharpness score per photo (variance of the Laplacian on a 512 px grey
   thumbnail; no model). A strictness slider, default tuned in Phase 0.
2. **Copies:** exact and resized copies, by a 64-bit difference hash (dHash) with Hamming
   distance ≤ 4 and the same aspect ratio within 2%. No model.
3. **Look-alikes:** bursts and near-identical shots. CLIP vectors from the photo index with
   cosine ≥ a tuned threshold, taken within 10 minutes of each other (my call: the time window
   stops two different days at the same beach from grouping).
4. **Screenshots:** MediaStore `RELATIVE_PATH` contains `Screenshots`. No model.
5. **Too dark or blown out:** mean brightness under 8% or over 95% with low spread. No model.
6. **Keep the best:** in each copies or look-alike group, suggest keeping one photo (sharpest,
   then largest, then oldest) and tick the rest.
7. **Not a mistake:** dismiss a suggestion so it never comes back (stored in the index).

Out (my call): videos; WhatsApp-folder or meme detection; large-file lists; automatic
deletion of any kind, including "auto-clean" schedules.

Anti-goals: a photo deleted without the owner seeing it ticked and confirming; a photo
erased beyond restore; the original file edited.

## How it works

- **One scan, shared with search.** The index job from feature 1 already reads every photo's
  256 px thumbnail. It also computes the dHash, the brightness stats and the sharpness score
  (from a 512 px thumbnail, my call, because blur hides at 256 px). It stores them in the same
  table: about 20 extra bytes per photo. Clean up adds no second pass over the gallery.
- **Grouping** runs in Kotlin over the stored numbers when the tab opens. dHash buckets and
  time-sorted CLIP neighbours keep it under a second for 10,000 photos (est.).
- **Delete:** `MediaStore.createTrashRequest(resolver, uris, true)` (API 30+) gives Android's
  own confirmation dialog. Trashed items are kept by the system for 30 days, and the app never
  calls a permanent delete.
- **Restore:** a "Recently removed" list in Clean up, built from the app's own record of what it
  trashed, with Restore (`createTrashRequest(..., false)`). Phase 0 checks whether HyperOS's
  Gallery also shows MediaStore-trashed photos in its recycle bin. If it doesn't, this list is
  the only way back, and the UI says so.

## Screens (`@apps-hub/ui`, brand `design`)

- **Clean up** (inside the Photos tab from feature 1, a second segment: Search | Clean up):
  rows per group with a count and space ("Blurry · 214 photos · 1.2 GB"), plus "Scan now" and
  the last scan time.
- **Group review:** a grid with ticks, the suggested keeper marked "Best", "Untick all" and
  "Tick all", a strictness slider for Blurry, and a footer "Delete 37 photos (412 MB)".
- **Done:** "37 photos moved to trash. You can restore them for 30 days." plus Undo.

## Phases

0. **Phone and tuning spike:** check how HyperOS's Gallery shows MediaStore trash. Time the
   dHash, brightness and sharpness steps on the phone. Tune the blur threshold on a public
   blurred and sharp set (for example the CERTH image blur dataset) and the look-alike cosine
   on burst sequences.
1. **Engine:** scores in the index job, grouping, keeper choice, the trash record, JVM tests.
2. **Screens and delete flow,** released through the Store.

## Acceptance

- AC-1: no photo leaves the gallery unless it was ticked on screen and the owner confirmed
  Android's dialog (instrumented test plus a manual check).
- AC-2: every deleted photo can be restored from "Recently removed" for 30 days.
- AC-3: copies: a photo and its resized copy (50%) group together; two different photos don't.
- AC-4: blurry: at the default strictness, at least 85% of the test set's blurred photos and at
  most 10% of its sharp photos are flagged.
- AC-5: with the index already built, opening Clean up on 10,000 photos shows groups within 2 s.
- AC-6: no gallery file is modified.

## Left to the builder

The dHash bucket layout, grid details, and how "Not a mistake" is undone.

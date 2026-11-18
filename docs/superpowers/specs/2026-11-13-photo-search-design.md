# Find a photo: on-device photo search in Design Editor (Android)

Date: 2026-11-13. Status: draft for the owner's approval. Owner: Haroon.
Feature 1 of 4; shared parts (runtime, model manager, licences, back-off) are in
`2026-11-13-image-tools-overview.md`. Handoff: `docs/handoffs/photo-search.md`.

## Why

The owner wants the image features that paid apps sell (Google Photos search, gallery cleaners,
Picsart, Remini), but run on the phone with no cloud. They split the work: OCR stays in the PDF
editor (Scan Phase 4, Tesseract, already planned), and everything else goes in Design Editor.
They asked for four groups, in this order: **Find a photo** first, then Clean up the gallery,
then quick edits (palette, enhance, cut-out, upscale), then heavy edits (eraser, portrait blur,
face fix). This document covers only Find a photo. It also builds the background photo scan
and index, which Clean up reuses.

The owner's fixed rules for the whole programme: everything runs locally; nothing is deleted
without their approval (Clean up's concern, recorded here so the shared index never deletes).

## Goal

Type a few words ("dog on the beach", "receipt", "red car at night") and see the matching
photos from the phone's gallery within a second, with no network.

## Scope

In:
1. **Photos tab** in `apps/design-editor-mobile` (Designs | Media | Photos | Queue).
2. **Index:** a background job embeds every gallery photo once (CLIP image encoder) and stores
   the vector. New photos are added and deleted ones dropped on later runs.
3. **Search by words:** the query goes through the CLIP text encoder and is ranked against the
   index. Results show in a thumbnail grid, best match first.
4. **More like this:** from any result, rank the index by that photo's vector (near-free; it
   is also how Clean up will find look-alikes).
5. **Open:** tap a result to view it in the phone's gallery app, or use it in a new design.

Out (my call, each one can come later):
- Group by people (face detection plus face embeddings and clustering): a follow-up once the
  index exists. Needs YuNet (MIT) plus a permissively licensed face embedder (SFace, licence
  to verify). InsightFace's packs are research-only and excluded.
- Object tags: word search already finds objects ("car", "dog"), so separate tags add nothing.
- Text inside photos (OCR search): the owner put OCR in the PDF editor.
- Videos, iOS, the Mac app.

Anti-goals: anything leaves the phone; the app edits or deletes a gallery file; indexing makes
the phone hot or flat (it must back off).

## Decisions

### Model: OpenAI CLIP ViT-B/32, 8-bit ONNX (my call, measured)

Mac spike 2026-11-13 (`onnxruntime` 1.32 CPU, Apple M5, 195 COCO-Karpathy test photos, 976
caption queries, text to photo). **Mac numbers, not phone data.**

| Model (8-bit ONNX) | Licence | Found in top 1 / 5 / 10 | Image ms, 1 thread | Image ms, 2 threads | Text ms | Size MB (image + text) |
|---|---|---|---|---|---|---|
| CLIP ViT-B/32 (`Xenova/clip-vit-base-patch32`) | MIT | 55% / 96% / 99% | 28 | 16 | 12 | 89 + 65 = 154 |
| SigLIP base/16 (`Xenova/siglip-base-patch16-224`) | Apache-2.0 | 52% / 97% / 99% | 111 | 61 | 19 | 99 + 111 = 210 |
| SigLIP 2 base/16 (`onnx-community/siglip2-base-patch16-224-ONNX`) | Apache-2.0 | not measured (download stopped; excluded on size) | | | | 95 + 283 = 378 |

CLIP B/32 is as good as SigLIP on this set, 4× cheaper per photo and the smallest. SigLIP 2's
text half carries a 256k-word vocabulary (283 MB at 8 bits). MobileCLIP 2 is research-only
(Apple licence) and excluded. Upgrade path if real searches disappoint: SigLIP base, same code
with a different tokenizer and preprocessing.

(The spike's top-1 figures were understated by a rounding bug in its ranking; the real CLIP
top-1 is 73%. Top-5 and top-10 were right. Found in Phase 0, 2026-11-16.)

**Phone, measured in Phase 0 (2026-11-16)**, ONNX Runtime 1.32.0 on the Redmi Note 14 Pro 4G:

| | Median ms | Model RAM |
|---|---|---|
| Image, 8-bit, 1 thread on an A76 (1,170 photos in a row) | 106 (first 20: 106, last 20: 121) | 111 MB |
| Image, 8-bit, 2 threads on both A76 (1,170 photos in a row) | 67 (first 20: 58, last 20: 67) | 111 MB |
| Image, 8-bit, 1 thread on an A55 (195 photos) | 478 | 111 MB |
| Text, fp16, 1 thread on an A76, query without padding (976 queries) | 176 (p90 187) | 189 MB |

Model RAM is the process peak minus its size just before the model loads.

So 1,000 photos take about 1–2 minutes on the big cores, or 8 minutes if the scheduler keeps
the job on the little cores (the foreground cpuset is cores 0–7, so a foreground service can
reach the big cores). Over a 1,000-photo-sized run the phone slows by about 15% toward the end
(mild throttling, 31→34 °C), still far inside the bar. Phone vectors match the Mac's
(cosine ≥ 0.9998); 965 of 1,000 caption queries find their photo in the top 5 (AC-2).

**The text half is fp16, not 8-bit** (Phase 0 finding). The 8-bit text model gives different
vectors on the phone than on the Mac (cosine 0.71–0.86): the phone's integer kernels lose more
on CLIP's text activations, dropping top-5 from 96% to 92%. The fp16 text model
(`onnx/text_model_fp16.onnx`, 127 MB) matches full precision exactly on the phone. The image
half stays 8-bit (exact match). Fallback if the download size matters: `text_model_q4f16.onnx`
(72.5 MB, 52 ms, top-5 96%). Queries are fed without padding: tokens up to the first
end-of-text only, which gives the same vector and is about 4× faster.

### Runtime: ONNX Runtime for Android (my call; needs the owner's yes as a new dependency)

`com.microsoft.onnxruntime:onnxruntime-android` (MIT, Maven Central, Java API, no Google
services). It runs the exported files as they are, with no converter and no C++ build. ncnn
is faster on ARM CPUs but needs a model conversion and our own JNI. It is the upgrade path if
indexing is too slow. LiteRT 2.x and ML Kit stay excluded (Play dependencies; see
`docs/pdf-editor/scan/RESEARCH.md`). Check before adding: the AAR size for arm64 only, 16 KB
page alignment, and no Play artifacts in `releaseRuntimeClasspath`.

### Where the code goes (repo pattern)

- **Kotlin owns the work** in `modules/design-media` (new `photos/` package): MediaStore scan,
  thumbnail decode, the two ONNX sessions, the CLIP tokenizer, the vector index and ranking.
  Pure logic (tokenizer, preprocessing maths, ranking, index diffing) sits in `core/` and is
  tested on the JVM.
- **RN only renders:** the Photos tab built from `@apps-hub/ui` (`Screen`, `Header`, `Field`,
  grid, `Notice`), brand `design`. A thin TS adapter over the module, as the media tools do.
- **Indexing runs as a job in the existing `MediaJobService` queue** (foreground, survives
  leaving the app), so it shows in the Queue tab like the media jobs.

### Details (my calls)

- **Permission:** add `READ_MEDIA_IMAGES` (the manifest currently strips it). Android 14+
  "Selected photos" access works too: only the photos the owner granted get indexed, and the tab
  says so with a button to change it.
- **Input:** `ContentResolver.loadThumbnail(uri, 256×256)` (API 29+), not the full photo:
  fast, and CLIP only needs 224 px.
- **Index:** one row per photo in a SQLite table in app storage: MediaStore `_ID`,
  `DATE_MODIFIED`, size, and the 512-float vector stored as 512 bytes (int8, scaled). About
  0.5 MB per 1,000 photos. Loaded into memory for search: 10,000 × 512 dot products is
  under 10 ms. Excluded from backup (the app already sets `allowBackup="false"`).
- **Re-scan:** compare MediaStore against the index; embed only new or changed photos; drop
  gone ones. Runs when the tab opens (if anything changed) and from a "Scan now" button.
- **Back-off:** pause the job when the battery is below 20% and not charging, or when the
  thermal status is severe or higher (`PowerManager.getCurrentThermalStatus`). Resume later.
- **Models download on first use** through the shared model manager (overview doc): "Getting
  the search tool, 216 MB" (89 MB image + 127 MB text) once, pinned URL plus SHA-256, offline after that. This feature
  builds the model manager, the ONNX Runtime setup and the `vision/` package for the
  features after it.
- **Tab layout:** Photos has two segments, Search | Clean up. Clean up arrives in feature 2.
- **Index row** also gets feature 2's numbers (dHash, brightness, sharpness) once that
  feature lands. The table is versioned so adding columns triggers a one-time re-scan.
- **Results:** top 60, with no score shown. Phase 2 on the phone (2026-11-17) showed a fixed
  0.25 floor hides real matches for one-word queries ("sky", "food" found nothing), so: queries of
  3 words or fewer are worded "a photo of …", and a result shows when its score is at least
  max(0.20, best match − 0.05). Measured on 1,000 COCO photos: top hit right for 24 of 25 short
  queries (20 without the wording), no short query left empty, caption search unchanged (true photo
  in the top 5: 76.2% against 76.8% with no cut-off). A floor can't tell a subject that isn't in
  the gallery from one that is (scores overlap), so "No close matches" now shows only when nothing
  clears 0.20. More like this keeps a plain 0.25 floor (photo-to-photo scores run higher).
- **Copy:** sentence case, plain words, no engineering terms in the UI (memory: plain words
  for users).

## Phases

0. **Phone spike (no app change):** run both 8-bit models with ONNX Runtime on the phone through a
   small benchmark binary over adb, as Model Host Phase 0 did. Measure ms per photo at 1 and
   2 threads, peak RAM, and that phone vectors match the Mac's (cosine ≥ 0.99). Pass: ≤ 300 ms
   per photo including the thumbnail, ≤ 400 MB RAM. Fail: try ncnn before changing the model.
1. **Engine:** tokenizer, preprocessing, index and ranking in Kotlin with JVM tests (tokenizer
   ids and image tensors must match the Python reference); the index job in the queue.
2. **Photos tab:** permission flow, scan progress, search box, grid, More like this, open.
   Released through the Store (never adb-installed for the owner's use).

## Acceptance

- AC-1: with the phone in airplane mode, a search returns results.
- AC-2: on the 195-photo COCO set copied to the phone, at least 90% of caption queries find
  their photo in the top 5 (Mac: 96%).
- AC-3: indexing 1,000 photos takes ≤ 5 minutes on the owner's phone, plugged in.
- AC-4: a search over the indexed gallery shows results in ≤ 1 s.
- AC-5: no gallery file is modified or deleted; the app holds no network call in this path.
- AC-6: indexing pauses when hot or low on battery and resumes afterwards.

## Left to the builder

The exact grid layout, thumbnail caching, the int8 scaling scheme, and the job's chunk size.

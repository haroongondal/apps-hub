# Clean up the gallery, Phase 0 results

**Phase 0 done 2026-11-18.** Plan: `2026-11-18-gallery-cleanup-phase-0.md`. Ledger:
`.superpowers/sdd/2026-11-18-image-tools-2.0/progress.md` (git-ignored). No app change.

## Bars and numbers

| Item | Result |
|---|---|
| Blur, AC-4 (>= 85 % blurred, <= 10 % sharp flagged) | **MISS on natural blur.** Laplacian variance on a 512 px grey thumbnail, CERTH evaluation set (1,480 JPEGs). Natural, LANCZOS thumb: t=282.5 flags 66.9 % blurred / 9.8 % sharp; 85 % costs 33.8 % of sharp. Natural, draft+BILINEAR thumb: t=132.1, 62.8 % / 9.8 %. Digital blur: t=365.3, 97.3 % / 10.0 % (PASS, only 30 sharp). Pooled LANCZOS: t=284.1, 81.5 % / 9.9 %. Owner 2026-11-18: keep the careful default plus the strictness slider; AC-4 changes to "at the default, at most 10 % of sharp flagged; the slider reaches 85 % of blurred". |
| Thumbnail filter | Draft+BILINEAR scores are about 0.47x LANCZOS scores: tune the threshold on the phone's own `loadThumbnail` output in 2.1/2.2. |
| Look-alike cosine (no bar) | **0.93** default (precision 0.959 with hard negatives weighted 10:1, recall 0.571, burst recall 0.775); **0.97** strict end (precision 0.981 raw). int8 reads about 0.005 below float. Film shot series, not phone photos: recheck in 2.2. |
| Scores on the phone (512x384 grey input, ART via app_process, 2026-11-18, on battery 30 %, 32 C) | A55 (cpu2, the background cpuset): grey 2.5 + dHash 4.2 + brightness 1.0 + Laplacian 1.8 = **9.6 ms median** (p90 9.8). A76 (cpu6): 3.1 ms. |
| 512 px decode stand-in (BitmapFactory inSampleSize 4 + scale) | A55 **143 ms median**, A76 71 ms. The decode, not the scores, is the cost: on 10,000 photos about 24 min of A55 time on top of the existing 256 px index pass. 2.1 should decode once at 512 px and derive the 256 px CLIP input from it. |
| Phone vs Mac references | Bench check: all 8 fixtures PASS on the phone (dHash and grey hash exact, brightness and Laplacian within tolerance). |
| Trash visibility in HyperOS Gallery | **Not answerable from the shell.** `content` can't pass `android:query-arg-match-trashed` (the colon in the key breaks its binding parser: "Binding not well formed"), so the script stopped before creating anything. Moved to 2.2: the real app trashes a test photo with `createTrashRequest` and the owner looks in Gallery's recycle bin. Phone checked clean afterwards (no folder, no MediaStore rows). |

## Datasets and licences

- Blur: CERTH image blur dataset (https://mklab.iti.gr/results/certh-image-blur-dataset/), terms
  "for use in scientific benchmarking and evaluation"; images kept local, only the threshold
  ships. Owner said fine (2026-11-18).
- Look-alikes: Blender open movies: Tears of Steel (CC BY 3.0), Big Buck Bunny (CC BY 3.0),
  Elephants Dream (CC BY 2.5); 212 shot series of 6 frames.
- Sources and versions: `tools/gallery-cleanup-bench/datasets.md`.

## References for 2.1

`tools/gallery-cleanup-bench/{ref.py,fixtures.py,Bench.java}`, fixtures in
`packages/media-core/fixtures/gallery-cleanup/`. Grey is Pillow "L" (ITU-R 601 fixed point).
Open: the "low spread" cut-off for too dark / blown out is not tuned (spec numbers for now).

## Commits

027d6d9 plan, cbb71a5 references, a33819d look-alike tuning, 9e36362 + 9988649 phone and trash
scripts, c4a3162 blur tuning, this note.

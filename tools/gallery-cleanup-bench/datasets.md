# Clean up Phase 0 datasets

## Look-alikes

Task 3, `lookalike_tune.py` (run with `-I`; `extract` needs `av`, `tune` needs only numpy, onnxruntime and Pillow).
Downloads live in the git-ignored `.superpowers/sdd/2026-11-18-image-tools-2.0/dl/<name>/`; no images or models are committed.

Source: three Blender open movies, cut into shots, frames stored as JPEG. Licence read on each project's own page.

| Film | File (bytes) | Licence, where read |
| --- | --- | --- |
| Tears of Steel | https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov (372,178,639) | CC BY 3.0, https://mango.blender.org/sharing/ |
| Big Buck Bunny | https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_640x360.m4v.zip (121,284,117) | CC BY 3.0, https://peach.blender.org/about/ |
| Elephants Dream | https://download.blender.org/ED/elephantsdream-720-h264-st-aac.mov (152,496,338) | CC BY 2.5, https://orange.blender.org/license/ |

Used: 212 series (shots of 2.6 s or more, not near-black: 82 + 64 + 66), 6 frames each, 1,272 photos. Per series: a burst of 4 frames
0.15 s apart plus 2 re-takes at +1.2 s and +2.0 s. Shots come from a cut detector (mean grey difference over 25 on a 64x36 frame),
so a few "series" are one real shot split in two and a few distinct shots of one scene are labelled apart; both lower the measured precision.

Skipped: Automatic Triage for a Photo Series (phototriage.cs.princeton.edu does not answer from here, so no licence could be read; a research
dataset); Google HDR+ bursts (CC BY-SA 4.0 but raw DNG frames in hundreds of GB); Wikimedia Commons series (commons.wikimedia.org resets the
connection from this machine, so no capture times or per-file licences could be read); Sintel (680 MB for the same kind of data).

Vectors are made as the phone index makes them (256 px fit, `tools/photo-bench/ref.py` prep, ONNX Runtime 1 thread, int8 quantize like
`PhotoIndex.kt`), model `Xenova/clip-vit-base-patch32` @ 6b7c523, sha256 verified. Hard negatives: other shots of the same film at most 10 min
apart (268,664 pairs); easy negatives: other films (535,824); positives 3,180 pairs (1,272 burst pairs). Rule: highest recall with precision
against hard negatives >= 0.95.

| Cosine | recall (all) | recall (burst) | precision, hard | precision, hard at 10:1 | precision, easy |
| --- | --- | --- | --- | --- | --- |
| 0.90 | 0.763 | 0.908 | 0.504 | 0.896 | 0.988 |
| 0.92 | 0.647 | 0.837 | 0.663 | 0.943 | 0.993 |
| 0.93 | 0.571 | 0.775 | 0.736 | 0.959 | 0.994 |
| 0.95 | 0.383 | 0.585 | 0.854 | 0.980 | 0.996 |
| 0.96 | 0.276 | 0.450 | 0.915 | 0.989 | 0.997 |
| 0.97 | 0.164 | 0.278 | 0.981 | 0.998 | 0.998 |
| 0.98 | 0.062 | 0.108 | 0.995 | 0.999 | 1.000 |

(int8 vectors; "hard at 10:1" weights the hard negatives down to ten hard pairs per positive pair, as a sparser gallery would have.)
Chosen by the rule: **0.97** (precision 0.981, recall 0.164; burst recall 0.278). With the 10:1 weighting the rule gives 0.93 (precision 0.959,
recall 0.571). Float vectors give the same choices (0.97 raw with precision 0.957, 0.93 weighted); int8 cosines read about 0.005 lower
at the same pair, so quantisation does not move the threshold. Caveat: CGI and film footage, not phone photos; run `lookalike_tune.py tune` for the full table.

## Blur

Task 2, `blur_tune.py` (run with `-I`; needs only numpy and Pillow; usage in its docstring). Scores are cached in the git-ignored
`.superpowers/sdd/2026-11-18-image-tools-2.0/blur-cache.json`; no images are committed.

Source: the CERTH image blur dataset (Mavridaki and Mezaris, ICIP 2014), https://mklab.iti.gr/results/certh-image-blur-dataset/ (page dated
2013-11-01; the file is https://mklab.iti.gr/files/imageblur/CERTH_ImageBlurDataset.zip, about 2 GB, 2,450 images in all).

Licence: not an open licence. The page's copyright notice, read on that page on 2026-11-18, says: "The images distributed as part of the CERTH
image blur dataset were captured by members of the ITI team. The copyright of each image remains with the corresponding photographer. They are
provided to the scientific community as part of the CERTH image blur dataset for use in scientific benchmarking and evaluation of research
works." Asked to cite Mavridaki and Mezaris, "No-Reference blur assessment in natural images using Fourier transform and spatial pyramids",
ICIP 2014. Scoring a threshold against it is benchmarking and evaluation, so this use is allowed; the images are used locally only and never
committed or redistributed.

Used: the evaluation set only, 1,480 photos (3 to 10 megapixels, JPEG, mostly 3872x2592 and 3648x2736): the natural blur set (411 blurred,
589 sharp; the labels count matches the page) and the digital blur set (450 blurred, 30 sharp; the 30 sharp are the originals of the 450, blurred
with Gaussian, motion and disk filters). Labels come from NaturalBlurSet.xlsx and DigitalBlurSet.xlsx in the zip (1 = blurred, -1 = sharp; the
natural sheet lists names without ".jpg"). Fetched by reading the zip's central directory, then HTTP range requests for the EvaluationSet
entries only, each CRC-32 checked, into `.superpowers/sdd/2026-11-18-image-tools-2.0/dl/certh-blur/eval/`; the training set was not downloaded.

Score: variance of the Laplacian on the 512 px grey thumbnail (`ref.py`), flagged when below the threshold. Two thumbnails because the phone's
`ContentResolver.loadThumbnail` filter is not Pillow: (a) full decode, `thumb512` with LANCZOS; (b) JPEG-like, `draft` scale then BILINEAR.
Rule (R7): the threshold with the most blurred flagged while at most 10% of the sharp are flagged.

| Set, filter | default threshold | blurred flagged | sharp flagged | AC-4 (85% / 10%) | threshold for 85% blurred, sharp flagged there |
| --- | --- | --- | --- | --- | --- |
| natural, a | 282.5 | 66.9% | 9.8% | MISS | 592.4, 33.8% |
| natural, b | 132.1 | 62.8% | 9.8% | MISS | 298.8, 36.0% |
| digital, a | 365.3 | 97.3% | 10.0% | PASS | 182.7, 3.3% |
| digital, b | 182.0 | 96.9% | 10.0% | PASS | 96.1, 3.3% |
| pooled, a | 284.1 | 81.5% | 9.9% | MISS | 346.5, 15.5% |
| pooled, b | 133.7 | 79.0% | 9.9% | MISS | 174.5, 17.0% |

Read it as: on real, naturally blurred photos the variance of the Laplacian alone does not reach AC-4. At 85% blurred caught it flags a third of the
sharp photos (natural); at 10% sharp flagged it catches about two in three blurred. The digital set passes easily but has only 30 sharp photos
(so 10% is three photos) and its blur is uniform and strong, so it is weak evidence; the natural set is the one that matters. The slider has
to carry the trade: the pooled curve (filter a) runs 46.9% blurred / 0.6% sharp at t = 79, 64.3 / 3.1 at 139, 78.2 / 8.1 at 244, 89.7 / 20.2 at 427
(full curves of 14 thresholds per set and filter: `python -I blur_tune.py <eval dir>`).

Filter sensitivity: the default moves a lot. Scores from the draft plus BILINEAR thumbnail are about half those of the LANCZOS one (default b / a
= 0.47 natural, 0.50 digital), because a bilinear downscale is smoother. Applying the filter-a threshold to filter-b scores flags 34% of the
sharp photos (natural) instead of 10%. So the threshold has to be set against the same thumbnail the phone makes (or rescaled by about 0.47);
a number tuned here on Pillow LANCZOS would over-flag on a bilinear thumbnail.

Low-texture sharp photos (Review Focus 3, grey spread below 0.08): of the 58 natural sharp photos flagged at the default, 1 (filter a;
`Original_84`, spread 0.035) or 2 (filter b; `Original_84`, `Original_85`) are low-texture. Flat images are not the main cause of the false flags; the rest
are ordinary sharp photos with low Laplacian variance (shallow depth of field, smooth subjects), which this score cannot tell from blur.

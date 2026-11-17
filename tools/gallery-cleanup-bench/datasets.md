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

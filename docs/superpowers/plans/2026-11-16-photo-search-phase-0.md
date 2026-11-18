# Find a photo, Phase 0 (phone spike) Implementation Plan

> **Execution:** run inline in the session (superpowers:executing-plans). If subagents are used,
> use `cd-engineering-tools:parallel-agents-coord`, never `superpowers:subagent-driven-development`
> (owner's global rule). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure CLIP ViT-B/32 8-bit (image and text halves) under ONNX Runtime 1.32.0 on the
owner's phone (speed, peak RAM, vectors match the Mac), with no app change, and decide pass/fail.

**Architecture:** The Mac does everything that is not inference: preprocessing and tokenising
(Python, the spike's exact code), Mac reference vectors, scoring. A small C++ binary built with
the NDK against the AAR's own `libonnxruntime.so` (the same library the app will load) runs the
pre-made tensors on the phone from `/data/local/tmp` over adb and writes the raw vectors back.

**Tech Stack:** Python 3 venv (numpy 2.5.4, onnxruntime 1.32.0, pillow 13.0.0, tokenizers
0.23.3); C++17, NDK 27.1.12297006 clang, ORT C++ API from `onnxruntime-android-1.32.0.aar`; adb.

**Spec:** `docs/superpowers/specs/2026-11-13-photo-search-design.md` (Phases → 0). Handoff:
`docs/handoffs/photo-search.md`.

## Global Constraints

- Pass: ≤ 300 ms per photo including the thumbnail, ≤ 400 MB RAM; phone vectors match the Mac's (cosine ≥ 0.99).
- Fail path: try ncnn before changing the model (not part of this plan; a fail stops here and is recorded).
- No app install, no app change; files only in `/data/local/tmp/pb`; removed at the end (`phone.sh clean`).
- Claim `device:49kjmnuwonkffqzh` with coord before the first adb command; release it right after.
- USB adb only (Wi-Fi copies at ~1 MB/s; the image tensor file is 117 MB).
- ONNX Runtime version 1.32.0 on both sides (Mac pip wheel and Android AAR).
- Commit only when the owner asks (handoff rule). Never add Claude attribution lines (memory).
- Models and data are not committed (154 MB models; COCO photos).

## Inputs already on disk (verified 2026-11-16)

`OLD=/private/tmp/claude-501/-Users-outsentia-Documents-apps-hub/0ff8705f-eeac-4ba4-be91-6cdf10464652/scratchpad`

- `$OLD/models/clip/{vision,text}_model_quantized.onnx`, `tokenizer.json`, `preprocessor_config.json`
  (Xenova/clip-vit-base-patch32). Vision: in `pixel_values` [N,3,224,224] f32 → out `image_embeds` [N,512].
  Text: in `input_ids` [N,L] i64 only (no attention mask) → out `text_embeds` [N,512].
- `$OLD/data/set.json` (200 rows `{file,url,caps[5]}`), `$OLD/data/img/` (195 present).
- `$OLD/venv` with the four packages above. `$OLD/tools/spike.py` (preprocessing + tokeniser reference).
- AAR unpacked at `SP=/private/tmp/claude-501/-Users-outsentia-Documents-apps-hub/9a4f08c8-052b-45c2-8ffb-5ce240a5ab48/scratchpad/aar/x`
  (`headers/`, `jni/arm64-v8a/libonnxruntime.so`).

If `$OLD` is gone (tmp cleared): models via `$OLD/tools/fetch.sh` logic (HF `Xenova/clip-vit-base-patch32`),
photos from each row's `url`. Do not re-run the SigLIP models.

Dependency checks already done (2026-11-16, AAR 1.32.0): arm64 `libonnxruntime.so` 36.3 MB
(13.7 MB gzipped), all LOAD segments aligned 0x4000 (16 KB), NEEDED only libdl/liblog/libandroid/
libm/libc (C++ runtime static), POM lists no dependencies (so no Play artifacts).

## Review Focus

1. Thumbnail cost is not measurable without an app: Phase 0 passes on inference ≤ 250 ms per photo,
   leaving 50 ms for `loadThumbnail` that Phase 1 confirms on the phone. Recorded in the handoff.
2. The queue runs as a foreground service, not the top app, so its threads may be held to the
   little cores. Task 3 records `/dev/cpuset/{foreground,background,top-app}/cpus` and an A55-only run.
3. Thermal throttling on a long run: the 195-photo pass runs back to back; Task 3 records battery
   temperature before and after and compares the first and last 20 photos' times.
4. Text-encoder latency (search must answer in ≤ 1 s, AC-4): Task 3 times all 976 queries at 1 thread.
5. Wrong tensor layout or byte order would still produce "plausible" vectors: Task 2's smoke test
   checks cosine against the Mac on the first 3 photos and 3 queries before any timing run.

---

### Task 1: Mac reference and scoring

**Files:**
- Create: `tools/photo-bench/ref.py`, `tools/photo-bench/score.py`, `tools/photo-bench/requirements.txt`

**Interfaces:**
- Produces, in an out dir `W` (session scratchpad `pb/`), all little-endian raw arrays:
  - `images.f32`: N×3×224×224 float32, N = photos present (195), in `set.json` order.
  - `texts.i64`: Q×77 int64 token ids (Q = 976 = all captions of present photos).
  - `texts.idx`: Q int32, the photo index each caption belongs to.
  - `mac_img.f32` N×512, `mac_txt.f32` Q×512: raw (unnormalised) Mac outputs, ORT 1 intra-op thread.
- `score.py <W> <phone_img.f32> <phone_txt.f32>` prints one line per check (see Step 3).

- [ ] **Step 1: Write `score.py --self-test` first**

`rank(img: np.ndarray, txt: np.ndarray, idx: np.ndarray) -> np.ndarray` (rank of the true photo
per query, 0 = best, computed on L2-normalised vectors as in spike.py:
`(imgs @ t > imgs[i] @ t).sum()`). Self-test asserts, on 3 photos e0,e1,e2 (unit axes in 512-d)
and 2 queries `[e1, 0.9*e2+0.1*e0]` with idx `[1, 0]`: ranks `[0, 1]`; recall@1 = 0.5,
recall@5 = 1.0; `cos(a, a) == 1.0`.

- [ ] **Step 2: Run** `$OLD/venv/bin/python -I tools/photo-bench/score.py --self-test` → FAIL (no `rank`), then implement, → prints `self-test ok`.

- [ ] **Step 3: Implement `score.py` main**

Prints:
- `image cosine phone/mac: min=… mean=…` and `text cosine phone/mac: min=… mean=…` (per-row cosine of raw outputs).
- `recall@1/5/10 (phone vectors): …` over the Q queries.
- `true-photo score p5/p50: …` (cosine of each query with its own photo) and
  `best other-photo score p50/p95: …` (best cosine among the other photos). Floor proposal = true-photo p5.
- Exit 1 if either min cosine < 0.99 or recall@5 < 0.90 (AC-2), else 0.

- [ ] **Step 4: Implement `ref.py <clip_dir> <data_dir> <out_dir>`**

Preprocessing and tokeniser copied verbatim from `$OLD/tools/spike.py` (`prep()`; CLIP branch:
truncation 77, padding length 77 with pad id 49407, caption `.strip()`, no lowercasing). Sessions
with `intra_op_num_threads=1`, `inter_op_num_threads=1`, CPU provider. Writes the five files above
with `ndarray.astype(...).tofile()`.

- [ ] **Step 5: Verify the pipeline end to end on the Mac**

Run:
```bash
W=$SCRATCH/pb; mkdir -p $W
$OLD/venv/bin/python -I tools/photo-bench/ref.py $OLD/models/clip $OLD/data $W
$OLD/venv/bin/python -I tools/photo-bench/score.py $W $W/mac_img.f32 $W/mac_txt.f32
```
Expected: sizes `images.f32` 117,411,840 B and `texts.i64` 601,216 B; cosines `min=1.000`;
recall@1/5/10 within 0.005 of the spike's 0.554 / 0.963 / 0.991; exit 0.

- [ ] **Step 6: `requirements.txt`** pins `numpy==2.5.4 onnxruntime==1.32.0 pillow==13.0.0 tokenizers==0.23.3`.

### Task 2: Phone benchmark binary

**Files:**
- Create: `tools/photo-bench/bench.cpp`, `tools/photo-bench/build.sh`, `tools/photo-bench/phone.sh`

**Interfaces:**
- Consumes: Task 1's `images.f32`, `texts.i64`, `mac_*.f32`.
- Produces: `clip-bench <model.onnx> <input.bin> <image|text> <threads> <out.f32>`:
  - image: input rows of 3×224×224 f32 → name `pixel_values`, output `image_embeds`;
    text: rows of 77 i64 → `input_ids`, output `text_embeds`. N = file size / row size; reject a remainder.
  - One row per `Run` (batch 1, as the app's job will run), 2 warm-up runs on row 0 not timed.
  - Session: `SetIntraOpNumThreads(threads)`, `SetInterOpNumThreads(1)`, `ORT_ENABLE_ALL`.
  - stdout one line: `load_ms=… n=… median_ms=… p90_ms=… first20_ms=… last20_ms=… vm_hwm_kb=…`
    (`VmHWM` read from `/proc/self/status` at exit; first20/last20 are medians of those slices).
  - Writes N×512 raw float32 to `out.f32`.
- `phone.sh` (pattern from Model Host's `tools/model-bench/phone.sh` on branch `model-host`):
  `push` (binary, `libonnxruntime.so`, both models, the input files to `/data/local/tmp/pb`;
  fail early if `df` free space < files + 500 MB), `run <vision|text> <threads> <cpu-mask> <tag>`
  (`cd /data/local/tmp/pb; LD_LIBRARY_PATH=. taskset <mask> ./clip-bench …`, then `adb pull` of
  `out-<tag>.f32` into `$W`), `info` (cpu max freqs, cpuset cpus, battery temp/level/plugged),
  `clean` (`rm -rf /data/local/tmp/pb`). Requires `ANDROID_SERIAL` and checks the device is listed.

- [ ] **Step 1: `build.sh <aar_dir> <out_dir>`** compiles with
`$NDK/toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android28-clang++ -O2 -std=c++17
-I<aar>/headers bench.cpp -L<aar>/jni/arm64-v8a -lonnxruntime -static-libstdc++
-Wl,-z,max-page-size=16384 -o <out>/clip-bench` and strips it.
Verify: `llvm-readelf -d clip-bench | grep NEEDED` lists `libonnxruntime.so` and no `libc++_shared.so`.

- [ ] **Step 2: Claim the phone and find the USB device**

`coord claim device:49kjmnuwonkffqzh "photo-search Phase 0 benchmark in /data/local/tmp, no install"`.
Exit 3 → follow the queue procedure. Then `ANDROID_SERIAL` = the `adb devices` entry whose
`getprop ro.serialno` is `49kjmnuwonkffqzh` and that is not an `_adb-tls-connect` / `ip:port` entry.
No USB entry → ask the owner to plug the phone in.

- [ ] **Step 3: Smoke test on 3 rows** (wrong layout/byte order check, Review Focus 5)

Make `img3.f32`/`txt3.i64` (first 3 rows via `head -c`) and push them; run both kinds at 1 thread;
compare to the first 3 Mac rows with a numpy one-liner. Expected: every cosine ≥ 0.99. Otherwise
stop and debug before Task 3.

### Task 3: Phone runs and verdict

- [ ] **Step 1:** `phone.sh info` → record big/little core ids (expected 2× A76 at 2.2 GHz =
mask of the two highest `cpuinfo_max_freq` cpus), the three cpuset lists, battery temperature and level.
Phone plugged in over USB, screen off, let it cool if battery temp > 35 °C.

- [ ] **Step 2: Runs** (each prints its stdout line; keep all lines):

| tag | kind | threads | cores |
|---|---|---|---|
| img-a76-1 | vision | 1 | one A76 |
| img-a76-2 | vision | 2 | both A76 |
| img-a55-1 | vision | 1 | one A55 (worst case for a non-top-app process) |
| txt-a76-1 | text | 1 | one A76 |

Then `phone.sh info` again (temperature after).

- [ ] **Step 3: Score:** `score.py $W $W/out-img-a76-1.f32 $W/out-txt-a76-1.f32` → expect exit 0.

- [ ] **Step 4: Verdict.** Pass when: image `median_ms` ≤ 250 in the best A76 configuration
(Review Focus 1), every `vm_hwm_kb` ≤ 400 MB, score exit 0. Also note: whether
the queue's cpuset (foreground) includes the A76 cores; A55 ms × 1,000 photos vs AC-3's 5 minutes;
text median vs AC-4; first20 vs last20 drift.

- [ ] **Step 5:** `phone.sh clean`, `coord release device:49kjmnuwonkffqzh`, tell the next queued session.

### Task 4: Record

- [ ] **Step 1:** Handoff: add the measured table and verdict to "Evidence already verified",
the similarity-floor proposal and the cpuset finding to "Decisions made", a session-log line,
and the next step (Phase 1 plan if pass; ncnn trial if fail).
- [ ] **Step 2:** Design doc: replace "Phone estimate (to be measured in Phase 0)" with the measured numbers.
- [ ] **Step 3:** Ask the owner whether to commit `tools/photo-bench/`, the five designs, this plan and the handoff.

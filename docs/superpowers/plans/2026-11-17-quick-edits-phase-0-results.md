# Quick edits, Phase 0 results

**Phase 0 done 2026-11-18. Cut-out (U2-Netp and MODNet) PASS. 4x upscale MISS (about 156 s against 30 s): owner decision needed.**

Phone run 2026-11-18 (`stageb.sh`, ORT 1.32.0, Wi-Fi adb, on battery 66->64 %, 31.2->33.7 C). Phone outputs match the Mac to max 7.8e-5 (U2), 1.3e-5 (ESRGAN), 9.9e-6 (MODNet). `/data/local/tmp/it` removed, claim released.

Plan: `2026-11-17-quick-edits-phase-0.md`. No app change in this phase.

## Bars

| Bar | Result | What will measure it |
|---|---|---|
| Cut-out <= 2 s (U2-Netp 320 px, pre + model + post) | **PASS**: 2 threads median 1182 ms (p90 1377) + pre 24 + feather/upscale 128 + write 13 = **about 1.35 s** (p90 about 1.55 s; first use adds 141 ms load). 1 thread: 1894 ms model alone. Model RAM 410 MB | `stageb.sh` |
| Person cut-out (MODNet fp32 512x672) <= 2 s | **PASS**: 2 threads median 1315 ms (p90 1337) + post about 164 = **about 1.48 s** (load 160 ms). 1 thread 2394 ms. Model RAM 274 MB | `stageb.sh` |
| 4x upscale of a 1080 px photo <= 30 s (2 threads, A76) | **MISS**: T=176 tile median 1925 ms x 81 tiles = **about 156 s**; T=160 1604 ms x 100 tiles = about 160 s. Overlap 24 stays (T=176 is the faster total). Model RAM 59 MB, no throttling over 81 runs | `stageb.sh` |

Tile counts for the upscale bar (128 px cores): 81 tiles for 1080x1080, 63 for 1080x810, 108 for 1440x1080. Multiply the per-tile median by the tile count.

## Model sources

| Model | URL | SHA-256 | Bytes | Licence |
|---|---|---|---|---|
| U2-Netp ONNX | https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx | `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8` | 4574861 | Apache-2.0 weights (xuebinqin/U-2-Net LICENSE at ac7e1c8; rembg README at 991927b says weights carry their own licence; rembg's MIT code pins md5 8e83ca70e441ab06c318d82300c84806, which matches). GitHub publishes no digest for the asset. |
| Real-ESRGAN general-x4v3 `.pth` (source for our export) | https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth | `8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292` | 4885111 | BSD-3-Clause (LICENSE at a4abfb2) |
| Real-ESRGAN ONNX, our export, T=176 (chosen) | No host yet | `1c1bda585a8b044760e807d4e454b0a2f4bf0c0f0096ff4d8046c422e54f5ce0` | 4866394 | BSD-3 (derived) |
| MODNet fp32 | https://huggingface.co/Xenova/modnet/resolve/fa2fa546052fba4c08921230a26cc69a333fca12/onnx/model.onnx | `07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9` | 25888640 | Apache-2.0 (HF card) |

Our ESRGAN export is made by `tools/quick-edits-bench/export_esrgan.py` (torch 2.15.0, opset 17, fixed 1x3x176x176 in, 1x3x704x704 out, strict load of key `params`). ONNX against torch max diff is 5.4e-6. The export is reproducible byte for byte. T=160 was also exported (`e47fb5c4f58115d0e87dc42ea7ca932575c11bd2f89f930616925da460a8f4b9`, 4866394 B) and not chosen.

No pinnable ready-made Real-ESRGAN ONNX exists. `qualcomm/Real-ESRGAN-General-x4v3` (HF rev deb4baa, bsd-3-clause card) keeps no ONNX in the repo; its `release_assets.json` points to an S3 zip.

Rejected: MODNet 8-bit. `model_uint8.onnx` (`7bad6522b3cde60246e69e234b7786337ef9c88abc790ee5c1aaa6e535b0c61d`, 6627048 B) and `model_quantized.onnx` (`92e49898c3e05a6d7a944fc67a8cb87c4aad754ffb6ebd949528c7d1105fee3a`, 6632188 B), same revision. Matte against fp32: mean absolute difference 0.07 to 0.40, max 1.0, on all 5 people photos. On 2 photos most of the person is deleted. fp16 (12.98 MB, `25f165da9bfd30830a575f1f0490f1acd995975cb349bc02f3d79332e1fe5cf6`) is untested.

## Edge quality

Contact sheet (git-ignored; kept at `/Users/outsentia/Documents/apps-hub/.claude/worktrees/image-tools/.superpowers/sdd/2026-11-17-image-tools-3.0/contact-sheet.png`): 10 COCO val2017 photos, CC BY 2.0 or CC BY-SA 2.0, sources in `tools/quick-edits-bench/photos.json`. The photos are 480 to 640 px, so they are a fair proxy for the 320 px mask but not for 12 MP edges. Per photo, U2-Netp first, then MODNet (people only).

- 459272 people: U2 keeps her whole with clean curly hair, but keeps the crowd behind her. MODNet removes the crowd, hair clean.
- 544519 people: U2 fades the hand and body to a grey haze with a halo; not usable. MODNet gives a solid hand, toothbrush and shirt.
- 175251 people: U2 smears the top of the hair into a faded streak (halo). MODNet gives crisp hair.
- 284991 people: both keep arm, bottle and head. U2 has a slight halo, MODNet is slightly cleaner.
- 488710 people: U2 keeps the "Princess parking" sign and cuts her side; fails. MODNet keeps only the person.
- 248631 product (laptop and trackball): U2 good, slightly soft edge, contact shadow gone.
- 167353 product (wall clock): U2 keeps the clock whole but keeps its cast shadow as a crescent ghost.
- 355610 product (plush toys): U2 keeps both, soft fur edge, faint ghost patches lower left.
- 331075 pet (dog): U2 best result, whole dog, clean wet fur.
- 392818 pet (spaniel): U2 keeps face, ears and harness; lower part hazy.

Verdict: U2-Netp is good enough for pets and products (2 shadow or ghost faults). It is not good enough for people (2 of 5 fail, halos on 2 more). MODNet fp32 fixed every people failure.

Suggestion for 3.2 (the owner decides): U2-Netp for objects and pets plus MODNet fp32 (25.9 MB) for people, or MODNet only behind a "Person" option. MODNet phone timing is still needed.

## References for Phase 3.2

For the Kotlin JVM tests: `tools/quick-edits-bench/{ref.py,fixtures.py,export_esrgan.py,requirements.txt}`. Fixtures are in `packages/media-core/fixtures/quick-edits/` (2.87 MB; README there).

- U2 prep: Pillow LANCZOS resize to 320x320 (the exact Pillow 13 recipe is in the `ref.py` docstring; a float Lanczos-3 port lands within 0.12 on the tensor and +-3 steps on the mask; bilinear is far off). Divide by the max of the resized image, then ImageNet mean and std.
- U2 post: first output, min-max (float32). Mask resized bilinear with half-pixel centres to the photo size, Gaussian feather sigma 2 px (radius 6), `floor(255x + 0.5)`.
- Upscale: 128 px cores, overlap 24 (T=176), reflect padding (formula in the docstring), crop x4, stitch.
- Overlap choice, measured as the seam band (+-8 px around interior seams, at least 40 px from the border, max over RGB, in 0..255 steps): overlap 8 gives 20.0, 16 gives 10.4, 24 gives 0.82, 32 gives 0.002. 24 is the smallest with seam max <= 1 step. It costs 21% more work per tile than 16.
- Fixtures are deterministic (three runs identical; the controller re-ran them too). A mutation check catches a row-offset bug and single-bounce reflect. The clamped single-bounce variant differs by only 2 steps, so Kotlin tests should compare exactly or within +-1.
- Open for 3.2: add a downscale `u2_prep` fixture (the current one upscales 300x200 to 320). The reference does not upscale alpha.

Bench tools: `tools/quick-edits-bench/{bench.cpp,build.sh,phone.sh}` (commit 5be0796). `qe-bench` runs any fixed-shape ONNX with timing and peak RAM (VmHWM). Its `post` mode times a 4000x3000 preprocess downscale plus mask upscale and feather in C++.

## Owner decisions needed

1. Hosting for our Real-ESRGAN export (4.87 MB): mirror it in the Store bucket, because no upstream ONNX can be pinned.
2. Cut-out model for people: MODNet fp32 (25.9 MB, HF-pinned, Apache) next to U2-Netp, given the edge results. Decide after the phone timing.
3. Licence: the COCO photos are test data only and are not shipped.

## Exact next step

Owner decides what to do about the upscale miss. The phone step below is done; it stays as the re-run recipe.

## Phone re-run recipe

When the phone is back on adb and `device:49kjmnuwonkffqzh` is claimed with coord:

```
ANDROID_SERIAL=<adb serial> $SP/qe-in/stageb.sh
```

`$SP` is `/private/tmp/claude-501/-Users-outsentia-Documents-apps-hub/59f261bd-5a4e-4cc8-b4c5-3fcf059a633b/scratchpad`. This is a temporary folder of the session that did the Mac work. If it is gone, rebuild the inputs with `tools/quick-edits-bench` and Task 3 of the plan.

The script:

- pushes 83.4 MB (binary, ORT 1.32.0 lib, U2-Netp, ESRGAN T=176 and T=160, MODNet fp32, inputs) to `/data/local/tmp/it`;
- runs U2 on 1 thread (cpu6) and 2 threads (cpu6-7) x30, ESRGAN T=176 and T=160 on 2 threads x81, MODNet on 2 and 1 threads x10, and `post` on cpu6;
- reads the battery before and after, and compares phone outputs with the Mac outputs;
- removes the folder when it ends (trap).

Then fill the two bars above and release the claim.

## Commits on `image-tools` for this phase

f50b7ae (plan), 5be0796 (bench), abaae1d, 5ba74fb and 1710cc3 (references, fixtures, export), de96f3e and eac988a (photos.json, sheet.py).

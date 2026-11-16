"""Reference fixtures for the Kotlin U2-Netp cut-out and Real-ESRGAN tiling (Phase 3.2 tests).

usage: fixtures.py <u2netp.onnx> <realesr-general-x4v3 fixed-T onnx> <out_dir>
The Real-ESRGAN model must be the fixed 1x3xTxT export with T = 128 + 2 * ref.OVERLAP.
Writes u2_input.png/.f32, u2_pred.f32, u2_mask.png, esrgan_input.png, esrgan_out.png,
esrgan_thin_input.png, esrgan_thin_out.png, esrgan_tiles.json and README.md;
.f32 files are raw little-endian float32. ORT on 1 thread.
"""
import json
import os
import sys
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I drops the script dir
from ref import FEATHER, OVERLAP, SCALE, TILE, synth, tiles, u2_mask, u2_norm, u2_prep, upscale  # noqa: E402

T = TILE + 2 * OVERLAP
# (name, w, h, seed): 300x200 is a 3x2 grid with partial cores on both axes and a tile with
# neighbours on both sides; 129x20 needs mirroring that bounces more than once (1 px core, 20 px side).
ESRGAN = [("esrgan", 300, 200, 6), ("esrgan_thin", 129, 20, 8)]
README = f"""Made by tools/quick-edits-bench/fixtures.py (do not edit by hand).
Command: fixtures.py <u2netp.onnx> <realesr-general-x4v3 T={T} onnx> packages/media-core/fixtures/quick-edits
Maths: tools/quick-edits-bench/ref.py (its docstring has the exact pre/post steps and the reflect formula).
numpy 2.5.4, onnxruntime 1.32.0 (CPU, 1 thread), Pillow 13.0.0.
Models (not in git): u2netp.onnx sha256 309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8;
realesr-general-x4v3 (export_esrgan.py, T={T}) sha256 1c1bda585a8b044760e807d4e454b0a2f4bf0c0f0096ff4d8046c422e54f5ce0.

U2-Netp (non-square on purpose, so a mask left square or stretched fails):
- u2_input.png   300x200 RGB, seeded synthetic (ref.synth seed 5 plus a centred ellipse).
- u2_input.f32   1x3x320x320, ref.u2_prep(u2_input.png).
- u2_pred.f32    320x320, first model output after min-max (ref.u2_norm).
- u2_mask.png    300x200 L, ref.u2_mask(pred, 300, 200, feather_px={FEATHER}).
Real-ESRGAN general-x4v3, tile {TILE}, overlap {OVERLAP}, T {T}, scale {SCALE}:
- esrgan_input.png / esrgan_out.png            300x200 -> 1200x800, 3x2 tiles, partial cores on both axes.
- esrgan_thin_input.png / esrgan_thin_out.png  129x20 -> 516x80, 2 tiles, mirroring bounces several times.
- esrgan_tiles.json  per case: the ref.tiles list [x, y, x0, y0, x1, y1] (input window top-left,
  may be negative; then the core it fills, in input px).
"""


def sess(path):
    o = ort.SessionOptions(); o.intra_op_num_threads = 1; o.inter_op_num_threads = 1
    return ort.InferenceSession(path, o, providers=["CPUExecutionProvider"])


def save_png(img, path):
    img.save(path)
    return Image.open(path)  # read back so every later step sees exactly the stored pixels


def main(u2_model, esrgan_model, out):
    os.makedirs(out, exist_ok=True)
    p = lambda n: os.path.join(out, n)

    u2 = synth(300, 200, 5)
    ImageDraw.Draw(u2).ellipse((95, 35, 205, 175), fill=(220, 60, 40), outline=(20, 20, 20), width=3)
    u2 = save_png(u2, p("u2_input.png"))
    x = u2_prep(u2)
    x.astype("<f4").tofile(p("u2_input.f32"))
    pred = u2_norm(sess(u2_model).run(None, {"input.1": x})[0])
    pred.astype("<f4").tofile(p("u2_pred.f32"))
    mask = u2_mask(pred, u2.width, u2.height, FEATHER)
    Image.fromarray(mask, "L").save(p("u2_mask.png"))

    es, cases = sess(esrgan_model), []
    for name, w, h, seed in ESRGAN:
        img = save_png(synth(w, h, seed), p(f"{name}_input.png"))
        up = upscale(es, img, TILE, OVERLAP)
        up.save(p(f"{name}_out.png"))
        cases.append({"input": f"{name}_input.png", "output": f"{name}_out.png", "w": w, "h": h,
                      "tiles": [list(r) for r in tiles(w, h, TILE, OVERLAP)]})
    json.dump({"tile": TILE, "overlap": OVERLAP, "T": T, "scale": SCALE, "cases": cases},
              open(p("esrgan_tiles.json"), "w"), indent=1)
    open(p("README.md"), "w").write(README)
    print(f"u2 mask mean={mask.mean():.1f}; esrgan tiles={[len(c['tiles']) for c in cases]}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])

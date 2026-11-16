"""Reference fixtures for the Kotlin U2-Netp cut-out and Real-ESRGAN tiling (Phase 3.2 tests).

usage: fixtures.py <models_dir> <out_dir>
<models_dir> holds u2netp.onnx and realesr-general-x4v3.onnx (fixed 1x3x160x160 export).
Writes u2_input.png/.f32, u2_pred.f32, u2_mask.png, esrgan_input.png, esrgan_tiles.json,
esrgan_out.png and README.md; .f32 files are raw little-endian float32. ORT on 1 thread.
"""
import json
import os
import sys
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I drops the script dir
from ref import FEATHER, OVERLAP, SCALE, TILE, synth, tiles, u2_mask, u2_norm, u2_prep, upscale  # noqa: E402

README = f"""Made by tools/quick-edits-bench/fixtures.py (do not edit by hand).
Command: fixtures.py <models_dir> packages/media-core/fixtures/quick-edits
Maths: tools/quick-edits-bench/ref.py (its docstring has the exact pre/post steps).
numpy 2.5.4, onnxruntime 1.32.0 (CPU, 1 thread), Pillow 13.0.0.
Models (not in git): u2netp.onnx sha256 309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8;
realesr-general-x4v3.onnx (export_esrgan.py, T=160) sha256 e47fb5c4f58115d0e87dc42ea7ca932575c11bd2f89f930616925da460a8f4b9.

U2-Netp (non-square on purpose, so a mask left square or stretched fails):
- u2_input.png   300x200 RGB, seeded synthetic (ref.synth seed 5 plus a centred ellipse).
- u2_input.f32   1x3x320x320, ref.u2_prep(u2_input.png).
- u2_pred.f32    320x320, first model output after min-max (ref.u2_norm).
- u2_mask.png    300x200 L, ref.u2_mask(pred, 300, 200, feather_px={FEATHER}).
Real-ESRGAN general-x4v3:
- esrgan_input.png  160x120 RGB, ref.synth seed 6.
- esrgan_tiles.json tile {TILE}, overlap {OVERLAP}, T {TILE + 2 * OVERLAP}, scale {SCALE}, ref.tiles list
  [x, y, x0, y0, x1, y1] (input window top-left, then the core it fills).
- esrgan_out.png    640x480 RGB, ref.upscale with the fixed T={TILE + 2 * OVERLAP} model.
"""


def sess(path):
    o = ort.SessionOptions(); o.intra_op_num_threads = 1; o.inter_op_num_threads = 1
    return ort.InferenceSession(path, o, providers=["CPUExecutionProvider"])


def save_png(img, path):
    img.save(path)
    return Image.open(path)  # read back so every later step sees exactly the stored pixels


def main(md, out):
    os.makedirs(out, exist_ok=True)
    p = lambda n: os.path.join(out, n)

    u2 = synth(300, 200, 5)
    ImageDraw.Draw(u2).ellipse((95, 35, 205, 175), fill=(220, 60, 40), outline=(20, 20, 20), width=3)
    u2 = save_png(u2, p("u2_input.png"))
    x = u2_prep(u2)
    x.astype("<f4").tofile(p("u2_input.f32"))
    pred = u2_norm(sess(os.path.join(md, "u2netp.onnx")).run(None, {"input.1": x})[0])
    pred.astype("<f4").tofile(p("u2_pred.f32"))
    mask = u2_mask(pred, u2.width, u2.height, FEATHER)
    Image.fromarray(mask, "L").save(p("u2_mask.png"))

    es = save_png(synth(160, 120, 6), p("esrgan_input.png"))
    t = tiles(es.width, es.height, TILE, OVERLAP)
    json.dump({"w": es.width, "h": es.height, "tile": TILE, "overlap": OVERLAP, "T": TILE + 2 * OVERLAP,
               "scale": SCALE, "tiles": [list(r) for r in t]}, open(p("esrgan_tiles.json"), "w"), indent=1)
    up = upscale(sess(os.path.join(md, "realesr-general-x4v3.onnx")), es, TILE, OVERLAP)
    up.save(p("esrgan_out.png"))
    open(p("README.md"), "w").write(README)
    print(f"u2 mask mean={mask.mean():.1f} >127: {(mask > 127).mean():.3f}; esrgan tiles={len(t)} out={up.size}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(*sys.argv[1:])

"""Inputs and Mac reference outputs for the Quick edits phone run (stageb.sh), rebuilt from models and photos.

usage: mkinputs.py <models_dir> <photos_dir | 331075.jpg 544519.jpg> <out_dir>
models_dir holds u2netp.onnx, esr176.onnx, esr160.onnx (export_esrgan.py T=176 / 160) and modnet.onnx.
photos_dir holds 331075.jpg and 544519.jpg (photos.json). Writes raw little-endian float32 into out_dir:
  u2_input.f32   copy of packages/media-core/fixtures/quick-edits/u2_input.f32 (1x3x320x320), u2.mac.f32 = first output
  esr176.f32 / esr160.f32   1x3xTxT tile of 331075 (grid row 2, col 3; overlap 24 / 16), esr*.mac.f32 = output
  modnet.f32     544519 as 672x512 LANCZOS, (x/255 - 0.5)/0.5, 1x3x512x672, modnet.mac.f32 = output
Every .mac.f32 is Mac onnxruntime on 1 thread. Run with python -I.
"""
import os
import shutil
import sys
import numpy as np
import onnxruntime as ort
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)  # python -I drops the script dir
from ref import TILE, _reflect, tiles  # noqa: E402

ROW, COL = 2, 3


def sess(path):
    o = ort.SessionOptions(); o.intra_op_num_threads = 1; o.inter_op_num_threads = 1
    return ort.InferenceSession(path, o, providers=["CPUExecutionProvider"])


def infer(model, x, out, name, inp=None):
    s = sess(model)
    y = s.run(None, {s.get_inputs()[0].name: x})[0]
    x.astype("<f4").tofile(os.path.join(out, inp or f"{name}.f32"))
    np.ascontiguousarray(y, "<f4").tofile(os.path.join(out, f"{name}.mac.f32"))
    print(f"{name}: in {list(x.shape)} out {list(y.shape)} range {y.min():.4f}..{y.max():.4f}")


def tile_input(img, overlap):
    w, h = img.size
    cols = -(-w // TILE)
    x, y, x0, y0, x1, y1 = tiles(w, h, TILE, overlap)[ROW * cols + COL]
    assert x1 - x0 == TILE and y1 - y0 == TILE and x > 0 and y > 0, "not an interior tile"
    t = TILE + 2 * overlap
    a = np.asarray(img.convert("RGB"), np.float32) / 255
    win = a[_reflect(np.arange(y, y + t), h)][:, _reflect(np.arange(x, x + t), w)]
    return np.ascontiguousarray(win.transpose(2, 0, 1)[None], np.float32)


def main(models, photos, out):
    if len(photos) == 1:
        photos = [os.path.join(photos[0], "331075.jpg"), os.path.join(photos[0], "544519.jpg")]
    os.makedirs(out, exist_ok=True)
    m = lambda n: os.path.join(models, n)
    shutil.copy(os.path.join(here, "..", "..", "packages", "media-core", "fixtures", "quick-edits", "u2_input.f32"),
                os.path.join(out, "u2_input.f32"))
    x = np.fromfile(os.path.join(out, "u2_input.f32"), "<f4").reshape(1, 3, 320, 320)
    infer(m("u2netp.onnx"), x, out, "u2", "u2_input.f32")
    pet = Image.open(photos[0])
    infer(m("esr176.onnx"), tile_input(pet, 24), out, "esr176")
    infer(m("esr160.onnx"), tile_input(pet, 16), out, "esr160")
    a = np.asarray(Image.open(photos[1]).convert("RGB").resize((672, 512), Image.Resampling.LANCZOS), np.float32)
    infer(m("modnet.onnx"), np.ascontiguousarray(((a / 255 - 0.5) / 0.5).transpose(2, 0, 1)[None], np.float32), out, "modnet")


if __name__ == "__main__":
    if len(sys.argv) not in (4, 5):
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2:-1], sys.argv[-1])

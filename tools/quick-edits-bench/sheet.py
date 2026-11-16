"""Edge-quality contact sheet: each photo beside its U2-Netp cut-out on a checkerboard.

usage: sheet.py <photos_dir> <photos.json> <u2netp.onnx> <out.png>
Photos are read from <photos_dir>/<id>/<id>.jpg. Rows hold two photo pairs each.
"""
import json
import os
import sys
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I drops the script dir
import ref  # noqa: E402

H = 360  # panel height
LABEL = 18
GAP = 6
PER_ROW = 2


def checker(w, h, cell=12):
    y, x = np.indices((h, w))
    g = np.where(((x // cell + y // cell) % 2) == 0, 200, 255).astype(np.uint8)
    return Image.fromarray(np.stack([g] * 3, -1), "RGB")


def scaled(im, h=H):
    return im.resize((max(1, round(im.width * h / im.height)), h), Image.Resampling.LANCZOS)


def u2_cutout(sess, img):
    pred = sess.run(None, {sess.get_inputs()[0].name: ref.u2_prep(img)})[0]
    return ref.cutout(img, ref.u2_mask(pred, img.width, img.height))


def pair(img, cut, label):
    a = scaled(img.convert("RGB"))
    c = scaled(cut)
    bg = checker(c.width, c.height)
    bg.paste(c, mask=c.getchannel("A"))
    p = Image.new("RGB", (a.width + c.width + GAP, H + LABEL), "white")
    p.paste(a, (0, LABEL))
    p.paste(bg, (a.width + GAP, LABEL))
    ImageDraw.Draw(p).text((2, 2), label, fill="black")
    return p


def main(photos_dir, photos_json, model, out):
    sess = ort.InferenceSession(model, sess_options=_opts(), providers=["CPUExecutionProvider"])
    pairs = []
    for r in json.load(open(photos_json)):
        img = Image.open(os.path.join(photos_dir, r["id"], r["id"] + ".jpg"))
        img.load()
        pairs.append(pair(img, u2_cutout(sess, img), f"{r['id']} {r['kind']}"))
    rows = [pairs[i:i + PER_ROW] for i in range(0, len(pairs), PER_ROW)]
    W = max(sum(p.width for p in row) + GAP * (len(row) - 1) for row in rows)
    sheet = Image.new("RGB", (W, len(rows) * (H + LABEL + GAP)), "white")
    for ri, row in enumerate(rows):
        x = 0
        for p in row:
            sheet.paste(p, (x, ri * (H + LABEL + GAP)))
            x += p.width + GAP * 2
    sheet.save(out)
    print(out, sheet.size)


def _opts():
    o = ort.SessionOptions()
    o.intra_op_num_threads = 1
    return o


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    main(*sys.argv[1:])

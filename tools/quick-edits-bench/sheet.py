"""Edge-quality contact sheet: each photo beside its U2-Netp cut-out on a checkerboard.

usage: sheet.py <photos_dir> <photos.json> <u2netp.onnx> <out.png> [<modnet.onnx>]
Photos are read from <photos_dir>/<id>/<id>.jpg. Rows hold two photos each. With a
MODNet model (Xenova/modnet onnx/model.onnx), people photos get a third panel.
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


def modnet_cutout(sess, img):
    """MODNet pre/post per its preprocessor_config: shortest edge 512, sides to multiples of 32, (x/255-0.5)/0.5."""
    w, h = img.size
    s = 512 / min(w, h)
    rw, rh = max(32, round(w * s / 32) * 32), max(32, round(h * s / 32) * 32)
    a = np.asarray(img.convert("RGB").resize((rw, rh), Image.Resampling.BILINEAR), np.float32) / 127.5 - 1
    m = sess.run(None, {sess.get_inputs()[0].name: a.transpose(2, 0, 1)[None]})[0].reshape(rh, rw)
    m = np.asarray(Image.fromarray(m.astype(np.float32), "F").resize((w, h), Image.Resampling.BILINEAR))
    return ref.cutout(img, ref._q8(ref.mask_curve(m)))


def on_checker(cut):
    c = scaled(cut)
    bg = checker(c.width, c.height)
    bg.paste(c, mask=c.getchannel("A"))
    return bg


def pair(img, cuts, label):
    panels = [scaled(img.convert("RGB"))] + [on_checker(c) for c in cuts]
    p = Image.new("RGB", (sum(x.width for x in panels) + GAP * (len(panels) - 1), H + LABEL), "white")
    x = 0
    for q in panels:
        p.paste(q, (x, LABEL))
        x += q.width + GAP
    ImageDraw.Draw(p).text((2, 2), label, fill="black")
    return p


def main(photos_dir, photos_json, model, out, modnet=None):
    sess = ort.InferenceSession(model, sess_options=_opts(), providers=["CPUExecutionProvider"])
    msess = modnet and ort.InferenceSession(modnet, sess_options=_opts(), providers=["CPUExecutionProvider"])
    pairs = []
    for r in json.load(open(photos_json)):
        img = Image.open(os.path.join(photos_dir, r["id"], r["id"] + ".jpg"))
        img.load()
        cuts = [u2_cutout(sess, img)]
        if msess and r["kind"] == "people":
            cuts.append(modnet_cutout(msess, img))
        pairs.append(pair(img, cuts, f"{r['id']} {r['kind']}" + (" (U2-Netp | MODNet)" if len(cuts) > 1 else " (U2-Netp)")))
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
    if len(sys.argv) not in (5, 6):
        sys.exit(__doc__)
    main(*sys.argv[1:])

"""Tune the look-alike CLIP cosine threshold (Clean up Phase 0, Task 3).

usage (run with -I; keep downloads in their own directories):
  lookalike_tune.py extract <video> <film> <frames_dir>   needs `av`; cuts the film into shots and saves 6 frames
                                                          per shot of 2.6 s or more that is not near-black: a burst of 4 (0.15 s apart,
                                                          like a phone burst) and 2 re-takes (1.2 s and 2.0 s on)
  lookalike_tune.py tune <model_dir> <frames_dir>         model_dir holds vision_model_quantized.onnx and
                                                          preprocessor_config.json (revision pinned below)

Series = one shot. Positives: frame pairs inside one shot, split into burst pairs (both in the burst) and re-take
pairs (the rest). Hard negatives: frames of different shots of
the same film at most 10 minutes apart (the window the app compares inside). Easy negatives: frames of different
films. Vectors are made as the phone index makes them (256 px fit, ref.prep, ONNX Runtime 1 thread, int8 quantize
as PhotoIndex.kt quantize()), then compared as int8 and as float. Choice rule: highest recall with precision
against hard negatives >= 0.95.
"""
import hashlib
import json
import os
import re
import sys
import tempfile
import types

import numpy as np
from PIL import Image, ImageOps

MODEL_SHA = "583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299"  # Xenova/clip-vit-base-patch32 @ 6b7c523
OFFSETS, LEAD, MIN_SHOT, CUT_MAD, WINDOW_S, MIN_PRECISION, RATIO = (0, .15, .30, .45, 1.2, 2.0), 0.3, 2.6, 25.0, 600.0, 0.95, 10
BURST_K = 4  # frames 0..3 are the burst
MIN_LUMA = 20  # mean brightness of 255: black shots (fades, titles) all look alike to CLIP and a gallery rarely holds them


def extract(video, film, out):
    import av  # only this subcommand needs it
    os.makedirs(out, exist_ok=True)
    cuts, prev, last, lum = [0.0], None, 0.0, [[0.0, 0]]
    with av.open(video) as c:
        c.streams.video[0].thread_type = "AUTO"
        for f in c.decode(video=0):
            g = f.to_ndarray(width=64, height=36, format="gray").astype(np.int16)
            if prev is not None and np.abs(g - prev).mean() > CUT_MAD:
                cuts.append(float(f.time))
                lum.append([0.0, 0])
            prev, last = g, float(f.time)
            lum[-1][0] += g.mean(); lum[-1][1] += 1
    shots = list(zip(cuts, cuts[1:] + [last + 0.04]))
    targets = [(i, k, a + LEAD + o) for i, (a, b) in enumerate(shots) if b - a >= MIN_SHOT and lum[i][0] / lum[i][1] >= MIN_LUMA for k, o in enumerate(OFFSETS)]
    n, todo = 0, iter(targets)
    cur = next(todo, None)
    with av.open(video) as c:
        c.streams.video[0].thread_type = "AUTO"
        for f in c.decode(video=0):
            if cur and f.time >= cur[2]:
                im = f.to_image()
                im.thumbnail((512, 512))
                im.save(os.path.join(out, f"{film}_{cur[0]:04d}_{cur[1]}_{f.time:.2f}.jpg"), quality=92)
                n, cur = n + 1, next(todo, None)
    print(f"{film}: shots={len(shots)} used={len({t[0] for t in targets})} frames={n}")


def vectors(model_dir, files):
    sha = hashlib.sha256(open(os.path.join(model_dir, "vision_model_quantized.onnx"), "rb").read()).hexdigest()
    assert sha == MODEL_SHA, f"model sha256 {sha}"
    sys.modules.setdefault("tokenizers", types.SimpleNamespace(Tokenizer=None))  # ref.py imports it for text only
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "photo-bench"))
    import ref
    cfg = json.load(open(os.path.join(model_dir, "preprocessor_config.json")))
    vis = ref.sess(os.path.join(model_dir, "vision_model_quantized.onnx"))
    out = []
    with tempfile.TemporaryDirectory() as tmp:
        p = os.path.join(tmp, "t.png")
        for f in files:
            im = ImageOps.exif_transpose(Image.open(f)).convert("RGB")
            im.thumbnail((256, 256))  # loadThumbnail(Size(256, 256)) fits inside the box
            im.save(p)  # lossless, so ref.prep (which takes a path) sees exactly this bitmap
            out.append(vis.run(["image_embeds"], {"pixel_values": ref.prep(p, cfg)})[0][0])
    return np.array(out, np.float32)


def quantize(v):
    """PhotoIndex.kt quantize(): scale 127/L2 norm, roundToInt is floor(x + 0.5), clamp to +-127."""
    norm = np.sqrt((v.astype(np.float64) ** 2).sum(axis=1)).astype(np.float32)[:, None]
    scale = np.where(norm == 0, np.float32(0), np.float32(127) / np.where(norm == 0, 1, norm)).astype(np.float32)
    return np.clip(np.floor(v * scale + np.float32(0.5)), -127, 127)


def cosine(v):
    v = v / np.linalg.norm(v, axis=1, keepdims=True)
    return v @ v.T


def table(name, cos, film, shot, k, t):
    same_film = film[:, None] == film[None, :]
    same_shot = same_film & (shot[:, None] == shot[None, :])
    upper = np.triu(np.ones_like(same_shot), 1)
    pos = same_shot & upper
    burst = pos & (k[:, None] < BURST_K) & (k[None, :] < BURST_K)
    hard = same_film & ~same_shot & (np.abs(t[:, None] - t[None, :]) <= WINDOW_S) & upper
    easy = ~same_film & upper
    w = RATIO * pos.sum() / hard.sum()  # weight of one hard negative if hard:positive pairs were RATIO:1
    print(f"\n{name}: positives={pos.sum()} (burst {burst.sum()}) hard negatives={hard.sum()} easy negatives={easy.sum()}")
    print(f"thr   rec_all rec_burst  prec_hard prec_hard@{RATIO}:1 prec_easy fp_hard")
    chosen = [None, None]
    for th in np.round(np.arange(0.80, 0.9801, 0.01), 2):
        hit = cos >= th
        tp, fh, fe = (hit & pos).sum(), (hit & hard).sum(), (hit & easy).sum()
        ph, pw, pe = tp / max(tp + fh, 1), tp / max(tp + w * fh, 1), tp / max(tp + fe, 1)
        for i, p in enumerate((ph, pw)):
            if chosen[i] is None and p >= MIN_PRECISION:
                chosen[i] = (th, tp / pos.sum(), (hit & burst).sum() / burst.sum(), p)
        print(f"{th:.2f}  {tp / pos.sum():.3f}   {(hit & burst).sum() / burst.sum():.3f}     {ph:.3f}     {pw:.3f}          {pe:.3f}     {fh}")
    for label, c in zip(("hard (raw pooled)", f"hard weighted {RATIO}:1"), chosen):
        print(f"{name} chosen vs {label}: " + (f"threshold={c[0]:.2f} recall_all={c[1]:.3f} recall_burst={c[2]:.3f} precision={c[3]:.3f}"
              if c else f"no threshold in 0.80..0.98 reaches precision {MIN_PRECISION}"))


def tune(model_dir, frames):
    assert quantize(np.array([[3, -4]], np.float32)).tolist() == [[76, -102]]  # 76.2 and -101.6
    files = sorted(f for f in os.listdir(frames) if f.endswith(".jpg"))
    m = [re.fullmatch(r"(.+)_(\d+)_(\d)_([\d.]+)\.jpg", f) for f in files]
    assert all(m), "unexpected file name in frames dir"
    films = sorted({x[1] for x in m})
    film = np.array([films.index(x[1]) for x in m]); shot = np.array([int(x[2]) for x in m])
    k = np.array([int(x[3]) for x in m]); t = np.array([float(x[4]) for x in m])
    print(f"photos={len(files)} films={films} series={len({(a, b) for a, b in zip(film, shot)})}")
    v = vectors(model_dir, [os.path.join(frames, f) for f in files])
    table("int8", cosine(quantize(v)), film, shot, k, t)
    table("float", cosine(v), film, shot, k, t)


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) == 4 and a[0] == "extract":
        extract(*a[1:])
    elif len(a) == 3 and a[0] == "tune":
        tune(*a[1:])
    else:
        sys.exit(__doc__)

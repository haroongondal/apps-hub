"""Fixtures for Clean up's Kotlin score tests (Phase 2.1).

usage: fixtures.py <out_dir>      (the committed copy: packages/media-core/fixtures/gallery-cleanup)
Seeded synthetic images only. Writes PNGs, odd.u8 (raw grey bytes of the odd-size case) and cases.json
with every ref.py function's output per case plus the pair and aspect checks; byte-identical across runs.
"""
import json
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I drops the script dir
from ref import aspect_close, brightness, dhash, grey, hamming, laplacian_var  # noqa: E402

README = """Made by tools/gallery-cleanup-bench/fixtures.py (do not edit by hand).
Command: fixtures.py packages/media-core/fixtures/gallery-cleanup   (run with the pinned requirements.txt)
Maths: tools/gallery-cleanup-bench/ref.py (docstring: the exact recipe of grey, dhash, brightness,
laplacian_var, aspect_close). numpy 2.5.4, Pillow 13.0.0. Self-check: python -I ref.py.
All images are seeded synthetic RGB (ref-style shapes, gradient, Gaussian noise), no photos.

cases.json: per case file, w, h, grey_sha256 (sha256 of the row-major uint8 grey bytes), dhash (16 hex
chars, bit 63 = row 0 pair 0), brightness [mean, spread] and laplacian_var (repr of the float64);
"pairs": hamming of the dhashes; "aspect": aspect_close inputs and result. Floats are exact for the
Python recipe; Kotlin matches to 1e-12 (brightness) and 1e-9 (laplacian_var) relative, dhash exactly.
- noisy   300x200  structure plus noise sigma 6, the base of the pairs.
- half    150x100  noisy resized 50% with Pillow LANCZOS: AC-3 look-alike, Hamming must stay <= 4.
- blur    300x200  noisy through Pillow GaussianBlur(2): Laplacian variance must drop.
- other   300x200  a second unrelated seed: Hamming to noisy must exceed 4.
- odd     37x23    odd size, so cell footprints are fractional on both axes (odd.u8 holds its grey).
- flat    64x48    grey 128: dhash 0, spread 0, Laplacian variance 0.
- dark    120x80   seed 3 scaled by 0.04 (mean about 2%): mean below 8%.
- blown   120x80   seed 4 squeezed into 235..255 (mean about 96%): mean above 92%.
"""


def synth(w, h, seed):
    """Gradient, 10 filled shapes, 6 thin lines and Gaussian noise (sigma 6)."""
    rng = np.random.default_rng(seed)
    base = np.linspace(40, 215, w)[None, :, None] * np.ones((h, 1, 3)) * np.array([1.0, 0.8, 0.6])
    im = Image.fromarray(base.astype(np.uint8), "RGB")
    d = ImageDraw.Draw(im)
    col = lambda: tuple(int(v) for v in rng.integers(0, 256, 3))
    for _ in range(10):
        x0, x1 = sorted(rng.integers(0, w, 2)); y0, y1 = sorted(rng.integers(0, h, 2))
        (d.rectangle if rng.random() < 0.5 else d.ellipse)((x0, y0, x1 + 2, y1 + 2), fill=col())
    for _ in range(6):
        d.line(tuple(int(v) for v in rng.integers(0, max(w, h), 4)), fill=col(), width=1)
    a = np.asarray(im, np.float64) + rng.normal(0, 6, (h, w, 3))
    return np.clip(np.rint(a), 0, 255).astype(np.uint8)


def main(out):
    os.makedirs(out, exist_ok=True)
    noisy = synth(300, 200, 1)
    n = Image.fromarray(noisy)
    imgs = {
        "noisy": noisy,
        "half": np.asarray(n.resize((150, 100), Image.Resampling.LANCZOS)),
        "blur": np.asarray(n.filter(ImageFilter.GaussianBlur(2))),
        "other": synth(300, 200, 99),
        "odd": synth(37, 23, 2),
        "flat": np.full((48, 64, 3), 128, np.uint8),
        "dark": np.rint(synth(120, 80, 3) * 0.04).astype(np.uint8),
        "blown": np.rint(235 + synth(120, 80, 4) * (20 / 255)).astype(np.uint8),
    }
    cases, g, d = {}, {}, {}
    for k, rgb in imgs.items():
        Image.fromarray(rgb).save(os.path.join(out, f"{k}.png"))
        rgb = np.asarray(Image.open(os.path.join(out, f"{k}.png")).convert("RGB"))  # the stored pixels
        g[k], d[k] = grey(rgb), dhash(grey(rgb))
        cases[k] = {"file": f"{k}.png", "w": rgb.shape[1], "h": rgb.shape[0],
                    "grey_sha256": __import__("hashlib").sha256(g[k].tobytes()).hexdigest(),
                    "dhash": f"{d[k]:016x}", "brightness": list(brightness(g[k])),
                    "laplacian_var": repr(laplacian_var(g[k]))}
    g["odd"].tofile(os.path.join(out, "odd.u8"))
    pairs = [{"a": a, "b": b, "hamming": hamming(d[a], d[b]),
              "aspect_close": aspect_close(cases[a]["w"], cases[a]["h"], cases[b]["w"], cases[b]["h"])}
             for a, b in (("noisy", "half"), ("noisy", "other"), ("noisy", "blur"))]
    aspect = [{"w1": a, "h1": b, "w2": c, "h2": e, "close": aspect_close(a, b, c, e)}
              for a, b, c, e in ((300, 200, 150, 100), (300, 200, 200, 300), (300, 200, 306, 200), (300, 200, 310, 200))]
    with open(os.path.join(out, "cases.json"), "w") as f:
        json.dump({"cases": cases, "pairs": pairs, "aspect": aspect}, f, indent=1)
        f.write("\n")
    open(os.path.join(out, "README.md"), "w").write(README)


if __name__ == "__main__":
    main(*sys.argv[1:]) if len(sys.argv) == 2 else sys.exit(__doc__)

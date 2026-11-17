"""Mac reference maths for Clean up (Phase 0): grey, dHash, brightness, blur score.

usage: ref.py   (self-check against the committed fixtures in packages/media-core/fixtures/gallery-cleanup)
Phase 2.1 runs these in Kotlin on the bitmap from ContentResolver.loadThumbnail, so every function
starts from RGB (or grey) pixels already at thumbnail size; no file decoding is part of a recipe.
Importable: grey, dhash, hamming, brightness, laplacian_var, thumb512, aspect_close.

grey(rgb uint8 [h,w,3]) -> uint8 [h,w]: Pillow's convert("L"), integer only:
  (19595 R + 38470 G + 7471 B + 32768) >> 16   (0.299/0.587/0.114 in 16-bit fixed point; the sum never
  exceeds 255 * 65536, so no clamp). Every Kotlin step is an Int; the self-check asserts equality with
  Pillow on every fixture and on all 2^24 colours.
dhash(g uint8 [h,w]) -> int, unsigned 64-bit (store as a 16-char lower-case hex string):
  downscale g to 9 wide x 8 high by exact area averaging, done in integers so there is no rounding to
  match. Cell (i, j) covers x in [j*w/9, (j+1)*w/9) and y in [i*h/8, (i+1)*h/8). Scale x by 9 and y by 8:
  pixel x spans [9x, 9x+9), cell j spans [j*w, (j+1)*w), and wx(j, x) = max(0, min(9x+9, (j+1)*w) - max(9x, j*w))
  (0..9); likewise wy(i, y) with 8 and h. S(i, j) = sum over y, x of wy * wx * g[y][x] (int64). Every cell
  has the same total weight w*h, so S needs no division. Bit for (i, j), j = 0..7: 1 when S(i, j) < S(i, j+1),
  else 0 (equal gives 0, so a flat image hashes to 0). Bit order: row-major, bit 63 = row 0 pair 0,
  bit 0 = row 7 pair 7. Chosen over Pillow's BOX/BILINEAR because it works for any size (even w < 9),
  and Pillow's fixed-point steps would have to be ported as well.
hamming(a, b) -> int: popcount(a xor b).
brightness(g) -> (mean, spread): mean and population std of g/255, float64. Integer sums first:
  n = h*w, s1 = sum g, s2 = sum g^2 (Long); mean = s1 / n / 255; spread = sqrt(n*s2 - s1^2) / n / 255
  (n*s2 - s1^2 is exact in Long up to about 4 megapixels). A Kotlin port matches to 1e-12 relative.
laplacian_var(g) -> float: 3x3 kernel [[0,1,0],[1,-4,1],[0,1,0]] over g as integers, valid region only
  (no border padding; output (h-2) x (w-2), so h or w below 3 gives 0.0), then the population variance on
  the 0..255 scale (not /255): with m = (h-2)(w-2), t1 = sum of outputs, t2 = sum of squares,
  var = (m*t2 - t1^2) / m^2. The outputs are exact integers; Kotlin matches to 1e-9 relative (m*t2 can
  pass 2^53, so a double division is not bit-identical). Use the same thumbnail size as the threshold
  was tuned on: the score depends on resolution.
thumb512(img, resample) -> RGB PIL image: longest side 512, never upscaled (smaller images only get
  converted to RGB); short side floor(side * 512 / long + 0.5), at least 1. Used by the tuning scripts
  to stand in for the device thumbnail.
aspect_close(w1, h1, w2, h2, tol=0.02) -> bool: with r = w / h, |r1 - r2| / max(r1, r2) <= tol (spec:
  same aspect ratio within 2%).
"""
import os
import sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.normpath(os.path.join(HERE, "../../packages/media-core/fixtures/gallery-cleanup"))


def grey(rgb):
    a = rgb.astype(np.int32)
    return ((19595 * a[..., 0] + 38470 * a[..., 1] + 7471 * a[..., 2] + 32768) >> 16).astype(np.uint8)


def _weights(n, cells):
    """[cells, n] int64: overlap of pixel x ([cells*x, cells*x+cells)) with cell j ([j*n, (j+1)*n))."""
    lo = np.arange(n)[None, :] * cells
    j = np.arange(cells)[:, None]
    return np.maximum(0, np.minimum(lo + cells, (j + 1) * n) - np.maximum(lo, j * n)).astype(np.int64)


def dhash(g):
    h, w = g.shape
    s = _weights(h, 8) @ g.astype(np.int64) @ _weights(w, 9).T  # [8, 9], exact
    bits = (s[:, :-1] < s[:, 1:]).ravel()
    return int("".join("1" if b else "0" for b in bits), 2)


def hamming(a, b):
    return (a ^ b).bit_count()


def brightness(g):
    v = g.astype(np.int64)
    n, s1, s2 = v.size, int(v.sum()), int((v * v).sum())
    return s1 / n / 255, (n * s2 - s1 * s1) ** 0.5 / n / 255


def laplacian_var(g):
    v = g.astype(np.int64)
    if v.shape[0] < 3 or v.shape[1] < 3:
        return 0.0
    o = v[:-2, 1:-1] + v[2:, 1:-1] + v[1:-1, :-2] + v[1:-1, 2:] - 4 * v[1:-1, 1:-1]
    m, t1, t2 = o.size, int(o.sum()), int((o * o).sum())
    return (m * t2 - t1 * t1) / (m * m)  # Python int / int is correctly rounded


def thumb512(img, resample):
    img = img.convert("RGB")
    long_side = max(img.size)
    if long_side <= 512:
        return img
    w, h = (max(1, (s * 1024 + long_side) // (2 * long_side)) for s in img.size)  # floor(s*512/long + 0.5)
    return img.resize((w, h), resample)


def aspect_close(w1, h1, w2, h2, tol=0.02):
    r1, r2 = w1 / h1, w2 / h2
    return abs(r1 - r2) / max(r1, r2) <= tol


def main():
    import json
    cases = json.load(open(os.path.join(FIXTURES, "cases.json")))
    px = {}
    for name, c in cases["cases"].items():
        rgb = np.asarray(Image.open(os.path.join(FIXTURES, c["file"])).convert("RGB"))
        g = px[name] = grey(rgb)
        assert np.array_equal(g, np.asarray(Image.fromarray(rgb).convert("L"))), name
        print(f"{name:8} {rgb.shape[1]}x{rgb.shape[0]} dhash={dhash(g):016x} bright={brightness(g)} lap={laplacian_var(g)!r}")
    for r in range(256):  # every one of the 2^24 colours
        c = np.empty((256, 256, 3), np.uint8)
        c[..., 0] = r
        c[..., 1] = np.arange(256)[:, None]
        c[..., 2] = np.arange(256)[None, :]
        assert np.array_equal(grey(c), np.asarray(Image.fromarray(c).convert("L"))), r
    d = {k: dhash(v) for k, v in px.items()}
    half = hamming(d["noisy"], d["half"])
    other = hamming(d["noisy"], d["other"])
    print(f"hamming noisy/half={half} noisy/other={other} noisy/blur={hamming(d['noisy'], d['blur'])}")
    assert half <= 4 and aspect_close(300, 200, 150, 100), half
    assert other > 4, other
    assert laplacian_var(px["blur"]) < laplacian_var(px["noisy"])
    assert d["flat"] == 0 and laplacian_var(px["flat"]) == 0.0
    assert brightness(px["dark"])[0] < 0.08 and brightness(px["blown"])[0] > 0.92
    for k, c in cases["cases"].items():
        assert f"{d[k]:016x}" == c["dhash"] and brightness(px[k]) == tuple(c["brightness"]) and repr(laplacian_var(px[k])) == c["laplacian_var"], k
    print("self-check ok")


if __name__ == "__main__":
    sys.exit(main())

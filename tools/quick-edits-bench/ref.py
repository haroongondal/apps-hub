"""Mac reference maths for Quick edits Phase 0: U2-Netp cut-out and Real-ESRGAN tiled 4x.

usage: ref.py <realesr-general-x4v3-dyn.onnx>
  Overlap check on a seeded 256x192 image (needs the dynamic-shape export). For each overlap it
  prints max and p99 abs difference (per pixel, largest of R, G, B; in 0..255 steps) between
  the tiled 4x and:
  (a) a plain whole-image run, all pixels. Dominated by the border: the whole run zero-pads
      inside the network where the tiles see mirrored pixels; no overlap changes that.
  (b) the same run, only pixels >= 40 input px from the border (the receptive field is 34 px:
      34 3x3 convolutions), so the border term is gone and only seams remain.
  (c) a whole-image run on the image reflect-padded by the overlap. Not seams only: border
      tiles with a partial core mirror more than `overlap` px (up to T - core), so the bottom
      and right edges keep a small border term.
  (s) the seam band: pixels within 8 input px of an interior seam and >= 40 px from the border,
      against (a)'s run. The rule: OVERLAP is the smallest overlap whose seam-band max is
      <= 1 step (p99 over all pixels is not enough: at 16 the band's max is 10.4 steps).
Importable: u2_prep, u2_norm, u2_mask, cutout, tiles, upscale, synth.

U2-Netp (u2netp.onnx, input "input.1" 1x3x320x320, first of 7 outputs "1959" 1x1x320x320), as rembg does it:
  u2_prep: RGB uint8 -> 320x320 with Pillow's LANCZOS -> divide by the largest value (any
  channel) of that resized 320x320 uint8 image, not by 255 -> (x - ImageNet mean) / std in
  float64 -> NCHW float32.
  A port must either reproduce Pillow 13's 8-bit LANCZOS exactly or accept the tolerance below.
  Exact recipe (Resample.c; a numpy port of it matched Pillow bit for bit on 6 sizes, both
  pass orders): per axis, scale = in/out, fs = max(scale, 1), support = 3*fs; for output i,
  centre = (i + 0.5)*scale, taps j from max(int(centre - support + 0.5), 0) to
  min(int(centre + support + 0.5), in) exclusive (int() truncates), weight
  lanczos3((j - centre + 0.5)/fs) with lanczos3(x) = sinc(x) sinc(x/3) on -3 <= x < 3,
  normalised to sum 1, then int(w * 2^22 +- 0.5) (away from zero). Each output value =
  clamp((2^21 + sum(w_int * v)) >> 22, 0, 255): two separate passes with uint8 rounding and
  clipping in between. Horizontal pass first, unless (inH - 320) > 0 and
  (inH - 320) > 2 * (inW - 320), then vertical first. An axis already 320 long is skipped.
  Tolerance if a port runs the same Lanczos-3 kernel in float, without the 8-bit rounding (check
  on the fixture): 0.116 max on the input tensor, up to 3 steps on the final mask (p99 1). A
  different kernel is not close: bilinear gives 0.98 on the tensor and 98 steps on the mask.
  u2_norm: first output min-max normalised to 0..1 in float32 (idempotent).
  u2_mask: in float64, bilinear (half-pixel centres, edge clamp, no antialias) to the photo's own
  w x h, then a separable Gaussian, sigma = feather_px photo px (radius ceil(3 sigma), edge
  clamp), then floor(255 * clip(m, 0, 1) + 0.5) as uint8; a float32 port may differ by 1.
  rembg instead quantises at 320 and resizes the uint8 mask with LANCZOS; we keep floats so the
  mask can be scaled to any photo size in one step.
Real-ESRGAN general-x4v3 (input "input" 1x3xTxT, output "output" 1x3x4Tx4T, T = tile + 2*overlap):
  RGB float32 0..1 in, RGB float 0..1 out (unclamped; clip, then floor(255 x + 0.5)). Alpha is
  not upscaled by the reference (the input is converted to RGB); Phase 3.2 decides.
  Tiles: 128 px cores in row-major order; each input is the TxT window starting overlap px
  above-left of its core, with coordinates outside the image mirrored (numpy "reflect", edge
  pixel not repeated, bouncing as often as needed), so border tiles keep the one fixed shape:
  for size n, p = 2(n - 1), i = |i| mod p, then p - i if i >= n; 0 when n = 1.
  The 4x core is cropped out of each output and written in place.
"""
import math
import sys
import numpy as np
from PIL import Image, ImageDraw

MEAN = np.array([0.485, 0.456, 0.406])
STD = np.array([0.229, 0.224, 0.225])
U2 = 320
TILE = 128
SCALE = 4
OVERLAPS = (8, 16, 24, 32)
OVERLAP = 24  # smallest of OVERLAPS with seam-band max <= 1 step (see main)
FEATHER = 2


def u2_prep(img):
    a = np.asarray(img.convert("RGB").resize((U2, U2), Image.Resampling.LANCZOS), np.float64)
    a = (a / max(a.max(), 1e-6) - MEAN) / STD
    return a.transpose(2, 0, 1)[None].astype(np.float32)


def u2_norm(pred):
    """First output (any leading 1-dims) -> 320x320 float32 in 0..1; idempotent."""
    p = np.asarray(pred, np.float32).reshape(U2, U2)
    lo, hi = p.min(), p.max()
    return (p - lo) / max(hi - lo, np.float32(1e-12))


def _axis(n_out, n_in):
    s = np.clip((np.arange(n_out) + 0.5) * (n_in / n_out) - 0.5, 0, n_in - 1)
    i0 = np.floor(s).astype(np.int64)
    return i0, np.minimum(i0 + 1, n_in - 1), s - i0


def _bilinear(a, w, h):
    y0, y1, fy = _axis(h, a.shape[0])
    x0, x1, fx = _axis(w, a.shape[1])
    r0, r1 = a[y0], a[y1]
    top = r0[:, x0] * (1 - fx) + r0[:, x1] * fx
    bot = r1[:, x0] * (1 - fx) + r1[:, x1] * fx
    return top * (1 - fy)[:, None] + bot * fy[:, None]


def _blur1(a, k, axis):
    r = len(k) // 2
    idx = np.arange(a.shape[axis])
    return sum(kv * np.take(a, np.clip(idx + d, 0, a.shape[axis] - 1), axis=axis) for d, kv in zip(range(-r, r + 1), k))


def _q8(a):
    return np.floor(np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)


def u2_mask(pred, w, h, feather_px=FEATHER):
    """U2-Netp output (raw or u2_norm'd) -> h x w uint8 alpha."""
    m = _bilinear(u2_norm(pred).astype(np.float64), w, h)
    if feather_px > 0:
        r = math.ceil(3 * feather_px)
        k = np.exp(-np.arange(-r, r + 1) ** 2 / (2 * feather_px ** 2))
        k /= k.sum()
        m = _blur1(_blur1(m, k, 0), k, 1)
    return _q8(m)


def cutout(img, mask):
    assert mask.shape == (img.height, img.width), (mask.shape, img.size)
    out = img.convert("RGB")
    out.putalpha(Image.fromarray(mask, "L"))
    return out


def tiles(w, h, tile=TILE, overlap=OVERLAP):
    """[(x, y, x0, y0, x1, y1)]: (x, y) = top-left of the TxT input window in image coords
    (x0 - overlap, may be negative), (x0, y0, x1, y1) = the core it fills (input px; x4 in the output)."""
    return [(x0 - overlap, y0 - overlap, x0, y0, min(x0 + tile, w), min(y0 + tile, h))
            for y0 in range(0, h, tile) for x0 in range(0, w, tile)]


def _reflect(i, n):
    if n == 1:
        return np.zeros_like(i)
    p = 2 * (n - 1)
    i = np.abs(i) % p
    return np.where(i >= n, p - i, i)


def _run(sess, chw):
    return sess.run(None, {sess.get_inputs()[0].name: np.ascontiguousarray(chw[None], np.float32)})[0][0]


def _upscale_f(sess, a, tile, overlap):
    h, w = a.shape[:2]
    t = tile + 2 * overlap
    fixed = sess.get_inputs()[0].shape[2]
    assert not isinstance(fixed, int) or fixed == t, f"session wants {fixed}, tiles are {t}"
    out = np.zeros((SCALE * h, SCALE * w, 3), np.float32)
    for x, y, x0, y0, x1, y1 in tiles(w, h, tile, overlap):
        win = a[_reflect(np.arange(y, y + t), h)][:, _reflect(np.arange(x, x + t), w)]
        o = _run(sess, win.transpose(2, 0, 1)).transpose(1, 2, 0)
        S, c = SCALE, overlap
        out[S * y0:S * y1, S * x0:S * x1] = o[S * c:S * (c + y1 - y0), S * c:S * (c + x1 - x0)]
    return out


def upscale(sess, img, tile=TILE, overlap=OVERLAP):
    a = np.asarray(img.convert("RGB"), np.float32) / 255
    return Image.fromarray(_q8(_upscale_f(sess, a, tile, overlap)), "RGB")


def synth(w, h, seed):
    """Seeded test picture with hard edges, thin lines, gradients and noise."""
    rng = np.random.default_rng(seed)
    g = np.linspace(40, 215, w)[None, :, None] * np.ones((h, 1, 3)) * np.array([1.0, 0.8, 0.6])
    im = Image.fromarray(g.astype(np.uint8), "RGB")
    d = ImageDraw.Draw(im)
    for _ in range(12):
        x0, x1 = sorted(rng.integers(0, w, 2)); y0, y1 = sorted(rng.integers(0, h, 2))
        c = tuple(int(v) for v in rng.integers(0, 256, 3))
        (d.rectangle if rng.random() < 0.5 else d.ellipse)((x0, y0, x1 + 2, y1 + 2), fill=c)
    for _ in range(8):
        d.line(tuple(int(v) for v in rng.integers(0, max(w, h), 4)), fill=tuple(int(v) for v in rng.integers(0, 256, 3)), width=1)
    a = np.asarray(im, np.float64) + rng.normal(0, 6, (h, w, 3))
    return Image.fromarray(np.clip(a, 0, 255).round().astype(np.uint8), "RGB")


def main(dyn_model):
    import onnxruntime as ort
    assert (_reflect(np.arange(-40, 50), 7) == np.pad(np.arange(7), 43, mode="reflect")[3:93]).all()
    sess = ort.InferenceSession(dyn_model, providers=["CPUExecutionProvider"])
    w, h, edge, band = 256, 192, 40, 8
    a = np.asarray(synth(w, h, 3), np.float32) / 255
    up = lambda x: np.clip(_run(sess, x.transpose(2, 0, 1)).transpose(1, 2, 0), 0, 1)
    whole, S = up(a), SCALE
    inner = np.zeros((S * h, S * w), bool)
    inner[S * edge:-S * edge, S * edge:-S * edge] = True
    seams = np.zeros_like(inner)
    for x in range(TILE, w, TILE):
        seams[:, S * (x - band):S * (x + band)] = True
    for y in range(TILE, h, TILE):
        seams[S * (y - band):S * (y + band), :] = True
    st = lambda d: f"max={d.max():7.3f} p99={np.percentile(d, 99):6.3f}"
    pick = None
    for ov in OVERLAPS:
        t = np.clip(_upscale_f(sess, a, TILE, ov), 0, 1)
        d = np.abs(t - whole).max(2) * 255
        o = S * ov
        c = np.abs(t - up(np.pad(a, ((ov, ov), (ov, ov), (0, 0)), mode="reflect"))[o:-o, o:-o]).max(2) * 255
        sb = d[inner & seams]
        pick = pick or (ov if sb.max() <= 1 else None)
        print(f"overlap={ov:2d} T={TILE + 2 * ov} | (a) {st(d)} | (b) {st(d[inner])} | (c) {st(c)} | (s) {st(sb)}")
    print(f"smallest overlap with seam-band max <= 1 step: {pick if pick else 'none of ' + str(OVERLAPS)}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])

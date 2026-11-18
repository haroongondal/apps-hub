"""Blur threshold for Clean up (Phase 0, AC-4): score the CERTH image blur dataset, print the default and a slider curve.

usage: python -I blur_tune.py <certh_eval_dir> [cache.json]
  <certh_eval_dir> holds NaturalBlurSet/, DigitalBlurSet/ (the JPEGs) and NaturalBlurSet.xlsx, DigitalBlurSet.xlsx
  (ground truth: column A file name, column B 1 = blurred, -1 = sharp); see datasets.md "Blur" for how it was fetched.
  cache.json (default: .superpowers/sdd/2026-11-18-image-tools-2.0/blur-cache.json in the worktree) keeps every score,
  keyed by file and size, so a re-run only prints. Needs numpy and Pillow (the pinned requirements.txt); python -I because
  the images are untrusted data. Self-check of the threshold maths: python -I blur_tune.py --selftest

Score per photo = ref.laplacian_var(ref.grey(thumbnail)), flagged "blurry" when score < threshold. Two thumbnails, because the
phone's ContentResolver.loadThumbnail filter is not Pillow (ruling R3):
  a  EXIF-rotated, ref.thumb512(img, LANCZOS) on the full decode;
  b  JPEG-like: img.draft("RGB", thumbnail size) (the decoder scales by 1/2..1/8 but stays at least that big), then
     ref.thumb512(..., BILINEAR): a cheap stand-in for a scaled JPEG decode plus a bilinear resize.
Per filter and per set (natural, digital, pooled) it prints: counts, score percentiles per class, the default threshold
(ruling R7: the most blurred flagged while sharp flagged <= 10%) with PASS/MISS (blurred >= 85%, AC-4), the threshold
where blurred flagged = 85%, a log-spaced curve for the strictness slider, how far the default moves between a and b, and
the sharp photos flagged at the default that are low-texture (grey spread < 0.08, Review Focus 3).
"""
import json
import math
import multiprocessing
import os
import re
import sys
import zipfile
import numpy as np
from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # python -I drops the script dir
from ref import brightness, grey, laplacian_var, thumb512  # noqa: E402

CACHE = os.path.normpath(os.path.join(HERE, "../../.superpowers/sdd/2026-11-18-image-tools-2.0/blur-cache.json"))
SETS = ("NaturalBlurSet", "DigitalBlurSet")
FILTERS = ("a", "b")
SHARP_MAX = 0.10  # AC-4: at most 10% of sharp photos flagged
BLUR_MIN = 0.85  # AC-4: at least 85% of blurred photos flagged
FLAT = 0.08  # grey spread below this = low texture (mostly flat)


def labels(xlsx):
    """{file name: 1 blurred / -1 sharp} from the dataset's sheet 1 (stdlib only: an xlsx is a zip of XML)."""
    z = zipfile.ZipFile(xlsx)
    ss = [re.sub(r"<[^>]+>", "", s).strip() for s in re.findall(r"<si>(.*?)</si>", z.read("xl/sharedStrings.xml").decode("utf8"), re.S)]
    out = {}
    for a, b in re.findall(r'<c r="A\d+"[^>]*t="s"[^>]*><v>(\d+)</v></c><c r="B\d+"[^>]*><v>(-?1)</v></c>', z.read("xl/worksheets/sheet1.xml").decode("utf8")):
        out[ss[int(a)]] = int(b)
    return out


def score_file(path):
    """[lap_a, spread_a, lap_b, spread_b, w, h] for one image (w, h = size after EXIF rotation, before the thumbnail)."""
    res = []
    with Image.open(path) as im:
        w0, h0 = im.size
        k = 512 / max(w0, h0)
        tw, th = max(1, math.floor(w0 * k + 0.5)), max(1, math.floor(h0 * k + 0.5))
        for f in FILTERS:
            with Image.open(path) as im:
                if f == "a":
                    t = thumb512(ImageOps.exif_transpose(im), Image.LANCZOS)
                else:
                    im.draft("RGB", (tw, th))
                    t = thumb512(ImageOps.exif_transpose(im), Image.BILINEAR)
                g = grey(np.asarray(t))
                res += [laplacian_var(g), brightness(g)[1]]
        res += [w0, h0]
    return res


def load(root, cache_path):
    """Rows (set, name, label, [scores]) for every labelled image; scores come from the cache or are computed."""
    cache = {}
    if os.path.exists(cache_path):
        cache = json.load(open(cache_path))
    jobs, rows = [], []
    for s in SETS:
        lab = labels(os.path.join(root, s + ".xlsx"))
        for name, y in sorted(lab.items()):
            p = os.path.join(root, s, name if "." in name else name + ".jpg")  # the natural sheet omits the extension
            key = f"{s}/{name}:{os.path.getsize(p)}"
            rows.append((s, name, y, key))
            if key not in cache:
                jobs.append((key, p))
    if jobs:
        print(f"scoring {len(jobs)} images ({len(rows) - len(jobs)} cached) ...", file=sys.stderr, flush=True)
        with multiprocessing.Pool() as pool:
            for (key, _), r in zip(jobs, pool.imap(score_file, [p for _, p in jobs], chunksize=4)):
                cache[key] = r
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        json.dump(cache, open(cache_path, "w"))
    return [(s, n, y, cache[k]) for s, n, y, k in rows]


def default_threshold(blur, sharp):
    """Largest t (flag when score < t) that flags at most SHARP_MAX of the sharp scores: the k-th smallest sharp score
    is the first one left unflagged, k = floor(0.10 n). Ties at that value stay unflagged, so the bound holds."""
    s = np.sort(sharp)
    return float(s[min(int(SHARP_MAX * len(s)), len(s) - 1)])


def t_for_blur(blur, frac=BLUR_MIN):
    """Smallest t (midpoint between two scores) at which at least `frac` of the blurred scores are below it."""
    b = np.sort(blur)
    m = math.ceil(frac * len(b))
    return float((b[m - 1] + b[min(m, len(b) - 1)]) / 2)


def pct_below(x, t):
    return 100.0 * float(np.mean(np.asarray(x) < t))


def report(rows):
    groups = {"natural": [r for r in rows if r[0] == SETS[0]], "digital": [r for r in rows if r[0] == SETS[1]], "pooled": rows}
    defaults = {}
    for fi, f in enumerate(FILTERS):
        title = "a: full decode + LANCZOS" if f == "a" else "b: JPEG draft + BILINEAR"
        print(f"\n===== filter {title} =====")
        for gname, g in groups.items():
            blur = np.array([r[3][fi * 2] for r in g if r[2] == 1])
            sharp = np.array([r[3][fi * 2] for r in g if r[2] == -1])
            print(f"\n--- {gname}: {len(blur)} blurred, {len(sharp)} sharp ---")
            for nm, x in (("blurred", blur), ("sharp", sharp)):
                p = np.percentile(x, [1, 5, 25, 50, 75, 95, 99])
                print(f"  {nm:8s} score p1/p5/p25/p50/p75/p95/p99: " + "  ".join(f"{v:.1f}" for v in p))
            t = default_threshold(blur, sharp)
            defaults[(f, gname)] = t
            bp, sp = pct_below(blur, t), pct_below(sharp, t)
            print(f"  default (most blurred flagged, sharp flagged <= 10%): threshold {t:.2f}  blurred {bp:.1f}%  sharp {sp:.1f}%  {'PASS' if bp >= 85 else 'MISS'}")
            t85 = t_for_blur(blur)
            print(f"  threshold where blurred flagged >= 85%: {t85:.2f}  sharp flagged there {pct_below(sharp, t85):.1f}%")
            allv = np.concatenate([blur, sharp])
            grid = np.geomspace(max(np.percentile(allv, 1), 1.0), np.percentile(allv, 99), 14)
            print("  curve (flag when score < t):  t       blurred%  sharp%")
            for tt in grid:
                print(f"                              {tt:8.1f}  {pct_below(blur, tt):7.1f}  {pct_below(sharp, tt):7.1f}")
            flagged = [r for r in g if r[2] == -1 and r[3][fi * 2] < t]
            flat = sorted((r for r in flagged if r[3][fi * 2 + 1] < FLAT), key=lambda r: r[3][fi * 2 + 1])
            print(f"  sharp flagged at default: {len(flagged)}; low-texture (grey spread < {FLAT}): {len(flat)}"
                  + ("  e.g. " + ", ".join(f"{r[0][:3]}/{r[1]} ({r[3][fi * 2 + 1]:.3f})" for r in flat[:5]) if flat else ""))
    print("\n===== filter sensitivity (default threshold a vs b) =====")
    for gname, g in groups.items():
        ta, tb = defaults[("a", gname)], defaults[("b", gname)]
        blur_b = np.array([r[3][2] for r in g if r[2] == 1])
        sharp_b = np.array([r[3][2] for r in g if r[2] == -1])
        print(f"  {gname}: a {ta:.2f}  b {tb:.2f}  b/a {tb / ta:.2f}; "
              f"filter-a threshold applied to b scores: blurred {pct_below(blur_b, ta):.1f}%  sharp {pct_below(sharp_b, ta):.1f}%")


def selftest():
    s = np.arange(100.0)
    assert default_threshold(None, s) == 10.0 and pct_below(s, 10.0) == 10.0  # exactly 10% flagged
    assert default_threshold(None, np.full(50, 7.0)) == 7.0 and pct_below(np.full(50, 7.0), 7.0) == 0.0  # ties stay unflagged
    b = np.arange(1.0, 21.0)
    t = t_for_blur(b)
    assert pct_below(b, t) == 85.0 and t == 17.5
    print("selftest ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        selftest()
    elif len(sys.argv) in (2, 3):
        report(load(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else CACHE))
    else:
        sys.exit(__doc__)

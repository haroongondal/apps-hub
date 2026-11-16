"""Score phone CLIP vectors against the Mac reference (photo-search Phase 0).

usage: score.py <work_dir> <phone_img.f32> <phone_txt.f32>
       score.py --self-test
Exit 1 when phone vectors drift from the Mac (cosine < 0.99) or recall@5 < 0.90 (AC-2).
"""
import os
import sys
import numpy as np


def unit(a):
    return a / np.linalg.norm(a, axis=1, keepdims=True)


def cos(a, b):
    return (unit(a) * unit(b)).sum(axis=1)


def rank(img, txt, idx):
    """Rank of each query's own photo, 0 = best (spike.py's rule)."""
    s = unit(txt) @ unit(img).T
    own = s[np.arange(len(idx)), idx]
    return (s > own[:, None]).sum(axis=1)


def self_test():
    e = np.eye(3, 512, dtype=np.float32)
    txt = np.stack([e[1], 0.9 * e[2] + 0.1 * e[0]])
    r = rank(e, txt, np.array([1, 0]))
    assert r.tolist() == [0, 1], r
    assert (r < 1).mean() == 0.5 and (r < 5).mean() == 1.0
    assert abs(cos(e, e).min() - 1.0) < 1e-6
    print("self-test ok")


def main(w, phone_img, phone_txt):
    load = lambda p: np.fromfile(p, np.float32).reshape(-1, 512)
    mi, mt = load(os.path.join(w, "mac_img.f32")), load(os.path.join(w, "mac_txt.f32"))
    pi, pt = load(phone_img), load(phone_txt)
    idx = np.fromfile(os.path.join(w, "texts.idx"), np.int32)
    assert pi.shape == mi.shape and pt.shape == mt.shape == (len(idx), 512), (pi.shape, pt.shape)

    ci, ct = cos(pi, mi), cos(pt, mt)
    print(f"image cosine phone/mac: min={ci.min():.4f} mean={ci.mean():.4f}")
    print(f"text cosine phone/mac: min={ct.min():.4f} mean={ct.mean():.4f}")

    r = rank(pi, pt, idx)
    r1, r5, r10 = ((r < k).mean() for k in (1, 5, 10))
    print(f"recall@1/5/10 (phone vectors): {r1:.3f} / {r5:.3f} / {r10:.3f} over {len(idx)} queries")

    s = unit(pt) @ unit(pi).T
    true = s[np.arange(len(idx)), idx]
    s[np.arange(len(idx)), idx] = -1
    other = s.max(axis=1)
    print(f"true-photo score p5/p50: {np.percentile(true, 5):.4f} / {np.percentile(true, 50):.4f}")
    print(f"best other-photo score p50/p95: {np.percentile(other, 50):.4f} / {np.percentile(other, 95):.4f}")
    print(f"similarity floor proposal (true-photo p5): {np.percentile(true, 5):.4f}")

    ok = ci.min() >= 0.99 and ct.min() >= 0.99 and r5 >= 0.90
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
    elif len(sys.argv) == 4:
        sys.exit(main(*sys.argv[1:]))
    else:
        sys.exit(__doc__)

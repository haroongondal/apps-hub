"""Phone vs Mac outputs of the Quick edits run.

usage: compare.py <in_dir> <work_dir>
work_dir holds out-<tag>.f32 pulled from the phone (tags u2_1t u2_2t esr176 esr160 modnet_2t modnet_1t);
in_dir holds the Mac references u2.mac.f32 esr176.mac.f32 esr160.mac.f32 modnet.mac.f32 (mkinputs.py).
Per tag: max abs diff, mean abs diff, both relative to the Mac range; U2 also after min-max (what ref.u2_norm does).
Exit 1 when a phone output is missing or has the wrong size. Run with python -I (numpy only).
"""
import os
import sys
import numpy as np

TAGS = ["u2_1t", "u2_2t", "esr176", "esr160", "modnet_2t", "modnet_1t"]


def stats(p, m):
    d = np.abs(p - m)
    r = float(m.max() - m.min())
    return f"max={d.max():.3g} mean={d.mean():.3g} max/range={d.max() / r:.3g} mean/range={d.mean() / r:.3g} (Mac range {r:.4g})"


def main(inp, work):
    bad = 0
    for tag in TAGS:
        f = os.path.join(work, f"out-{tag}.f32")
        if not os.path.exists(f):
            print(f"{tag}: MISSING {f}"); bad += 1; continue
        p = np.fromfile(f, "<f4"); m = np.fromfile(os.path.join(inp, tag.split("_")[0] + ".mac.f32"), "<f4")
        if p.shape != m.shape:
            print(f"{tag}: SIZE phone {p.size} vs Mac {m.size}"); bad += 1; continue
        print(f"{tag}: {stats(p, m)}")
        if tag.startswith("u2"):
            mm = lambda a: (a - a.min()) / max(float(a.max() - a.min()), 1e-12)
            print(f"{tag} min-max: {stats(mm(p), mm(m))}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(*sys.argv[1:])

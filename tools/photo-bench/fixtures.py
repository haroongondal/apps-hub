"""Reference fixtures for the Kotlin CLIP tokenizer and image preprocessing.

usage: fixtures.py <clip_dir> <out_dir> [<ref_out_dir with texts.i64>]
The COCO set is read from <clip_dir>/../../data (set.json, img/), as ref.py builds it.
Writes tokens.json, image.png, image.f32 and README.md. Token ids are unpadded.
"""
import json
import os
import sys
import numpy as np
from PIL import Image
from tokenizers import Tokenizer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I drops the script dir
from ref import prep  # noqa: E402

EXTRA = ["", "   ", "Dog   ON the\tBEACH", "don't stop", "it's 3:45pm", "café naïve résumé",
         "🙂 smile", "!!!???", "x" * 200, "red car at night", "receipt"]
README = """Made by tools/photo-bench/fixtures.py (do not edit by hand).
Command: fixtures.py <clip_dir> packages/media-core/fixtures/photo-search [<ref_out_dir>]
tokens.json: tokenizers 0.23.3, truncation 77, no padding. image.f32: ref.py prep(), Pillow 13.0.0, numpy 2.5.4.
Cases: the COCO captions from the Phase 0 set plus edge cases; used by the Kotlin ClipTokenizer and ClipImage tests.
"""


def main(md, out, ref_dir=None):
    dd = os.path.join(os.path.dirname(os.path.abspath(md)), "..", "data")
    rows = [r for r in json.load(open(os.path.join(dd, "set.json"))) if os.path.exists(os.path.join(dd, "img", r["file"]))]
    tok = Tokenizer.from_file(os.path.join(md, "tokenizer.json"))
    tok.enable_truncation(77)
    caps = [c.strip() for r in rows for c in r["caps"]]
    cases = [{"text": t, "ids": tok.encode(t).ids} for t in caps + EXTRA]
    assert all(c["ids"][-1] == 49407 for c in cases)

    if ref_dir:
        ref = np.fromfile(os.path.join(ref_dir, "texts.i64"), np.int64).reshape(-1, 77)
        assert len(ref) == len(caps)
        for c, row in zip(cases, ref):
            n = list(row).index(49407) + 1
            assert c["ids"] == list(row[:n]), c["text"]
        print(f"cross-check ok: {len(caps)} captions match texts.i64")

    os.makedirs(out, exist_ok=True)
    json.dump(cases, open(os.path.join(out, "tokens.json"), "w"), ensure_ascii=False)
    rng = np.random.default_rng(7)
    h = np.linspace(0, 255, 300)[None, :, None] * np.ones((200, 1, 3))
    v = np.linspace(0, 255, 200)[:, None, None] * np.ones((1, 300, 3))
    noise = rng.uniform(-20, 20, (200, 300, 3))
    img = np.clip((h + v) / 2 + noise, 0, 255).round().astype(np.uint8)
    png = os.path.join(out, "image.png")
    Image.fromarray(img, "RGB").save(png)
    cfg = json.load(open(os.path.join(md, "preprocessor_config.json")))
    prep(png, cfg).astype("<f4").tofile(os.path.join(out, "image.f32"))
    open(os.path.join(out, "README.md"), "w").write(README)
    print(f"entries={len(cases)}")


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    main(*sys.argv[1:])

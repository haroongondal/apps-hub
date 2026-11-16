"""Mac reference for photo-search Phase 0: tensors to push to the phone, and Mac vectors.

usage: ref.py <clip_dir> <text_model.onnx> <data_dir> <out_dir>
Preprocessing and tokenising match the 2026-11-13 spike (CLIP branch). Writes raw
little-endian arrays: images.f32 (N,3,224,224), texts.i64 (Q,77), texts.idx (Q int32),
mac_img.f32 (N,512), mac_txt.f32 (Q,512), with ONNX Runtime on 1 thread.
Pass the full-precision text_model.onnx: the 8-bit text model gives different vectors on
the phone than on the Mac (Phase 0, 2026-11-16), so the reference is the unquantised one.
"""
import json
import os
import sys
import numpy as np
import onnxruntime as ort
from PIL import Image
from tokenizers import Tokenizer

L, PAD = 77, 49407  # CLIP context length; pad with the end-of-text id


def prep(path, cfg):
    im = Image.open(path).convert("RGB")
    s = cfg["size"]["shortest_edge"]; w, h = im.size; k = s / min(w, h)
    im = im.resize((round(w * k), round(h * k)), Image.BICUBIC)
    c = cfg["crop_size"]["height"]; w, h = im.size; l, t = (w - c) // 2, (h - c) // 2
    im = im.crop((l, t, l + c, t + c))
    a = np.asarray(im, np.float32) / 255.0
    a = (a - np.array(cfg["image_mean"], np.float32)) / np.array(cfg["image_std"], np.float32)
    return a.transpose(2, 0, 1)[None]


def sess(path):
    o = ort.SessionOptions(); o.intra_op_num_threads = 1; o.inter_op_num_threads = 1
    return ort.InferenceSession(path, o, providers=["CPUExecutionProvider"])


def main(md, text_model, dd, out):
    rows = [r for r in json.load(open(os.path.join(dd, "set.json"))) if os.path.exists(os.path.join(dd, "img", r["file"]))]
    cfg = json.load(open(os.path.join(md, "preprocessor_config.json")))
    tok = Tokenizer.from_file(os.path.join(md, "tokenizer.json"))
    tok.enable_truncation(L)
    tok.enable_padding(length=L, pad_id=PAD)

    imgs = np.concatenate([prep(os.path.join(dd, "img", r["file"]), cfg) for r in rows]).astype(np.float32)
    ids, idx = [], []
    for i, r in enumerate(rows):
        for cap in r["caps"]:
            ids.append(tok.encode(cap.strip()).ids); idx.append(i)
    ids = np.array(ids, np.int64); idx = np.array(idx, np.int32)

    vis = sess(os.path.join(md, "vision_model_quantized.onnx"))
    txt = sess(text_model)
    mi = np.concatenate([vis.run(["image_embeds"], {"pixel_values": x[None]})[0] for x in imgs])
    mt = np.concatenate([txt.run(["text_embeds"], {"input_ids": x[None]})[0] for x in ids])

    os.makedirs(out, exist_ok=True)
    for name, a in [("images.f32", imgs), ("texts.i64", ids), ("texts.idx", idx),
                    ("mac_img.f32", mi.astype(np.float32)), ("mac_txt.f32", mt.astype(np.float32))]:
        a.tofile(os.path.join(out, name))
    print(f"photos={len(rows)} queries={len(ids)} -> {out}")


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    main(*sys.argv[1:])

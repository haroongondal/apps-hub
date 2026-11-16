"""Export Real-ESRGAN general-x4v3 (.pth, BSD-3) to ONNX and check it against PyTorch.

usage: export_esrgan.py <realesr-general-x4v3.pth> <out.onnx> <T | dyn>
T is the fixed square input side (128 + 2*overlap); "dyn" makes H and W dynamic (only for
the whole-image check in ref.py). Opset 17, input "input" 1x3xTxT, output "output" 1x3x4Tx4T,
both RGB float in 0..1 (the output is not clamped; clamp before quantising).
Needs torch + onnx + onnxruntime in a scratch venv, never in the repo.
"""
import sys
import numpy as np
import onnxruntime as ort
import torch
from torch import nn
from torch.nn import functional as F


class SRVGGNetCompact(nn.Module):
    """Copy of realesrgan/archs/srvgg_arch.py (xinntao/Real-ESRGAN, BSD-3-Clause), prelu only."""

    def __init__(self, num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=32, upscale=4):
        super().__init__()
        self.upscale = upscale
        self.body = nn.ModuleList([nn.Conv2d(num_in_ch, num_feat, 3, 1, 1), nn.PReLU(num_parameters=num_feat)])
        for _ in range(num_conv):
            self.body.append(nn.Conv2d(num_feat, num_feat, 3, 1, 1))
            self.body.append(nn.PReLU(num_parameters=num_feat))
        self.body.append(nn.Conv2d(num_feat, num_out_ch * upscale * upscale, 3, 1, 1))
        self.upsampler = nn.PixelShuffle(upscale)

    def forward(self, x):
        out = x
        for layer in self.body:
            out = layer(out)
        return self.upsampler(out) + F.interpolate(x, scale_factor=self.upscale, mode="nearest")


def main(pth, out, t):
    net = SRVGGNetCompact()
    sd = torch.load(pth, map_location="cpu", weights_only=True)
    key = "params_ema" if "params_ema" in sd else "params"  # as RealESRGANer does
    net.load_state_dict(sd[key], strict=True)
    net.eval()
    side = 64 if t == "dyn" else int(t)
    x = torch.from_numpy(np.random.default_rng(1).random((1, 3, side, side), np.float32))
    dyn = {"input": {2: "h", 3: "w"}, "output": {2: "h4", 3: "w4"}} if t == "dyn" else None
    torch.onnx.export(net, (x,), out, input_names=["input"], output_names=["output"],
                      opset_version=17, dynamic_axes=dyn, dynamo=False)
    with torch.no_grad():
        ref = net(x).numpy()
    s = ort.InferenceSession(out, providers=["CPUExecutionProvider"])
    got = s.run(["output"], {"input": x.numpy()})[0]
    d = float(np.abs(got - ref).max())
    print(f"key={key} torch={torch.__version__} in={list(x.shape)} out={list(got.shape)} max_abs_diff={d:.3g}")
    assert got.shape == (1, 3, 4 * side, 4 * side) and d <= 1e-4


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])

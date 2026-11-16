Made by tools/quick-edits-bench/fixtures.py (do not edit by hand).
Command: fixtures.py <u2netp.onnx> <realesr-general-x4v3 T=176 onnx> packages/media-core/fixtures/quick-edits
Maths: tools/quick-edits-bench/ref.py (its docstring has the exact pre/post steps and the reflect formula).
numpy 2.5.4, onnxruntime 1.32.0 (CPU, 1 thread), Pillow 13.0.0.
Models (not in git): u2netp.onnx sha256 309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8;
realesr-general-x4v3 (export_esrgan.py, T=176) sha256 1c1bda585a8b044760e807d4e454b0a2f4bf0c0f0096ff4d8046c422e54f5ce0.

U2-Netp (non-square on purpose, so a mask left square or stretched fails):
- u2_input.png   300x200 RGB, seeded synthetic (ref.synth seed 5 plus a centred ellipse).
- u2_input.f32   1x3x320x320, ref.u2_prep(u2_input.png).
- u2_pred.f32    320x320, first model output after min-max (ref.u2_norm).
- u2_mask.png    300x200 L, ref.u2_mask(pred, 300, 200, feather_px=2).
Real-ESRGAN general-x4v3, tile 128, overlap 24, T 176, scale 4:
- esrgan_input.png / esrgan_out.png            300x200 -> 1200x800, 3x2 tiles, partial cores on both axes.
- esrgan_thin_input.png / esrgan_thin_out.png  129x20 -> 516x80, 2 tiles, mirroring bounces several times.
- esrgan_tiles.json  per case: the ref.tiles list [x, y, x0, y0, x1, y1] (input window top-left,
  may be negative; then the core it fills, in input px).

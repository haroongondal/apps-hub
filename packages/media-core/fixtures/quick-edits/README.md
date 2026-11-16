Made by tools/quick-edits-bench/fixtures.py (do not edit by hand).
Command: fixtures.py <models_dir> packages/media-core/fixtures/quick-edits
Maths: tools/quick-edits-bench/ref.py (its docstring has the exact pre/post steps).
numpy 2.5.4, onnxruntime 1.32.0 (CPU, 1 thread), Pillow 13.0.0.
Models (not in git): u2netp.onnx sha256 309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8;
realesr-general-x4v3.onnx (export_esrgan.py, T=160) sha256 e47fb5c4f58115d0e87dc42ea7ca932575c11bd2f89f930616925da460a8f4b9.

U2-Netp (non-square on purpose, so a mask left square or stretched fails):
- u2_input.png   300x200 RGB, seeded synthetic (ref.synth seed 5 plus a centred ellipse).
- u2_input.f32   1x3x320x320, ref.u2_prep(u2_input.png).
- u2_pred.f32    320x320, first model output after min-max (ref.u2_norm).
- u2_mask.png    300x200 L, ref.u2_mask(pred, 300, 200, feather_px=2).
Real-ESRGAN general-x4v3:
- esrgan_input.png  160x120 RGB, ref.synth seed 6.
- esrgan_tiles.json tile 128, overlap 16, T 160, scale 4, ref.tiles list
  [x, y, x0, y0, x1, y1] (input window top-left, then the core it fills).
- esrgan_out.png    640x480 RGB, ref.upscale with the fixed T=160 model.

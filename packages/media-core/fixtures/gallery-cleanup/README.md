Made by tools/gallery-cleanup-bench/fixtures.py (do not edit by hand).
Command: fixtures.py packages/media-core/fixtures/gallery-cleanup   (run with the pinned requirements.txt)
Maths: tools/gallery-cleanup-bench/ref.py (docstring: the exact recipe of grey, dhash, brightness,
laplacian_var, aspect_close). numpy 2.5.4, Pillow 13.0.0. Self-check: python -I ref.py.
All images are seeded synthetic RGB (ref-style shapes, gradient, Gaussian noise), no photos.

cases.json: per case file, w, h, grey_sha256 (sha256 of the row-major uint8 grey bytes), dhash (16 hex
chars, bit 63 = row 0 pair 0), brightness [mean, spread] and laplacian_var (repr of the float64);
"pairs": hamming of the dhashes; "aspect": aspect_close inputs and result. Floats are exact for the
Python recipe; Kotlin matches to 1e-12 (brightness) and 1e-9 (laplacian_var) relative, dhash exactly.
- noisy   300x200  structure plus noise sigma 6, the base of the pairs.
- half    150x100  noisy resized 50% with Pillow LANCZOS: AC-3 look-alike, Hamming must stay <= 4.
- blur    300x200  noisy through Pillow GaussianBlur(2): Laplacian variance must drop.
- other   300x200  a second unrelated seed: Hamming to noisy must exceed 4.
- odd     37x23    odd size, so cell footprints are fractional on both axes (odd.u8 holds its grey).
- flat    64x48    grey 128: dhash 0, spread 0, Laplacian variance 0.
- dark    120x80   seed 3 scaled by 0.04 (mean about 2%): mean below 8%.
- blown   120x80   seed 4 squeezed into 235..255 (mean about 96%): mean above 92%.

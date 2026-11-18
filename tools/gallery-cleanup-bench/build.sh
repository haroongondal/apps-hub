#!/usr/bin/env bash
# usage: build.sh <out_dir>   (out_dir outside git, e.g. .superpowers/sdd/2026-11-18-image-tools-2.0/gc-phone/build)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
out=${1:?usage: build.sh <out_dir>}
mkdir -p "$out" && out=$(cd "$out" && pwd)
jdk=${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}
sdk=${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}
py=${PY:-$root/.superpowers/sdd/2026-11-17-image-tools-3.0/qe-in/venv/bin/python}
jar=$sdk/platforms/android-36/android.jar

rm -rf "$out/classes" "$out/fx" "$out/bench.jar"
mkdir -p "$out/classes" "$out/fx"
"$jdk/bin/javac" --release 11 -d "$out/classes" "$here/Bench.java"
"$jdk/bin/javac" --release 11 -cp "$jar" -d "$out/classes" "$here/Decode.java"
JAVA_HOME=$jdk "$sdk/build-tools/36.0.0/d8" --min-api 30 --lib "$jar" --output "$out/bench.jar" "$out/classes"/*.class

"$py" -I - "$root/packages/media-core/fixtures/gallery-cleanup" "$out" <<'EOF'
import json, os, sys
import numpy as np
from PIL import Image
fx, out = sys.argv[1], sys.argv[2]
lines = []
for name, c in json.load(open(os.path.join(fx, "cases.json")))["cases"].items():
    a = np.asarray(Image.open(os.path.join(fx, c["file"])).convert("RGB")).astype(np.uint32)
    assert a.shape[:2] == (c["h"], c["w"]), name
    (0xFF000000 | a[..., 0] << 16 | a[..., 1] << 8 | a[..., 2]).astype(">u4").tofile(os.path.join(out, "fx", name + ".argb"))
    lines.append(f'{name} {c["w"]} {c["h"]} {c["grey_sha256"]} {c["dhash"]} {c["brightness"][0]!r} {c["brightness"][1]!r} {c["laplacian_var"]}\n')
open(os.path.join(out, "fx", "expected.txt"), "w").writelines(lines)
jpg = os.path.join(out, "decode.jpg")
rng = np.random.default_rng(20261118)
y, x = np.mgrid[0:3000, 0:4000]
img = np.stack([x * 200 / 4000 + 30, y * 180 / 3000 + 40, 120 + 60 * np.sin(x * 0.004 + y * 0.003)], -1)
img[800:1900, 1200:2600] = (210, 60, 40)
img += rng.normal(0, 4, (3000, 4000, 1))
Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(jpg, quality=90)
print(f"build: {len(lines)} fixture cases, decode.jpg {os.path.getsize(jpg)} bytes")
EOF
ls -l "$out/bench.jar"
"$jdk/bin/java" -cp "$out/classes" Bench check "$out/fx"

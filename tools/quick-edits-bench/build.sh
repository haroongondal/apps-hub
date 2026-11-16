#!/usr/bin/env bash
# Links the AAR's own libonnxruntime.so so phone numbers are the library the app will load.
set -euo pipefail
aar=${1:?usage: build.sh <unpacked_aar_dir> <out_dir>}
out=${2:?usage: build.sh <unpacked_aar_dir> <out_dir>}
bin=/opt/homebrew/share/android-commandlinetools/ndk/27.1.12297006/toolchains/llvm/prebuilt/darwin-x86_64/bin
mkdir -p "$out"
"$bin/aarch64-linux-android28-clang++" -O2 -std=c++17 -I"$aar/headers" "$(dirname "$0")/bench.cpp" \
  -L"$aar/jni/arm64-v8a" -lonnxruntime -static-libstdc++ -Wl,-z,max-page-size=16384 -o "$out/qe-bench"
"$bin/llvm-strip" "$out/qe-bench"
cp "$aar/jni/arm64-v8a/libonnxruntime.so" "$out/"
"$bin/llvm-readelf" -d "$out/qe-bench" | grep NEEDED

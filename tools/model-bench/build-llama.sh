#!/usr/bin/env bash
set -euo pipefail

out=${1:?usage: build-llama.sh <out-dir>}
mkdir -p "$out"
out=$(cd "$out" && pwd)
sdk=/opt/homebrew/share/android-commandlinetools
cmake=$sdk/cmake/3.22.1/bin/cmake
ninja=$sdk/cmake/3.22.1/bin/ninja
targets=(llama-server llama-bench llama-mtmd-cli)

[ -d "$out/src" ] || git clone --depth 1 --branch b11803 https://github.com/ggml-org/llama.cpp "$out/src"

configure() {
  local dir=$1; shift
  "$cmake" -S "$out/src" -B "$out/$dir" -G Ninja -DCMAKE_MAKE_PROGRAM="$ninja" -DCMAKE_BUILD_TYPE=Release "$@" 2>&1 | tee "$out/$dir.configure.log"
  if grep -q "Manually-specified variables were not used" "$out/$dir.configure.log"; then
    echo "build-llama: cmake ignored a flag for $dir; see $out/$dir.configure.log" >&2
    exit 1
  fi
}

configure host
"$cmake" --build "$out/host" --target "${targets[@]}" -j

configure android \
  -DCMAKE_TOOLCHAIN_FILE="$sdk/ndk/27.1.12297006/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-28 \
  -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DLLAMA_CURL=OFF \
  -DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16
"$cmake" --build "$out/android" --target "${targets[@]}" -j
for t in "${targets[@]}"; do
  "$sdk/ndk/27.1.12297006/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-strip" "$out/android/bin/$t"
done

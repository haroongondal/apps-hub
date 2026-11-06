#!/usr/bin/env bash
set -euo pipefail

dir=${1:?usage: fetch-models.sh <models-dir>}
mkdir -p "$dir"

files=(
  "Qwen/Qwen3-VL-2B-Instruct-GGUF Qwen3VL-2B-Instruct-Q4_K_M.gguf"
  "Qwen/Qwen3-VL-2B-Instruct-GGUF mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf"
  "ggml-org/SmolVLM2-2.2B-Instruct-GGUF SmolVLM2-2.2B-Instruct-Q4_K_M.gguf"
  "ggml-org/SmolVLM2-2.2B-Instruct-GGUF mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf"
  "ggml-org/InternVL3-1B-Instruct-GGUF InternVL3-1B-Instruct-Q8_0.gguf"
  "ggml-org/InternVL3-1B-Instruct-GGUF mmproj-InternVL3-1B-Instruct-Q8_0.gguf"
  "ggml-org/gemma-4-E2B-it-GGUF gemma-4-E2B-it-Q4_0.gguf"
  "ggml-org/gemma-4-E2B-it-GGUF mmproj-gemma-4-E2B-it-Q8_0.gguf"
  "ggml-org/Julia-1-GGUF Julia-1-Q8_0.gguf"
  "ggml-org/Laya-GGUF Laya-Q8_0.gguf"
  "ggml-org/Kev-0.8B-GGUF Kev-0.8B-Q8_0.gguf"
)

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }

for entry in "${files[@]}"; do
  read -r repo file <<<"$entry"
  want=$(curl -fsSL "https://huggingface.co/api/models/$repo?blobs=true" | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const f = JSON.parse(s).siblings.find((x) => x.rfilename === process.argv[1]);
      if (!f?.lfs?.sha256) { console.error(`no lfs.sha256 for ${process.argv[1]}`); process.exit(1); }
      console.log(f.lfs.sha256);
    });' "$file")
  path=$dir/$file
  if [ -f "$path" ] && [ "$(sha "$path")" = "$want" ]; then
    echo "$file $(wc -c <"$path" | tr -d ' ') bytes sha256 ok (already here)"
    continue
  fi
  curl -fL --retry 3 -o "$path" "https://huggingface.co/$repo/resolve/main/$file"
  got=$(sha "$path")
  if [ "$got" != "$want" ]; then
    rm -f "$path"
    echo "$file: sha256 mismatch (expected $want, got $got); deleted" >&2
    exit 1
  fi
  echo "$file $(wc -c <"$path" | tr -d ' ') bytes sha256 ok"
done

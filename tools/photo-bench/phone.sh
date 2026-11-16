#!/usr/bin/env bash
# usage: phone.sh push <bin_dir> vision_model_quantized.onnx text_model_fp16.onnx images.f32 texts.i64 | run <image|text> <threads> <cpu_mask> <input> <tag> <work_dir> | info | clean
set -euo pipefail
adb=${ADB:-adb}
dir=/data/local/tmp/pb
: "${ANDROID_SERIAL:?set ANDROID_SERIAL to the adb serial of the phone}"
"$adb" devices | grep -qE "^$ANDROID_SERIAL[[:space:]]+device" || { echo "phone.sh: $ANDROID_SERIAL not connected" >&2; exit 1; }
sh() { "$adb" shell "$@" | tr -d '\r'; }

push() {
  local bin=$1; shift
  local files=("$bin/clip-bench" "$bin/libonnxruntime.so" "$@")
  local need_kb=$(( $(cat "${files[@]}" | wc -c) / 1024 + 500 * 1024 ))
  local free_kb
  free_kb=$(sh "df -k /data/local/tmp" | awk 'NR == 2 { print $4 }')
  [ "$free_kb" -ge "$need_kb" ] || { echo "phone.sh: $free_kb KB free, need $need_kb KB" >&2; exit 1; }
  sh "mkdir -p $dir"
  for f in "${files[@]}"; do "$adb" push "$f" "$dir/" | tail -1; done
  sh "chmod 755 $dir/clip-bench"
}

run() {
  local kind=$1 threads=$2 mask=$3 input=$4 tag=$5 work=$6 model=text_model_fp16.onnx
  [ "$kind" = image ] && model=vision_model_quantized.onnx
  local line
  line=$(sh "cd $dir && CLIP_BENCH_UNPADDED=1 LD_LIBRARY_PATH=. taskset $mask ./clip-bench $model $input $kind $threads out-$tag.f32")
  echo "$tag: $line"
  "$adb" pull "$dir/out-$tag.f32" "$work/out-$tag.f32" >/dev/null
}

info() {
  sh 'for c in /sys/devices/system/cpu/cpu[0-9]*; do echo "${c##*/} $(cat $c/cpufreq/cpuinfo_max_freq)"; done
      for s in top-app foreground background; do echo "cpuset $s: $(cat /dev/cpuset/$s/cpus 2>/dev/null)"; done
      dumpsys battery | grep -E "level|temperature|USB powered|AC powered"'
}

cmd=${1:?usage: phone.sh push|run|info|clean}; shift
case $cmd in
  push) push "$@" ;;
  run) run "$@" ;;
  info) info ;;
  clean) sh "rm -rf $dir" ;;
  *) echo "phone.sh: unknown command $cmd" >&2; exit 2 ;;
esac

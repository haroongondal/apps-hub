#!/usr/bin/env bash
# usage: phone.sh push <bin_dir> <files...> | run <model> <input> <d0,d1,d2,d3> <threads> <cpu_mask> <loops> <tag> <work_dir> | post <cpu_mask> | info | clean
# model and input are file names inside the phone folder (pushed by `push`). `run` and `post` start the bench under nohup
# on the phone and poll for it, so a USB or Wi-Fi drop cannot kill the run.
set -euo pipefail
adb=${ADB:-adb}
dir=/data/local/tmp/it
: "${ANDROID_SERIAL:?set ANDROID_SERIAL to the adb serial of the phone}"
"$adb" devices | grep -qE "^$ANDROID_SERIAL[[:space:]]+device" || { echo "phone.sh: $ANDROID_SERIAL not connected" >&2; exit 1; }
sh() { "$adb" shell "$@" | tr -d '\r'; }

push() {
  local bin=$1; shift
  local files=("$bin/qe-bench" "$bin/libonnxruntime.so" "$@")
  local need_kb=$(( $(cat "${files[@]}" | wc -c) / 1024 + 500 * 1024 ))
  local free_kb
  free_kb=$(sh "df -k /data/local/tmp" | awk 'NR == 2 { print $4 }')
  [ "$free_kb" -ge "$need_kb" ] || { echo "phone.sh: $free_kb KB free, need $need_kb KB" >&2; exit 1; }
  sh "mkdir -p $dir"
  for f in "${files[@]}"; do "$adb" push "$f" "$dir/" | tail -1; done
  sh "chmod 755 $dir/qe-bench"
}

# detach <tag> <mask> <bench args...>: nohup the bench, wait for its exit-code file, print its log.
detach() {
  local tag=$1 mask=$2; shift 2
  sh "rm -f $dir/done-$tag $dir/log-$tag.txt"
  "$adb" shell "cd $dir && nohup sh -c 'LD_LIBRARY_PATH=. taskset $mask ./qe-bench $* > log-$tag.txt 2>&1; echo \$? > done-$tag' > /dev/null 2>&1 &"
  local code=""
  for _ in $(seq 1 600); do  # 20 min cap; a dropped poll just retries
    code=$(sh "cat $dir/done-$tag 2>/dev/null" || true)
    [ -n "$code" ] && break
    sleep 2
  done
  [ -n "$code" ] || { echo "phone.sh: $tag did not finish in 20 min; log stays at $dir/log-$tag.txt" >&2; return 1; }
  echo "$tag: $(sh "cat $dir/log-$tag.txt")"
  [ "$code" = 0 ] || { echo "phone.sh: $tag exited with $code" >&2; return 1; }
}

run() {
  local model=$1 input=$2 shape=$3 threads=$4 mask=$5 loops=$6 tag=$7 work=$8
  detach "$tag" "$mask" "$model" "$input" "$shape" "$threads" "$loops" "out-$tag.f32"
  "$adb" pull "$dir/out-$tag.f32" "$work/out-$tag.f32" >/dev/null
}

info() {
  sh 'for c in /sys/devices/system/cpu/cpu[0-9]*; do echo "${c##*/} $(cat $c/cpufreq/cpuinfo_max_freq)"; done
      for s in top-app foreground background; do echo "cpuset $s: $(cat /dev/cpuset/$s/cpus 2>/dev/null)"; done
      dumpsys battery | grep -E "level|temperature|USB powered|AC powered"'
}

cmd=${1:?usage: phone.sh push|run|post|info|clean}; shift
case $cmd in
  push) push "$@" ;;
  run) run "$@" ;;
  post) detach post "${1:?cpu mask}" post 1 ;;
  info) info ;;
  clean) sh "rm -rf $dir" ;;
  *) echo "phone.sh: unknown command $cmd" >&2; exit 2 ;;
esac

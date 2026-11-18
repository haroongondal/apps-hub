#!/usr/bin/env bash
# usage: ANDROID_SERIAL=<adb serial> phone.sh stage <build_dir> | info | clean   (stage always removes /data/local/tmp/gc)
set -euo pipefail
adb=${ADB:-adb}
dir=/data/local/tmp/gc
want=49kjmnuwonkffqzh
: "${ANDROID_SERIAL:?set ANDROID_SERIAL to the adb serial or transport of the phone}"
sh() { "$adb" shell "$@" | tr -d '\r'; }
serial=$(sh getprop ro.serialno || true)
[ "$serial" = "$want" ] || { echo "phone.sh: $ANDROID_SERIAL reports serial '$serial', not $want; refusing" >&2; exit 1; }

# nohup so a USB or Wi-Fi drop cannot kill the run; the poll retries until the done file appears (20 min cap).
detach() {
  local tag=$1 mask=$2; shift 2
  sh "rm -f $dir/done-$tag $dir/log-$tag.txt"
  "$adb" shell "cd $dir && nohup sh -c 'CLASSPATH=$dir/bench.jar taskset $mask app_process $dir $* > log-$tag.txt 2>&1; echo \$? > done-$tag' > /dev/null 2>&1 &"
  local code=""
  for _ in $(seq 1 600); do
    code=$(sh "cat $dir/done-$tag 2>/dev/null" || true)
    [ -n "$code" ] && break
    sleep 2
  done
  if [ -z "$code" ]; then
    echo "phone.sh: $tag did not finish in 20 min; its log so far:" >&2
    sh "cat $dir/log-$tag.txt; pkill -f 'app_process $dir'" >&2 || true
    return 1
  fi
  echo "== $tag (taskset $mask): $*"
  sh "cat $dir/log-$tag.txt"
  [ "$code" = 0 ] || { echo "phone.sh: $tag exited with $code" >&2; return 1; }
}

info() {
  echo "== info $(date '+%H:%M:%S')"
  sh 'for c in /sys/devices/system/cpu/cpu[0-9]*; do echo "${c##*/} $(cat $c/cpufreq/cpuinfo_max_freq)"; done
      for s in top-app foreground background; do echo "cpuset $s: $(cat /dev/cpuset/$s/cpus 2>/dev/null)"; done
      dumpsys battery | grep -E "level|temperature|USB powered|AC powered"'
}

clean() {
  sh "rm -rf $dir" || echo "phone.sh: clean FAILED; run: adb -s $ANDROID_SERIAL shell rm -rf $dir"
  sh "[ -e $dir ] && echo 'phone.sh: $dir STILL THERE' || echo 'phone.sh: $dir is gone'" || true
}

stage() {
  local b
  b=$(cd "${1:?usage: phone.sh stage <build_dir>}" && pwd)
  trap 'rc=$?; clean; echo "phone.sh: stage exit $rc"' EXIT
  info
  sh "rm -rf $dir && mkdir -p $dir/fx"
  "$adb" push "$b/bench.jar" "$b/decode.jpg" "$dir/" | tail -1
  "$adb" push "$b"/fx/* "$dir/fx/" | tail -1
  detach check 40 Bench check $dir/fx
  detach time_a76 40 Bench time 512 384 300
  detach time_a55 4 Bench time 512 384 300
  detach decode_a76 40 Decode $dir/decode.jpg 20 || echo "phone.sh: decode stand-in on cpu6 failed (optional)"
  detach decode_a55 4 Decode $dir/decode.jpg 20 || echo "phone.sh: decode stand-in on cpu2 failed (optional)"
  info
}

cmd=${1:?usage: phone.sh stage <build_dir> | info | clean}; shift
case $cmd in
  stage) stage "$@" ;;
  info) info ;;
  clean) clean ;;
  *) echo "phone.sh: unknown command $cmd" >&2; exit 2 ;;
esac

#!/usr/bin/env bash
# PORT (default 8080) is the phone-side port; the Mac side is 1$PORT because the Mac's own 8080 may be taken.
set -euo pipefail

adb=${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}
dir=/data/local/tmp/mb
port=${PORT:-8080}
mac_port=1$port
pidfile=$dir/server-$port.pid

if [ -n "${ANDROID_SERIAL:-}" ]; then
  "$adb" devices | grep -qE "^$ANDROID_SERIAL[[:space:]]+device" || { echo "phone.sh: device $ANDROID_SERIAL not connected" >&2; exit 1; }
else
  devices=$("$adb" devices | grep -cw device || true)
  [ "$devices" = 1 ] || { echo "phone.sh: need exactly one adb device (or ANDROID_SERIAL), found $devices" >&2; exit 1; }
fi

sh() { "$adb" shell "$@"; }
pid() { sh "cat $pidfile 2>/dev/null" | tr -d '\r'; }

cmd=${1:?usage: phone.sh push-bin|push <file>|rm <file>|serve <args…>|alive|hwm|stop|clean}
shift
case $cmd in
  push-bin)
    out=${BENCH_DIR:?set BENCH_DIR}/llama/android/bin
    sh "mkdir -p $dir"
    for t in llama-server llama-bench llama-mtmd-cli; do "$adb" push "$out/$t" "$dir/$t" >/dev/null; done
    sh "chmod 755 $dir/llama-server $dir/llama-bench $dir/llama-mtmd-cli"
    ;;
  push)
    file=${1:?usage: phone.sh push <file>}
    need_kb=$(( $(wc -c <"$file") / 1024 + 500 * 1024 ))
    free_kb=$(sh "df -k /data/local/tmp" | tr -d '\r' | awk 'NR == 2 { print $4 }')
    [ "$free_kb" -ge "$need_kb" ] || { echo "phone.sh: $free_kb KB free, need $need_kb KB for $(basename "$file")" >&2; exit 1; }
    sh "mkdir -p $dir"
    "$adb" push "$file" "$dir/$(basename "$file")" >/dev/null
    ;;
  rm)
    sh "rm -f $dir/$(basename "${1:?usage: phone.sh rm <file>}")"
    ;;
  serve)
    # `;` not `&&`: with `&&` the `&` backgrounds a subshell that holds adb's stdout open (adb never returns) and $! is that subshell
    sh "cd $dir; nohup ./llama-server --host 127.0.0.1 --port $port $* </dev/null >server-$port.log 2>&1 & echo \$! >$pidfile"
    "$adb" forward "tcp:$mac_port" "tcp:$port" >/dev/null
    start=$(perl -MTime::HiRes=time -e 'print time')
    p=$(pid)
    until curl -sf "http://127.0.0.1:$mac_port/health" >/dev/null; do
      if ! sh "kill -0 $p 2>/dev/null"; then
        echo "phone.sh: process died while loading" >&2
        sh "tail -5 $dir/server-$port.log" >&2
        exit 1
      fi
      sleep 0.5
    done
    perl -MTime::HiRes=time -e "printf \"loaded in %.1f s (pid $p, mac port $mac_port)\n\", time - $start"
    ;;
  alive)
    p=$(pid)
    [ -n "$p" ] && sh "kill -0 $p 2>/dev/null" || { echo "process died"; exit 1; }
    echo "alive (pid $p)"
    ;;
  hwm)
    sh "grep VmHWM /proc/$(pid)/status"
    ;;
  stop)
    p=$(pid)
    [ -z "$p" ] || sh "kill $p 2>/dev/null; rm -f $pidfile" || true
    "$adb" forward --remove "tcp:$mac_port" 2>/dev/null || true
    ;;
  clean)
    # a server left running would hold 1.7–4 GB from a deleted binary, so stop every saved one first
    sh "for f in $dir/server-*.pid; do [ -f \$f ] && kill \$(cat \$f) 2>/dev/null; done; rm -rf $dir"
    "$adb" forward --remove-all
    ;;
  *)
    echo "phone.sh: unknown command $cmd" >&2
    exit 2
    ;;
esac

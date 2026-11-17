#!/usr/bin/env bash
# Quick edits Phase 0, stage B: the whole phone run in one command (phone must be claimed first).
# usage: ANDROID_SERIAL=<serial> tools/quick-edits-bench/stageb.sh <Q>
# Q holds bin/ (qe-bench, libonnxruntime.so), models/ (u2netp, esr176, esr160, modnet .onnx), in/ (mkinputs.py output) and venv/.
# Writes Q/stageb.out (all output) and Q/work/ (outputs pulled from the phone). Always removes /data/local/tmp/it on exit.
set -euo pipefail
q=$(cd "${1:?usage: ANDROID_SERIAL=<serial> stageb.sh <Q>}" && pwd)
here=$(cd "$(dirname "$0")" && pwd)
: "${ANDROID_SERIAL:?set ANDROID_SERIAL to the adb serial of the phone}"
mkdir -p "$q/work"
exec > >(tee "$q/stageb.out") 2>&1
ph() { "$here/phone.sh" "$@"; }
cleanup() {
  rc=$?
  ph clean || echo "stageb: clean FAILED, remove /data/local/tmp/it by hand"
  "${ADB:-adb}" shell "[ -e /data/local/tmp/it ] && echo 'stageb: /data/local/tmp/it STILL THERE' || echo 'stageb: /data/local/tmp/it is gone'" | tr -d '\r' || true
  echo "stageb: exit $rc"
}
trap cleanup EXIT

files=("$q/models/u2netp.onnx" "$q/models/esr176.onnx" "$q/models/esr160.onnx" "$q/models/modnet.onnx"
       "$q/in/u2_input.f32" "$q/in/esr176.f32" "$q/in/esr160.f32" "$q/in/modnet.f32")
for f in "${files[@]}" "$q/bin/qe-bench" "$q/bin/libonnxruntime.so"; do printf '%10d  %s\n' "$(wc -c < "$f")" "$f"; done
echo "total bytes: $(cat "${files[@]}" "$q/bin/qe-bench" "$q/bin/libonnxruntime.so" | wc -c)"

ph info
ph push "$q/bin" "${files[@]}"
w=$q/work
ph run u2netp.onnx u2_input.f32 1,3,320,320 1 40 30 u2_1t "$w"
ph run u2netp.onnx u2_input.f32 1,3,320,320 2 c0 30 u2_2t "$w"
ph run esr176.onnx esr176.f32 1,3,176,176 2 c0 81 esr176 "$w"
ph run esr160.onnx esr160.f32 1,3,160,160 2 c0 81 esr160 "$w"
ph run modnet.onnx modnet.f32 1,3,512,672 2 c0 10 modnet_2t "$w"
ph run modnet.onnx modnet.f32 1,3,512,672 1 40 10 modnet_1t "$w"
ph post 40
ph info
"$q/venv/bin/python" -I "$here/compare.py" "$q/in" "$w"

#!/usr/bin/env bash
# Debug build only (run-as): finds a known username/password as plain, UTF-16 or Base64 bytes in Strongroom's data. Exit 1 on a hit, 2 if unreadable.
set -euo pipefail
export LC_ALL=C

if [ $# -lt 2 ] || [ $# -gt 3 ]; then
  echo "usage: $0 <username> <password> [serial, default emulator-5554; adb always gets -s]" >&2
  exit 2
fi
serial=${3:-emulator-5554}
adb=${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}/platform-tools/adb
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

"$adb" -s "$serial" exec-out run-as com.haroon.strongroom tar c . > "$tmp/data.tar" || true
if ! tar -tf "$tmp/data.tar" > "$tmp/list" 2>/dev/null || [ ! -s "$tmp/list" ]; then
  echo "couldn't read Strongroom's data on $serial (is the debug build installed?)" >&2
  exit 2
fi
# shortcut: UTF-16 is found by deleting NUL bytes, which works for ASCII secrets only; add a UTF-16 needle for a non-ASCII test secret.
tr -d '\000' < "$tmp/data.tar" > "$tmp/nonul"

base64_needles() {
  local k enc start end
  for k in 0 1 2; do
    enc=$(printf '%s%s' "$(printf '%*s' "$k" '')" "$1" | base64 | tr -d '\n')
    start=$((k > 0 ? 4 : 0))
    end=$(((k + ${#1}) / 3 * 4))
    printf '%s\n' "${enc:start:end-start}"
    printf '%s\n' "${enc:start:end-start}" | tr '+/' '-_'
  done
}

count() { grep -c -a -F -e "$2" "$1" || true; }

hits=0
for label in username password; do
  secret=$([ "$label" = username ] && printf '%s' "$1" || printf '%s' "$2")
  n=$(count "$tmp/data.tar" "$secret")
  echo "$label, plain: $n"
  hits=$((hits + n))
  n=$(count "$tmp/nonul" "$secret")
  echo "$label, plain or UTF-16: $n"
  hits=$((hits + n))
  n=0
  while read -r needle; do n=$((n + $(count "$tmp/data.tar" "$needle"))); done < <(base64_needles "$secret" | sort -u)
  echo "$label, Base64: $n"
  hits=$((hits + n))
done

echo "$hits hits in $(grep -vc '/$' "$tmp/list") files on $serial"
[ "$hits" -eq 0 ]

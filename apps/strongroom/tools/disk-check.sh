#!/usr/bin/env bash
# Debug build only (run-as): finds known secrets (username, password, account key text, a token's Base64) as plain, UTF-16 or Base64 (also line-wrapped) bytes, and hex:<hex> secrets (raw token bytes), in the app's data. Exit 1 on a hit, 2 if unreadable.
# Covers the credential-encrypted app data directory only (run-as's working directory), not /data/user_de or /sdcard/Android/data.
set -euo pipefail
export LC_ALL=C

if [ $# -lt 3 ]; then
  echo "usage: $0 <serial> <package, e.g. com.haroon.strongroom.synctest> <secret>... (a secret written hex:<hex> is searched as raw bytes)" >&2
  exit 2
fi
serial=$1
package=$2
shift 2
adb=${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}/platform-tools/adb
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

"$adb" -s "$serial" exec-out run-as "$package" tar c . > "$tmp/data.tar" || true
if ! tar -tf "$tmp/data.tar" > "$tmp/list" 2>/dev/null || [ ! -s "$tmp/list" ]; then
  echo "couldn't read $package's data on $serial (is a debug build installed?)" >&2
  exit 2
fi
# shortcut: UTF-16 is found by deleting NUL bytes, which works for ASCII secrets only; add a UTF-16 needle for a non-ASCII test secret.
tr -d '\000' < "$tmp/data.tar" > "$tmp/nonul"
tr -d '\r\n' < "$tmp/data.tar" > "$tmp/nolf"
# One hex line, so raw bytes match at any offset (an odd-nibble match only adds a false hit).
xxd -p "$tmp/data.tar" | tr -d '\n' > "$tmp/hex"

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
i=0
for secret in "$@"; do
  i=$((i + 1))
  if [ "${secret#hex:}" != "$secret" ]; then
    n=$(count "$tmp/hex" "$(printf '%s' "${secret#hex:}" | tr 'A-F' 'a-f')")
    echo "secret $i, raw bytes: $n"
    hits=$((hits + n))
    continue
  fi
  n=$(count "$tmp/data.tar" "$secret")
  echo "secret $i, plain: $n"
  hits=$((hits + n))
  n=$(count "$tmp/nonul" "$secret")
  echo "secret $i, plain or UTF-16: $n"
  hits=$((hits + n))
  n=0
  while read -r needle; do n=$((n + $(count "$tmp/nolf" "$needle"))); done < <(base64_needles "$secret" | sort -u)
  echo "secret $i, Base64: $n"
  hits=$((hits + n))
done

echo "$hits hits in $(grep -vc '/$' "$tmp/list") files of $package on $serial"
[ "$hits" -eq 0 ]

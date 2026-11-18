#!/usr/bin/env bash
cd "$(dirname "$0")"
xattr -dr com.apple.quarantine "$(basename "$0")" install-macos.sh 2>/dev/null || true
chmod +x install-macos.sh 2>/dev/null || true
./install-macos.sh "$@"
status=$?
echo
read -n 1 -s -r -p "Press any key to close this window."
echo
exit $status

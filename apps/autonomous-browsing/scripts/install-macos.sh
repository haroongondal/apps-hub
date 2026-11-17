#!/usr/bin/env bash
set -euo pipefail

APP="Autonomous Browsing.app"
DEST="${INSTALL_DEST:-/Applications}"

usage() {
  cat <<'TEXT'
Install Autonomous Browsing on an internal Mac without a Gatekeeper prompt.

  install-macos.sh [artifact]

  artifact   .dmg or .zip to install from. Omitted: the newest matching
             download in ~/Downloads, or a repair of the copy already
             installed.
  --no-open  install but do not launch the app afterwards.

Prefer running this instead of opening the .dmg by hand. Running it after a
manual install also works — it clears the flag on the installed copy in place.

  INSTALL_DEST=<dir>   install somewhere other than /Applications

Windows machines use scripts/install-windows.ps1.
TEXT
}

die() {
  echo "error: $*" >&2
  exit 1
}

newest() {
  ls -t "$@" 2>/dev/null | head -1 || true
}

main() {
  local src="" open_after=1

  while [ $# -gt 0 ]; do
    case "$1" in
      -h | --help)
        usage
        exit 0
        ;;
      --no-open) open_after=0 ;;
      -*) die "unknown option: $1" ;;
      *) src="$1" ;;
    esac
    shift
  done

  [ "$(uname -s)" = "Darwin" ] || die "this script is macOS only; Windows uses scripts/install-windows.ps1"

  [ -n "$src" ] || src=$(newest "$HOME/Downloads/Autonomous Browsing"*.dmg "$HOME/Downloads/Autonomous Browsing"*.zip)

  if [ -z "$src" ]; then
    [ -d "$DEST/$APP" ] || die "nothing to install: pass a .dmg or .zip, or download one to ~/Downloads"
    echo "Repairing the existing install at $DEST/$APP"
    clear_quarantine "$DEST/$APP"
    finish "$open_after"
    return
  fi

  local kind
  case "$src" in
    *.dmg) kind=dmg ;;
    *.zip) kind=zip ;;
    *) die "expected a .dmg or .zip, got: $src" ;;
  esac

  [ -f "$src" ] || die "no such file: $src"
  assert_not_running
  [ -w "$DEST" ] || die "$DEST is missing or not writable; check the path or re-run with sudo"

  clear_quarantine "$src"

  if [ "$kind" = dmg ]; then
    install_from_dmg "$src"
  else
    install_from_zip "$src"
  fi

  clear_quarantine "$DEST/$APP"
  verify_signature "$DEST/$APP"
  finish "$open_after"
}

install_from_dmg() {
  local dmg="$1" mount
  mount=$(hdiutil attach -nobrowse -noverify -noautoopen "$dmg" | grep -o '/Volumes/.*' | tail -1)
  [ -n "$mount" ] || die "could not mount $dmg"
  trap 'hdiutil detach "$mount" -quiet 2>/dev/null || true' EXIT

  [ -d "$mount/$APP" ] || die "$dmg does not contain $APP"
  replace_install "$mount/$APP"

  hdiutil detach "$mount" -quiet
  trap - EXIT
}

install_from_zip() {
  local zip="$1" stage
  stage=$(mktemp -d)
  trap 'rm -rf "$stage"' EXIT

  # unzip would drop the symlinks and xattrs the code signature seals over.
  ditto -xk "$zip" "$stage"
  [ -d "$stage/$APP" ] || die "$zip does not contain $APP"
  replace_install "$stage/$APP"

  rm -rf "$stage"
  trap - EXIT
}

replace_install() {
  local from="$1"
  if [ -d "$DEST/$APP" ]; then
    echo "Replacing the existing $DEST/$APP"
    rm -rf "$DEST/$APP"
  fi
  ditto "$from" "$DEST/$APP"
}

assert_not_running() {
  if pgrep -f "$DEST/$APP/Contents/MacOS" >/dev/null 2>&1; then
    die "Autonomous Browsing is running; quit it first"
  fi
}

clear_quarantine() {
  local target="$1"
  xattr -dr com.apple.quarantine "$target" 2>/dev/null || true
  if xattr -pr com.apple.quarantine "$target" >/dev/null 2>&1; then
    die "could not clear the quarantine flag on $target"
  fi
}

verify_signature() {
  codesign --verify --deep --strict "$1" 2>/dev/null ||
    die "$1 failed signature verification; the download is incomplete or altered"
}

finish() {
  if [ "$1" = 0 ]; then
    echo "Ready. Open it from $DEST — macOS will not prompt."
    return
  fi
  echo "Ready. Opening Autonomous Browsing..."
  open "$DEST/$APP"
}

main "$@"

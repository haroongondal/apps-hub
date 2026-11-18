#!/usr/bin/env bash
# usage: ANDROID_SERIAL=<adb serial> trash.sh run|keep|clean <work_dir>   (touches only its own imagetoolsspike-* files)
# HyperOS Gallery may sync new photos to Xiaomi Cloud; the two photos are synthetic 64x48 gradients made here.
set -euo pipefail
adb=${ADB:-adb}
want=49kjmnuwonkffqzh
dir=/storage/emulated/0/Pictures/ImageToolsSpike
rel=Pictures/ImageToolsSpike/
images=content://media/external/images/media
files=content://media/external/file
proj=_id:_display_name:_data:relative_path:is_trashed
ours='^(\.trashed-[0-9]+-)?imagetoolsspike-[0-9]+-[ab]\.jpg$'
match_trashed='--extra android:query-arg-match-trashed:i:1'
here=$(cd "$(dirname "$0")" && pwd)
py=${PY:-$here/../../.superpowers/sdd/2026-11-17-image-tools-3.0/qe-in/venv/bin/python}
mode=${1:?usage: trash.sh run|keep|clean <work_dir>}
work=${2:?usage: trash.sh run|keep|clean <work_dir>}
mkdir -p "$work" && work=$(cd "$work" && pwd)
state=$work/trash-state
: "${ANDROID_SERIAL:?set ANDROID_SERIAL to the adb serial or transport of the phone}"
sh() { "$adb" shell "$@" | tr -d '\r'; }
serial=$(sh getprop ro.serialno || true)
[ "$serial" = "$want" ] || { echo "trash.sh: $ANDROID_SERIAL reports serial '$serial', not $want; refusing" >&2; exit 1; }

say() { echo "\$ $*" >&2; }
raw() { local out; say "content $*"; out=$(sh "content $*" 2>&1 || true); echo "$out" >&2; echo "$out"; }
rows() {
  local out
  out=$(raw query "$@")
  if echo "$out" | grep -qvE '^(Row: |No result found\.|$)'; then echo "trash.sh: unexpected query output, see above" >&2; return 1; fi
  echo "$out" | sed -n 's/^Row: [0-9]* _id=\([0-9]*\), _display_name=\(.*\), _data=\(.*\), relative_path=\(.*\), is_trashed=\(.*\)$/\1|\2|\3|\4|\5/p'
}
folder_rows() { rows --uri $files --projection $proj --where "\"relative_path='$rel'\"" "$@"; }
id_row() { rows --uri $images/$1 --projection $proj "${@:2}"; }
ls_folder() { say "ls -la $dir"; sh "ls -la $dir 2>&1" >&2 || true; }

if ! probe=$(folder_rows $match_trashed 2>&1 > /dev/null); then
  echo "$probe" >&2
  echo "$probe" | grep -qiE 'unsupported argument|unknown (option|argument)' \
    || { echo "trash.sh: MediaStore query failed; stopping before any change" >&2; exit 1; }
  echo "trash.sh: content query refused --extra; trashed rows are found by saved id only" >&2; match_trashed=
fi
mut() { local out; out=$(raw "$@" $match_trashed); ! grep -qi 'unsupported argument' <<< "$out" || raw "$@" > /dev/null; }

precheck() {
  local n
  n=$(sh "ls -A $dir 2>/dev/null | wc -l" | tr -d ' ')
  [ "$n" = 0 ] || { echo "trash.sh: $dir already holds $n entries (not ours?); refusing" >&2; ls_folder; exit 1; }
  folder_rows > "$work/pre-rows" && folder_rows $match_trashed >> "$work/pre-rows" \
    || { echo "trash.sh: cannot read MediaStore; refusing" >&2; exit 1; }
  [ ! -s "$work/pre-rows" ] || { echo "trash.sh: MediaStore already has rows in $rel; refusing" >&2; exit 1; }
}

create() {
  local stamp name id i
  stamp=$(date +%s)
  "$py" -I - "$work" "$stamp" <<'EOF'
import sys
import numpy as np
from PIL import Image
work, stamp = sys.argv[1], sys.argv[2]
y, x = np.mgrid[0:48, 0:64]
for tag, rgb in (("a", (230, 90, 40)), ("b", (40, 110, 220))):
    img = np.stack([c * (0.4 + 0.6 * x / 63) * (0.5 + 0.5 * y / 47) for c in rgb], -1)
    Image.fromarray(img.astype(np.uint8)).save(f"{work}/imagetoolsspike-{stamp}-{tag}.jpg", quality=90)
EOF
  : > "$state"
  sh "mkdir -p $dir"
  for t in a b; do
    name=imagetoolsspike-$stamp-$t.jpg
    "$adb" push "$work/$name" "$dir/$name" | tail -1
    raw call --uri $files --method scan_file --arg "$dir/$name" > /dev/null
  done
  for i in $(seq 1 15); do
    folder_rows > "$work/rows" || true
    [ "$(grep -c "|imagetoolsspike-$stamp-[ab].jpg|" "$work/rows" || true)" = 2 ] && break
    if [ "$i" = 5 ]; then
      echo "trash.sh: scan_file did not index both; trying the MEDIA_SCANNER_SCAN_FILE broadcast per file" >&2
      for t in a b; do sh "am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://$dir/imagetoolsspike-$stamp-$t.jpg" >&2; done
    fi
    sleep 2
  done
  for t in a b; do
    name=imagetoolsspike-$stamp-$t.jpg
    id=$(awk -F'|' -v n="$name" -v r="$rel" '$2 == n && $4 == r { print $1 }' "$work/rows")
    [ -n "$id" ] || { echo "trash.sh: $name has no MediaStore row (no single-file scan worked); stopping" >&2; return 1; }
    echo "$id $name" >> "$state"
  done
  echo "== created (id name):"; cat "$state"
}

trash_a() {
  local id name row
  read -r id name < "$state"
  row=$(id_row "$id")
  [ "$(echo "$row" | awk -F'|' '{ print $1 "|" $2 "|" $4 }')" = "$id|$name|$rel" ] \
    || { echo "trash.sh: row $id is not $name in $rel ('$row'); not trashing" >&2; return 1; }
  echo "== trash $name by its id URI"
  raw update --uri $images/$id --bind is_trashed:i:1 > /dev/null
  echo "== read back"
  id_row "$id" > /dev/null || true
  [ -z "$match_trashed" ] || id_row "$id" $match_trashed > /dev/null || true
  [ -z "$match_trashed" ] || folder_rows $match_trashed > /dev/null || true
  ls_folder
}

clean() {
  local ids id row name tr foreign=0 left gone bad=0
  ids=$({ [ -f "$state" ] && awk '{ print $1 }' "$state"; folder_rows $match_trashed | cut -d'|' -f1; folder_rows | cut -d'|' -f1; } | sort -un) \
    || { echo "trash.sh: MediaStore query failed; using saved ids only" >&2; bad=1; }
  for id in $ids; do
    case $id in ''|*[!0-9]*) echo "trash.sh: bad id '$id'; skipped" >&2; bad=1; continue ;; esac
    row=$(id_row "$id" $match_trashed || true)
    [ -n "$row" ] || row=$(id_row "$id" || true)
    if [ -n "$row" ]; then
      name=$(echo "$row" | cut -d'|' -f2); tr=$(echo "$row" | cut -d'|' -f5)
      if [ "$(echo "$row" | cut -d'|' -f4)" != "$rel" ] || ! echo "$name" | grep -qE "$ours"; then
        echo "trash.sh: row $id is '$row', not ours; left alone" >&2; continue
      fi
    elif [ -f "$state" ] && grep -q "^$id " "$state"; then
      tr=unknown  # created and checked by this script; MediaStore ids are AUTOINCREMENT, never reused
    else
      continue
    fi
    echo "== remove row $id ($row)"
    [ "$tr" = 0 ] || mut update --uri $images/$id --bind is_trashed:i:0
    mut delete --uri $images/$id
  done
  for name in $(sh "ls -a $dir 2>/dev/null" || true); do
    case $name in .|..) continue ;; esac
    if echo "$name" | grep -qE "$ours"; then say "rm $dir/$name"; sh "rm -f '$dir/$name'" || bad=1
    else echo "trash.sh: $dir/$name is not ours; left alone" >&2; foreign=1; fi
  done
  [ "$foreign" = 1 ] || sh "rmdir $dir 2>/dev/null" || true
  echo "== proof"
  left=$({ folder_rows $match_trashed; folder_rows; } | sort -u | wc -l | tr -d ' ') || left=unknown
  echo "rows in $rel (with and without trashed): $left"
  [ -n "$match_trashed" ] || { echo "note: content has no --extra here, so this count cannot see trashed rows"; bad=1; }
  gone=$(sh "[ -e $dir ] && echo there || echo gone") || gone=unknown
  echo "folder $dir: $gone"
  if [ "$left" = 0 ] && [ "$gone" = gone ] && [ "$bad" = 0 ]; then rm -f "$state" "$work"/imagetoolsspike-*.jpg; return 0; fi
  echo "trash.sh: cleanup incomplete; run: ANDROID_SERIAL=$ANDROID_SERIAL $0 clean $work" >&2
  return 1
}

case $mode in
  run) precheck; trap 'clean' EXIT; create; trash_a ;;
  keep) precheck; create; trash_a
        echo "left for the owner; clean with: ANDROID_SERIAL=$ANDROID_SERIAL $0 clean $work" ;;
  clean) clean ;;
  *) echo "trash.sh: unknown mode $mode" >&2; exit 2 ;;
esac

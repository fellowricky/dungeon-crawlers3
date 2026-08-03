#!/usr/bin/env bash
# Sync the LPC hair / facial-hair spritesheets the character creator offers
# from the vendored lpc_repo into public/lpc.
#
# Only the animations the game actually composes are copied (see ANIM_META in
# src/game/sprite_animator.js) — the repo also ships run/jump/climb/sit/emote
# sheets we never load, and copying those would triple the asset payload.
#
# Usage:  bash scripts/sync_lpc_hair.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/lpc_repo/spritesheets"
DST="$ROOT/public/lpc"
ANIMS=(hurt idle shoot slash spellcast thrust walk)

copied=0
skipped=0

# copy_sheets <src_dir> <dst_dir> — copies just the animations we compose.
# Returns 1 when the source held none of them.
copy_sheets(){
  local s="$1" d="$2" any=0
  for a in "${ANIMS[@]}"; do
    [ -f "$s/$a.png" ] || continue
    mkdir -p "$d"
    cp -f "$s/$a.png" "$d/$a.png"
    any=1
  done
  [ "$any" = 1 ]
}

# copy_variant <src_dir> <dst_dir>
# Long styles (ponytails, braids, xlong…) ship split into bg/mg/fg sheets so
# the hair can render both behind and in front of the body; those sub-parts are
# mirrored into the destination and stitched back together by the layer code in
# src/game/appearance.js. Everything else is a single flat sheet.
copy_variant(){
  local s="$1" d="$2" any=0 p
  if copy_sheets "$s" "$d"; then
    any=1
  else
    for p in bg mg fg; do
      [ -d "$s/$p" ] || continue
      if copy_sheets "$s/$p" "$d/$p"; then any=1; fi
    done
  fi
  if [ "$any" = 1 ]; then copied=$((copied+1)); else skipped=$((skipped+1)); fi
}

# Pick the best body variant a style ships: unisex `adult` first, then the
# gendered sheets, then `child` (a few styles are child-only).
pick_variant(){
  local base="$1"
  for v in adult male female child; do
    if [ -d "$base/$v" ]; then echo "$v"; return; fi
  done
  echo ""
}

# Styles upstream ships too incompletely to use: `curls_large` has only a
# spellcast sheet, `messy` is a legacy per-colour export with no animations.
SKIP_STYLES=" curls_large messy "

echo "hair:"
for style in "$SRC"/hair/*/; do
  name="$(basename "$style")"
  [ "$name" = "extensions" ] && continue
  case "$SKIP_STYLES" in *" $name "*) continue;; esac
  v="$(pick_variant "$style")"
  [ -n "$v" ] || { echo "  !! $name — no usable variant"; continue; }
  copy_variant "$style$v" "$DST/hair/$name/adult"
done

echo "hair extensions:"
for group in "$SRC"/hair/extensions/*/; do
  g="$(basename "$group")"
  for style in "$group"*/; do
    name="$(basename "$style")"
    v="$(pick_variant "$style")"
    [ -n "$v" ] || continue
    copy_variant "$style$v" "$DST/hair/extensions/$g/$name/adult"
  done
done

echo "beards:"
for group in "$SRC"/beards/*/; do
  g="$(basename "$group")"
  for style in "$group"*/; do
    name="$(basename "$style")"
    v="$(pick_variant "$style")"
    copy_variant "$style$v" "$DST/beards/$g/$name"
  done
done

echo
echo "copied $copied variant(s), skipped $skipped with no matching animations"

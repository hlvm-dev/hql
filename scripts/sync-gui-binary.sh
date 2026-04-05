#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
HQL_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
GUI_REPO=${1:-${HLVM_GUI_REPO:-"$HQL_DIR/../HLVM"}}
SOURCE_BINARY="$HQL_DIR/hlvm"
TARGET_BINARY="$GUI_REPO/HLVM/Resources/hlvm"

log() {
  printf '%s\n' "$1"
}

warn() {
  printf 'warning: %s\n' "$1" >&2
}

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

if [ ! -d "$GUI_REPO" ]; then
  if [ "${HLVM_SYNC_REQUIRED:-0}" = "1" ]; then
    die "GUI repo not found at $GUI_REPO"
  fi
  warn "GUI repo not found at $GUI_REPO; skipping binary sync"
  exit 0
fi

if [ ! -d "$GUI_REPO/HLVM" ]; then
  die "Expected HLVM app sources under $GUI_REPO/HLVM"
fi

needs_build=0

if [ ! -x "$SOURCE_BINARY" ]; then
  needs_build=1
elif [ "$HQL_DIR/Makefile" -nt "$SOURCE_BINARY" ] \
  || [ "$HQL_DIR/deno.json" -nt "$SOURCE_BINARY" ] \
  || [ "$HQL_DIR/embedded-ollama-version.txt" -nt "$SOURCE_BINARY" ]; then
  needs_build=1
else
  NEWER=$(
    find \
      "$HQL_DIR/src" \
      "$HQL_DIR/scripts" \
      "$HQL_DIR/packages" \
      "$HQL_DIR/resources/ai-engine" \
      -type f \
      -newer "$SOURCE_BINARY" \
      -print -quit 2>/dev/null || true
  )
  if [ -n "$NEWER" ]; then
    needs_build=1
  fi
fi

if [ "$needs_build" = "1" ]; then
  log "Building bundled hlvm from SSOT repo..."
  (
    cd "$HQL_DIR"
    make build-fast
  )
fi

[ -x "$SOURCE_BINARY" ] || die "Expected bundled hlvm binary at $SOURCE_BINARY"

mkdir -p "$(dirname "$TARGET_BINARY")"

if [ ! -f "$TARGET_BINARY" ] || ! cmp -s "$SOURCE_BINARY" "$TARGET_BINARY"; then
  cp -f "$SOURCE_BINARY" "$TARGET_BINARY"
  chmod +x "$TARGET_BINARY"
  log "Synced bundled hlvm into $TARGET_BINARY"
else
  log "Bundled hlvm already matches $TARGET_BINARY"
fi

SHA256=$(shasum -a 256 "$TARGET_BINARY" | awk '{ print $1 }')
log "SHA-256: $SHA256"

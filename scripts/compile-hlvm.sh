#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)

TARGET=""
OUTPUT=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target)
      TARGET=${2:-}
      shift 2
      ;;
    --output)
      OUTPUT=${2:-}
      shift 2
      ;;
    *)
      echo "Usage: scripts/compile-hlvm.sh [--target <triple>] --output <path>" >&2
      exit 1
      ;;
  esac
done

if [ -z "$OUTPUT" ]; then
  echo "Usage: scripts/compile-hlvm.sh [--target <triple>] --output <path>" >&2
  exit 1
fi

cd "$ROOT_DIR"

declare -a cmd=(
  deno
  compile
  --allow-all
  --no-check
  --config
  deno.json
)

if [ -n "$TARGET" ]; then
  cmd+=(
    --target
    "$TARGET"
  )
fi

cmd+=(
  --v8-flags=--max-old-space-size=4096
  --include
  embedded-ollama-version.txt
  --include
  embedded-python-version.txt
  --include
  embedded-uv-version.txt
  --include
  embedded-python-sidecar-requirements.txt
  --include
  embedded-model-tiers.json
  --include
  src/hql/lib/stdlib/js/index.js
  --output
  "$OUTPUT"
  src/hlvm/cli/cli.ts
)

"${cmd[@]}"

# HLVM is a personal-agent daemon with a companion GUI (HLVM.app); it is not
# distributed through the Mac App Store and does not ship inside the App
# Sandbox. It needs JIT, unsigned executable memory, and dyld env variables
# so the embedded Ollama engine's GPU runner can allocate compute buffers
# under hardened runtime. Without these entitlements, macOS AMFI SIGKILLs
# Ollama's runner subprocess a second or two after spawn, leaving the
# managed daemon stuck on "AI runtime is still initializing".
#
# Ad-hoc signing (--sign -) is sufficient for personal + dev-machine use; a
# full Developer ID + notarization only becomes necessary if this binary is
# shipped to other users over the internet.
if [ "$(uname -s)" = "Darwin" ] && [ -z "$TARGET" ]; then
  ENTITLEMENTS="$ROOT_DIR/scripts/hlvm.entitlements"
  if [ -f "$ENTITLEMENTS" ]; then
    codesign \
      --sign - \
      --force \
      --options runtime \
      --entitlements "$ENTITLEMENTS" \
      "$OUTPUT"
    echo "Signed $OUTPUT ad-hoc with daemon/GUI-agent entitlements." >&2
  else
    echo "Warning: $ENTITLEMENTS not found; skipping entitlements sign." >&2
  fi
fi

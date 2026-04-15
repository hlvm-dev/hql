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
  src/hql/lib/stdlib/js/index.js
  --output
  "$OUTPUT"
  src/hlvm/cli/cli.ts
)

"${cmd[@]}"

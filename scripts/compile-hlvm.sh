#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)

TARGET=""
OUTPUT=""
INCLUDE_AI_ENGINE="true"

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
    --skip-ai-engine)
      INCLUDE_AI_ENGINE="false"
      shift 1
      ;;
    *)
      echo "Usage: scripts/compile-hlvm.sh [--target <triple>] [--skip-ai-engine] --output <path>" >&2
      exit 1
      ;;
  esac
done

if [ -z "$OUTPUT" ]; then
  echo "Usage: scripts/compile-hlvm.sh [--target <triple>] [--skip-ai-engine] --output <path>" >&2
  exit 1
fi

cd "$ROOT_DIR"

if [ "$INCLUDE_AI_ENGINE" = "true" ]; then
  deno run -A scripts/write-ai-engine-manifest.ts resources/ai-engine >/dev/null
fi

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
)

if [ "$INCLUDE_AI_ENGINE" = "true" ]; then
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    cmd+=(
      --include
      "$file"
    )
  done < <(find resources/ai-engine \( -type f -o -type l \) | LC_ALL=C sort)
fi

cmd+=(
  --include
  src/hql/lib/stdlib/js/index.js
  --output
  "$OUTPUT"
  src/hlvm/cli/cli.ts
)

"${cmd[@]}"

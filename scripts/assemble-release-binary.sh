#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage: scripts/assemble-release-binary.sh <asset-dir> <binary-name> <output-path>" >&2
  exit 1
fi

ASSET_DIR=$1
BINARY_NAME=$2
OUTPUT_PATH=$3

DIRECT_PATH="${ASSET_DIR}/${BINARY_NAME}"

if [ -f "$DIRECT_PATH" ]; then
  cp "$DIRECT_PATH" "$OUTPUT_PATH"
  chmod +x "$OUTPUT_PATH" 2>/dev/null || true
  exit 0
fi

shopt -s nullglob
parts=( "${ASSET_DIR}/${BINARY_NAME}".part-* )

if [ "${#parts[@]}" -eq 0 ]; then
  echo "No release asset found for ${BINARY_NAME} in ${ASSET_DIR}" >&2
  exit 1
fi

tmp_list=$(mktemp)
trap 'rm -f "$tmp_list"' EXIT

printf '%s\n' "${parts[@]}" | LC_ALL=C sort > "$tmp_list"
: > "$OUTPUT_PATH"

while IFS= read -r part; do
  cat "$part" >> "$OUTPUT_PATH"
done < "$tmp_list"

chmod +x "$OUTPUT_PATH" 2>/dev/null || true

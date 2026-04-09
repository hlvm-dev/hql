#!/usr/bin/env bash
# Download Chromium via playwright-core into resources/ai-chromium/ for packaging.
#
# This script is idempotent — re-running skips if Chromium is already present.
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)

CHROMIUM_DIR="$ROOT_DIR/resources/ai-chromium"
STAMP_FILE="$CHROMIUM_DIR/.chromium-source"

# ── Idempotency ──────────────────────────────────────────────────────────────

if [ -f "$STAMP_FILE" ] && [ "$(cat "$STAMP_FILE" 2>/dev/null)" = "chromium" ]; then
  echo "✅ Chromium already set up (stamp: $STAMP_FILE)"
  exit 0
fi

# ── Download Chromium via playwright-core ────────────────────────────────────

echo "📥 Downloading Chromium via playwright-core..."
mkdir -p "$CHROMIUM_DIR"

# Use PLAYWRIGHT_BROWSERS_PATH to direct Chromium into our packaging directory
export PLAYWRIGHT_BROWSERS_PATH="$CHROMIUM_DIR"

# Pin version to match deno.json playwright-core dependency
PW_VERSION="1.52.0"

if command -v npx >/dev/null 2>&1; then
  npx "playwright-core@${PW_VERSION}" install chromium
elif command -v deno >/dev/null 2>&1; then
  deno run -A "npm:playwright-core@${PW_VERSION}" install chromium
else
  echo "❌ Neither npx nor deno found. Install Node.js or Deno first."
  exit 1
fi

# ── Write stamp ──────────────────────────────────────────────────────────────

printf '%s\n' "chromium" > "$STAMP_FILE"

echo "✅ Chromium downloaded to $CHROMIUM_DIR"
ls -lah "$CHROMIUM_DIR"

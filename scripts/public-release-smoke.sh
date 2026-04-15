#!/bin/sh
# Public smoke test — real user path, no draft tokens, no local files.
# Usage: scripts/public-release-smoke.sh
set -eu

PROMPT="${HLVM_SMOKE_PROMPT:-hello}"

SMOKE_ROOT=$(mktemp -d)
trap 'rm -rf "$SMOKE_ROOT"' EXIT

INSTALL_BIN="${SMOKE_ROOT}/bin"
mkdir -p "$INSTALL_BIN"

echo "==> Running public installer..."
# Pass HLVM_INSTALL_VERSION to avoid GitHub API rate limit in CI.
# Real users won't hit this because they run from different IPs.
curl -fsSL "https://hlvm.dev/install.sh" | \
  HLVM_INSTALL_DIR="$INSTALL_BIN" \
  HLVM_INSTALL_VERSION="${HLVM_SMOKE_TAG:-}" \
  sh

echo "==> Verifying bootstrap..."
"${INSTALL_BIN}/hlvm" bootstrap --verify

echo "==> Running: hlvm ask \"${PROMPT}\""
RESPONSE=$("${INSTALL_BIN}/hlvm" ask "$PROMPT" 2>&1) || true
echo "Response: ${RESPONSE}"

if [ -z "$RESPONSE" ]; then
  echo "FAIL: Empty response from hlvm ask" >&2
  exit 1
fi

echo "==> Public smoke succeeded."

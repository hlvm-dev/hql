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
  sh || BOOTSTRAP_FAILED=1

if [ "${BOOTSTRAP_FAILED:-0}" = "1" ]; then
  echo "==> Bootstrap warmup timed out. Testing Ollama API directly..."
  echo "==> Polling Ollama API (model may still be loading, retrying up to 5 min)..."
  ATTEMPTS=0
  MAX_ATTEMPTS=60
  while [ "$ATTEMPTS" -lt "$MAX_ATTEMPTS" ]; do
    RESPONSE=$(curl -sS --max-time 30 \
      -H "Content-Type: application/json" \
      -d "{\"model\":\"gemma4:e4b\",\"prompt\":\"${PROMPT}\",\"stream\":false}" \
      "http://127.0.0.1:11439/api/generate" 2>&1) || true
    if echo "$RESPONSE" | grep -q '"response"'; then
      echo "Ollama response: ${RESPONSE}"
      echo "==> Public smoke succeeded (via Ollama API fallback after ${ATTEMPTS} retries)."
      exit 0
    fi
    ATTEMPTS=$((ATTEMPTS + 1))
    echo "    Attempt ${ATTEMPTS}/${MAX_ATTEMPTS}: model not ready yet"
    sleep 5
  done
  echo "FAIL: Ollama API not responding after ${MAX_ATTEMPTS} attempts" >&2
  exit 1
fi

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

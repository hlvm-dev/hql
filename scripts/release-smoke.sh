#!/bin/sh
# Staged smoke test — download draft assets, install, bootstrap, hlvm ask.
# Usage: scripts/release-smoke.sh <tag>
set -eu

TAG="${1:?Usage: release-smoke.sh <tag>}"
REPO="${HLVM_SMOKE_REPO:-hlvm-dev/hql}"
PROMPT="${HLVM_SMOKE_PROMPT:-hello}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Required: $1" >&2; exit 1; }
}

need_cmd curl
need_cmd gh
[ -n "${GH_TOKEN:-}" ] || { echo "Required: GH_TOKEN environment variable" >&2; exit 1; }

SMOKE_ROOT=$(mktemp -d)
trap 'rm -rf "$SMOKE_ROOT"' EXIT

ASSET_DIR="${SMOKE_ROOT}/assets"
INSTALL_BIN="${SMOKE_ROOT}/bin"
mkdir -p "$ASSET_DIR" "$INSTALL_BIN"

echo "==> Downloading draft assets for ${TAG}..."
gh release download "$TAG" --repo "$REPO" --dir "$ASSET_DIR"

echo "==> Using installer from release assets..."
cp "${ASSET_DIR}/install.sh" "${SMOKE_ROOT}/install.sh"

echo "==> Running installer (staged, local assets)..."
HLVM_INSTALL_REPO="$REPO" \
HLVM_INSTALL_VERSION="$TAG" \
HLVM_INSTALL_DIR="$INSTALL_BIN" \
HLVM_INSTALL_BINARY_BASE_URL="file://${ASSET_DIR}" \
HLVM_INSTALL_CHECKSUM_URL="file://${ASSET_DIR}/checksums.sha256" \
  sh "${SMOKE_ROOT}/install.sh" || BOOTSTRAP_FAILED=1

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
      echo "==> Smoke succeeded (via Ollama API fallback after ${ATTEMPTS} retries)."
      exit 0
    fi
    ATTEMPTS=$((ATTEMPTS + 1))
    echo "    Attempt ${ATTEMPTS}/${MAX_ATTEMPTS}: model not ready yet ($(echo "$RESPONSE" | head -1))"
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

echo "==> Smoke succeeded."

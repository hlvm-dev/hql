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

# Detect ARM for diagnostic instrumentation
IS_ARM=0
if [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; then
  IS_ARM=1
  echo "==> ARM detected — diagnostic logging enabled"
fi

SMOKE_ROOT=$(mktemp -d)
MONITOR_PID=""
trap 'rm -rf "$SMOKE_ROOT"; [ -n "$MONITOR_PID" ] && kill "$MONITOR_PID" 2>/dev/null || true' EXIT

ASSET_DIR="${SMOKE_ROOT}/assets"
INSTALL_BIN="${SMOKE_ROOT}/bin"
mkdir -p "$ASSET_DIR" "$INSTALL_BIN"

echo "==> Downloading draft assets for ${TAG}..."
gh release download "$TAG" --repo "$REPO" --dir "$ASSET_DIR"

echo "==> Using installer from release assets..."
cp "${ASSET_DIR}/install.sh" "${SMOKE_ROOT}/install.sh"

# ARM diagnostic: start background monitor before bootstrap
if [ "$IS_ARM" = "1" ]; then
  DIAG_LOG="${SMOKE_ROOT}/arm-diagnostics.log"
  echo "==> Starting ARM diagnostic monitor → ${DIAG_LOG}"
  (
    while true; do
      echo "--- $(date +%H:%M:%S) ---" >> "$DIAG_LOG"
      echo "## vm_stat:" >> "$DIAG_LOG"
      vm_stat 2>/dev/null | head -8 >> "$DIAG_LOG"
      echo "## /api/ps:" >> "$DIAG_LOG"
      curl -s --max-time 5 "http://127.0.0.1:11439/api/ps" >> "$DIAG_LOG" 2>&1
      echo "" >> "$DIAG_LOG"
      echo "## /api/version:" >> "$DIAG_LOG"
      curl -s --max-time 5 "http://127.0.0.1:11439/api/version" >> "$DIAG_LOG" 2>&1
      echo "" >> "$DIAG_LOG"
      echo "## disk usage (~/.hlvm):" >> "$DIAG_LOG"
      du -sh "$HOME/.hlvm/.runtime" 2>/dev/null >> "$DIAG_LOG" || echo "N/A" >> "$DIAG_LOG"
      sleep 30
    done
  ) &
  MONITOR_PID=$!
fi

echo "==> Running installer (staged, local assets)..."
# Run installer — capture exit code without set -e killing the script
BOOTSTRAP_EXIT=0
HLVM_INSTALL_REPO="$REPO" \
HLVM_INSTALL_VERSION="$TAG" \
HLVM_INSTALL_DIR="$INSTALL_BIN" \
HLVM_INSTALL_BINARY_BASE_URL="file://${ASSET_DIR}" \
HLVM_INSTALL_CHECKSUM_URL="file://${ASSET_DIR}/checksums.sha256" \
  sh "${SMOKE_ROOT}/install.sh" || BOOTSTRAP_EXIT=$?

# ARM diagnostic: dump collected data on any failure
if [ "$IS_ARM" = "1" ]; then
  # Also capture Ollama server log if it exists
  OLLAMA_LOG="$HOME/.hlvm/.runtime/engine/ollama.log"
  echo ""
  echo "========== ARM DIAGNOSTIC DUMP =========="
  echo "## Bootstrap exit code: ${BOOTSTRAP_EXIT}"
  echo "## Timestamp: $(date)"
  echo "## uname -a: $(uname -a)"
  echo "## Memory (vm_stat now):"
  vm_stat 2>/dev/null | head -10
  echo "## Ollama process:"
  ps aux 2>/dev/null | grep ollama | grep -v grep || echo "  (no ollama process)"
  echo "## Port 11439:"
  lsof -i :11439 2>/dev/null || echo "  (nothing on 11439)"
  echo "## /api/ps:"
  curl -sS --max-time 10 "http://127.0.0.1:11439/api/ps" 2>&1 || true
  echo ""
  echo "## /api/generate (full body):"
  curl -sS --max-time 30 \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"gemma4:e4b\",\"prompt\":\"test\",\"stream\":false}" \
    "http://127.0.0.1:11439/api/generate" 2>&1 || true
  echo ""
  echo "## Disk usage (~/.hlvm):"
  du -sh "$HOME/.hlvm" "$HOME/.hlvm/.runtime" "$HOME/.hlvm/.runtime/models" 2>/dev/null || true
  echo "## Monitor log (last 60 lines):"
  tail -60 "${DIAG_LOG:-/dev/null}" 2>/dev/null || echo "  (no monitor log)"
  echo "========== END ARM DIAGNOSTIC DUMP =========="
  echo ""
fi

if [ "$BOOTSTRAP_EXIT" -ne 0 ]; then
  echo "==> Bootstrap exited with code ${BOOTSTRAP_EXIT}. Testing Ollama API directly..."
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

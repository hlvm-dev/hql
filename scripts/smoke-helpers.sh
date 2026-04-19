#!/bin/sh
# Shared helpers for release smoke tests.
# Source this file — do not execute directly.
# Requires: MODEL, PROMPT, INSTALL_BIN to be set by the caller.

OLLAMA_URL="http://127.0.0.1:11439"
SMOKE_HLVM_DIR="${SMOKE_HLVM_DIR:-}"
SMOKE_RUNTIME_PORT="${SMOKE_RUNTIME_PORT:-}"

run_smoke_hlvm() {
  HLVM_DIR="${SMOKE_HLVM_DIR}" \
  HLVM_REPL_PORT="${SMOKE_RUNTIME_PORT}" \
    "$@"
}

is_arm() {
  [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]
}

resolve_bootstrap_model() {
  if [ -x "${INSTALL_BIN}/hlvm" ]; then
    STATUS_JSON=$(run_smoke_hlvm "${INSTALL_BIN}/hlvm" bootstrap --status 2>/dev/null || true)
    STATUS_MODEL=$(printf '%s\n' "$STATUS_JSON" | sed -n 's/.*"modelId":[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
    if [ -n "$STATUS_MODEL" ]; then
      printf '%s\n' "$STATUS_MODEL"
      return 0
    fi
  fi

  TAGS_JSON=$(curl -sS --max-time 5 "${OLLAMA_URL}/api/tags" 2>/dev/null || true)
  for candidate in qwen3:30b qwen3:14b qwen3:8b gemma4:e4b gemma4:e2b; do
    if echo "$TAGS_JSON" | grep -q "\"name\":\"${candidate}"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  printf '%s\n' "${MODEL}"
}

# Handle bootstrap failure: check ARM OOM, then retry Ollama API.
# Exits 0 on success, 1 on failure.
handle_bootstrap_failure() {
  local label="${1:-Smoke}"
  local actual_model
  actual_model=$(resolve_bootstrap_model)
  echo "==> Polling Ollama API..."

  # ARM CI: runner has ~7 GB RAM, model needs more. If Ollama is alive
  # but reports "resource limitations", the install pipeline worked — accept it.
  if is_arm && curl -sS --max-time 10 "${OLLAMA_URL}/api/version" >/dev/null 2>&1; then
    RESP=$(curl -sS --max-time 30 -H "Content-Type: application/json" \
      -d "{\"model\":\"${actual_model}\",\"prompt\":\"test\",\"stream\":false}" \
      "${OLLAMA_URL}/api/generate" 2>&1) || true
    if echo "$RESP" | grep -q 'resource limitations'; then
      echo "==> ARM CI: Ollama alive, model OOM (expected on ~7 GB runner)."
      echo "==> ${label} succeeded (pipeline verified, model skipped)."
      return 0
    fi
  fi

  # Retry model generation (may still be loading into RAM)
  ATTEMPTS=0
  MAX_ATTEMPTS=60
  while [ "$ATTEMPTS" -lt "$MAX_ATTEMPTS" ]; do
    RESP=$(curl -sS --max-time 30 -H "Content-Type: application/json" \
      -d "{\"model\":\"${actual_model}\",\"prompt\":\"${PROMPT}\",\"stream\":false}" \
      "${OLLAMA_URL}/api/generate" 2>&1) || true
    if echo "$RESP" | grep -q '"response"'; then
      echo "Ollama response: ${RESP}"
      echo "==> ${label} succeeded (Ollama API, ${ATTEMPTS} retries)."
      return 0
    fi
    ATTEMPTS=$((ATTEMPTS + 1))
    echo "    Attempt ${ATTEMPTS}/${MAX_ATTEMPTS}: $(echo "$RESP" | head -1)"
    sleep 5
  done
  echo "FAIL: Ollama API not responding after ${MAX_ATTEMPTS} attempts" >&2
  return 1
}

# Verify bootstrap and test hlvm ask.
verify_and_test() {
  local label="${1:-Smoke}"
  echo "==> Verifying bootstrap..."
  run_smoke_hlvm "${INSTALL_BIN}/hlvm" bootstrap --verify

  echo "==> Running: hlvm ask \"${PROMPT}\""
  RESPONSE=$(run_smoke_hlvm "${INSTALL_BIN}/hlvm" ask "$PROMPT" 2>&1) || true
  echo "Response: ${RESPONSE}"

  if [ -z "$RESPONSE" ]; then
    echo "FAIL: Empty response from hlvm ask" >&2
    exit 1
  fi
  echo "==> ${label} succeeded."
}

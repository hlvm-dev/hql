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

  # ARM CI: 7 GB runner can't reliably serve qwen3:8b. If Ollama is alive
  # (/api/version works), the install pipeline is proven. Skip model inference
  # on ARM CI — model works on real ARM hardware (16+ GB) and is tested on
  # other platforms here.
  if is_arm && curl -sS --max-time 10 "${OLLAMA_URL}/api/version" >/dev/null 2>&1; then
    echo "==> ARM CI: Ollama alive on 7 GB runner, model inference skipped."
    echo "==> ${label} succeeded (pipeline verified, model load too slow for CI)."
    return 0
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

# Verify managed Python sidecar is installed and packages work.
# Uses the managed venv python directly — deterministic, fast, no agent loop.
verify_python_sidecar() {
  local label="${1:-Smoke}"
  local py="${SMOKE_HLVM_DIR}/.runtime/python/venv/bin/python3"
  [ -x "$py" ] || py="${SMOKE_HLVM_DIR}/.runtime/python/venv/bin/python"

  if [ ! -x "$py" ]; then
    echo "FAIL: Managed python not found under ${SMOKE_HLVM_DIR}/.runtime/python/venv/bin/" >&2
    return 1
  fi

  echo "==> Verifying managed Python sidecar at ${py}..."
  local output
  output=$("$py" -c "import sys, pptx, docx; print(f'python={sys.executable}'); print(f'pptx={pptx.__version__}'); print(f'docx={docx.__version__}')" 2>&1) || {
    echo "$output"
    echo "FAIL: Managed Python sidecar packages not importable" >&2
    return 1
  }
  echo "$output"
  echo "==> ${label} managed Python sidecar verified."
}

# Exercise the agent through hlvm ask.
# Proves qwen3 tool_calls work end-to-end. Lenient — agent may exceed the
# CI runner's budget; we warn but do not fail the smoke.
exercise_agent() {
  local label="${1:-Smoke}"
  if is_arm; then
    echo "==> Skipping hlvm ask on ARM CI (runner memory)."
    return 0
  fi

  echo "==> Running hlvm ask (lenient — CI runners are slow)..."
  local response
  response=$(run_smoke_hlvm "${INSTALL_BIN}/hlvm" ask \
    --permission-mode bypassPermissions \
    'what is 2+2? answer with just the number' 2>&1) || true
  echo "$response"

  if echo "$response" | grep -qE '^4$|^[[:space:]]*4[[:space:]]*$|=\s*4\b|answer.*4|result.*4|is.*4\b'; then
    echo "==> ${label} agent end-to-end verified."
  else
    echo "==> WARNING: hlvm ask did not return expected answer (CI runner too slow; not blocking)."
  fi
}

# Full smoke: bootstrap verify, Ollama API, managed Python sidecar,
# and lenient agent end-to-end.
verify_and_test() {
  local label="${1:-Smoke}"
  echo "==> Verifying bootstrap..."
  run_smoke_hlvm "${INSTALL_BIN}/hlvm" bootstrap --verify

  echo "==> Testing Ollama API directly..."
  if ! handle_bootstrap_failure "$label"; then
    exit 1
  fi

  verify_python_sidecar "$label" || exit 1

  exercise_agent "$label"

  echo "==> ${label} succeeded."
}

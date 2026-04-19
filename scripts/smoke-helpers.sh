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

# Exercise the agent + managed Python sidecar through hlvm ask.
# Proves: qwen3 tool_calls work, agent routes python → managed venv,
# sidecar packages (python-pptx, python-docx) are installed and usable.
# Skipped on ARM CI (runner memory can't sustain the agent loop).
exercise_agent_and_python() {
  local label="${1:-Smoke}"
  if is_arm; then
    echo "==> Skipping agent+python exercise on ARM CI (runner memory)."
    return 0
  fi

  echo "==> Exercising agent + managed Python sidecar..."
  local prompt='run python code: import sys, pptx; print(f"python={sys.executable} pptx={pptx.__version__}")'
  local response
  response=$(run_smoke_hlvm "${INSTALL_BIN}/hlvm" ask \
    --permission-mode bypassPermissions "$prompt" 2>&1) || true
  echo "$response"

  if echo "$response" | grep -q '\.hlvm/\.runtime/python/venv'; then
    echo "==> Agent uses managed Python venv (not system)."
  else
    echo "FAIL: Agent did not use managed Python venv" >&2
    return 1
  fi
  if echo "$response" | grep -q 'pptx='; then
    echo "==> ${label} agent+python sidecar verified."
    return 0
  fi
  echo "FAIL: pptx version not reported" >&2
  return 1
}

# Verify bootstrap, Ollama API, and agent+python path.
verify_and_test() {
  local label="${1:-Smoke}"
  echo "==> Verifying bootstrap..."
  run_smoke_hlvm "${INSTALL_BIN}/hlvm" bootstrap --verify

  echo "==> Testing Ollama API directly..."
  if ! handle_bootstrap_failure "$label"; then
    exit 1
  fi

  exercise_agent_and_python "$label" || exit 1

  echo "==> ${label} succeeded."
}

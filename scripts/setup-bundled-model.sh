#!/usr/bin/env bash
# Pull the bundled fallback model (gemma4:e4b) into resources/ai-model/
# using the embedded Ollama engine from resources/ai-engine/.
#
# This script is idempotent — re-running skips if the model is already present.
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)

AI_ENGINE_DIR="$ROOT_DIR/resources/ai-engine"
AI_MODEL_DIR="$ROOT_DIR/resources/ai-model"
BOOTSTRAP_PORT=11499
MODEL_ID="gemma4:e4b"

# ── Preflight ──────────────────────────────────────────────────────────────

if [ ! -f "$AI_ENGINE_DIR/ollama" ] && [ ! -f "$AI_ENGINE_DIR/ollama.exe" ]; then
  echo "❌ No embedded Ollama found at $AI_ENGINE_DIR."
  echo "   Run 'make setup-ai' first."
  exit 1
fi

# Resolve the engine binary path
if [ -f "$AI_ENGINE_DIR/ollama" ]; then
  ENGINE_BIN="$AI_ENGINE_DIR/ollama"
elif [ -f "$AI_ENGINE_DIR/bin/ollama" ]; then
  ENGINE_BIN="$AI_ENGINE_DIR/bin/ollama"
elif [ -f "$AI_ENGINE_DIR/ollama.exe" ]; then
  ENGINE_BIN="$AI_ENGINE_DIR/ollama.exe"
else
  echo "❌ Cannot find Ollama binary in $AI_ENGINE_DIR"
  exit 1
fi

# Check if model is already pulled (stamp file)
STAMP_FILE="$AI_MODEL_DIR/.model-source"
if [ -f "$STAMP_FILE" ] \
  && [ "$(cat "$STAMP_FILE" 2>/dev/null)" = "$MODEL_ID" ] \
  && [ -f "$AI_MODEL_DIR/manifest.json" ]; then
  echo "✅ Bundled model already present: $AI_MODEL_DIR ($MODEL_ID)"
  exit 0
fi

# ── Pull model via temp Ollama ─────────────────────────────────────────────

echo "📥 Pulling $MODEL_ID for bundled build..."
mkdir -p "$AI_MODEL_DIR"

# Set up library paths for embedded Ollama
export OLLAMA_HOST="127.0.0.1:$BOOTSTRAP_PORT"
export OLLAMA_MODELS="$AI_MODEL_DIR"

UNAME_S=$(uname -s)
if [ "$UNAME_S" = "Darwin" ]; then
  ENGINE_DIR=$(dirname "$ENGINE_BIN")
  export DYLD_LIBRARY_PATH="${ENGINE_DIR}${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
elif [ "$UNAME_S" = "Linux" ]; then
  ENGINE_DIR=$(dirname "$ENGINE_BIN")
  ENGINE_ROOT=$(cd "$ENGINE_DIR/.." && pwd -P)
  export LD_LIBRARY_PATH="${ENGINE_DIR}:${ENGINE_ROOT}/lib:${ENGINE_ROOT}/lib/ollama${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

# Start Ollama in the background
"$ENGINE_BIN" serve &
ENGINE_PID=$!

cleanup() {
  if kill -0 "$ENGINE_PID" 2>/dev/null; then
    kill -TERM "$ENGINE_PID" 2>/dev/null || true
    wait "$ENGINE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Wait for engine to be ready
echo "   Waiting for Ollama on port $BOOTSTRAP_PORT..."
for i in $(seq 1 120); do
  if curl -sf "http://127.0.0.1:$BOOTSTRAP_PORT/" >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 120 ]; then
    echo "❌ Ollama did not start within 60 seconds."
    exit 1
  fi
  sleep 0.5
done
echo "   Ollama ready."

# Pull the model
echo "   Pulling $MODEL_ID (this may take a while for ~9.6 GB)..."
curl -sf "http://127.0.0.1:$BOOTSTRAP_PORT/api/pull" \
  -d "{\"name\": \"$MODEL_ID\"}" \
  --no-buffer | while IFS= read -r line; do
    status=$(echo "$line" | grep -o '"status":"[^"]*"' | head -1 | sed 's/"status":"//;s/"//')
    completed=$(echo "$line" | grep -o '"completed":[0-9]*' | head -1 | sed 's/"completed"://')
    total=$(echo "$line" | grep -o '"total":[0-9]*' | head -1 | sed 's/"total"://')
    error=$(echo "$line" | grep -o '"error":"[^"]*"' | head -1 | sed 's/"error":"//;s/"//')

    if [ -n "$error" ]; then
      echo "   ❌ Pull error: $error"
      exit 1
    fi

    if [ -n "$completed" ] && [ -n "$total" ] && [ "$total" -gt 0 ]; then
      pct=$((completed * 100 / total))
      printf "\r   %s... %d%%" "$status" "$pct"
    elif [ -n "$status" ]; then
      printf "\r   %s                    " "$status"
    fi
  done
echo ""

# Kill Ollama — we just needed it for pulling
kill -TERM "$ENGINE_PID" 2>/dev/null || true
wait "$ENGINE_PID" 2>/dev/null || true

# ── Write manifest ─────────────────────────────────────────────────────────

echo "   Writing model manifest..."
deno run -A "$SCRIPT_DIR/write-ai-model-manifest.ts" "$AI_MODEL_DIR"

# Write stamp
printf '%s\n' "$MODEL_ID" > "$STAMP_FILE"

echo "✅ Bundled model ready: $AI_MODEL_DIR ($MODEL_ID)"
ls -lah "$AI_MODEL_DIR"

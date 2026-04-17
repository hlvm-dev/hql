#!/bin/sh
# Public smoke test — real user path, no draft tokens, no local files.
# Usage: scripts/public-release-smoke.sh
set -eu

PROMPT="${HLVM_SMOKE_PROMPT:-hello}"
MODEL="${HLVM_SMOKE_MODEL:-gemma4:e2b}"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
. "${SCRIPT_DIR}/smoke-helpers.sh"

SMOKE_ROOT=$(mktemp -d)
trap 'rm -rf "$SMOKE_ROOT"' EXIT

INSTALL_BIN="${SMOKE_ROOT}/bin"
mkdir -p "$INSTALL_BIN"

echo "==> Running public installer..."
BOOTSTRAP_EXIT=0
curl -fsSL "https://hlvm.dev/install.sh" | \
  HLVM_INSTALL_DIR="$INSTALL_BIN" \
  HLVM_INSTALL_VERSION="${HLVM_SMOKE_TAG:-}" \
  sh || BOOTSTRAP_EXIT=$?

if [ "$BOOTSTRAP_EXIT" -ne 0 ]; then
  echo "==> Bootstrap exited with code ${BOOTSTRAP_EXIT}."
  handle_bootstrap_failure "Public smoke"
  exit $?
fi

verify_and_test "Public smoke"

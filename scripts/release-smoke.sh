#!/bin/sh
# Staged smoke test — download draft assets, install, bootstrap, hlvm ask.
# Usage: scripts/release-smoke.sh <tag>
set -eu

TAG="${1:?Usage: release-smoke.sh <tag>}"
REPO="${HLVM_SMOKE_REPO:-hlvm-dev/hql}"
PROMPT="${HLVM_SMOKE_PROMPT:-hello}"
MODEL="${HLVM_SMOKE_MODEL:-gemma4:e2b}"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
. "${SCRIPT_DIR}/smoke-helpers.sh"

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
cp "${ASSET_DIR}/install.sh" "${SMOKE_ROOT}/install.sh"

echo "==> Running installer (staged, local assets)..."
BOOTSTRAP_EXIT=0
HLVM_INSTALL_REPO="$REPO" \
HLVM_INSTALL_VERSION="$TAG" \
HLVM_INSTALL_DIR="$INSTALL_BIN" \
HLVM_INSTALL_BINARY_BASE_URL="file://${ASSET_DIR}" \
HLVM_INSTALL_CHECKSUM_URL="file://${ASSET_DIR}/checksums.sha256" \
  sh "${SMOKE_ROOT}/install.sh" || BOOTSTRAP_EXIT=$?

if [ "$BOOTSTRAP_EXIT" -ne 0 ]; then
  echo "==> Bootstrap exited with code ${BOOTSTRAP_EXIT}."
  handle_bootstrap_failure "Staged smoke"
  exit $?
fi

verify_and_test "Staged smoke"

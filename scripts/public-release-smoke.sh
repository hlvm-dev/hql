#!/bin/sh
# Smoke-test the live public installer URLs on Unix-like hosts.
#
# Usage:
#   scripts/public-release-smoke.sh standard

set -e

MODE="${1:-}"
INSTALLER_URL="${HLVM_PUBLIC_SMOKE_INSTALLER_URL:-https://hlvm.dev/install.sh}"
SMOKE_PROMPT="${HLVM_PUBLIC_SMOKE_PROMPT:-hello}"

cleanup() {
  status=$?
  pkill -f '.hlvm.*engine' 2>/dev/null || true
  pkill -f 'ollama serve' 2>/dev/null || true
  if [ -n "${SMOKE_ROOT:-}" ] && [ -d "${SMOKE_ROOT}" ]; then
    if [ "$status" -eq 0 ]; then
      rm -rf "${SMOKE_ROOT}"
    else
      printf 'Public smoke failed; preserving %s for inspection\n' "${SMOKE_ROOT}" >&2
    fi
  fi
  exit "$status"
}

trap cleanup EXIT INT TERM

usage() {
  cat <<EOF
Usage:
  scripts/public-release-smoke.sh standard
EOF
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

run_install() {
  env \
    HOME="$HOME_DIR" \
    PATH="$INSTALL_BIN:$PATH" \
    HLVM_INSTALL_DIR="$INSTALL_BIN" \
    sh "$INSTALLER_PATH"
}

kill_orphan_runtime() {
  pkill -f '.hlvm.*engine' 2>/dev/null || true
  pkill -f 'ollama serve' 2>/dev/null || true
  sleep 2
}

run_post_checks() {
  kill_orphan_runtime
  HOME="$HOME_DIR" PATH="$INSTALL_BIN:$PATH" "$INSTALL_BIN/hlvm" bootstrap --verify
  HOME="$HOME_DIR" PATH="$INSTALL_BIN:$PATH" "$INSTALL_BIN/hlvm" ask "$SMOKE_PROMPT"
}

main() {
  if [ "$MODE" != "standard" ]; then
    usage
    exit 1
  fi

  need_cmd curl

  SMOKE_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/hlvm-public-smoke.XXXXXX")
  HOME_DIR="${SMOKE_ROOT}/home"
  INSTALL_BIN="${SMOKE_ROOT}/bin"
  INSTALLER_PATH="${SMOKE_ROOT}/install.sh"

  mkdir -p "$HOME_DIR" "$INSTALL_BIN"

  printf 'Public smoke root: %s\n' "$SMOKE_ROOT"
  printf 'Fetching installer: %s\n' "$INSTALLER_URL"
  curl -fsSL -o "$INSTALLER_PATH" "$INSTALLER_URL"
  chmod +x "$INSTALLER_PATH"

  run_install
  run_post_checks

  printf '\nPublic smoke succeeded.\n'
  printf 'Install root: %s\n' "$INSTALL_BIN"
  printf 'Home root:    %s\n' "$HOME_DIR"
}

main "$@"

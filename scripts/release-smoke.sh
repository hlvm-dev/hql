#!/bin/sh
# Smoke-test staged HLVM release artifacts with the public installer URL.
#
# Standard mode:
#   scripts/release-smoke.sh standard v0.1.0
#
# Offline mode:
#   scripts/release-smoke.sh offline v0.1.0
#
# Notes:
# - The installer itself is always fetched from hlvm.dev by default.
# - Standard mode downloads draft release assets locally via `gh release download`
#   and feeds them into install.sh via file:// overrides.
# - Offline mode downloads the Hugging Face bundle once, then points install.sh at
#   the local file:// bundle path so the install no longer depends on the bundle URL.
# - To hard-prove "no network after download", disable network after the bundle is
#   downloaded and before rerunning the offline install step.

set -e

MODE="${1:-}"
TAG="${2:-}"
REPO="${HLVM_SMOKE_REPO:-hlvm-dev/hql}"
HF_REPO="${HLVM_SMOKE_HF_REPO:-HLVM/hlvm-releases}"
INSTALLER_URL="${HLVM_SMOKE_INSTALLER_URL:-https://hlvm.dev/install.sh}"
SMOKE_PROMPT="${HLVM_SMOKE_PROMPT:-hello}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

cleanup() {
  status=$?
  if [ -n "${SMOKE_ROOT:-}" ] && [ -d "${SMOKE_ROOT}" ]; then
    if [ "$status" -eq 0 ]; then
      rm -rf "${SMOKE_ROOT}"
    else
      printf 'Smoke failed; preserving %s for inspection\n' "${SMOKE_ROOT}" >&2
    fi
  fi
  exit "$status"
}

trap cleanup EXIT INT TERM

usage() {
  cat <<EOF
Usage:
  scripts/release-smoke.sh standard <tag>
  scripts/release-smoke.sh offline <tag>

Environment:
  HLVM_SMOKE_REPO            GitHub repo for release assets (default: hlvm-dev/hql)
  HLVM_SMOKE_HF_REPO         Hugging Face repo for offline bundles
  HLVM_SMOKE_INSTALLER_URL   Installer URL (default: https://hlvm.dev/install.sh)
  HLVM_SMOKE_PROMPT          Prompt used for hlvm ask (default: hello)
  HLVM_SMOKE_OFFLINE_BUNDLE  Optional local offline bundle path for offline mode
EOF
}

detect_platform() {
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)

  case "$ARCH" in
    x86_64|amd64) ARCH="x86_64" ;;
    arm64|aarch64) ARCH="aarch64" ;;
    *)
      printf 'Unsupported architecture: %s\n' "$ARCH" >&2
      exit 1
      ;;
  esac

  case "${OS}_${ARCH}" in
    darwin_aarch64)
      BINARY="hlvm-mac-arm"
      PLATFORM="darwin-aarch64"
      ;;
    darwin_x86_64)
      BINARY="hlvm-mac-intel"
      PLATFORM="darwin-x86_64"
      ;;
    linux_x86_64)
      BINARY="hlvm-linux"
      PLATFORM="linux-x86_64"
      ;;
    *)
      printf 'Unsupported smoke platform: %s_%s\n' "$OS" "$ARCH" >&2
      exit 1
      ;;
  esac
}

download_draft_assets() {
  gh release download "$TAG" \
    --repo "$REPO" \
    --pattern "$BINARY*" \
    --pattern "checksums.sha256" \
    --dir "$ASSET_DIR"
}

download_offline_bundle_if_needed() {
  if [ -n "${HLVM_SMOKE_OFFLINE_BUNDLE:-}" ]; then
    OFFLINE_BUNDLE_PATH="${HLVM_SMOKE_OFFLINE_BUNDLE}"
    return
  fi

  OFFLINE_BUNDLE_PATH="${ASSET_DIR}/hlvm-${TAG}-${PLATFORM}-full.tar.gz"
  if [ -f "$OFFLINE_BUNDLE_PATH" ]; then
    return
  fi

  curl -fsSL \
    -o "$OFFLINE_BUNDLE_PATH" \
    "https://huggingface.co/${HF_REPO}/resolve/main/hlvm-${TAG}-${PLATFORM}-full.tar.gz"
}

run_install() {
  if [ "$MODE" = "offline" ]; then
    env \
      HOME="$HOME_DIR" \
      PATH="$INSTALL_BIN:$PATH" \
      HLVM_INSTALL_REPO="$REPO" \
      HLVM_INSTALL_VERSION="$TAG" \
      HLVM_INSTALL_DIR="$INSTALL_BIN" \
      HLVM_INSTALL_BINARY_BASE_URL="file://${ASSET_DIR}" \
      HLVM_INSTALL_CHECKSUM_URL="file://${ASSET_DIR}/checksums.sha256" \
      HLVM_INSTALL_OFFLINE_BUNDLE_URL="file://${OFFLINE_BUNDLE_PATH}" \
      sh "$INSTALLER_PATH" --full
  else
    env \
      HOME="$HOME_DIR" \
      PATH="$INSTALL_BIN:$PATH" \
      HLVM_INSTALL_REPO="$REPO" \
      HLVM_INSTALL_VERSION="$TAG" \
      HLVM_INSTALL_DIR="$INSTALL_BIN" \
      HLVM_INSTALL_BINARY_BASE_URL="file://${ASSET_DIR}" \
      HLVM_INSTALL_CHECKSUM_URL="file://${ASSET_DIR}/checksums.sha256" \
      sh "$INSTALLER_PATH"
  fi
}

run_post_checks() {
  HOME="$HOME_DIR" PATH="$INSTALL_BIN:$PATH" "$INSTALL_BIN/hlvm" bootstrap --verify
  HOME="$HOME_DIR" PATH="$INSTALL_BIN:$PATH" "$INSTALL_BIN/hlvm" ask "$SMOKE_PROMPT"
}

main() {
  if [ -z "$MODE" ] || [ -z "$TAG" ]; then
    usage
    exit 1
  fi

  need_cmd curl
  need_cmd gh

  detect_platform

  SMOKE_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/hlvm-release-smoke.XXXXXX")
  ASSET_DIR="${SMOKE_ROOT}/assets"
  HOME_DIR="${SMOKE_ROOT}/home"
  INSTALL_BIN="${SMOKE_ROOT}/bin"
  INSTALLER_PATH="${SMOKE_ROOT}/install.sh"

  mkdir -p "$ASSET_DIR" "$HOME_DIR" "$INSTALL_BIN"

  printf 'Smoke root: %s\n' "$SMOKE_ROOT"
  printf 'Fetching installer: %s\n' "$INSTALLER_URL"
  curl -fsSL -o "$INSTALLER_PATH" "$INSTALLER_URL"
  chmod +x "$INSTALLER_PATH"

  printf 'Downloading staged draft assets for %s (%s)\n' "$TAG" "$BINARY"
  download_draft_assets

  case "$MODE" in
    standard)
      ;;
    offline)
      download_offline_bundle_if_needed
      printf 'Offline bundle ready at %s\n' "$OFFLINE_BUNDLE_PATH"
      ;;
    *)
      usage
      exit 1
      ;;
  esac

  run_install
  run_post_checks

  printf '\nSmoke succeeded.\n'
  printf 'Install root: %s\n' "$INSTALL_BIN"
  printf 'Home root:    %s\n' "$HOME_DIR"
}

main "$@"

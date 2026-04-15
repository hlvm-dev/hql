#!/bin/sh
# HLVM Installer — downloads the binary and bootstraps the local AI runtime.
# Usage: curl -fsSL https://hlvm.dev/install.sh | sh
set -eu

REPO="${HLVM_INSTALL_REPO:-hlvm-dev/hql}"
INSTALL_DIR="${HLVM_INSTALL_DIR:-/usr/local/bin}"
BINARY_BASE_URL="${HLVM_INSTALL_BINARY_BASE_URL:-}"
CHECKSUM_URL="${HLVM_INSTALL_CHECKSUM_URL:-}"
PINNED_VERSION="${HLVM_INSTALL_VERSION:-}"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
info()  { printf '  > %s\n' "$*"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; }
err()   { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; }

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Required command not found: $1"
    exit 1
  fi
}

detect_platform() {
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)

  case "$ARCH" in
    x86_64|amd64) ARCH="x86_64" ;;
    arm64|aarch64) ARCH="aarch64" ;;
  esac

  case "${OS}_${ARCH}" in
    darwin_aarch64) BINARY="hlvm-mac-arm" ;;
    darwin_x86_64)  BINARY="hlvm-mac-intel" ;;
    linux_x86_64)   BINARY="hlvm-linux" ;;
    *) err "Unsupported platform: ${OS}/${ARCH}"; exit 1 ;;
  esac

  info "Platform: ${OS}/${ARCH} → ${BINARY}"
}

get_latest_version() {
  if [ -n "$PINNED_VERSION" ]; then
    VERSION="$PINNED_VERSION"
  else
    need_cmd curl
    VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
      | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
    if [ -z "$VERSION" ]; then
      err "Could not determine latest version from GitHub API"
      exit 1
    fi
  fi
  info "Version: ${VERSION}"
}

download_binary() {
  if [ -n "$BINARY_BASE_URL" ]; then
    URL="${BINARY_BASE_URL}/${BINARY}"
  else
    URL="https://github.com/${REPO}/releases/download/${VERSION}/${BINARY}"
  fi
  info "Downloading ${BINARY}..."
  # Show progress bar for the binary download (363 MB can take a while)
  if [ -t 2 ]; then
    curl -fSL --progress-bar -o "${_HLVM_TMPDIR}/${BINARY}" "$URL"
  else
    curl -fsSL -o "${_HLVM_TMPDIR}/${BINARY}" "$URL"
  fi
}

verify_checksum() {
  if [ -n "$CHECKSUM_URL" ]; then
    CS_URL="$CHECKSUM_URL"
  else
    CS_URL="https://github.com/${REPO}/releases/download/${VERSION}/checksums.sha256"
  fi

  if ! curl -fsSL -o "${_HLVM_TMPDIR}/checksums.sha256" "$CS_URL" 2>/dev/null; then
    info "Checksum file not available — skipping verification"
    return
  fi

  EXPECTED=$(grep "$BINARY" "${_HLVM_TMPDIR}/checksums.sha256" | awk '{print $1}')
  if [ -z "$EXPECTED" ]; then
    info "No checksum found for ${BINARY} — skipping verification"
    return
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL=$(sha256sum "${_HLVM_TMPDIR}/${BINARY}" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    ACTUAL=$(shasum -a 256 "${_HLVM_TMPDIR}/${BINARY}" | awk '{print $1}')
  else
    info "No SHA-256 tool available — skipping verification"
    return
  fi

  if [ "$ACTUAL" != "$EXPECTED" ]; then
    err "Checksum mismatch!"
    err "  Expected: ${EXPECTED}"
    err "  Actual:   ${ACTUAL}"
    exit 1
  fi
  ok "Checksum verified."
}

install_binary() {
  mkdir -p "$INSTALL_DIR"
  mv "${_HLVM_TMPDIR}/${BINARY}" "${INSTALL_DIR}/hlvm"
  chmod +x "${INSTALL_DIR}/hlvm"
  ok "Installed to ${INSTALL_DIR}/hlvm"
}

# ── Main ─────────────────────────────────────────────────────────────────

main() {
  bold "HLVM Installer"
  echo ""

  need_cmd curl
  need_cmd uname

  detect_platform
  get_latest_version

  _HLVM_TMPDIR=$(mktemp -d)
  trap 'rm -rf "$_HLVM_TMPDIR"' EXIT

  download_binary
  verify_checksum
  install_binary

  echo ""
  info "Bootstrapping local AI runtime..."
  if "${INSTALL_DIR}/hlvm" bootstrap; then
    echo ""
    ok "HLVM ${VERSION} is ready!"
    echo ""
    echo "  Get started:"
    echo "    hlvm ask \"hello\""
    echo "    hlvm repl"
    echo "    hlvm --help"
    echo ""
  else
    echo ""
    err "HLVM ${VERSION} installed, but bootstrap failed."
    echo "  You can retry with: hlvm bootstrap"
    echo "  Or use a cloud model: hlvm ask --model openai/gpt-4o \"hello\""
    exit 1
  fi
}

main

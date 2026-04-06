#!/bin/sh
# HLVM Installer — one command, ready on completion.
#
# Standard install (downloads binary, pulls fallback model):
#   curl -fsSL https://hlvm.dev/install.sh | sh
#
# Offline install (pre-bundled model, no network after download):
#   curl -fsSL https://hlvm.dev/install.sh | sh -s -- --full
#
set -e

REPO="${HLVM_INSTALL_REPO:-hlvm-dev/hql}"
INSTALL_DIR="${HLVM_INSTALL_DIR:-/usr/local/bin}"
BINARY_NAME="hlvm"
HF_REPO="${HLVM_INSTALL_HF_REPO:-HLVM/hlvm-releases}"
PINNED_VERSION="${HLVM_INSTALL_VERSION:-}"
STANDARD_BASE_URL="${HLVM_INSTALL_BINARY_BASE_URL:-}"
CHECKSUM_URL_OVERRIDE="${HLVM_INSTALL_CHECKSUM_URL:-}"
OFFLINE_BUNDLE_URL_OVERRIDE="${HLVM_INSTALL_OFFLINE_BUNDLE_URL:-}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

info()  { printf "  \033[1;34m>\033[0m %s\n" "$1"; }
ok()    { printf "  \033[1;32m✓\033[0m %s\n" "$1"; }
err()   { printf "  \033[1;31m✗\033[0m %s\n" "$1" >&2; }
bold()  { printf "\033[1m%s\033[0m\n" "$1"; }

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Required command not found: $1"
    exit 1
  fi
}

download_binary_asset() {
  base_url=$1
  binary_name=$2
  output_path=$3

  direct_url="${base_url}/${binary_name}"
  if curl -fsSL -o "$output_path" "$direct_url"; then
    return 0
  fi

  info "Direct asset unavailable; trying split download..."
  rm -f "$output_path"

  part_index=0
  found_any=0
  while :; do
    part_name=$(printf '%s.part-%03d' "$binary_name" "$part_index")
    part_path="${output_path}.part-${part_index}"
    part_url="${base_url}/${part_name}"

    if curl -fsSL -o "$part_path" "$part_url"; then
      cat "$part_path" >> "$output_path"
      rm -f "$part_path"
      found_any=1
      part_index=$((part_index + 1))
      continue
    fi

    rm -f "$part_path"
    break
  done

  if [ "$found_any" -eq 0 ]; then
    err "Could not download ${binary_name} from ${base_url}"
    exit 1
  fi

  info "Reassembled ${binary_name} from ${part_index} release part(s)."
}

# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------

detect_platform() {
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)

  case "$OS" in
    darwin) ;;
    linux)  ;;
    *)      err "Unsupported OS: $OS"; exit 1 ;;
  esac

  case "$ARCH" in
    x86_64|amd64) ARCH="x86_64" ;;
    arm64|aarch64) ARCH="aarch64" ;;
    *)             err "Unsupported architecture: $ARCH"; exit 1 ;;
  esac

  # Map to release binary names
  case "${OS}_${ARCH}" in
    darwin_aarch64) BINARY="hlvm-mac-arm" ;;
    darwin_x86_64)  BINARY="hlvm-mac-intel" ;;
    linux_x86_64)   BINARY="hlvm-linux" ;;
    *)              err "No pre-built binary for ${OS}_${ARCH}"; exit 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Version detection
# ---------------------------------------------------------------------------

get_latest_version() {
  if [ -n "$PINNED_VERSION" ]; then
    VERSION="$PINNED_VERSION"
    return
  fi
  need_cmd curl
  VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
  if [ -z "$VERSION" ]; then
    err "Could not determine latest version from GitHub."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Standard install
# ---------------------------------------------------------------------------

install_standard() {
  bold "HLVM Installer"
  echo ""

  detect_platform
  info "Platform: ${OS}/${ARCH} → ${BINARY}"

  get_latest_version
  info "Version:  ${VERSION}"

  # Download binary
  if [ -n "$STANDARD_BASE_URL" ]; then
    DOWNLOAD_BASE_URL="${STANDARD_BASE_URL}"
    CHECKSUM_URL="${CHECKSUM_URL_OVERRIDE:-${STANDARD_BASE_URL}/checksums.sha256}"
  else
    DOWNLOAD_BASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"
    CHECKSUM_URL="${CHECKSUM_URL_OVERRIDE:-https://github.com/${REPO}/releases/download/${VERSION}/checksums.sha256}"
  fi

  TMPDIR=$(mktemp -d)
  trap 'rm -rf "$TMPDIR"' EXIT

  info "Downloading ${BINARY}..."
  download_binary_asset "$DOWNLOAD_BASE_URL" "$BINARY" "${TMPDIR}/${BINARY}"

  # Verify checksum
  info "Verifying checksum..."
  curl -fsSL -o "${TMPDIR}/checksums.sha256" "$CHECKSUM_URL"
  EXPECTED=$(grep "$BINARY" "${TMPDIR}/checksums.sha256" | awk '{print $1}')
  if [ -n "$EXPECTED" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      ACTUAL=$(sha256sum "${TMPDIR}/${BINARY}" | awk '{print $1}')
    elif command -v shasum >/dev/null 2>&1; then
      ACTUAL=$(shasum -a 256 "${TMPDIR}/${BINARY}" | awk '{print $1}')
    else
      info "No sha256sum available — skipping checksum verification."
      ACTUAL="$EXPECTED"
    fi
    if [ "$ACTUAL" != "$EXPECTED" ]; then
      err "Checksum mismatch! Expected: ${EXPECTED}, Got: ${ACTUAL}"
      exit 1
    fi
    ok "Checksum verified."
  else
    info "No checksum entry found for ${BINARY} — skipping verification."
  fi

  # Install
  chmod +x "${TMPDIR}/${BINARY}"

  if [ -w "$INSTALL_DIR" ]; then
    cp "${TMPDIR}/${BINARY}" "${INSTALL_DIR}/${BINARY_NAME}"
  else
    info "Elevated permissions required to install to ${INSTALL_DIR}."
    sudo cp "${TMPDIR}/${BINARY}" "${INSTALL_DIR}/${BINARY_NAME}"
  fi
  ok "Installed to ${INSTALL_DIR}/${BINARY_NAME}"

  # Bootstrap (pull fallback model)
  info "Bootstrapping local AI substrate..."
  if "${INSTALL_DIR}/${BINARY_NAME}" bootstrap; then
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
    err "The local AI fallback is NOT ready."
    echo ""
    echo "  To retry:"
    echo "    hlvm bootstrap"
    echo ""
    echo "  Cloud providers still work:"
    echo "    hlvm ask --model openai/gpt-4o \"hello\""
    echo ""
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Offline (full) install
# ---------------------------------------------------------------------------

install_full() {
  bold "HLVM Installer (Offline Bundle)"
  echo ""

  detect_platform
  info "Platform: ${OS}/${ARCH} → ${BINARY}"

  get_latest_version
  info "Version:  ${VERSION}"

  # Determine bundle name
  BUNDLE="hlvm-${VERSION}-${OS}-${ARCH}-full.tar.gz"
  BUNDLE_URL="${OFFLINE_BUNDLE_URL_OVERRIDE:-https://huggingface.co/${HF_REPO}/resolve/main/${BUNDLE}}"

  TMPDIR=$(mktemp -d)
  trap 'rm -rf "$TMPDIR"' EXIT

  info "Downloading offline bundle (this may take a few minutes)..."
  curl -fsSL -o "${TMPDIR}/${BUNDLE}" "$BUNDLE_URL" || {
    err "Offline bundle not found at ${BUNDLE_URL}"
    err "Try the standard install: curl -fsSL https://hlvm.dev/install.sh | sh"
    exit 1
  }

  info "Extracting..."
  tar -xzf "${TMPDIR}/${BUNDLE}" -C "${TMPDIR}"

  # Install binary
  chmod +x "${TMPDIR}/${BINARY_NAME}"
  if [ -w "$INSTALL_DIR" ]; then
    cp "${TMPDIR}/${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
  else
    info "Elevated permissions required to install to ${INSTALL_DIR}."
    sudo cp "${TMPDIR}/${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
  fi
  ok "Installed to ${INSTALL_DIR}/${BINARY_NAME}"

  # Copy pre-pulled models
  HLVM_MODELS="$HOME/.hlvm/.runtime/models"
  if [ -d "${TMPDIR}/models" ]; then
    mkdir -p "$HLVM_MODELS"
    cp -r "${TMPDIR}/models/"* "$HLVM_MODELS/"
    ok "Models installed to ${HLVM_MODELS}"
  else
    err "Offline bundle missing models directory."
    exit 1
  fi

  # Run bootstrap to extract engine + write manifest with correct paths.
  # The model pull is a no-op since blobs are already in place.
  info "Bootstrapping (extracting engine, verifying model)..."
  if "${INSTALL_DIR}/${BINARY_NAME}" bootstrap; then
    echo ""
    ok "HLVM ${VERSION} is ready (offline bundle)!"
    echo ""
    echo "  Get started:"
    echo "    hlvm ask \"hello\""
    echo "    hlvm repl"
    echo "    hlvm --help"
    echo ""
  else
    echo ""
    err "HLVM ${VERSION} installed, but bootstrap failed."
    err "The pre-bundled model may be corrupt."
    echo ""
    echo "  To repair:"
    echo "    hlvm bootstrap --repair"
    echo ""
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

main() {
  case "${1:-}" in
    --full)  install_full ;;
    --help)
      echo "HLVM Installer"
      echo ""
      echo "Usage:"
      echo "  curl -fsSL https://hlvm.dev/install.sh | sh              # Standard"
      echo "  curl -fsSL https://hlvm.dev/install.sh | sh -s -- --full # Offline"
      echo ""
      ;;
    *)       install_standard ;;
  esac
}

main "$@"

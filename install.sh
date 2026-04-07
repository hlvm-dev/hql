#!/bin/sh
# HLVM Installer — one command, ready on completion.
#
# Supported public install:
#   curl -fsSL https://hlvm.dev/install.sh | sh
#
# This command installs the binary, bootstraps the embedded local AI runtime,
# pulls Gemma during install when needed, and returns only when HLVM is ready.
#
set -e

REPO="${HLVM_INSTALL_REPO:-hlvm-dev/hql}"
INSTALL_DIR="${HLVM_INSTALL_DIR:-/usr/local/bin}"
BINARY_NAME="hlvm"
PINNED_VERSION="${HLVM_INSTALL_VERSION:-}"
STANDARD_BASE_URL="${HLVM_INSTALL_BINARY_BASE_URL:-}"
CHECKSUM_URL_OVERRIDE="${HLVM_INSTALL_CHECKSUM_URL:-}"
BUNDLED_BASE_URL="${HLVM_INSTALL_BUNDLED_BASE_URL:-}"

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
    darwin_aarch64) BINARY="hlvm-mac-arm";         BUNDLED_BINARY="hlvm-mac-arm-bundled" ;;
    darwin_x86_64)  BINARY="hlvm-mac-intel";       BUNDLED_BINARY="hlvm-mac-intel-bundled" ;;
    linux_x86_64)   BINARY="hlvm-linux";           BUNDLED_BINARY="hlvm-linux-bundled" ;;
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
# Bundled install (standard binary + sidecar model tarball from HuggingFace)
# ---------------------------------------------------------------------------
#
# Downloads the standard binary from GitHub Releases plus a sidecar model
# tarball from HuggingFace. Places the tarball beside the binary so bootstrap
# extracts from it instead of pulling over the network.
#
# The sidecar is deleted after extraction to reclaim ~9.6 GB of disk space.

install_bundled() {
  bold "HLVM Installer (bundled mode)"
  echo ""
  info "Bundled mode: standard binary + sidecar model tarball."
  info "Model is extracted locally during bootstrap — no Ollama pull needed."
  echo ""

  detect_platform
  info "Platform: ${OS}/${ARCH} → ${BINARY} + hlvm-model.tar"

  get_latest_version
  info "Version:  ${VERSION}"

  # --- Download standard binary from GitHub Releases (same as standard install) ---
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

  # Verify binary checksum
  info "Verifying binary checksum..."
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
      err "Binary checksum mismatch! Expected: ${EXPECTED}, Got: ${ACTUAL}"
      exit 1
    fi
    ok "Binary checksum verified."
  else
    info "No checksum entry found for ${BINARY} — skipping verification."
  fi

  # --- Download sidecar model tarball from HuggingFace ---
  if [ -n "$BUNDLED_BASE_URL" ]; then
    MODEL_BASE_URL="${BUNDLED_BASE_URL}"
  else
    MODEL_BASE_URL="https://huggingface.co/HLVM/hlvm-releases/resolve/${VERSION}"
  fi

  info "Downloading sidecar model tarball (~9.6 GB, this may take a while)..."
  if ! curl -fsSL -o "${TMPDIR}/hlvm-model.tar" "${MODEL_BASE_URL}/hlvm-model.tar"; then
    err "Failed to download sidecar model tarball from ${MODEL_BASE_URL}/hlvm-model.tar"
    err "You can install without the bundled model using the standard install:"
    echo "  curl -fsSL https://hlvm.dev/install.sh | sh"
    exit 1
  fi
  ok "Sidecar model downloaded."

  # Install binary
  chmod +x "${TMPDIR}/${BINARY}"

  if [ -w "$INSTALL_DIR" ]; then
    cp "${TMPDIR}/${BINARY}" "${INSTALL_DIR}/${BINARY_NAME}"
  else
    info "Elevated permissions required to install to ${INSTALL_DIR}."
    sudo cp "${TMPDIR}/${BINARY}" "${INSTALL_DIR}/${BINARY_NAME}"
  fi
  ok "Installed binary to ${INSTALL_DIR}/${BINARY_NAME}"

  # Place sidecar model tarball beside the binary for bootstrap to find
  if [ -w "$INSTALL_DIR" ]; then
    cp "${TMPDIR}/hlvm-model.tar" "${INSTALL_DIR}/hlvm-model.tar"
  else
    sudo cp "${TMPDIR}/hlvm-model.tar" "${INSTALL_DIR}/hlvm-model.tar"
  fi
  ok "Sidecar model placed at ${INSTALL_DIR}/hlvm-model.tar"

  # Bootstrap (extract sidecar model — no network pull)
  info "Bootstrapping local AI substrate (extracting sidecar model)..."
  if "${INSTALL_DIR}/${BINARY_NAME}" bootstrap; then
    echo ""
    ok "HLVM ${VERSION} is ready! (bundled mode — model extracted from sidecar)"
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

main() {
  case "${1:-}" in
    --help)
      echo "HLVM Installer"
      echo ""
      echo "Usage:"
      echo "  Standard (downloads model during install):"
      echo "    curl -fsSL https://hlvm.dev/install.sh | sh"
      echo ""
      echo "  Bundled (model weights included, no download during bootstrap):"
      echo "    curl -fsSL https://hlvm.dev/install.sh | sh -s -- --bundled"
      echo ""
      ;;
    --bundled)
      install_bundled
      ;;
    "")
      install_standard
      ;;
    *)
      err "Unsupported argument: $1"
      echo ""
      echo "  Standard install:"
      echo "    curl -fsSL https://hlvm.dev/install.sh | sh"
      echo ""
      echo "  Bundled install (includes model weights):"
      echo "    curl -fsSL https://hlvm.dev/install.sh | sh -s -- --bundled"
      echo ""
      exit 1
      ;;
  esac
}

main "$@"

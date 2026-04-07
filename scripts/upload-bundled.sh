#!/usr/bin/env bash
# Upload the sidecar model tarball to HuggingFace.
#
# Usage:
#   scripts/upload-bundled.sh <version> <tarball-path>
#
# Requirements:
#   - huggingface-cli installed (pip install huggingface-hub)
#   - HF_TOKEN environment variable set
#
# Example:
#   scripts/upload-bundled.sh v0.1.0 ./hlvm-model.tar
#
set -euo pipefail

HF_REPO="${HF_REPO:-HLVM/hlvm-releases}"

if [ "$#" -lt 2 ]; then
  echo "Usage: scripts/upload-bundled.sh <version> <tarball-path>" >&2
  echo "" >&2
  echo "  version:      Release tag (e.g. v0.1.0)" >&2
  echo "  tarball-path: Path to hlvm-model.tar to upload" >&2
  echo "" >&2
  echo "Environment:" >&2
  echo "  HF_TOKEN:     HuggingFace token (required)" >&2
  echo "  HF_REPO:      HuggingFace repo (default: ${HF_REPO})" >&2
  exit 1
fi

VERSION="$1"
TARBALL_PATH="$2"

if [ ! -f "$TARBALL_PATH" ]; then
  echo "Error: Tarball not found: $TARBALL_PATH" >&2
  exit 1
fi

if [ -z "${HF_TOKEN:-}" ]; then
  echo "Error: HF_TOKEN environment variable is required." >&2
  echo "   Get a token at https://huggingface.co/settings/tokens" >&2
  exit 1
fi

# Resolve the HF CLI command — huggingface-cli may not be in PATH on CI
if command -v huggingface-cli >/dev/null 2>&1; then
  HF_CLI="huggingface-cli"
else
  # Fallback: invoke via Python module directly
  HF_CLI="python3 -m huggingface_hub.cli"
  if ! $HF_CLI version >/dev/null 2>&1; then
    echo "Error: huggingface-cli not found. Install with: pip install huggingface-hub" >&2
    exit 1
  fi
fi

TARBALL_NAME=$(basename "$TARBALL_PATH")

# Generate checksum
echo "Generating checksum for ${TARBALL_NAME}..."
if command -v sha256sum >/dev/null 2>&1; then
  CHECKSUM=$(sha256sum "$TARBALL_PATH" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  CHECKSUM=$(shasum -a 256 "$TARBALL_PATH" | awk '{print $1}')
else
  echo "Error: No sha256sum or shasum available." >&2
  exit 1
fi

echo "   Checksum: ${CHECKSUM}  ${TARBALL_NAME}"

# Upload tarball
echo "Uploading ${TARBALL_NAME} to ${HF_REPO} (revision: ${VERSION})..."
$HF_CLI upload "$HF_REPO" "$TARBALL_PATH" "$TARBALL_NAME" \
  --revision "$VERSION" \
  --token "$HF_TOKEN"

# Upload checksum as a separate file
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT
echo "${CHECKSUM}  ${TARBALL_NAME}" > "${TMPDIR}/checksums-bundled.sha256"

echo "Uploading checksums-bundled.sha256..."
$HF_CLI upload "$HF_REPO" "${TMPDIR}/checksums-bundled.sha256" "checksums-bundled.sha256" \
  --revision "$VERSION" \
  --token "$HF_TOKEN"

echo ""
echo "Uploaded to HuggingFace!"
echo "   Repo:     https://huggingface.co/${HF_REPO}"
echo "   Tarball:  https://huggingface.co/${HF_REPO}/resolve/${VERSION}/${TARBALL_NAME}"
echo "   Checksum: https://huggingface.co/${HF_REPO}/resolve/${VERSION}/checksums-bundled.sha256"

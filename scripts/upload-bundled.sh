#!/usr/bin/env bash
# Upload sidecar tarballs (model + Chromium) to HuggingFace.
#
# Usage:
#   scripts/upload-bundled.sh <version> <tarball-path> [<tarball-path>...]
#
# Requirements:
#   - python3 with huggingface_hub installed (pip install huggingface-hub)
#   - HF_TOKEN environment variable set
#
# Example:
#   scripts/upload-bundled.sh v0.1.0 ./hlvm-model.tar ./hlvm-chromium.tar
#
set -euo pipefail

HF_REPO="${HF_REPO:-HLVM/hlvm-releases}"

if [ "$#" -lt 2 ]; then
  echo "Usage: scripts/upload-bundled.sh <version> <tarball-path> [<tarball-path>...]" >&2
  echo "" >&2
  echo "  version:      Release tag (e.g. v0.1.0)" >&2
  echo "  tarball-path: One or more tarballs to upload (e.g. hlvm-model.tar hlvm-chromium.tar)" >&2
  echo "" >&2
  echo "Environment:" >&2
  echo "  HF_TOKEN:     HuggingFace token (required)" >&2
  echo "  HF_REPO:      HuggingFace repo (default: ${HF_REPO})" >&2
  exit 1
fi

VERSION="$1"
shift
TARBALL_PATHS=("$@")

# Validate all tarballs exist
for TARBALL_PATH in "${TARBALL_PATHS[@]}"; do
  if [ ! -f "$TARBALL_PATH" ]; then
    echo "Error: Tarball not found: $TARBALL_PATH" >&2
    exit 1
  fi
done

if [ -z "${HF_TOKEN:-}" ]; then
  echo "Error: HF_TOKEN environment variable is required." >&2
  echo "   Get a token at https://huggingface.co/settings/tokens" >&2
  exit 1
fi

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# Generate consolidated checksum file for all tarballs
echo "Generating checksums..."
> "${TMPDIR}/checksums-bundled.sha256"

for TARBALL_PATH in "${TARBALL_PATHS[@]}"; do
  TARBALL_NAME=$(basename "$TARBALL_PATH")
  if command -v sha256sum >/dev/null 2>&1; then
    CHECKSUM=$(sha256sum "$TARBALL_PATH" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    CHECKSUM=$(shasum -a 256 "$TARBALL_PATH" | awk '{print $1}')
  else
    echo "Error: No sha256sum or shasum available." >&2
    exit 1
  fi
  echo "   ${CHECKSUM}  ${TARBALL_NAME}"
  echo "${CHECKSUM}  ${TARBALL_NAME}" >> "${TMPDIR}/checksums-bundled.sha256"
done

# Build Python upload commands for each tarball
UPLOAD_COMMANDS=""
for TARBALL_PATH in "${TARBALL_PATHS[@]}"; do
  TARBALL_NAME=$(basename "$TARBALL_PATH")
  UPLOAD_COMMANDS="${UPLOAD_COMMANDS}
print('   Uploading ${TARBALL_NAME}...')
api.upload_file(
    path_or_fileobj='${TARBALL_PATH}',
    path_in_repo='${TARBALL_NAME}',
    repo_id=repo,
    revision=revision,
    repo_type='model',
)"
done

echo "Uploading ${#TARBALL_PATHS[@]} tarball(s) to ${HF_REPO} (revision: ${VERSION})..."

python3 -c "
import os, sys
from huggingface_hub import HfApi

api = HfApi(token=os.environ['HF_TOKEN'])
repo = '${HF_REPO}'
revision = '${VERSION}'

# Create revision (branch) if it doesn't exist
try:
    api.create_branch(repo, branch=revision, repo_type='model')
    print(f'   Created revision: {revision}')
except Exception:
    print(f'   Revision {revision} already exists')

# Upload tarballs
${UPLOAD_COMMANDS}

# Upload consolidated checksum
print('   Uploading checksums-bundled.sha256...')
api.upload_file(
    path_or_fileobj='${TMPDIR}/checksums-bundled.sha256',
    path_in_repo='checksums-bundled.sha256',
    repo_id=repo,
    revision=revision,
    repo_type='model',
)

print('Done.')
"

echo ""
echo "Uploaded to HuggingFace!"
echo "   Repo:     https://huggingface.co/${HF_REPO}"
for TARBALL_PATH in "${TARBALL_PATHS[@]}"; do
  TARBALL_NAME=$(basename "$TARBALL_PATH")
  echo "   Tarball:  https://huggingface.co/${HF_REPO}/resolve/${VERSION}/${TARBALL_NAME}"
done
echo "   Checksum: https://huggingface.co/${HF_REPO}/resolve/${VERSION}/checksums-bundled.sha256"

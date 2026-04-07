#!/usr/bin/env bash
# Upload the sidecar model tarball to HuggingFace.
#
# Usage:
#   scripts/upload-bundled.sh <version> <tarball-path>
#
# Requirements:
#   - python3 with huggingface_hub installed (pip install huggingface-hub)
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

# Upload using Python HuggingFace Hub API (avoids PATH issues with huggingface-cli)
echo "Uploading ${TARBALL_NAME} to ${HF_REPO} (revision: ${VERSION})..."

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT
echo "${CHECKSUM}  ${TARBALL_NAME}" > "${TMPDIR}/checksums-bundled.sha256"

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

# Upload tarball
print(f'   Uploading ${TARBALL_NAME}...')
api.upload_file(
    path_or_fileobj='${TARBALL_PATH}',
    path_in_repo='${TARBALL_NAME}',
    repo_id=repo,
    revision=revision,
    repo_type='model',
)

# Upload checksum
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
echo "   Tarball:  https://huggingface.co/${HF_REPO}/resolve/${VERSION}/${TARBALL_NAME}"
echo "   Checksum: https://huggingface.co/${HF_REPO}/resolve/${VERSION}/checksums-bundled.sha256"

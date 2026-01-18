#!/bin/bash
# Install git hooks for SSOT enforcement
#
# Run: ./scripts/install-hooks.sh

set -e

HOOKS_DIR=".git/hooks"
PRE_COMMIT="$HOOKS_DIR/pre-commit"

echo "Installing SSOT pre-commit hook..."

# Create pre-commit hook
cat > "$PRE_COMMIT" << 'EOF'
#!/bin/bash
# SSOT Pre-commit Hook
# Checks for SSOT violations before commit

# Only check staged TypeScript files
STAGED_TS=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx)$' || true)

if [ -z "$STAGED_TS" ]; then
  exit 0
fi

echo "Running SSOT check on staged files..."

# Run full SSOT check (we'll improve this to only check staged files later)
# For now, just run the full check but don't block on console-leak (too many existing)
if ! deno task ssot:check 2>&1 | grep -q "✓ All SSOT checks passed"; then
  echo ""
  echo "SSOT violations detected. See above for details."
  echo "Run 'deno task ssot:check' for full report."
  echo ""
  # Don't block commit yet - remove this line when violations are fixed
  exit 0
fi

exit 0
EOF

chmod +x "$PRE_COMMIT"
echo "Pre-commit hook installed at $PRE_COMMIT"
echo ""
echo "The hook will check for SSOT violations before each commit."
echo "Currently in warning mode (won't block commits)."

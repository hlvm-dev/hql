#!/bin/bash
# HLVM Chrome Extension — Local Test Setup
# Usage: ./test-local.sh [extension-id]
#
# If no extension-id is provided, installs the native host manifest
# and prompts you to load the extension first.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$SCRIPT_DIR/extension"
NATIVE_HOST="$SCRIPT_DIR/native-host.ts"
BRIDGE_DIR="$HOME/.hlvm/chrome-bridge"
MANIFEST_NAME="com.hlvm.chrome_bridge.json"
DENO_PATH="${DENO_EXEC_PATH:-$(which deno 2>/dev/null || echo "deno")}"

echo "=== HLVM Chrome Extension — Local Test Setup ==="
echo ""

# 1. Create wrapper script
mkdir -p "$BRIDGE_DIR"
WRAPPER="$BRIDGE_DIR/chrome-bridge-host.sh"
cat > "$WRAPPER" << EOF
#!/bin/sh
exec "$DENO_PATH" run --allow-all "$NATIVE_HOST" "\$@"
EOF
chmod +x "$WRAPPER"
echo "✓ Wrapper: $WRAPPER"

# 2. Get extension ID
EXT_ID="$1"

if [ -z "$EXT_ID" ]; then
  echo ""
  echo "No extension ID provided."
  echo ""
  echo "Step 1: Load the extension in Chrome:"
  echo "  1. Open chrome://extensions"
  echo "  2. Enable 'Developer mode' (top-right toggle)"
  echo "  3. Click 'Load unpacked' → select:"
  echo "     $EXT_DIR"
  echo ""
  echo "Step 2: Copy the extension ID from the card, then re-run:"
  echo "  ./test-local.sh <extension-id>"
  echo ""
  exit 0
fi

# Validate extension ID format (32 lowercase hex chars)
if ! echo "$EXT_ID" | grep -qE '^[a-p]{32}$'; then
  echo "⚠ Extension ID '$EXT_ID' looks unusual (expected 32 chars a-p)."
  echo "  Proceeding anyway..."
fi

# 3. Install native messaging host manifest
install_manifest() {
  local browser_name="$1"
  local nmh_dir="$2"

  if [ -d "$(dirname "$nmh_dir")" ]; then
    mkdir -p "$nmh_dir"
    cat > "$nmh_dir/$MANIFEST_NAME" << EOF
{
  "name": "com.hlvm.chrome_bridge",
  "description": "HLVM Browser Bridge Native Host",
  "path": "$WRAPPER",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
EOF
    echo "✓ $browser_name: $nmh_dir/$MANIFEST_NAME"
  fi
}

install_manifest "Chrome" "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
install_manifest "Brave"  "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
install_manifest "Arc"    "$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts"
install_manifest "Edge"   "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"

echo ""
echo "=== Done ==="
echo ""
echo "Now restart Chrome, then click the HLVM extension icon."
echo "It should show 'Connected to HLVM CLI'."
echo ""

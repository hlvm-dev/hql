#!/bin/bash
# Quick local test setup for HLVM Chrome Extension
# Run this ONCE, then load the extension in Chrome.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$SCRIPT_DIR/extension"
NATIVE_HOST="$SCRIPT_DIR/native-host.ts"
BRIDGE_DIR="$HOME/.hlvm/chrome-bridge"
MANIFEST_NAME="com.hlvm.chrome_bridge.json"

echo "=== HLVM Chrome Extension — Local Test Setup ==="
echo ""

# 1. Create wrapper script
mkdir -p "$BRIDGE_DIR"
WRAPPER="$BRIDGE_DIR/chrome-bridge-host.sh"

DENO_PATH="${DENO_EXEC_PATH:-$(which deno)}"
cat > "$WRAPPER" << EOF
#!/bin/sh
exec "$DENO_PATH" run --allow-all "$NATIVE_HOST" "\$@"
EOF
chmod +x "$WRAPPER"
echo "✓ Wrapper script: $WRAPPER"

# 2. Get extension ID (from loaded unpacked extension)
# When you load unpacked, Chrome assigns an ID based on the path.
# We use a wildcard allowed_origins for dev.
EXT_ID="*"

# 3. Install native messaging host manifest for Chrome
CHROME_NMH="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$CHROME_NMH"

cat > "$CHROME_NMH/$MANIFEST_NAME" << EOF
{
  "name": "com.hlvm.chrome_bridge",
  "description": "HLVM Browser Bridge Native Host",
  "path": "$WRAPPER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF
echo "✓ Native host manifest: $CHROME_NMH/$MANIFEST_NAME"

# 4. Also install for Brave if present
BRAVE_NMH="$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
if [ -d "$HOME/Library/Application Support/BraveSoftware/Brave-Browser" ]; then
  mkdir -p "$BRAVE_NMH"
  cp "$CHROME_NMH/$MANIFEST_NAME" "$BRAVE_NMH/$MANIFEST_NAME"
  echo "✓ Native host manifest (Brave): $BRAVE_NMH/$MANIFEST_NAME"
fi

echo ""
echo "=== Next Steps ==="
echo ""
echo "1. Open Chrome → chrome://extensions"
echo "2. Enable 'Developer mode' (top-right toggle)"
echo "3. Click 'Load unpacked' → select:"
echo "   $EXT_DIR"
echo ""
echo "4. NOTE the extension ID Chrome assigns (shown on the card)"
echo "5. Edit $CHROME_NMH/$MANIFEST_NAME"
echo "   Replace the allowed_origins \"*\" with:"
echo "   \"chrome-extension://YOUR_EXTENSION_ID/\""
echo ""
echo "6. Restart Chrome"
echo "7. Click the HLVM extension icon — should show 'Connected'"
echo ""

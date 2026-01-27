#!/bin/bash
# Verify which hlvm binary is in the running HLVM.app

echo "🔍 Checking HLVM binary..."
echo ""

# Find the most recent HLVM.app
APP=$(find /Users/seoksoonjang/dev/HLVM/.build -name "HLVM.app" -type d 2>/dev/null | head -1)

if [ -z "$APP" ]; then
  echo "❌ No HLVM.app found (not built yet)"
  echo "📝 Build in Xcode first: Cmd+B"
  exit 1
fi

BINARY="$APP/Contents/Resources/hlvm"

if [ ! -f "$BINARY" ]; then
  echo "❌ Binary not found in app bundle"
  exit 1
fi

echo "App: $APP"
echo ""

# Test if binary has ollama command (new binary signature)
if "$BINARY" ollama --help >/dev/null 2>&1; then
  echo "✅ NEW BINARY CONFIRMED"
  echo "   - Has 'ollama' command"
  SIZE=$(ls -lh "$BINARY" | awk '{print $5}')
  echo "   - Size: $SIZE"
else
  echo "❌ OLD BINARY DETECTED"
  echo "   - Missing 'ollama' command"
  SIZE=$(ls -lh "$BINARY" | awk '{print $5}')
  echo "   - Size: $SIZE"
  echo ""
  echo "📝 Clean & rebuild:"
  echo "   Xcode → Product → Clean Build Folder (Cmd+Shift+K)"
  echo "   Xcode → Product → Build (Cmd+B)"
fi
